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

export function fromJsonRpcError(error: JsonRpcErrorObject): RpcError {
  const details = error.data
  if (details && typeof details === 'object' && typeof details.code === 'string') {
    return new RpcError(details.code, error.message, {
      ...(typeof details.status === 'number' ? { status: details.status } : {}),
      ...(details.data === undefined ? {} : { data: details.data }),
    })
  }
  return new RpcError(ERROR_BY_JSON_RPC_CODE[error.code] ?? 'INTERNAL', error.message, {
    ...(details === undefined ? {} : { data: details }),
  })
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
  let payload = message
  if (typeof message === 'string') {
    try {
      payload = JSON.parse(message)
    } catch {
      return errorMessage(null, new RpcError('PARSE_ERROR', 'Parse error'))
    }
  }

  if (Array.isArray(payload)) {
    if (payload.length === 0) return errorMessage(null, new RpcError('INVALID_REQUEST', 'Empty batch'))
    const responses = await Promise.all(payload.map(entry => handleSingle(server, entry, options)))
    const sent = responses.filter((response): response is JsonRpcResponse => response !== undefined)
    return sent.length === 0 ? undefined : sent
  }
  return handleSingle(server, payload, options)
}

async function handleSingle<TContext>(
  server: RpcServer<TContext>,
  entry: unknown,
  options: JsonRpcHandleOptions<TContext>,
): Promise<JsonRpcResponse | undefined> {
  if (!isRecord(entry) || entry.jsonrpc !== '2.0' || typeof entry.method !== 'string' || !isValidId(entry.id)) {
    const id = isRecord(entry) && isValidId(entry.id) ? entry.id ?? null : null
    return errorMessage(id, new RpcError('INVALID_REQUEST', 'Invalid Request'))
  }
  const isNotification = !Object.hasOwn(entry, 'id')
  const id = (entry.id ?? null) as JsonRpcId
  if (entry.params !== undefined && !isRecord(entry.params)) {
    return isNotification ? undefined : errorMessage(id, new RpcError('INVALID_INPUT', 'params must be an object of named input fields'))
  }

  try {
    const result = await invokeServer(server, entry.method, entry.params, options)
    return isNotification ? undefined : { jsonrpc: '2.0', id, result: result === undefined ? null : result }
  } catch (error) {
    return isNotification ? undefined : errorMessage(id, toRpcError(error))
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
      return new Response(JSON.stringify(errorMessage(null, rpcError)), {
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
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
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

    let message: unknown
    try {
      message = await response.json()
    } catch (error) {
      throw new RpcError('TRANSPORT', `The ${procedure.name} response is not JSON-RPC (HTTP ${response.status}).`, {
        status: response.status,
        cause: error,
      })
    }
    // A request rejected before its id was read is answered with id null.
    if (isRecord(message) && message.jsonrpc === '2.0' && message.id === null && isRecord(message.error)) {
      throw fromJsonRpcError(message.error as JsonRpcErrorObject)
    }
    if (!isRecord(message) || message.jsonrpc !== '2.0' || message.id !== id) {
      throw new RpcError('TRANSPORT', `The ${procedure.name} response is not a JSON-RPC response to request ${id}.`, {
        status: response.status,
      })
    }
    if (isRecord(message.error)) throw fromJsonRpcError(message.error as JsonRpcErrorObject)
    return procedure.output === null ? undefined : message.result
  }
}
