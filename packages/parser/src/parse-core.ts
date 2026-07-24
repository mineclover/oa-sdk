import type {
  OasDocument,
  OasPathItem,
  OasOperation,
  OasParameter,
  OasRequestBody,
  OasResponse,
  OasCallback,
  OasSecurityScheme,
  OasSchema,
  OasExample,
  OasHeader,
  OasLink,
  OasMediaType,
  Referenceable,
} from './oas32-types.js'
import type { HttpMethod, OperationEntry, ParsedDocument, RouteIndex } from './types.js'
import type { ParsedDocumentRefResolution } from './types.js'
import { createParsedDocumentRefResolution } from './parsed-document.js'

const STANDARD_METHODS: HttpMethod[] = [
  'get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace', 'query',
]

export function parseResolvedDocument(
  resolved: OasDocument,
  raw: OasDocument = resolved,
  resolution?: ParsedDocumentRefResolution,
): ParsedDocument {
  const operations: OperationEntry[] = []
  const routes: RouteIndex = new Map()

  for (const [path, rawItem] of Object.entries(resolved.paths ?? {})) {
    const item = deref(rawItem)
    if (!item) continue
    const pathOps = extractOperations(path, item, resolved)
    operations.push(...pathOps)

    const methodMap = new Map<HttpMethod, OperationEntry>()
    for (const op of pathOps) methodMap.set(op.method, op)
    if (methodMap.size > 0) routes.set(path, methodMap)
  }

  const webhooks: OperationEntry[] = []
  for (const [name, rawItem] of Object.entries(resolved.webhooks ?? {})) {
    const item = deref(rawItem)
    if (!item) continue
    const webhookOps = extractOperations(`/webhooks/${name}`, item, resolved)
    webhooks.push(...webhookOps)
  }

  const components = resolved.components ?? {}

  const tagMap = new Map<string, NonNullable<OasDocument['tags']>[number]>()
  for (const tag of resolved.tags ?? []) {
    tagMap.set(tag.name, tag)
  }

  const securitySchemes: Record<string, OasSecurityScheme> = {}
  for (const [name, scheme] of Object.entries(components.securitySchemes ?? {})) {
    const resolvedScheme = deref(scheme)
    if (resolvedScheme) securitySchemes[name] = resolvedScheme
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
    raw,
    resolution: resolution ?? createParsedDocumentRefResolution({
      document: resolved,
      scope: 'custom',
    }),
  }
}

function deref<T>(item: Referenceable<T> | undefined): T | undefined {
  if (!item || typeof item !== 'object') return undefined
  if ('$ref' in item) return undefined
  return item as T
}

function resolveLocalReference<T>(doc: OasDocument, item: Referenceable<T> | undefined): T | undefined {
  if (!item || typeof item !== 'object') return undefined
  if (!('$ref' in item)) return item as T
  if (!item.$ref.startsWith('#/')) return undefined
  const resolved = readJsonPointer(doc, item.$ref)
  return resolved && typeof resolved === 'object' ? resolved as T : undefined
}

function readJsonPointer(doc: OasDocument, pointer: string): unknown {
  let value: unknown = doc
  for (const segment of pointer.slice(2).split('/').map(unescapeJsonPointer)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    value = (value as Record<string, unknown>)[segment]
  }
  return value
}

function unescapeJsonPointer(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~')
}

function derefMap<T>(map: Record<string, Referenceable<T>> | undefined): Record<string, T> {
  if (!map) return {}
  const result: Record<string, T> = {}
  for (const [key, value] of Object.entries(map)) {
    const resolved = deref(value)
    if (resolved) result[key] = resolved
  }
  return result
}

function extractOperations(
  path: string,
  item: OasPathItem,
  doc: OasDocument,
): OperationEntry[] {
  const results: OperationEntry[] = []
  const pathParams = (item.parameters ?? [])
    .map(parameter => resolveLocalReference<OasParameter>(doc, parameter))
    .filter(parameter => parameter !== undefined)

  for (const method of STANDARD_METHODS) {
    const op = item[method] as OasOperation | undefined
    if (!op) continue
    results.push(buildEntry(path, method, op, pathParams, item, doc))
  }

  for (const [method, op] of Object.entries(item.additionalOperations ?? {})) {
    results.push(buildEntry(path, method as HttpMethod, op, pathParams, item, doc))
  }

  return results
}

function buildEntry(
  path: string,
  method: HttpMethod,
  op: OasOperation,
  pathParams: OasParameter[],
  item: OasPathItem,
  doc: OasDocument,
): OperationEntry {
  const opParams = (op.parameters ?? [])
    .map(parameter => resolveLocalReference<OasParameter>(doc, parameter))
    .filter(parameter => parameter !== undefined)
  const merged = mergeParameters(pathParams, opParams)

  const entry: OperationEntry = {
    openApiPath: path,
    method,
    tags: op.tags ?? [],
    deprecated: op.deprecated ?? false,
    parameters: merged,
    responses: resolveResponseMap(doc, op.responses),
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
  for (const [key, value] of Object.entries(op)) {
    if (key.startsWith('x-')) (entry as Record<string, unknown>)[key] = value
  }

  return entry
}

function resolveResponseMap(
  doc: OasDocument,
  responses: Record<string, Referenceable<OasResponse>> | undefined,
): Record<string, OasResponse> {
  const resolved: Record<string, OasResponse> = {}
  for (const [statusCode, response] of Object.entries(responses ?? {})) {
    const value = resolveLocalReference<OasResponse>(doc, response)
    if (value) resolved[statusCode] = value
  }
  return resolved
}

function mergeParameters(path: OasParameter[], op: OasParameter[]): OasParameter[] {
  const map = new Map<string, OasParameter>()
  for (const p of path) map.set(`${p.in}:${p.name}`, p)
  for (const p of op) map.set(`${p.in}:${p.name}`, p)
  return [...map.values()]
}
