/**
 * @oa-sdk/peer-transport — Bridge Client & Signaling Adapter
 *
 * Provides connection management to local WebMCP daemon/bridge and fallback store.
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  BridgeClientConfig,
  PeerCallPayload,
  PeerCallResult,
  WebMcpPeerRecord,
} from './types.js'
import {
  BridgeCallResponseSchema,
  BridgeStatusSchema,
  BridgeToolListSchema,
  PeerDirectorySchema,
  isRecord,
  isSafeAlias,
  isSafeToolName,
  type BridgeSchema,
  type BridgeCallResponse,
  type BridgeStatusPeers,
} from './bridge-protocol.js'

const MAX_JSON_BYTES = 4 * 1024 * 1024
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function finiteTimeout(value: number, name: string, max: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new RangeError(`${name} must be an integer between 1 and ${max}`)
  return value
}

function combineSignals(a: AbortSignal | null | undefined, b: AbortSignal): AbortSignal {
  if (!a) return b
  if (typeof AbortSignal !== 'undefined' && 'any' in AbortSignal && typeof AbortSignal.any === 'function') {
    return AbortSignal.any([a, b])
  }
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (a.aborted || b.aborted) controller.abort()
  else {
    a.addEventListener('abort', abort, { once: true })
    b.addEventListener('abort', abort, { once: true })
  }
  return controller.signal
}

/** Read a bounded JSON response and validate it with `schema`. An empty body is read as `{}`. */
async function readJsonResponse<T>(res: Response, schema: BridgeSchema<T>): Promise<T> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) throw new Error('Bridge response too large')
  const text = await res.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) throw new Error('Bridge response too large')
  if (!text) return schema.parse({})
  try {
    return schema.parse(JSON.parse(text))
  } catch (error) {
    // JSON.parse reports malformed text as SyntaxError; schema violations keep their own message.
    if (error instanceof SyntaxError) throw new Error('Bridge returned invalid JSON')
    throw error
  }
}

function errorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined
}

export class WebMcpBridgeClient {
  readonly serverUrl: string
  readonly alias: string
  readonly storePath: string
  readonly timeoutMs: number
  readonly refreshRetryMs: number
  readonly authToken: string | undefined

  constructor(config: BridgeClientConfig = {}) {
    const rawUrl = (config.serverUrl ?? 'http://127.0.0.1:8787').replace(/\/+$/, '')
    let parsed: URL
    try {
      parsed = new URL(rawUrl)
    } catch {
      throw new TypeError('serverUrl must be a valid URL')
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new TypeError('serverUrl must be an http(s) URL without credentials or query parameters')
    }
    if (config.authToken && parsed.protocol === 'http:' && !LOOPBACK_HOSTS.has(parsed.hostname)) {
      throw new TypeError('authToken requires HTTPS for non-loopback bridge URLs')
    }
    this.serverUrl = parsed.toString().replace(/\/+$/, '')
    this.alias = config.alias ?? 'wireframe-local'
    if (!isSafeAlias(this.alias)) throw new TypeError('alias is invalid')
    this.storePath = config.storePath ?? join(homedir(), '.webmcp', 'peers.json')
    this.timeoutMs = finiteTimeout(config.timeoutMs ?? 30000, 'timeoutMs', 300_000)
    this.refreshRetryMs = config.refreshRetryMs === undefined ? 5000 : finiteTimeout(Math.max(1, config.refreshRetryMs), 'refreshRetryMs', 60_000)
    this.authToken = config.authToken
    if (this.authToken !== undefined && (typeof this.authToken !== 'string' || this.authToken.length === 0 || this.authToken.length > 4096)) {
      throw new TypeError('authToken is invalid')
    }
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.authToken ? { ...extra, Authorization: `Bearer ${this.authToken}` } : extra
  }

  private async getJson<T>(path: string, timeoutMs: number, schema: BridgeSchema<T>): Promise<{ response: Response; body: T }> {
    const response = await fetch(`${this.serverUrl}${path}`, {
      headers: this.headers(),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = await readJsonResponse(response, schema)
    return { response, body }
  }

  /**
   * Resolve all peer records from local peer store or bridge server
   */
  async listPeers(): Promise<Record<string, WebMcpPeerRecord>> {
    // 1. Try server /status or /peers
    try {
      const { response: res, body: peers } = await this.getJson('/status', 3000, PeerDirectorySchema)
      if (res.ok && peers !== undefined) return peers
    } catch {
      // Fallback to local store
    }

    if (!existsSync(this.storePath)) return {}
    try {
      const text = await readFile(this.storePath, 'utf-8')
      if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) return {}
      return PeerDirectorySchema.parse(JSON.parse(text)) ?? {}
    } catch {
      return {}
    }
  }

  /**
   * Resolve a peer record by alias
   */
  async resolvePeer(alias = this.alias): Promise<WebMcpPeerRecord | null> {
    const peers = await this.listPeers()
    return peers[alias] ?? null
  }

  /**
   * Query status of the local WebMCP bridge / server.
   *
   * `peers` keeps the form the bridge sent: @oa-sdk/peer-server reports an
   * alias-keyed directory, and the local-registry fallback reports an array.
   */
  async getStatus(): Promise<{
    ok: boolean
    activeAlias?: string | undefined
    targetAlias?: string | undefined
    connected?: boolean | undefined
    toolsCount?: number | undefined
    tools?: string[] | undefined
    peers?: BridgeStatusPeers | undefined
  }> {
    try {
      const { response: res, body: status } = await this.getJson('/status', 3000, BridgeStatusSchema)
      if (res.ok) return status
    } catch {
      // Fallback to local store status
    }

    const peer = await this.resolvePeer(this.alias)
    return {
      ok: !!peer,
      activeAlias: this.alias,
      connected: peer?.status === 'connected',
      toolsCount: peer?.cachedTools?.length ?? 0,
      peers: peer ? [peer] : [],
    }
  }

  /**
   * Fetch tool catalog from the peered WebMCP browser
   */
  async listTools(alias = this.alias): Promise<Array<{
    name: string
    description: string
    inputSchema: Record<string, unknown>
  }>> {
    if (!isSafeAlias(alias)) return []
    try {
      const { response: res, body: tools } = await this.getJson(`/tools?peer=${encodeURIComponent(alias)}`, 5000, BridgeToolListSchema)
      if (res.ok) return tools
    } catch {
      // Fallback
    }

    const peer = await this.resolvePeer(alias)
    if (peer?.cachedTools && Array.isArray(peer.cachedTools)) {
      return peer.cachedTools.map((t) => ({
        name: t.name,
        description: t.description ?? `WebMCP tool ${t.name}`,
        inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
      }))
    }

    return []
  }

  /**
   * Execute tool with resilient retry buffering for browser F5 refresh
   */
  async callTool<T = unknown>(payload: PeerCallPayload): Promise<PeerCallResult<T>> {
    const targetAlias = payload.peer ?? this.alias
    if (!isSafeAlias(targetAlias) || !isSafeToolName(payload.tool) || (payload.args !== undefined && !isRecord(payload.args))) {
      return { error: 'Invalid tool call payload', isError: true, status: 'error' }
    }
    const timeout = finiteTimeout(payload.timeoutMs ?? this.timeoutMs, 'timeoutMs', 300_000)
    const deadline = Date.now() + this.refreshRetryMs
    let delay = 100
    let lastError: Error | null = null
    let shouldRetry = true

    while (shouldRetry) {
      const timeoutController = AbortSignal.timeout(timeout)
      try {
        const res = await fetch(`${this.serverUrl}/call`, {
          method: 'POST',
          headers: this.headers({ 'Content-Type': 'application/json' }),
          redirect: 'error',
          body: JSON.stringify({
            tool: payload.tool,
            args: payload.args ?? {},
            peer: targetAlias,
            sessionId: payload.sessionId,
          }),
          signal: combineSignals(payload.signal, timeoutController),
        })

        let body: BridgeCallResponse
        try {
          body = await readJsonResponse(res, BridgeCallResponseSchema)
        } catch (error) {
          // Keep malformed error responses tolerant, but never report a
          // successful call when the bridge did not return valid JSON.
          if (res.ok) {
            return {
              error: error instanceof Error ? error.message : 'Bridge returned invalid JSON',
              isError: true,
              status: 'error',
            }
          }
          body = { result: {} }
        }
        const errorText = body.error
        if (res.status === 503 && errorText?.startsWith('PEER_UNAVAILABLE')) {
          lastError = new Error(errorText)
        } else if (!res.ok) {
          return {
            error: errorText || body.message || `Tool call failed with HTTP ${res.status}`,
            isError: true,
            status: 'error',
          }
        } else {
          // T is chosen by the caller; the bridge protocol only guarantees JSON.
          const result = body.result as T
          const rawResult = body.result
          if (isRecord(rawResult) && rawResult.status === 'input_required') {
            return {
              result,
              status: 'input_required',
              continuationToken: typeof rawResult.continuationToken === 'string' ? rawResult.continuationToken : undefined,
              prompt: typeof rawResult.prompt === 'string' ? rawResult.prompt : undefined,
              isError: false,
            }
          }
          return {
            result,
            isError: false,
            status: 'success',
          }
        }
      } catch (err: unknown) {
        shouldRetry = false
        const name = errorName(err)
        if (name === 'AbortError' || name === 'TimeoutError') {
          return {
            error: `Tool call timeout after ${timeout}ms`,
            isError: true,
            status: 'error',
          }
        }
        // Transport failures are terminal. The refresh retry window is only
        // for an explicit PEER_UNAVAILABLE response from the bridge.
        return {
          error: err instanceof Error ? err.message : String(err),
          isError: true,
          status: 'error',
        }
      }

      if (!lastError || Date.now() >= deadline) break
      const remaining = deadline - Date.now()
      await new Promise((resolve) => setTimeout(resolve, Math.min(delay, remaining)))
      delay = Math.min(delay * 1.5, 1000)
    }

    return {
      error: lastError?.message ?? `Peer '${targetAlias}' did not respond within retry window`,
      isError: true,
      status: 'error',
    }
  }
}
