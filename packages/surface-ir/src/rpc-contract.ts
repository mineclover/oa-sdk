import type {
  CompleteParsedDocument,
  HttpMethod,
  OasMediaType,
  OasParameter,
  OasResponse,
  OasSchema,
  OperationEntry,
  ParsedDocument,
} from '@oa-sdk/parser'
import { unescapeJsonPointerToken } from '@oa-sdk/parser/browser'
import { sha256, stableStringify } from './hash.js'
import {
  buildSurfaceIr,
  type SurfaceDiagnostic,
  type SurfaceIr,
  type SurfaceIrOptions,
  type SurfaceOperation,
} from './index.js'

export const RPC_CONTRACT_VERSION = 'oa-sdk.rpc-contract.v1' as const

/** OpenAPI extension written by the `@rpc` decorator of `@oa-sdk/typespec-decorators`. */
export const RPC_OPERATION_EXTENSION = 'x-oa-sdk-rpc' as const

export type RpcProcedureKind = 'query' | 'mutation'

export type RpcParameterLocation = 'path' | 'query' | 'querystring' | 'header' | 'cookie'

/** Where one input field travels when the procedure is called over its HTTP route. */
export type RpcParameterBinding = {
  /** Input field name (the OpenAPI parameter name). */
  field: string
  in: RpcParameterLocation
  required: boolean
  style?: string
  explode?: boolean
  allowReserved?: boolean
  /** Media type of a `content`-based parameter; its value is serialized with it instead of `style`. */
  contentType?: string
}

/**
 * Request body placement inside the input object.
 * - `spread`: the body object's properties are input fields; every input field that is not a
 *   parameter belongs to the body.
 * - `field`: the whole body is the value of one input field.
 */
export type RpcBodyBinding =
  | { mode: 'spread'; mediaType: string; required: boolean }
  | { mode: 'field'; field: string; mediaType: string; required: boolean }

export type RpcHttpBinding = {
  method: HttpMethod
  path: string
  parameters: RpcParameterBinding[]
  body?: RpcBodyBinding
  success: { status: number; mediaType?: string }
}

export type RpcErrorResponse = {
  description?: string
  mediaType?: string
  schema?: OasSchema
}

export type RpcProcedure = {
  /** Dotted procedure name, e.g. `users.getUserById`. */
  name: string
  /** `name` split into segments: the client and handler object path. */
  path: string[]
  operationId: string
  kind: RpcProcedureKind
  summary?: string
  description?: string
  deprecated?: true
  /** Object schema of the call input: parameters and the request body merged. */
  input: OasSchema
  /** Schema of the success result; `null` when the success response has no content. */
  output: OasSchema | null
  /** Declared non-success responses keyed by status code (`404`, `4XX`, `default`). */
  errors: Record<string, RpcErrorResponse>
  http: RpcHttpBinding
}

export type RpcContract = {
  schemaVersion: typeof RPC_CONTRACT_VERSION
  info: { title: string; version: string }
  procedures: Record<string, RpcProcedure>
  /** `components.schemas` of the source document, for `#/components/schemas/*` references left in schemas. */
  schemas: Record<string, OasSchema>
  diagnostics: SurfaceDiagnostic[]
  versionHash: string
}

export type RpcContractOptions = {
  /** Input field that holds a request body which is not spread. Default: `body`. */
  bodyField?: string
  /**
   * `auto` (default) spreads a plain object body into the input when its properties do not collide
   * with parameter names; `field` always places the body under `bodyField`.
   */
  bodyMode?: 'auto' | 'field'
  /** Keep only the operations this returns `true` for. */
  include?: (operation: OperationEntry) => boolean
}

export type BuildRpcContractOptions = SurfaceIrOptions & RpcContractOptions

type RpcOperationExtension = {
  methodName?: string
  serviceName?: string
  streaming?: string
}

const QUERY_METHODS = new Set<HttpMethod>(['get', 'head', 'query', 'options'])

/**
 * Builds an RPC contract from a parsed OpenAPI document (for oa-sdk, the artifact compiled from
 * TypeSpec). Procedure names default to `x-oa-sdk-rpc` (`@rpc`) service and method names, then to the
 * camel-cased first tag and the operationId; surface options override both.
 */
export function buildRpcContract(
  document: ParsedDocument | CompleteParsedDocument,
  options: BuildRpcContractOptions = {},
): RpcContract {
  const surface = buildSurfaceIr(document, {
    ...options,
    groupForOperation: options.groupForOperation ?? rpcGroupForOperation,
    methodForOperation: options.methodForOperation ?? rpcMethodForOperation,
  })
  return toRpcContract(surface, document, options)
}

/** Projects an existing surface IR onto an RPC contract. */
export function toRpcContract(
  ir: SurfaceIr,
  document: ParsedDocument,
  options: RpcContractOptions = {},
): RpcContract {
  const diagnostics: SurfaceDiagnostic[] = [...ir.diagnostics]
  const procedures: Record<string, RpcProcedure> = {}
  const entries = new Map<string, OperationEntry>()
  for (const operation of document.operations) {
    if (operation.operationId !== undefined) entries.set(operation.operationId, operation)
  }

  for (const surfaceOperation of Object.values(ir.operations)) {
    const operation = entries.get(surfaceOperation.operationId)
    if (!operation) continue
    if (surfaceOperation.projection.visibility.ignored === true) continue
    if (options.include && !options.include(operation)) continue

    const procedure = projectProcedure(surfaceOperation, operation, document, options, diagnostics)
    if (procedure) procedures[procedure.name] = procedure
  }

  removeNamespaceConflicts(procedures, diagnostics)

  const schemas = { ...document.schemas }
  const info = { title: document.info.title, version: document.info.version }
  const versionHash = sha256(stableStringify({
    schemaVersion: RPC_CONTRACT_VERSION,
    info,
    procedures,
    schemas,
  }))

  return {
    schemaVersion: RPC_CONTRACT_VERSION,
    info,
    procedures,
    schemas,
    diagnostics,
    versionHash,
  }
}

function projectProcedure(
  surfaceOperation: SurfaceOperation,
  operation: OperationEntry,
  document: ParsedDocument,
  options: RpcContractOptions,
  diagnostics: SurfaceDiagnostic[],
): RpcProcedure | undefined {
  const { operationId } = surfaceOperation
  const pointer = surfaceOperation.provenance.openapiPointer
  const path = [...surfaceOperation.projection.groupPath, surfaceOperation.projection.methodName]
  const name = path.join('.')

  if (path.some(segment => segment.length === 0 || segment.includes('.'))) {
    diagnostics.push({
      severity: 'error',
      code: 'rpc-contract/invalid-procedure-name',
      message: `Procedure name segments of ${operationId} must be non-empty and contain no ".": ${JSON.stringify(path)}.`,
      operationId,
      pointer,
    })
    return undefined
  }

  const rpcStreaming = readRpcExtension(operation)?.streaming
  const streamingMediaType = surfaceOperation.runtime.streaming?.mediaType
  if (streamingMediaType !== undefined || (rpcStreaming !== undefined && rpcStreaming !== 'none')) {
    diagnostics.push({
      severity: 'warning',
      code: 'rpc-contract/streaming-not-supported',
      message: `Procedure ${name} streams (${streamingMediaType ?? rpcStreaming}); unary RPC contracts skip it.`,
      operationId,
      pointer,
    })
    return undefined
  }

  const input = buildInput(operation, document, options, name, diagnostics, pointer)
  if (!input) return undefined
  const response = buildResponses(operation, name, diagnostics, pointer)

  return {
    name,
    path,
    operationId,
    kind: QUERY_METHODS.has(operation.method) ? 'query' : 'mutation',
    ...(operation.summary === undefined ? {} : { summary: operation.summary }),
    ...(operation.description === undefined ? {} : { description: operation.description }),
    ...(operation.deprecated ? { deprecated: true as const } : {}),
    input: input.schema,
    output: response.output,
    errors: response.errors,
    http: {
      method: operation.method,
      path: operation.openApiPath,
      parameters: input.parameters,
      ...(input.body === undefined ? {} : { body: input.body }),
      success: response.success,
    },
  }
}

type InputProjection = {
  schema: OasSchema
  parameters: RpcParameterBinding[]
  body?: RpcBodyBinding
}

function buildInput(
  operation: OperationEntry,
  document: ParsedDocument,
  options: RpcContractOptions,
  name: string,
  diagnostics: SurfaceDiagnostic[],
  pointer: string,
): InputProjection | undefined {
  const properties: Record<string, OasSchema> = {}
  const required: string[] = []
  const parameters: RpcParameterBinding[] = []
  const collision = (field: string): undefined => {
    diagnostics.push({
      severity: 'error',
      code: 'rpc-contract/field-collision',
      message: `Procedure ${name} maps more than one parameter or body to the input field "${field}".`,
      ...(operation.operationId === undefined ? {} : { operationId: operation.operationId }),
      pointer,
    })
    return undefined
  }

  for (const parameter of operation.parameters) {
    if (isIgnoredHeader(parameter)) continue
    if (Object.hasOwn(properties, parameter.name)) return collision(parameter.name)
    const binding = parameterBinding(parameter)
    properties[parameter.name] = parameterSchema(parameter)
    if (binding.required) required.push(parameter.name)
    parameters.push(binding)
  }

  let body: RpcBodyBinding | undefined
  let additionalProperties: OasSchema | boolean | undefined = false
  const requestBody = operation.requestBody
  const bodyMedia = requestBody ? pickMediaType(requestBody.content) : undefined
  if (requestBody && bodyMedia) {
    const bodyRequired = requestBody.required === true
    const bodySchema = bodyMedia.media.schema ?? {}
    const flat = options.bodyMode === 'field' ? undefined : flattenObjectSchema(bodySchema, document)
    const spreadable = flat !== undefined
      && Object.keys(flat.properties).every(field => !Object.hasOwn(properties, field))
      && (bodyRequired || flat.required.length === 0)

    if (flat && spreadable) {
      Object.assign(properties, flat.properties)
      required.push(...flat.required)
      additionalProperties = flat.additionalProperties
      body = { mode: 'spread', mediaType: bodyMedia.mediaType, required: bodyRequired }
    } else {
      const field = options.bodyField ?? 'body'
      if (Object.hasOwn(properties, field)) return collision(field)
      properties[field] = bodySchema
      if (bodyRequired) required.push(field)
      body = { mode: 'field', field, mediaType: bodyMedia.mediaType, required: bodyRequired }
    }
  }

  const schema: OasSchema = {
    type: 'object',
    properties,
    ...(required.length === 0 ? {} : { required }),
    ...(additionalProperties === undefined ? {} : { additionalProperties }),
  }
  return { schema, parameters, ...(body === undefined ? {} : { body }) }
}

/** OpenAPI ignores header parameters named Accept, Content-Type, or Authorization. */
const IGNORED_HEADER_PARAMETERS = new Set(['accept', 'content-type', 'authorization'])

function isIgnoredHeader(parameter: OasParameter): boolean {
  return parameter.in === 'header' && IGNORED_HEADER_PARAMETERS.has(parameter.name.toLowerCase())
}

function parameterBinding(parameter: OasParameter): RpcParameterBinding {
  const contentMedia = parameter.content ? pickMediaType(parameter.content) : undefined
  return {
    field: parameter.name,
    in: parameter.in,
    required: parameter.in === 'path' || parameter.required === true,
    ...(parameter.style === undefined ? {} : { style: parameter.style }),
    ...(parameter.explode === undefined ? {} : { explode: parameter.explode }),
    ...(parameter.allowReserved === undefined ? {} : { allowReserved: parameter.allowReserved }),
    ...(contentMedia === undefined ? {} : { contentType: contentMedia.mediaType }),
  }
}

function parameterSchema(parameter: OasParameter): OasSchema {
  const contentSchema = parameter.content ? pickMediaType(parameter.content)?.media.schema : undefined
  const schema: OasSchema = { ...(parameter.schema ?? contentSchema ?? {}) }
  if (parameter.description !== undefined && schema.description === undefined) {
    schema.description = parameter.description
  }
  if (parameter.deprecated === true) schema.deprecated = true
  return schema
}

type ResponseProjection = {
  output: OasSchema | null
  errors: Record<string, RpcErrorResponse>
  success: RpcHttpBinding['success']
}

function buildResponses(
  operation: OperationEntry,
  name: string,
  diagnostics: SurfaceDiagnostic[],
  pointer: string,
): ResponseProjection {
  const successKeys = Object.keys(operation.responses)
    .filter(isSuccessStatus)
    .sort((left, right) => statusOrder(left) - statusOrder(right))
  const errors: Record<string, RpcErrorResponse> = {}
  for (const [status, response] of Object.entries(operation.responses)) {
    if (isSuccessStatus(status)) continue
    errors[status] = errorResponse(response)
  }

  if (successKeys.length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'rpc-contract/no-success-response',
      message: `Procedure ${name} declares no 2xx response; its output is untyped.`,
      ...(operation.operationId === undefined ? {} : { operationId: operation.operationId }),
      pointer,
    })
    return { output: {}, errors, success: { status: 200 } }
  }

  for (const status of successKeys) {
    const media = pickMediaType(operation.responses[status]?.content)
    if (!media) continue
    return {
      output: media.media.schema ?? {},
      errors,
      success: { status: statusCode(status), mediaType: media.mediaType },
    }
  }
  return { output: null, errors, success: { status: statusCode(successKeys[0]!) } }
}

function errorResponse(response: OasResponse): RpcErrorResponse {
  const media = pickMediaType(response.content)
  return {
    ...(response.description === undefined ? {} : { description: response.description }),
    ...(media === undefined ? {} : { mediaType: media.mediaType }),
    ...(media?.media.schema === undefined ? {} : { schema: media.media.schema }),
  }
}

function isSuccessStatus(status: string): boolean {
  return /^2(?:\d\d|XX)$/i.test(status)
}

function statusOrder(status: string): number {
  return /^\d+$/.test(status) ? Number(status) : 300
}

function statusCode(status: string): number {
  return /^\d+$/.test(status) ? Number(status) : 200
}

/** Prefers `application/json`, then any `+json` type, then the first declared media type. */
function pickMediaType(
  content: Record<string, unknown> | undefined,
): { mediaType: string; media: OasMediaType } | undefined {
  if (!content) return undefined
  const mediaTypes = Object.keys(content)
  const mediaType = mediaTypes.find(type => type === 'application/json')
    ?? mediaTypes.find(type => /\+json$/i.test(type))
    ?? mediaTypes[0]
  if (mediaType === undefined) return undefined
  const media = content[mediaType]
  return { mediaType, media: isRecord(media) ? media as OasMediaType : {} }
}

type FlatObject = {
  properties: Record<string, OasSchema>
  required: string[]
  additionalProperties: OasSchema | boolean | undefined
}

/** Keywords that keep an object schema equivalent to its properties when spread into the input. */
const SPREADABLE_KEYWORDS = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'allOf',
  'title', 'description', 'deprecated', 'examples', 'example', 'externalDocs',
  'readOnly', 'writeOnly', '$comment', '$schema', 'xml',
])

/**
 * Flattens a plain object schema (optionally an `allOf` of plain object schemas) into its
 * properties. Returns `undefined` for anything whose validation the flat form would change.
 */
function flattenObjectSchema(
  schema: OasSchema,
  document: ParsedDocument,
  seen: ReadonlySet<string> = new Set(),
): FlatObject | undefined {
  const ref = schema.$ref
  if (typeof ref === 'string') {
    const keys = Object.keys(schema).filter(key => key !== '$ref' && key !== 'description' && key !== 'summary')
    const target = resolveComponentSchema(ref, document)
    if (keys.length > 0 || !target || seen.has(ref)) return undefined
    return flattenObjectSchema(target, document, new Set([...seen, ref]))
  }

  for (const key of Object.keys(schema)) {
    if (!SPREADABLE_KEYWORDS.has(key) && !key.startsWith('x-')) return undefined
  }
  const type = schema.type
  if (type !== undefined && type !== 'object') return undefined
  if (type === undefined && schema.properties === undefined && schema.allOf === undefined) return undefined

  const parts: FlatObject[] = [{
    properties: { ...(schema.properties ?? {}) },
    required: [...(schema.required ?? [])],
    additionalProperties: schema.additionalProperties,
  }]
  for (const member of schema.allOf ?? []) {
    const flat = flattenObjectSchema(member, document, seen)
    if (!flat) return undefined
    parts.push(flat)
  }
  // additionalProperties of one allOf member does not see the other members' properties.
  if (parts.length > 1 && parts.some(part => part.additionalProperties !== undefined)) return undefined

  const properties: Record<string, OasSchema> = {}
  const required = new Set<string>()
  for (const part of parts) {
    for (const [field, fieldSchema] of Object.entries(part.properties)) {
      const existing = properties[field]
      if (existing !== undefined && stableStringify(existing) !== stableStringify(fieldSchema)) return undefined
      properties[field] = fieldSchema
    }
    for (const field of part.required) required.add(field)
  }
  return { properties, required: [...required], additionalProperties: parts[0]!.additionalProperties }
}

function resolveComponentSchema(ref: string, document: ParsedDocument): OasSchema | undefined {
  const match = ref.match(/^#\/components\/schemas\/(.+)$/)
  if (!match?.[1]) return undefined
  return document.schemas[unescapeJsonPointerToken(match[1])]
}

/** Removes procedures whose name is also the group of other procedures: one key cannot be both. */
function removeNamespaceConflicts(
  procedures: Record<string, RpcProcedure>,
  diagnostics: SurfaceDiagnostic[],
): void {
  const groups = new Set<string>()
  for (const procedure of Object.values(procedures)) {
    for (let length = 1; length < procedure.path.length; length++) {
      groups.add(procedure.path.slice(0, length).join('.'))
    }
  }
  for (const procedure of Object.values(procedures)) {
    if (!groups.has(procedure.name)) continue
    delete procedures[procedure.name]
    diagnostics.push({
      severity: 'error',
      code: 'rpc-contract/namespace-conflict',
      message: `Procedure ${procedure.name} is also the group of other procedures; it is skipped. Rename one of them.`,
      operationId: procedure.operationId,
    })
  }
}

function readRpcExtension(operation: OperationEntry): RpcOperationExtension | undefined {
  const value = operation[RPC_OPERATION_EXTENSION]
  return isRecord(value) ? value as RpcOperationExtension : undefined
}

function rpcGroupForOperation(operation: OperationEntry): readonly string[] {
  const serviceName = readRpcExtension(operation)?.serviceName
  if (typeof serviceName === 'string' && serviceName.length > 0) return [serviceName]
  const tag = operation.tags[0]
  return tag === undefined ? [] : [camelCase(tag)]
}

function rpcMethodForOperation(operation: OperationEntry): string {
  const methodName = readRpcExtension(operation)?.methodName
  if (typeof methodName === 'string' && methodName.length > 0) return methodName
  return operation.operationId ?? ''
}

function camelCase(value: string): string {
  const words = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(word => word.length > 0)
  return words
    .map((word, index) => index === 0
      ? word.charAt(0).toLowerCase() + word.slice(1)
      : word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
