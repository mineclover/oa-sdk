import { RpcError, toRpcError, type RpcErrorCode } from './errors.js'
import type { RpcFetchHandler } from './http.js'
import { invokeServer, type RpcServer } from './server.js'
import type { RpcHeadersInit, RpcTransport } from './types.js'

export type JsonRpcId = string | number | null

export type JsonRpcRequest = {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
  /** Absent for a notification, which gets no response. */
  id?: JsonRpcId
}

export type JsonRpcErrorObject = {
  code: number
  message: string
  /** oa-sdk error details: the `RpcError` code, HTTP status, and payload. */
  data?: { code: RpcErrorCode; status: number; data?: unknown }
}

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId; result: unknown }
  | { jsonrpc: '2.0'; id: JsonRpcId; error: JsonRpcErrorObject }

const JSON_RPC_CODE_BY_ERROR: Readonly<Record<string, number>> = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  PROCEDURE_NOT_FOUND: -32601,
  INVALID_INPUT: -32602,
  INTERNAL: -32603,
}

const ERROR_BY_JSON_RPC_CODE: Readonly<Record<number, RpcErrorCode>> = {
  [-32700]: 'PARSE_ERROR',
  [-32600]: 'INVALID_REQUEST',
  [-32601]: 'PROCEDURE_NOT_FOUND',
  [-32602]: 'INVALID_INPUT',
  [-32603]: 'INTERNAL',
}

/** Application errors use the JSON-RPC server error range; their code travels in `error.data.code`. */
const APPLICATION_ERROR_CODE = -32000

export function toJsonRpcError(error: RpcError): JsonRpcErrorObject {
  return {
    code: JSON_RPC_CODE_BY_ERROR[error.code] ?? APPLICATION_ERROR_CODE,
    message: error.message,
    data: {
      code: error.code,
      status: error.status,
      ...(error.data === undefined ? {} : { data: error.data }),
    },
  }
}

/**
 * Restores an `RpcError` from a JSON-RPC error object. `data` may come from any peer: when it holds
 * oa-sdk details (a string `code`), they are used; otherwise the code is derived from `error.code`
 * and `data` is kept as the error payload.
 */
export function fromJsonRpcError(error: JsonRpcErrorPayload): RpcError {
  const details = error.data
  if (isRecord(details) && typeof details.code === 'string') {
    return new RpcError(details.code, error.message, {
      ...(typeof details.status === 'number' ? { status: details.status } : {}),
      ...(details.data === undefined ? {} : { data: details.data }),
    })
  }
  return new RpcError(ERROR_BY_JSON_RPC_CODE[error.code] ?? 'INTERNAL', error.message, {
    ...(details === undefined ? {} : { data: details }),
  })
}

/** A JSON-RPC error object as any peer may send it: `data` is whatever the peer put there. */
type JsonRpcErrorPayload = { code: number; message: string; data?: unknown }

/**
 * A named runtime validator: `parse` checks an untrusted value and returns it as `T`, or throws a
 * `TypeError` when it does not fit.
 */
interface JsonRpcSchema<T> {
  parse(value: unknown): T
}

/** One entry of an incoming message, checked against the JSON-RPC 2.0 request object. */
type JsonRpcInboundEntry =
  | { kind: 'call'; request: JsonRpcRequest; id: JsonRpcId; notification: boolean }
  /** Answered with `error` unless it is a notification. */
  | { kind: 'invalid'; id: JsonRpcId; error: RpcError; notification: boolean }

/** An incoming message: a single entry or a non-empty batch. An empty batch is one invalid entry. */
type JsonRpcInboundMessage =
  | { batch: false; entry: JsonRpcInboundEntry }
  | { batch: true; entries: JsonRpcInboundEntry[] }

function parseInboundEntry(entry: unknown): JsonRpcInboundEntry {
  if (!isRecord(entry) || entry.jsonrpc !== '2.0' || typeof entry.method !== 'string' || !isValidId(entry.id)) {
    const id = isRecord(entry) && isValidId(entry.id) ? entry.id ?? null : null
    // An invalid request is answered even without an id: the sender cannot be told otherwise.
    return { kind: 'invalid', id, error: new RpcError('INVALID_REQUEST', 'Invalid Request'), notification: false }
  }
  const notification = !Object.hasOwn(entry, 'id')
  const id = entry.id ?? null
  const params = entry.params
  if (params !== undefined && !isRecord(params)) {
    return { kind: 'invalid', id, error: new RpcError('INVALID_INPUT', 'params must be an object of named input fields'), notification }
  }
  const request: JsonRpcRequest = {
    jsonrpc: '2.0',
    method: entry.method,
    ...(params === undefined ? {} : { params }),
    ...(notification ? {} : { id }),
  }
  return { kind: 'call', request, id, notification }
}

/**
 * Classifies an incoming JSON-RPC message. It never throws: every shape problem becomes an
 * `invalid` entry, because JSON-RPC answers a malformed request instead of dropping it.
 */
const JsonRpcInboundSchema: JsonRpcSchema<JsonRpcInboundMessage> = {
  parse(value) {
    if (!Array.isArray(value)) return { batch: false, entry: parseInboundEntry(value) }
    if (value.length === 0) {
      return { batch: false, entry: { kind: 'invalid', id: null, error: new RpcError('INVALID_REQUEST', 'Empty batch'), notification: false } }
    }
    return { batch: true, entries: value.map(parseInboundEntry) }
  },
}

/** A JSON-RPC 2.0 response object as received by a client. */
type JsonRpcResponseMessage =
  | { id: JsonRpcId; error: JsonRpcErrorPayload }
  | { id: JsonRpcId; result: unknown }

function parseErrorPayload(value: unknown): JsonRpcErrorPayload {
  if (!isRecord(value) || typeof value.code !== 'number' || !Number.isInteger(value.code) || typeof value.message !== 'string') {
    throw new TypeError('JSON-RPC error must be an object with an integer code and a string message')
  }
  return { code: value.code, message: value.message, ...(value.data === undefined ? {} : { data: value.data }) }
}

/**
 * Checks a JSON-RPC 2.0 response object: `jsonrpc: '2.0'`, a valid `id`, and either an error
 * object (integer `code`, string `message`) or a `result`. An `error` member that is `null` counts
 * as absent, because some servers send `"error": null` next to the result of a successful call.
 */
const JsonRpcResponseSchema: JsonRpcSchema<JsonRpcResponseMessage> = {
  parse(value) {
    if (!isRecord(value) || value.jsonrpc !== '2.0') {
      throw new TypeError('Expected a JSON-RPC 2.0 response object')
    }
    const id = value.id
    if (!Object.hasOwn(value, 'id') || !isValidId(id) || id === undefined) {
      throw new TypeError('JSON-RPC response id must be a string, a finite number, or null')
    }
    if (value.error !== undefined && value.error !== null) return { id, error: parseErrorPayload(value.error) }
    if (Object.hasOwn(value, 'result')) return { id, result: value.result }
    throw new TypeError('JSON-RPC response has neither result nor error')
  },
}

export type JsonRpcHandleOptions<TContext> = {
  context?: TContext
  request?: Request
  signal?: AbortSignal
}

/**
 * Answers a JSON-RPC 2.0 message (a request, a notification, or a batch, as text or parsed JSON).
 * Resolves `undefined` when nothing needs to be sent back (only notifications).
 * Usable over any message channel: HTTP, WebSocket, a WebRTC data channel, `postMessage`.
 */
export async function handleJsonRpc<TContext>(
  server: RpcServer<TContext>,
  message: unknown,
  options: JsonRpcHandleOptions<TContext> = {},
): Promise<JsonRpcResponse | JsonRpcResponse[] | undefined> {
  let payload: JsonRpcInboundMessage
  if (typeof message === 'string') {
    try {
      payload = JsonRpcInboundSchema.parse(JSON.parse(message))
    } catch {
      return errorMessage(null, new RpcError('PARSE_ERROR', 'Parse error'))
    }
  } else {
    payload = JsonRpcInboundSchema.parse(message)
  }

  if (payload.batch) {
    const responses = await Promise.all(payload.entries.map(entry => handleSingle(server, entry, options)))
    const sent = responses.filter((response): response is JsonRpcResponse => response !== undefined)
    return sent.length === 0 ? undefined : sent
  }
  return handleSingle(server, payload.entry, options)
}

async function handleSingle<TContext>(
  server: RpcServer<TContext>,
  entry: JsonRpcInboundEntry,
  options: JsonRpcHandleOptions<TContext>,
): Promise<JsonRpcResponse | undefined> {
  if (entry.kind === 'invalid') {
    return entry.notification ? undefined : errorMessage(entry.id, entry.error)
  }
  const { request, id, notification } = entry
  try {
    const result = await invokeServer(server, request.method, request.params, options)
    return notification ? undefined : { jsonrpc: '2.0', id, result: result === undefined ? null : result }
  } catch (error) {
    return notification ? undefined : errorMessage(id, toRpcError(error))
  }
}

function errorMessage(id: JsonRpcId, error: RpcError): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: toJsonRpcError(error) }
}

function isValidId(id: unknown): id is JsonRpcId | undefined {
  return id === undefined || id === null || typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type JsonRpcFetchHandlerOptions<TContext> = {
  /** Endpoint path; requests to other paths resolve `undefined`. Default: `/rpc`. */
  path?: string
  createContext?: (request: Request) => TContext | Promise<TContext>
}

/** Serves JSON-RPC 2.0 over HTTP `POST` at one endpoint. */
export function createJsonRpcFetchHandler<TContext = undefined>(
  server: RpcServer<TContext>,
  options: JsonRpcFetchHandlerOptions<TContext> = {},
): RpcFetchHandler {
  const path = options.path ?? '/rpc'
  return async (request) => {
    if (new URL(request.url).pathname !== path) return undefined
    if (request.method !== 'POST') {
      return new Response(null, { status: 405, headers: { allow: 'POST' } })
    }
    let context: TContext | undefined
    try {
      context = await options.createContext?.(request)
    } catch (error) {
      const rpcError = toRpcError(error)
      return new Response(encodeJsonRpcResponse(errorMessage(null, rpcError)), {
        status: rpcError.status,
        headers: { 'content-type': 'application/json' },
      })
    }
    const response = await handleJsonRpc(server, await request.text(), {
      ...(context === undefined ? {} : { context }),
      request,
      signal: request.signal,
    })
    if (response === undefined) return new Response(null, { status: 204 })
    const body = Array.isArray(response) ? `[${response.map(encodeJsonRpcResponse).join(',')}]` : encodeJsonRpcResponse(response)
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
}

/**
 * Serializes one response. A result or error payload JSON cannot represent (a `bigint`, a cycle)
 * turns only that response into an `INTERNAL` error for the same id, so the other responses of a
 * batch, whose calls already ran, still reach the client.
 */
function encodeJsonRpcResponse(response: JsonRpcResponse): string {
  try {
    return JSON.stringify(response)
  } catch {
    return JSON.stringify(errorMessage(response.id, new RpcError('INTERNAL', 'Internal server error')))
  }
}

export type JsonRpcTransportOptions = {
  /** JSON-RPC endpoint URL, e.g. `https://api.example.com/rpc`. */
  url: string
  fetch?: typeof globalThis.fetch
  headers?: RpcHeadersInit
}

/** Sends each call as a JSON-RPC 2.0 request over HTTP `POST`. */
export function createJsonRpcTransport(options: JsonRpcTransportOptions): RpcTransport {
  const fetchImpl = options.fetch ?? globalThis.fetch
  let nextId = 1

  return async ({ procedure, input, signal, headers: callHeaders }) => {
    const id = nextId++
    const headers = new Headers(typeof options.headers === 'function' ? await options.headers() : options.headers)
    headers.set('content-type', 'application/json')
    headers.set('accept', 'application/json')
    for (const [name, value] of Object.entries(callHeaders ?? {})) headers.set(name, value)

    const request: JsonRpcRequest = { jsonrpc: '2.0', id, method: procedure.name, params: input }
    let response: Response
    try {
      response = await fetchImpl(options.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new RpcError('TRANSPORT', `Request for ${procedure.name} failed.`, { cause: error })
    }

    let message: JsonRpcResponseMessage
    try {
      message = JsonRpcResponseSchema.parse(JSON.parse(await response.text()))
    } catch (error) {
      if (signal?.aborted) throw error
      throw new RpcError('TRANSPORT', `The ${procedure.name} response is not JSON-RPC (HTTP ${response.status}).`, {
        status: response.status,
        cause: error,
      })
    }
    // A request rejected before its id was read is answered with id null.
    if (message.id === null && 'error' in message) throw fromJsonRpcError(message.error)
    if (message.id !== id) {
      throw new RpcError('TRANSPORT', `The ${procedure.name} response is not a JSON-RPC response to request ${id}.`, {
        status: response.status,
      })
    }
    if ('error' in message) throw fromJsonRpcError(message.error)
    return procedure.output === null ? undefined : message.result
  }
}
