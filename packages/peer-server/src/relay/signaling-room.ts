/**
 * @oa-sdk/peer-server/relay — Signaling & Relay Room
 *
 * Implements the WebMCP signaling room FSM and duplex packet relay
 * between provider and client. Compatible with Node.js and Edge/Workers.
 */
import type { DataChannelPacket } from '@oa-sdk/peer-transport'
import {
  parseSignalMessage,
  validateSdp,
  type PeerRole,
  type SignalingPhase,
  type SignalMessage,
  DEFAULT_ROOM_TTL_MS,
  MAX_RELAY_BYTES,
} from '@oa-sdk/peer-transport'

export interface SignalingRoomState {
  id: string
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
}

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

  constructor(state: SignalingRoomState, now = () => Date.now()) {
    this.state = state
    this.now = now
  }

  static async create(
    ttlMs = DEFAULT_ROOM_TTL_MS,
    now = Date.now(),
  ): Promise<{
    room: SignalingRoom
    providerToken: string
    inviteToken: string
  }> {
    const providerToken = randomHex(24) // 48 hex chars
    const inviteToken = randomHex(24)   // 48 hex chars
    const roomId = randomHex(16)        // 32 hex chars

    const [providerHash, inviteHash] = await Promise.all([
      sha256Hex(providerToken),
      sha256Hex(inviteToken),
    ])

    const state: SignalingRoomState = {
      id: roomId,
      expiresAt: now + ttlMs,
      phase: 'provider-wait',
      providerHash,
      inviteHash,
      attached: {},
      released: {},
      frames: 0,
    }

    return {
      room: new SignalingRoom(state),
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
   * Handle an inbound message from one of the peers and produce deliveries.
   */
  receive(role: PeerRole, rawText: string): RoomDelivery[] {
    this.assertAlive()
    if (!this.state.attached[role] || this.state.released[role]) {
      throw new Error('NOT_ATTACHED')
    }

    const signal = parseSignalMessage(rawText)

    // Handle relay data packets (duplex relay)
    if (signal.type === 'relay') {
      const other: PeerRole = role === 'provider' ? 'client' : 'provider'
      return [
        {
          to: other,
          message: signal,
        },
      ]
    }

    // Signaling limit checks
    if (++this.state.frames > 32) {
      throw new Error('SIGNAL_LIMIT')
    }

    if (signal.type === 'cancel') {
      return this.end('CANCELLED')
    }

    if ('requestId' in signal && signal.requestId !== this.state.requestId) {
      throw new Error('WRONG_REQUEST')
    }

    const other: PeerRole = role === 'provider' ? 'client' : 'provider'

    if (signal.type === 'decision') {
      if (role !== 'provider' || this.state.phase !== 'pending' || !this.state.attached.client) {
        throw new Error('WRONG_PHASE')
      }
      if (!signal.allow) {
        return this.end('DENIED')
      }
      this.state.phase = 'approved'
      this.state.expiresAt = Math.min(this.state.expiresAt, this.now() + 60_000)
      return (['provider', 'client'] as PeerRole[]).map((to) => ({
        to,
        message: { type: 'approved', requestId: signal.requestId },
      }))
    }

    if (signal.type === 'offer') {
      if (role !== 'client' || this.state.phase !== 'approved') {
        throw new Error('WRONG_PHASE')
      }
      this.state.phase = 'offered'
    }

    if (signal.type === 'answer') {
      if (role !== 'provider' || this.state.phase !== 'offered') {
        throw new Error('WRONG_PHASE')
      }
      this.state.phase = 'answered'
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

    return [
      {
        to: other,
        message: signal,
      },
    ]
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
