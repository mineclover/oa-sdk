/**
 * parseDocument — OAS 3.2 원본 문서를 ParsedDocument IR로 변환
 *
 * 1. SpecPass 파이프라인 실행 ($ref 해결 등)
 * 2. paths + webhooks에서 오퍼레이션 추출
 * 3. components 정규화
 * 4. RouteIndex 구축
 */

import type {
  OasDocument,
  OasPathItem,
  OasOperation,
  OasParameter,
  OasRequestBody,
  OasResponse,
  OasCallback,
  OasServer,
  OasSecurityRequirement,
  OasTag,
  OasSecurityScheme,
  OasSchema,
  OasExample,
  OasHeader,
  OasLink,
  OasMediaType,
  Referenceable,
} from './oas32-types.js'
import type { HttpMethod, OperationEntry, RouteIndex, ParsedDocument } from './types.js'
import { runPipeline, DEFAULT_PASSES, type SpecPass } from './pipeline.js'

const STANDARD_METHODS: HttpMethod[] = [
  'get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace', 'query',
]

/**
 * OAS 3.2 원본 문서를 구조화된 ParsedDocument IR로 파싱합니다.
 *
 * @param doc 원본 OAS 3.2 문서 (JSON/YAML 파싱 후 객체)
 * @param passes SpecPass 파이프라인 (기본: [derefPass])
 */
export function parseDocument(
  doc: OasDocument,
  passes: SpecPass[] = DEFAULT_PASSES,
): ParsedDocument {
  const resolved = runPipeline(doc, passes) as OasDocument

  const operations: OperationEntry[] = []
  const routes: RouteIndex = new Map()

  // paths → operations + routes
  for (const [path, rawItem] of Object.entries(resolved.paths ?? {})) {
    const item = deref(rawItem)
    if (!item) continue
    const pathOps = extractOperations(path, item, resolved)
    operations.push(...pathOps)

    const methodMap = new Map<HttpMethod, OperationEntry>()
    for (const op of pathOps) methodMap.set(op.method, op)
    if (methodMap.size > 0) routes.set(path, methodMap)
  }

  // webhooks → operations (routes에는 포함하지 않음)
  const webhooks: OperationEntry[] = []
  for (const [name, rawItem] of Object.entries(resolved.webhooks ?? {})) {
    const item = deref(rawItem)
    if (!item) continue
    const webhookOps = extractOperations(`/webhooks/${name}`, item, resolved)
    webhooks.push(...webhookOps)
  }

  // components 정규화
  const components = resolved.components ?? {}

  // tags 인덱싱
  const tagMap = new Map<string, OasTag>()
  for (const tag of resolved.tags ?? []) {
    tagMap.set(tag.name, tag)
  }

  // security schemes
  const securitySchemes: Record<string, OasSecurityScheme> = {}
  for (const [name, scheme] of Object.entries(components.securitySchemes ?? {})) {
    const resolved = deref(scheme)
    if (resolved) securitySchemes[name] = resolved
  }

  return {
    openapi: resolved.openapi,
    info: resolved.info,
    servers: resolved.servers ?? [],
    tags: tagMap,
    operations,
    routes,
    schemas: (components.schemas ?? {}) as Record<string, OasSchema>,
    securitySchemes,
    security: resolved.security ?? [],
    components: {
      responses: derefMap(components.responses),
      parameters: derefMap(components.parameters),
      requestBodies: derefMap(components.requestBodies),
      examples: derefMap(components.examples),
      headers: derefMap(components.headers),
      links: derefMap(components.links),
      callbacks: derefMap(components.callbacks),
      pathItems: components.pathItems ?? {},
      mediaTypes: derefMap(components.mediaTypes),
    },
    webhooks,
    raw: doc,
  }
}

// ─── 내부 헬퍼 ─────────────────────────────────────────────────────────────

/** Referenceable<T>에서 $ref 참조를 건너뛰고 실제 값만 반환 (derefPass 후 사용 가정) */
function deref<T>(item: Referenceable<T> | undefined): T | undefined {
  if (!item || typeof item !== 'object') return undefined
  if ('$ref' in item) return undefined // derefPass가 해결 못한 외부 ref
  return item as T
}

/** Record<string, Referenceable<T>>를 Record<string, T>로 변환 */
function derefMap<T>(map: Record<string, Referenceable<T>> | undefined): Record<string, T> {
  if (!map) return {}
  const result: Record<string, T> = {}
  for (const [key, value] of Object.entries(map)) {
    const resolved = deref(value)
    if (resolved) result[key] = resolved
  }
  return result
}

/** PathItem에서 모든 오퍼레이션을 추출 */
function extractOperations(
  path: string,
  item: OasPathItem,
  doc: OasDocument,
): OperationEntry[] {
  const results: OperationEntry[] = []
  const pathParams = (item.parameters ?? []) as OasParameter[]

  for (const method of STANDARD_METHODS) {
    const op = item[method] as OasOperation | undefined
    if (!op) continue
    results.push(buildEntry(path, method, op, pathParams, item, doc))
  }

  // additionalOperations (OAS 3.2)
  for (const [method, op] of Object.entries(item.additionalOperations ?? {})) {
    results.push(buildEntry(path, method as HttpMethod, op, pathParams, item, doc))
  }

  return results
}

/** 개별 Operation → OperationEntry 변환 */
function buildEntry(
  path: string,
  method: HttpMethod,
  op: OasOperation,
  pathParams: OasParameter[],
  item: OasPathItem,
  doc: OasDocument,
): OperationEntry {
  const opParams = (op.parameters ?? []).filter(p => !('$ref' in p)) as OasParameter[]
  const merged = mergeParameters(pathParams, opParams)

  const entry: OperationEntry = {
    openApiPath: path,
    method,
    tags: op.tags ?? [],
    deprecated: op.deprecated ?? false,
    parameters: merged,
    responses: (op.responses ?? {}) as Record<string, OasResponse>,
    security: op.security ?? doc.security ?? [],
    servers: op.servers ?? item.servers ?? doc.servers ?? [],
    callbacks: (op.callbacks ?? {}) as Record<string, OasCallback>,
  }

  if (op.operationId !== undefined) entry.operationId = op.operationId
  if (op.summary !== undefined) entry.summary = op.summary
  if (op.description !== undefined) entry.description = op.description
  if (op.requestBody && !('$ref' in op.requestBody)) {
    entry.requestBody = op.requestBody as OasRequestBody
  }
  if (op.externalDocs !== undefined) entry.externalDocs = op.externalDocs

  return entry
}

/** operation 파라미터가 같은 name+in의 path 파라미터를 오버라이드 */
function mergeParameters(path: OasParameter[], op: OasParameter[]): OasParameter[] {
  const map = new Map<string, OasParameter>()
  for (const p of path) map.set(`${p.in}:${p.name}`, p)
  for (const p of op) map.set(`${p.in}:${p.name}`, p)
  return [...map.values()]
}
