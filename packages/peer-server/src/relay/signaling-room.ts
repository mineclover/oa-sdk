/**
 * @oa-sdk/peer-server/relay — Signaling & Relay Room
 *
 * Implements the WebMCP signaling room FSM and duplex packet relay
 * between provider and client. Compatible with Node.js and Edge/Workers.
 */
import type { DataChannelPacket } from '@oa-sdk/peer-transport'
import {
  parseSignalMessage,
  type PeerRole,
  type SignalingPhase,
  type SignalMessage,
  DEFAULT_ROOM_TTL_MS,
} from '@oa-sdk/peer-transport'
import { isPlainRecord } from '../peer-record.js'
import { resolveRelaySessionLimits, roomTtlMs } from './session-limits.js'

export { DEFAULT_RELAY_IDLE_TIMEOUT_MS, DEFAULT_RELAY_MAX_SESSION_MS } from './session-limits.js'

/** Signaling frames (every frame but relay packets) one room accepts in total. */
export const MAX_SIGNAL_FRAMES = 32
/** After approval, the offer/answer/release handshake must finish within this window. */
export const SIGNALING_WINDOW_MS = 60_000

export interface SignalingRoomState {
  id: string
  /**
   * Signaling deadline: the room TTL until approval, then at most
   * SIGNALING_WINDOW_MS after approval for offer/answer/release frames.
   * Relay packets are bounded by the relay deadlines instead.
   */
  expiresAt: number
  phase: SignalingPhase
  providerHash: string
  inviteHash: string
  clientHash?: string | undefined
  requestId?: string | undefined
  clientLabel?: string | undefined
  attached: Partial<Record<PeerRole, boolean>>
  released: Partial<Record<PeerRole, boolean>>
  frames: number
  /** Tools the provider's decision allowed the client to call; absent means no restriction. */
  allowedTools?: string[] | undefined
  /** Idle deadline of the approved relay session (absent when idle expiry does not apply). */
  relayIdleExpiresAt?: number | undefined
  /** Hard deadline of the approved relay session; set on approval. */
  relayMaxExpiresAt?: number | undefined
  /** True when the client side is the server's Cloud Transit bridge rather than a remote peer. */
  virtualClient?: boolean | undefined
}

export interface SignalingRoomOptions {
  /**
   * Idle limit of an approved relay session in ms; every relay frame, in
   * either direction, renews it (default 5 minutes, 0 disables). It does not
   * apply to a room bound to Cloud Transit, whose traffic comes from callers.
   */
  relayIdleTimeoutMs?: number | undefined
  /** Hard limit of an approved relay session in ms (default 24 hours). */
  relayMaxSessionMs?: number | undefined
  /** Clock used by the room (default Date.now). */
  clock?: (() => number) | undefined
}

function otherRole(role: PeerRole): PeerRole {
  return role === 'provider' ? 'client' : 'provider'
}

type RelaySignal = Extract<SignalMessage, { type: 'relay' }>

export interface RoomDelivery {
  to: PeerRole
  message: SignalMessage
  close?: boolean | undefined
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function randomHex(bytes = 24): string {
  const buf = new Uint8Array(bytes)
  globalThis.crypto.getRandomValues(buf)
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export class SignalingRoom {
  readonly state: SignalingRoomState
  private readonly now: () => number
  private readonly relayIdleTimeoutMs: number
  private readonly relayMaxSessionMs: number

  constructor(state: SignalingRoomState, now: () => number = () => Date.now(), options: SignalingRoomOptions = {}) {
    this.state = state
    this.now = now
    const limits = resolveRelaySessionLimits(options)
    this.relayIdleTimeoutMs = limits.relayIdleTimeoutMs
    this.relayMaxSessionMs = limits.relayMaxSessionMs
  }

  static async create(
    ttlMs = DEFAULT_ROOM_TTL_MS,
    now?: number,
    options: SignalingRoomOptions = {},
  ): Promise<{
    room: SignalingRoom
    providerToken: string
    inviteToken: string
  }> {
    roomTtlMs(ttlMs, 'ttlMs')
    const providerToken = randomHex(24) // 48 hex chars
    const inviteToken = randomHex(24)   // 48 hex chars
    const roomId = randomHex(16)        // 32 hex chars

    const [providerHash, inviteHash] = await Promise.all([
      sha256Hex(providerToken),
      sha256Hex(inviteToken),
    ])

    const clock = options.clock ?? (() => Date.now())
    const state: SignalingRoomState = {
      id: roomId,
      expiresAt: (now ?? clock()) + ttlMs,
      phase: 'provider-wait',
      providerHash,
      inviteHash,
      attached: {},
      released: {},
      frames: 0,
    }

    return {
      room: new SignalingRoom(state, clock, options),
      providerToken,
      inviteToken,
    }
  }

  private assertAlive(): void {
    if (this.state.phase === 'closed' || this.now() >= this.state.expiresAt) {
      this.state.phase = 'closed'
      throw new Error('ROOM_EXPIRED')
    }
  }

  /** True once an approved relay session passed its idle or hard deadline. */
  private relayExpired(now: number): boolean {
    const { relayIdleExpiresAt, relayMaxExpiresAt } = this.state
    if (relayMaxExpiresAt === undefined) return now >= this.state.expiresAt
    return now >= relayMaxExpiresAt || (relayIdleExpiresAt !== undefined && now >= relayIdleExpiresAt)
  }

  /**
   * True when the room should be ended: it is closed, its approved relay
   * session expired, or it was never approved and its TTL passed.
   */
  isExpired(now: number = this.now()): boolean {
    if (this.state.phase === 'closed') return true
    if (this.state.relayMaxExpiresAt !== undefined) return this.relayExpired(now)
    return now >= this.state.expiresAt
  }

  /** Open the relay session and tell both sides. */
  private approve(allowedTools: string[] | undefined): RoomDelivery[] {
    const now = this.now()
    const requestId = this.state.requestId!
    this.state.phase = 'approved'
    this.state.expiresAt = Math.min(this.state.expiresAt, now + SIGNALING_WINDOW_MS)
    this.state.relayMaxExpiresAt = now + this.relayMaxSessionMs
    this.state.relayIdleExpiresAt = this.relayIdleTimeoutMs > 0 && !this.state.virtualClient
      ? Math.min(now + this.relayIdleTimeoutMs, this.state.relayMaxExpiresAt)
      : undefined
    this.state.allowedTools = allowedTools
    const message: SignalMessage = allowedTools === undefined
      ? { type: 'approved', requestId }
      : { type: 'approved', requestId, allowedTools }
    return (['provider', 'client'] as PeerRole[]).map((to) => ({ to, message }))
  }

  /**
   * Claim an invitation token by an incoming client peer.
   */
  async claim(
    inviteToken: string,
    clientLabel: string,
  ): Promise<{ clientToken: string; requestId: string }> {
    if (typeof inviteToken !== 'string' || !/^[a-f0-9]{48}$/.test(inviteToken)) {
      throw new Error('UNAUTHORIZED')
    }
    if (
      typeof clientLabel !== 'string' ||
      clientLabel.length === 0 ||
      clientLabel.length > 80 ||
      /[\x00-\x1f\x7f]/.test(clientLabel)
    ) {
      throw new Error('BAD_LABEL')
    }

    const clientToken = randomHex(24)
    const [providedHash, clientHash] = await Promise.all([
      sha256Hex(inviteToken),
      sha256Hex(clientToken),
    ])

    this.assertAlive()
    if (this.state.phase !== 'client-wait') {
      throw new Error('ROOM_BUSY')
    }
    if (providedHash !== this.state.inviteHash) {
      throw new Error('UNAUTHORIZED')
    }

    this.state.clientHash = clientHash
    this.state.requestId = randomHex(8)
    this.state.clientLabel = clientLabel
    this.state.inviteHash = ''
    this.state.phase = 'pending'

    return {
      clientToken,
      requestId: this.state.requestId,
    }
  }

  /**
   * Authenticate a connecting WebSocket by role and ticket token.
   */
  async authenticate(role: PeerRole, token: string): Promise<void> {
    if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token)) {
      throw new Error('UNAUTHORIZED')
    }
    const provided = await sha256Hex(token)
    this.assertAlive()

    const expected = role === 'provider' ? this.state.providerHash : this.state.clientHash
    if (!expected || provided !== expected) {
      throw new Error('UNAUTHORIZED')
    }
    if (this.state.attached[role]) {
      throw new Error('ALREADY_ATTACHED')
    }
    if (role === 'provider' && this.state.phase !== 'provider-wait') {
      throw new Error('WRONG_PHASE')
    }
    if (role === 'client' && this.state.phase !== 'pending') {
      throw new Error('WRONG_PHASE')
    }
  }

  /**
   * Attach a socket to the room and return initial delivery messages.
   */
  attach(role: PeerRole): RoomDelivery[] {
    this.assertAlive()
    if (this.state.attached[role]) {
      throw new Error('ALREADY_ATTACHED')
    }
    this.state.attached[role] = true
    if (role === 'provider') {
      this.state.phase = 'client-wait'
    }

    const messages: RoomDelivery[] = [
      {
        to: role,
        message: {
          type: 'ready',
          role,
          roomId: this.state.id,
          requestId: this.state.requestId ?? null,
        },
      },
    ]

    if (role === 'client') {
      messages.push({
        to: 'provider',
        message: {
          type: 'request',
          roomId: this.state.id,
          requestId: this.state.requestId!,
          clientLabel: this.state.clientLabel ?? 'client',
          identity: 'invitation-holder-verified',
        },
      })
    }

    return messages
  }

  /**
   * Make the server the room's client: the Cloud Transit bridge takes the
   * client side of a provider that asked to serve a transit alias. The
   * provider opted in by asking, so the room is approved at once and the
   * invitation can no longer be claimed.
   */
  bindVirtualClient(clientLabel: string): RoomDelivery[] {
    this.assertAlive()
    if (!this.state.attached.provider || this.state.phase !== 'client-wait') {
      throw new Error('WRONG_PHASE')
    }
    this.state.requestId = randomHex(8)
    this.state.clientLabel = clientLabel
    this.state.inviteHash = ''
    this.state.virtualClient = true
    this.state.attached.client = true
    return this.approve(undefined)
  }

  /**
   * Handle an inbound message from one of the peers and produce deliveries.
   */
  receive(role: PeerRole, rawText: string): RoomDelivery[] {
    if (this.state.phase === 'closed') {
      throw new Error('ROOM_EXPIRED')
    }
    if (!this.state.attached[role] || this.state.released[role]) {
      throw new Error('NOT_ATTACHED')
    }

    const signal = parseSignalMessage(rawText)

    // Relay packets flow only in an approved session, bounded by the relay deadlines.
    if (signal.type === 'relay') {
      return this.relay(role, signal)
    }

    if (signal.type === 'cancel') {
      return this.end('CANCELLED')
    }

    this.assertAlive()
    if (++this.state.frames > MAX_SIGNAL_FRAMES) {
      throw new Error('SIGNAL_LIMIT')
    }

    // ready, request, approved, released and closed are issued by the relay
    // itself; a peer that sends one is forging it.
    switch (signal.type) {
      case 'decision':
      case 'offer':
      case 'answer':
      case 'release':
        break
      default:
        throw new Error('FORBIDDEN_SIGNAL')
    }

    if (signal.requestId !== this.state.requestId) {
      throw new Error('WRONG_REQUEST')
    }

    if (signal.type === 'decision') {
      if (role !== 'provider' || this.state.phase !== 'pending' || !this.state.attached.client) {
        throw new Error('WRONG_PHASE')
      }
      if (!signal.allow) {
        return this.end('DENIED')
      }
      return this.approve(signal.allowedTools)
    }

    if (signal.type === 'release') {
      if (this.state.phase !== 'answered') {
        throw new Error('WRONG_PHASE')
      }
      this.state.released[role] = true
      if (this.state.released.provider && this.state.released.client) {
        this.state.phase = 'closed'
      }
      return [
        {
          to: role,
          message: { type: 'released', requestId: signal.requestId },
          close: true,
        },
      ]
    }

    if (signal.type === 'offer') {
      if (role !== 'client' || this.state.phase !== 'approved') {
        throw new Error('WRONG_PHASE')
      }
      this.state.phase = 'offered'
    } else {
      if (role !== 'provider' || this.state.phase !== 'offered') {
        throw new Error('WRONG_PHASE')
      }
      this.state.phase = 'answered'
    }

    return [
      {
        to: otherRole(role),
        message: signal,
      },
    ]
  }

  /** Forward one relay packet, renewing the idle deadline. */
  private relay(role: PeerRole, signal: RelaySignal): RoomDelivery[] {
    const { phase } = this.state
    if (phase !== 'approved' && phase !== 'offered' && phase !== 'answered') {
      throw new Error('RELAY_NOT_APPROVED')
    }
    const now = this.now()
    if (this.relayExpired(now)) {
      this.state.phase = 'closed'
      throw new Error('RELAY_EXPIRED')
    }
    if (this.state.relayIdleExpiresAt !== undefined && this.state.relayMaxExpiresAt !== undefined) {
      this.state.relayIdleExpiresAt = Math.min(now + this.relayIdleTimeoutMs, this.state.relayMaxExpiresAt)
    }

    if (role === 'client') {
      const denied = this.deniedToolCall(signal.packet, now)
      if (denied) return [denied]
    }
    return [{ to: otherRole(role), message: signal }]
  }

  /**
   * Enforce the decision's allow-list on client tool calls. A call outside it
   * is answered for the provider with a JSON-RPC error and never forwarded; a
   * JSON-RPC batch that contains one is refused as a whole.
   */
  private deniedToolCall(packet: DataChannelPacket, now: number): RoomDelivery | undefined {
    const allowed = this.state.allowedTools
    if (allowed === undefined || packet.channel !== 'mcp-jsonrpc') return undefined

    /** The tool a JSON-RPC message calls outside the allow-list; undefined when allowed or not a tools/call. */
    const disallowedTool = (message: unknown): { name: unknown } | undefined => {
      if (!isPlainRecord(message) || message.method !== 'tools/call') return undefined
      const name = isPlainRecord(message.params) ? message.params.name : undefined
      return typeof name === 'string' && allowed.includes(name) ? undefined : { name }
    }

    const payload = packet.payload
    let id: string | number | null = null
    let message: string
    if (Array.isArray(payload)) {
      if (!payload.some((entry) => disallowedTool(entry) !== undefined)) return undefined
      message = 'TOOL_NOT_ALLOWED: the batch calls a tool outside this session\'s allowed tools'
    } else {
      const denied = disallowedTool(payload)
      if (denied === undefined || !isPlainRecord(payload)) return undefined
      if (typeof payload.id === 'string' || typeof payload.id === 'number') id = payload.id
      message = `TOOL_NOT_ALLOWED: tool "${String(denied.name)}" is not in this session's allowed tools`
    }
    return {
      to: 'client',
      message: {
        type: 'relay',
        packet: {
          channel: 'mcp-jsonrpc',
          payload: { jsonrpc: '2.0', id, error: { code: -32602, message } },
          timestamp: now,
        },
      },
    }
  }

  /**
   * Handle unexpected socket disconnection.
   */
  disconnect(role: PeerRole): RoomDelivery[] {
    if (this.state.released[role] || this.state.phase === 'closed') {
      return []
    }
    return this.end('PEER_LEFT_BEFORE_HANDOFF')
  }

  /**
   * Gracefully terminate room and notify attached peers.
   */
  end(reason: string): RoomDelivery[] {
    this.state.phase = 'closed'
    return (['provider', 'client'] as PeerRole[]).map((to) => ({
      to,
      message: { type: 'closed', reason },
      close: true,
    }))
  }

  /**
   * Generate rendezvous descriptor for this room.
   */
  descriptor(baseOrigin: string): Record<string, unknown> {
    this.assertAlive()
    return {
      id: this.state.id,
      transport: 'webrtc-datachannel',
      profile: 'webmcp-peer/1',
      mcpVersion: '2025-11-25',
      httpMcp: false,
      joinUrl: `${baseOrigin.replace(/\/+$/, '')}/p/${this.state.id}/join`,
      expiresAt: this.state.expiresAt,
    }
  }
}
