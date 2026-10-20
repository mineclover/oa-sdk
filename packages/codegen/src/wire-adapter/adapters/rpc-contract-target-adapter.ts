/**
 * RPC Service Contract Target Adapter
 *
 * Generates RPC service contracts over the binary wire formats of the TypeSpec SSOT:
 * - Server handler interfaces for backend implementations (Fastify / Hono / Express / Elysia)
 * - A typed client per service that fills the declared route from path, query, header, and cookie
 *   parameters, and encodes and decodes Protobuf / MessagePack messages with the `BinaryCodecAdapter`s
 *   it is given (JSON bodies need no codec)
 *
 * Model types are imported under the names `types.ts` declares (`Inventory.Widget` is
 * `InventoryWidget`); codecs are still looked up by component name.
 *
 * For JSON contracts called as dotted-name procedures over JSON-RPC 2.0 or REST, use `pluginRpc`
 * and `@oa-sdk/rpc` instead.
 *
 * @oa-sdk/codegen
 */

import { quoteTypeScriptString, toTypeScriptIdentifier } from '@oa-sdk/core/browser'
import { formatJSDoc } from '../../typegen/jsdoc.js'
import { emptyMessageName } from '../proto-identifiers.js'
import type { TypeSpecWireTargetAdapter } from '../wire-adapter-types.js'
import type { WireMethod, WireParameter, WireSchemaModel, WireService } from '../wire-schema-model.js'
import { wireTypeNames } from '../wire-type-names.js'

export interface RpcContractAdapterOptions {
  readonly typesImport?: string | undefined
  /** Module the `BinaryCodecAdapter` type is imported from. Default: `@oa-sdk/client`. */
  readonly clientImport?: string | undefined
}

const NUMERIC_WIRE_TYPES = new Set([
  'int32', 'int64', 'uint32', 'uint64', 'sint32', 'sint64',
  'fixed32', 'fixed64', 'sfixed32', 'sfixed64', 'float', 'double',
])

/**
 * Shared runtime helpers, emitted once per module. Written without template literals so the
 * source can live in a raw string.
 */
const RUNTIME_HELPERS = String.raw`/** Error of a failed RPC call: the HTTP status and the decoded error body. */
export class WireRpcError extends Error {
  readonly method: string
  readonly status: number
  readonly body: unknown

  constructor(method: string, status: number, statusText: string, body: unknown) {
    super('RPC call ' + method + ' failed with status ' + status + (statusText ? ' ' + statusText : ''))
    this.name = 'WireRpcError'
    this.method = method
    this.status = status
    this.body = body
  }
}

/** Model name to codec maps, such as getGeneratedProtobufCodecs() and getGeneratedMessagePackCodecs(). */
export type WireRpcCodecs = Record<string, BinaryCodecAdapter<any>> | readonly Record<string, BinaryCodecAdapter<any>>[]

export interface WireRpcCallOptions {
  headers?: Record<string, string>
  signal?: AbortSignal
}

interface WireRpcRequest {
  method: string
  httpMethod: string
  path: string
  query: string[]
  headers: Record<string, string>
  body?: unknown
  requestType?: string
  requestMediaType?: string
  responseType?: string
  responseMediaType?: string
  hasOutput: boolean
}

function __rpcMediaEssence(mediaType: string): string {
  return mediaType.split(';')[0]!.trim().toLowerCase()
}

function __rpcIsJson(mediaType: string): boolean {
  const essence = __rpcMediaEssence(mediaType)
  return essence === 'application/json' || essence.endsWith('+json')
}

function __rpcScalar(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object' && value !== null) return JSON.stringify(value)
  return String(value)
}

function __rpcPathSegment(method: string, name: string, value: unknown): string {
  if (value === undefined || value === null) {
    throw new TypeError('RPC call ' + method + ' is missing path parameter "' + name + '"')
  }
  const segment = Array.isArray(value)
    ? value.map(item => encodeURIComponent(__rpcScalar(item))).join(',')
    : encodeURIComponent(__rpcScalar(value))
  // Each would call another route: an empty segment (an empty string or array) leaves the
  // parent path, and URL resolution walks dot segments.
  if (segment === '' || segment === '.' || segment === '..') {
    const shown = segment === '' ? 'an empty value' : '"' + segment + '"'
    throw new TypeError('RPC call ' + method + ' cannot use ' + shown + ' as path parameter "' + name + '"')
  }
  return segment
}

function __rpcQuery(query: string[], name: string, value: unknown): void {
  if (value === undefined || value === null) return
  for (const item of Array.isArray(value) ? value : [value]) {
    query.push(encodeURIComponent(name) + '=' + encodeURIComponent(__rpcScalar(item)))
  }
}

function __rpcHeaderValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  return Array.isArray(value) ? value.map(__rpcScalar).join(',') : __rpcScalar(value)
}

function __rpcFindCodec(
  codecs: readonly Record<string, BinaryCodecAdapter<any>>[],
  typeName: string | undefined,
  mediaType: string,
): BinaryCodecAdapter<any> | undefined {
  if (typeName === undefined) return undefined
  const essence = __rpcMediaEssence(mediaType)
  for (const map of codecs) {
    const codec = Object.prototype.hasOwnProperty.call(map, typeName) ? map[typeName] : undefined
    if (codec && (codec.mediaTypes.length === 0 || codec.mediaTypes.some(type => __rpcMediaEssence(type) === essence))) {
      return codec
    }
  }
  return undefined
}

function __rpcIsBinaryBody(value: unknown): boolean {
  return typeof value === 'string' || value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value)
}

async function __rpcEncodeBody(
  request: WireRpcRequest,
  codecs: readonly Record<string, BinaryCodecAdapter<any>>[],
): Promise<BodyInit> {
  const mediaType = request.requestMediaType!
  if (__rpcIsJson(mediaType)) return JSON.stringify(request.body)
  const codec = __rpcFindCodec(codecs, request.requestType, mediaType)
  if (codec) return await codec.encode(request.body, mediaType) as BodyInit
  if (__rpcMediaEssence(mediaType).startsWith('text/')) return __rpcScalar(request.body)
  if (__rpcIsBinaryBody(request.body)) return request.body as BodyInit
  throw new TypeError('RPC call ' + request.method + ' needs a codec for ' + (request.requestType ?? 'its request') + ' (' + mediaType + ')')
}

async function __rpcDecodeBody(
  request: WireRpcRequest,
  response: Response,
  codecs: readonly Record<string, BinaryCodecAdapter<any>>[],
): Promise<unknown> {
  const mediaType = response.headers.get('content-type') ?? request.responseMediaType ?? ''
  if (__rpcIsJson(mediaType)) {
    const text = await response.text()
    return text === '' ? undefined : JSON.parse(text)
  }
  if (__rpcMediaEssence(mediaType).startsWith('text/')) return await response.text()
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength === 0) return undefined
  const codec = __rpcFindCodec(codecs, request.responseType, mediaType)
  if (codec) return await codec.decode(bytes, mediaType)
  if (request.responseType !== undefined && mediaType !== '') {
    throw new TypeError('RPC call ' + request.method + ' needs a codec for ' + request.responseType + ' (' + mediaType + ')')
  }
  return bytes
}

async function __rpcReadError(request: WireRpcRequest, response: Response): Promise<WireRpcError> {
  let body: unknown
  try {
    const text = await response.text()
    body = text !== '' && __rpcIsJson(response.headers.get('content-type') ?? '') ? JSON.parse(text) : text || undefined
  } catch {
    body = undefined
  }
  return new WireRpcError(request.method, response.status, response.statusText, body)
}

/** Shared transport of the generated service clients. */
export class WireRpcClientBase {
  protected readonly baseUrl: string
  protected readonly defaultHeaders: Record<string, string>
  protected readonly fetchImpl: typeof globalThis.fetch
  protected readonly codecs: readonly Record<string, BinaryCodecAdapter<any>>[]

  constructor(options: {
    baseUrl: string
    headers?: Record<string, string> | undefined
    codecs?: WireRpcCodecs | undefined
    fetch?: typeof globalThis.fetch | undefined
  }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.defaultHeaders = options.headers ?? {}
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
    const codecs = options.codecs ?? []
    this.codecs = Array.isArray(codecs) ? codecs : [codecs as Record<string, BinaryCodecAdapter<any>>]
  }

  protected async send<T>(request: WireRpcRequest, options?: WireRpcCallOptions): Promise<T> {
    const headers: Record<string, string> = { ...this.defaultHeaders, ...request.headers }
    let body: BodyInit | undefined
    if (request.body !== undefined && request.requestMediaType) {
      body = await __rpcEncodeBody(request, this.codecs)
      headers['Content-Type'] = request.requestMediaType
    }
    if (request.responseMediaType) headers['Accept'] = request.responseMediaType
    Object.assign(headers, options?.headers)

    const query = request.query.join('&')
    const response = await this.fetchImpl(this.baseUrl + request.path + (query === '' ? '' : '?' + query), {
      method: request.httpMethod,
      headers,
      ...(body === undefined ? {} : { body }),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    })
    if (!response.ok) throw await __rpcReadError(request, response)
    if (!request.hasOutput || response.status === 204 || response.status === 205) return undefined as T
    return await __rpcDecodeBody(request, response, this.codecs) as T
  }
}`

export class RpcContractTargetAdapter implements TypeSpecWireTargetAdapter<string, RpcContractAdapterOptions> {
  public readonly id = 'rpc-contract'
  public readonly name = 'RPC Service Contract Target Adapter'
  public readonly target = 'rpc'
  public readonly fileExtension = '.ts'

  transform(model: WireSchemaModel, options: RpcContractAdapterOptions = {}): string {
    const lines: string[] = []
    const modelNames = new Set(model.models.map(m => m.name))
    const typeNames = wireTypeNames(model)
    const empty = emptyMessageName(model)

    lines.push('// Auto-generated RPC Service Contracts & Client from TypeSpec SSOT.')
    lines.push('// @oa-sdk/codegen RpcContractTargetAdapter')
    lines.push('')
    lines.push(`import type { BinaryCodecAdapter } from ${quoteTypeScriptString(options.clientImport ?? '@oa-sdk/client')}`)
    if (options.typesImport && modelNames.size > 0) {
      lines.push(`import type { ${[...modelNames].map(name => typeNames.get(name) ?? name).join(', ')} } from ${quoteTypeScriptString(options.typesImport)}`)
    }
    lines.push('')
    lines.push(RUNTIME_HELPERS)
    lines.push('')

    for (const svc of model.services) {
      const types: TypeContext = { model, modelNames, typeNames, empty, typed: Boolean(options.typesImport) }
      lines.push(...this.renderParamsTypes(svc, types))
      lines.push(...this.renderServerHandlers(svc, types))
      lines.push('')
      lines.push(...this.renderClient(svc, types))
      lines.push('')
    }

    return lines.join('\n').trimEnd() + '\n'
  }

  private renderParamsTypes(svc: WireService, types: TypeContext): string[] {
    const lines: string[] = []
    for (const m of svc.methods) {
      const parameters = m.parameters ?? []
      if (parameters.length === 0) continue
      lines.push(`export interface ${paramsTypeName(svc, m)} {`)
      for (const parameter of parameters) {
        if (parameter.doc) lines.push(formatJSDoc(parameter.doc, '  '))
        lines.push(`  ${quoteTypeScriptString(parameter.name)}${parameter.required ? '' : '?'}: ${parameterType(parameter, types)}`)
      }
      lines.push('}')
      lines.push('')
    }
    return lines
  }

  private renderServerHandlers(svc: WireService, types: TypeContext): string[] {
    const lines: string[] = []
    const name = serviceName(svc)

    if (svc.doc) lines.push(formatJSDoc(svc.doc))
    lines.push(`export interface ${name}ServerHandlers<TContext = unknown> {`)
    for (const m of svc.methods) {
      if (m.doc) lines.push(formatJSDoc(m.doc, '  '))
      const input = inputType(m, types)
      const output = outputType(m, types)
      const params = (m.parameters ?? []).length > 0 ? `, params: ${paramsTypeName(svc, m)}` : ''
      lines.push(`  ${methodIdentifier(m)}(request: ${input}, context: TContext${params}): Promise<${output}> | ${output}`)
    }
    lines.push('}')
    lines.push('')
    lines.push(`export type ${name}Handler<TContext = unknown> = ${name}ServerHandlers<TContext>`)
    return lines
  }

  private renderClient(svc: WireService, types: TypeContext): string[] {
    const lines: string[] = []
    const name = serviceName(svc)

    lines.push(`export interface ${name}RpcClientOptions {`)
    lines.push('  readonly baseUrl: string')
    lines.push('  readonly headers?: Record<string, string> | undefined')
    lines.push('  /** Codecs for the binary wire messages, keyed by model name. */')
    lines.push('  readonly codecs?: WireRpcCodecs | undefined')
    lines.push('  readonly fetch?: typeof globalThis.fetch | undefined')
    lines.push('}')
    lines.push('')
    lines.push(`export class ${name}RpcClient extends WireRpcClientBase {`)
    lines.push(`  constructor(options: ${name}RpcClientOptions) {`)
    lines.push('    super(options)')
    lines.push('  }')

    for (const m of svc.methods) {
      lines.push('')
      lines.push(...this.renderClientMethod(svc, m, types))
    }

    lines.push('}')
    return lines
  }

  private renderClientMethod(svc: WireService, m: WireMethod, types: TypeContext): string[] {
    const lines: string[] = []
    const parameters = m.parameters ?? []
    const hasBody = m.requestBody !== undefined
    const paramsOptional = parameters.every(parameter => !parameter.required)
    const args: string[] = []
    if (hasBody) args.push(`request: ${inputType(m, types)}`)
    if (parameters.length > 0) args.push(`params${paramsOptional ? '?' : ''}: ${paramsTypeName(svc, m)}`)
    args.push('options?: WireRpcCallOptions')
    const output = outputType(m, types)
    const rpcName = quoteTypeScriptString(`${serviceName(svc)}.${m.name}`)
    const params = parameters.length > 0 ? (paramsOptional ? '(params ?? {})' : 'params') : undefined

    if (m.doc) lines.push(formatJSDoc(m.doc, '  '))
    lines.push(`  async ${methodIdentifier(m)}(${args.join(', ')}): Promise<${output}> {`)
    lines.push(`    const method = ${rpcName}`)
    if (params) lines.push(`    const p = ${params}`)
    lines.push('    const query: string[] = []')
    lines.push('    const headers: Record<string, string> = {}')
    const cookies = parameters.filter(parameter => parameter.in === 'cookie')
    if (cookies.length > 0) lines.push('    const cookies: string[] = []')
    for (const parameter of parameters) {
      const access = `p[${quoteTypeScriptString(parameter.name)}]`
      if (parameter.in === 'query') {
        lines.push(`    __rpcQuery(query, ${quoteTypeScriptString(parameter.name)}, ${access})`)
      } else if (parameter.in === 'header') {
        lines.push(`    { const value = __rpcHeaderValue(${access}); if (value !== undefined) headers[${quoteTypeScriptString(parameter.name)}] = value }`)
      } else if (parameter.in === 'cookie') {
        lines.push(`    { const value = __rpcHeaderValue(${access}); if (value !== undefined) cookies.push(${quoteTypeScriptString(`${parameter.name}=`)} + encodeURIComponent(value)) }`)
      }
    }
    if (cookies.length > 0) lines.push("    if (cookies.length > 0) headers['Cookie'] = cookies.join('; ')")

    const success = m.response
    const responseType = success?.typeName !== undefined && types.modelNames.has(success.typeName) ? success.typeName : undefined
    const requestType = m.requestBody?.typeName !== undefined && types.modelNames.has(m.requestBody.typeName) ? m.requestBody.typeName : undefined
    lines.push('    return this.send<' + output + '>({')
    lines.push('      method,')
    lines.push(`      httpMethod: ${quoteTypeScriptString(m.httpMethod ?? 'POST')},`)
    lines.push(`      path: ${pathExpression(m, svc)},`)
    lines.push('      query,')
    lines.push('      headers,')
    if (hasBody) {
      lines.push('      body: request,')
      lines.push(`      requestMediaType: ${quoteTypeScriptString(m.requestBody!.mediaType)},`)
      if (requestType) lines.push(`      requestType: ${quoteTypeScriptString(requestType)},`)
    }
    if (success?.mediaType) lines.push(`      responseMediaType: ${quoteTypeScriptString(success.mediaType)},`)
    if (responseType) lines.push(`      responseType: ${quoteTypeScriptString(responseType)},`)
    lines.push(`      hasOutput: ${output !== 'void'},`)
    lines.push('    }, options)')
    lines.push('  }')
    return lines
  }
}

type TypeContext = {
  model: WireSchemaModel
  modelNames: ReadonlySet<string>
  /** Component name to TypeScript declaration name. */
  typeNames: ReadonlyMap<string, string>
  /** Name of the empty message, the `inputType`/`outputType` of a method without one. */
  empty: string
  /** Whether model types are imported; without them, model references are typed `unknown`. */
  typed: boolean
}

function serviceName(svc: WireService): string {
  return toTypeScriptIdentifier(svc.serviceName ?? svc.name)
}

function methodIdentifier(m: WireMethod): string {
  const identifier = toTypeScriptIdentifier(m.name)
  return identifier.charAt(0).toLowerCase() + identifier.slice(1)
}

function paramsTypeName(svc: WireService, m: WireMethod): string {
  const identifier = toTypeScriptIdentifier(m.name)
  return `${serviceName(svc)}${identifier.charAt(0).toUpperCase()}${identifier.slice(1)}Params`
}

function modelType(typeName: string | undefined, types: TypeContext): string {
  if (typeName === undefined) return 'unknown'
  const enumType = types.model.enums.find(e => e.name === typeName)
  if (enumType) return enumUnion(enumType.values ?? enumType.members.map(member => member.name))
  return types.typed && types.modelNames.has(typeName) ? types.typeNames.get(typeName) ?? typeName : 'unknown'
}

function inputType(m: WireMethod, types: TypeContext): string {
  if (m.requestBody === undefined) return m.inputType === types.empty ? 'void' : modelType(m.inputType, types)
  return modelType(m.requestBody.typeName, types)
}

function outputType(m: WireMethod, types: TypeContext): string {
  if (m.response === undefined) return m.outputType === types.empty ? 'void' : modelType(m.outputType, types)
  if (m.response.mediaType === '') return 'void'
  return modelType(m.response.typeName, types)
}

function parameterType(parameter: WireParameter, types: TypeContext): string {
  const enumType = types.model.enums.find(e => e.name === parameter.type)
  const base = enumType
    ? enumUnion(enumType.values ?? enumType.members.map(member => member.name))
    : NUMERIC_WIRE_TYPES.has(parameter.type)
      ? 'number'
      : parameter.type === 'bool'
        ? 'boolean'
        : 'string'
  return parameter.repeated ? `Array<${base}>` : base
}

function enumUnion(values: readonly string[]): string {
  return values.length === 0 ? 'string' : values.map(value => quoteTypeScriptString(value)).join(' | ')
}

/** Route as a concatenation of quoted literals and encoded path parameters. */
function pathExpression(m: WireMethod, svc: WireService): string {
  const route = m.route ?? `/${svc.name.toLowerCase()}/${m.name.toLowerCase()}`
  const parts = route.split(/(\{[^}]+\})/).filter(part => part !== '').map(part => {
    const name = part.match(/^\{([^}]+)\}$/)?.[1]
    return name === undefined
      ? quoteTypeScriptString(part)
      : `__rpcPathSegment(method, ${quoteTypeScriptString(name)}, p[${quoteTypeScriptString(name)}])`
  })
  return parts.length === 0 ? "''" : parts.join(' + ')
}
