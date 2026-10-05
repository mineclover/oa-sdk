/**
 * @oa-sdk/peer-server — HTTP & Peering Signaling Daemon Server
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { FilePeerStore } from './store.js'
import { isSafeAlias } from './store.js'
import { PeerRoomManager } from './room.js'
import { createHomeMcpTools } from './home-mcp.js'
import type { WebMcpPeerRecord } from '@oa-sdk/peer-transport'
import type { PeerServerOptions } from './types.js'
import {
  HomeMcpRequestSchema,
  PeerAnnouncementSchema,
  RequestError,
  ToolCallRequestSchema,
  type RequestSchema,
} from './request-schemas.js'

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024
const MAX_CONFIGURED_BODY_BYTES = 16 * 1024 * 1024

function constantTimeEqual(expected: string, actual: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(actual)
  return a.length === b.length && timingSafeEqual(a, b)
}

function requestAuthorized(req: IncomingMessage, publishKey: string | undefined): boolean {
  if (!publishKey) return true
  const header = req.headers['x-peer-publish-key'] ?? req.headers.authorization
  const supplied = Array.isArray(header) ? header[0] : header
  if (!supplied) return false
  const key = supplied.startsWith('Bearer ') ? supplied.slice(7) : supplied
  return constantTimeEqual(publishKey, key)
}

function allowedOrigin(req: IncomingMessage, configured: string[] | undefined): string | undefined {
  const origin = req.headers.origin
  if (!origin) return undefined
  if (configured !== undefined) return configured.includes(origin) ? origin : undefined
  try {
    const url = new URL(origin)
    return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && url.origin === origin ? origin : undefined
  } catch {
    return undefined
  }
}

/** Read a bounded JSON body and validate it with `schema`. An empty body is read as `{}`. */
async function readJsonBody<T>(req: IncomingMessage, maxBodyBytes: number, schema: RequestSchema<T>): Promise<T> {
  const declaredLength = Number(req.headers['content-length'])
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    throw new RequestError(413, 'Request body too large')
  }

  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.byteLength
    if (total > maxBodyBytes) throw new RequestError(413, 'Request body too large')
    chunks.push(buffer)
  }
  if (total === 0) return schema.parse({})
  try {
    return schema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  } catch (error) {
    // JSON.parse reports malformed text as SyntaxError; schema violations carry their own status.
    if (error instanceof SyntaxError) throw new RequestError(400, 'Invalid JSON payload')
    throw error
  }
}

/** Peer records served over HTTP never include the bridge token or invitation URL. */
function sanitizePeerRecord(record: WebMcpPeerRecord): Omit<WebMcpPeerRecord, 'token' | 'invitationUrl'> {
  const { token: _token, invitationUrl: _invitationUrl, ...safe } = record
  return safe
}

function errorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined
}

export interface PeerServerInstance {
  server: Server
  port: number
  hostname: string
  roomManager: PeerRoomManager
  store: FilePeerStore
  start: () => Promise<{ port: number; hostname: string }>
  close: () => Promise<void>
}

export function createPeerServer(options: PeerServerOptions = {}): PeerServerInstance {
  const port = options.port ?? 8787
  const hostname = options.hostname ?? '127.0.0.1'
  if (options.publishKey !== undefined && !/^[\x21-\x7e]{1,4096}$/.test(options.publishKey)) {
    throw new Error('publishKey must be a non-empty printable ASCII secret')
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname) && !options.publishKey) {
    throw new Error('publishKey is required for non-loopback listeners')
  }
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const maxPendingCalls = options.maxPendingCalls ?? 1024
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > MAX_CONFIGURED_BODY_BYTES) {
    throw new Error('maxBodyBytes must be an integer between 1 and 16777216')
  }
  if (!Number.isSafeInteger(maxPendingCalls) || maxPendingCalls < 1 || maxPendingCalls > 10_000) {
    throw new Error('maxPendingCalls must be an integer between 1 and 10000')
  }
  const store = new FilePeerStore(options.storePath)
  const roomManager = new PeerRoomManager()
  const homeTools = createHomeMcpTools(roomManager)

  const jsonResponse = (res: ServerResponse, status: number, body: unknown) => {
    // Header values are selected by the request handler; never reflect an
    // arbitrary Origin when an allow-list has been configured.
    const origin = (res as ServerResponse & { requestOrigin?: string }).requestOrigin
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Peer-Publish-Key, MCP-Protocol-Version, Mcp-Method, Mcp-Name',
    }
    if (origin) {
      headers['Access-Control-Allow-Origin'] = origin
      headers.Vary = 'Origin'
    }
    res.writeHead(status, {
      ...headers,
    })
    res.end(JSON.stringify(body))
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res).catch((error: unknown) => {
      if (res.headersSent || res.destroyed) return
      jsonResponse(res, error instanceof RequestError ? error.status : 500, {
        error: error instanceof RequestError ? error.message : 'Internal server error',
      })
    })
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 10_000

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = allowedOrigin(req, options.allowedOrigins)
    ;(res as ServerResponse & { requestOrigin?: string | undefined }).requestOrigin = origin
    const parsedUrl = new URL(req.url ?? '/', `http://${hostname}:${port}`)
    const pathname = parsedUrl.pathname

    if (req.headers.origin && !origin) {
      jsonResponse(res, 403, { error: 'Origin not allowed' })
      return
    }

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      if (options.allowedOrigins !== undefined && req.headers.origin && !origin) {
        jsonResponse(res, 403, { error: 'Origin not allowed' })
        return
      }
      res.writeHead(204, {
        ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Peer-Publish-Key, MCP-Protocol-Version, Mcp-Method, Mcp-Name',
      })
      res.end()
      return
    }

    if (!requestAuthorized(req, options.publishKey)) {
      jsonResponse(res, 401, { error: 'Unauthorized' })
      return
    }

    // 1. GET /status
    if (req.method === 'GET' && pathname === '/status') {
      const data = await store.load()
      const targetAlias = parsedUrl.searchParams.get('peer') ?? data.activeAlias ?? options.defaultAlias ?? 'wireframe-local'
      if (!isSafeAlias(targetAlias)) {
        jsonResponse(res, 400, { error: 'Invalid peer alias' })
        return
      }
      const room = roomManager.getRoom(targetAlias)
      const cachedPeer = data.peers[targetAlias]

      const toolsList = room && Array.isArray(room.cachedTools)
        ? room.cachedTools.map((t) => t.name)
        : cachedPeer && Array.isArray(cachedPeer.cachedTools)
          ? cachedPeer.cachedTools.map((t) => t.name)
          : []

      jsonResponse(res, 200, {
        ok: true,
        connected: room?.status === 'connected',
        targetAlias,
        toolsCount: toolsList.length,
        tools: toolsList,
        peers: Object.fromEntries(Object.entries(data.peers).map(([alias, peer]) => [alias, sanitizePeerRecord(peer)])),
      })
      return
    }

    // 2. GET /tools
    if (req.method === 'GET' && pathname === '/tools') {
      const data = await store.load()
      const targetAlias = parsedUrl.searchParams.get('peer') ?? data.activeAlias ?? 'wireframe-local'
      if (!isSafeAlias(targetAlias)) {
        jsonResponse(res, 400, { error: 'Invalid peer alias' })
        return
      }
      const room = roomManager.getRoom(targetAlias)
      const cachedPeer = data.peers[targetAlias]

      const tools = room && Array.isArray(room.cachedTools)
        ? room.cachedTools
        : cachedPeer && Array.isArray(cachedPeer.cachedTools)
          ? cachedPeer.cachedTools
          : []
      jsonResponse(res, 200, { tools })
      return
    }

    // 3. POST /call
    if (req.method === 'POST' && pathname === '/call') {
      const { tool, args, peer } = await readJsonBody(req, maxBodyBytes, ToolCallRequestSchema)
      const targetAlias = peer ?? options.defaultAlias ?? 'wireframe-local'
      if (!isSafeAlias(targetAlias)) {
        jsonResponse(res, 400, { error: 'Invalid peer alias' })
        return
      }

      try {
        const result = await roomManager.executeMcpCallOnPeer(targetAlias, tool, args ?? {}, 3500, 30000, maxPendingCalls)
        jsonResponse(res, 200, { result })
      } catch (err: unknown) {
        const message = errorMessage(err) ?? 'Tool execution failed'
        const status = message.startsWith('PEER_UNAVAILABLE') ? 503
          : message.startsWith('TOOL_NOT_ALLOWED') ? 403
            : message.startsWith('TOO_MANY_PENDING_CALLS') ? 429
              : message.startsWith('TOOL_CALL_TIMEOUT') ? 504
                : 500
        jsonResponse(res, status, {
          error: message,
          peer: targetAlias,
          tool,
        })
      }
      return
    }

    // 4. POST /announce (Provider registration)
    if (req.method === 'POST' && pathname === '/announce') {
      const { record: announced, roomTools } = await readJsonBody(req, maxBodyBytes, PeerAnnouncementSchema)
      const updated = await store.updatePeer(announced.alias, announced)
      roomManager.registerRoom({
        id: announced.id ?? announced.alias,
        alias: announced.alias,
        title: announced.title,
        origin: announced.origin,
        status: 'connected',
        cachedTools: roomTools,
        allowedTools: announced.allowedTools,
        updatedAt: Date.now(),
      })

      jsonResponse(res, 200, { ok: true, peer: sanitizePeerRecord(updated) })
      return
    }

    // 5. P2P Rendezvous Descriptor (/p/:id/mcp)
    if (pathname.startsWith('/p/') && pathname.endsWith('/mcp')) {
      if (req.method !== 'GET' && req.method !== 'POST') {
        jsonResponse(res, 405, { error: 'Method Not Allowed' })
        return
      }
      if (req.method === 'POST') {
        // Spec Invariant: POST on P2P descriptor must return 426 P2P_TRANSPORT_REQUIRED
        jsonResponse(res, 426, {
          error: 'P2P_TRANSPORT_REQUIRED',
          message: 'Direct WebRTC DataChannel connection is required for this route.',
        })
        return
      }

      const match = pathname.match(/^\/p\/([^/]+)\/mcp$/)
      const peerId = match ? match[1] : 'unknown'
      if (!peerId || peerId.length > 128 || /[\u0000-\u001f\u007f]/.test(peerId)) {
        jsonResponse(res, 400, { error: 'Invalid peer id' })
        return
      }

      jsonResponse(res, 200, {
        rendezvous: true,
        protocol: 'webmcp-p2p',
        peerId,
        signaling: `ws://${hostname}:${port}/ws`,
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      })
      return
    }

    // 6. Home MCP Endpoint (/home/mcp)
    if (pathname === '/home/mcp') {
      if (req.method === 'GET') {
        jsonResponse(res, 200, {
          protocolVersion: '2026-07-28',
          service: 'oa-sdk-home-mcp',
          tools: homeTools.map((t) => ({ name: t.name, description: t.description })),
        })
        return
      }

      if (req.method === 'POST') {
        const request = await readJsonBody(req, maxBodyBytes, HomeMcpRequestSchema)
        if (request.kind === 'invalid') {
          jsonResponse(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } })
          return
        }

        if (request.kind === 'tools/list') {
          jsonResponse(res, 200, {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              tools: homeTools.map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
              })),
            },
          })
          return
        }

        if (request.kind === 'invalid-call-params') {
          jsonResponse(res, 200, { jsonrpc: '2.0', id: request.id, error: { code: -32600, message: 'Invalid tools/call params' } })
          return
        }

        if (request.kind === 'tools/call') {
          const toolName = request.name
          const tool = homeTools.find((t) => t.name === toolName)
          if (!tool) {
            jsonResponse(res, 200, {
              jsonrpc: '2.0',
              id: request.id,
              error: { code: -32601, message: `Tool "${toolName}" not found` },
            })
            return
          }

          const result = await (tool.execute as (input: Record<string, unknown>) => Promise<unknown>)(request.arguments)
          jsonResponse(res, 200, {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
              isError: false,
            },
          })
          return
        }
      }
      if (req.method !== 'GET' && req.method !== 'POST') {
        jsonResponse(res, 405, { error: 'Method Not Allowed' })
        return
      }
    }

    jsonResponse(res, 404, { error: 'Not Found', path: pathname })
  }

  return {
    server,
    port,
    hostname,
    roomManager,
    store,
    start: async () => {
      return new Promise((resolve, reject) => {
        const onError = (error: Error) => {
          server.off('listening', onListening)
          reject(error)
        }
        const onListening = () => {
          server.off('error', onError)
          resolve({ port, hostname })
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(port, hostname)
      })
    },
    close: async () => {
      roomManager.dispose()
      return new Promise((resolve, reject) => {
        if (!server.listening) {
          resolve()
          return
        }
        server.close((err) => (err ? reject(err) : resolve()))
      })
    },
  }
}
