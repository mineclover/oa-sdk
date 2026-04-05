/**
 * OAS ParsedDocument → fetch 기반 타입 안전 클라이언트 SDK 코드 생성
 *
 * typegen 타입을 import하여 타입 안전 API 클라이언트를 생성합니다.
 */

import type { OasDocument, ParsedDocument } from '@oa-sdk/parser'
import { parseDocument } from '@oa-sdk/parser'
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
  const doc: ParsedDocument = 'openapi' in spec ? parseDocument(spec as OasDocument, []) : spec
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

  // base URL helper
  const defaultServer = doc.servers[0]?.url ?? ''
  lines.push(`export type ClientConfig = { baseUrl?: string; headers?: Record<string, string> }`)
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
  lines.push(`    const res = await fetch(url.toString(), {`)
  lines.push(`      method,`)
  lines.push(`      headers: { 'Content-Type': 'application/json', ...defaultHeaders, ...options?.headers },`)
  lines.push(`      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,`)
  lines.push(`    })`)
  lines.push(`    if (!res.ok) throw new Error(\`\${res.status} \${res.statusText}\`)`)
  lines.push(`    if (res.status === 204) return undefined as T`)
  lines.push(`    return res.json() as Promise<T>`)
  lines.push(`  }`)
  lines.push('')

  // SSE stream helper
  lines.push(`  async function* stream<T>(method: string, path: string, options?: { query?: Record<string, unknown>; headers?: Record<string, string> }): AsyncGenerator<T> {`)
  lines.push(`    const url = new URL(path, baseUrl)`)
  lines.push(`    if (options?.query) {`)
  lines.push(`      for (const [k, v] of Object.entries(options.query)) {`)
  lines.push(`        if (v !== undefined) url.searchParams.set(k, String(v))`)
  lines.push(`      }`)
  lines.push(`    }`)
  lines.push(`    const res = await fetch(url.toString(), {`)
  lines.push(`      method,`)
  lines.push(`      headers: { Accept: 'text/event-stream', ...defaultHeaders, ...options?.headers },`)
  lines.push(`    })`)
  lines.push(`    if (!res.ok) throw new Error(\`\${res.status} \${res.statusText}\`)`)
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

    // SSE streaming 감지
    const isStreaming = isStreamingOp(op.responses)
    const returnType = isStreaming
      ? `AsyncGenerator<${responseType}>`
      : hasResponse ? `Promise<${responseType}>` : 'Promise<void>'

    // path template
    let pathExpr: string
    if (pathParams.length > 0) {
      pathExpr = '`' + op.openApiPath.replace(/\{([^}]+)\}/g, '${params.$1}') + '`'
    } else {
      pathExpr = `'${op.openApiPath}'`
    }

    if (isStreaming) {
      lines.push(`    async *${op.operationId}(${params.join(', ')}): ${returnType} {`)
      const streamOpts = queryParams.length > 0 ? `, { query: query as Record<string, unknown> }` : ''
      lines.push(`      yield* stream('${method}', ${pathExpr}${streamOpts})`)
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

  return formatGeneratedTs(lines.join('\n'))
}

function isStreamingOp(responses: Record<string, unknown>): boolean {
  for (const res of Object.values(responses)) {
    if (!res || typeof res !== 'object') continue
    const content = (res as Record<string, unknown>)['content'] as Record<string, unknown> | undefined
    if (!content) continue
    for (const ct of Object.keys(content)) {
      if (ct === 'text/event-stream' || ct === 'application/x-ndjson' || ct === 'application/jsonl') {
        return true
      }
    }
  }
  return false
}
