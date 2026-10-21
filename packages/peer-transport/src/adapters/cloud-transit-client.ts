/**
 * @oa-sdk/peer-transport — Cloud Transit Client
 *
 * Provides a client that communicates with a WebMCP Cloud Transit Proxy over
 * Streamable HTTP JSON-RPC (`POST /transit/:peer/mcp`). Every method speaks
 * JSON-RPC only, so the client works against `createPeerServer({ enableCloudTransit: true })`,
 * a standalone `handleCloudTransitHttpRequest`, and `handleCloudTransitWorker` alike.
 */
import type { PeerCallPayload, PeerCallResult } from '../types.js'
import type { CloudTransitCallPayload } from '../relay-protocol.js'
import { isRecord, parseCachedTool } from '../bridge-protocol.js'

export interface CloudTransitClientConfig {
  /** Transit server base URL (e.g. https://relay.example.com or http://127.0.0.1:8787) */
  serverUrl: string
  /** Target peer alias (e.g. wireframe-local) */
  peerAlias: string
  /** Bearer auth key (publishKey) */
  authToken?: string | undefined
  /** Request timeout in ms (default: 30000; 0 disables the timeout) */
  timeoutMs?: number | undefined
}

/** A tool entry from a peer's catalog. */
export interface CloudTransitTool {
  name: string
  description?: string | undefined
  inputSchema?: Record<string, unknown> | undefined
}

export interface CloudTransitListToolsOptions {
  /** Cancel the request. */
  signal?: AbortSignal | null | undefined
  /** Request timeout in ms (default: the client's timeoutMs). */
  timeoutMs?: number | undefined
}

/** A JSON-RPC 2.0 response with either a result object or an error. */
type TransitRpcResponse =
  | { result: Record<string, unknown> }
  | { error: { message: string; code?: number | undefined } }

/** A named runtime validator: `parse` returns the validated value or throws a TypeError. */
interface TransitSchema<T> {
  parse(value: unknown): T
}

const TransitRpcResponseSchema: TransitSchema<TransitRpcResponse> = {
  parse(value) {
    if (!isRecord(value) || value.jsonrpc !== '2.0') {
      throw new TypeError('Cloud Transit returned an invalid JSON-RPC response')
    }
    const { error, result } = value
    if (error !== undefined) {
      if (!isRecord(error) || typeof error.message !== 'string') {
        throw new TypeError('Cloud Transit returned an invalid JSON-RPC error')
      }
      return { error: { message: error.message, ...(typeof error.code === 'number' ? { code: error.code } : {}) } }
    }
    if (!isRecord(result)) throw new TypeError('Cloud Transit response carries no result object')
    return { result }
  },
}

/** The message of a non-2xx body: `{ error: string }` or `{ error: { message } }`. */
const TransitErrorBodySchema: TransitSchema<string | undefined> = {
  parse(value) {
    if (!isRecord(value)) return undefined
    const { error } = value
    if (typeof error === 'string') return error
    if (isRecord(error) && typeof error.message === 'string') return error.message
    return undefined
  },
}

/** A `tools/list` result: entries without a safe tool name are skipped. */
const TransitToolListSchema: TransitSchema<CloudTransitTool[]> = {
  parse(value) {
    if (!isRecord(value) || !Array.isArray(value.tools)) {
      throw new TypeError('Cloud Transit tools/list result carries no tools array')
    }
    return value.tools.flatMap((entry) => {
      const tool = parseCachedTool(entry)
      return tool === undefined ? [] : [tool]
    })
  },
}

/** How one JSON-RPC exchange ended. */
type RpcOutcome =
  | { kind: 'response'; response: TransitRpcResponse }
  | { kind: 'http-error'; status: number; message: string }
  | { kind: 'timeout' }
  | { kind: 'cancelled'; message: string }
  | { kind: 'failed'; message: string }

/**
 * The error a caller's abort is reported as: a `TimeoutError` reason is a
 * timeout, an `AbortError` (plain `abort()`) a cancellation, and any other
 * Error reason keeps its own message.
 */
function abortOutcome(signal: AbortSignal): RpcOutcome {
  const reason: unknown = signal.reason
  if (reason instanceof Error && reason.name === 'TimeoutError') return { kind: 'timeout' }
  if (reason instanceof Error && reason.name !== 'AbortError') return { kind: 'cancelled', message: reason.message }
  return { kind: 'cancelled', message: 'TOOL_CALL_CANCELLED' }
}

function firstText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  const item: unknown = content[0]
  return isRecord(item) && typeof item.text === 'string' ? item.text : undefined
}

export class CloudTransitClient {
  readonly serverUrl: string
  readonly peerAlias: string
  private readonly authToken?: string | undefined
  private readonly defaultTimeoutMs: number
  private rpcIdSeq = 0

  constructor(config: CloudTransitClientConfig) {
    if (!config.serverUrl || typeof config.serverUrl !== 'string') {
      throw new Error('serverUrl is required')
    }
    if (!config.peerAlias || typeof config.peerAlias !== 'string') {
      throw new Error('peerAlias is required')
    }
    this.serverUrl = config.serverUrl.replace(/\/+$/, '')
    this.peerAlias = config.peerAlias
    this.authToken = config.authToken
    this.defaultTimeoutMs = config.timeoutMs ?? 30_000
  }

  /**
   * POST one JSON-RPC request to `/transit/:peer/mcp`. The timeout and the
   * caller's signal both abort the request and the response body read; the
   * caller's abort listener is always removed again.
   */
  private async postRpc(
    targetAlias: string,
    body: CloudTransitCallPayload | { jsonrpc: '2.0'; id: number; method: 'tools/list'; params: Record<string, never> },
    timeoutMs: number,
    signal: AbortSignal | null | undefined,
  ): Promise<RpcOutcome> {
    if (signal?.aborted) return abortOutcome(signal)

    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'application/json',
      'X-Target-Peer': targetAlias,
    }
    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`
    }

    const controller = new AbortController()
    let timedOut = false
    const timer = timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
      : undefined
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })

    try {
      const res = await fetch(`${this.serverUrl}/transit/${encodeURIComponent(targetAlias)}/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      const text = await res.text()

      if (!res.ok) {
        let message: string | undefined
        try {
          message = TransitErrorBodySchema.parse(JSON.parse(text))
        } catch {}
        return { kind: 'http-error', status: res.status, message: message ?? `HTTP error ${res.status}` }
      }

      try {
        return { kind: 'response', response: TransitRpcResponseSchema.parse(JSON.parse(text)) }
      } catch (error) {
        if (error instanceof SyntaxError) return { kind: 'failed', message: 'Cloud Transit returned invalid JSON' }
        throw error
      }
    } catch (err: unknown) {
      if (timedOut) return { kind: 'timeout' }
      if (signal?.aborted) return abortOutcome(signal)
      return { kind: 'failed', message: err instanceof Error ? err.message : String(err) }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  /**
   * Execute an MCP tool on the target peer through Cloud Transit Proxy.
   *
   * @param payload Tool execution request specifying tool name, arguments, and optional timeout and signal.
   * @returns `PeerCallResult<T>` with:
   *   - `status`: `'success' | 'error'`
   *   - `isError`: `false` on success, `true` on error.
   *   - `result`: Raw MCP `CallToolResult` (`{ content: [{ type: 'text', text: string }] }`).
   *     To access the underlying application response payload, parse `result.content[0].text`:
   *     ```typescript
   *     const res = await client.callTool({ tool: 'my_tool', args: {} })
   *     if (res.status === 'success' && res.result?.content?.[0]?.text) {
   *       const data = JSON.parse(res.result.content[0].text)
   *     }
   *     ```
   *   - `error`: Populated with the error message when `isError: true`:
   *     `'TOOL_CALL_TIMEOUT'` when `timeoutMs` elapsed, `'TOOL_CALL_CANCELLED'`
   *     when `signal` was aborted (or the abort reason's message), otherwise
   *     the server's or tool's message. An already-aborted signal sends nothing.
   */
  async callTool<T = unknown>(payload: PeerCallPayload): Promise<PeerCallResult<T>> {
    const targetAlias = payload.peer ?? this.peerAlias
    const rpcBody: CloudTransitCallPayload = {
      jsonrpc: '2.0',
      id: ++this.rpcIdSeq,
      method: 'tools/call',
      params: {
        name: payload.tool,
        arguments: payload.args ?? {},
      },
    }

    const outcome = await this.postRpc(targetAlias, rpcBody, payload.timeoutMs ?? this.defaultTimeoutMs, payload.signal)
    switch (outcome.kind) {
      case 'timeout':
        return { error: 'TOOL_CALL_TIMEOUT', isError: true, status: 'error' }
      case 'cancelled':
      case 'failed':
      case 'http-error':
        return { error: outcome.message, isError: true, status: 'error' }
      case 'response':
        break
    }

    const { response } = outcome
    if ('error' in response) {
      return { error: response.error.message, isError: true, status: 'error' }
    }
    if (response.result.isError === true) {
      return {
        result: response.result as T,
        error: firstText(response.result.content) ?? 'Tool execution error',
        isError: true,
        status: 'error',
      }
    }
    return {
      result: response.result as T,
      isError: false,
      status: 'success',
    }
  }

  /**
   * List the tools of the target peer with a JSON-RPC `tools/list` through
   * Cloud Transit. Throws `Failed to list tools: ...` on an HTTP error, a
   * JSON-RPC error, a timeout or a cancellation.
   */
  async listTools(peerAlias?: string, options: CloudTransitListToolsOptions = {}): Promise<CloudTransitTool[]> {
    const targetAlias = peerAlias ?? this.peerAlias
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs
    const outcome = await this.postRpc(
      targetAlias,
      { jsonrpc: '2.0', id: ++this.rpcIdSeq, method: 'tools/list', params: {} },
      timeoutMs,
      options.signal,
    )
    switch (outcome.kind) {
      case 'timeout':
        throw new Error(`Failed to list tools: request exceeded ${timeoutMs}ms`)
      case 'http-error':
        throw new Error(`Failed to list tools: HTTP ${outcome.status}`)
      case 'cancelled':
      case 'failed':
        throw new Error(`Failed to list tools: ${outcome.message}`)
      case 'response':
        break
    }
    const { response } = outcome
    if ('error' in response) throw new Error(`Failed to list tools: ${response.error.message}`)
    return TransitToolListSchema.parse(response.result)
  }
}

export function createCloudTransitClient(config: CloudTransitClientConfig): CloudTransitClient {
  return new CloudTransitClient(config)
}
