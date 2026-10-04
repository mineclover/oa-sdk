/** Shared HTTP authentication and bounded JSON decoding for REST and MCP. */
import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

export type ToolRequestHeaders = Record<string, string | string[] | undefined> | Headers

export interface ToolHttpSecurityOptions {
  /** Optional shared bearer credential. Set this when accepting requests from other processes or hosts. */
  authToken?: string | undefined
  /** Browser origins allowed to access tools. Requests with Origin are denied unless listed. */
  allowedOrigins?: string[] | undefined
  /** Maximum JSON request size in bytes (default: 1 MiB). */
  maxBodyBytes?: number | undefined
}

export class ToolHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'ToolHttpError'
  }
}

export function readToolHeader(headers: ToolRequestHeaders | undefined, name: string): string | undefined {
  if (!headers) return undefined
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined
  const values = Object.entries(headers).filter(([key]) => key.toLowerCase() === name.toLowerCase())
  if (values.length !== 1) return undefined
  const value = values[0]![1]
  return typeof value === 'string' ? value : undefined
}

export function validateToolHttpOptions(options: ToolHttpSecurityOptions): number {
  const limit = options.maxBodyBytes ?? 1024 * 1024
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError('maxBodyBytes must be a positive safe integer')
  if (options.authToken !== undefined && (!options.authToken || /[\r\n]/.test(options.authToken))) {
    throw new TypeError('authToken must be a non-empty single-line string')
  }
  return limit
}

/** Checks headers before reading a body or revealing tool catalog data. */
export function authorizeToolHttpRequest(headers: ToolRequestHeaders | undefined, options: ToolHttpSecurityOptions): void {
  const origin = readToolHeader(headers, 'origin')
  if (origin !== undefined && !(options.allowedOrigins ?? []).includes(origin)) {
    throw new ToolHttpError(403, 'Origin not allowed')
  }
  if (options.authToken !== undefined) {
    const expected = Buffer.from(`Bearer ${options.authToken}`)
    const actual = Buffer.from(readToolHeader(headers, 'authorization') ?? '')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new ToolHttpError(401, 'Unauthorized')
    }
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new ToolHttpError(400, 'Invalid JSON')
  }
}

export async function readToolJsonRequest(request: Request, maxBytes: number): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) throw new ToolHttpError(400, 'Invalid JSON')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > maxBytes) {
        void reader.cancel().catch(() => {})
        throw new ToolHttpError(413, 'Request body too large')
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  return parseJson(Buffer.concat(chunks).toString('utf8'))
}

export async function readToolNodeJsonRequest(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  // destroyOnReturn:false lets the adapter send 413 before closing an oversized request.
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > maxBytes) {
      request.resume()
      throw new ToolHttpError(413, 'Request body too large')
    }
    chunks.push(buffer)
  }
  return parseJson(Buffer.concat(chunks).toString('utf8'))
}
