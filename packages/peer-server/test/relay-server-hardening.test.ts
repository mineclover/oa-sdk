import { connect as netConnect, createServer as createTcpServer, type AddressInfo, type Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import { createPeerServer, type PeerServerInstance } from '../src/index.js'
import {
  P2pTransportChannel,
  WEBMCP_SUBPROTOCOL,
  createWebSocketTransportAdapter,
  type SignalMessage,
} from '@oa-sdk/peer-transport'

/** Send a raw HTTP upgrade and return the status line, or 'PENDING' when nothing answers in time. */
function rawUpgrade(port: number, path: string, host: string, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve) => {
    const socket = netConnect(port, '127.0.0.1')
    let data = ''
    const done = (result: string) => {
      clearTimeout(timer)
      socket.destroy()
      resolve(result)
    }
    const timer = setTimeout(() => done('PENDING'), timeoutMs)
    socket.on('data', (chunk) => {
      data += chunk.toString('latin1')
      if (data.includes('\r\n')) done(data.slice(0, data.indexOf('\r\n')))
    })
    socket.on('error', () => done(data || 'ERROR'))
    socket.on('close', () => done(data ? data.slice(0, data.indexOf('\r\n')) : 'CLOSED'))
    socket.write([
      `GET ${path} HTTP/1.1`,
      `Host: ${host}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      '',
      '',
    ].join('\r\n'))
  })
}

interface Peer {
  ws: WebSocket
  messages: SignalMessage[]
  closed: Promise<{ code: number; reason: string }>
}

function openPeer(url: string, ticket: string): Peer {
  const ws = new WebSocket(url, [WEBMCP_SUBPROTOCOL, `ticket.${ticket}`])
  const messages: SignalMessage[] = []
  ws.on('message', (data) => messages.push(JSON.parse(data.toString('utf8')) as SignalMessage))
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString('utf8') }))
  })
  ws.on('error', () => {})
  return { ws, messages, closed }
}

function opened(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })
}

async function join(port: number, roomId: string, inviteToken: string): Promise<{ clientToken: string; requestId: string }> {
  const res = await fetch(`http://127.0.0.1:${port}/p/${roomId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${inviteToken}` },
    body: JSON.stringify({ clientLabel: 'Hardening Client' }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { clientToken: string; requestId: string }
}

describe('WebSocket relay upgrade handling', () => {
  let activeServer: PeerServerInstance | null = null

  afterEach(async () => {
    vi.restoreAllMocks()
    if (activeServer) {
      await activeServer.close()
      activeServer = null
    }
  })

  it('answers an upgrade with a malformed Host header instead of crashing the process', async () => {
    activeServer = createPeerServer({ port: 0, enableRelay: true })
    const { port } = await activeServer.start()

    for (const host of ['a b', 'a%', '[']) {
      const status = await rawUpgrade(port, '/ws?room=x&role=client', host)
      expect(status).toMatch(/^HTTP\/1\.1 (400|401)/)
      expect(await rawUpgrade(port, '/', host)).toMatch(/^HTTP\/1\.1 404/)
    }
    // The server is still up.
    const res = await fetch(`http://127.0.0.1:${port}/home/mcp`)
    expect(res.status).toBe(200)
  })

  it('answers relay paths without a valid room and role with 400 and unknown paths with 404', async () => {
    activeServer = createPeerServer({ port: 0, enableRelay: true })
    const { port } = await activeServer.start()
    const { room } = await activeServer.relayManager!.createRoom()
    const roomId = room.state.id

    expect(await rawUpgrade(port, '/ws', 'localhost')).toMatch(/^HTTP\/1\.1 400/)
    expect(await rawUpgrade(port, `/ws?room=${roomId}`, 'localhost')).toMatch(/^HTTP\/1\.1 400/)
    expect(await rawUpgrade(port, `/ws?room=${roomId}&role=admin`, 'localhost')).toMatch(/^HTTP\/1\.1 400/)
    expect(await rawUpgrade(port, `/p/${roomId}/mcp`, 'localhost')).toMatch(/^HTTP\/1\.1 400/)
    expect(await rawUpgrade(port, '/unknown', 'localhost')).toMatch(/^HTTP\/1\.1 404/)
    // Without Cloud Transit there is nothing to bind an alias to.
    expect(await rawUpgrade(port, `/p/${roomId}/provider?alias=wireframe-local`, 'localhost')).toMatch(/^HTTP\/1\.1 400/)

    // A hung socket would keep close() pending.
    const closing = activeServer.close()
    activeServer = null
    await expect(Promise.race([closing.then(() => 'closed'), new Promise((r) => setTimeout(() => r('pending'), 3000))])).resolves.toBe('closed')
  })

  it('leaves unknown upgrade paths to another upgrade listener', async () => {
    activeServer = createPeerServer({ port: 0, enableRelay: true })
    activeServer.server.on('upgrade', (req, socket) => {
      if (req.url === '/other') socket.end('HTTP/1.1 418 I\'m a teapot\r\nConnection: close\r\n\r\n')
    })
    const { port } = await activeServer.start()
    expect(await rawUpgrade(port, '/other', 'localhost')).toMatch(/^HTTP\/1\.1 418/)
  })

  it('advertises a signaling URL the relay answers, on the bound port', async () => {
    activeServer = createPeerServer({ port: 0, enableRelay: true })
    const { port } = await activeServer.start()
    const { room } = await activeServer.relayManager!.createRoom()

    const descriptor = await (await fetch(`http://127.0.0.1:${port}/p/${room.state.id}/mcp`)).json() as Record<string, unknown>
    expect(descriptor.signaling).toBe(`ws://127.0.0.1:${port}/p/${room.state.id}/client`)

    const other = await (await fetch(`http://127.0.0.1:${port}/p/peer_abc123/mcp`)).json() as Record<string, unknown>
    expect(other.signaling).toBeUndefined()

    const created = await (await fetch(`http://127.0.0.1:${port}/relay/rooms`, { method: 'POST' })).json() as Record<string, unknown>
    expect(created.descriptorUrl).toBe(`http://127.0.0.1:${port}/p/${created.id as string}/mcp`)
  })
})

describe('WebSocket relay session handling', () => {
  let activeServer: PeerServerInstance | null = null

  afterEach(async () => {
    vi.restoreAllMocks()
    if (activeServer) {
      await activeServer.close()
      activeServer = null
    }
  })

  /** Make every ticket check take `ms`, so frames and closes during authentication are deterministic. */
  function slowTicketChecks(ms: number): void {
    const subtle = globalThis.crypto.subtle
    const digest = subtle.digest.bind(subtle)
    vi.spyOn(subtle, 'digest').mockImplementation(async (algorithm, data) => {
      await new Promise((resolve) => setTimeout(resolve, ms))
      return digest(algorithm, data)
    })
  }

  it('keeps frames a socket sends while its ticket is still being checked', async () => {
    activeServer = createPeerServer({ port: 0, enableRelay: true })
    const { port } = await activeServer.start()
    const { room, providerToken, inviteToken } = await activeServer.relayManager!.createRoom()
    const provider = openPeer(`ws://127.0.0.1:${port}/p/${room.state.id}/provider`, providerToken)
    await expect.poll(() => provider.messages.map((m) => m.type)).toEqual(['ready'])
    const { clientToken } = await join(port, room.state.id, inviteToken)

    slowTicketChecks(150)
    const client = openPeer(`ws://127.0.0.1:${port}/p/${room.state.id}/client`, clientToken)
    await opened(client.ws)
    client.ws.send(JSON.stringify({ type: 'cancel' }))

    await expect.poll(() => provider.messages.at(-1)).toEqual({ type: 'closed', reason: 'CANCELLED' })
    expect((await client.closed).code).toBe(1000)
    expect(client.messages.map((m) => m.type)).toEqual(['ready', 'closed'])
  })

  it('ends the room when a socket closes while its ticket is being checked', async () => {
    activeServer = createPeerServer({ port: 0, enableRelay: true })
    const { port } = await activeServer.start()
    const relayManager = activeServer.relayManager!
    const { room, providerToken, inviteToken } = await relayManager.createRoom()
    const provider = openPeer(`ws://127.0.0.1:${port}/p/${room.state.id}/provider`, providerToken)
    await expect.poll(() => provider.messages.length).toBe(1)
    const { clientToken } = await join(port, room.state.id, inviteToken)

    slowTicketChecks(150)
    const client = openPeer(`ws://127.0.0.1:${port}/p/${room.state.id}/client`, clientToken)
    await opened(client.ws)
    client.ws.terminate()

    await expect.poll(() => provider.messages.at(-1)).toEqual({ type: 'closed', reason: 'PEER_LEFT_BEFORE_HANDOFF' })
    expect(relayManager.getRoom(room.state.id)).toBeUndefined()
  })

  it('refuses relay packets before approval and tells the provider the client left', async () => {
    activeServer = createPeerServer({ port: 0, enableRelay: true })
    const { port } = await activeServer.start()
    const { room, providerToken, inviteToken } = await activeServer.relayManager!.createRoom()
    const provider = openPeer(`ws://127.0.0.1:${port}/p/${room.state.id}/provider`, providerToken)
    await expect.poll(() => provider.messages.length).toBe(1)
    const { clientToken } = await join(port, room.state.id, inviteToken)
    const client = openPeer(`ws://127.0.0.1:${port}/p/${room.state.id}/client`, clientToken)
    await expect.poll(() => client.messages.map((m) => m.type)).toEqual(['ready'])

    client.ws.send(JSON.stringify({
      type: 'relay',
      packet: { channel: 'mcp-jsonrpc', payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'delete_all' } } },
    }))
    expect(await client.closed).toEqual({ code: 1008, reason: 'RELAY_NOT_APPROVED' })
    await expect.poll(() => provider.messages.at(-1)).toEqual({ type: 'closed', reason: 'PEER_LEFT_BEFORE_HANDOFF' })
    expect(provider.messages.map((m) => m.type)).toEqual(['ready', 'request', 'closed'])
  })

  it('notifies and closes the other peer when a frame finds the room expired', async () => {
    activeServer = createPeerServer({ port: 0, enableRelay: true })
    const { port } = await activeServer.start()
    const { room, providerToken, inviteToken } = await activeServer.relayManager!.createRoom(600)
    const provider = openPeer(`ws://127.0.0.1:${port}/p/${room.state.id}/provider`, providerToken)
    await expect.poll(() => provider.messages.length).toBe(1)
    const { clientToken, requestId } = await join(port, room.state.id, inviteToken)
    const client = openPeer(`ws://127.0.0.1:${port}/p/${room.state.id}/client`, clientToken)
    await expect.poll(() => provider.messages.length).toBe(2)

    await new Promise((resolve) => setTimeout(resolve, 700))
    provider.ws.send(JSON.stringify({ type: 'decision', requestId, allow: true }))

    expect((await provider.closed).reason).toBe('ROOM_EXPIRED')
    await client.closed
    expect(client.messages.at(-1)).toEqual({ type: 'closed', reason: 'ROOM_EXPIRED' })

    const closing = activeServer.close()
    activeServer = null
    await expect(Promise.race([closing.then(() => 'closed'), new Promise((r) => setTimeout(() => r('pending'), 3000))])).resolves.toBe('closed')
  })

  it('does not reconnect an adapter after the relay ended its session', async () => {
    activeServer = createPeerServer({ port: 0, enableRelay: true })
    const { port } = await activeServer.start()
    const { room, providerToken } = await activeServer.relayManager!.createRoom()
    const logs: string[] = []
    const channel = new P2pTransportChannel({ peerId: 'provider-1', alias: 'provider' })
    const adapter = createWebSocketTransportAdapter(channel, {
      url: `ws://127.0.0.1:${port}/ws?room=${room.state.id}&role=provider`,
      tokenOrTicket: providerToken,
      reconnectDelayMs: 10,
      maxReconnectAttempts: 3,
      logger: (msg) => logs.push(msg),
    })
    await adapter.connect()
    await adapter.sendSignal({ type: 'cancel' })
    await expect.poll(() => adapter.isConnected).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(logs.filter((line) => line.startsWith('Connected'))).toHaveLength(1)
    expect(logs.filter((line) => line.startsWith('Scheduling reconnect'))).toHaveLength(0)
    adapter.dispose()
    channel.dispose()
  })
})

describe('WebSocketTransportAdapter on the ws package', () => {
  it('survives disconnect() and dispose() while a ws socket is still CONNECTING', async () => {
    // A relay that accepts the TCP connection but never answers the upgrade.
    const held: Socket[] = []
    const silent = createTcpServer((socket) => {
      held.push(socket)
      socket.on('error', () => {})
    })
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve))
    const { port } = silent.address() as AddressInfo
    const uncaught: unknown[] = []
    const onUncaught = (err: unknown) => uncaught.push(err)
    process.on('uncaughtException', onUncaught)
    try {
      const channel = new P2pTransportChannel({ peerId: 'client-1', alias: 'client' })
      const adapter = createWebSocketTransportAdapter(channel, {
        url: `ws://127.0.0.1:${port}/p/${'a'.repeat(32)}/client`,
        tokenOrTicket: 'b'.repeat(48),
        webSocketClass: WebSocket as unknown as typeof globalThis.WebSocket,
        reconnectDelayMs: 1,
      })

      const pending = adapter.connect()
      await expect.poll(() => held.length).toBe(1)
      adapter.disconnect()
      await expect(pending).rejects.toThrow('disconnected')

      const again = adapter.connect()
      await expect.poll(() => held.length).toBe(2)
      adapter.dispose()
      await expect(again).rejects.toThrow('disconnected')

      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(uncaught).toEqual([])
      channel.dispose()
    } finally {
      process.off('uncaughtException', onUncaught)
      for (const socket of held) socket.destroy()
      await new Promise((resolve) => silent.close(resolve))
    }
  })
})
