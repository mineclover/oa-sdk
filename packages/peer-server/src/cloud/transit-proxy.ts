/**
 * @oa-sdk/peer-server/cloud — WebMCP Cloud Transit Proxy
 *
 * Exposes Streamable HTTP JSON-RPC MCP endpoints that forward tool calls
 * across cloud boundaries to connected WebMCP peers.
 *
 * Both handlers enforce the access policy they are given: a request from an
 * Origin that is not allowed gets 403 (with no CORS headers), and when a
 * `publishKey` is set a request without it (`X-Peer-Publish-Key` or
 * `Authorization: Bearer`) gets 401. Without `allowedOrigins` only exact
 * loopback origins are allowed; requests without an Origin header (servers,
 * CLIs) are not subject to the origin check.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PeerRoomManager } from '../room.js'
import type { FilePeerStore } from '../store.js'
import { isPlainRecord, isSafeAlias } from '../peer-record.js'
import { checkHttpAccess, corsHeaders, headerReader, type HeaderReader, type HttpAccess } from '../http-guards.js'

export interface CloudTransitOptions {
  roomManager: PeerRoomManager
  store?: FilePeerStore | undefined
  defaultAlias?: string | undefined
  /** Secret every non-preflight request must carry. Unset means no key is required. */
  publishKey?: string | undefined
  /** Browser origins allowed to call the proxy (default: exact loopback origins only). */
  allowedOrigins?: string[] | undefined
  maxBodyBytes?: number | undefined
}

export interface McpRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null | undefined
  method: string
  params?: Record<string, unknown> | undefined
}

/** A request body as the HTTP boundary validated it. */
type ParsedMcpRpcRequest =
  | { valid: true; request: McpRpcRequest }
  | { valid: false; id: string | number | null }

function rpcId(value: unknown): string | number | null | undefined {
  if (value === undefined || value === null) return value
  return typeof value === 'string' || typeof value === 'number' ? value : undefined
}

/**
 * A JSON-RPC 2.0 request body: `jsonrpc: '2.0'`, a string `method`, an id
 * that is a string, a number or null (absent for notifications), and object
 * `params` when present. Anything else is an Invalid Request (-32600).
 */
const McpRpcRequestSchema: { parse(value: unknown): ParsedMcpRpcRequest } = {
  parse(value) {
    if (!isPlainRecord(value)) return { valid: false, id: null }
    const id = rpcId(value.id)
    if (value.jsonrpc !== '2.0' || typeof value.method !== 'string' || (value.id !== undefined && id === undefined)) {
      return { valid: false, id: id ?? null }
    }
    if (value.params !== undefined && !isPlainRecord(value.params)) return { valid: false, id: id ?? null }
    return {
      valid: true,
      request: {
        jsonrpc: '2.0',
        method: value.method,
        ...(id === undefined ? {} : { id }),
        ...(value.params === undefined ? {} : { params: value.params }),
      },
    }
  },
}

const INVALID_REQUEST = { code: -32600, message: 'Invalid Request' }
const PARSE_ERROR = { code: -32700, message: 'Parse error' }

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
  readonly defaultAlias: string
  private readonly publishKey?: string | undefined
  private readonly allowedOrigins?: readonly string[] | undefined

  constructor(options: CloudTransitOptions) {
    this.roomManager = options.roomManager
    this.store = options.store
    this.defaultAlias = options.defaultAlias ?? 'wireframe-local'
    this.publishKey = options.publishKey
    this.allowedOrigins = options.allowedOrigins
  }

  /**
   * Apply this proxy's access policy (publishKey and allowedOrigins) to one
   * request. A disallowed Origin is 403; a non-preflight request without the
   * publishKey is 401. On success, `origin` is the Origin to echo, if any.
   */
  authorize(header: HeaderReader, method: string | undefined): HttpAccess {
    return checkHttpAccess(header, method, { publishKey: this.publishKey, allowedOrigins: this.allowedOrigins })
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
      const rawArgs = req.params?.arguments ?? {}
      if (typeof toolName !== 'string') {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Tool name required in params.name' },
        }
      }
      if (!isPlainRecord(rawArgs)) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'params.arguments must be an object' },
        }
      }
      const toolArgs = rawArgs

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

/** The target peer alias of a transit request, or why it is not usable. */
type AliasTarget = { alias: string } | { error: string }

function aliasTarget(alias: string): AliasTarget {
  return isSafeAlias(alias) ? { alias } : { error: 'Invalid peer alias' }
}

function decodeAlias(segment: string): AliasTarget {
  try {
    return aliasTarget(decodeURIComponent(segment))
  } catch {
    return { error: 'Invalid peer alias' }
  }
}

/**
 * Resolve `/transit/:peer/mcp` or `/mcp` (peer from X-Target-Peer, `?peer=`
 * or the default alias). `null` means the path is not a transit route.
 */
function resolveTransitTarget(requestUrl: string, header: HeaderReader, defaultAlias: string): AliasTarget | null {
  let url: URL
  try {
    // Only the path and query are read, so the client's Host header is never parsed.
    url = new URL(requestUrl, 'http://transit.invalid')
  } catch {
    return null
  }
  const transitMatch = url.pathname.match(/^\/transit\/([^/]+)\/mcp$/)
  if (transitMatch) return decodeAlias(transitMatch[1]!)
  if (url.pathname !== '/mcp') return null
  return aliasTarget(header('x-target-peer') ?? url.searchParams.get('peer') ?? defaultAlias)
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
  const header = headerReader(req.headers)
  const proxy = new CloudTransitProxy(options)
  const target = resolveTransitTarget(req.url ?? '/', header, proxy.defaultAlias)
  if (!target) {
    return false
  }

  const access = proxy.authorize(header, req.method)
  if (!access.allowed) {
    res.writeHead(access.status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: access.error }))
    return true
  }
  for (const [name, value] of Object.entries(corsHeaders(access.origin))) res.setHeader(name, value)

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

  if ('error' in target) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: target.error }))
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

  let parsed: ParsedMcpRpcRequest
  try {
    parsed = McpRpcRequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: PARSE_ERROR }))
    return true
  }

  const response: McpRpcResponse | null = parsed.valid
    ? await proxy.processRpcRequest(target.alias, parsed.request)
    : { jsonrpc: '2.0', id: parsed.id, error: INVALID_REQUEST }

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
 * The proxy's `publishKey` and `allowedOrigins` are enforced (see the module
 * comment); CORS headers echo only an allowed Origin.
 */
export async function handleCloudTransitWorker(
  request: Request,
  proxy: CloudTransitProxy,
  defaultAlias = proxy.defaultAlias,
): Promise<Response> {
  const header: HeaderReader = (name) => request.headers.get(name) ?? undefined
  const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...extra } })

  const access = proxy.authorize(header, request.method)
  if (!access.allowed) {
    return json(access.status, { error: access.error })
  }
  const cors = corsHeaders(access.origin)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  if (request.method !== 'POST') {
    return json(405, { error: 'METHOD_NOT_ALLOWED' }, cors)
  }

  const url = new URL(request.url)
  const match = url.pathname.match(/^\/transit\/([^/]+)\/mcp$/)
  const target = match
    ? decodeAlias(match[1]!)
    : aliasTarget(url.searchParams.get('peer') ?? header('x-target-peer') ?? defaultAlias)
  if ('error' in target) {
    return json(400, { error: target.error }, cors)
  }

  let parsed: ParsedMcpRpcRequest
  try {
    parsed = McpRpcRequestSchema.parse(JSON.parse(await request.text()))
  } catch {
    return json(400, { jsonrpc: '2.0', id: null, error: PARSE_ERROR }, cors)
  }

  const result: McpRpcResponse | null = parsed.valid
    ? await proxy.processRpcRequest(target.alias, parsed.request)
    : { jsonrpc: '2.0', id: parsed.id, error: INVALID_REQUEST }
  if (!result) {
    return new Response(null, { status: 204, headers: cors })
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...cors,
    },
  })
}
