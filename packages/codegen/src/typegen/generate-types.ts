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
import { parseDocument } from '@oa-sdk/parser'
import { schemaToTs } from './schema-to-ts.js'
import { pascalCase, formatGeneratedTs } from '@oa-sdk/core'

export type TypegenOptions = {
  /** 헤더 주석 포함 여부 (기본: true) */
  banner?: boolean
  /** export style: 'type' = type alias, 'interface' = interface (기본: 'type') */
  style?: 'type' | 'interface'
  /** annotations 필드를 JSDoc에 포함 (기본: false) */
  includeAnnotations?: boolean
}

/** ParsedDocument IR 기반 (deref 후). $ref가 해결된 상태. */
export function generateTypes(doc: { schemas: Record<string, OasSchema>; operations: Array<{ operationId?: string; method: string; openApiPath: string; parameters: OasParameter[]; requestBody?: OasRequestBody; responses: Record<string, OasResponse>; summary?: string; description?: string }> }, options: TypegenOptions = {}): string {
  const { banner = true, style = 'type', includeAnnotations = false } = options
  const schemaOpts = { includeAnnotations }
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
      lines.push(`export type ${baseName}PathParams = ${paramsToTs(pathParams)}`)
      lines.push('')
    }

    const queryParams = op.parameters.filter(p => p.in === 'query')
    if (queryParams.length > 0 && !schemaNames.has(`${baseName}QueryParams`)) {
      lines.push(`export type ${baseName}QueryParams = ${paramsToTs(queryParams)}`)
      lines.push('')
    }

    const bodyType = op.requestBody ? requestBodyToTs(op.requestBody) : null
    if (bodyType && !schemaNames.has(`${baseName}Body`)) {
      lines.push(`export type ${baseName}Body = ${bodyType}`)
      lines.push('')
    }

    const responseType = responseToTs(op.responses)
    if (responseType && !schemaNames.has(`${baseName}Response`)) {
      if (opComment) lines.push(`/** ${opComment} */`)
      lines.push(`export type ${baseName}Response = ${responseType}`)
      lines.push('')
    }

    // Response headers 타입
    const headersType = responseHeadersToTs(op.responses)
    if (headersType && !schemaNames.has(`${baseName}ResponseHeaders`)) {
      lines.push(`export type ${baseName}ResponseHeaders = ${headersType}`)
      lines.push('')
    }

    // Error response 타입 (4xx/5xx/default)
    const errorType = errorResponseToTs(op.responses)
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
  return generateTypes(doc, options)
}

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────

function paramsToTs(params: OasParameter[]): string {
  const fields = params.map(p => {
    const type = p.schema ? schemaToTs(p.schema) : 'string'
    const opt = p.required ? '' : '?'
    const desc = p.description
    const comment = desc ? `  /** ${desc} */\n` : ''
    return `${comment}  ${p.name}${opt}: ${type}`
  })
  return `{\n${fields.join('\n')}\n}`
}

function requestBodyToTs(body: OasRequestBody): string | null {
  const jsonContent = body.content['application/json']
  if (!jsonContent || '$ref' in jsonContent) return null
  const mediaType = jsonContent as { schema?: OasSchema }
  if (!mediaType.schema) return null
  return schemaToTs(mediaType.schema)
}

function responseToTs(responses: Record<string, OasResponse>): string | null {
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
  return schemaToTs(mediaType.schema)
}


function errorResponseToTs(responses: Record<string, OasResponse>): string | null {
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
    return schemaToTs(mediaType.schema)
  }
  return null
}

function responseHeadersToTs(responses: Record<string, OasResponse>): string | null {
  const codes = Object.keys(responses).filter(k => /^2\d{2}$/.test(k)).sort()
  const key = codes[0] ?? 'default'
  const response = responses[key]
  if (!response?.headers) return null
  const entries = Object.entries(response.headers)
    .filter(([, h]) => !('$ref' in h))
    .map(([name, h]) => {
      const header = h as { schema?: OasSchema; required?: boolean }
      const type = header.schema ? schemaToTs(header.schema) : 'string'
      const opt = header.required ? '' : '?'
      return `  '${name}'${opt}: ${type}`
    })
  if (entries.length === 0) return null
  return `{\n${entries.join('\n')}\n}`
}
