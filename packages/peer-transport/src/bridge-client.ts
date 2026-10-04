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

const MAX_JSON_BYTES = 4 * 1024 * 1024
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function isSafeAlias(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
}

function isSafeTool(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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

async function readJsonResponse(res: Response): Promise<unknown> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) throw new Error('Bridge response too large')
  const text = await res.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) throw new Error('Bridge response too large')
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    throw new Error('Bridge returned invalid JSON')
  }
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

  private async getJson(path: string, timeoutMs: number): Promise<{ response: Response; body: unknown }> {
    const response = await fetch(`${this.serverUrl}${path}`, {
      headers: this.headers(),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = await readJsonResponse(response)
    return { response, body }
  }

  /**
   * Resolve all peer records from local peer store or bridge server
   */
  async listPeers(): Promise<Record<string, WebMcpPeerRecord>> {
    // 1. Try server /status or /peers
    try {
      const { response: res, body } = await this.getJson('/status', 3000)
      if (res.ok) {
        const data = isRecord(body) ? body : {}
        if (isRecord(data.peers) || Array.isArray(data.peers)) {
          if (Array.isArray(data.peers)) {
            const map: Record<string, WebMcpPeerRecord> = {}
            for (const p of data.peers) {
              if (isRecord(p) && isSafeAlias(p.alias)) map[p.alias] = this.sanitizePeer(p)
            }
            return map
          }
          const map: Record<string, WebMcpPeerRecord> = {}
          for (const [alias, peer] of Object.entries(data.peers)) {
            if (isSafeAlias(alias) && isRecord(peer) && isSafeAlias(peer.alias)) map[alias] = this.sanitizePeer(peer)
          }
          return map
        }
      }
    } catch {
      // Fallback to local store
    }

    if (!existsSync(this.storePath)) return {}
    try {
      const text = await readFile(this.storePath, 'utf-8')
      if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) return {}
      const data = JSON.parse(text) as unknown
      if (!isRecord(data) || !isRecord(data.peers)) return {}
      const peers: Record<string, WebMcpPeerRecord> = {}
      for (const [alias, peer] of Object.entries(data.peers)) {
        if (isSafeAlias(alias) && isRecord(peer) && isSafeAlias(peer.alias)) peers[alias] = this.sanitizePeer(peer)
      }
      return peers
    } catch {
      return {}
    }
  }

  private sanitizePeer(peer: Record<string, unknown>): WebMcpPeerRecord {
    const { token: _token, ...safe } = peer
    return safe as unknown as WebMcpPeerRecord
  }

  /**
   * Resolve a peer record by alias
   */
  async resolvePeer(alias = this.alias): Promise<WebMcpPeerRecord | null> {
    const peers = await this.listPeers()
    return peers[alias] ?? null
  }

  /**
   * Query status of the local WebMCP bridge / server
   */
  async getStatus(): Promise<{
    ok: boolean
    activeAlias?: string | undefined
    connected?: boolean | undefined
    toolsCount?: number | undefined
    peers?: WebMcpPeerRecord[] | undefined
  }> {
    try {
      const { response: res, body } = await this.getJson('/status', 3000)
      if (res.ok) {
        return (isRecord(body) ? body : {}) as {
          ok: boolean; activeAlias?: string; connected?: boolean; toolsCount?: number; peers?: WebMcpPeerRecord[]
        }
      }
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
      const { response: res, body } = await this.getJson(`/tools?peer=${encodeURIComponent(alias)}`, 5000)
      if (res.ok) {
        if (isRecord(body) && Array.isArray(body.tools)) {
          return body.tools.filter((tool): tool is Record<string, unknown> => isRecord(tool) && isSafeTool(tool.name)).map((tool) => ({
            name: tool.name as string,
            description: typeof tool.description === 'string' ? tool.description : `WebMCP tool ${tool.name as string}`,
            inputSchema: isRecord(tool.inputSchema) ? tool.inputSchema : { type: 'object', properties: {} },
          }))
        }
      }
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
  async callTool<T = any>(payload: PeerCallPayload): Promise<PeerCallResult<T>> {
    const targetAlias = payload.peer ?? this.alias
    if (!isSafeAlias(targetAlias) || !isSafeTool(payload.tool) || (payload.args !== undefined && !isRecord(payload.args))) {
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

        let body: unknown
        try {
          body = await readJsonResponse(res)
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
          body = {}
        }
        const errorText = isRecord(body) && typeof body.error === 'string' ? body.error : undefined
        if (res.status === 503 && errorText?.startsWith('PEER_UNAVAILABLE')) {
          lastError = new Error(errorText)
        } else if (!res.ok) {
          return {
            error: errorText || (isRecord(body) && typeof body.message === 'string' ? body.message : undefined) || `Tool call failed with HTTP ${res.status}`,
            isError: true,
            status: 'error',
          }
        } else {
          const rawResult: any = isRecord(body) && 'result' in body ? body.result : body
          if (rawResult && typeof rawResult === 'object' && rawResult.status === 'input_required') {
            return {
              result: rawResult,
              status: 'input_required',
              continuationToken: rawResult.continuationToken,
              prompt: rawResult.prompt,
              isError: false,
            }
          }
          return {
            result: rawResult,
            isError: false,
            status: 'success',
          }
        }
      } catch (err: any) {
        shouldRetry = false
        if (err.name === 'AbortError' || err.name === 'TimeoutError') {
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
