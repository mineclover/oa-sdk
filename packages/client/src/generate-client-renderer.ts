/**
 * OAS ParsedDocument → fetch 기반 타입 안전 클라이언트 SDK 코드 생성
 *
 * typegen 타입을 import하여 타입 안전 API 클라이언트를 생성합니다.
 */

import type { OasRequestBody, OasResponse, OasSchema, ParsedDocument } from '@oa-sdk/parser/browser'
import { resolveServerUrl } from '@oa-sdk/parser/browser'
import { createOperationTypeNameMap, toOperationMethodName, collectTypeNames, getGeneratedErrorResponseKeys, formatGeneratedTs } from '@oa-sdk/core/browser'
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
  lines.push(`  const baseUrl = config.baseUrl ?? '${defaultServer}'`)
  lines.push(`  const defaultHeaders = config.headers ?? {}`)
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

  lines.push(`  async function __readOaErrorBody(response: Response): Promise<unknown> {`)
  lines.push(`    try {`)
  lines.push(`      const raw = await response.clone().text()`)
  lines.push(`      if (!raw) return undefined`)
  lines.push(`      try { return JSON.parse(raw) } catch { return raw }`)
  lines.push(`    } catch {`)
  lines.push(`      return undefined`)
  lines.push(`    }`)
  lines.push(`  }`)
  lines.push('')

  lines.push(`  async function requestResponse<T, THeaders extends object = Record<string, never>>(method: string, path: string, options?: { body?: unknown; query?: Record<string, unknown>; headers?: Record<string, string> }, responseHeaders?: readonly __OaHeaderSpec[], retryable = false, operationId?: string): Promise<ClientResponse<T, THeaders>> {`)
  lines.push(`    const url = new URL(path, baseUrl)`)
  lines.push(`    if (options?.query) {`)
  lines.push(`      for (const [k, v] of Object.entries(options.query)) {`)
  lines.push(`        if (v !== undefined) url.searchParams.set(k, String(v))`)
  lines.push(`      }`)
  lines.push(`    }`)
  lines.push(`    let init: RequestInit = {`)
  lines.push(`      method,`)
  lines.push(`      headers: { 'Content-Type': 'application/json', ...defaultHeaders, ...options?.headers },`)
  lines.push(`      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,`)
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
  lines.push(`        const body = await __readOaErrorBody(res)`)
  lines.push(`        const err = new ClientError(res.status, body, res, operationId)`)
  lines.push(`        notifyError(err)`)
  lines.push(`        throw err`)
  lines.push(`      }`)
  lines.push(`      const headers = responseHeaders ? __readOaResponseHeaders<THeaders>(res.headers, responseHeaders) : {} as THeaders`)
  lines.push(`      if (res.status === 204) return { body: undefined as T, headers, response: res }`)
  lines.push(`      try {`)
  lines.push(`        const body = await res.json() as T`)
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
  lines.push(`  async function request<T>(method: string, path: string, options?: { body?: unknown; query?: Record<string, unknown>; headers?: Record<string, string> }, retryable = false, operationId?: string): Promise<T> {`)
  lines.push(`    return (await requestResponse<T>(method, path, options, undefined, retryable, operationId)).body`)
  lines.push(`  }`)
  lines.push('')

  // Detect which streaming formats are needed
  const needsSse = doc.operations.some(op => op.operationId && getStreamingFormat(op.responses) === 'sse')
  const needsNdjson = doc.operations.some(op => op.operationId && getStreamingFormat(op.responses) === 'ndjson')

  // SSE stream helper (only if needed)
  if (needsSse) {
    lines.push(`  async function* streamSse<T>(method: string, path: string, options?: { query?: Record<string, unknown>; headers?: Record<string, string> }, operationId?: string): AsyncGenerator<T> {`)
    lines.push(`    const url = new URL(path, baseUrl)`)
    lines.push(`    if (options?.query) {`)
    lines.push(`      for (const [k, v] of Object.entries(options.query)) {`)
    lines.push(`        if (v !== undefined) url.searchParams.set(k, String(v))`)
    lines.push(`      }`)
    lines.push(`    }`)
    lines.push(`    let init: RequestInit = {`)
    lines.push(`      method,`)
    lines.push(`      headers: { Accept: 'text/event-stream', ...defaultHeaders, ...options?.headers },`)
    lines.push(`    }`)
    lines.push(`    for (const mw of config.middleware ?? []) {`)
    lines.push(`      if (mw.onRequest) init = await mw.onRequest(url.toString(), init)`)
    lines.push(`    }`)
    lines.push(`    const controller = timeoutMs ? new AbortController() : undefined`)
    lines.push(`    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined`)
    lines.push(`    const fetchInit = controller ? { ...init, signal: controller.signal } : init`)
    lines.push(`    let res = await fetch(url.toString(), fetchInit)`)
    lines.push(`    if (timer) clearTimeout(timer)`)
    lines.push(`    for (const mw of config.middleware ?? []) {`)
    lines.push(`      if (mw.onResponse) res = await mw.onResponse(res)`)
    lines.push(`    }`)
    lines.push(`    if (!res.ok) {`)
    lines.push(`      const body = await __readOaErrorBody(res)`)
    lines.push(`      const err = new ClientError(res.status, body, res, operationId)`)
    lines.push(`      notifyError(err)`)
    lines.push(`      throw err`)
    lines.push(`    }`)
    lines.push(`    if (!res.body) return`)
    lines.push(`    const reader = res.body.getReader()`)
    lines.push(`    const decoder = new TextDecoder()`)
    lines.push(`    let buffer = ''`)
    lines.push(`    while (true) {`)
    lines.push(`      const { done, value } = await reader.read()`)
    lines.push(`      if (done) break`)
    lines.push(`      buffer += decoder.decode(value, { stream: true })`)
    lines.push(`      const parts = buffer.split('\\n\\n')`)
    lines.push(`      buffer = parts.pop() ?? ''`)
    lines.push(`      for (const part of parts) {`)
    lines.push(`        const line = part.replace(/^data: /, '').trim()`)
    lines.push(`        if (!line || line === '[DONE]') continue`)
    lines.push(`        try { yield JSON.parse(line) as T } catch { /* skip non-JSON */ }`)
    lines.push(`      }`)
    lines.push(`    }`)
    lines.push(`  }`)
    lines.push('')
  }

  // NDJSON stream helper (only if needed)
  if (needsNdjson) {
    lines.push(`  async function* streamNdjson<T>(method: string, path: string, options?: { query?: Record<string, unknown>; headers?: Record<string, string> }, operationId?: string): AsyncGenerator<T> {`)
    lines.push(`    const url = new URL(path, baseUrl)`)
    lines.push(`    if (options?.query) {`)
    lines.push(`      for (const [k, v] of Object.entries(options.query)) {`)
    lines.push(`        if (v !== undefined) url.searchParams.set(k, String(v))`)
    lines.push(`      }`)
    lines.push(`    }`)
    lines.push(`    let init: RequestInit = {`)
    lines.push(`      method,`)
    lines.push(`      headers: { Accept: 'application/x-ndjson', ...defaultHeaders, ...options?.headers },`)
    lines.push(`    }`)
    lines.push(`    for (const mw of config.middleware ?? []) {`)
    lines.push(`      if (mw.onRequest) init = await mw.onRequest(url.toString(), init)`)
    lines.push(`    }`)
    lines.push(`    const controller = timeoutMs ? new AbortController() : undefined`)
    lines.push(`    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined`)
    lines.push(`    const fetchInit = controller ? { ...init, signal: controller.signal } : init`)
    lines.push(`    let res = await fetch(url.toString(), fetchInit)`)
    lines.push(`    if (timer) clearTimeout(timer)`)
    lines.push(`    for (const mw of config.middleware ?? []) {`)
    lines.push(`      if (mw.onResponse) res = await mw.onResponse(res)`)
    lines.push(`    }`)
    lines.push(`    if (!res.ok) {`)
    lines.push(`      const body = await __readOaErrorBody(res)`)
    lines.push(`      const err = new ClientError(res.status, body, res, operationId)`)
    lines.push(`      notifyError(err)`)
    lines.push(`      throw err`)
    lines.push(`    }`)
    lines.push(`    if (!res.body) return`)
    lines.push(`    const reader = res.body.getReader()`)
    lines.push(`    const decoder = new TextDecoder()`)
    lines.push(`    let buffer = ''`)
    lines.push(`    while (true) {`)
    lines.push(`      const { done, value } = await reader.read()`)
    lines.push(`      if (done) break`)
    lines.push(`      buffer += decoder.decode(value, { stream: true })`)
    lines.push(`      const parts = buffer.split('\\n')`)
    lines.push(`      buffer = parts.pop() ?? ''`)
    lines.push(`      for (const part of parts) {`)
    lines.push(`        const line = part.trim()`)
    lines.push(`        if (!line) continue`)
    lines.push(`        try { yield JSON.parse(line) as T } catch { /* skip non-JSON */ }`)
    lines.push(`      }`)
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
    const hasBody = !!op.requestBody
    const hasTypedBody = !!typesImport && !!op.requestBody && hasGeneratedRequestBodyType(op.requestBody)
    const hasTypedResponse = !!typesImport && hasGeneratedResponseType(op.responses)

    // JSDoc
    if (op.summary || op.description) {
      lines.push(`    /** ${op.summary ?? op.description} */`)
    }

    // function signature
    const params: string[] = []
    if (pathParams.length > 0) params.push(`params: ${typesImport ? `${baseName}PathParams` : 'Record<string, string>'}`)
    if (queryParams.length > 0) params.push(`query?: ${typesImport ? `${baseName}QueryParams` : 'Record<string, unknown>'}`)
    if (hasBody) params.push(`body: ${hasTypedBody ? `${baseName}Body` : 'unknown'}`)

    const responseType = hasTypedResponse ? `${baseName}Response` : 'unknown'
    const hasResponse = Object.keys(op.responses).some(k => /^2\d{2}$/.test(k) && k !== '204')

    // streaming format detection
    const streamFormat = getStreamingFormat(op.responses)
    const returnType = streamFormat
      ? `AsyncGenerator<${responseType}>`
      : hasResponse ? `Promise<${responseType}>` : 'Promise<void>'

    // path template
    let pathExpr: string
    if (pathParams.length > 0) {
      pathExpr = '`' + op.openApiPath.replace(/\{([^}]+)\}/g, '${params.$1}') + '`'
    } else {
      pathExpr = `'${op.openApiPath}'`
    }

    const retryable = isOperationRetryable(op)
    const validation = requestValidationLines(op)

    if (streamFormat) {
      const helperName = streamFormat === 'sse' ? 'streamSse' : 'streamNdjson'
      lines.push(`    async *${methodName}(${params.join(', ')}): ${returnType} {`)
      lines.push(...requestValidationLines(op, '      '))
      const streamOpts = queryParams.length > 0
        ? `{ query: query as Record<string, unknown> }`
        : 'undefined'
      lines.push(`      yield* ${helperName}('${method}', ${pathExpr}, ${streamOpts}, ${JSON.stringify(op.operationId)})`)
      lines.push(`    },`)
    } else {
      lines.push(`    async ${methodName}(${params.join(', ')}): ${returnType} {`)
      lines.push(...validation)
      const fetchOpts: string[] = []
      if (hasBody) fetchOpts.push('body')
      if (queryParams.length > 0) fetchOpts.push('query: query as Record<string, unknown>')
      const optsArg = fetchOpts.length > 0 ? `, { ${fetchOpts.join(', ')} }` : ', undefined'
      lines.push(`      return request('${method}', ${pathExpr}${optsArg}, ${retryable}, ${JSON.stringify(op.operationId)})`)
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
      const hasBody = !!op.requestBody
      const hasTypedBody = !!typesImport && !!op.requestBody && hasGeneratedRequestBodyType(op.requestBody)
      const hasTypedResponse = !!typesImport && hasGeneratedResponseType(op.responses)
      const params: string[] = []
      if (pathParams.length > 0) params.push(`params: ${typesImport ? `${baseName}PathParams` : 'Record<string, string>'}`)
      if (queryParams.length > 0) params.push(`query?: ${typesImport ? `${baseName}QueryParams` : 'Record<string, unknown>'}`)
      if (hasBody) params.push(`body: ${hasTypedBody ? `${baseName}Body` : 'unknown'}`)

      const hasResponse = Object.keys(op.responses).some(k => /^2\d{2}$/.test(k) && k !== '204')
      const bodyType = hasTypedResponse ? `${baseName}Response` : hasResponse ? 'unknown' : 'void'
      const headersType = hasGeneratedResponseHeaders(op.responses)
        ? typesImport ? `${baseName}ResponseHeaders` : 'Record<string, unknown>'
        : 'Record<string, never>'
      const pathExpr = pathParams.length > 0
        ? '`' + op.openApiPath.replace(/\{([^}]+)\}/g, '${params.$1}') + '`'
        : `'${op.openApiPath}'`
      const fetchOpts: string[] = []
      if (hasBody) fetchOpts.push('body')
      if (queryParams.length > 0) fetchOpts.push('query: query as Record<string, unknown>')
      const optsArg = fetchOpts.length > 0 ? `{ ${fetchOpts.join(', ')} }` : 'undefined'
      const headerSpecs = formatHeaderSpecs(responseHeadersToReadSpecs(op.responses))
      const retryable = isOperationRetryable(op)

      if (op.summary || op.description) {
        lines.push(`      /** ${op.summary ?? op.description} */`)
      }
      lines.push(`      async ${methodName}(${params.join(', ')}): Promise<ClientResponse<${bodyType}, ${headersType}>> {`)
      lines.push(...requestValidationLines(op, '        '))
      lines.push(`        return requestResponse<${bodyType}, ${headersType}>('${method}', ${pathExpr}, ${optsArg}, ${headerSpecs}, ${retryable}, ${JSON.stringify(op.operationId)})`)
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
          fields.push(`  ${propName}${opt}: ${tsType}`)
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
