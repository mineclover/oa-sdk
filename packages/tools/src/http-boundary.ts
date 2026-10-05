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

/** A runtime validator applied to a decoded JSON request body before it is returned. */
export interface ToolJsonBodySchema<T> {
  /** Return the validated body or throw; throw a ToolHttpError to choose the HTTP status. */
  parse(value: unknown): T
}

/**
 * Decode a request body. Without a schema the caller receives `unknown` and
 * must validate it; with a schema the decoded value is validated here.
 */
function decodeJsonBody(text: string): unknown
function decodeJsonBody<T>(text: string, schema: ToolJsonBodySchema<T>): T
function decodeJsonBody<T>(text: string, schema?: ToolJsonBodySchema<T>): unknown {
  try {
    if (schema === undefined) return JSON.parse(text)
    return schema.parse(JSON.parse(text))
  } catch (error) {
    // JSON.parse reports malformed text as SyntaxError; schema errors keep their own status.
    if (error instanceof SyntaxError) throw new ToolHttpError(400, 'Invalid JSON')
    throw error
  }
}

async function readRequestText(request: Request, maxBytes: number): Promise<string> {
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
  return Buffer.concat(chunks).toString('utf8')
}

async function readNodeRequestText(request: IncomingMessage, maxBytes: number): Promise<string> {
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
  return Buffer.concat(chunks).toString('utf8')
}

/** Read a bounded JSON body from a Fetch request, optionally validating it with `schema`. */
export async function readToolJsonRequest(request: Request, maxBytes: number): Promise<unknown>
export async function readToolJsonRequest<T>(request: Request, maxBytes: number, schema: ToolJsonBodySchema<T>): Promise<T>
export async function readToolJsonRequest<T>(request: Request, maxBytes: number, schema?: ToolJsonBodySchema<T>): Promise<unknown> {
  const text = await readRequestText(request, maxBytes)
  return schema === undefined ? decodeJsonBody(text) : decodeJsonBody(text, schema)
}

/** Read a bounded JSON body from a Node request, optionally validating it with `schema`. */
export async function readToolNodeJsonRequest(request: IncomingMessage, maxBytes: number): Promise<unknown>
export async function readToolNodeJsonRequest<T>(request: IncomingMessage, maxBytes: number, schema: ToolJsonBodySchema<T>): Promise<T>
export async function readToolNodeJsonRequest<T>(request: IncomingMessage, maxBytes: number, schema?: ToolJsonBodySchema<T>): Promise<unknown> {
  const text = await readNodeRequestText(request, maxBytes)
  return schema === undefined ? decodeJsonBody(text) : decodeJsonBody(text, schema)
}
