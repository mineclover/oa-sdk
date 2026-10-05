/**
 * @oa-sdk/peer-server — HTTP request body schemas.
 *
 * Each JSON body is parsed straight into one of these schemas. A violation is
 * reported as a RequestError carrying the HTTP status and the message the
 * route returns to the client.
 */
import type { WebMcpPeerRecord } from '@oa-sdk/peer-transport'
import { isPlainRecord, isSafeToolName, parsePeerRecord } from './peer-record.js'
import { isSafeAlias } from './store.js'

const MAX_SESSION_ID_LENGTH = 256
const MAX_ANNOUNCED_TOOLS = 1000
const MAX_ORIGIN_LENGTH = 2048

export class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

export interface RequestSchema<T> {
  parse(value: unknown): T
}

export interface ToolCallRequest {
  tool: string
  args: Record<string, unknown> | undefined
  /** Target alias; absent (or null) selects the server default. */
  peer: string | undefined
  sessionId: string | undefined
}

/** `POST /call` */
export const ToolCallRequestSchema: RequestSchema<ToolCallRequest> = {
  parse(value) {
    if (!isPlainRecord(value)) throw new RequestError(400, 'Request payload must be an object')
    const { tool, args, peer, sessionId } = value
    if (!isSafeToolName(tool) || (args !== undefined && !isPlainRecord(args))) {
      throw new RequestError(400, 'Invalid tool call payload')
    }
    if (sessionId !== undefined && (typeof sessionId !== 'string' || sessionId.length > MAX_SESSION_ID_LENGTH)) {
      throw new RequestError(400, 'Invalid sessionId')
    }
    if (peer !== undefined && peer !== null && !isSafeAlias(peer)) throw new RequestError(400, 'Invalid peer alias')
    return { tool, args, peer: peer ?? undefined, sessionId }
  },
}

function isExactHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value
  } catch {
    return false
  }
}

/**
 * `POST /announce`. The announced record is rebuilt with the same contract as
 * the peer store, so a field of the wrong type is a 400 rather than a store
 * failure after the request was accepted.
 */
export const PeerAnnouncementSchema: RequestSchema<WebMcpPeerRecord> = {
  parse(value) {
    if (!isPlainRecord(value)) throw new RequestError(400, 'Peer record must be an object')
    if (!isSafeAlias(value.alias)) throw new RequestError(400, 'Invalid peer alias')
    const cachedTools = value.cachedTools ?? []
    if (
      !Array.isArray(cachedTools)
      || cachedTools.length > MAX_ANNOUNCED_TOOLS
      || cachedTools.some((entry) => !isPlainRecord(entry) || !isSafeToolName(entry.name))
    ) {
      throw new RequestError(400, 'Invalid cachedTools catalog')
    }
    if (value.origin !== undefined) {
      if (typeof value.origin !== 'string' || value.origin.length > MAX_ORIGIN_LENGTH || !isExactHttpOrigin(value.origin)) {
        throw new RequestError(400, 'Invalid peer origin')
      }
    }
    try {
      return parsePeerRecord(value.alias, { ...value, cachedTools })
    } catch {
      throw new RequestError(400, 'Invalid peer record')
    }
  },
}

export type JsonRpcId = string | number | null

export type HomeMcpRequest =
  | { kind: 'invalid' }
  | { kind: 'tools/list'; id: JsonRpcId }
  | { kind: 'tools/call'; id: JsonRpcId; name: string; arguments: Record<string, unknown> }
  | { kind: 'invalid-call-params'; id: JsonRpcId }
  | { kind: 'unsupported'; id: JsonRpcId }

function jsonRpcId(value: unknown): JsonRpcId {
  return typeof value === 'string' || typeof value === 'number' ? value : null
}

/** `POST /home/mcp` JSON-RPC envelope. Never throws: every outcome has a JSON-RPC reply. */
export const HomeMcpRequestSchema: RequestSchema<HomeMcpRequest> = {
  parse(value) {
    if (!isPlainRecord(value)) return { kind: 'invalid' }
    const id = jsonRpcId(value.id)
    if (value.method === 'tools/list') return { kind: 'tools/list', id }
    if (value.method !== 'tools/call') return { kind: 'unsupported', id }
    const params = value.params
    if (!isPlainRecord(params) || !isSafeToolName(params.name)) return { kind: 'invalid-call-params', id }
    if (params.arguments !== undefined && !isPlainRecord(params.arguments)) return { kind: 'invalid-call-params', id }
    return { kind: 'tools/call', id, name: params.name, arguments: params.arguments ?? {} }
  },
}
