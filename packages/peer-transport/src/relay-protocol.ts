/**
 * @oa-sdk/peer-transport — WebMCP Relay & Signaling Protocol Contracts
 *
 * Defines the wire protocol, message types, and validation for
 * peer server relaying, WebSocket signaling, and cloud transit.
 */
import type { DataChannelPacket } from './types.js'
import { TRANSPORT_CHANNELS } from './types.js'
import { isRecord, isSafeToolName } from './bridge-protocol.js'
import { utf8ByteLength } from './byte-length.js'

export type PeerRole = 'provider' | 'client'

export type SignalingPhase =
  | 'provider-wait'
  | 'client-wait'
  | 'pending'
  | 'approved'
  | 'offered'
  | 'answered'
  | 'closed'

export const WEBMCP_SUBPROTOCOL = 'webmcp-peer.v1'
export const MAX_SIGNAL_BYTES = 64 * 1024 // 64 KiB
export const MAX_RELAY_BYTES = 1024 * 1024 // 1 MiB
export const DEFAULT_ROOM_TTL_MS = 5 * 60 * 1000 // 5 minutes

export type SignalMessage =
  | { type: 'ready'; role: PeerRole; roomId: string; requestId: string | null }
  | { type: 'request'; roomId: string; requestId: string; clientLabel: string; identity: string }
  | { type: 'decision'; requestId: string; allow: boolean; allowedTools?: string[] | undefined }
  | { type: 'offer'; requestId: string; sdp: string }
  | { type: 'answer'; requestId: string; sdp: string }
  /** Sent by the relay to both peers; carries the provider's `allowedTools` when the decision named them. */
  | { type: 'approved'; requestId: string; allowedTools?: string[] | undefined }
  | { type: 'release'; requestId: string }
  | { type: 'released'; requestId: string }
  | { type: 'cancel' }
  | { type: 'closed'; reason: string }
  | { type: 'relay'; packet: DataChannelPacket }

export interface CloudTransitCallPayload {
  jsonrpc: '2.0'
  id: string | number
  method: 'tools/call'
  params: {
    name: string
    arguments?: Record<string, unknown> | undefined
  }
}

export interface CloudTransitCallResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: {
    content: Array<{ type: 'text'; text: string } | Record<string, unknown>>
    isError?: boolean | undefined
    structuredContent?: Record<string, unknown> | undefined
  } | undefined
  error?: {
    code: number
    message: string
    data?: unknown
  } | undefined
}

/** A named runtime validator: `parse` returns the validated value or throws. */
interface SignalSchema<T> {
  parse(value: unknown): T
}

const MAX_ALLOWED_TOOLS = 1000

function requireString(value: unknown, code: string): string {
  if (typeof value !== 'string') throw new TypeError(code)
  return value
}

/** An allow-list is absent or a bounded array of safe tool names. */
function parseAllowedToolList(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > MAX_ALLOWED_TOOLS || !value.every(isSafeToolName)) {
    throw new TypeError('BAD_ALLOWED_TOOLS')
  }
  return [...value]
}

function optionalNumber(packet: Record<string, unknown>, field: string): boolean {
  return packet[field] === undefined || (typeof packet[field] === 'number' && Number.isFinite(packet[field]))
}

/**
 * A relayed packet. Its known members are type-checked and the packet is
 * forwarded as sent, so members a newer peer adds still reach the other side.
 */
function parseRelayPacket(value: unknown): DataChannelPacket {
  if (
    !isRecord(value) ||
    !isRelayPacket(value) ||
    !optionalNumber(value, 'seq') ||
    !optionalNumber(value, 'timestamp') ||
    !optionalNumber(value, 'sessionEpoch') ||
    (value.senderId !== undefined && typeof value.senderId !== 'string')
  ) {
    throw new TypeError('BAD_RELAY_PACKET')
  }
  return value
}

/**
 * One signaling frame. Each message is rebuilt from its validated members, so
 * a frame the room forwards carries nothing the protocol does not define.
 * Violations throw with the protocol error code as the message.
 */
const SignalMessageSchema: SignalSchema<SignalMessage> = {
  parse(value) {
    if (!isRecord(value)) {
      throw new TypeError('BAD_SIGNAL: payload must be an object')
    }
    const obj = value
    const type = obj.type
    if (typeof type !== 'string') {
      throw new TypeError('BAD_SIGNAL: missing or invalid type property')
    }

    switch (type) {
      case 'ready': {
        if (obj.role !== 'provider' && obj.role !== 'client') throw new TypeError('BAD_ROLE')
        const requestId = obj.requestId ?? null
        if (requestId !== null && typeof requestId !== 'string') throw new TypeError('BAD_REQUEST_ID')
        return { type, role: obj.role, roomId: requireString(obj.roomId, 'BAD_ROOM_ID'), requestId }
      }

      case 'request':
        return {
          type,
          roomId: requireString(obj.roomId, 'BAD_ROOM_ID'),
          requestId: requireString(obj.requestId, 'BAD_REQUEST_ID'),
          clientLabel: requireString(obj.clientLabel, 'BAD_CLIENT_LABEL'),
          identity: requireString(obj.identity, 'BAD_IDENTITY'),
        }

      case 'decision': {
        const requestId = requireString(obj.requestId, 'BAD_REQUEST_ID')
        if (typeof obj.allow !== 'boolean') throw new TypeError('BAD_DECISION')
        const allowedTools = parseAllowedToolList(obj.allowedTools)
        return { type, requestId, allow: obj.allow, ...(allowedTools === undefined ? {} : { allowedTools }) }
      }

      case 'offer':
      case 'answer': {
        const requestId = requireString(obj.requestId, 'BAD_REQUEST_ID')
        const sdp = requireString(obj.sdp, 'BAD_SDP')
        validateSdp(sdp)
        return { type, requestId, sdp }
      }

      case 'approved': {
        const requestId = requireString(obj.requestId, 'BAD_REQUEST_ID')
        const allowedTools = parseAllowedToolList(obj.allowedTools)
        return { type, requestId, ...(allowedTools === undefined ? {} : { allowedTools }) }
      }

      case 'release':
      case 'released':
        return { type, requestId: requireString(obj.requestId, 'BAD_REQUEST_ID') }

      case 'cancel':
        return { type: 'cancel' }

      case 'closed':
        return { type, reason: requireString(obj.reason, 'BAD_REASON') }

      case 'relay':
        return { type, packet: parseRelayPacket(obj.packet) }

      default:
        throw new TypeError(`UNKNOWN_SIGNAL_TYPE: ${type.slice(0, 64)}`)
    }
  },
}

/**
 * Parse one wire frame. Relay frames may be up to MAX_RELAY_BYTES; every other
 * signal is limited to MAX_SIGNAL_BYTES, decided by the parsed `type` rather
 * than by the frame's text.
 */
export function parseSignalMessage(text: string): SignalMessage {
  if (typeof text !== 'string') {
    throw new TypeError('BAD_SIGNAL: payload must be a string')
  }
  const byteLength = utf8ByteLength(text)
  if (byteLength > MAX_RELAY_BYTES) {
    throw new Error('RELAY_PAYLOAD_TOO_LARGE')
  }

  let message: SignalMessage
  try {
    message = SignalMessageSchema.parse(JSON.parse(text))
  } catch (error) {
    // JSON.parse reports malformed text as SyntaxError; schema violations keep their own code.
    if (error instanceof SyntaxError) throw new Error('BAD_SIGNAL: invalid JSON')
    throw error
  }

  if (message.type !== 'relay' && byteLength > MAX_SIGNAL_BYTES) {
    throw new Error('SIGNAL_TOO_LARGE')
  }
  return message
}

export function validateSdp(sdp: string): void {
  const byteLength = utf8ByteLength(sdp)
  if (byteLength > 48 * 1024 || !sdp.startsWith('v=0')) {
    throw new Error('BAD_SDP')
  }
  const lines = sdp.split(/\r?\n/)
  const mediaLines = lines.filter((l) => l.startsWith('m='))
  if (mediaLines.length !== 1 || !lines.some((l) => /^m=application /.test(l))) {
    throw new Error('DATA_CHANNEL_ONLY')
  }
  if (!lines.some((l) => /^a=fingerprint:sha-256 [\dA-Fa-f:]+$/.test(l))) {
    throw new Error('DTLS_REQUIRED')
  }
  if (!lines.some((l) => /^a=ice-ufrag:/.test(l)) || !lines.some((l) => /^a=ice-pwd:/.test(l))) {
    throw new Error('ICE_REQUIRED')
  }
}

export function isRelayPacket(packet: unknown): packet is DataChannelPacket {
  if (!packet || typeof packet !== 'object') return false
  const p = packet as Record<string, unknown>
  return (
    typeof p.channel === 'string' &&
    (TRANSPORT_CHANNELS as readonly string[]).includes(p.channel) &&
    'payload' in p
  )
}
