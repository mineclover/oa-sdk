import {
  createOperationTypeNameMap,
  formatGeneratedTs,
  pascalCase,
  quoteTypeScriptString,
  toOperationMethodName,
  toTypeScriptIdentifier,
} from '@oa-sdk/core'
import { PREDEFINED_TYPE_NAMES, RESERVED_BINDING_NAMES, isIdentifierName } from '../identifiers.js'
import {
  parseDocument,
  type OasDocument,
  type OasMediaType,
  type OasReference,
  type OasResponse,
  type ParsedDocument,
} from '@oa-sdk/parser'

export interface RenderClientOptions {
  /** OpenAPI Document */
  document: OasDocument
  /** Pre-parsed document IR (optional) */
  parsed?: ParsedDocument | undefined
  /** Output file relative path. Default: 'client.ts' */
  output?: string | undefined
  /**
   * Underlying HTTP transport engine: 'fetch' or 'axios'. Default: 'fetch'.
   * Both read a response body as text and parse it the same way (empty: undefined, JSON: the parsed
   * value, other text: the string); 'axios' requests `responseType: 'text'` for that.
   */
  httpClient?: 'fetch' | 'axios' | undefined
  /** Module specifier for importing types emitted by pluginTypescript. Default: './types.js' */
  typesFile?: string | undefined
  /** Base URL embedded in default client instance */
  baseUrl?: string | undefined
  /** Export standalone functions. Default: true */
  standalone?: boolean | undefined
  /**
   * Export the central Client class, the createClient factory and the default-client accessors. Default: true.
   * When false, the transport class still exists inside the module (the standalone functions need it) but is
   * not exported, and per-call `client` overrides are not part of RequestOptions.
   */
  clientClass?: boolean | undefined
  /** Client class name. Default: 'Client' */
  clientName?: string | undefined
}

/**
 * Per-operation facts about the emitted standalone function, published so that downstream
 * plugins (e.g. pluginTanstackQuery) can call the SDK without re-deriving its naming rules.
 */
export interface RenderedClientOperation {
  /** Source operationId (undefined when the operation has none) */
  operationId?: string | undefined
  /** Lower-case HTTP method */
  method: string
  /** OpenAPI path template */
  path: string
  /** Operation type-name base shared with pluginTypescript (e.g. 'PetsGetPetById') */
  baseName: string
  /**
   * Exported standalone function named after the full operationId (e.g. 'petsGetPetById').
   * It is always exported, either as the primary function or as an alias of the short name.
   * A name that cannot be declared (a reserved word such as the root-level `delete`, a name the client
   * module declares itself such as `createClient`, a global the module refers to such as `fetch`, or
   * another operation's function name) gets a trailing `_` (then `_2`, ...): 'delete_', 'fetch_'.
   */
  functionName: string
  /**
   * Primary exported function name: the short name (e.g. 'getPetById') when no other operation shares
   * it and it can be declared (not a reserved word such as `delete`, a name the module declares or a
   * global it refers to), otherwise {@link functionName}.
   */
  primaryFunctionName: string
  hasPathParams: boolean
  hasQueryParams: boolean
  hasHeaderParams: boolean
  /** Whether the function accepts a JSON `body` field */
  hasBody: boolean
  /** Whether the function's `data` is the typed `${baseName}Response` (otherwise `void`) */
  hasSuccessResponse: boolean
}

export interface RenderClientResult {
  code: string
  exports: string[]
  /** Operations with an emitted standalone function (empty when `standalone` is false) */
  operations: RenderedClientOperation[]
}

interface NormalizedOperation {
  operationId?: string | undefined
  method: string
  openApiPath: string
  baseName: string
  primaryFnName: string
  aliasFnName?: string | undefined
  prefixedFnName: string
  primaryDataName: string
  aliasDataName?: string | undefined
  summary?: string | undefined
  description?: string | undefined
  hasPathParams: boolean
  hasQueryParams: boolean
  hasHeaderParams: boolean
  hasBody: boolean
  isBodyRequired: boolean
  hasSuccessResponse: boolean
  hasErrorResponse: boolean
  isDataRequired: boolean
}

function isReference(value: object): value is OasReference {
  return '$ref' in value && typeof value.$ref === 'string'
}

/**
 * Whether a request body / response declares an inline `application/json` media type with a schema.
 *
 * This mirrors the rule pluginTypescript (typegen) uses to decide whether it emits the
 * `${baseName}Body` / `${baseName}Response` / `${baseName}Error` aliases, so the client never
 * imports a type that types.ts does not declare.
 */
function hasJsonSchemaContent(
  bodyOrResponse?: { content?: Record<string, OasMediaType | OasReference> | undefined },
): boolean {
  const media = bodyOrResponse?.content?.['application/json']
  if (!media || isReference(media)) return false
  return media.schema !== undefined
}

/** Same success-response selection as typegen: the lowest explicit 2xx code, else `default`. */
function pickSuccessResponse(responses: Record<string, OasResponse>): OasResponse | undefined {
  const codes = Object.keys(responses).filter(code => /^2\d{2}$/.test(code)).sort()
  return responses[codes[0] ?? 'default']
}

/** Same error-response selection as typegen: explicit 4xx/5xx codes and `default` with a JSON schema. */
function hasErrorResponseJson(responses: Record<string, OasResponse>): boolean {
  return Object.keys(responses)
    .filter(code => /^[45]\d{2}$/.test(code) || code === 'default')
    .some(code => hasJsonSchemaContent(responses[code]))
}

/**
 * Globals the generated module's code refers to, across both transports and every option: value
 * references such as `Object.entries(...)`, `new Response(...)` and `globalThis.fetch`, the `typeof fetch`
 * type query of the fetch transport's ClientConfig, and value-capable globals named in type positions
 * (`Promise`, `AbortSignal`). A module-scope declaration with one of these names would shadow the global
 * in the whole module: an operation function named `fetch` would turn `typeof fetch` into its own type.
 *
 * Operation function names start with a lower-case letter, so only the lower-case entries can collide
 * today; the list is nonetheless the complete set, so the guarantee does not rest on that naming rule.
 * The test "reserves every global and module binding the emitted client module refers to" (plugin-client.test.ts)
 * derives the referenced globals and the module's bindings from the emitted module with the TypeScript
 * checker, for every transport and clientClass setting, and fails when the reserved set misses one or
 * holds a name no setting refers to.
 */
const REFERENCED_GLOBAL_NAMES: readonly string[] = [
  'AbortSignal', 'Array', 'DOMException', 'Error', 'Headers', 'JSON', 'Object', 'Promise', 'RegExp',
  'Response', 'String', 'URLSearchParams', 'encodeURIComponent', 'fetch', 'globalThis', 'undefined',
]

/**
 * Global types the generated module names in type positions (`Promise<...>`, `Record<...>`, `RequestInit`, ...),
 * across both transports and every option. A module-scope type declaration with one of these names would
 * replace the global type in the whole module.
 *
 * The test "reserves every global type and type binding the emitted client module refers to" (plugin-client.test.ts)
 * derives them with the TypeScript checker and fails when this list misses one or holds a name no setting refers to.
 */
const REFERENCED_GLOBAL_TYPE_NAMES: readonly string[] = [
  'AbortSignal', 'Exclude', 'Extract', 'Omit', 'Parameters', 'Promise', 'Record', 'RequestInit', 'Response',
]

/** Value bindings the generated module declares besides the client class and the operation functions. */
const MODULE_VALUE_NAMES: readonly string[] = [
  'createClient', 'defaultClient', 'getDefaultClient', 'setDefaultClient', 'client',
  'isErrorStatus', 'serializeHeaderValue', 'parseResponseText',
]

/** Helper types the generated module declares besides the client class and the per-operation types. */
const MODULE_TYPE_NAMES: readonly string[] = [
  'RequestParameters', 'RequestOptions', 'KnownErrorStatus', 'ClientResult', 'ClientResponse', 'ErrorUnion',
  'ErrorStatusResult', 'ClientConfig',
]

/**
 * Names the generated module binds in a nested scope where it refers to the client class: the `TData` and
 * `TError` type parameters of RequestOptions and of the verb methods (`Parameters<Client['request']>`), and
 * the `config` parameter of createClient (`new Client(config)`). A class named like one of them would be
 * shadowed there, so `clientName` must not be one of them.
 *
 * The test "rejects every clientName the generated module cannot declare" (plugin-client.test.ts) derives these
 * names with the TypeScript checker, for every transport and clientClass setting.
 */
export const CLIENT_CLASS_SCOPE_NAMES: readonly string[] = ['TData', 'TError', 'config']

/**
 * Module-scope value names an operation function must not declare: the bindings the generated module
 * declares itself (exported or module-private) and {@link REFERENCED_GLOBAL_NAMES}, which a declaration
 * would shadow. The set is the same whatever the `httpClient`, `clientClass` and `standalone` settings, so
 * toggling one never renames a function. It does not contain the reserved words, which
 * {@link escapeBindingName} rejects on its own.
 */
export function clientModuleScopeValueNames(clientName: string): ReadonlySet<string> {
  return new Set([clientName, ...MODULE_VALUE_NAMES, ...REFERENCED_GLOBAL_NAMES])
}

/**
 * Module-scope type names an operation type must not take: the types the generated module declares itself
 * (the client class and the helpers such as `ClientResponse`, exported or module-private) and
 * {@link REFERENCED_GLOBAL_TYPE_NAMES}, which a declaration would replace. Like
 * {@link clientModuleScopeValueNames}, the set does not depend on the other settings.
 */
export function clientModuleScopeTypeNames(clientName: string): ReadonlySet<string> {
  return new Set([clientName, ...MODULE_TYPE_NAMES, ...REFERENCED_GLOBAL_TYPE_NAMES])
}

/**
 * Explains why `clientName` cannot name the generated client class, or returns undefined when it can.
 *
 * The class is a module-scope value and type that the module refers to by name, so the name must be an
 * identifier that is neither a reserved word nor a predefined type name, must not be another binding the
 * module declares (value or type) or a global it refers to (value or type), and must not be one of the
 * {@link CLIENT_CLASS_SCOPE_NAMES} that would shadow it where the module refers to it. Operation names
 * never collide with it: operation functions and types that would are escaped instead.
 */
export function clientNameIssue(clientName: string): string | undefined {
  const subject = `clientName ${JSON.stringify(clientName)}`
  if (!isIdentifierName(clientName)) return `${subject} is not an identifier`
  if (RESERVED_BINDING_NAMES.has(clientName)) return `${subject} is a reserved word`
  if (PREDEFINED_TYPE_NAMES.has(clientName)) return `${subject} is a TypeScript predefined type name`
  if (MODULE_VALUE_NAMES.includes(clientName) || MODULE_TYPE_NAMES.includes(clientName)) {
    return `${subject} collides with the \`${clientName}\` that the generated client module declares`
  }
  if (REFERENCED_GLOBAL_NAMES.includes(clientName) || REFERENCED_GLOBAL_TYPE_NAMES.includes(clientName)) {
    return `${subject} would shadow the global \`${clientName}\` that the generated client module refers to`
  }
  if (CLIENT_CLASS_SCOPE_NAMES.includes(clientName)) {
    return `${subject} would be shadowed by the \`${clientName}\` that the generated client module binds where it refers to the client class`
  }
  return undefined
}

/**
 * Returns `name`, or `name` with a trailing `_` (then `_2`, `_3`, ...) when it is a reserved word or
 * in `taken`. The `_` suffix keeps `pascalCase(name)` (the base of the function's type aliases) intact.
 */
function escapeBindingName(name: string, taken: ReadonlySet<string>): string {
  if (!RESERVED_BINDING_NAMES.has(name) && !taken.has(name)) return name
  let candidate = `${name}_`
  for (let index = 2; taken.has(candidate); index++) candidate = `${name}_${index}`
  return candidate
}

/**
 * Allocates the module-scope names of the per-operation types. A conventional name (`ClientResponse`) maps to
 * itself, or to its escaped form (`ClientResponse_`, then `ClientResponse_2`, ...) when it is in `reserved` or
 * already allocated; the same conventional name always maps to the same name, and no two map to one.
 */
function createTypeNameAllocator(reserved: ReadonlySet<string>): (name: string) => string {
  const taken = new Set(reserved)
  const allocated = new Map<string, string>()
  return name => {
    let local = allocated.get(name)
    if (local === undefined) {
      local = escapeBindingName(name, taken)
      taken.add(local)
      allocated.set(name, local)
    }
    return local
  }
}

function shortOperationName(op: { operationId?: string | undefined; method: string; openApiPath: string }): string {
  const rawId = op.operationId
  if (rawId && rawId.includes('_')) {
    const parts = rawId.split('_')
    return parts[parts.length - 1] ?? ''
  }
  if (rawId) return rawId
  return `${op.method}_${op.openApiPath.replace(/[{}/]/g, '_')}`
}

/**
 * Normalizes all operations across paths and webhooks in the document.
 *
 * Every operation gets a function named after its full operationId (`prefixedFnName`), escaped by
 * {@link escapeBindingName} when that is a reserved word, a name in `moduleNames`, or the name of an
 * earlier operation's function. Its short name (the part after the last `_`) becomes the primary
 * function, with the prefixed name as an alias, only when no other operation shares it, it is not
 * reserved or a module name, and no operation's prefixed function has that name.
 */
function normalizeOperations(
  parsedDoc: ParsedDocument,
  moduleNames: ReadonlySet<string>,
): NormalizedOperation[] {
  const rawOps = parsedDoc.operations
  const operationNames = createOperationTypeNameMap(rawOps)

  // First pass: allocate the prefixed function names, which are always emitted.
  const takenFnNames = new Set(moduleNames)
  const namedOps = rawOps.map(op => {
    const baseName = op.operationId
      ? (operationNames.get(op.operationId) ?? toTypeScriptIdentifier(op.operationId))
      : toTypeScriptIdentifier(`${op.method}_${op.openApiPath.replace(/[{}/]/g, '_')}`)
    const prefixedFnName = escapeBindingName(toOperationMethodName(baseName), takenFnNames)
    takenFnNames.add(prefixedFnName)
    const shortFnName = toOperationMethodName(toTypeScriptIdentifier(shortOperationName(op)))
    return { op, baseName, prefixedFnName, shortFnName }
  })

  // Count short function names to detect collisions across namespaces
  const shortNameCounts = new Map<string, number>()
  for (const { shortFnName } of namedOps) {
    shortNameCounts.set(shortFnName, (shortNameCounts.get(shortFnName) ?? 0) + 1)
  }

  const results: NormalizedOperation[] = []

  for (const { op, baseName, prefixedFnName, shortFnName } of namedOps) {
    // The short name is the primary function name when it is unique across all operations and
    // usable as a binding that no prefixed function name already takes.
    const isShortUsable = shortFnName !== prefixedFnName
      && (shortNameCounts.get(shortFnName) ?? 0) === 1
      && !RESERVED_BINDING_NAMES.has(shortFnName)
      && !takenFnNames.has(shortFnName)
    const primaryFnName = isShortUsable ? shortFnName : prefixedFnName
    const aliasFnName = isShortUsable ? prefixedFnName : undefined

    const primaryDataName = `${pascalCase(primaryFnName)}Data`
    const aliasDataName = `${baseName}Data`

    const pathParams = op.parameters.filter(p => p.in === 'path')
    const queryParams = op.parameters.filter(p => p.in === 'query')
    const headerParams = op.parameters.filter(p => p.in === 'header')

    const hasPathParams = pathParams.length > 0
    const hasQueryParams = queryParams.length > 0
    const hasHeaderParams = headerParams.length > 0

    const hasBody = op.requestBody !== undefined && hasJsonSchemaContent(op.requestBody)
    const isBodyRequired = op.requestBody?.required === true

    const responses = op.responses ?? {}
    const hasSuccessResponse = hasJsonSchemaContent(pickSuccessResponse(responses))
    const hasErrorResponse = hasErrorResponseJson(responses)

    const isDataRequired =
      hasPathParams ||
      (hasBody && isBodyRequired) ||
      queryParams.some(p => p.required === true)

    results.push({
      operationId: op.operationId,
      method: op.method.toLowerCase(),
      openApiPath: op.openApiPath,
      baseName,
      primaryFnName,
      aliasFnName,
      prefixedFnName,
      primaryDataName,
      aliasDataName: primaryDataName !== aliasDataName ? aliasDataName : undefined,
      summary: op.summary,
      description: op.description,
      hasPathParams,
      hasQueryParams,
      hasHeaderParams,
      hasBody,
      isBodyRequired,
      hasSuccessResponse,
      hasErrorResponse,
      isDataRequired,
    })
  }

  return results
}

/**
 * Shared request-option shape of the generated transport's `request()` method.
 * Every optional field also accepts `undefined` so the generated module compiles under
 * `exactOptionalPropertyTypes`.
 */
const REQUEST_OPTIONS_TYPE = `{
    method: string
    url: string
    path?: Record<string, unknown> | undefined
    query?: Record<string, unknown> | undefined
    body?: unknown
    headers?: Record<string, unknown> | undefined
    signal?: AbortSignal | null | undefined
    throwOnError?: boolean | undefined
  }`

/** URL building shared by both transports (path substitution, query serialization, base URL join). */
const BUILD_URL_LINES = `    let resolvedUrl = options.url
    if (options.path) {
      for (const [key, val] of Object.entries(options.path)) {
        resolvedUrl = resolvedUrl.replace(new RegExp(\`\\\\{\\\\+?\${key}\\\\*?\\\\}\`, 'g'), encodeURIComponent(String(val)))
      }
    }

    if (options.query) {
      const searchParams = new URLSearchParams()
      for (const [key, val] of Object.entries(options.query)) {
        if (val !== undefined && key !== 'signal') {
          if (Array.isArray(val)) {
            for (const item of val) {
              if (item !== undefined) searchParams.append(key, String(item))
            }
          } else {
            searchParams.append(key, String(val))
          }
        }
      }
      const qs = searchParams.toString()
      if (qs.length > 0) {
        resolvedUrl += (resolvedUrl.includes('?') ? '&' : '?') + qs
      }
    }

    const fullUrl = this.config.baseUrl
      ? \`\${this.config.baseUrl.replace(/\\/+$/, '')}\${resolvedUrl.startsWith('/') ? '' : '/'}\${resolvedUrl}\`
      : resolvedUrl`

/** Per-request header merge: config headers first, then serialized request headers (undefined/null omitted). */
const MERGE_HEADERS_LINES = `    const headers: Record<string, string> = { ...this.config.headers }
    const requestHeaders = options.headers ?? {}
    for (const [key, value] of Object.entries(requestHeaders)) {
      const serialized = serializeHeaderValue(value)
      if (serialized !== undefined) headers[key] = serialized
    }`

function renderVerbMethods(clientName: string): string {
  return ['get', 'post', 'put', 'delete', 'patch', 'head', 'options']
    .map(verb => `  ${verb}<TData = unknown, TError = unknown>(opts: Omit<Parameters<${clientName}['request']>[0], 'method'>) {
    return this.request<TData, TError>({ ...opts, method: '${verb.toUpperCase()}' })
  }`)
    .join('\n\n')
}

function renderAxiosClientClass(clientName: string, exportKeyword: string): string {
  return `${exportKeyword}class ${clientName} {
  public readonly config: ClientConfig

  constructor(config?: ClientConfig) {
    this.config = { baseUrl: '', ...config }
  }

  async request<TData = unknown, TError = unknown>(options: ${REQUEST_OPTIONS_TYPE}): Promise<ClientResult<TData, TError>> {
    if (options.signal?.aborted) {
      return Promise.reject(options.signal.reason ?? new DOMException('The user aborted a request.', 'AbortError'))
    }

${BUILD_URL_LINES}

    const axiosInstance = this.config.axios ?? (globalThis as any).axios
    if (!axiosInstance) {
      throw new Error('Axios transport requires an axios instance. Pass axios in ClientConfig.')
    }

${MERGE_HEADERS_LINES}
    // The body is requested as text and parsed the way the fetch transport parses it, so an empty body
    // is undefined whatever the instance's own response parsing would make of it.
    const axiosRes = await axiosInstance.request({
      method: options.method,
      url: fullUrl,
      data: options.body,
      headers,
      signal: options.signal,
      responseType: 'text',
      validateStatus: () => true,
    })
    // An instance (or adapter) that still yields decoded data has it used as is.
    const payload: unknown = typeof axiosRes.data === 'string' ? parseResponseText(axiosRes.data) : axiosRes.data

    // A null-body status (204, 205, 304) cannot carry a body, even the empty string axios reports for it.
    const isNullBodyStatus = axiosRes.status === 204 || axiosRes.status === 205 || axiosRes.status === 304
    const response: Response = typeof Response !== 'undefined'
      ? new Response(!isNullBodyStatus && axiosRes.data !== undefined ? (typeof axiosRes.data === 'string' ? axiosRes.data : JSON.stringify(axiosRes.data)) : null, {
          status: axiosRes.status,
          statusText: axiosRes.statusText || '',
          headers: new Headers(axiosRes.headers as any),
        })
      : ({
          status: axiosRes.status,
          statusText: axiosRes.statusText || '',
          ok: axiosRes.status >= 200 && axiosRes.status < 300,
          headers: new Headers(axiosRes.headers as any),
        } as any)

    if (axiosRes.status === 204) {
      return {
        data: undefined as unknown as TData,
        error: undefined,
        response,
      }
    }

    if (axiosRes.status >= 200 && axiosRes.status < 300) {
      return {
        data: payload as TData,
        error: undefined,
        response,
      }
    }

    const shouldThrow = options.throwOnError ?? this.config.throwOnError ?? false
    if (shouldThrow) {
      const errDetails = typeof payload === 'object' && payload !== null ? JSON.stringify(payload) : String(payload ?? '')
      throw new Error(\`HTTP Error \${axiosRes.status}: \${errDetails}\`)
    }

    return {
      data: undefined,
      error: payload as TError,
      response,
    }
  }

${renderVerbMethods(clientName)}
}
`
}

function renderFetchClientClass(clientName: string, exportKeyword: string): string {
  return `${exportKeyword}class ${clientName} {
  public readonly config: ClientConfig

  constructor(config?: ClientConfig) {
    this.config = { baseUrl: '', ...config }
  }

  async request<TData = unknown, TError = unknown>(options: ${REQUEST_OPTIONS_TYPE}): Promise<ClientResult<TData, TError>> {
    if (options.signal?.aborted) {
      return Promise.reject(options.signal.reason ?? new DOMException('The user aborted a request.', 'AbortError'))
    }

${BUILD_URL_LINES}

    const fetchFn = this.config.fetch ?? globalThis.fetch
${MERGE_HEADERS_LINES}
    const init: RequestInit = {
      method: options.method,
      headers,
      signal: options.signal ?? null,
    }

    if (options.body !== undefined) {
      const hasContentType = Object.keys(headers).some(k => k.toLowerCase() === 'content-type')
      if (!hasContentType) {
        headers['content-type'] = 'application/json'
      }
      init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
    }

    const response = await fetchFn(fullUrl, init)

    if (response.status === 204) {
      return {
        data: undefined as unknown as TData,
        error: undefined,
        response,
      }
    }

    let payload: unknown = undefined
    try {
      payload = parseResponseText(await response.text())
    } catch {
      // unreadable body
    }

    if (response.ok) {
      return {
        data: (payload !== undefined ? payload : undefined) as TData,
        error: undefined,
        response,
      }
    }

    const shouldThrow = options.throwOnError ?? this.config.throwOnError ?? false
    if (shouldThrow) {
      const errDetails = typeof payload === 'object' && payload !== null ? JSON.stringify(payload) : String(payload ?? '')
      throw new Error(\`HTTP Error \${response.status}: \${errDetails}\`)
    }

    return {
      data: undefined,
      error: payload as TError,
      response,
    }
  }

${renderVerbMethods(clientName)}
}
`
}

/**
 * Renders openapi-ts style type-safe Client SDK with single-object calling convention
 * { path, query, body, headers } and discriminated union { data, error, response }.
 */
export function renderOpenApiTsClient(options: RenderClientOptions): RenderClientResult {
  const {
    document,
    parsed,
    httpClient = 'fetch',
    typesFile = './types.js',
    baseUrl,
    standalone = true,
    clientClass = true,
    clientName = 'Client',
  } = options

  const clientNameError = clientNameIssue(clientName)
  if (clientNameError) throw new Error(`[client] ${clientNameError}`)

  const parsedDoc = parsed ?? parseDocument(document, [])
  const operations = normalizeOperations(parsedDoc, clientModuleScopeValueNames(clientName))
  // The standalone functions need a transport even when the public client API is not exported.
  const emitTransport = clientClass || standalone

  const lines: string[] = [
    '// @generated by @oa-sdk/codegen (openapi-ts client SDK). DO NOT EDIT.',
    '',
  ]

  const exportedSymbols = new Set<string>()
  const renderedOperations: RenderedClientOperation[] = []

  // ── Types Import & Re-export ──
  const typesToImport = new Set<string>()

  if (standalone) {
    for (const op of operations) {
      if (op.hasPathParams) typesToImport.add(`${op.baseName}PathParams`)
      if (op.hasQueryParams) typesToImport.add(`${op.baseName}QueryParams`)
      if (op.hasHeaderParams) typesToImport.add(`${op.baseName}HeaderParams`)
      if (op.hasBody) typesToImport.add(`${op.baseName}Body`)
      if (op.hasSuccessResponse) typesToImport.add(`${op.baseName}Response`)
      if (op.hasErrorResponse) {
        typesToImport.add(`${op.baseName}Error`)
        typesToImport.add(`${op.baseName}ErrorByStatus`)
      }
    }
  }

  // Operation types are named after their operation (`${baseName}Response`, `${PrimaryFunction}Data`, ...).
  // One whose conventional name is a type this module declares itself or a global type it refers to (the
  // root-level operation `client` has `ClientResponse`, a helper below) is imported or declared under its
  // escaped name instead (`ClientResponse_`).
  const typeName = createTypeNameAllocator(clientModuleScopeTypeNames(clientName))
  const importedTypes = Array.from(typesToImport).sort().map(name => ({ name, local: typeName(name) }))

  if (importedTypes.length > 0) {
    const specifiers = importedTypes.map(({ name, local }) => (local === name ? name : `${name} as ${local}`))
    lines.push(`import type {\n  ${specifiers.join(',\n  ')},\n} from '${typesFile}';`)
    lines.push('')
  }

  // Re-export all schema models so client consumers can import DTOs directly
  lines.push(`export type * from '${typesFile}';`)
  // In that re-export, the module's own declaration of an escaped import's conventional name shadows the
  // import, so the module exports it under its local name.
  const escapedImports = importedTypes.flatMap(({ name, local }) => (local === name ? [] : [local]))
  if (escapedImports.length > 0) {
    lines.push(`export type { ${escapedImports.join(', ')} };`)
    for (const local of escapedImports) exportedSymbols.add(local)
  }
  lines.push('')

  // ── Core Calling Convention Types ──
  lines.push(`export interface RequestParameters<
  TPath = unknown,
  TQuery = unknown,
  TBody = unknown,
  THeaders = unknown,
> {
  readonly path?: TPath
  readonly query?: TQuery
  readonly body?: TBody
  readonly headers?: THeaders
}
`)
  exportedSymbols.add('RequestParameters')

  const clientOverrideField = clientClass
    ? `  /** Explicit client instance override */
  client?: ${clientName} | undefined
`
    : ''
  lines.push(`export type RequestOptions<TData = unknown> = TData & {
${clientOverrideField}  /** AbortSignal for request cancellation */
  signal?: AbortSignal | null | undefined
  /** If true, throws Error on 4xx/5xx responses rather than returning { error } */
  throwOnError?: boolean | undefined
}
`)
  exportedSymbols.add('RequestOptions')

  lines.push(`/**
 * Explicit (non-\`default\`) status codes of a status-indexed error map such as \`{ 404: NotFound; [status: number]: ... }\`.
 */
export type KnownErrorStatus<TStatusMap> = keyof {
  [K in keyof TStatusMap as K extends number ? (number extends K ? never : K) : never]: TStatusMap[K]
}
`)
  exportedSymbols.add('KnownErrorStatus')

  lines.push(`/**
 * Result of a generated operation: the success branch, a catch-all error branch carrying the
 * operation's error union, and one branch per declared error status (\`TErrors\`) whose
 * \`response.status\` is that literal status, so \`isErrorStatus\` can narrow \`error\` per status.
 */
export type ClientResult<TData = unknown, TError = unknown, TErrors = Record<number, TError>> =
  | {
      data: TData
      error: undefined
      response: Response
    }
  | {
      data: undefined
      error: TError
      response: Response
    }
  | {
      [K in KnownErrorStatus<TErrors>]: {
        data: undefined
        error: TErrors[K]
        response: Response & { status: K }
      }
    }[KnownErrorStatus<TErrors>]
`)
  exportedSymbols.add('ClientResult')

  lines.push(`export type ClientResponse<TData = unknown, TError = unknown, TErrors = Record<number, TError>> = ClientResult<TData, TError, TErrors>
`)
  exportedSymbols.add('ClientResponse')

  lines.push(`/**
 * Transforms a status-indexed error map into a discriminated union by status.
 * A \`default\` (index-signature) entry becomes a \`{ status: number }\` member.
 */
export type ErrorUnion<TStatusMap> =
  | { [K in KnownErrorStatus<TStatusMap>]: { status: K; error: TStatusMap[K] } }[KnownErrorStatus<TStatusMap>]
  | (number extends keyof TStatusMap ? { status: number; error: TStatusMap[keyof TStatusMap] } : never)
`)
  exportedSymbols.add('ErrorUnion')

  lines.push(`/**
 * The branch of \`TResult\` selected by \`isErrorStatus(result, TStatus)\`: the branch declared for that
 * status when the operation declares it, otherwise the catch-all error branch with \`response.status\` narrowed.
 */
export type ErrorStatusResult<TResult, TStatus extends number> =
  [Extract<TResult, { response: { status: TStatus } }>] extends [never]
    ? Exclude<TResult, { error: undefined }> & { response: { status: TStatus } }
    : Extract<TResult, { response: { status: TStatus } }>
`)
  exportedSymbols.add('ErrorStatusResult')

  lines.push(`/**
 * Type guard narrowing a ClientResult to the error response with a specific status code.
 * For a status the operation declares, \`result.error\` is narrowed to that status's model
 * (\`<Operation>Errors[status]\`); for other statuses it stays the operation's error union.
 */
export function isErrorStatus<
  TResult extends { error: unknown; response: Response },
  TStatus extends number,
>(result: TResult, status: TStatus): result is ErrorStatusResult<TResult, TStatus> {
  return result.error !== undefined && result.response.status === status
}
`)
  exportedSymbols.add('isErrorStatus')

  // ── Client Transport (Configuration & Class) ──
  if (emitTransport) {
    // The public client surface is exported only with clientClass; otherwise it is module-private.
    const exportKeyword = clientClass ? 'export ' : ''

    if (httpClient === 'axios') {
      lines.push(`${exportKeyword}interface ClientConfig {
  baseUrl?: string | undefined
  headers?: Record<string, string> | undefined
  axios?: any
  throwOnError?: boolean | undefined
}
`)
    } else {
      lines.push(`${exportKeyword}interface ClientConfig {
  baseUrl?: string | undefined
  headers?: Record<string, string> | undefined
  fetch?: typeof fetch | undefined
  throwOnError?: boolean | undefined
}
`)
    }

    lines.push(`/**
 * Serializes a header parameter with the OpenAPI default \`simple\` style:
 * arrays become \`a,b,c\`, objects become \`key,value,key,value\`, and undefined/null values are omitted.
 */
function serializeHeaderValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) return value.map(item => String(item)).join(',')
  if (typeof value === 'object') {
    const parts: string[] = []
    for (const [key, item] of Object.entries(value)) parts.push(key, String(item))
    return parts.join(',')
  }
  return String(value)
}

/**
 * Parses a response body read as text: undefined when it is empty (or only whitespace), the JSON
 * value when it is JSON, and the text itself otherwise. Both transports read bodies through it.
 */
function parseResponseText(text: string): unknown {
  if (text.trim().length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
`)

    lines.push(httpClient === 'axios'
      ? renderAxiosClientClass(clientName, exportKeyword)
      : renderFetchClientClass(clientName, exportKeyword))

    const baseArg = baseUrl ? `{ baseUrl: ${JSON.stringify(baseUrl)} }` : ''
    if (clientClass) {
      exportedSymbols.add('ClientConfig')
      exportedSymbols.add(clientName)

      lines.push(`export function createClient(config?: ClientConfig): ${clientName} {
  return new ${clientName}(config)
}
`)
      exportedSymbols.add('createClient')

      lines.push(`export let defaultClient: ${clientName} = createClient(${baseArg})

export function getDefaultClient(): ${clientName} {
  return defaultClient
}

export function setDefaultClient(client: ${clientName}): void {
  defaultClient = client
}

export const client = defaultClient
`)
      exportedSymbols.add('defaultClient')
      exportedSymbols.add('getDefaultClient')
      exportedSymbols.add('setDefaultClient')
      exportedSymbols.add('client')
    } else {
      lines.push(`const defaultClient: ${clientName} = new ${clientName}(${baseArg})
`)
    }
  }

  // ── Standalone Operation Types & Functions ──
  if (standalone) {
    for (const op of operations) {
      // 1. Endpoint Data Interface
      const dataFields: string[] = []
      if (op.hasPathParams) {
        dataFields.push(`  path: ${typeName(`${op.baseName}PathParams`)}`)
      }
      if (op.hasQueryParams) {
        dataFields.push(`  query?: ${typeName(`${op.baseName}QueryParams`)} | undefined`)
      }
      if (op.hasHeaderParams) {
        dataFields.push(`  headers?: ${typeName(`${op.baseName}HeaderParams`)} | undefined`)
      }
      if (op.hasBody) {
        const bodyType = typeName(`${op.baseName}Body`)
        dataFields.push(op.isBodyRequired ? `  body: ${bodyType}` : `  body?: ${bodyType} | undefined`)
      }

      const primaryDataName = typeName(op.primaryDataName)
      lines.push(`export interface ${primaryDataName} {
${dataFields.join('\n')}
}
`)
      exportedSymbols.add(primaryDataName)

      if (op.aliasDataName) {
        const aliasDataName = typeName(op.aliasDataName)
        lines.push(`export type ${aliasDataName} = ${primaryDataName};\n`)
        exportedSymbols.add(aliasDataName)
      }

      // 2. Response & Error Aliases
      const operationResponseName = typeName(`${op.baseName}Response`)
      const operationErrorName = typeName(`${op.baseName}Error`)
      const respType = op.hasSuccessResponse ? operationResponseName : 'void'
      const errType = op.hasErrorResponse ? operationErrorName : 'unknown'
      const fnTypeBase = pascalCase(op.primaryFnName)

      // When the function's type base equals the operation type base (root-level operations, or a
      // short name shared by several operations), the `${baseName}Response/Error` names already
      // exist (imported from the types file, or declared by the fallbacks below), so aliasing
      // them again would declare a self-referential duplicate.
      const fnResponseName = typeName(`${fnTypeBase}Response`)
      const fnErrorName = typeName(`${fnTypeBase}Error`)
      if (fnTypeBase !== op.baseName) {
        lines.push(`export type ${fnResponseName} = ${respType};`)
        lines.push(`export type ${fnErrorName} = ${errType};`)
      }
      exportedSymbols.add(fnResponseName)
      exportedSymbols.add(fnErrorName)

      const errorsMapName = typeName(`${fnTypeBase}Errors`)
      const errorUnionName = typeName(`${fnTypeBase}ErrorUnion`)

      // The per-status map is the typegen-emitted `${baseName}ErrorByStatus`, which is derived from the
      // raw document and therefore does not depend on whether `parsed` was dereferenced.
      const errorsMapType = op.hasErrorResponse ? typeName(`${op.baseName}ErrorByStatus`) : `Record<number, ${errType}>`
      lines.push(`export type ${errorsMapName} = ${errorsMapType};`)
      lines.push(`export type ${errorUnionName} = ErrorUnion<${errorsMapName}>;`)
      exportedSymbols.add(errorsMapName)
      exportedSymbols.add(errorUnionName)

      if (op.aliasFnName) {
        const aliasErrorsName = typeName(`${pascalCase(op.aliasFnName)}Errors`)
        const aliasErrorUnionName = typeName(`${pascalCase(op.aliasFnName)}ErrorUnion`)
        lines.push(`export type ${aliasErrorsName} = ${errorsMapName};`)
        lines.push(`export type ${aliasErrorUnionName} = ${errorUnionName};`)
        exportedSymbols.add(aliasErrorsName)
        exportedSymbols.add(aliasErrorUnionName)
      }

      if (!op.hasSuccessResponse) {
        lines.push(`export type ${operationResponseName} = void;`)
        exportedSymbols.add(operationResponseName)
      }
      if (!op.hasErrorResponse) {
        lines.push(`export type ${operationErrorName} = unknown;`)
        exportedSymbols.add(operationErrorName)
      }

      // 3. Standalone Function Implementation
      const commentLines: string[] = ['/**']
      const comment = op.summary ?? op.description
      if (comment) {
        commentLines.push(` * ${op.method.toUpperCase()} ${op.openApiPath} - ${comment}`)
      } else {
        commentLines.push(` * ${op.method.toUpperCase()} ${op.openApiPath}`)
      }
      if (op.hasPathParams) {
        commentLines.push(` * @param options.path Path parameters for ${op.openApiPath}`)
      }
      if (op.hasQueryParams) {
        commentLines.push(` * @param options.query Query parameters`)
      }
      if (op.hasBody) {
        commentLines.push(` * @param options.body Request body payload`)
      }
      commentLines.push(` * @see {@link ${typesFile}} Operation ${op.primaryFnName}`)
      commentLines.push(' */')
      lines.push(commentLines.join('\n'))

      const clientVerb = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(op.method)
        ? op.method
        : 'request'

      const optArg = op.isDataRequired
        ? `options: RequestOptions<${primaryDataName}>`
        : `options?: RequestOptions<${primaryDataName}>`

      const verbArgs: string[] = [
        `    url: ${quoteTypeScriptString(op.openApiPath)},`,
      ]
      if (clientVerb === 'request') {
        verbArgs.unshift(`    method: '${op.method.toUpperCase()}',`)
      }
      if (op.hasPathParams) {
        verbArgs.push('    path: options?.path,')
      }
      if (op.hasQueryParams) {
        verbArgs.push('    query: options?.query,')
      }
      if (op.hasHeaderParams) {
        verbArgs.push('    headers: options?.headers,')
      }
      if (op.hasBody) {
        verbArgs.push('    body: options?.body,')
      }
      verbArgs.push('    signal: options?.signal,')
      verbArgs.push('    throwOnError: options?.throwOnError,')

      const activeClient = clientClass ? 'options?.client ?? defaultClient' : 'defaultClient'
      lines.push(`export async function ${op.primaryFnName}(
  ${optArg},
): Promise<ClientResult<${respType}, ${errType}, ${errorsMapName}>> {
  const activeClient = ${activeClient}
  return activeClient.${clientVerb}<${respType}, ${errType}>({
${verbArgs.join('\n')}
  })
}
`)
      exportedSymbols.add(op.primaryFnName)

      if (op.aliasFnName) {
        lines.push(`export const ${op.aliasFnName} = ${op.primaryFnName};\n`)
        exportedSymbols.add(op.aliasFnName)
      }

      renderedOperations.push({
        operationId: op.operationId,
        method: op.method,
        path: op.openApiPath,
        baseName: op.baseName,
        functionName: op.prefixedFnName,
        primaryFunctionName: op.primaryFnName,
        hasPathParams: op.hasPathParams,
        hasQueryParams: op.hasQueryParams,
        hasHeaderParams: op.hasHeaderParams,
        hasBody: op.hasBody,
        hasSuccessResponse: op.hasSuccessResponse,
      })
    }
  }

  return {
    code: formatGeneratedTs(lines.join('\n')),
    exports: Array.from(exportedSymbols).sort(),
    operations: renderedOperations,
  }
}
