/**
 * @oa-sdk/codegen/typegen/browser — browser-safe type generation.
 *
 * This entrypoint accepts an in-memory OpenAPI document and keeps $ref names.
 * Use @oa-sdk/codegen/typegen from Node when basePath-driven external $ref
 * analysis is required.
 */

import type {
  OasDocument,
  OasSchema,
  OasParameter,
  OasRequestBody,
  OasResponse,
  OasLink,
} from '@oa-sdk/parser/browser'
import { parseDocument } from '@oa-sdk/parser/browser'
import { createOperationTypeNameMap, formatGeneratedTs } from '@oa-sdk/core/browser'
import { schemaToTs, type SchemaToTsOptions } from './schema-to-ts.js'
import { compareTypegenKeys } from './stable-order.js'

export type BrowserTypegenOptions = {
  /** 헤더 주석 포함 여부 (기본: true) */
  banner?: boolean
  /** export style: 'type' = type alias, 'interface' = interface (기본: 'type') */
  style?: 'type' | 'interface'
  /** annotations 필드를 JSDoc에 포함 (기본: false) */
  includeAnnotations?: boolean
  /** 내부 사용: $ref 문자열 -> 타입 이름 override */
  refNameOverrides?: Record<string, string>
}

export type TypegenOptions = BrowserTypegenOptions

type TypegenOperation = {
  operationId?: string
  method: string
  openApiPath: string
  parameters: OasParameter[]
  requestBody?: OasRequestBody
  responses: Record<string, OasResponse>
  summary?: string
  description?: string
}

type TypegenDocument = {
  schemas: Record<string, OasSchema>
  operations: TypegenOperation[]
  webhooks?: TypegenOperation[]
}

export function generateTypes(doc: TypegenDocument, options: BrowserTypegenOptions = {}): string {
  const { banner = true, style = 'type', includeAnnotations = false } = options
  const schemaOpts: SchemaToTsOptions = { includeAnnotations }
  if (options.refNameOverrides !== undefined) schemaOpts.refNameOverrides = options.refNameOverrides
  const lines: string[] = []
  const operations = sortTypegenOperations([...doc.operations, ...(doc.webhooks ?? [])])
  const operationNames = createOperationTypeNameMap(operations)

  if (banner) {
    lines.push('// Auto-generated from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/codegen typegen')
    lines.push('')
  }

  const schemaNames = new Set(Object.keys(doc.schemas))

  for (const [name, schema] of Object.entries(doc.schemas).sort(([left], [right]) => compareTypegenKeys(left, right))) {
    const tsType = schemaToTs(schema, schemaOpts)
    if (schema.description) lines.push(`/** ${schema.description} */`)
    if (style === 'interface' && tsType.startsWith('{')) {
      lines.push(`export interface ${name} ${tsType}`)
    } else {
      lines.push(`export type ${name} = ${tsType}`)
    }
    lines.push('')
  }

  for (const op of operations) {
    if (!op.operationId) continue
    const baseName = operationNames.get(op.operationId)!

    const opDoc = (op as { summary?: string; description?: string })
    const opComment = opDoc.summary ?? opDoc.description

    const pathParams = sortParameters(op.parameters.filter(p => p.in === 'path'))
    if (pathParams.length > 0 && !schemaNames.has(`${baseName}PathParams`)) {
      lines.push(`export type ${baseName}PathParams = ${paramsToTs(pathParams, schemaOpts)}`)
      lines.push('')
    }

    const queryParams = sortParameters(op.parameters.filter(p => p.in === 'query'))
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

    const headersType = responseHeadersToTs(op.responses, schemaOpts)
    if (headersType && !schemaNames.has(`${baseName}ResponseHeaders`)) {
      lines.push(`export type ${baseName}ResponseHeaders = ${headersType}`)
      lines.push('')
    }

    const linksType = responseLinksToTs(op.responses)
    if (linksType && !schemaNames.has(`${baseName}ResponseLinks`)) {
      lines.push(`export type ${baseName}ResponseLinks = ${linksType}`)
      lines.push('')
    }

    const errorType = errorResponseToTs(op.responses, schemaOpts)
    if (errorType && !schemaNames.has(`${baseName}Error`)) {
      lines.push(`export type ${baseName}Error = ${errorType}`)
      lines.push('')
    }

    const errorByStatusType = errorResponseByStatusToTs(op.responses, schemaOpts)
    if (errorByStatusType && !schemaNames.has(`${baseName}ErrorByStatus`)) {
      lines.push(`export type ${baseName}ErrorByStatus = ${errorByStatusType}`)
      lines.push('')
    }

    const bundleFields: string[] = []
    bundleFields.push(`  method: '${op.method}'`)
    bundleFields.push(`  path: '${op.openApiPath}'`)
    if (pathParams.length > 0) bundleFields.push(`  params: ${baseName}PathParams`)
    if (queryParams.length > 0) bundleFields.push(`  query: ${baseName}QueryParams`)
    if (bodyType) bundleFields.push(`  body: ${baseName}Body`)
    if (responseType) bundleFields.push(`  response: ${baseName}Response`)
    if (headersType) bundleFields.push(`  responseHeaders: ${baseName}ResponseHeaders`)
    if (linksType) bundleFields.push(`  responseLinks: ${baseName}ResponseLinks`)
    if (errorType) bundleFields.push(`  error?: ${baseName}Error`)
    lines.push(`export type ${baseName}Op = {\n${bundleFields.join('\n')}\n}`)
    lines.push('')
  }

  return formatGeneratedTs(lines.join('\n'))
}

function sortTypegenOperations(operations: readonly TypegenOperation[]): TypegenOperation[] {
  return [...operations].sort((left, right) =>
    compareTypegenKeys(left.operationId ?? '', right.operationId ?? '') ||
    compareTypegenKeys(left.openApiPath, right.openApiPath) ||
    compareTypegenKeys(left.method, right.method),
  )
}

function sortParameters(parameters: readonly OasParameter[]): OasParameter[] {
  return [...parameters].sort((left, right) => compareTypegenKeys(left.name, right.name))
}

export function generateTypesFromSpec(spec: OasDocument, options: BrowserTypegenOptions = {}): string {
  return generateTypes(parseDocument(spec), options)
}

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
  const response = pickSuccessResponse(responses)
  if (!response?.content) return null

  const jsonContent = response.content['application/json']
  if (!jsonContent || '$ref' in jsonContent) return null
  const mediaType = jsonContent as { schema?: OasSchema }
  if (!mediaType.schema) return null
  return schemaToTs(mediaType.schema, schemaOpts)
}

type GeneratedErrorResponse = { key: string; type: string }

function generatedErrorResponsesToTs(responses: Record<string, OasResponse>, schemaOpts: SchemaToTsOptions): GeneratedErrorResponse[] {
  const errorCodes = Object.keys(responses)
    .filter(k => /^[45]\d{2}$/.test(k))
    .sort()
  const candidates = [...errorCodes, 'default']
  const entries: GeneratedErrorResponse[] = []
  for (const key of candidates) {
    const response = responses[key]
    if (!response?.content) continue
    const jsonContent = response.content['application/json']
    if (!jsonContent || '$ref' in jsonContent) continue
    const mediaType = jsonContent as { schema?: OasSchema }
    if (!mediaType.schema) continue
    entries.push({ key, type: schemaToTs(mediaType.schema, schemaOpts) })
  }
  return entries
}

function errorResponseToTs(responses: Record<string, OasResponse>, schemaOpts: SchemaToTsOptions): string | null {
  const types: string[] = []
  for (const { type } of generatedErrorResponsesToTs(responses, schemaOpts)) {
    for (const member of splitNamedUnion(type)) if (!types.includes(member)) types.push(member)
  }
  return types.length > 0 ? types.join(' | ') : null
}

function splitNamedUnion(type: string): string[] {
  return /^[A-Za-z_$][\w$]*(?:\s*\|\s*[A-Za-z_$][\w$]*)+$/.test(type)
    ? type.split(/\s*\|\s*/)
    : [type]
}

function errorResponseByStatusToTs(responses: Record<string, OasResponse>, schemaOpts: SchemaToTsOptions): string | null {
  const entries = generatedErrorResponsesToTs(responses, schemaOpts)
  if (entries.length === 0) return null
  const lines = ['{']
  const fallback = entries.find(entry => entry.key === 'default')
  if (fallback) {
    const types = [...new Set(entries.map(entry => entry.type))]
    lines.push(`  [status: number]: ${types.join(' | ')}`)
  }
  for (const { key, type } of entries) if (key !== 'default') lines.push(`  ${key}: ${type}`)
  lines.push('}')
  return lines.join('\n')
}

function responseHeadersToTs(responses: Record<string, OasResponse>, schemaOpts: SchemaToTsOptions): string | null {
  const response = pickSuccessResponse(responses)
  if (!response?.headers) return null
  const entries = Object.entries(response.headers)
    .sort(([left], [right]) => compareTypegenKeys(left, right))
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

function responseLinksToTs(responses: Record<string, OasResponse>): string | null {
  const response = pickSuccessResponse(responses)
  if (!response?.links) return null
  const entries = Object.entries(response.links)
    .sort(([left], [right]) => compareTypegenKeys(left, right))
    .filter(([, link]) => !('$ref' in link))
    .map(([name, link]) => `  ${propertyNameToTs(name)}: ${linkToTs(link as OasLink)}`)
  if (entries.length === 0) return null
  return `{\n${entries.join('\n')}\n}`
}

function pickSuccessResponse(responses: Record<string, OasResponse>): OasResponse | undefined {
  const codes = Object.keys(responses)
    .filter(k => /^2\d{2}$/.test(k))
    .sort()
  const key = codes[0] ?? 'default'
  return responses[key]
}

function linkToTs(link: OasLink): string {
  const fields: string[] = []
  if (link.operationId !== undefined) fields.push(`  operationId: ${metadataLiteralToTs(link.operationId)}`)
  if (link.operationRef !== undefined) fields.push(`  operationRef: ${metadataLiteralToTs(link.operationRef)}`)
  if (link.parameters !== undefined) fields.push(`  parameters: ${metadataLiteralToTs(link.parameters)}`)
  if (link.requestBody !== undefined) fields.push(`  requestBody: ${metadataLiteralToTs(link.requestBody)}`)
  if (link.description !== undefined) fields.push(`  description: ${metadataLiteralToTs(link.description)}`)
  if (link.server !== undefined) fields.push(`  server: ${metadataLiteralToTs(link.server)}`)
  for (const [name, value] of Object.entries(link)) {
    if (!name.startsWith('x-') || value === undefined) continue
    fields.push(`  ${propertyNameToTs(name)}: ${metadataLiteralToTs(value)}`)
  }
  return `{\n${fields.join('\n')}\n}`
}

function metadataLiteralToTs(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'number'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return `[${value.map(item => metadataLiteralToTs(item)).join(', ')}]`
  if (value && typeof value === 'object') {
    const fields = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .map(([name, child]) => `  ${propertyNameToTs(name)}: ${metadataLiteralToTs(child)}`)
    return `{\n${fields.join('\n')}\n}`
  }
  return 'unknown'
}

function propertyNameToTs(name: string): string {
  return JSON.stringify(name)
}

export { schemaToTs, typescriptAlgebra } from './schema-to-ts.js'
export type { SchemaToTsOptions } from './schema-to-ts.js'
export { pascalCase, escapeKey, collectTypeNames } from '@oa-sdk/core/browser'
