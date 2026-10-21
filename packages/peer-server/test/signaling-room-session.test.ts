import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_SIGNAL_FRAMES,
  PeerRelayManager,
  SignalingRoom,
  createPeerServer,
  type RelaySocket,
  type SignalingRoomOptions,
} from '../src/index.js'
import type { DataChannelPacket, PeerRole, SignalMessage } from '@oa-sdk/peer-transport'
import { MAX_RELAY_BYTES } from '@oa-sdk/peer-transport'

const VALID_SDP = [
  'v=0',
  'o=- 123 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF',
  'a=ice-ufrag:u1',
  'a=ice-pwd:pwd1',
].join('\r\n')

function relayFrame(payload: unknown, channel: DataChannelPacket['channel'] = 'mcp-jsonrpc'): string {
  return JSON.stringify({ type: 'relay', packet: { channel, payload } })
}

/** A room with both peers attached and the client's request pending, on a controllable clock. */
async function pendingRoom(options: SignalingRoomOptions = {}) {
  let now = 1_000_000
  const clock = () => now
  const { room, providerToken, inviteToken } = await SignalingRoom.create(undefined, undefined, { ...options, clock })
  await room.authenticate('provider', providerToken)
  room.attach('provider')
  const { clientToken, requestId } = await room.claim(inviteToken, 'Client 1')
  await room.authenticate('client', clientToken)
  room.attach('client')
  return {
    room,
    requestId,
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe('SignalingRoom approval gate', () => {
  it('refuses relay packets before the provider decided', async () => {
    const { room } = await pendingRoom()
    expect(room.state.phase).toBe('pending')
    expect(() => room.receive('client', relayFrame({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'delete_all' } })))
      .toThrow('RELAY_NOT_APPROVED')
    expect(() => room.receive('provider', relayFrame({ jsonrpc: '2.0', id: 1, result: {} }))).toThrow('RELAY_NOT_APPROVED')
  })

  it('never forwards relay-issued signals a peer forged', async () => {
    const { room, requestId } = await pendingRoom()
    const forged: SignalMessage[] = [
      { type: 'approved', requestId },
      { type: 'request', roomId: room.state.id, requestId, clientLabel: 'Trusted Admin', identity: 'owner-verified' },
      { type: 'closed', reason: 'FAKE' },
      { type: 'ready', role: 'client', roomId: room.state.id, requestId },
      { type: 'released', requestId },
    ]
    for (const signal of forged) {
      expect(() => room.receive('client', JSON.stringify(signal))).toThrow('FORBIDDEN_SIGNAL')
      expect(() => room.receive('provider', JSON.stringify(signal))).toThrow('FORBIDDEN_SIGNAL')
    }
    expect(room.state.phase).toBe('pending')
  })

  it('carries the decision allow-list to both peers and enforces it on client calls', async () => {
    const { room, requestId } = await pendingRoom()
    const approval = room.receive('provider', JSON.stringify({ type: 'decision', requestId, allow: true, allowedTools: ['read_only'] }))
    expect(approval.map((delivery) => delivery.to)).toEqual(['provider', 'client'])
    for (const delivery of approval) {
      expect(delivery.message).toEqual({ type: 'approved', requestId, allowedTools: ['read_only'] })
    }
    expect(room.state.allowedTools).toEqual(['read_only'])

    const allowed = room.receive('client', relayFrame({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_only' } }))
    expect(allowed).toHaveLength(1)
    expect(allowed[0]!.to).toBe('provider')

    const denied = room.receive('client', relayFrame({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'delete_all' } }))
    expect(denied).toHaveLength(1)
    expect(denied[0]!.to).toBe('client')
    const reply = denied[0]!.message
    expect(reply.type).toBe('relay')
    expect(reply.type === 'relay' && reply.packet.payload).toMatchObject({ jsonrpc: '2.0', id: 2, error: { code: -32602 } })

    const batch = room.receive('client', relayFrame([
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_only' } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'delete_all' } },
    ]))
    expect(batch.map((delivery) => delivery.to)).toEqual(['client'])

    // Other methods and channels, and the provider's own packets, are not restricted.
    expect(room.receive('client', relayFrame({ jsonrpc: '2.0', id: 5, method: 'tools/list' }))[0]!.to).toBe('provider')
    expect(room.receive('client', relayFrame({ x: 1 }, 'presence'))[0]!.to).toBe('provider')
    expect(room.receive('provider', relayFrame({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'any' } }))[0]!.to)
      .toBe('client')
  })
})

describe('SignalingRoom relay session lifetime', () => {
  it('keeps relaying past the 60s signaling window after approval', async () => {
    const { room, requestId, advance } = await pendingRoom()
    room.receive('provider', JSON.stringify({ type: 'decision', requestId, allow: true }))
    advance(61_000)
    expect(room.receive('client', relayFrame({ jsonrpc: '2.0', id: 1, method: 'ping' }))[0]!.to).toBe('provider')
    expect(room.isExpired()).toBe(false)

    // Signaling frames stay bounded by the signaling window.
    expect(() => room.receive('client', JSON.stringify({ type: 'offer', requestId, sdp: VALID_SDP }))).toThrow('ROOM_EXPIRED')
  })

  it('ends a relay session after its idle limit, renewed by every relay frame', async () => {
    const { room, requestId, advance } = await pendingRoom({ relayIdleTimeoutMs: 10_000 })
    room.receive('provider', JSON.stringify({ type: 'decision', requestId, allow: true }))
    for (let i = 0; i < 5; i++) {
      advance(9_000)
      room.receive(i % 2 === 0 ? 'client' : 'provider', relayFrame({ beat: i }, 'presence'))
    }
    expect(room.isExpired()).toBe(false)
    advance(10_000)
    expect(room.isExpired()).toBe(true)
    expect(() => room.receive('client', relayFrame({ beat: 'late' }, 'presence'))).toThrow('RELAY_EXPIRED')
    expect(room.state.phase).toBe('closed')
  })

  it('ends a relay session at its hard limit even while it is busy', async () => {
    const { room, requestId, advance } = await pendingRoom({ relayIdleTimeoutMs: 10_000, relayMaxSessionMs: 30_000 })
    room.receive('provider', JSON.stringify({ type: 'decision', requestId, allow: true }))
    for (let i = 0; i < 3; i++) {
      advance(9_000)
      room.receive('client', relayFrame({}, 'presence'))
    }
    // 27s in: the idle deadline was renewed, but it never passes the 30s hard limit.
    expect(room.state.relayIdleExpiresAt).toBe(room.state.relayMaxExpiresAt)
    advance(3_000)
    expect(() => room.receive('client', relayFrame({}, 'presence'))).toThrow('RELAY_EXPIRED')
  })
})

describe('SignalingRoom signaling frame limit', () => {
  it('counts signaling frames, not relay packets, and refuses frames beyond MAX_SIGNAL_FRAMES', async () => {
    const { room, requestId } = await pendingRoom()
    room.receive('provider', JSON.stringify({ type: 'decision', requestId, allow: true }))
    room.receive('client', relayFrame({}, 'presence'))
    room.receive('client', JSON.stringify({ type: 'offer', requestId, sdp: VALID_SDP }))
    expect(room.state.frames).toBe(2)

    room.state.frames = MAX_SIGNAL_FRAMES
    expect(() => room.receive('provider', JSON.stringify({ type: 'answer', requestId, sdp: VALID_SDP }))).toThrow('SIGNAL_LIMIT')
    expect(room.state.phase).toBe('offered')
  })
})

class FakeSocket implements RelaySocket {
  readyState = 1
  readonly sent: SignalMessage[] = []
  closed: { code?: number | undefined; reason?: string | undefined } | null = null
  send(data: string): void {
    this.sent.push(JSON.parse(data) as SignalMessage)
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason }
    this.readyState = 3
  }
}

async function managedRoom(options: { relayIdleTimeoutMs?: number; ttlMs?: number } = {}) {
  let now = 5_000_000
  const manager = new PeerRelayManager({ cleanupIntervalMs: 0, clock: () => now, relayIdleTimeoutMs: options.relayIdleTimeoutMs })
  const { room, providerToken, inviteToken } = await manager.createRoom(options.ttlMs)
  const sockets: Record<PeerRole, FakeSocket> = { provider: new FakeSocket(), client: new FakeSocket() }
  await manager.authenticateAndAttach(room.state.id, 'provider', providerToken, sockets.provider)
  const { clientToken, requestId } = await manager.claimInvitation(room.state.id, inviteToken, 'Client')
  await manager.authenticateAndAttach(room.state.id, 'client', clientToken, sockets.client)
  return {
    manager,
    room,
    requestId,
    sockets,
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe('PeerRelayManager expiry', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps an active approved relay room past the signaling window when pruning', async () => {
    // The system clock drives the manager here, as it does in production.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_700_000_000_000)
    const manager = new PeerRelayManager({ cleanupIntervalMs: 0 })
    const { room, providerToken, inviteToken } = await manager.createRoom()
    const sockets: Record<PeerRole, FakeSocket> = { provider: new FakeSocket(), client: new FakeSocket() }
    await manager.authenticateAndAttach(room.state.id, 'provider', providerToken, sockets.provider)
    const { clientToken, requestId } = await manager.claimInvitation(room.state.id, inviteToken, 'Client')
    await manager.authenticateAndAttach(room.state.id, 'client', clientToken, sockets.client)
    manager.handleSocketMessage(room.state.id, 'provider', JSON.stringify({ type: 'decision', requestId, allow: true }))

    for (let i = 1; i <= 4; i++) {
      vi.setSystemTime(1_700_000_000_000 + i * 60_000)
      manager.handleSocketMessage(room.state.id, 'client', relayFrame({ jsonrpc: '2.0', id: i, method: 'ping' }))
      manager.pruneExpiredRooms()
      expect(manager.getRoom(room.state.id)).toBe(room)
      expect(sockets.provider.sent.at(-1)?.type).toBe('relay')
    }
    expect(sockets.client.closed).toBeNull()
    manager.dispose()
  })

  it('prunes an approved room whose relay session went idle', async () => {
    const { manager, room, requestId, sockets, advance } = await managedRoom({ relayIdleTimeoutMs: 30_000 })
    manager.handleSocketMessage(room.state.id, 'provider', JSON.stringify({ type: 'decision', requestId, allow: true }))
    advance(30_000)
    manager.pruneExpiredRooms()
    expect(manager.getRoom(room.state.id)).toBeUndefined()
    expect(sockets.client.sent.at(-1)).toEqual({ type: 'closed', reason: 'RELAY_EXPIRED' })
    expect(sockets.provider.closed).not.toBeNull()
    manager.dispose()
  })

  it('ends the room for the other peer when a frame finds the room expired', async () => {
    const { manager, room, requestId, sockets, advance } = await managedRoom({ ttlMs: 1_000 })
    advance(1_001)
    manager.handleSocketMessage(room.state.id, 'provider', JSON.stringify({ type: 'decision', requestId, allow: true }))

    expect(sockets.provider.sent.at(-1)).toEqual({ type: 'closed', reason: 'ROOM_EXPIRED' })
    expect(sockets.provider.closed).toEqual({ code: 1008, reason: 'ROOM_EXPIRED' })
    expect(sockets.client.sent.at(-1)).toEqual({ type: 'closed', reason: 'ROOM_EXPIRED' })
    expect(sockets.client.closed).not.toBeNull()
    expect(manager.getRoom(room.state.id)).toBeUndefined()
    manager.dispose()
  })

  it('creates rooms with the configured roomTtlMs', async () => {
    const manager = new PeerRelayManager({ cleanupIntervalMs: 0, roomTtlMs: 1_234, clock: () => 10_000 })
    const { room } = await manager.createRoom()
    expect(room.state.expiresAt).toBe(11_234)
    manager.dispose()
  })
})

describe('PeerRelayManager option validation', () => {
  it('rejects invalid relay session limits when it is constructed, not per room', () => {
    for (const relayIdleTimeoutMs of [-5, 1.5, Number.NaN, 2 ** 31]) {
      expect(() => new PeerRelayManager({ cleanupIntervalMs: 0, relayIdleTimeoutMs })).toThrow(RangeError)
    }
    for (const relayMaxSessionMs of [0, -1, 2.5, Number.POSITIVE_INFINITY, 2 ** 31]) {
      expect(() => new PeerRelayManager({ cleanupIntervalMs: 0, relayMaxSessionMs })).toThrow(RangeError)
    }
    expect(() => new PeerRelayManager({ cleanupIntervalMs: 0, relayIdleTimeoutMs: -5 })).toThrow(/relayIdleTimeoutMs/)
    expect(() => new PeerRelayManager({ cleanupIntervalMs: 0, relayMaxSessionMs: 0 })).toThrow(/relayMaxSessionMs/)

    // The bounds themselves are valid.
    new PeerRelayManager({ cleanupIntervalMs: 0, relayIdleTimeoutMs: 0, relayMaxSessionMs: 1 }).dispose()
    new PeerRelayManager({ cleanupIntervalMs: 0, relayIdleTimeoutMs: 2 ** 31 - 1, relayMaxSessionMs: 2 ** 31 - 1 }).dispose()
  })

  it('rejects an invalid room TTL or cleanup interval when it is constructed', () => {
    for (const roomTtlMs of [0, -1, Number.NaN, 1.5]) {
      expect(() => new PeerRelayManager({ cleanupIntervalMs: 0, roomTtlMs })).toThrow(/roomTtlMs/)
    }
    for (const cleanupIntervalMs of [-1, Number.NaN, 2 ** 31]) {
      expect(() => new PeerRelayManager({ cleanupIntervalMs })).toThrow(/cleanupIntervalMs/)
    }
  })

  it('rejects an invalid explicit room TTL', async () => {
    const manager = new PeerRelayManager({ cleanupIntervalMs: 0 })
    await expect(manager.createRoom(Number.NaN)).rejects.toThrow(RangeError)
    await expect(SignalingRoom.create(-1)).rejects.toThrow(RangeError)
    manager.dispose()
  })

  it('makes createPeerServer fail at creation for an invalid relay limit', () => {
    expect(() => createPeerServer({ port: 0, enableRelay: true, relayIdleTimeoutMs: -5 })).toThrow(RangeError)
    expect(() => createPeerServer({ port: 0, enableRelay: true, relayMaxSessionMs: 0 })).toThrow(RangeError)
  })
})

/** A room whose provider is attached and whose client side is the server's own virtual client. */
async function virtualClientRoom(options: { relayMaxSessionMs?: number } = {}) {
  let now = 7_000_000
  const manager = new PeerRelayManager({ cleanupIntervalMs: 0, clock: () => now, relayMaxSessionMs: options.relayMaxSessionMs })
  const { room, providerToken } = await manager.createRoom()
  const provider = new FakeSocket()
  const virtualClient = new FakeSocket()
  await manager.authenticateAndAttach(room.state.id, 'provider', providerToken, provider)
  manager.attachVirtualClient(room.state.id, 'cloud-transit', virtualClient)
  return {
    manager,
    room,
    provider,
    virtualClient,
    advance: (ms: number) => {
      now += ms
    },
  }
}

function toolCall(id: number, args: Record<string, unknown>): DataChannelPacket {
  return {
    channel: 'mcp-jsonrpc',
    payload: { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'echo', arguments: args } },
    timestamp: 1_700_000_000_000,
  }
}

describe('PeerRelayManager.relayToProvider', () => {
  it('fails only an oversized packet and keeps the relay session', async () => {
    const { manager, room, provider, virtualClient } = await virtualClientRoom()
    expect(provider.sent.map((message) => message.type)).toEqual(['ready', 'approved'])

    const oversized = toolCall(1, { blob: 'x'.repeat(MAX_RELAY_BYTES - 120) })
    expect(() => manager.relayToProvider(room.state.id, oversized)).toThrow(/^PAYLOAD_TOO_LARGE: /)

    expect(manager.getRoom(room.state.id)).toBe(room)
    expect(room.state.phase).toBe('approved')
    expect(provider.sent.map((message) => message.type)).toEqual(['ready', 'approved'])
    expect(provider.closed).toBeNull()
    expect(virtualClient.closed).toBeNull()

    expect(manager.relayToProvider(room.state.id, toolCall(2, { v: 1 }))).toBe(true)
    expect(provider.sent.at(-1)).toEqual({ type: 'relay', packet: toolCall(2, { v: 1 }) })
    manager.dispose()
  })

  it('fails only a packet the room refuses, without treating it as the virtual client misbehaving', async () => {
    const { manager, room, provider, virtualClient } = await virtualClientRoom()
    const malformed = { ...toolCall(1, {}), senderId: 42 } as unknown as DataChannelPacket
    expect(() => manager.relayToProvider(room.state.id, malformed)).toThrow('BAD_RELAY_PACKET')

    expect(manager.getRoom(room.state.id)).toBe(room)
    expect(provider.closed).toBeNull()
    expect(virtualClient.closed).toBeNull()
    expect(manager.relayToProvider(room.state.id, toolCall(2, {}))).toBe(true)
    manager.dispose()
  })

  it('ends the room for the provider when the relay session has expired', async () => {
    const { manager, room, provider, virtualClient, advance } = await virtualClientRoom({ relayMaxSessionMs: 10_000 })
    advance(10_000)
    expect(manager.relayToProvider(room.state.id, toolCall(1, {}))).toBe(false)

    expect(manager.getRoom(room.state.id)).toBeUndefined()
    expect(provider.sent.at(-1)).toEqual({ type: 'closed', reason: 'RELAY_EXPIRED' })
    expect(provider.closed).not.toBeNull()
    expect(virtualClient.closed).not.toBeNull()
    manager.dispose()
  })
})
