/**
 * @oa-sdk/peer-transport — Cloud Transit Client
 *
 * Provides a client that communicates with WebMCP Cloud Transit Proxy
 * via Streamable HTTP JSON-RPC or WebSocket.
 */
import type { PeerCallPayload, PeerCallResult } from '../types.js'
import type { CloudTransitCallPayload, CloudTransitCallResponse } from '../relay-protocol.js'

export interface CloudTransitClientConfig {
  /** Transit server base URL (e.g. https://relay.example.com or http://127.0.0.1:8787) */
  serverUrl: string
  /** Target peer alias (e.g. wireframe-local) */
  peerAlias: string
  /** Bearer auth key (publishKey) */
  authToken?: string | undefined
  /** Request timeout in ms (default: 30000) */
  timeoutMs?: number | undefined
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
   * Execute an MCP tool on the target peer through Cloud Transit Proxy.
   *
   * @param payload Tool execution request specifying tool name, arguments, and optional timeout.
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
   *   - `error`: Populated with the error message when `isError: true`.
   */
  async callTool<T = unknown>(payload: PeerCallPayload): Promise<PeerCallResult<T>> {
    const targetAlias = payload.peer ?? this.peerAlias
    const timeout = payload.timeoutMs ?? this.defaultTimeoutMs
    const rpcId = ++this.rpcIdSeq

    const rpcBody: CloudTransitCallPayload = {
      jsonrpc: '2.0',
      id: rpcId,
      method: 'tools/call',
      params: {
        name: payload.tool,
        arguments: payload.args ?? {},
      },
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'application/json',
      'X-Target-Peer': targetAlias,
    }
    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`
    }

    const controller = new AbortController()
    let timeoutId: NodeJS.Timeout | null = null

    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        controller.abort(new Error(`TOOL_CALL_TIMEOUT: Request exceeded ${timeout}ms`))
      }, timeout)
    }

    // Link user signal if provided
    if (payload.signal) {
      payload.signal.addEventListener('abort', () => {
        controller.abort(payload.signal?.reason)
      })
    }

    try {
      // POST to /transit/:peer/mcp or /mcp
      const targetUrl = `${this.serverUrl}/transit/${encodeURIComponent(targetAlias)}/mcp`
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(rpcBody),
        signal: controller.signal,
      })

      if (!res.ok) {
        let errMessage = `HTTP error ${res.status}`
        try {
          const errJson = (await res.json()) as { error?: string | { message?: string } }
          if (typeof errJson.error === 'string') {
            errMessage = errJson.error
          } else if (errJson.error && typeof errJson.error.message === 'string') {
            errMessage = errJson.error.message
          }
        } catch {}
        return {
          error: errMessage,
          isError: true,
          status: 'error',
        }
      }

      const responseJson = (await res.json()) as CloudTransitCallResponse
      if (responseJson.error) {
        return {
          error: responseJson.error.message,
          isError: true,
          status: 'error',
        }
      }

      if (responseJson.result && typeof responseJson.result === 'object' && responseJson.result.isError) {
        const item = responseJson.result.content?.[0]
        const firstText = item && typeof item === 'object' && 'text' in item && typeof (item as { text: unknown }).text === 'string'
          ? (item as { text: string }).text
          : 'Tool execution error'
        return {
          result: responseJson.result as T,
          error: firstText,
          isError: true,
          status: 'error',
        }
      }

      return {
        result: responseJson.result as T,
        isError: false,
        status: 'success',
      }
    } catch (err: unknown) {
      const isTimeout =
        (err instanceof Error && err.name === 'AbortError') ||
        (err instanceof Error && err.message.includes('TOOL_CALL_TIMEOUT'))
      return {
        error: isTimeout ? 'TOOL_CALL_TIMEOUT' : err instanceof Error ? err.message : String(err),
        isError: true,
        status: 'error',
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }

  /**
   * List tools available on the target peer via Cloud Transit.
   */
  async listTools(peerAlias?: string): Promise<Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>> {
    const targetAlias = peerAlias ?? this.peerAlias
    const headers: Record<string, string> = {
      Accept: 'application/json',
    }
    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`
    }

    const targetUrl = `${this.serverUrl}/tools?peer=${encodeURIComponent(targetAlias)}`
    const res = await fetch(targetUrl, { headers })
    if (!res.ok) {
      throw new Error(`Failed to list tools: HTTP ${res.status}`)
    }
    const data = (await res.json()) as { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> }
    return data.tools ?? []
  }
}

export function createCloudTransitClient(config: CloudTransitClientConfig): CloudTransitClient {
  return new CloudTransitClient(config)
}
