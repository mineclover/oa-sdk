/**
 * @oa-sdk/peer-server/cloud — WebMCP Cloud Transit Proxy
 *
 * Exposes Streamable HTTP JSON-RPC MCP endpoints that forward tool calls
 * across cloud boundaries to connected WebMCP peers.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PeerRoomManager } from '../room.js'
import type { FilePeerStore } from '../store.js'

export interface CloudTransitOptions {
  roomManager: PeerRoomManager
  store?: FilePeerStore | undefined
  defaultAlias?: string | undefined
  publishKey?: string | undefined
  allowedOrigins?: string[] | undefined
  maxBodyBytes?: number | undefined
}

export interface McpRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null | undefined
  method: string
  params?: Record<string, unknown> | undefined
}

export interface McpRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export class CloudTransitProxy {
  private readonly roomManager: PeerRoomManager
  private readonly store?: FilePeerStore | undefined
  private readonly defaultAlias: string
  private readonly publishKey?: string | undefined

  constructor(options: CloudTransitOptions) {
    this.roomManager = options.roomManager
    this.store = options.store
    this.defaultAlias = options.defaultAlias ?? 'wireframe-local'
    this.publishKey = options.publishKey
  }

  /**
   * Process an incoming MCP JSON-RPC payload and return the response.
   */
  async processRpcRequest(
    targetPeer: string,
    req: McpRpcRequest,
  ): Promise<McpRpcResponse | null> {
    if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      return {
        jsonrpc: '2.0',
        id: req?.id ?? null,
        error: { code: -32600, message: 'Invalid Request' },
      }
    }

    // Notifications (no id)
    if (req.id === undefined || req.id === null) {
      if (req.method === 'notifications/initialized') {
        return null
      }
      return null
    }

    const id = req.id

    // 1. initialize
    if (req.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-11-25',
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: {
            name: 'oa-sdk-cloud-transit-proxy',
            version: '0.1.0',
          },
          instructions: 'WebMCP Cloud Transit Proxy forwarding calls to peered browser or daemon.',
        },
      }
    }

    // 2. ping
    if (req.method === 'ping') {
      return { jsonrpc: '2.0', id, result: {} }
    }

    // 3. tools/list
    if (req.method === 'tools/list') {
      try {
        const tools = await this.listPeerTools(targetPeer)
        return { jsonrpc: '2.0', id, result: { tools } }
      } catch (err: unknown) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32001,
            message: err instanceof Error ? err.message : 'FAILED_TO_LIST_TOOLS',
          },
        }
      }
    }

    // 4. tools/call
    if (req.method === 'tools/call') {
      const toolName = req.params?.name
      const toolArgs = (req.params?.arguments ?? {}) as Record<string, unknown>
      if (typeof toolName !== 'string') {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Tool name required in params.name' },
        }
      }

      try {
        const rawResult = await this.roomManager.executeMcpCallOnPeer(
          targetPeer,
          toolName,
          toolArgs,
        )

        // Conform to MCP CallToolResult structure
        if (
          rawResult &&
          typeof rawResult === 'object' &&
          'content' in (rawResult as Record<string, unknown>)
        ) {
          return { jsonrpc: '2.0', id, result: rawResult }
        }

        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult, null, 2),
              },
            ],
            isError: false,
          },
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [{ type: 'text', text: message }],
          },
        }
      }
    }

    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method "${req.method}" not found` },
    }
  }

  private async listPeerTools(targetPeer: string): Promise<unknown[]> {
    const room = this.roomManager.getRoom(targetPeer)
    if (room && Array.isArray(room.cachedTools)) {
      return room.cachedTools
    }

    if (this.store) {
      const data = await this.store.load()
      const cachedPeer = data.peers[targetPeer]
      if (cachedPeer && Array.isArray(cachedPeer.cachedTools)) {
        return cachedPeer.cachedTools
      }
    }

    return []
  }
}

/**
 * Handle HTTP request for Cloud Transit Proxy in a Node.js HTTP server.
 * Returns true if the request was handled, false otherwise.
 */
export async function handleCloudTransitHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: CloudTransitOptions,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const pathname = url.pathname

  // Path format: /transit/:peer/mcp or /mcp
  let targetPeer: string | null = null
  const transitMatch = pathname.match(/^\/transit\/([^/]+)\/mcp$/)
  if (transitMatch) {
    targetPeer = decodeURIComponent(transitMatch[1]!)
  } else if (pathname === '/mcp') {
    const headerPeer = req.headers['x-target-peer']
    targetPeer = (Array.isArray(headerPeer) ? headerPeer[0] : headerPeer) ??
      url.searchParams.get('peer') ??
      options.defaultAlias ??
      'wireframe-local'
  }

  if (!targetPeer) {
    return false
  }

  // Handle CORS
  const origin = req.headers.origin
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Target-Peer, MCP-Protocol-Version')
    res.setHeader('Vary', 'Origin')
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return true
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED', message: 'Use POST for MCP Streamable HTTP' }))
    return true
  }

  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024
  const chunks: Buffer[] = []
  let totalBytes = 0

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buf.byteLength
    if (totalBytes > maxBodyBytes) {
      res.writeHead(413, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'PAYLOAD_TOO_LARGE' }))
      return true
    }
    chunks.push(buf)
  }

  let rpcBody: McpRpcRequest
  try {
    rpcBody = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }))
    return true
  }

  const proxy = new CloudTransitProxy(options)
  const response = await proxy.processRpcRequest(targetPeer, rpcBody)

  if (!response) {
    res.writeHead(204)
    res.end()
    return true
  }

  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(response))
  return true
}

/**
 * Handle Cloud Transit Proxy in a Cloudflare Worker or Edge fetch handler.
 */
export async function handleCloudTransitWorker(
  request: Request,
  proxy: CloudTransitProxy,
  defaultAlias = 'wireframe-local',
): Promise<Response> {
  const url = new URL(request.url)
  const pathname = url.pathname

  let targetPeer = defaultAlias
  const match = pathname.match(/^\/transit\/([^/]+)\/mcp$/)
  if (match) {
    targetPeer = decodeURIComponent(match[1]!)
  } else if (url.searchParams.has('peer')) {
    targetPeer = url.searchParams.get('peer')!
  } else if (request.headers.has('x-target-peer')) {
    targetPeer = request.headers.get('x-target-peer')!
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Target-Peer, MCP-Protocol-Version',
      },
    })
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: McpRpcRequest
  try {
    body = (await request.json()) as McpRpcRequest
  } catch {
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const result = await proxy.processRpcRequest(targetPeer, body)
  if (!result) {
    return new Response(null, { status: 204 })
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
