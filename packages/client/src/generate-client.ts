/**
 * OAS ParsedDocument → fetch 기반 타입 안전 클라이언트 SDK 코드 생성
 *
 * typegen 타입을 import하여 타입 안전 API 클라이언트를 생성합니다.
 */

import type { OasDocument, ParsedDocument } from '@oa-sdk/parser'
import { parseDocument, resolveServerUrl, DEFAULT_PASSES } from '@oa-sdk/parser'
import { pascalCase, collectTypeNames, formatGeneratedTs } from '@oa-sdk/core'

export type ClientOptions = {
  /** typegen 타입 import 경로 (예: './types') */
  typesImport?: string
  /** 헤더 주석 */
  banner?: boolean
}

/**
 * OAS 원본 문서에서 fetch 클라이언트 SDK를 생성합니다.
 */
export function generateClient(spec: OasDocument | ParsedDocument, options: ClientOptions = {}): string {
  const doc: ParsedDocument = 'openapi' in spec ? parseDocument(spec as OasDocument, DEFAULT_PASSES) : spec
  const { typesImport, banner = true } = options
  const lines: string[] = []

  if (banner) {
    lines.push('// Auto-generated client SDK from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/client')
    lines.push('')
  }

  // types import
  if (typesImport) {
    const typeNames = collectTypeNames(doc.operations)
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

  // base URL helper
  const defaultServer = doc.servers[0] ? resolveServerUrl(doc.servers[0]) : ''
  lines.push(`export type ClientConfig = { baseUrl?: string; headers?: Record<string, string>; middleware?: ClientMiddleware[] }`)
  lines.push('')
  lines.push(`export function createClient(config: ClientConfig = {}) {`)
  lines.push(`  const baseUrl = config.baseUrl ?? '${defaultServer}'`)
  lines.push(`  const defaultHeaders = config.headers ?? {}`)
  lines.push('')

  // fetch helper
  lines.push(`  async function request<T>(method: string, path: string, options?: { body?: unknown; query?: Record<string, unknown>; headers?: Record<string, string> }): Promise<T> {`)
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
  lines.push(`    let res = await fetch(url.toString(), init)`)
  lines.push(`    for (const mw of config.middleware ?? []) {`)
  lines.push(`      if (mw.onResponse) res = await mw.onResponse(res)`)
  lines.push(`    }`)
  lines.push(`    if (!res.ok) {`)
  lines.push(`      const err = new Error(\`\${res.status} \${res.statusText}\`)`)
  lines.push(`      for (const mw of config.middleware ?? []) {`)
  lines.push(`        if (mw.onError) mw.onError(err)`)
  lines.push(`      }`)
  lines.push(`      throw err`)
  lines.push(`    }`)
  lines.push(`    if (res.status === 204) return undefined as T`)
  lines.push(`    return res.json() as Promise<T>`)
  lines.push(`  }`)
  lines.push('')

  // Detect which streaming formats are needed
  const needsSse = doc.operations.some(op => op.operationId && getStreamingFormat(op.responses) === 'sse')
  const needsNdjson = doc.operations.some(op => op.operationId && getStreamingFormat(op.responses) === 'ndjson')

  // SSE stream helper (only if needed)
  if (needsSse) {
    lines.push(`  async function* streamSse<T>(method: string, path: string, options?: { query?: Record<string, unknown>; headers?: Record<string, string> }): AsyncGenerator<T> {`)
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
    lines.push(`    let res = await fetch(url.toString(), init)`)
    lines.push(`    for (const mw of config.middleware ?? []) {`)
    lines.push(`      if (mw.onResponse) res = await mw.onResponse(res)`)
    lines.push(`    }`)
    lines.push(`    if (!res.ok) {`)
    lines.push(`      const err = new Error(\`\${res.status} \${res.statusText}\`)`)
    lines.push(`      for (const mw of config.middleware ?? []) {`)
    lines.push(`        if (mw.onError) mw.onError(err)`)
    lines.push(`      }`)
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
    lines.push(`  async function* streamNdjson<T>(method: string, path: string, options?: { query?: Record<string, unknown>; headers?: Record<string, string> }): AsyncGenerator<T> {`)
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
    lines.push(`    let res = await fetch(url.toString(), init)`)
    lines.push(`    for (const mw of config.middleware ?? []) {`)
    lines.push(`      if (mw.onResponse) res = await mw.onResponse(res)`)
    lines.push(`    }`)
    lines.push(`    if (!res.ok) {`)
    lines.push(`      const err = new Error(\`\${res.status} \${res.statusText}\`)`)
    lines.push(`      for (const mw of config.middleware ?? []) {`)
    lines.push(`        if (mw.onError) mw.onError(err)`)
    lines.push(`      }`)
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
    const baseName = pascalCase(op.operationId)
    const method = op.method.toUpperCase()

    // build path with template
    const pathParams = op.parameters.filter(p => p.in === 'path')
    const queryParams = op.parameters.filter(p => p.in === 'query')
    const hasBody = !!op.requestBody

    // JSDoc
    if (op.summary || op.description) {
      lines.push(`    /** ${op.summary ?? op.description} */`)
    }

    // function signature
    const params: string[] = []
    if (pathParams.length > 0) params.push(`params: ${typesImport ? `${baseName}PathParams` : 'Record<string, string>'}`)
    if (queryParams.length > 0) params.push(`query?: ${typesImport ? `${baseName}QueryParams` : 'Record<string, unknown>'}`)
    if (hasBody) params.push(`body: ${typesImport ? `${baseName}Body` : 'unknown'}`)

    const responseType = typesImport ? `${baseName}Response` : 'unknown'
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

    if (streamFormat) {
      const helperName = streamFormat === 'sse' ? 'streamSse' : 'streamNdjson'
      lines.push(`    async *${op.operationId}(${params.join(', ')}): ${returnType} {`)
      const streamOpts = queryParams.length > 0 ? `, { query: query as Record<string, unknown> }` : ''
      lines.push(`      yield* ${helperName}('${method}', ${pathExpr}${streamOpts})`)
      lines.push(`    },`)
    } else {
      lines.push(`    async ${op.operationId}(${params.join(', ')}): ${returnType} {`)
      const fetchOpts: string[] = []
      if (hasBody) fetchOpts.push('body')
      if (queryParams.length > 0) fetchOpts.push('query: query as Record<string, unknown>')
      const optsArg = fetchOpts.length > 0 ? `, { ${fetchOpts.join(', ')} }` : ''
      lines.push(`      return request('${method}', ${pathExpr}${optsArg})`)
      lines.push(`    },`)
    }
    lines.push('')
  }
  lines.push('  }')
  lines.push('}')

  // ─── Webhook Types ─────────────────────────────────────────────
  if (doc.webhooks.length > 0) {
    lines.push('')
    lines.push('// ─── Webhook Types ─────────────────────────────────────────────')
    for (const op of doc.webhooks) {
      if (!op.operationId) continue
      const baseName = pascalCase(op.operationId)
      const typeName = `${baseName}Webhook`

      // JSDoc
      if (op.summary || op.description) {
        lines.push(`/** ${op.summary ?? op.description} */`)
      }

      // Extract request body schema properties for the type
      const bodyContent = op.requestBody?.content
      const jsonMedia = bodyContent?.['application/json']
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
