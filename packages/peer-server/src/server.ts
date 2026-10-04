/**
 * @oa-sdk/peer-server — HTTP & Peering Signaling Daemon Server
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { FilePeerStore } from './store.js'
import { isSafeAlias } from './store.js'
import { PeerRoomManager } from './room.js'
import { createHomeMcpTools } from './home-mcp.js'
import type { PeerServerOptions, SignalingRoomEntry } from './types.js'

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024
const MAX_CONFIGURED_BODY_BYTES = 16 * 1024 * 1024
const MAX_TOOL_NAME_LENGTH = 256
const MAX_SESSION_ID_LENGTH = 256

class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

function isSafeToolName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TOOL_NAME_LENGTH && !/[\u0000-\u001f\u007f]/.test(value)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

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

async function readJsonBody(req: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
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
  if (total === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new RequestError(400, 'Invalid JSON payload')
  }
}

function sanitizePeerRecord(record: Record<string, unknown>): Record<string, unknown> {
  const { token: _token, invitationUrl: _invitationUrl, ...safe } = record
  return safe
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
        peers: Object.fromEntries(Object.entries(data.peers).map(([alias, peer]) => [alias, sanitizePeerRecord(peer as unknown as Record<string, unknown>)])),
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
      const payload = await readJsonBody(req, maxBodyBytes)
      if (!isPlainRecord(payload)) {
        jsonResponse(res, 400, { error: 'Request payload must be an object' })
        return
      }

      const { tool, args, peer, sessionId } = payload
      if (!isSafeToolName(tool) || (args !== undefined && !isPlainRecord(args))) {
        jsonResponse(res, 400, { error: 'Invalid tool call payload' })
        return
      }
      if (sessionId !== undefined && (typeof sessionId !== 'string' || sessionId.length > MAX_SESSION_ID_LENGTH)) {
        jsonResponse(res, 400, { error: 'Invalid sessionId' })
        return
      }
      const targetAlias = peer ?? options.defaultAlias ?? 'wireframe-local'
      if (!isSafeAlias(targetAlias)) {
        jsonResponse(res, 400, { error: 'Invalid peer alias' })
        return
      }

      try {
        const result = await roomManager.executeMcpCallOnPeer(targetAlias, tool, args ?? {}, 3500, 30000, maxPendingCalls)
        jsonResponse(res, 200, { result })
      } catch (err: any) {
        const message = typeof err?.message === 'string' ? err.message : 'Tool execution failed'
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
      const peerRecord = await readJsonBody(req, maxBodyBytes)
      if (!isPlainRecord(peerRecord)) {
        jsonResponse(res, 400, { error: 'Peer record must be an object' })
        return
      }

      if (!isSafeAlias(peerRecord.alias)) {
        jsonResponse(res, 400, { error: 'Invalid peer alias' })
        return
      }
      const cachedTools = peerRecord.cachedTools ?? []
      if (!Array.isArray(cachedTools) || cachedTools.length > 1000 || cachedTools.some((entry) => !isPlainRecord(entry) || !isSafeToolName(entry.name))) {
        jsonResponse(res, 400, { error: 'Invalid cachedTools catalog' })
        return
      }
      if (peerRecord.origin !== undefined) {
        if (typeof peerRecord.origin !== 'string' || peerRecord.origin.length > 2048) {
          jsonResponse(res, 400, { error: 'Invalid peer origin' })
          return
        }
        try {
          const originUrl = new URL(peerRecord.origin)
          if (!['http:', 'https:'].includes(originUrl.protocol) || originUrl.origin !== peerRecord.origin) throw new Error()
        } catch {
          jsonResponse(res, 400, { error: 'Invalid peer origin' })
          return
        }
      }

      const peerAlias = peerRecord.alias
      const peerId = typeof peerRecord.id === 'string' ? peerRecord.id : peerAlias
      const peerTitle = typeof peerRecord.title === 'string' ? peerRecord.title : undefined
      const updated = await store.updatePeer(peerAlias, { ...peerRecord, cachedTools })
      roomManager.registerRoom({
        id: peerId,
        alias: peerAlias,
        title: peerTitle,
        origin: peerRecord.origin,
        status: 'connected',
        cachedTools: cachedTools as SignalingRoomEntry['cachedTools'],
        allowedTools: Array.isArray(peerRecord.allowedTools) ? peerRecord.allowedTools.filter(isSafeToolName) : undefined,
        updatedAt: Date.now(),
      })

      jsonResponse(res, 200, { ok: true, peer: sanitizePeerRecord(updated as unknown as Record<string, unknown>) })
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
        const body = await readJsonBody(req, maxBodyBytes)
        if (!isPlainRecord(body)) {
          jsonResponse(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } })
          return
        }

        if (body.method === 'tools/list') {
          jsonResponse(res, 200, {
            jsonrpc: '2.0',
            id: body.id ?? null,
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

        if (body.method === 'tools/call') {
          if (!isPlainRecord(body.params) || !isSafeToolName(body.params.name) || (body.params.arguments !== undefined && !isPlainRecord(body.params.arguments))) {
            jsonResponse(res, 200, { jsonrpc: '2.0', id: body.id ?? null, error: { code: -32600, message: 'Invalid tools/call params' } })
            return
          }
          const params = body.params as Record<string, unknown>
          const toolName = params.name as string
          const tool = homeTools.find((t) => t.name === toolName)
          if (!tool) {
            jsonResponse(res, 200, {
              jsonrpc: '2.0',
              id: body.id ?? null,
              error: { code: -32601, message: `Tool "${toolName}" not found` },
            })
            return
          }

          const result = await (tool.execute as (input: Record<string, unknown>) => Promise<unknown>)(params.arguments as Record<string, unknown> ?? {})
          jsonResponse(res, 200, {
            jsonrpc: '2.0',
            id: body.id ?? null,
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
