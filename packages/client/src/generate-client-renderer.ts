/**
 * OAS ParsedDocument → fetch 기반 타입 안전 클라이언트 SDK 코드 생성
 *
 * typegen 타입을 import하여 타입 안전 API 클라이언트를 생성합니다.
 */

import type { OasParameter, OasRequestBody, OasResponse, OasSchema, ParsedDocument } from '@oa-sdk/parser/browser'
import { getQuerystringParameter, resolveServerUrl } from '@oa-sdk/parser/browser'
import { createOperationTypeNameMap, toOperationMethodName, collectTypeNames, escapeKey, getGeneratedErrorResponseKeys, formatGeneratedTs, quoteTypeScriptString } from '@oa-sdk/core/browser'
import { appendClientErrorGuard, getErrorValidationEntries } from './error-contract.js'
import { requestValidationLines } from './request-contract.js'
import { isOperationRetryable } from './retry-policy.js'
import { appendRuntimeValidationHelpers, serializeValidationSchema } from './runtime-schema.js'

/** Platform-neutral client rendering options. */
export type ClientRenderOptions = {
  /** typegen 타입 import 경로 (예: './types') */
  typesImport?: string
  /** 헤더 주석 */
  banner?: boolean
}

/**
 * OAS 원본 문서에서 fetch 클라이언트 SDK를 생성합니다.
 */
export function generateClientFromParsed(doc: ParsedDocument, options: ClientRenderOptions = {}): string {
  const { typesImport, banner = true } = options
  const lines: string[] = []
  const operationNames = createOperationTypeNameMap([...doc.operations, ...doc.webhooks])

  if (banner) {
    lines.push('// Auto-generated client SDK from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/client')
    lines.push('')
  }

  // types import
  if (typesImport) {
    const typeNames = collectTypeNames(doc.operations, operationNames)
    if (typeNames.length > 0) {
      lines.push(`import type { ${typeNames.join(', ')} } from '${typesImport}'`)
      lines.push('')
    }
  }

  // middleware type
  lines.push(`export type ClientMiddleware = {`)
  lines.push(`  onRequest?: (url: string, init: RequestInit) => RequestInit | Promise<RequestInit>`)
  lines.push(`  onResponse?: (response: Response) => Response | Promise<Response>`)
  lines.push(`  onError?: (error: Error) => void`)
  lines.push(`}`)
  lines.push('')

  const responseHeaderOperations = doc.operations.filter(op =>
    op.operationId
    && getStreamingFormat(op.responses) === null
    && hasGeneratedResponseHeaders(op.responses)
  )

  lines.push(`export type ClientResponse<TBody, THeaders extends object = Record<string, never>> = {`)
  lines.push(`  body: TBody`)
  lines.push(`  headers: THeaders`)
  lines.push(`  response: Response`)
  lines.push(`}`)
  lines.push('')

  lines.push(`export class ClientError<TBody = unknown, TStatus extends number = number> extends Error {`)
  lines.push(`  readonly status: TStatus`)
  lines.push(`  readonly body: TBody`)
  lines.push(`  readonly response: Response`)
  lines.push(`  readonly operationId?: string`)
  lines.push(`  constructor(status: TStatus, body: TBody, response: Response, operationId?: string) {`)
  lines.push(`    super(\`\${status} \${response.statusText}\`)`)
  lines.push(`    this.name = 'ClientError'`)
  lines.push(`    this.status = status`)
  lines.push(`    this.body = body`)
  lines.push(`    this.response = response`)
  lines.push(`    this.operationId = operationId`)
  lines.push(`  }`)
  lines.push(`}`)
  lines.push('')

  appendRuntimeValidationHelpers(lines)
  appendClientErrorGuard(lines)

  if (typesImport) {
    for (const op of doc.operations) {
      if (!op.operationId) continue
      const baseName = operationNames.get(op.operationId)!
      const errorKeys = getGeneratedErrorResponseKeys(op.responses)
      if (errorKeys.length === 0) continue
      const variants = errorKeys
        .filter(key => /^[45]\d{2}$/.test(key))
        .map(key => `ClientError<${baseName}ErrorByStatus[${key}], ${key}>`)
      if (errorKeys.includes('default')) variants.push(`ClientError<${baseName}ErrorByStatus[number], number>`)
      lines.push(`export type ${baseName}ClientError = ${variants.join(' | ')}`)
      const errorEntries = getErrorValidationEntries(op.responses)
      const allSchemas = errorEntries
        .map(entry => serializeValidationSchema(entry.schema))
        .filter((schema): schema is string => schema !== undefined)
      lines.push(`export function is${baseName}ErrorBody(body: unknown): body is ${baseName}Error;`)
      lines.push(`export function is${baseName}ErrorBody(body: unknown, status?: number): body is ${baseName}Error;`)
      for (const entry of errorEntries.filter(entry => /^[45]\d{2}$/.test(entry.key))) {
        const schema = serializeValidationSchema(entry.schema)
        if (schema) lines.push(`export function is${baseName}ErrorBody(body: unknown, status: ${entry.key}): body is ${baseName}ErrorByStatus[${entry.key}];`)
      }
      lines.push(`export function is${baseName}ErrorBody(body: unknown, status?: number): body is ${baseName}Error {`)
      lines.push(`  if (status !== undefined) {`)
      lines.push(`    switch (status) {`)
      for (const entry of errorEntries.filter(entry => /^[45]\d{2}$/.test(entry.key))) {
        const schema = serializeValidationSchema(entry.schema)
        if (schema) lines.push(`      case ${entry.key}: return __oaSchemaMatches(body, ${schema})`)
      }
      lines.push(`      default: break`)
      lines.push(`    }`)
      lines.push(`  }`)
      lines.push(`  return [${allSchemas.join(', ')}].some(schema => __oaSchemaMatches(body, schema))`)
      lines.push(`}`)
      lines.push(`export function is${baseName}ClientError(error: unknown): error is ${baseName}ClientError;`)
      lines.push(`export function is${baseName}ClientError(error: unknown, status?: number): error is ${baseName}ClientError;`)
      for (const entry of errorEntries.filter(entry => /^[45]\d{2}$/.test(entry.key))) {
        lines.push(`export function is${baseName}ClientError(error: unknown, status: ${entry.key}): error is ClientError<${baseName}ErrorByStatus[${entry.key}], ${entry.key}>;`)
      }
      lines.push(`export function is${baseName}ClientError(error: unknown, status?: number): error is ${baseName}ClientError {`)
      lines.push(`  if (!isClientError(error) || error.operationId !== ${JSON.stringify(op.operationId)}) return false`)
      lines.push(`  if (status !== undefined && error.status !== status) return false`)
      lines.push(`  return is${baseName}ErrorBody(error.body, status ?? error.status)`)
      lines.push(`}`)
    }
    if (doc.operations.some(op => op.operationId && getGeneratedErrorResponseKeys(op.responses).length > 0)) lines.push('')
  }

  // auth middleware factories (from securitySchemes)
  for (const [name, scheme] of Object.entries(doc.securitySchemes)) {
    const fnName = name.toLowerCase().endsWith('auth') ? name : `${name}Auth`

    if (scheme.type === 'http' && scheme.scheme === 'bearer') {
      lines.push(`/** Auth middleware — ${name} (http/bearer) */`)
      lines.push(`export function ${fnName}(token: string): ClientMiddleware {`)
      lines.push(`  return {`)
      lines.push(`    onRequest: (_url, init) => {`)
      lines.push(`      const headers = new Headers(init.headers)`)
      lines.push(`      headers.set('Authorization', \`Bearer \${token}\`)`)
      lines.push(`      return { ...init, headers }`)
      lines.push(`    }`)
      lines.push(`  }`)
      lines.push(`}`)
      lines.push('')
    } else if (scheme.type === 'http' && scheme.scheme === 'basic') {
      lines.push(`/** Auth middleware — ${name} (http/basic) */`)
      lines.push(`export function ${fnName}(username: string, password: string): ClientMiddleware {`)
      lines.push(`  return {`)
      lines.push(`    onRequest: (_url, init) => {`)
      lines.push(`      const headers = new Headers(init.headers)`)
      lines.push(`      headers.set('Authorization', \`Basic \${btoa(\`\${username}:\${password}\`)}\`)`)
      lines.push(`      return { ...init, headers }`)
      lines.push(`    }`)
      lines.push(`  }`)
      lines.push(`}`)
      lines.push('')
    } else if (scheme.type === 'apiKey' && scheme.name) {
      if (scheme.in === 'header') {
        lines.push(`/** Auth middleware — ${name} (apiKey in header) */`)
        lines.push(`export function ${fnName}(key: string): ClientMiddleware {`)
        lines.push(`  return {`)
        lines.push(`    onRequest: (_url, init) => {`)
        lines.push(`      const headers = new Headers(init.headers)`)
        lines.push(`      headers.set('${scheme.name}', key)`)
        lines.push(`      return { ...init, headers }`)
        lines.push(`    }`)
        lines.push(`  }`)
        lines.push(`}`)
        lines.push('')
      } else if (scheme.in === 'cookie') {
        lines.push(`/** Auth middleware — ${name} (apiKey in cookie) */`)
        lines.push(`export function ${fnName}(key: string): ClientMiddleware {`)
        lines.push(`  return {`)
        lines.push(`    onRequest: (_url, init) => {`)
        lines.push(`      const headers = new Headers(init.headers)`)
        lines.push(`      const existing = headers.get('Cookie') ?? ''`)
        lines.push(`      headers.set('Cookie', existing ? \`\${existing}; ${scheme.name}=\${key}\` : \`${scheme.name}=\${key}\`)`)
        lines.push(`      return { ...init, headers }`)
        lines.push(`    }`)
        lines.push(`  }`)
        lines.push(`}`)
        lines.push('')
      } else if (scheme.in === 'query') {
        lines.push(`// Auth — ${name} (apiKey in query): pass '${scheme.name}' as a query parameter per-request`)
        lines.push('')
      }
    } else if (scheme.type === 'oauth2' || scheme.type === 'openIdConnect') {
      lines.push(`/** Auth middleware — ${name} (${scheme.type}) */`)
      lines.push(`export function ${fnName}(token: string): ClientMiddleware {`)
      lines.push(`  return {`)
      lines.push(`    onRequest: (_url, init) => {`)
      lines.push(`      const headers = new Headers(init.headers)`)
      lines.push(`      headers.set('Authorization', \`Bearer \${token}\`)`)
      lines.push(`      return { ...init, headers }`)
      lines.push(`    }`)
      lines.push(`  }`)
      lines.push(`}`)
      lines.push('')
    }
  }

  // base URL helper
  const defaultServer = doc.servers[0] ? resolveServerUrl(doc.servers[0]) : ''
  lines.push(`export type ClientConfig = { baseUrl?: string; headers?: Record<string, string>; middleware?: ClientMiddleware[]; timeout?: number; retry?: { maxRetries?: number; baseDelay?: number }; validate?: boolean }`)
  lines.push('')
  lines.push(`export function createClient(config: ClientConfig = {}) {`)
  lines.push(`  const baseUrl = config.baseUrl ?? ${quoteTypeScriptString(defaultServer)}`)
  lines.push(`  const defaultHeaders = config.headers ?? {}`)
  lines.push('')
  lines.push(`  function createRequestUrl(path: string): URL {`)
  lines.push(`    const url = new URL(baseUrl)`)
  lines.push(`    const basePath = url.pathname.endsWith('/') ? url.pathname : url.pathname + '/'`)
  lines.push(`    url.pathname = basePath + path.replace(/^\\/+/, '')`)
  lines.push(`    return url`)
  lines.push(`  }`)
  lines.push('')

  // retry helper
  lines.push(`  const maxRetries = config.retry?.maxRetries ?? 0`)
  lines.push(`  const baseDelay = config.retry?.baseDelay ?? 1000`)
  lines.push(`  const timeoutMs = config.timeout`)
  lines.push('')
  lines.push(`  function parseRetryAfter(value: string): number {`)
  lines.push(`    const seconds = Number(value)`)
  lines.push(`    if (!isNaN(seconds)) return seconds * 1000`)
  lines.push(`    const date = Date.parse(value)`)
  lines.push(`    if (!isNaN(date)) return Math.max(0, date - Date.now())`)
  lines.push(`    return 1000`)
  lines.push(`  }`)
  lines.push('')
  lines.push(`  function notifyError(error: Error): void {`)
  lines.push(`    for (const mw of config.middleware ?? []) {`)
  lines.push(`      if (mw.onError) mw.onError(error)`)
  lines.push(`    }`)
  lines.push(`  }`)
  lines.push('')

  // fetch helper with retry + timeout
  lines.push(`  type __OaHeaderValueType = 'string' | 'number' | 'integer' | 'boolean' | 'array'`)
  lines.push(`  type __OaHeaderSpec = { name: string; type: __OaHeaderValueType; items?: __OaHeaderValueType }`)
  lines.push(`  type __OaQuerySpec = { name: string; style: string; explode: boolean }`)
  lines.push('')
  lines.push(`  function __readOaResponseHeaders<THeaders extends object>(headers: Headers, specs: readonly __OaHeaderSpec[]): THeaders {`)
  lines.push(`    const result: Record<string, unknown> = {}`)
  lines.push(`    for (const spec of specs) {`)
  lines.push(`      const raw = __getOaResponseHeader(headers, spec.name)`)
  lines.push(`      if (raw === null) continue`)
  lines.push(`      const parsed = __parseOaResponseHeader(raw, spec)`)
  lines.push(`      if (parsed !== undefined) result[spec.name] = parsed`)
  lines.push(`    }`)
  lines.push(`    return result as THeaders`)
  lines.push(`  }`)
  lines.push('')
  lines.push(`  function __getOaResponseHeader(headers: Headers, name: string): string | null {`)
  lines.push(`    const direct = headers.get(name)`)
  lines.push(`    if (direct !== null) return direct`)
  lines.push(`    const lowerName = name.toLowerCase()`)
  lines.push(`    let found: string | null = null`)
  lines.push(`    headers.forEach((value, headerName) => {`)
  lines.push(`      if (found === null && headerName.toLowerCase() === lowerName) found = value`)
  lines.push(`    })`)
  lines.push(`    return found`)
  lines.push(`  }`)
  lines.push('')
  lines.push(`  function __parseOaResponseHeader(value: string, spec: __OaHeaderSpec): unknown {`)
  lines.push(`    if (spec.type === 'integer' || spec.type === 'number') {`)
  lines.push(`      const parsed = Number(value)`)
  lines.push(`      return Number.isFinite(parsed) ? parsed : undefined`)
  lines.push(`    }`)
  lines.push(`    if (spec.type === 'boolean') {`)
  lines.push(`      const normalized = value.trim().toLowerCase()`)
  lines.push(`      if (normalized === 'true') return true`)
  lines.push(`      if (normalized === 'false') return false`)
  lines.push(`      return undefined`)
  lines.push(`    }`)
  lines.push(`    if (spec.type === 'array') {`)
  lines.push(`      const itemSpec: __OaHeaderSpec = { name: spec.name, type: spec.items ?? 'string' }`)
  lines.push(`      return value.split(',').map(part => __parseOaResponseHeader(part.trim(), itemSpec)).filter(item => item !== undefined)`)
  lines.push(`    }`)
  lines.push(`    return value`)
  lines.push(`  }`)
  lines.push('')

  lines.push(`  function __appendOaQuery(url: URL, query: Record<string, unknown>, specs: readonly __OaQuerySpec[] = []): void {`)
  lines.push(`    const byName = new Map(specs.map(spec => [spec.name, spec]))`)
  lines.push(`    for (const [name, value] of Object.entries(query)) {`)
  lines.push(`      if (value === undefined) continue`)
  lines.push(`      const spec = byName.get(name)`)
  lines.push(`      if (Array.isArray(value)) {`)
  lines.push(`        const style = spec?.style ?? 'form'`)
  lines.push(`        const explode = spec?.explode ?? style === 'form'`)
  lines.push(`        if (style === 'form' && explode) {`)
  lines.push(`          for (const item of value) url.searchParams.append(name, String(item))`)
  lines.push(`          continue`)
  lines.push(`        }`)
  lines.push(`        const delimiter = style === 'pipeDelimited' ? '|' : style === 'spaceDelimited' ? ' ' : ','`)
  lines.push(`        url.searchParams.set(name, value.map(String).join(delimiter))`)
  lines.push(`        continue`)
  lines.push(`      }`)
  lines.push(`      url.searchParams.set(name, String(value))`)
  lines.push(`    }`)
  lines.push(`  }`)
  lines.push('')

  lines.push(`  function __setOaRawQueryString(url: URL, querystring: string): void {`)
  lines.push(`    if (querystring.startsWith('?')) throw new TypeError('querystring must not include a leading ?')`)
  lines.push(`    url.search = '?' + querystring`)
  lines.push(`  }`)
  lines.push('')

  lines.push(`  function __serializeOaRequestHeaders(headers: Record<string, unknown> | undefined): Record<string, string> | undefined {`)
  lines.push(`    if (!headers) return undefined`)
  lines.push(`    const result: Record<string, string> = {}`)
  lines.push(`    for (const [name, value] of Object.entries(headers)) {`)
  lines.push(`      if (value === undefined || value === null) continue`)
  lines.push(`      result[name] = Array.isArray(value) ? value.map(String).join(',') : String(value)`)
  lines.push(`    }`)
  lines.push(`    return result`)
  lines.push(`  }`)
  lines.push('')

  lines.push(`  function __createOaRequestHeaders(builtIn: Record<string, string> | undefined, headers: Record<string, string> | undefined): Headers {`)
  lines.push(`    const result = new Headers()`)
  lines.push(`    for (const source of [builtIn, defaultHeaders, headers] as const) {`)
  lines.push(`      for (const [name, value] of Object.entries(source ?? {})) result.set(name, value)`)
  lines.push(`    }`)
  lines.push(`    return result`)
  lines.push(`  }`)
  lines.push('')

  lines.push(`  function __mergeOaRequestHeaders(headers: Record<string, unknown> | undefined): Record<string, unknown> {`)
  lines.push(`    const result: Record<string, unknown> = {}`)
  lines.push(`    for (const source of [defaultHeaders, headers] as const) {`)
  lines.push(`      for (const [name, value] of Object.entries(source ?? {})) {`)
  lines.push(`        const existing = Object.keys(result).find(key => key.toLowerCase() === name.toLowerCase())`)
  lines.push(`        if (existing !== undefined) delete result[existing]`)
  lines.push(`        result[name] = value`)
  lines.push(`      }`)
  lines.push(`    }`)
  lines.push(`    return result`)
  lines.push(`  }`)
  lines.push('')

  lines.push(`  function __getOaRequestHeader(headers: Record<string, unknown> | undefined, name: string): unknown {`)
  lines.push(`    if (!headers) return undefined`)
  lines.push(`    const lowerName = name.toLowerCase()`)
  lines.push(`    for (const [headerName, value] of Object.entries(headers)) {`)
  lines.push(`      if (headerName.toLowerCase() === lowerName) return value`)
  lines.push(`    }`)
  lines.push(`    return undefined`)
  lines.push(`  }`)
  lines.push('')

  lines.push(`  function __isJsonMediaType(mediaType: string | undefined): boolean {`)
  lines.push(`    if (!mediaType) return false`)
  lines.push(`    const normalized = mediaType.split(';', 1)[0]!.trim().toLowerCase()`)
  lines.push(`    return normalized === 'application/json' || normalized.endsWith('+json')`)
  lines.push(`  }`)
  lines.push('')

  lines.push(`  function __serializeOaRequestBody(body: unknown, mediaType: string | undefined): BodyInit | undefined {`)
  lines.push(`    if (body === undefined) return undefined`)
  lines.push(`    if (__isJsonMediaType(mediaType)) return JSON.stringify(body)`)
  lines.push(`    if (mediaType?.split(';', 1)[0]!.trim().toLowerCase() === 'text/plain') return typeof body === 'string' ? body : String(body)`)
  lines.push(`    return body as BodyInit`)
  lines.push(`  }`)
  lines.push('')

  lines.push(`  async function __readOaErrorBody(response: Response, mediaTypes: __OaResponseMediaTypes): Promise<unknown> {`)
  lines.push(`    try {`)
  lines.push(`      const declared = __responseMediaType(response.status, mediaTypes)`)
  lines.push(`      return await __readOaBody(response.clone(), __selectOaResponseMediaType(response, declared, true))`)
  lines.push(`    } catch {`)
  lines.push(`      return undefined`)
  lines.push(`    }`)
  lines.push(`  }`)
  lines.push('')

  lines.push(`  type __OaResponseMediaTypes = Record<string, readonly string[] | null>`)
  lines.push('')
  lines.push(`  function __responseMediaType(status: number, mediaTypes: __OaResponseMediaTypes): readonly string[] | null | undefined {`)
  lines.push(`    const exact = String(status)`)
  lines.push(`    if (Object.prototype.hasOwnProperty.call(mediaTypes, exact)) return mediaTypes[exact]`)
  lines.push(`    const range = String(Math.floor(status / 100)) + 'XX'`)
  lines.push(`    if (Object.prototype.hasOwnProperty.call(mediaTypes, range)) return mediaTypes[range]`)
  lines.push(`    return Object.prototype.hasOwnProperty.call(mediaTypes, 'default') ? mediaTypes.default : undefined`)
  lines.push(`  }`)
  lines.push('')
  lines.push(`  function __normalizeOaMediaType(mediaType: string): string {`)
  lines.push(`    return mediaType.split(';', 1)[0]!.trim().toLowerCase()`)
  lines.push(`  }`)
  lines.push('')
  lines.push(`  function __matchingOaMediaType(mediaTypes: readonly string[], mediaType: string): string | undefined {`)
  lines.push(`    const normalized = __normalizeOaMediaType(mediaType)`)
  lines.push(`    return mediaTypes.find(candidate => __normalizeOaMediaType(candidate) === normalized)`)
  lines.push(`  }`)
  lines.push('')
  lines.push(`  function __selectOaRequestMediaType(mediaTypes: readonly string[], headers: Headers): string | undefined {`)
  lines.push(`    if (mediaTypes.length === 0) return undefined`)
  lines.push(`    const configured = headers.get('Content-Type')`)
  lines.push(`    if (configured !== null) {`)
  lines.push(`      const selected = __matchingOaMediaType(mediaTypes, configured)`)
  lines.push(`      if (!selected) throw new TypeError(\`Content-Type \${configured} is not declared for this operation\`)`)
  lines.push(`      return selected`)
  lines.push(`    }`)
  lines.push(`    return mediaTypes[0]`)
  lines.push(`  }`)
  lines.push('')
  lines.push(`  function __selectOaResponseMediaType(response: Response, mediaTypes: readonly string[] | null | undefined, allowActualWhenUndeclared = false): string | null | undefined {`)
  lines.push(`    if (mediaTypes === null) return null`)
  lines.push(`    const actual = response.headers.get('Content-Type')`)
  lines.push(`    if (mediaTypes === undefined) return allowActualWhenUndeclared && actual !== null ? actual : undefined`)
  lines.push(`    if (actual === null) return mediaTypes[0]`)
  lines.push(`    const selected = __matchingOaMediaType(mediaTypes, actual)`)
  lines.push(`    if (!selected) {`)
  lines.push(`      if (allowActualWhenUndeclared) return actual`)
  lines.push(`      throw new TypeError(\`Unexpected response Content-Type \${actual}\`)`)
  lines.push(`    }`)
  lines.push(`    return selected`)
  lines.push(`  }`)
  lines.push('')
  lines.push(`  async function __readOaBody<T>(response: Response, mediaType: string | null | undefined): Promise<T> {`)
  lines.push(`    if (mediaType === null || mediaType === undefined) return undefined as T`)
  lines.push(`    if (__isJsonMediaType(mediaType)) return await response.json() as T`)
  lines.push(`    if (__normalizeOaMediaType(mediaType).startsWith('text/')) return await response.text() as T`)
  lines.push(`    return await response.arrayBuffer() as T`)
  lines.push(`  }`)
  lines.push('')
  lines.push(`  async function __readOaResponseBody<T>(response: Response, method: string, mediaTypes: __OaResponseMediaTypes): Promise<T> {`)
  lines.push(`    if (method.toUpperCase() === 'HEAD' || response.status === 204 || response.status === 205) return undefined as T`)
  lines.push(`    const declared = __responseMediaType(response.status, mediaTypes)`)
  lines.push(`    return await __readOaBody<T>(response, __selectOaResponseMediaType(response, declared))`)
  lines.push(`  }`)
  lines.push('')

  lines.push(`  async function requestResponse<T, THeaders extends object = Record<string, never>>(method: string, path: string, options?: { body?: unknown; query?: Record<string, unknown>; querySpecs?: readonly __OaQuerySpec[]; querystring?: string; headers?: Record<string, string> }, requestMediaTypes: readonly string[] = [], responseMediaTypes: __OaResponseMediaTypes = {}, errorMediaTypes: __OaResponseMediaTypes = {}, responseHeaders?: readonly __OaHeaderSpec[], retryable = false, operationId?: string): Promise<ClientResponse<T, THeaders>> {`)
  lines.push(`    const url = createRequestUrl(path)`)
  lines.push(`    if (options?.querystring !== undefined) {`)
  lines.push(`      if (options.query) throw new TypeError('query and querystring cannot be used together')`)
  lines.push(`      __setOaRawQueryString(url, options.querystring)`)
  lines.push(`    } else if (options?.query) __appendOaQuery(url, options.query, options.querySpecs)`)
  lines.push(`    const selectedRequestMediaType = __selectOaRequestMediaType(requestMediaTypes, __createOaRequestHeaders(undefined, options?.headers))`)
  lines.push(`    const body = __serializeOaRequestBody(options?.body, selectedRequestMediaType)`)
  lines.push(`    let init: RequestInit = {`)
  lines.push(`      method,`)
  lines.push(`      headers: __createOaRequestHeaders(body !== undefined && selectedRequestMediaType ? { 'Content-Type': selectedRequestMediaType } : undefined, options?.headers),`)
  lines.push(`      body,`)
  lines.push(`    }`)
  lines.push(`    for (const mw of config.middleware ?? []) {`)
  lines.push(`      if (mw.onRequest) init = await mw.onRequest(url.toString(), init)`)
  lines.push(`    }`)
  lines.push(`    let lastError: Error | undefined`)
  lines.push(`    for (let attempt = 0; attempt <= maxRetries; attempt++) {`)
  lines.push(`      const controller = timeoutMs ? new AbortController() : undefined`)
  lines.push(`      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined`)
  lines.push(`      const fetchInit = controller ? { ...init, signal: controller.signal } : init`)
  lines.push(`      let res: Response`)
  lines.push(`      try {`)
  lines.push(`        res = await fetch(url.toString(), fetchInit)`)
  lines.push(`      } catch (err) {`)
  lines.push(`        if (timer) clearTimeout(timer)`)
  lines.push(`        lastError = err instanceof Error ? err : new Error(String(err))`)
  lines.push(`        if (retryable && attempt < maxRetries) {`)
  lines.push(`          await new Promise(r => setTimeout(r, baseDelay * 2 ** attempt))`)
  lines.push(`          continue`)
  lines.push(`        }`)
  lines.push(`        notifyError(lastError)`)
  lines.push(`        throw lastError`)
  lines.push(`      }`)
  lines.push(`      if (timer) clearTimeout(timer)`)
  lines.push(`      try {`)
  lines.push(`        for (const mw of config.middleware ?? []) {`)
  lines.push(`          if (mw.onResponse) res = await mw.onResponse(res)`)
  lines.push(`        }`)
  lines.push(`      } catch (err) {`)
  lines.push(`        const error = err instanceof Error ? err : new Error(String(err))`)
  lines.push(`        notifyError(error)`)
  lines.push(`        throw error`)
  lines.push(`      }`)
  lines.push(`      if (!res.ok) {`)
  lines.push(`        if (retryable && res.status >= 500 && attempt < maxRetries) {`)
  lines.push(`          await res.body?.cancel()`)
  lines.push(`          const retryAfter = res.headers.get('Retry-After')`)
  lines.push(`          const delay = retryAfter ? parseRetryAfter(retryAfter) : baseDelay * 2 ** attempt`)
  lines.push(`          await new Promise(r => setTimeout(r, delay))`)
  lines.push(`          continue`)
  lines.push(`        }`)
  lines.push(`        const body = await __readOaErrorBody(res, errorMediaTypes)`)
  lines.push(`        const err = new ClientError(res.status, body, res, operationId)`)
  lines.push(`        notifyError(err)`)
  lines.push(`        throw err`)
  lines.push(`      }`)
  lines.push(`      const headers = responseHeaders ? __readOaResponseHeaders<THeaders>(res.headers, responseHeaders) : {} as THeaders`)
  lines.push(`      try {`)
  lines.push(`        const body = await __readOaResponseBody<T>(res, method, responseMediaTypes)`)
  lines.push(`        return { body, headers, response: res }`)
  lines.push(`      } catch (err) {`)
  lines.push(`        const error = err instanceof Error ? err : new Error(String(err))`)
  lines.push(`        notifyError(error)`)
  lines.push(`        throw error`)
  lines.push(`      }`)
  lines.push(`    }`)
  lines.push(`    throw lastError ?? new Error('Request failed')`)
  lines.push(`  }`)
  lines.push('')
  lines.push(`  async function request<T>(method: string, path: string, options?: { body?: unknown; query?: Record<string, unknown>; querySpecs?: readonly __OaQuerySpec[]; querystring?: string; headers?: Record<string, string> }, requestMediaTypes: readonly string[] = [], responseMediaTypes: __OaResponseMediaTypes = {}, errorMediaTypes: __OaResponseMediaTypes = {}, retryable = false, operationId?: string): Promise<T> {`)
  lines.push(`    return (await requestResponse<T>(method, path, options, requestMediaTypes, responseMediaTypes, errorMediaTypes, undefined, retryable, operationId)).body`)
  lines.push(`  }`)
  lines.push('')

  // Detect which streaming formats are needed
  const needsSse = doc.operations.some(op => op.operationId && getStreamingFormat(op.responses) === 'sse')
  const needsNdjson = doc.operations.some(op => op.operationId && getStreamingFormat(op.responses) === 'ndjson')

  // SSE stream helper (only if needed)
  if (needsSse) {
    lines.push(`  function __oaReadSseData(part: string): string | null {`)
    lines.push(`    const values = part`)
    lines.push(`      .split(/\\r?\\n/)`)
    lines.push(`      .filter(line => line.startsWith('data:'))`)
    lines.push(`      .map(line => line.slice(5).replace(/^ /, ''))`)
    lines.push(`    return values.length > 0 ? values.join('\\n') : null`)
    lines.push(`  }`)
    lines.push('')
    lines.push(`  async function* streamSse<T>(method: string, path: string, options?: { query?: Record<string, unknown>; querySpecs?: readonly __OaQuerySpec[]; querystring?: string; headers?: Record<string, string> }, operationId?: string, errorMediaTypes: __OaResponseMediaTypes = {}, dataMode: 'json' | 'text' = 'json'): AsyncGenerator<T> {`)
    lines.push(`    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined`)
    lines.push(`    let completed = false`)
    lines.push(`    const controller = timeoutMs ? new AbortController() : undefined`)
    lines.push(`    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined`)
    lines.push(`    try {`)
    lines.push(`      const url = createRequestUrl(path)`)
    lines.push(`      if (options?.querystring !== undefined) {`)
    lines.push(`        if (options.query) throw new TypeError('query and querystring cannot be used together')`)
    lines.push(`        __setOaRawQueryString(url, options.querystring)`)
    lines.push(`      } else if (options?.query) __appendOaQuery(url, options.query, options.querySpecs)`)
    lines.push(`      let init: RequestInit = {`)
    lines.push(`        method,`)
    lines.push(`        headers: __createOaRequestHeaders({ Accept: 'text/event-stream' }, options?.headers),`)
    lines.push(`      }`)
    lines.push(`      for (const mw of config.middleware ?? []) {`)
    lines.push(`        if (mw.onRequest) init = await mw.onRequest(url.toString(), init)`)
    lines.push(`      }`)
    lines.push(`      const fetchInit = controller ? { ...init, signal: controller.signal } : init`)
    lines.push(`      let res = await fetch(url.toString(), fetchInit)`)
    lines.push(`      if (timer) clearTimeout(timer)`)
    lines.push(`      for (const mw of config.middleware ?? []) {`)
    lines.push(`        if (mw.onResponse) res = await mw.onResponse(res)`)
    lines.push(`      }`)
    lines.push(`      if (!res.ok) {`)
    lines.push(`        const body = await __readOaErrorBody(res, errorMediaTypes)`)
    lines.push(`        throw new ClientError(res.status, body, res, operationId)`)
    lines.push(`      }`)
    lines.push(`      if (!res.body) return`)
    lines.push(`      reader = res.body.getReader()`)
    lines.push(`      const decoder = new TextDecoder()`)
    lines.push(`      let buffer = ''`)
    lines.push(`      while (true) {`)
    lines.push(`        const { done, value } = await reader.read()`)
    lines.push(`        if (done) { completed = true; break }`)
    lines.push(`        buffer += decoder.decode(value, { stream: true })`)
    lines.push(`        const parts = buffer.split(/\\r?\\n\\r?\\n/)`)
    lines.push(`        buffer = parts.pop() ?? ''`)
    lines.push(`        for (const part of parts) {`)
    lines.push(`          const data = __oaReadSseData(part)`)
    lines.push(`          if (data === null || data.trim() === '[DONE]') continue`)
    lines.push(`          if (dataMode === 'text') { yield data as T; continue }`)
    lines.push(`          try { yield JSON.parse(data) as T } catch { /* skip non-JSON */ }`)
    lines.push(`        }`)
    lines.push(`      }`)
    lines.push(`      buffer += decoder.decode()`)
    lines.push(`      if (buffer) {`)
    lines.push(`        const data = __oaReadSseData(buffer)`)
    lines.push(`        if (data !== null && data.trim() !== '[DONE]') {`)
    lines.push(`          if (dataMode === 'text') yield data as T`)
    lines.push(`          else { try { yield JSON.parse(data) as T } catch { /* skip non-JSON */ } }`)
    lines.push(`        }`)
    lines.push(`      }`)
    lines.push(`    } catch (err) {`)
    lines.push(`      const error = err instanceof Error ? err : new Error(String(err))`)
    lines.push(`      notifyError(error)`)
    lines.push(`      throw error`)
    lines.push(`    } finally {`)
    lines.push(`      if (timer) clearTimeout(timer)`)
    lines.push(`      if (reader && !completed) { try { await reader.cancel() } catch { /* best effort */ } }`)
    lines.push(`    }`)
    lines.push(`  }`)
    lines.push('')
  }

  // NDJSON stream helper (only if needed)
  if (needsNdjson) {
    lines.push(`  async function* streamNdjson<T>(method: string, path: string, options?: { query?: Record<string, unknown>; querySpecs?: readonly __OaQuerySpec[]; querystring?: string; headers?: Record<string, string> }, operationId?: string, errorMediaTypes: __OaResponseMediaTypes = {}): AsyncGenerator<T> {`)
    lines.push(`    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined`)
    lines.push(`    let completed = false`)
    lines.push(`    const controller = timeoutMs ? new AbortController() : undefined`)
    lines.push(`    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined`)
    lines.push(`    try {`)
    lines.push(`      const url = createRequestUrl(path)`)
    lines.push(`      if (options?.querystring !== undefined) {`)
    lines.push(`        if (options.query) throw new TypeError('query and querystring cannot be used together')`)
    lines.push(`        __setOaRawQueryString(url, options.querystring)`)
    lines.push(`      } else if (options?.query) __appendOaQuery(url, options.query, options.querySpecs)`)
    lines.push(`      let init: RequestInit = {`)
    lines.push(`        method,`)
    lines.push(`        headers: __createOaRequestHeaders({ Accept: 'application/x-ndjson' }, options?.headers),`)
    lines.push(`      }`)
    lines.push(`      for (const mw of config.middleware ?? []) {`)
    lines.push(`        if (mw.onRequest) init = await mw.onRequest(url.toString(), init)`)
    lines.push(`      }`)
    lines.push(`      const fetchInit = controller ? { ...init, signal: controller.signal } : init`)
    lines.push(`      let res = await fetch(url.toString(), fetchInit)`)
    lines.push(`      if (timer) clearTimeout(timer)`)
    lines.push(`      for (const mw of config.middleware ?? []) {`)
    lines.push(`        if (mw.onResponse) res = await mw.onResponse(res)`)
    lines.push(`      }`)
    lines.push(`      if (!res.ok) {`)
    lines.push(`        const body = await __readOaErrorBody(res, errorMediaTypes)`)
    lines.push(`        throw new ClientError(res.status, body, res, operationId)`)
    lines.push(`      }`)
    lines.push(`      if (!res.body) return`)
    lines.push(`      reader = res.body.getReader()`)
    lines.push(`      const decoder = new TextDecoder()`)
    lines.push(`      let buffer = ''`)
    lines.push(`      while (true) {`)
    lines.push(`        const { done, value } = await reader.read()`)
    lines.push(`        if (done) { completed = true; break }`)
    lines.push(`        buffer += decoder.decode(value, { stream: true })`)
    lines.push(`        const parts = buffer.split('\\n')`)
    lines.push(`        buffer = parts.pop() ?? ''`)
    lines.push(`        for (const part of parts) {`)
    lines.push(`          const line = part.trim()`)
    lines.push(`          if (!line) continue`)
    lines.push(`          try { yield JSON.parse(line) as T } catch { /* skip non-JSON */ }`)
    lines.push(`        }`)
    lines.push(`      }`)
    lines.push(`      buffer += decoder.decode()`)
    lines.push(`      const finalLine = buffer.trim()`)
    lines.push(`      if (finalLine) { try { yield JSON.parse(finalLine) as T } catch { /* skip non-JSON */ } }`)
    lines.push(`    } catch (err) {`)
    lines.push(`      const error = err instanceof Error ? err : new Error(String(err))`)
    lines.push(`      notifyError(error)`)
    lines.push(`      throw error`)
    lines.push(`    } finally {`)
    lines.push(`      if (timer) clearTimeout(timer)`)
    lines.push(`      if (reader && !completed) { try { await reader.cancel() } catch { /* best effort */ } }`)
    lines.push(`    }`)
    lines.push(`  }`)
    lines.push('')
  }

  // API methods
  lines.push('  return {')
  for (const op of doc.operations) {
    if (!op.operationId) continue
    const baseName = operationNames.get(op.operationId)!
    const methodName = toOperationMethodName(baseName)
    const method = op.method.toUpperCase()

    // build path with template
    const pathParams = op.parameters.filter(p => p.in === 'path')
    const queryParams = op.parameters.filter(p => p.in === 'query')
    const querystringParam = getQuerystringParameter(op.parameters)
    const headerParams = op.parameters.filter(p => p.in === 'header')
    const hasBody = !!op.requestBody
    const bodyRequired = op.requestBody?.required === true
    const requestMediaTypes = getRequestMediaTypes(op.requestBody)
    const hasTypedBody = !!typesImport && !!op.requestBody && requestMediaTypes.length <= 1 && hasGeneratedRequestBodyType(op.requestBody)
    const hasTypedResponse = !!typesImport && hasGeneratedResponseType(op.responses)
    const responseMediaTypes = formatResponseMediaTypes(op.responses)
    const errorMediaTypes = formatErrorMediaTypes(op.responses)
    const acceptsRequestHeaders = headerParams.length > 0 || requestMediaTypes.length > 1

    // JSDoc
    if (op.summary || op.description) {
      lines.push(`    /** ${op.summary ?? op.description} */`)
    }

    // function signature
    const params: string[] = []
    if (pathParams.length > 0) params.push(`params: ${typesImport ? `${baseName}PathParams` : 'Record<string, string>'}`)
    if (hasBody && bodyRequired) params.push(`body: ${hasTypedBody ? `${baseName}Body` : 'unknown'}`)
    if (querystringParam?.required === true) params.push(`querystring: ${typesImport ? `${baseName}QueryString` : 'string'}`)
    if (queryParams.length > 0) params.push(`query?: ${typesImport ? `${baseName}QueryParams` : 'Record<string, unknown>'}`)
    if (querystringParam && querystringParam.required !== true) params.push(`querystring?: ${typesImport ? `${baseName}QueryString` : 'string'}`)
    if (hasBody && !bodyRequired) params.push(`body?: ${hasTypedBody ? `${baseName}Body` : 'unknown'}`)
    if (acceptsRequestHeaders) params.push(`headers?: ${headerParams.length > 0 && typesImport ? `${baseName}HeaderParams` : 'Record<string, unknown>'}`)

    const responseType = hasTypedResponse ? `${baseName}Response` : 'unknown'
    const hasResponse = hasDocumentedSuccessResponseBody(op.responses)

    // streaming format detection
    const streamFormat = getStreamingFormat(op.responses)
    const returnType = streamFormat
      ? `AsyncGenerator<${responseType}>`
      : hasResponse ? `Promise<${responseType}>` : 'Promise<void>'

    // path template
    const pathExpr = renderPathExpression(op.openApiPath, pathParams)

    const retryable = isOperationRetryable(op)

    if (streamFormat) {
      const helperName = streamFormat === 'sse' ? 'streamSse' : 'streamNdjson'
      lines.push(`    async *${methodName}(${params.join(', ')}): ${returnType} {`)
      if (acceptsRequestHeaders) lines.push(`      const requestHeaders = __mergeOaRequestHeaders(headers)`)
      lines.push(...requestValidationLines(op, '      ', acceptsRequestHeaders ? 'requestHeaders' : 'headers'))
      const streamOpts: string[] = []
      if (queryParams.length > 0) {
        streamOpts.push('query: query as Record<string, unknown>')
        streamOpts.push(`querySpecs: ${formatQuerySpecs(queryParams)}`)
      }
      if (querystringParam) streamOpts.push('querystring')
      if (acceptsRequestHeaders) streamOpts.push('headers: __serializeOaRequestHeaders(requestHeaders)')
      lines.push(`      yield* ${helperName}('${method}', ${pathExpr}, ${streamOpts.length > 0 ? `{ ${streamOpts.join(', ')} }` : 'undefined'}, ${JSON.stringify(op.operationId)}, ${errorMediaTypes}${streamFormat === 'sse' && getSseDataMode(op.responses) === 'text' ? ", 'text'" : ''})`)
      lines.push(`    },`)
    } else {
      lines.push(`    async ${methodName}(${params.join(', ')}): ${returnType} {`)
      if (acceptsRequestHeaders) lines.push(`      const requestHeaders = __mergeOaRequestHeaders(headers)`)
      lines.push(...requestValidationLines(op, '      ', acceptsRequestHeaders ? 'requestHeaders' : 'headers'))
      const fetchOpts: string[] = []
      if (hasBody) fetchOpts.push('body')
      if (queryParams.length > 0) {
        fetchOpts.push('query: query as Record<string, unknown>')
        fetchOpts.push(`querySpecs: ${formatQuerySpecs(queryParams)}`)
      }
      if (querystringParam) fetchOpts.push('querystring')
      if (acceptsRequestHeaders) fetchOpts.push('headers: __serializeOaRequestHeaders(requestHeaders)')
      const optsArg = fetchOpts.length > 0 ? `, { ${fetchOpts.join(', ')} }` : ', undefined'
      lines.push(`      return request('${method}', ${pathExpr}${optsArg}, ${JSON.stringify(requestMediaTypes)}, ${responseMediaTypes}, ${errorMediaTypes}, ${retryable}, ${JSON.stringify(op.operationId)})`)
      lines.push(`    },`)
    }
    lines.push('')
  }
  if (responseHeaderOperations.length > 0) {
    lines.push('    withResponse: {')
    for (const op of responseHeaderOperations) {
      if (!op.operationId) continue
      const baseName = operationNames.get(op.operationId)!
      const methodName = toOperationMethodName(baseName)
      const method = op.method.toUpperCase()
      const pathParams = op.parameters.filter(p => p.in === 'path')
      const queryParams = op.parameters.filter(p => p.in === 'query')
      const querystringParam = getQuerystringParameter(op.parameters)
      const headerParams = op.parameters.filter(p => p.in === 'header')
      const hasBody = !!op.requestBody
      const bodyRequired = op.requestBody?.required === true
      const requestMediaTypes = getRequestMediaTypes(op.requestBody)
      const hasTypedBody = !!typesImport && !!op.requestBody && requestMediaTypes.length <= 1 && hasGeneratedRequestBodyType(op.requestBody)
      const hasTypedResponse = !!typesImport && hasGeneratedResponseType(op.responses)
      const responseMediaTypes = formatResponseMediaTypes(op.responses)
      const errorMediaTypes = formatErrorMediaTypes(op.responses)
      const acceptsRequestHeaders = headerParams.length > 0 || requestMediaTypes.length > 1
      const params: string[] = []
      if (pathParams.length > 0) params.push(`params: ${typesImport ? `${baseName}PathParams` : 'Record<string, string>'}`)
      if (hasBody && bodyRequired) params.push(`body: ${hasTypedBody ? `${baseName}Body` : 'unknown'}`)
      if (querystringParam?.required === true) params.push(`querystring: ${typesImport ? `${baseName}QueryString` : 'string'}`)
      if (queryParams.length > 0) params.push(`query?: ${typesImport ? `${baseName}QueryParams` : 'Record<string, unknown>'}`)
      if (querystringParam && querystringParam.required !== true) params.push(`querystring?: ${typesImport ? `${baseName}QueryString` : 'string'}`)
      if (hasBody && !bodyRequired) params.push(`body?: ${hasTypedBody ? `${baseName}Body` : 'unknown'}`)
      if (acceptsRequestHeaders) params.push(`headers?: ${headerParams.length > 0 && typesImport ? `${baseName}HeaderParams` : 'Record<string, unknown>'}`)

      const hasResponse = hasDocumentedSuccessResponseBody(op.responses)
      const bodyType = hasTypedResponse ? `${baseName}Response` : hasResponse ? 'unknown' : 'void'
      const headersType = hasGeneratedResponseHeaders(op.responses)
        ? typesImport ? `${baseName}ResponseHeaders` : 'Record<string, unknown>'
        : 'Record<string, never>'
      const pathExpr = renderPathExpression(op.openApiPath, pathParams)
      const fetchOpts: string[] = []
      if (hasBody) fetchOpts.push('body')
      if (queryParams.length > 0) {
        fetchOpts.push('query: query as Record<string, unknown>')
        fetchOpts.push(`querySpecs: ${formatQuerySpecs(queryParams)}`)
      }
      if (querystringParam) fetchOpts.push('querystring')
      if (acceptsRequestHeaders) fetchOpts.push('headers: __serializeOaRequestHeaders(requestHeaders)')
      const optsArg = fetchOpts.length > 0 ? `{ ${fetchOpts.join(', ')} }` : 'undefined'
      const headerSpecs = formatHeaderSpecs(responseHeadersToReadSpecs(op.responses))
      const retryable = isOperationRetryable(op)

      if (op.summary || op.description) {
        lines.push(`      /** ${op.summary ?? op.description} */`)
      }
      lines.push(`      async ${methodName}(${params.join(', ')}): Promise<ClientResponse<${bodyType}, ${headersType}>> {`)
      if (acceptsRequestHeaders) lines.push(`        const requestHeaders = __mergeOaRequestHeaders(headers)`)
      lines.push(...requestValidationLines(op, '        ', acceptsRequestHeaders ? 'requestHeaders' : 'headers'))
      lines.push(`        return requestResponse<${bodyType}, ${headersType}>('${method}', ${pathExpr}, ${optsArg}, ${JSON.stringify(requestMediaTypes)}, ${responseMediaTypes}, ${errorMediaTypes}, ${headerSpecs}, ${retryable}, ${JSON.stringify(op.operationId)})`)
      lines.push(`      },`)
      lines.push('')
    }
    lines.push('    },')
  }
  lines.push('  }')
  lines.push('}')

  // ─── Webhook Types ─────────────────────────────────────────────
  if (doc.webhooks.length > 0) {
    lines.push('')
    lines.push('// ─── Webhook Types ─────────────────────────────────────────────')
    for (const op of doc.webhooks) {
      if (!op.operationId) continue
      const baseName = operationNames.get(op.operationId)!
      const typeName = `${baseName}Webhook`

      // JSDoc
      if (op.summary || op.description) {
        lines.push(`/** ${op.summary ?? op.description} */`)
      }

      // Extract request body schema properties for the type
      const bodyContent = op.requestBody?.content
      const jsonMediaRaw = bodyContent?.['application/json']
      const jsonMedia = jsonMediaRaw && !('$ref' in jsonMediaRaw) ? jsonMediaRaw : undefined
      const schema = jsonMedia?.schema as Record<string, unknown> | undefined

      if (schema && schema.type === 'object' && schema.properties) {
        const props = schema.properties as Record<string, Record<string, unknown>>
        const required = (schema.required ?? []) as string[]
        const fields: string[] = []
        for (const [propName, propSchema] of Object.entries(props)) {
          const tsType = oasTypeToTs(propSchema.type as string | undefined)
          const opt = required.includes(propName) ? '' : '?'
          fields.push(`  ${escapeKey(propName)}${opt}: ${tsType}`)
        }
        lines.push(`export type ${typeName} = {`)
        for (const field of fields) lines.push(field)
        lines.push('}')
      } else {
        lines.push(`export type ${typeName} = unknown`)
      }
      lines.push('')
    }
  }

  return formatGeneratedTs(lines.join('\n'))
}

/** Maps OAS primitive type to TypeScript type */
function oasTypeToTs(type: string | undefined): string {
  switch (type) {
    case 'string': return 'string'
    case 'integer':
    case 'number': return 'number'
    case 'boolean': return 'boolean'
    case 'array': return 'unknown[]'
    case 'object': return 'Record<string, unknown>'
    default: return 'unknown'
  }
}

/** Renders a URL-safe OpenAPI path expression for generated client methods. */
function renderPathExpression(openApiPath: string, pathParams: readonly OasParameter[]): string {
  const knownPathParams = new Set(pathParams.map(parameter => parameter.name))
  if (knownPathParams.size === 0) return quoteTypeScriptString(openApiPath)

  let template = ''
  let cursor = 0
  for (const match of openApiPath.matchAll(/\{([^}]+)\}/g)) {
    const fullMatch = match[0]
    const name = match[1]
    if (!fullMatch || !name) continue
    const index = match.index ?? 0
    if (!knownPathParams.has(name)) continue
    if (index > cursor) template += escapeTemplateLiteral(openApiPath.slice(cursor, index))
    template += '${encodeURIComponent(String(params[' + JSON.stringify(name) + ']))}'
    cursor = index + fullMatch.length
  }
  if (cursor < openApiPath.length) template += escapeTemplateLiteral(openApiPath.slice(cursor))
  return template ? '`' + template + '`' : quoteTypeScriptString(openApiPath)
}

function escapeTemplateLiteral(value: string): string {
  return value.replace(/[\\`]/g, '\\$&').replace(/\$\{/g, '\\${')
}

function formatQuerySpecs(parameters: readonly OasParameter[]): string {
  const specs = parameters.map(parameter => {
    const style = parameter.style ?? 'form'
    const explode = parameter.explode ?? style === 'form'
    return `{ name: ${JSON.stringify(parameter.name)}, style: ${JSON.stringify(style)}, explode: ${explode} }`
  })
  return `[${specs.join(', ')}]`
}

/** Returns the streaming format of the operation, or null if not streaming */
function getStreamingFormat(responses: Record<string, unknown>): 'sse' | 'ndjson' | null {
  for (const res of Object.values(responses)) {
    if (!res || typeof res !== 'object') continue
    const content = (res as Record<string, unknown>)['content'] as Record<string, unknown> | undefined
    if (!content) continue
    for (const ct of Object.keys(content)) {
      if (ct === 'text/event-stream') return 'sse'
      if (ct === 'application/x-ndjson' || ct === 'application/jsonl') return 'ndjson'
    }
  }
  return null
}

function getRequestMediaTypes(requestBody: OasRequestBody | undefined): string[] {
  if (!requestBody?.content) return []
  return orderPreferredMediaTypes(Object.keys(requestBody.content))
}

function formatResponseMediaTypes(responses: Record<string, OasResponse>): string {
  const entries = Object.entries(responses).map(([status, response]) => {
    const mediaTypes = response?.content ? orderPreferredMediaTypes(Object.keys(response.content)) : []
    return `${JSON.stringify(status)}: ${mediaTypes.length === 0 ? 'null' : JSON.stringify(mediaTypes)}`
  })
  return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`
}

function formatErrorMediaTypes(responses: Record<string, OasResponse>): string {
  const entries = Object.entries(responses)
    .filter(([status]) => /^[45](?:\d{2}|XX)$/i.test(status) || status === 'default')
    .map(([status, response]) => {
      const mediaTypes = response?.content ? orderPreferredMediaTypes(Object.keys(response.content)) : []
      return `${JSON.stringify(status)}: ${mediaTypes.length === 0 ? 'null' : JSON.stringify(mediaTypes)}`
    })
  return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`
}

function hasDocumentedSuccessResponseBody(responses: Record<string, OasResponse>): boolean {
  return Object.entries(responses).some(([status, response]) => {
    if (!(/^[2]\d{2}$/.test(status) || /^2XX$/i.test(status) || status === 'default')) return false
    if (status === '204' || status === '205') return false
    return response?.content !== undefined && Object.keys(response.content).length > 0
  })
}

function getSseDataMode(responses: Record<string, OasResponse>): 'json' | 'text' {
  const response = pickDocumentedHeaderResponse(responses)
  const media = response?.content?.['text/event-stream']
  if (!media || '$ref' in media) return 'json'
  const itemSchema = media.itemSchema ?? media.schema
  if (!itemSchema || typeof itemSchema !== 'object' || '$ref' in itemSchema) return 'json'
  const schema = itemSchema as OasSchema
  const mediaType = schema.contentMediaType?.split(';', 1)[0]?.trim().toLowerCase()
  return schema.type === 'string' && !mediaType?.endsWith('json') ? 'text' : 'json'
}

function pickPreferredMediaType(mediaTypes: readonly string[]): string | undefined {
  return mediaTypes.find(isJsonMediaTypeName)
    ?? mediaTypes.find(mediaType => mediaType.split(';', 1)[0]?.trim().toLowerCase() === 'text/plain')
    ?? mediaTypes[0]
}

function orderPreferredMediaTypes(mediaTypes: readonly string[]): string[] {
  const preferred = pickPreferredMediaType(mediaTypes)
  return preferred === undefined ? [] : [preferred, ...mediaTypes.filter(mediaType => mediaType !== preferred)]
}

function isJsonMediaTypeName(mediaType: string): boolean {
  const normalized = mediaType.split(';', 1)[0]?.trim().toLowerCase()
  return normalized === 'application/json' || normalized?.endsWith('+json') === true
}

type HeaderReadSpec = {
  name: string
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array'
  items?: 'string' | 'number' | 'integer' | 'boolean'
}

function hasGeneratedResponseHeaders(responses: Record<string, OasResponse>): boolean {
  return responseHeadersToReadSpecs(responses).length > 0
}

function hasGeneratedRequestBodyType(requestBody: OasRequestBody): boolean {
  const jsonContent = requestBody.content?.['application/json']
  return !!jsonContent && !('$ref' in jsonContent) && jsonContent.schema !== undefined
}

function hasGeneratedResponseType(responses: Record<string, OasResponse>): boolean {
  const response = pickDocumentedHeaderResponse(responses)
  if (!response?.content) return false
  const jsonContent = response.content['application/json']
  return !!jsonContent && !('$ref' in jsonContent) && jsonContent.schema !== undefined
}

function responseHeadersToReadSpecs(responses: Record<string, OasResponse>): HeaderReadSpec[] {
  const response = pickDocumentedHeaderResponse(responses)
  if (!response?.headers) return []
  return Object.entries(response.headers)
    .filter(([, header]) => !('$ref' in header))
    .map(([name, header]) => {
      const schema = (header as { schema?: OasSchema }).schema
      const valueType = headerValueType(schema)
      return {
        name,
        type: valueType.type,
        ...(valueType.items ? { items: valueType.items } : {}),
      }
    })
}

function pickDocumentedHeaderResponse(responses: Record<string, OasResponse>): OasResponse | undefined {
  const codes = Object.keys(responses).filter(k => /^2\d{2}$/.test(k)).sort()
  const key = codes[0] ?? 'default'
  return responses[key]
}

function headerValueType(schema: OasSchema | undefined): Omit<HeaderReadSpec, 'name'> {
  const rawType = schema?.type
  const type = Array.isArray(rawType) ? rawType.find(t => t !== 'null') : rawType
  if (type === 'integer' || type === 'number' || type === 'boolean' || type === 'array') {
    if (type !== 'array') return { type }
    const itemType = Array.isArray(schema?.items) ? undefined : headerValueType(schema?.items as OasSchema | undefined).type
    return {
      type: 'array',
      ...(itemType && itemType !== 'array' ? { items: itemType } : {}),
    }
  }
  return { type: 'string' }
}

function formatHeaderSpecs(specs: HeaderReadSpec[]): string {
  const entries = specs.map(spec => {
    const fields = [
      `name: ${JSON.stringify(spec.name)}`,
      `type: ${JSON.stringify(spec.type)}`,
      ...(spec.items ? [`items: ${JSON.stringify(spec.items)}`] : []),
    ]
    return `{ ${fields.join(', ')} }`
  })
  return `[${entries.join(', ')}]`
}
