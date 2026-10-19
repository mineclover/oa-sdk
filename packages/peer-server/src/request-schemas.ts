/**
 * @oa-sdk/peer-server — HTTP request body schemas.
 *
 * Each JSON body is parsed straight into one of these schemas. A violation is
 * reported as a RequestError carrying the HTTP status and the message the
 * route returns to the client.
 */
import type { WebMcpPeerRecord } from '@oa-sdk/peer-transport'
import { boundedString, isPlainRecord, isSafeToolName, parsePeerRecord } from './peer-record.js'
import { isSafeAlias } from './store.js'
import type { SignalingRoomEntry } from './types.js'

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
 * Record fields the server owns. The store stamps `updatedAt` with its own
 * clock on every announcement, so a client value is ignored rather than
 * validated (`alias` is checked separately and passed explicitly).
 */
const SERVER_OWNED_ANNOUNCEMENT_FIELDS = ['updatedAt'] as const

type RoomTool = SignalingRoomEntry['cachedTools'][number]

/** A validated `POST /announce` body. */
export interface PeerAnnouncement {
  /** The record as the peer store keeps it: known fields only. */
  record: WebMcpPeerRecord
  /** The announced tool catalog as the live room serves it from `GET /tools`. */
  roomTools: RoomTool[]
}

/**
 * True when `value` is JSON data as JSON.parse produces it: null, a boolean,
 * a string, a finite number, or an array or plain object of those, with no
 * object reached twice.
 */
function isJsonValue(value: unknown): boolean {
  // Iterative, so a deeply nested announcement cannot overflow the stack.
  const pending: unknown[] = [value]
  const seen = new Set<object>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === null || typeof current === 'string' || typeof current === 'boolean') continue
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) return false
      continue
    }
    if (typeof current !== 'object' || seen.has(current)) return false
    seen.add(current)
    if (Array.isArray(current)) {
      for (const item of current) pending.push(item)
    } else if (isPlainRecord(current)) {
      for (const member of Object.values(current)) pending.push(member)
    } else {
      return false
    }
  }
  return true
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return isPlainRecord(value) && isJsonValue(value)
}

/**
 * Type checks for the MCP tool members the room catalog knows. `description`
 * and `inputSchema` are also checked by parsePeerRecord, which rejects the
 * whole announcement when they have the wrong type.
 */
const ROOM_TOOL_MEMBER_CHECKS = new Map<string, (value: unknown) => boolean>([
  ['description', boundedString],
  ['inputSchema', isJsonObject],
  ['title', boundedString],
  ['annotations', isJsonObject],
  ['outputSchema', isJsonObject],
])

/**
 * One announced tool as the room serves it. The name must be safe. Every other
 * member is kept as announced when it passes its type check (known members)
 * or is JSON data (other members, such as `_meta`); a member that fails is
 * left out without rejecting the announcement.
 */
function parseRoomTool(entry: unknown): RoomTool {
  if (!isPlainRecord(entry) || !isSafeToolName(entry.name)) throw new RequestError(400, 'Invalid cachedTools catalog')
  const tool: RoomTool = { name: entry.name }
  for (const [member, memberValue] of Object.entries(entry)) {
    // An own `__proto__` member (JSON.parse creates one) is never copied.
    if (member === 'name' || member === '__proto__') continue
    const check = ROOM_TOOL_MEMBER_CHECKS.get(member) ?? isJsonValue
    if (check(memberValue)) tool[member] = memberValue
  }
  return tool
}

/**
 * `POST /announce`. The announced record is rebuilt with the same contract as
 * the peer store, so a field of the wrong type is a 400 rather than a store
 * failure after the request was accepted. The store keeps the normalized
 * record; the live room keeps the announced tool members (see parseRoomTool).
 */
export const PeerAnnouncementSchema: RequestSchema<PeerAnnouncement> = {
  parse(value) {
    if (!isPlainRecord(value)) throw new RequestError(400, 'Peer record must be an object')
    if (!isSafeAlias(value.alias)) throw new RequestError(400, 'Invalid peer alias')
    const cachedTools = value.cachedTools ?? []
    if (!Array.isArray(cachedTools) || cachedTools.length > MAX_ANNOUNCED_TOOLS) {
      throw new RequestError(400, 'Invalid cachedTools catalog')
    }
    const roomTools = cachedTools.map(parseRoomTool)
    if (value.origin !== undefined) {
      if (typeof value.origin !== 'string' || value.origin.length > MAX_ORIGIN_LENGTH || !isExactHttpOrigin(value.origin)) {
        throw new RequestError(400, 'Invalid peer origin')
      }
    }
    const announced: Record<string, unknown> = { ...value, cachedTools }
    for (const field of SERVER_OWNED_ANNOUNCEMENT_FIELDS) delete announced[field]
    let record: WebMcpPeerRecord
    try {
      record = parsePeerRecord(value.alias, announced)
    } catch {
      throw new RequestError(400, 'Invalid peer record')
    }
    return { record, roomTools }
  },
}

/** A validated `POST /p/:roomId/join` body. */
export interface JoinRequest {
  clientLabel: string
  /** The invitation, when the client sends it in the body instead of `Authorization: Bearer`. */
  inviteToken: string | undefined
}

/** `POST /p/:roomId/join`. Both members are optional; the room checks the label and the invitation. */
export const JoinRequestSchema: RequestSchema<JoinRequest> = {
  parse(value) {
    if (!isPlainRecord(value)) throw new RequestError(400, 'Join payload must be an object')
    const { clientLabel, inviteToken } = value
    if (clientLabel !== undefined && typeof clientLabel !== 'string') throw new RequestError(400, 'Invalid clientLabel')
    if (inviteToken !== undefined && typeof inviteToken !== 'string') throw new RequestError(400, 'Invalid inviteToken')
    return { clientLabel: clientLabel ?? 'client', inviteToken }
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
