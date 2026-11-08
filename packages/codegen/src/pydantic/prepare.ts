/**
 * S1 — prepare. Shares the preflight with the Zod generator (`prepareCodegenDocument`).
 */
import { parseDocument, type LintResult, type OasDocument, type OasSchema, type OperationEntry } from '@oa-sdk/parser'
import { prepareCodegenDocument } from '../schema-graph/index.js'
import type { PydanticDiagnostic } from './ir.js'
import type { ResolvedPydanticBuildOptions } from './options.js'

export interface PreparedPydanticDocument {
  document: OasDocument
  schemas: Record<string, OasSchema>
  /** Sorted, reference-resolved path operations. Empty when the document has no paths. */
  operations: OperationEntry[]
  webhooks: OperationEntry[]
  /** Inline operation schemas included in S2 graph analysis. */
  operationSchemas: Record<string, OasSchema>
  operationParameterPointers: Record<string, string>
  /** Preflight findings that did not stop generation (all of them when `force` is set), as `pydantic/preflight`. */
  diagnostics: PydanticDiagnostic[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const record = (value: unknown): Record<string, unknown> => isRecord(value) ? value : {}

function collectInlineOperationSchemas(operations: OperationEntry[]): Record<string, OasSchema> {
  const result: Record<string, OasSchema> = {}
  const seen = new WeakSet<object>()
  const add = (operation: OperationEntry, role: string, schema: unknown): void => {
    if (!isRecord(schema) || typeof schema.$ref === 'string') return
    // Operation graph keys contain `/`, which component schema names cannot contain; this keeps
    // inline declarations distinguishable without a synthetic sort prefix.
    const key = `operation/${operation.method.toLowerCase()}_${operation.openApiPath}/${role}`
    if (seen.has(schema)) return
    seen.add(schema)
    if (schema.properties !== undefined || schema.type === 'object' || schema.allOf !== undefined) result[key] = schema as OasSchema
    for (const [property, child] of Object.entries(isRecord(schema.properties) ? schema.properties : {})) add(operation, `${role}/property/${property}`, child)
    if (isRecord(schema.items)) add(operation, `${role}/items`, schema.items)
    for (const key of ['allOf', 'oneOf', 'anyOf', 'prefixItems']) {
      const branches = schema[key]
      if (Array.isArray(branches)) branches.forEach((branch, index) => add(operation, `${role}/${key}/${index}`, branch))
    }
  }
  for (const operation of operations) {
    for (const parameter of operation.parameters) add(operation, `parameter/${parameter.in}/${parameter.name}`, parameter.schema)
    for (const [mediaType, media] of Object.entries(operation.requestBody?.content ?? {})) {
      if (isRecord(media)) add(operation, `request/${mediaType}`, record(media).schema)
    }
    for (const [status, response] of Object.entries(operation.responses)) {
      for (const [mediaType, media] of Object.entries(response.content ?? {})) {
        if (isRecord(media)) add(operation, `response/${status}/${mediaType}`, record(media).schema)
      }
      for (const [headerName, header] of Object.entries(response.headers ?? {})) {
        if (isRecord(header)) add(operation, `response-header/${status}/${headerName}`, record(header).schema)
      }
    }
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)))
}

function resolveLocalComponent(value: unknown, document: OasDocument): unknown {
  if (!isRecord(value) || typeof value.$ref !== 'string' || !value.$ref.startsWith('#/components/')) return value
  const parts = value.$ref.slice('#/components/'.length).split('/')
  const bucketName = parts[0]
  const targetName = parts[1]
  if (bucketName === undefined || targetName === undefined) return value
  const bucket = document.components?.[bucketName as keyof NonNullable<OasDocument['components']>]
  const target = isRecord(bucket) ? bucket[targetName] : undefined
  if (!isRecord(target)) return value
  return { ...target, ...('description' in value ? { description: value.description } : {}), ...('summary' in value ? { summary: value.summary } : {}) }
}

function resolveOperationComponents(operation: OperationEntry, document: OasDocument): OperationEntry {
  const resolveContent = (content: unknown): Record<string, unknown> => {
    const output: Record<string, unknown> = {}
    for (const [mediaType, media] of Object.entries(isRecord(content) ? content : {})) output[mediaType] = resolveLocalComponent(media, document)
    return output
  }
  const parameters = operation.parameters.map(parameter => ({
    ...parameter,
    ...(parameter.content === undefined ? {} : { content: resolveContent(parameter.content) as typeof parameter.content }),
  }))
  const rawRequestBody = operation.requestBody === undefined ? undefined : resolveLocalComponent(operation.requestBody, document)
  const requestBody = isRecord(rawRequestBody)
    ? { ...rawRequestBody, content: resolveContent(rawRequestBody.content) } as OperationEntry['requestBody']
    : undefined
  const responses: OperationEntry['responses'] = {}
  for (const [status, rawResponse] of Object.entries(operation.responses)) {
    const response = resolveLocalComponent(rawResponse, document)
    if (!isRecord(response)) continue
    const headers: Record<string, unknown> = {}
    for (const [name, header] of Object.entries(response.headers ?? {})) headers[name] = resolveLocalComponent(header, document)
    responses[status] = {
      ...response,
      ...(response.content === undefined ? {} : { content: resolveContent(response.content) }),
      headers,
    } as OperationEntry['responses'][string]
  }
  return { ...operation, parameters, ...(requestBody === undefined ? {} : { requestBody }), responses }
}

function operationParameterPointers(document: OasDocument, operations: OperationEntry[]): Record<string, string> {
  const output: Record<string, string> = {}
  const paths = document.paths ?? {}
  for (const operation of operations) {
    const pathItem = paths[operation.openApiPath]
    if (!isRecord(pathItem)) continue
    const resolvedPathItem = resolveLocalComponent(pathItem, document)
    if (!isRecord(resolvedPathItem)) continue
    const pathParameters = Array.isArray(resolvedPathItem.parameters) ? resolvedPathItem.parameters : []
    const methodValue = resolvedPathItem[operation.method]
    const operationParameters = isRecord(methodValue) && Array.isArray(methodValue.parameters) ? methodValue.parameters : []
    const key = (parameter: unknown): string | undefined => {
      const resolved = resolveLocalComponent(parameter, document)
      if (!isRecord(resolved) || typeof resolved.name !== 'string' || typeof resolved.in !== 'string') return undefined
      return `${resolved.in}:${resolved.name}`
    }
    pathParameters.forEach((parameter, index) => {
      const parameterKey = key(parameter)
      if (parameterKey !== undefined) output[`${operation.method}:${operation.openApiPath}:${parameterKey}`] = `/paths/${escapePointer(operation.openApiPath)}/parameters/${index}`
    })
    operationParameters.forEach((parameter, index) => {
      const parameterKey = key(parameter)
      if (parameterKey !== undefined) output[`${operation.method}:${operation.openApiPath}:${parameterKey}`] = `/paths/${escapePointer(operation.openApiPath)}/${escapePointer(operation.method)}/parameters/${index}`
    })
  }
  return output
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

export class PydanticGenerationPreflightError extends Error {
  readonly diagnostics: LintResult[]

  constructor(diagnostics: LintResult[]) {
    const lines = diagnostics.map(d => `  - [${d.severity.toUpperCase()}] [${d.rule}] ${d.message} (at ${d.path})`)
    const count = `${diagnostics.length} issue(s)`
    const summary = `Pydantic code generation aborted due to preflight validation failure (${count})`
    super(`${summary}:\n${lines.join('\n')}`)
    this.name = 'PydanticGenerationPreflightError'
    this.diagnostics = diagnostics
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function preparePydanticDocument(
  doc: unknown,
  preflight: ResolvedPydanticBuildOptions['preflight'],
): PreparedPydanticDocument {
  const { force, ...codegenPreflight } = preflight
  const prepared = prepareCodegenDocument(doc, codegenPreflight)
  if (prepared.fatal.length > 0 && !force) throw new PydanticGenerationPreflightError(prepared.fatal)

  const parsed = parseDocument(prepared.document, [])
  const operations = parsed.operations.map(operation => resolveOperationComponents(operation, prepared.document)).sort((left, right) => {
    const path = left.openApiPath.localeCompare(right.openApiPath)
    return path !== 0 ? path : left.method.localeCompare(right.method)
  })
  const operationSchemas = collectInlineOperationSchemas(operations)

  return {
    document: prepared.document,
    schemas: prepared.schemas,
    operations,
    webhooks: parsed.webhooks,
    operationSchemas,
    operationParameterPointers: operationParameterPointers(prepared.document, operations),
    diagnostics: prepared.diagnostics.map(d => ({
      code: 'pydantic/preflight',
      severity: d.severity,
      pointer: d.path,
      message: `[${d.rule}] ${d.message}`,
    })),
  }
}
