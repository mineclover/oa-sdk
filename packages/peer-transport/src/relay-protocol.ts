/**
 * @oa-sdk/peer-transport — WebMCP Relay & Signaling Protocol Contracts
 *
 * Defines the wire protocol, message types, and validation for
 * peer server relaying, WebSocket signaling, and cloud transit.
 */
import type { DataChannelPacket, TransportChannelType } from './types.js'

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
  | { type: 'approved'; requestId: string }
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

export function parseSignalMessage(text: string): SignalMessage {
  if (typeof text !== 'string') {
    throw new Error('BAD_SIGNAL: payload must be a string')
  }
  const byteLength = Buffer.byteLength(text, 'utf8')
  if (byteLength > MAX_SIGNAL_BYTES && !text.includes('"type":"relay"')) {
    throw new Error('SIGNAL_TOO_LARGE')
  }
  if (byteLength > MAX_RELAY_BYTES) {
    throw new Error('RELAY_PAYLOAD_TOO_LARGE')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('BAD_SIGNAL: invalid JSON')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('BAD_SIGNAL: payload must be an object')
  }

  const obj = parsed as Record<string, unknown>
  const type = obj.type
  if (typeof type !== 'string') {
    throw new Error('BAD_SIGNAL: missing or invalid type property')
  }

  switch (type) {
    case 'ready':
      if (obj.role !== 'provider' && obj.role !== 'client') throw new Error('BAD_ROLE')
      if (typeof obj.roomId !== 'string') throw new Error('BAD_ROOM_ID')
      return obj as SignalMessage

    case 'request':
      if (typeof obj.roomId !== 'string') throw new Error('BAD_ROOM_ID')
      if (typeof obj.requestId !== 'string') throw new Error('BAD_REQUEST_ID')
      if (typeof obj.clientLabel !== 'string') throw new Error('BAD_CLIENT_LABEL')
      return obj as SignalMessage

    case 'decision':
      if (typeof obj.requestId !== 'string') throw new Error('BAD_REQUEST_ID')
      if (typeof obj.allow !== 'boolean') throw new Error('BAD_DECISION')
      return obj as SignalMessage

    case 'offer':
    case 'answer':
      if (typeof obj.requestId !== 'string') throw new Error('BAD_REQUEST_ID')
      if (typeof obj.sdp !== 'string') throw new Error('BAD_SDP')
      validateSdp(obj.sdp)
      return obj as SignalMessage

    case 'approved':
    case 'release':
    case 'released':
      if (typeof obj.requestId !== 'string') throw new Error('BAD_REQUEST_ID')
      return obj as SignalMessage

    case 'cancel':
      return { type: 'cancel' }

    case 'closed':
      if (typeof obj.reason !== 'string') throw new Error('BAD_REASON')
      return obj as SignalMessage

    case 'relay':
      if (!obj.packet || typeof obj.packet !== 'object') throw new Error('BAD_RELAY_PACKET')
      return obj as SignalMessage

    default:
      throw new Error(`UNKNOWN_SIGNAL_TYPE: ${type}`)
  }
}

export function validateSdp(sdp: string): void {
  const byteLength = Buffer.byteLength(sdp, 'utf8')
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
    ['mcp-jsonrpc', 'crdt-delta', 'presence'].includes(p.channel) &&
    'payload' in p
  )
}
