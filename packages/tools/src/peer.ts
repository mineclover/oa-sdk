/**
 * @oa-sdk/tools — WebMCP Peer Bridge Adapter
 *
 * Grounded in the WebMCP specification and Model Context Protocol (MCP):
 * - Seamlessly bridges peered browser tabs (Framebook, dashboards, canvas apps)
 *   into first-class @oa-sdk/tools ToolDefinitions, MCP Servers, and CLIs.
 * - Implements resilient auto-retry buffering for browser refreshes (F5):
 *   Tool calls waiting during an F5 reload are buffered with exponential backoff
 *   rather than failing immediately, eliminating AI session restarts.
 * - 100% Pure TypeScript/Node.js — zero Python, zero Playwright dependencies.
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ToolApp, createToolApp } from './app.js'
import type { ToolDefinition } from './types.js'

export interface WebMcpPeerRecord {
  alias: string
  id?: string
  title?: string
  origin?: string
  signalingUrl?: string
  invitationUrl?: string
  status?: string
  allowedTools?: string[]
  cachedTools?: Array<{
    name: string
    description?: string
    inputSchema?: Record<string, unknown>
  }>
  updatedAt?: number
}

export interface WebMcpPeerConfig {
  /** Local signaling/bridge server URL (default: http://127.0.0.1:8787) */
  serverUrl?: string
  /** Target peer alias (default: wireframe-local) */
  alias?: string
  /** Path to ~/.webmcp/peers.json registry */
  storePath?: string
  /** Request timeout in ms (default: 30000) */
  timeoutMs?: number
  /** Tolerant retry window for browser refresh in ms (default: 5000) */
  refreshRetryMs?: number
}

export class WebMcpPeerBridgeClient {
  readonly serverUrl: string
  readonly alias: string
  readonly storePath: string
  readonly timeoutMs: number
  readonly refreshRetryMs: number

  constructor(config: WebMcpPeerConfig = {}) {
    this.serverUrl = (config.serverUrl ?? 'http://127.0.0.1:8787').replace(/\/+$/, '')
    this.alias = config.alias ?? 'wireframe-local'
    this.storePath = config.storePath ?? join(homedir(), '.webmcp', 'peers.json')
    this.timeoutMs = config.timeoutMs ?? 30000
    this.refreshRetryMs = config.refreshRetryMs ?? 5000
  }

  /**
   * Resolve a peer record by alias from local peer store
   */
  async resolvePeer(alias = this.alias): Promise<WebMcpPeerRecord | null> {
    if (!existsSync(this.storePath)) return null
    try {
      const text = await readFile(this.storePath, 'utf-8')
      const data = JSON.parse(text)
      const peer = data?.peers?.[alias]
      return peer ? (peer as WebMcpPeerRecord) : null
    } catch {
      return null
    }
  }

  /**
   * Query status of the local WebMCP bridge / server
   */
  async getStatus(): Promise<{
    ok: boolean
    activeAlias?: string
    connected?: boolean
    toolsCount?: number
    peers?: WebMcpPeerRecord[]
  }> {
    try {
      const res = await fetch(`${this.serverUrl}/status`, {
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        return (await res.json()) as any
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
   * Fetch tool catalog from the peered browser
   */
  async listTools(alias = this.alias): Promise<Array<{
    name: string
    description: string
    inputSchema: Record<string, unknown>
  }>> {
    // 1. Try server /tools endpoint
    try {
      const res = await fetch(`${this.serverUrl}/tools?peer=${encodeURIComponent(alias)}`, {
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        const body = (await res.json()) as any
        if (Array.isArray(body?.tools)) return body.tools
      }
    } catch {}

    // 2. Fallback to cachedTools from peers.json
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
  async callTool(
    tool: string,
    args: Record<string, unknown> = {},
    alias = this.alias,
  ): Promise<any> {
    const deadline = Date.now() + this.refreshRetryMs
    let delay = 100
    let lastError: Error | null = null

    while (Date.now() <= deadline) {
      try {
        const res = await fetch(`${this.serverUrl}/call`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool, args, peer: alias }),
          signal: AbortSignal.timeout(this.timeoutMs),
        })

        if (res.status === 503 || res.status === 404) {
          // Tab is refreshing or reconnecting, wait and retry
          const body = (await res.json().catch(() => ({}))) as Record<string, any>
          lastError = new Error(body.message || `Peer '${alias}' temporarily unavailable (${res.status})`)
        } else if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as Record<string, any>
          throw new Error(body.error || body.message || `Tool call failed with HTTP ${res.status}`)
        } else {
          const body = (await res.json()) as Record<string, any>
          return body.result ?? body
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          throw new Error(`Tool call timeout after ${this.timeoutMs}ms`)
        }
        lastError = err
      }

      // Backoff sleep before next retry
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      await new Promise((resolve) => setTimeout(resolve, Math.min(delay, remaining)))
      delay = Math.min(delay * 1.5, 1000)
    }

    throw lastError || new Error(`Peer '${alias}' did not respond within retry window`)
  }
}

export interface WebMcpPeerAppOptions extends WebMcpPeerConfig {
  name?: string
  version?: string
  description?: string
}

/**
 * Creates an @oa-sdk/tools ToolApp that exposes peered browser tools to MCP and CLI.
 */
export async function createWebMcpPeerApp(options: WebMcpPeerAppOptions = {}): Promise<ToolApp> {
  const client = new WebMcpPeerBridgeClient(options)
  const app = createToolApp({
    name: options.name ?? 'webmcp-peer-app',
    version: options.version ?? '0.2.0',
    description: options.description ?? 'Universal WebMCP Browser Peer Bridge',
  })

  // 1. Meta-tool: webmcp_list_peers
  const listPeersTool: ToolDefinition = {
    name: 'webmcp_list_peers',
    description: 'List all registered browser peers, their tools, and status.',
    inputSchema: { type: 'object', properties: {} },
    hints: { readOnly: true, idempotent: true },
    execute: async () => {
      const status = await client.getStatus()
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(status, null, 2),
          },
        ],
      }
    },
  }

  // 2. Meta-tool: webmcp_peer_status
  const statusTool: ToolDefinition = {
    name: 'webmcp_peer_status',
    description: 'Get real-time diagnostic status of WebMCP bridge and active browser connection.',
    inputSchema: { type: 'object', properties: {} },
    hints: { readOnly: true, idempotent: true },
    execute: async () => {
      const status = await client.getStatus()
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(status, null, 2),
          },
        ],
      }
    },
  }

  // 3. Dynamic call tool: webmcp_call
  const callTool: ToolDefinition = {
    name: 'webmcp_call',
    description: 'Call an arbitrary WebMCP tool on the peered browser tab.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Name of the tool to execute' },
        args: { type: 'object', description: 'Arguments payload for the tool' },
        peer: { type: 'string', description: 'Optional peer alias to target' },
      },
      required: ['tool'],
    },
    execute: async (_ctx, input: any) => {
      const result = await client.callTool(input.tool, input.args ?? {}, input.peer)
      return result
    },
  }

  app.tools(listPeersTool, statusTool, callTool)

  // 4. Discover and register peer tools as first-class tools
  try {
    const tools = await client.listTools()
    for (const t of tools) {
      // Don't overwrite meta-tools
      if (app.getTool(t.name)) continue

      const peerTool: ToolDefinition = {
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema || { type: 'object', properties: {} },
        execute: async (_ctx, input: any) => {
          const result = await client.callTool(t.name, input || {})
          return result
        },
      }
      app.tools(peerTool)
    }
  } catch {
    // If peer is not yet connected at app build time, tools can be dispatched via webmcp_call
  }

  return app
}
