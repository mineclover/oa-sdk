/**
 * OAS ParsedDocument → TypeScript 타입 파일 생성
 *
 * 1. components/schemas → interface/type alias
 * 2. operations → 경로별 요청/응답 타입 ($ref는 이름 참조 유지)
 */

import type {
  OasDocument,
  OasSchema,
  OasParameter,
  OasRequestBody,
  OasResponse,
} from '@oa-sdk/parser'
import { derefSpec, isRelativeRef, parseDocument, resolveRefGraph } from '@oa-sdk/parser'
import { schemaToTs, type SchemaToTsOptions } from './schema-to-ts.js'
import { pascalCase, formatGeneratedTs } from '@oa-sdk/core'
import { basename, extname } from 'node:path'

export type TypegenOptions = {
  /** 헤더 주석 포함 여부 (기본: true) */
  banner?: boolean
  /** export style: 'type' = type alias, 'interface' = interface (기본: 'type') */
  style?: 'type' | 'interface'
  /** annotations 필드를 JSDoc에 포함 (기본: false) */
  includeAnnotations?: boolean
  /** OAS 파일 경로. 상대 외부 $ref 타입 생성을 위해 사용 */
  basePath?: string
  /** 생성 중 발견한 경고를 수집할 배열 */
  warnings?: string[]
  /** 내부 사용: $ref 문자열 → 타입 이름 override */
  refNameOverrides?: Record<string, string>
}

export type ExternalSchemaRefDiagnosticCode =
  | 'external-schema-name-collision'
  | 'external-schema-shadows-local'
  | 'external-schema-unresolved'

export type ExternalSchemaRefDiagnostic = {
  code: ExternalSchemaRefDiagnosticCode
  message: string
  name?: string
  ref?: string
  refs?: string[]
  generatedName?: string
}

export type ExternalSchemaRefAnalysis = {
  schemas: Record<string, OasSchema>
  refNameOverrides: Record<string, string>
  diagnostics: ExternalSchemaRefDiagnostic[]
}

/** ParsedDocument IR 기반 (deref 후). $ref가 해결된 상태. */
export function generateTypes(doc: { schemas: Record<string, OasSchema>; operations: Array<{ operationId?: string; method: string; openApiPath: string; parameters: OasParameter[]; requestBody?: OasRequestBody; responses: Record<string, OasResponse>; summary?: string; description?: string }> }, options: TypegenOptions = {}): string {
  const { banner = true, style = 'type', includeAnnotations = false } = options
  const schemaOpts: SchemaToTsOptions = { includeAnnotations }
  if (options.refNameOverrides !== undefined) schemaOpts.refNameOverrides = options.refNameOverrides
  const lines: string[] = []

  if (banner) {
    lines.push('// Auto-generated from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/codegen typegen')
    lines.push('')
  }

  // schema 이름 수집 — operation 타입과 중복 방지용
  const schemaNames = new Set(Object.keys(doc.schemas))

  // 1. components/schemas → 타입 선언
  for (const [name, schema] of Object.entries(doc.schemas)) {
    const tsType = schemaToTs(schema, schemaOpts)
    if (schema.description) lines.push(`/** ${schema.description} */`)
    if (style === 'interface' && tsType.startsWith('{')) {
      lines.push(`export interface ${name} ${tsType}`)
    } else {
      lines.push(`export type ${name} = ${tsType}`)
    }
    lines.push('')
  }

  // 2. operations → 요청/응답 타입
  for (const op of doc.operations) {
    if (!op.operationId) continue
    const baseName = pascalCase(op.operationId)

    // operation summary → JSDoc
    const opDoc = (op as { summary?: string; description?: string })
    const opComment = opDoc.summary ?? opDoc.description

    const pathParams = op.parameters.filter(p => p.in === 'path')
    if (pathParams.length > 0 && !schemaNames.has(`${baseName}PathParams`)) {
      lines.push(`export type ${baseName}PathParams = ${paramsToTs(pathParams, schemaOpts)}`)
      lines.push('')
    }

    const queryParams = op.parameters.filter(p => p.in === 'query')
    if (queryParams.length > 0 && !schemaNames.has(`${baseName}QueryParams`)) {
      lines.push(`export type ${baseName}QueryParams = ${paramsToTs(queryParams, schemaOpts)}`)
      lines.push('')
    }

    const bodyType = op.requestBody ? requestBodyToTs(op.requestBody, schemaOpts) : null
    if (bodyType && !schemaNames.has(`${baseName}Body`)) {
      lines.push(`export type ${baseName}Body = ${bodyType}`)
      lines.push('')
    }

    const responseType = responseToTs(op.responses, schemaOpts)
    if (responseType && !schemaNames.has(`${baseName}Response`)) {
      if (opComment) lines.push(`/** ${opComment} */`)
      lines.push(`export type ${baseName}Response = ${responseType}`)
      lines.push('')
    }

    // Response headers 타입
    const headersType = responseHeadersToTs(op.responses, schemaOpts)
    if (headersType && !schemaNames.has(`${baseName}ResponseHeaders`)) {
      lines.push(`export type ${baseName}ResponseHeaders = ${headersType}`)
      lines.push('')
    }

    // Error response 타입 (4xx/5xx/default)
    const errorType = errorResponseToTs(op.responses, schemaOpts)
    if (errorType && !schemaNames.has(`${baseName}Error`)) {
      lines.push(`export type ${baseName}Error = ${errorType}`)
      lines.push('')
    }

    // Operation 묶음 타입
    const bundleFields: string[] = []
    bundleFields.push(`  method: '${op.method}'`)
    bundleFields.push(`  path: '${op.openApiPath}'`)
    if (pathParams.length > 0) bundleFields.push(`  params: ${baseName}PathParams`)
    if (queryParams.length > 0) bundleFields.push(`  query: ${baseName}QueryParams`)
    if (bodyType) bundleFields.push(`  body: ${baseName}Body`)
    if (responseType) bundleFields.push(`  response: ${baseName}Response`)
    if (headersType) bundleFields.push(`  responseHeaders: ${baseName}ResponseHeaders`)
    if (errorType) bundleFields.push(`  error?: ${baseName}Error`)
    lines.push(`export type ${baseName}Op = {\n${bundleFields.join('\n')}\n}`)
    lines.push('')
  }

  return formatGeneratedTs(lines.join('\n'))
}

/**
 * OAS 원본 문서에서 직접 타입을 생성합니다.
 * deref 없이 파싱하여 $ref를 이름 참조로 유지합니다.
 */
export function generateTypesFromSpec(spec: OasDocument, options: TypegenOptions = {}): string {
  const doc = parseDocument(spec, []) // deref 없이 파싱
  const externalAnalysis = options.basePath
    ? analyzeExternalSchemaRefs(spec, options.basePath)
    : emptyExternalSchemaAnalysis()
  options.warnings?.push(...externalAnalysis.diagnostics.map(d => d.message))
  return generateTypes({
    ...doc,
    schemas: { ...externalAnalysis.schemas, ...doc.schemas },
  }, { ...options, refNameOverrides: externalAnalysis.refNameOverrides })
}

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────

function paramsToTs(params: OasParameter[], schemaOpts: SchemaToTsOptions): string {
  const fields = params.map(p => {
    const type = p.schema ? schemaToTs(p.schema, schemaOpts) : 'string'
    const opt = p.required ? '' : '?'
    const desc = p.description
    const comment = desc ? `  /** ${desc} */\n` : ''
    return `${comment}  ${p.name}${opt}: ${type}`
  })
  return `{\n${fields.join('\n')}\n}`
}

function requestBodyToTs(body: OasRequestBody, schemaOpts: SchemaToTsOptions): string | null {
  const jsonContent = body.content['application/json']
  if (!jsonContent || '$ref' in jsonContent) return null
  const mediaType = jsonContent as { schema?: OasSchema }
  if (!mediaType.schema) return null
  return schemaToTs(mediaType.schema, schemaOpts)
}

function responseToTs(responses: Record<string, OasResponse>, schemaOpts: SchemaToTsOptions): string | null {
  const codes = Object.keys(responses)
    .filter(k => /^2\d{2}$/.test(k))
    .sort()
  const key = codes[0] ?? 'default'
  const response = responses[key]
  if (!response?.content) return null

  const jsonContent = response.content['application/json']
  if (!jsonContent || '$ref' in jsonContent) return null
  const mediaType = jsonContent as { schema?: OasSchema }
  if (!mediaType.schema) return null
  return schemaToTs(mediaType.schema, schemaOpts)
}


function errorResponseToTs(responses: Record<string, OasResponse>, schemaOpts: SchemaToTsOptions): string | null {
  // Find the first 4xx or 5xx response with a JSON schema, or fall back to 'default'
  const errorCodes = Object.keys(responses)
    .filter(k => /^[45]\d{2}$/.test(k))
    .sort()
  const candidates = [...errorCodes, 'default']
  for (const key of candidates) {
    const response = responses[key]
    if (!response?.content) continue
    const jsonContent = response.content['application/json']
    if (!jsonContent || '$ref' in jsonContent) continue
    const mediaType = jsonContent as { schema?: OasSchema }
    if (!mediaType.schema) continue
    return schemaToTs(mediaType.schema, schemaOpts)
  }
  return null
}

function responseHeadersToTs(responses: Record<string, OasResponse>, schemaOpts: SchemaToTsOptions): string | null {
  const codes = Object.keys(responses).filter(k => /^2\d{2}$/.test(k)).sort()
  const key = codes[0] ?? 'default'
  const response = responses[key]
  if (!response?.headers) return null
  const entries = Object.entries(response.headers)
    .filter(([, h]) => !('$ref' in h))
    .map(([name, h]) => {
      const header = h as { schema?: OasSchema; required?: boolean }
      const type = header.schema ? schemaToTs(header.schema, schemaOpts) : 'string'
      const opt = header.required ? '' : '?'
      return `  '${name}'${opt}: ${type}`
    })
  if (entries.length === 0) return null
  return `{\n${entries.join('\n')}\n}`
}

export function analyzeExternalSchemaRefs(spec: OasDocument, basePath: string): ExternalSchemaRefAnalysis {
  const graph = resolveRefGraph(spec, { basePath })
  const refList = graph.nodes
    .filter(node => node.kind === 'external' && isRelativeRef(node.ref) && node.ref.includes('#/'))
    .map(node => node.ref)
    .filter((ref, index, refs) => refs.indexOf(ref) === index)
    .sort()
  const diagnostics: ExternalSchemaRefDiagnostic[] = []
  const schemas: Record<string, OasSchema> = {}
  const refNameOverrides: Record<string, string> = {}
  const localNames = new Set(Object.keys(spec.components?.schemas ?? {}))
  const usedNames = new Set(localNames)
  const refsByName = groupRefsBySchemaName(refList)

  for (const [name, groupRefs] of refsByName) {
    if (groupRefs.length <= 1) continue
    diagnostics.push({
      code: 'external-schema-name-collision',
      name,
      refs: groupRefs,
      message: `외부 스키마 이름 충돌: ${name} (${groupRefs.join(', ')}). 파일명 기반 타입명으로 생성합니다.`,
    })
  }

  for (const ref of refList) {
    const baseName = schemaNameFromRef(ref)
    if (!baseName) continue

    const collidesWithExternal = (refsByName.get(baseName)?.length ?? 0) > 1
    const shadowsLocal = localNames.has(baseName)
    const preferredName = collidesWithExternal || shadowsLocal
      ? `${pascalCase(fileStemFromRef(ref))}${baseName}`
      : baseName
    const generatedName = uniqueTypeName(preferredName, usedNames)
    usedNames.add(generatedName)

    if (shadowsLocal) {
      diagnostics.push({
        code: 'external-schema-shadows-local',
        name: baseName,
        ref,
        generatedName,
        message: `외부 스키마 이름이 로컬 component와 충돌: ${baseName} (${ref}). ${generatedName} 타입명으로 생성합니다.`,
      })
    }

    const graphNode = graph.nodes.find(node => node.ref === ref && node.resolved)
    const resolved = graphNode?.target ?? derefSpec({ $ref: ref }, { basePath }) as unknown
    if (isSchemaObject(resolved)) {
      schemas[generatedName] = resolved as OasSchema
      refNameOverrides[ref] = generatedName
    } else {
      diagnostics.push({
        code: 'external-schema-unresolved',
        name: baseName,
        ref,
        message: `외부 스키마를 해소할 수 없습니다: ${ref}`,
      })
    }
  }

  return { schemas, refNameOverrides, diagnostics }
}

function emptyExternalSchemaAnalysis(): ExternalSchemaRefAnalysis {
  return { schemas: {}, refNameOverrides: {}, diagnostics: [] }
}

function schemaNameFromRef(ref: string): string | undefined {
  return ref.split('/').pop()
}

function groupRefsBySchemaName(refs: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const ref of refs) {
    const name = schemaNameFromRef(ref)
    if (!name) continue
    const list = groups.get(name) ?? []
    list.push(ref)
    groups.set(name, list)
  }
  return groups
}

function fileStemFromRef(ref: string): string {
  const [filePart] = ref.split('#')
  if (!filePart) return 'External'
  const fileName = basename(filePart)
  return fileName.slice(0, fileName.length - extname(fileName).length) || 'External'
}

function uniqueTypeName(preferredName: string, usedNames: Set<string>): string {
  if (!usedNames.has(preferredName)) return preferredName
  let suffix = 2
  while (usedNames.has(`${preferredName}${suffix}`)) suffix++
  return `${preferredName}${suffix}`
}

function isSchemaObject(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && !('$ref' in value)
}
