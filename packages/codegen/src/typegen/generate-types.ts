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
  OasLink,
  RefGraphDiagnostic,
  RefGraphDiagnosticCode,
  RefGraphNode,
} from '@oa-sdk/parser'
import { isRelativeRef, parseDocument, resolveRefGraph } from '@oa-sdk/parser'
import { schemaToTs, type SchemaToTsOptions } from './schema-to-ts.js'
import { compareTypegenKeys } from './stable-order.js'
import { pascalCase, createOperationTypeNameMap, formatGeneratedTs } from '@oa-sdk/core'
import { createHash } from 'node:crypto'
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
  /** 내부 사용: 사전 계산된 외부 schema ref 분석 */
  externalAnalysis?: ExternalSchemaRefAnalysis
}

export type ExternalSchemaRefDiagnosticCode =
  | 'external-schema-name-collision'
  | 'external-schema-shadows-local'
  | 'external-schema-shadows-operation'
  | 'external-schema-unsupported-pointer'
  | 'external-schema-unresolved'
  | RefGraphDiagnosticCode

export type ExternalSchemaRefDiagnostic = {
  code: ExternalSchemaRefDiagnosticCode
  message: string
  name?: string
  ref?: string
  refs?: string[]
  generatedName?: string
  sourceFilePath?: string
  sourcePointer?: string
  filePath?: string
  pointer?: string
}

export type ExternalSchemaRefAnalysis = {
  schemas: Record<string, OasSchema>
  refNameOverrides: Record<string, string>
  diagnostics: ExternalSchemaRefDiagnostic[]
  typeAliases: ExternalSchemaTypeAlias[]
}

export type ExternalSchemaTypeAlias = {
  sourceFilePath?: string
  sourcePointer: string
  ref: string
  aliasName: string
  contentHash: string
  renamedFrom?: string
  filePath?: string
  pointer?: string
}

type RefGraphNodeWithSource = RefGraphNode & {
  sourceFilePath?: string
}

type RefGraphDiagnosticWithSource = RefGraphDiagnostic & {
  sourceFilePath?: string
  sourcePointer?: string
}

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

/** ParsedDocument IR 기반 (deref 후). $ref가 해결된 상태. */
export function generateTypes(doc: TypegenDocument, options: TypegenOptions = {}): string {
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

  // schema 이름 수집 — operation 타입과 중복 방지용
  const schemaNames = new Set(Object.keys(doc.schemas))

  // 1. components/schemas → 타입 선언
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

  // 2. operations/webhooks → 요청/응답 타입
  for (const op of operations) {
    if (!op.operationId) continue
    const baseName = operationNames.get(op.operationId)!

    // operation summary → JSDoc
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

    // Response headers 타입
    const headersType = responseHeadersToTs(op.responses, schemaOpts)
    if (headersType && !schemaNames.has(`${baseName}ResponseHeaders`)) {
      lines.push(`export type ${baseName}ResponseHeaders = ${headersType}`)
      lines.push('')
    }

    // Response links 타입
    const linksType = responseLinksToTs(op.responses)
    if (linksType && !schemaNames.has(`${baseName}ResponseLinks`)) {
      lines.push(`export type ${baseName}ResponseLinks = ${linksType}`)
      lines.push('')
    }

    // Error response 타입 (4xx/5xx/default)
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

    // Operation 묶음 타입
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
    lines.push(`/** @oaOperation ${op.method.toUpperCase()} ${op.openApiPath} */`)
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

/**
 * OAS 원본 문서에서 직접 타입을 생성합니다.
 * deref 없이 파싱하여 $ref를 이름 참조로 유지합니다.
 */
export function generateTypesFromSpec(spec: OasDocument, options: TypegenOptions = {}): string {
  const doc = parseDocument(spec, []) // deref 없이 파싱
  const externalAnalysis = options.basePath
    ? options.externalAnalysis ?? analyzeExternalSchemaRefs(spec, options.basePath)
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
    const type = schemaToTs(mediaType.schema, schemaOpts)
    entries.push({ key, type })
  }
  return entries
}

function errorResponseToTs(responses: Record<string, OasResponse>, schemaOpts: SchemaToTsOptions): string | null {
  // Preserve all distinct 4xx/5xx/default JSON bodies. A denied authorization
  // decision may be a typed 403 body while validation/auth failures use Error.
  const types: string[] = []
  for (const { type } of generatedErrorResponsesToTs(responses, schemaOpts)) {
    for (const member of splitNamedUnion(type)) {
      if (!types.includes(member)) types.push(member)
    }
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
  const defaultEntry = entries.find(entry => entry.key === 'default')
  if (defaultEntry) {
    const fallbackTypes: string[] = []
    for (const { type } of entries) {
      if (!fallbackTypes.includes(type)) fallbackTypes.push(type)
    }
    lines.push(`  [status: number]: ${fallbackTypes.join(' | ')}`)
  }
  for (const { key, type } of entries) {
    if (key === 'default') continue
    lines.push(`  ${key}: ${type}`)
  }
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

export function analyzeExternalSchemaRefs(spec: OasDocument, basePath: string): ExternalSchemaRefAnalysis {
  const graph = resolveRefGraph(spec, { basePath })
  const schemaNodes = graph.nodes
    .filter(node => isSchemaRefNode(node))
    .filter((node, index, nodes) => nodes.findIndex(n => refIdentity(n) === refIdentity(node)) === index)
    .sort((a, b) => compareTypegenKeys(refIdentity(a), refIdentity(b))) as RefGraphNodeWithSource[]
  const diagnostics: ExternalSchemaRefDiagnostic[] = []
  const schemas: Record<string, OasSchema> = {}
  const refNameOverrides: Record<string, string> = {}
  const localNames = new Set(Object.keys(spec.components?.schemas ?? {}))
  const operationNames = collectGeneratedOperationTypeNames(spec)
  const usedNames = new Set([...localNames, ...operationNames])
  const unsupportedPointerNodes = schemaNodes
    .filter(node => node.resolved)
    .filter(node => !isSupportedExternalSchemaPointer(node.pointer))
  const unsupportedPointerIdentities = new Set(unsupportedPointerNodes.map(refIdentity))
  const resolvedSchemaNodes = schemaNodes
    .filter(node => !unsupportedPointerIdentities.has(refIdentity(node)))
    .filter(node => isSchemaObject(node.target))
  const refsByName = groupRefsBySchemaName(resolvedSchemaNodes)
  const resolvedNamesByIdentity = new Map<string, string>()
  const fallbackNamesByIdentity = new Map<string, string>()
  const refIdentityBySource = new Map<string, string>()
  const typeAliases: ExternalSchemaTypeAlias[] = []

  for (const node of schemaNodes) {
    refIdentityBySource.set(sourceRefKey(node.sourceFilePath, node.sourcePointer), refIdentity(node))
  }

  for (const node of unsupportedPointerNodes) {
    const baseName = schemaNameFromNode(node)
    fallbackNamesByIdentity.set(refIdentity(node), 'unknown')
    if (node.sourceFilePath === basePath) refNameOverrides[node.ref] = 'unknown'
    refNameOverrides[refIdentity(node)] = 'unknown'
    diagnostics.push(toUnsupportedPointerDiagnostic(node, baseName))
  }

  for (const node of resolvedSchemaNodes) {
    const baseName = schemaNameFromNode(node)
    if (!baseName) continue

    const collidesWithExternal = (refsByName.get(baseName)?.length ?? 0) > 1
    const shadowsLocal = localNames.has(baseName)
    const shadowsOperation = operationNames.has(baseName)
    const preferredName = collidesWithExternal || shadowsLocal || shadowsOperation
      ? `${pascalCase(fileStemFromNode(node))}${baseName}`
      : baseName
    const generatedName = uniqueTypeName(preferredName, usedNames)
    usedNames.add(generatedName)
    resolvedNamesByIdentity.set(refIdentity(node), generatedName)

    if (shadowsLocal) {
      diagnostics.push({
        code: 'external-schema-shadows-local',
        name: baseName,
        ref: node.ref,
        generatedName,
        ...(node.sourceFilePath ? { sourceFilePath: node.sourceFilePath } : {}),
        sourcePointer: node.sourcePointer,
        ...(node.filePath ? { filePath: node.filePath } : {}),
        ...(node.pointer ? { pointer: node.pointer } : {}),
        message: `외부 스키마 이름이 로컬 component와 충돌: ${baseName} (${formatExternalTarget(node)} -> ${generatedName}). ${generatedName} 타입명으로 생성합니다.`,
      })
    }

    if (shadowsOperation) {
      diagnostics.push({
        code: 'external-schema-shadows-operation',
        name: baseName,
        ref: node.ref,
        generatedName,
        ...(node.sourceFilePath ? { sourceFilePath: node.sourceFilePath } : {}),
        sourcePointer: node.sourcePointer,
        ...(node.filePath ? { filePath: node.filePath } : {}),
        ...(node.pointer ? { pointer: node.pointer } : {}),
        message: `외부 스키마 이름이 operation 생성 타입과 충돌: ${baseName} (${formatExternalTarget(node)} -> ${generatedName}). ${generatedName} 타입명으로 생성합니다.`,
      })
    }
  }

  for (const [name, groupRefs] of refsByName) {
    if (groupRefs.length <= 1) continue
    const renamedRefs = resolvedSchemaNodes
      .filter(node => schemaNameFromNode(node) === name)
      .map(node => `${formatExternalTarget(node)} -> ${resolvedNamesByIdentity.get(refIdentity(node)) ?? schemaNameFromNode(node)}`)
      .sort()
    diagnostics.push({
      code: 'external-schema-name-collision',
      name,
      refs: groupRefs,
      message: `외부 스키마 이름 충돌: ${name} (${renamedRefs.join(', ')}). 파일명 기반 타입명으로 생성합니다.`,
    })
  }

  const refTypesByIdentity = new Map([...resolvedNamesByIdentity, ...fallbackNamesByIdentity])
  for (const node of schemaNodes) {
    if (unsupportedPointerIdentities.has(refIdentity(node))) continue
    const baseName = schemaNameFromNode(node)
    const generatedName = resolvedNamesByIdentity.get(refIdentity(node))
    if (!baseName) continue

    if (generatedName && isSchemaObject(node.target)) {
      refNameOverrides[refIdentity(node)] = generatedName
      if (node.sourceFilePath === basePath) refNameOverrides[node.ref] = generatedName
      typeAliases.push(toExternalSchemaTypeAlias(node, generatedName, baseName))
      schemas[generatedName] = rewriteSchemaRefs(
        node.target as OasSchema,
        node.filePath ?? node.sourceFilePath,
        node.pointer,
        refIdentityBySource,
        refTypesByIdentity,
      )
      continue
    }

    diagnostics.push(toExternalSchemaDiagnostic(
      node,
      baseName,
      findDiagnosticForNode(graph.diagnostics, node),
    ))
  }

  return { schemas, refNameOverrides, diagnostics, typeAliases }
}

function isSchemaRefNode(node: RefGraphNodeWithSource): boolean {
  if (!isSchemaRefSourcePointer(node.sourcePointer)) return false
  if (node.kind === 'external') return isRelativeRef(node.ref)
  return !!node.filePath && (node.ref === '#' || node.ref.startsWith('#/'))
}

function isSchemaRefSourcePointer(sourcePointer: string): boolean {
  if (!sourcePointer.endsWith('/$ref')) return false
  const schemaPointer = sourcePointer.slice(0, -'/$ref'.length)
  const segments = schemaPointer
    .slice(2)
    .split('/')
    .map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'))

  return segments.some(segment => SCHEMA_REF_CONTEXT_SEGMENTS.has(segment))
}

function emptyExternalSchemaAnalysis(): ExternalSchemaRefAnalysis {
  return { schemas: {}, refNameOverrides: {}, diagnostics: [], typeAliases: [] }
}

const SCHEMA_REF_CONTEXT_SEGMENTS = new Set([
  '$defs',
  'additionalProperties',
  'allOf',
  'anyOf',
  'dependentSchemas',
  'else',
  'if',
  'items',
  'not',
  'oneOf',
  'patternProperties',
  'prefixItems',
  'properties',
  'schema',
  'schemas',
  'then',
  'unevaluatedProperties',
])

const NON_SCHEMA_OAS_ROOT_SEGMENTS = new Set([
  'components',
  'externalDocs',
  'info',
  'jsonSchemaDialect',
  'openapi',
  'paths',
  'security',
  'servers',
  'tags',
  'webhooks',
])

function collectGeneratedOperationTypeNames(spec: OasDocument): Set<string> {
  const names = new Set<string>()
  const doc = parseDocument(spec, [])
  const operationNames = createOperationTypeNameMap([...doc.operations, ...doc.webhooks])
  for (const op of [...doc.operations, ...doc.webhooks]) {
    if (!op.operationId) continue
    const baseName = operationNames.get(op.operationId)!
    const pathParams = op.parameters.filter(p => p.in === 'path')
    if (pathParams.length > 0) names.add(`${baseName}PathParams`)
    const queryParams = op.parameters.filter(p => p.in === 'query')
    if (queryParams.length > 0) names.add(`${baseName}QueryParams`)
    if (hasJsonRequestBodySchema(op.requestBody)) names.add(`${baseName}Body`)
    if (hasSuccessJsonResponseSchema(op.responses)) names.add(`${baseName}Response`)
    if (hasSuccessResponseHeaders(op.responses)) names.add(`${baseName}ResponseHeaders`)
    if (hasSuccessResponseLinks(op.responses)) names.add(`${baseName}ResponseLinks`)
    if (hasJsonResponseSchema(op.responses, /^[45]\d{2}$/) || hasDefaultJsonResponseSchema(op.responses)) names.add(`${baseName}Error`)
    names.add(`${baseName}Op`)
  }
  return names
}

function hasJsonRequestBodySchema(body: OasRequestBody | undefined): boolean {
  if (!body) return false
  const jsonContent = body.content?.['application/json']
  return !!jsonContent && !('$ref' in jsonContent) && !!jsonContent.schema
}

function hasJsonResponseSchema(responses: Record<string, OasResponse>, statusPattern: RegExp): boolean {
  return Object.entries(responses).some(([status, response]) => {
    if (!statusPattern.test(status) || !response?.content) return false
    const jsonContent = response.content['application/json']
    return !!jsonContent && !('$ref' in jsonContent) && !!jsonContent.schema
  })
}

function hasSuccessJsonResponseSchema(responses: Record<string, OasResponse>): boolean {
  const response = pickSuccessResponse(responses)
  if (!response?.content) return false
  const jsonContent = response.content['application/json']
  return !!jsonContent && !('$ref' in jsonContent) && !!jsonContent.schema
}

function hasDefaultJsonResponseSchema(responses: Record<string, OasResponse>): boolean {
  const response = responses.default
  if (!response?.content) return false
  const jsonContent = response.content['application/json']
  return !!jsonContent && !('$ref' in jsonContent) && !!jsonContent.schema
}

function hasSuccessResponseHeaders(responses: Record<string, OasResponse>): boolean {
  const response = pickSuccessResponse(responses)
  return !!response?.headers
    && Object.values(response.headers).some(header => !('$ref' in header))
}

function hasSuccessResponseLinks(responses: Record<string, OasResponse>): boolean {
  const response = pickSuccessResponse(responses)
  return !!response?.links
    && Object.values(response.links).some(link => !('$ref' in link))
}

function isSupportedExternalSchemaPointer(pointer: string | undefined): boolean {
  const segments = pointerSegments(pointer)
  if (segments.length === 0) return false
  if (segments[0] === 'components') return segments[1] === 'schemas' && segments.length >= 3
  if (segments[0] === '$defs') return segments.length >= 2
  if (NON_SCHEMA_OAS_ROOT_SEGMENTS.has(segments[0] ?? '')) return false
  return segments.length >= 2
}

function schemaNameFromNode(node: { ref: string; pointer?: string }): string | undefined {
  return schemaNameFromPointer(node.pointer ?? node.ref)
}

function schemaNameFromPointer(ref: string): string | undefined {
  const segments = pointerSegments(ref)
  const rawName = segments.at(-1)
  if (!rawName) return undefined
  return normalizeTypeName(rawName)
}

function pointerSegments(ref: string | undefined): string[] {
  if (!ref || ref === '#') return []
  const pointerStart = ref.indexOf('#/')
  const pointer = pointerStart >= 0 ? ref.slice(pointerStart + 2) : ref.startsWith('/') ? ref.slice(1) : ''
  if (!pointer) return []
  return pointer.split('/').map(decodePointerSegment)
}

function decodePointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~')
}

function normalizeTypeName(segment: string): string | undefined {
  const pascalName = pascalCase(segment)
  const identifier = pascalName.replace(/[^A-Za-z0-9_$]/g, '')
  if (!identifier) return undefined
  return /^[A-Za-z_$]/.test(identifier) ? identifier : `Schema${identifier}`
}

function findDiagnosticForNode(
  diagnostics: RefGraphDiagnostic[],
  node: RefGraphNodeWithSource,
): RefGraphDiagnosticWithSource | undefined {
  const identity = refIdentity(node)
  return (diagnostics as RefGraphDiagnosticWithSource[]).find(diagnostic =>
    refIdentity(diagnostic) === identity
    && (diagnostic.sourcePointer ?? node.sourcePointer) === node.sourcePointer
  )
}

function toExternalSchemaDiagnostic(
  node: RefGraphNodeWithSource,
  baseName: string,
  resolverDiagnostic?: RefGraphDiagnosticWithSource,
): ExternalSchemaRefDiagnostic {
  const sourceFilePath = resolverDiagnostic?.sourceFilePath ?? node.sourceFilePath
  const sourcePointer = resolverDiagnostic?.sourcePointer ?? node.sourcePointer
  const filePath = resolverDiagnostic?.filePath ?? node.filePath
  const pointer = resolverDiagnostic?.pointer ?? node.pointer

  return {
    code: resolverDiagnostic?.code ?? 'external-schema-unresolved',
    name: baseName,
    ref: node.ref,
    message: resolverDiagnostic?.message ?? `외부 스키마를 해소할 수 없습니다: ${node.ref}`,
    ...(sourceFilePath ? { sourceFilePath } : {}),
    sourcePointer,
    ...(filePath ? { filePath } : {}),
    ...(pointer ? { pointer } : {}),
  }
}

function toUnsupportedPointerDiagnostic(
  node: RefGraphNodeWithSource,
  baseName: string | undefined,
): ExternalSchemaRefDiagnostic {
  return {
    code: 'external-schema-unsupported-pointer',
    ...(baseName ? { name: baseName } : {}),
    ref: node.ref,
    ...(node.sourceFilePath ? { sourceFilePath: node.sourceFilePath } : {}),
    sourcePointer: node.sourcePointer,
    ...(node.filePath ? { filePath: node.filePath } : {}),
    ...(node.pointer ? { pointer: node.pointer } : {}),
    message: `지원하지 않는 외부 스키마 pointer입니다: ${formatExternalTarget(node)}. Schema Object alias 대상은 #/components/schemas/*, #/$defs/*, 또는 top-level custom schema root의 항목이어야 하며 unknown으로 생성합니다.`,
  }
}

function toExternalSchemaTypeAlias(
  node: RefGraphNodeWithSource,
  aliasName: string,
  baseName: string,
): ExternalSchemaTypeAlias {
  return {
    ...(node.sourceFilePath ? { sourceFilePath: node.sourceFilePath } : {}),
    sourcePointer: node.sourcePointer,
    ref: node.ref,
    aliasName,
    contentHash: hashJson(node.target),
    ...(aliasName !== baseName ? { renamedFrom: baseName } : {}),
    ...(node.filePath ? { filePath: node.filePath } : {}),
    ...(node.pointer ? { pointer: node.pointer } : {}),
  }
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortJson(value))).digest('hex')
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortJson((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}

function rewriteSchemaRefs(
  schema: OasSchema,
  sourceFilePath: string | undefined,
  rootPointer: string | undefined,
  refIdentityBySource: Map<string, string>,
  resolvedNamesByIdentity: Map<string, string>,
): OasSchema {
  return rewriteRefsAt(
    schema,
    sourceFilePath,
    rootPointer ?? '#',
    refIdentityBySource,
    resolvedNamesByIdentity,
  ) as OasSchema
}

function rewriteRefsAt(
  value: unknown,
  sourceFilePath: string | undefined,
  currentPointer: string,
  refIdentityBySource: Map<string, string>,
  resolvedNamesByIdentity: Map<string, string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => rewriteRefsAt(
      item,
      sourceFilePath,
      `${currentPointer}/${index}`,
      refIdentityBySource,
      resolvedNamesByIdentity,
    ))
  }

  if (!value || typeof value !== 'object') return value

  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    const childPointer = `${currentPointer}/${escapePointerSegment(key)}`
    if (key === '$ref' && typeof child === 'string') {
      const identity = refIdentityBySource.get(sourceRefKey(sourceFilePath, childPointer))
      result[key] = identity && resolvedNamesByIdentity.has(identity) ? identity : child
      continue
    }
    result[key] = rewriteRefsAt(
      child,
      sourceFilePath,
      childPointer,
      refIdentityBySource,
      resolvedNamesByIdentity,
    )
  }
  return result
}

function sourceRefKey(sourceFilePath: string | undefined, sourcePointer: string): string {
  return `${sourceFilePath ?? '<entry>'}|${sourcePointer}`
}

function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1')
}

function groupRefsBySchemaName(refs: Array<{ ref: string; filePath?: string; pointer?: string }>): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const node of refs) {
    const name = schemaNameFromNode(node)
    if (!name) continue
    const list = groups.get(name) ?? []
    list.push(refIdentity(node))
    groups.set(name, list)
  }
  return groups
}

function fileStemFromNode(node: { ref: string; filePath?: string }): string {
  const [filePart] = (node.filePath ?? node.ref).split('#')
  if (!filePart) return 'External'
  const fileName = basename(filePart)
  return fileName.slice(0, fileName.length - extname(fileName).length) || 'External'
}

function formatExternalTarget(node: { ref: string; filePath?: string; pointer?: string }): string {
  return refIdentity(node)
}

function refIdentity(node: { ref: string; filePath?: string; pointer?: string }): string {
  return node.filePath ? `${node.filePath}${node.pointer ?? node.ref}` : node.ref
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
