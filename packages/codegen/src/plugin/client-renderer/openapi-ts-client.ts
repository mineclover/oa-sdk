import {
  createOperationTypeNameMap,
  formatGeneratedTs,
  pascalCase,
  quoteTypeScriptString,
  toOperationMethodName,
  toTypeScriptIdentifier,
} from '@oa-sdk/core'
import {
  parseDocument,
  type OasDocument,
  type OasParameter,
  type OasRequestBody,
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
  /** Underlying HTTP transport engine: 'fetch' or 'axios'. Default: 'fetch' */
  httpClient?: 'fetch' | 'axios' | undefined
  /** Module specifier for importing types emitted by pluginTypescript. Default: './types.js' */
  typesFile?: string | undefined
  /** Base URL embedded in default client instance */
  baseUrl?: string | undefined
  /** Export standalone functions. Default: true */
  standalone?: boolean | undefined
  /** Export central Client class and createClient factory. Default: true */
  clientClass?: boolean | undefined
  /** Client class name. Default: 'Client' */
  clientName?: string | undefined
}

export interface RenderClientResult {
  code: string
  exports: string[]
}

interface ErrorStatusEntry {
  statusCode: string
  typeName: string
}

interface NormalizedOperation {
  operationId?: string | undefined
  method: string
  openApiPath: string
  baseName: string
  primaryFnName: string
  aliasFnName?: string | undefined
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
  errorStatusEntries: ErrorStatusEntry[]
}

function hasJsonContent(bodyOrResponse?: { content?: Record<string, unknown> }): boolean {
  if (!bodyOrResponse?.content) return false
  return 'application/json' in bodyOrResponse.content
}

function pickSuccessResponse(responses: Record<string, OasResponse>): OasResponse | undefined {
  for (const code of ['200', '201', '202', '203', '204', '206', '2XX', 'default']) {
    if (responses[code]) return responses[code]
  }
  return undefined
}

function hasErrorResponseJson(responses: Record<string, OasResponse>): boolean {
  const errorCodes = Object.keys(responses).filter(k => /^[45]\d{2}$/.test(k) || k === 'default')
  for (const code of errorCodes) {
    if (hasJsonContent(responses[code])) return true
  }
  return false
}

/**
 * Normalizes all operations across paths and webhooks in the document.
 */
function normalizeOperations(
  parsedDoc: ParsedDocument,
): NormalizedOperation[] {
  const rawOps = parsedDoc.operations
  const operationNames = createOperationTypeNameMap(rawOps)

  // First pass: count short function names to detect collisions across namespaces
  const shortNameCounts = new Map<string, number>()
  for (const op of rawOps) {
    const rawId = op.operationId
    let shortPart = ''
    if (rawId && rawId.includes('_')) {
      const parts = rawId.split('_')
      shortPart = parts[parts.length - 1] ?? ''
    } else if (rawId) {
      shortPart = rawId
    } else {
      shortPart = `${op.method}_${op.openApiPath.replace(/[{}/]/g, '_')}`
    }
    const shortFn = toOperationMethodName(toTypeScriptIdentifier(shortPart))
    shortNameCounts.set(shortFn, (shortNameCounts.get(shortFn) ?? 0) + 1)
  }

  const results: NormalizedOperation[] = []

  for (const op of rawOps) {
    const rawId = op.operationId
    const baseName = rawId
      ? (operationNames.get(rawId) ?? toTypeScriptIdentifier(rawId))
      : toTypeScriptIdentifier(`${op.method}_${op.openApiPath.replace(/[{}/]/g, '_')}`)

    const prefixedFnName = toOperationMethodName(baseName)

    let shortPart = ''
    if (rawId && rawId.includes('_')) {
      const parts = rawId.split('_')
      shortPart = parts[parts.length - 1] ?? ''
    } else if (rawId) {
      shortPart = rawId
    } else {
      shortPart = `${op.method}_${op.openApiPath.replace(/[{}/]/g, '_')}`
    }
    const shortFnName = toOperationMethodName(toTypeScriptIdentifier(shortPart))

    // If short name is unique across all operations, make it the primary function name
    const isShortUnique = (shortNameCounts.get(shortFnName) ?? 0) === 1
    const primaryFnName = isShortUnique ? shortFnName : prefixedFnName
    const aliasFnName = primaryFnName !== prefixedFnName ? prefixedFnName : undefined

    const primaryDataName = `${pascalCase(primaryFnName)}Data`
    const aliasDataName = `${baseName}Data`

    const pathParams = op.parameters.filter(p => p.in === 'path')
    const queryParams = op.parameters.filter(p => p.in === 'query')
    const headerParams = op.parameters.filter(p => p.in === 'header')

    const hasPathParams = pathParams.length > 0
    const hasQueryParams = queryParams.length > 0
    const hasHeaderParams = headerParams.length > 0

    const hasBody = op.requestBody !== undefined && hasJsonContent(op.requestBody)
    const isBodyRequired = op.requestBody?.required === true

    const successRes = pickSuccessResponse(op.responses)
    const hasSuccessResponse = successRes !== undefined && hasJsonContent(successRes)
    const hasErrorResponse = hasErrorResponseJson(op.responses)

    const isDataRequired =
      hasPathParams ||
      isBodyRequired ||
      queryParams.some(p => p.required === true)

    const errorStatusEntries: ErrorStatusEntry[] = []
    for (const [code, resp] of Object.entries(op.responses ?? {})) {
      if (/^[45]\d{2}$/.test(code) || code === 'default') {
        let typeName = `${baseName}Error`
        const jsonMedia = resp?.content?.['application/json'] as any
        if (jsonMedia && typeof jsonMedia === 'object' && 'schema' in jsonMedia && jsonMedia.schema) {
          const s = jsonMedia.schema as any
          if (s.$ref && typeof s.$ref === 'string') {
            typeName = s.$ref.replace('#/components/schemas/', '')
          }
        }
        errorStatusEntries.push({ statusCode: code, typeName })
      }
    }

    results.push({
      operationId: op.operationId,
      method: op.method.toLowerCase(),
      openApiPath: op.openApiPath,
      baseName,
      primaryFnName,
      aliasFnName,
      primaryDataName,
      aliasDataName: primaryDataName !== aliasDataName ? aliasDataName : undefined,
      summary: (op as { summary?: string }).summary,
      description: (op as { description?: string }).description,
      hasPathParams,
      hasQueryParams,
      hasHeaderParams,
      hasBody,
      isBodyRequired,
      hasSuccessResponse,
      hasErrorResponse,
      isDataRequired,
      errorStatusEntries,
    })
  }

  return results
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

  const parsedDoc = parsed ?? parseDocument(document, [])
  const operations = normalizeOperations(parsedDoc)

  const lines: string[] = [
    '// @generated by @oa-sdk/codegen (openapi-ts client SDK). DO NOT EDIT.',
    '',
  ]

  const exportedSymbols = new Set<string>()

  // ── Types Import & Re-export ──
  const typesToImport = new Set<string>()

  for (const op of operations) {
    if (op.hasPathParams) typesToImport.add(`${op.baseName}PathParams`)
    if (op.hasQueryParams) typesToImport.add(`${op.baseName}QueryParams`)
    if (op.hasHeaderParams) typesToImport.add(`${op.baseName}HeaderParams`)
    if (op.hasBody) typesToImport.add(`${op.baseName}Body`)
    if (op.hasSuccessResponse) typesToImport.add(`${op.baseName}Response`)
    if (op.hasErrorResponse) typesToImport.add(`${op.baseName}Error`)
  }

  if (typesToImport.size > 0) {
    const sorted = Array.from(typesToImport).sort()
    lines.push(`import type {\n  ${sorted.join(',\n  ')},\n} from '${typesFile}';`)
    lines.push('')
  }

  // Re-export all schema models so client consumers can import DTOs directly
  lines.push(`export type * from '${typesFile}';`)
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

  lines.push(`export type RequestOptions<TData = unknown> = TData & {
  /** Explicit client instance override */
  client?: ${clientName}
  /** AbortSignal for request cancellation */
  signal?: AbortSignal | null
  /** If true, throws Error on 4xx/5xx responses rather than returning { error } */
  throwOnError?: boolean
}
`)
  exportedSymbols.add('RequestOptions')

  lines.push(`export type ClientResult<TData = unknown, TError = unknown> =
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
`)
  exportedSymbols.add('ClientResult')

  lines.push(`export type ClientResponse<TData = unknown, TError = unknown> = ClientResult<TData, TError>
`)
  exportedSymbols.add('ClientResponse')

  lines.push(`/**
 * Transforms a status-indexed error map into a discriminated union by status.
 */
export type ErrorUnion<TStatusMap> = {
  [K in keyof TStatusMap]: { status: K; error: TStatusMap[K] }
}[keyof TStatusMap]
`)
  exportedSymbols.add('ErrorUnion')

  lines.push(`/**
 * Type guard narrowing a ClientResult to an error response matching a specific status code.
 */
export function isErrorStatus<TStatus extends number>(
  result: ClientResult<unknown, unknown>,
  status: TStatus,
): result is { data: undefined; error: unknown; response: Response & { status: TStatus } } {
  return result.error !== undefined && result.response.status === status
}
`)
  exportedSymbols.add('isErrorStatus')

  // ── Client Configuration & Class ──
  if (clientClass) {
    if (httpClient === 'axios') {
      lines.push(`export interface ClientConfig {
  baseUrl?: string
  headers?: Record<string, string>
  axios?: any
  throwOnError?: boolean
}
`)
    } else {
      lines.push(`export interface ClientConfig {
  baseUrl?: string
  headers?: Record<string, string>
  fetch?: typeof fetch
  throwOnError?: boolean
}
`)
    }
    exportedSymbols.add('ClientConfig')

    if (httpClient === 'axios') {
      lines.push(`export class ${clientName} {
  public readonly config: ClientConfig

  constructor(config?: ClientConfig) {
    this.config = { baseUrl: '', ...config }
  }

  async request<TData = unknown, TError = unknown>(options: {
    method: string
    url: string
    path?: Record<string, unknown>
    query?: Record<string, unknown>
    body?: unknown
    headers?: Record<string, string>
    signal?: AbortSignal | null
    throwOnError?: boolean
  }): Promise<ClientResult<TData, TError>> {
    if (options.signal?.aborted) {
      return Promise.reject(options.signal.reason ?? new DOMException('The user aborted a request.', 'AbortError'))
    }

    let resolvedUrl = options.url
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
      : resolvedUrl

    const axiosInstance = this.config.axios ?? (globalThis as any).axios
    if (!axiosInstance) {
      throw new Error('Axios transport requires an axios instance. Pass axios in ClientConfig.')
    }

    const headers: Record<string, string> = { ...this.config.headers, ...options.headers }
    const axiosRes = await axiosInstance.request({
      method: options.method,
      url: fullUrl,
      data: options.body,
      headers,
      signal: options.signal,
      validateStatus: () => true,
    })

    const response: Response = typeof Response !== 'undefined'
      ? new Response(axiosRes.data !== undefined ? (typeof axiosRes.data === 'string' ? axiosRes.data : JSON.stringify(axiosRes.data)) : null, {
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
        data: axiosRes.data as TData,
        error: undefined,
        response,
      }
    }

    const shouldThrow = options.throwOnError ?? this.config.throwOnError ?? false
    if (shouldThrow) {
      const errDetails = typeof axiosRes.data === 'object' && axiosRes.data !== null ? JSON.stringify(axiosRes.data) : String(axiosRes.data ?? '')
      throw new Error(\`HTTP Error \${axiosRes.status}: \${errDetails}\`)
    }

    return {
      data: undefined,
      error: axiosRes.data as TError,
      response,
    }
  }

  get<TData = unknown, TError = unknown>(opts: Omit<Parameters<${clientName}['request']>[0], 'method'>) {
    return this.request<TData, TError>({ ...opts, method: 'GET' })
  }

  post<TData = unknown, TError = unknown>(opts: Omit<Parameters<${clientName}['request']>[0], 'method'>) {
    return this.request<TData, TError>({ ...opts, method: 'POST' })
  }

  put<TData = unknown, TError = unknown>(opts: Omit<Parameters<${clientName}['request']>[0], 'method'>) {
    return this.request<TData, TError>({ ...opts, method: 'PUT' })
  }

  delete<TData = unknown, TError = unknown>(opts: Omit<Parameters<${clientName}['request']>[0], 'method'>) {
    return this.request<TData, TError>({ ...opts, method: 'DELETE' })
  }

  patch<TData = unknown, TError = unknown>(opts: Omit<Parameters<${clientName}['request']>[0], 'method'>) {
    return this.request<TData, TError>({ ...opts, method: 'PATCH' })
  }

  head<TData = unknown, TError = unknown>(opts: Omit<Parameters<${clientName}['request']>[0], 'method'>) {
    return this.request<TData, TError>({ ...opts, method: 'HEAD' })
  }

  options<TData = unknown, TError = unknown>(opts: Omit<Parameters<${clientName}['request']>[0], 'method'>) {
    return this.request<TData, TError>({ ...opts, method: 'OPTIONS' })
  }
}
`)
    } else {
      lines.push(`export class ${clientName} {
  public readonly config: ClientConfig

  constructor(config?: ClientConfig) {
    this.config = { baseUrl: '', ...config }
  }

  async request<TData = unknown, TError = unknown>(options: {
    method: string
    url: string
    path?: Record<string, unknown>
    query?: Record<string, unknown>
    body?: unknown
    headers?: Record<string, string>
    signal?: AbortSignal | null
    throwOnError?: boolean
  }): Promise<ClientResult<TData, TError>> {
    if (options.signal?.aborted) {
      return Promise.reject(options.signal.reason ?? new DOMException('The user aborted a request.', 'AbortError'))
    }

    let resolvedUrl = options.url
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
      : resolvedUrl

    const fetchFn = this.config.fetch ?? globalThis.fetch
    const headers: Record<string, string> = { ...this.config.headers, ...options.headers }
    const init: RequestInit = {
      method: options.method,
      headers,
      signal: options.signal,
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
      const text = await response.text()
      if (text && text.trim().length > 0) {
        try {
          payload = JSON.parse(text)
        } catch {
          payload = text
        }
      }
    } catch {
      // empty or unreadable body
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

  get<TData = unknown, TError = unknown>(opts: Omit<Parameters<${clientName}['request']>[0], 'method'>) {
    return this.request<TData, TError>({ ...opts, method: 'GET' })
  }

  post<TData = unknown, TError = unknown>(opts: Omit<Parameters<${clientName}['request']>[0], 'method'>) {
    return this.request<TData, TError>({ ...opts, method: 'POST' })
  }

  put<TData = unknown, TError = unknown>(opts: Omit<Parameters<${clientName}['request']>[0], 'method'>) {
    return this.request<TData, TError>({ ...opts, method: 'PUT' })
  }

  delete<TData = unknown, TError = unknown>(opts: Omit<Parameters<${clientName}['request']>[0], 'method'>) {
    return this.request<TData, TError>({ ...opts, method: 'DELETE' })
  }

  patch<TData = unknown, TError = unknown>(opts: Omit<Parameters<${clientName}['request']>[0], 'method'>) {
    return this.request<TData, TError>({ ...opts, method: 'PATCH' })
  }

  head<TData = unknown, TError = unknown>(opts: Omit<Parameters<${clientName}['request']>[0], 'method'>) {
    return this.request<TData, TError>({ ...opts, method: 'HEAD' })
  }

  options<TData = unknown, TError = unknown>(opts: Omit<Parameters<${clientName}['request']>[0], 'method'>) {
    return this.request<TData, TError>({ ...opts, method: 'OPTIONS' })
  }
}
`)
    }
    exportedSymbols.add(clientName)

    lines.push(`export function createClient(config?: ClientConfig): ${clientName} {
  return new ${clientName}(config)
}
`)
    exportedSymbols.add('createClient')

    const baseArg = baseUrl ? `{ baseUrl: ${JSON.stringify(baseUrl)} }` : ''
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
  }

  // ── Standalone Operation Types & Functions ──
  if (standalone) {
    for (const op of operations) {
      // 1. Endpoint Data Interface
      const dataFields: string[] = []
      if (op.hasPathParams) {
        dataFields.push(`  path: ${op.baseName}PathParams`)
      }
      if (op.hasQueryParams) {
        dataFields.push(`  query?: ${op.baseName}QueryParams`)
      }
      if (op.hasHeaderParams) {
        dataFields.push(`  headers?: ${op.baseName}HeaderParams`)
      }
      if (op.hasBody) {
        dataFields.push(`  body${op.isBodyRequired ? '' : '?'}: ${op.baseName}Body`)
      }

      lines.push(`export interface ${op.primaryDataName} {
${dataFields.join('\n')}
}
`)
      exportedSymbols.add(op.primaryDataName)

      if (op.aliasDataName) {
        lines.push(`export type ${op.aliasDataName} = ${op.primaryDataName};\n`)
        exportedSymbols.add(op.aliasDataName)
      }

      // 2. Response & Error Aliases
      const respType = op.hasSuccessResponse ? `${op.baseName}Response` : 'void'
      const errType = op.hasErrorResponse ? `${op.baseName}Error` : 'unknown'

      lines.push(`export type ${pascalCase(op.primaryFnName)}Response = ${respType};`)
      lines.push(`export type ${pascalCase(op.primaryFnName)}Error = ${errType};`)
      exportedSymbols.add(`${pascalCase(op.primaryFnName)}Response`)
      exportedSymbols.add(`${pascalCase(op.primaryFnName)}Error`)

      const errorsMapName = `${pascalCase(op.primaryFnName)}Errors`
      const errorUnionName = `${pascalCase(op.primaryFnName)}ErrorUnion`

      if (op.errorStatusEntries.length > 0) {
        const errorProps = op.errorStatusEntries.map(e =>
          e.statusCode === 'default' ? `  [status: number]: ${e.typeName}` : `  ${e.statusCode}: ${e.typeName}`
        )
        lines.push(`export interface ${errorsMapName} {\n${errorProps.join('\n')}\n}`)
        const unionMembers = op.errorStatusEntries.map(e => {
          const s = e.statusCode === 'default' ? 'number' : e.statusCode
          return `{ status: ${s}; error: ${e.typeName} }`
        })
        lines.push(`export type ${errorUnionName} = ${unionMembers.join(' | ')};`)
      } else {
        lines.push(`export type ${errorsMapName} = Record<number, ${errType}>;`)
        lines.push(`export type ${errorUnionName} = { status: number; error: ${errType} };`)
      }
      exportedSymbols.add(errorsMapName)
      exportedSymbols.add(errorUnionName)

      if (op.aliasFnName) {
        lines.push(`export type ${pascalCase(op.aliasFnName)}Errors = ${errorsMapName};`)
        lines.push(`export type ${pascalCase(op.aliasFnName)}ErrorUnion = ${errorUnionName};`)
        exportedSymbols.add(`${pascalCase(op.aliasFnName)}Errors`)
        exportedSymbols.add(`${pascalCase(op.aliasFnName)}ErrorUnion`)
      }

      if (!op.hasSuccessResponse) {
        lines.push(`export type ${op.baseName}Response = void;`)
        exportedSymbols.add(`${op.baseName}Response`)
      }
      if (!op.hasErrorResponse) {
        lines.push(`export type ${op.baseName}Error = unknown;`)
        exportedSymbols.add(`${op.baseName}Error`)
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
        ? `options: RequestOptions<${op.primaryDataName}>`
        : `options?: RequestOptions<${op.primaryDataName}>`

      const verbArgs: string[] = [
        `    url: ${quoteTypeScriptString(op.openApiPath)},`,
      ]
      if (clientVerb === 'request') {
        verbArgs.unshift(`    method: '${op.method.toUpperCase()}',`)
      }
      if (op.hasPathParams) {
        verbArgs.push('    path: options?.path as any,')
      }
      if (op.hasQueryParams) {
        verbArgs.push('    query: options?.query as any,')
      }
      if (op.hasHeaderParams) {
        verbArgs.push('    headers: options?.headers,')
      }
      if (op.hasBody) {
        verbArgs.push('    body: options?.body,')
      }
      verbArgs.push('    signal: options?.signal,')
      verbArgs.push('    throwOnError: options?.throwOnError,')

      lines.push(`export async function ${op.primaryFnName}(
  ${optArg},
): Promise<ClientResult<${respType}, ${errType}>> {
  const activeClient = options?.client ?? defaultClient
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
    }
  }

  return {
    code: formatGeneratedTs(lines.join('\n')),
    exports: Array.from(exportedSymbols).sort(),
  }
}
