import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CloudTransitProxy,
  PeerRoomManager,
  createPeerServer,
  handleCloudTransitHttpRequest,
  handleCloudTransitWorker,
  type PeerServerInstance,
} from '../src/index.js'
import {
  MAX_RELAY_BYTES,
  P2pTransportChannel,
  createCloudTransitClient,
  createWebSocketTransportAdapter,
  type SignalMessage,
} from '@oa-sdk/peer-transport'

/** A room manager with one live provider that answers every call with "done". */
function liveRoomManager(calls: string[]): PeerRoomManager {
  const roomManager = new PeerRoomManager()
  roomManager.registerRoom({
    id: 'room-a',
    alias: 'peer-a',
    status: 'connected',
    cachedTools: [{ name: 'echo' }],
    updatedAt: Date.now(),
    providerSocket: {
      send: (msg) => {
        calls.push(msg.message.params.name)
        roomManager.handleProviderMessage('peer-a', {
          type: 'mcp',
          message: { id: msg.message.id, result: { content: [{ type: 'text', text: 'done' }] } },
        })
      },
    },
  })
  return roomManager
}

const CALL_BODY = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo' } })

describe('Cloud Transit handlers enforce their access policy', () => {
  const servers: Server[] = []
  afterEach(async () => {
    vi.unstubAllGlobals()
    for (const server of servers.splice(0)) await new Promise((resolve) => server.close(resolve))
  })

  async function mountStandalone(roomManager: PeerRoomManager): Promise<string> {
    const server = createServer((req, res) => {
      void handleCloudTransitHttpRequest(req, res, {
        roomManager,
        publishKey: 'secret',
        allowedOrigins: ['https://good.example'],
      }).then((handled) => {
        if (!handled) {
          res.writeHead(404)
          res.end()
        }
      })
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }

  it('handleCloudTransitHttpRequest requires the publishKey and an allowed Origin', async () => {
    const calls: string[] = []
    const base = await mountStandalone(liveRoomManager(calls))
    const url = `${base}/transit/peer-a/mcp`
    const post = (headers: Record<string, string>) =>
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: CALL_BODY })

    const noKey = await post({ Origin: 'https://good.example' })
    expect(noKey.status).toBe(401)
    const wrongKey = await post({ Origin: 'https://good.example', 'X-Peer-Publish-Key': 'nope' })
    expect(wrongKey.status).toBe(401)
    const evil = await post({ Origin: 'https://evil.example', Authorization: 'Bearer secret' })
    expect(evil.status).toBe(403)
    expect(evil.headers.get('access-control-allow-origin')).toBeNull()
    const evilPreflight = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })
    expect(evilPreflight.status).toBe(403)
    expect(calls).toEqual([])

    const preflight = await fetch(url, {
      method: 'OPTIONS',
      headers: { Origin: 'https://good.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-target-peer' },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://good.example')
    expect(preflight.headers.get('access-control-allow-headers')).toMatch(/X-Target-Peer/)

    const allowed = await post({ Origin: 'https://good.example', Authorization: 'Bearer secret' })
    expect(allowed.status).toBe(200)
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://good.example')
    expect(allowed.headers.get('vary')).toBe('Origin')
    const cli = await post({ 'X-Peer-Publish-Key': 'secret' })
    expect(cli.status).toBe(200)
    expect(calls).toEqual(['echo', 'echo'])
  })

  it('handleCloudTransitWorker applies the proxy policy and never answers with a wildcard origin', async () => {
    const calls: string[] = []
    const proxy = new CloudTransitProxy({
      roomManager: liveRoomManager(calls),
      publishKey: 'secret',
      allowedOrigins: ['https://good.example'],
    })
    const request = (headers: Record<string, string>, method = 'POST') => new Request('https://transit.example.com/transit/peer-a/mcp', {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(method === 'POST' ? { body: CALL_BODY } : {}),
    })

    expect((await handleCloudTransitWorker(request({ Origin: 'https://good.example' }), proxy)).status).toBe(401)
    const evil = await handleCloudTransitWorker(request({ Origin: 'https://evil.example', Authorization: 'Bearer secret' }), proxy)
    expect(evil.status).toBe(403)
    expect(evil.headers.get('access-control-allow-origin')).toBeNull()
    expect(calls).toEqual([])

    const preflight = await handleCloudTransitWorker(request({ Origin: 'https://good.example' }, 'OPTIONS'), proxy)
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://good.example')

    const allowed = await handleCloudTransitWorker(request({ Origin: 'https://good.example', Authorization: 'Bearer secret' }), proxy)
    expect(allowed.status).toBe(200)
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://good.example')
    expect(allowed.headers.get('vary')).toBe('Origin')
    expect(calls).toEqual(['echo'])
  })

  it('allows only loopback browser origins when no allowedOrigins are configured', async () => {
    const proxy = new CloudTransitProxy({ roomManager: liveRoomManager([]) })
    const call = (origin: string) => handleCloudTransitWorker(new Request('https://transit.example.com/transit/peer-a/mcp', {
      method: 'POST',
      headers: { Origin: origin },
      body: CALL_BODY,
    }), proxy)
    expect((await call('https://evil.example')).status).toBe(403)
    expect((await call('http://localhost:5173')).status).toBe(200)
  })

  it('answers malformed requests with JSON-RPC and HTTP errors instead of throwing', async () => {
    const proxy = new CloudTransitProxy({ roomManager: liveRoomManager([]) })
    const post = (path: string, body: string) => handleCloudTransitWorker(
      new Request(`https://transit.example.com${path}`, { method: 'POST', body }),
      proxy,
    )
    expect((await post('/transit/%E0%A4%A/mcp', CALL_BODY)).status).toBe(400)
    expect((await post('/transit/peer-a/mcp', '{')).status).toBe(400)
    const invalid = await post('/transit/peer-a/mcp', JSON.stringify({ id: 7, method: 'tools/call' }))
    expect(await invalid.json()).toEqual({ jsonrpc: '2.0', id: 7, error: { code: -32600, message: 'Invalid Request' } })
    const badArgs = await post('/transit/peer-a/mcp', JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'echo', arguments: [1] } }))
    expect((await badArgs.json() as { error: { code: number } }).error.code).toBe(-32602)
  })

  it('CloudTransitClient.listTools works against handleCloudTransitWorker', async () => {
    const proxy = new CloudTransitProxy({ roomManager: liveRoomManager([]) })
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => handleCloudTransitWorker(new Request(url, init), proxy))
    const client = createCloudTransitClient({ serverUrl: 'https://transit.example.com', peerAlias: 'peer-a', timeoutMs: 1000 })
    expect(await client.listTools()).toEqual([{ name: 'echo' }])
    expect((await client.callTool({ tool: 'echo' })).status).toBe('success')
  })
})

describe('createPeerServer access rules', () => {
  let activeServer: PeerServerInstance | null = null
  let directory: string | null = null

  afterEach(async () => {
    if (activeServer) {
      await activeServer.close()
      activeServer = null
    }
    if (directory) {
      await rm(directory, { recursive: true, force: true })
      directory = null
    }
  })

  it('lets an invite holder join without the server-wide publishKey', async () => {
    activeServer = createPeerServer({ port: 0, publishKey: 'server-secret-key', enableRelay: true })
    const { port } = await activeServer.start()
    const base = `http://127.0.0.1:${port}`

    expect((await fetch(`${base}/relay/rooms`, { method: 'POST' })).status).toBe(401)
    expect((await fetch(`${base}/call`, { method: 'POST', body: JSON.stringify({ tool: 'echo' }) })).status).toBe(401)

    for (const viaBody of [false, true]) {
      const createdRes = await fetch(`${base}/relay/rooms`, { method: 'POST', headers: { 'X-Peer-Publish-Key': 'server-secret-key' } })
      expect(createdRes.status).toBe(201)
      const created = await createdRes.json() as { id: string; providerToken: string; inviteToken: string }
      const room = activeServer.relayManager!.getRoom(created.id)!
      await room.authenticate('provider', created.providerToken)
      room.attach('provider')

      const joinRes = await fetch(`${base}/p/${created.id}/join`, {
        method: 'POST',
        headers: viaBody ? { 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json', Authorization: `Bearer ${created.inviteToken}` },
        body: JSON.stringify(viaBody ? { clientLabel: 'Invitee', inviteToken: created.inviteToken } : { clientLabel: 'Invitee' }),
      })
      expect(joinRes.status).toBe(201)
      expect(Object.keys(await joinRes.json() as object).sort()).toEqual(['clientToken', 'requestId'])
    }

    const badInvite = await fetch(`${base}/p/${'a'.repeat(32)}/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${'b'.repeat(48)}` },
    })
    expect(badInvite.status).toBe(404)
    expect(await badInvite.json()).toEqual({ error: 'NOT_FOUND' })
  })

  it('allows the X-Target-Peer header CloudTransitClient sends in its CORS preflight', async () => {
    activeServer = createPeerServer({ port: 0, enableCloudTransit: true, enableRelay: true, allowedOrigins: ['http://localhost:5173'] })
    const { port } = await activeServer.start()
    const preflight = await fetch(`http://127.0.0.1:${port}/transit/demo/mcp`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-target-peer,authorization',
      },
    })
    expect(preflight.status).toBe(204)
    const allowed = (preflight.headers.get('access-control-allow-headers') ?? '').toLowerCase().split(/\s*,\s*/)
    expect(allowed).toEqual(expect.arrayContaining(['content-type', 'x-target-peer', 'authorization']))
  })

  it('serves Cloud Transit calls through a provider attached to the WebSocket relay', async () => {
    directory = await mkdtemp(join(tmpdir(), 'oa-peer-transit-bridge-'))
    activeServer = createPeerServer({ port: 0, enableRelay: true, enableCloudTransit: true, storePath: join(directory, 'peers.json') })
    const { port } = await activeServer.start()
    const base = `http://127.0.0.1:${port}`
    const { room, providerToken, inviteToken } = await activeServer.relayManager!.createRoom()

    // The page connector: answers tools/call over the relay.
    const channel = new P2pTransportChannel({ peerId: 'page-1', alias: 'wireframe-local' })
    const executed: string[] = []
    channel.on('mcp-jsonrpc', (packet) => {
      const call = packet.payload as { id: number; method: string; params: { name: string; arguments: unknown } }
      if (call.method !== 'tools/call') return
      executed.push(call.params.name)
      void channel.send('mcp-jsonrpc', {
        jsonrpc: '2.0',
        id: call.id,
        result: { content: [{ type: 'text', text: `echo:${JSON.stringify(call.params.arguments)}` }] },
      })
    })
    const signals: SignalMessage[] = []
    const adapter = createWebSocketTransportAdapter(channel, {
      url: `ws://127.0.0.1:${port}/p/${room.state.id}/provider?alias=wireframe-local`,
      tokenOrTicket: providerToken,
      autoReconnect: false,
      onSignal: (signal) => signals.push(signal),
    })
    await adapter.connect()
    await expect.poll(() => channel.isConnected).toBe(true)
    expect(signals.map((s) => s.type)).toEqual(['ready', 'approved'])

    const announced = await fetch(`${base}/announce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias: 'wireframe-local', cachedTools: [{ name: 'echo' }] }),
    })
    expect(announced.status).toBe(200)

    const client = createCloudTransitClient({ serverUrl: base, peerAlias: 'wireframe-local', timeoutMs: 5000 })
    expect((await client.listTools()).map((tool) => tool.name)).toEqual(['echo'])
    const result = await client.callTool({ tool: 'echo', args: { v: 1 } })
    expect(result.status).toBe('success')
    expect(result.result).toEqual({ content: [{ type: 'text', text: 'echo:{"v":1}' }] })
    expect(executed).toEqual(['echo'])

    const status = await (await fetch(`${base}/status?peer=wireframe-local`)).json() as { connected: boolean }
    expect(status.connected).toBe(true)

    // A bound room's invitation can no longer be claimed.
    const joinRes = await fetch(`${base}/p/${room.state.id}/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${inviteToken}` },
    })
    expect(joinRes.status).toBe(409)

    // Binding the alias from a new room ends the old one.
    const next = await activeServer.relayManager!.createRoom()
    const nextChannel = new P2pTransportChannel({ peerId: 'page-2', alias: 'wireframe-local' })
    nextChannel.on('mcp-jsonrpc', (packet) => {
      const call = packet.payload as { id: number }
      void nextChannel.send('mcp-jsonrpc', { jsonrpc: '2.0', id: call.id, result: { content: [{ type: 'text', text: 'from page 2' }] } })
    })
    const nextAdapter = createWebSocketTransportAdapter(nextChannel, {
      url: `ws://127.0.0.1:${port}/ws?room=${next.room.state.id}&role=provider&alias=wireframe-local`,
      tokenOrTicket: next.providerToken,
      autoReconnect: false,
    })
    await nextAdapter.connect()
    await expect.poll(() => signals.at(-1)).toEqual({ type: 'closed', reason: 'TRANSIT_ALIAS_REBOUND' })
    await expect.poll(() => nextChannel.isConnected).toBe(true)
    const second = await client.callTool({ tool: 'echo' })
    expect(second.result).toEqual({ content: [{ type: 'text', text: 'from page 2' }] })
    expect(executed).toEqual(['echo'])

    // When the provider leaves, the alias waits for a new binding.
    nextAdapter.dispose()
    await expect.poll(() => activeServer!.roomManager.getRoom('wireframe-local')?.status).toBe('refreshing')
    adapter.dispose()
    channel.dispose()
    nextChannel.dispose()
  })

  it('fails only a call too large for the relay and keeps the provider bound', async () => {
    directory = await mkdtemp(join(tmpdir(), 'oa-peer-transit-oversized-'))
    // The default 1 MiB body limit accepts calls whose relay frame exceeds MAX_RELAY_BYTES.
    activeServer = createPeerServer({ port: 0, enableRelay: true, enableCloudTransit: true, storePath: join(directory, 'peers.json') })
    const { port } = await activeServer.start()
    const base = `http://127.0.0.1:${port}`
    const { room, providerToken } = await activeServer.relayManager!.createRoom()

    const channel = new P2pTransportChannel({ peerId: 'page-1', alias: 'wireframe-local' })
    const executed: string[] = []
    channel.on('mcp-jsonrpc', (packet) => {
      const call = packet.payload as { id: number; method: string; params: { name: string } }
      if (call.method !== 'tools/call') return
      executed.push(call.params.name)
      void channel.send('mcp-jsonrpc', { jsonrpc: '2.0', id: call.id, result: { content: [{ type: 'text', text: 'small' }] } })
    })
    const signals: SignalMessage[] = []
    const adapter = createWebSocketTransportAdapter(channel, {
      url: `ws://127.0.0.1:${port}/p/${room.state.id}/provider?alias=wireframe-local`,
      tokenOrTicket: providerToken,
      autoReconnect: false,
      onSignal: (signal) => signals.push(signal),
    })
    await adapter.connect()
    await expect.poll(() => channel.isConnected).toBe(true)

    const blob = 'x'.repeat(MAX_RELAY_BYTES - 120)
    const callBody = JSON.stringify({ tool: 'echo', peer: 'wireframe-local', args: { blob } })
    const transitBody = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: { blob } } })
    expect(Buffer.byteLength(callBody)).toBeLessThanOrEqual(1024 * 1024)
    expect(Buffer.byteLength(transitBody)).toBeLessThanOrEqual(1024 * 1024)

    const oversized = await fetch(`${base}/call`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: callBody })
    expect(oversized.status).toBe(413)
    expect((await oversized.json() as { error: string }).error).toMatch(/^PAYLOAD_TOO_LARGE: /)

    const viaTransit = await fetch(`${base}/transit/wireframe-local/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: transitBody })
    const transitReply = await viaTransit.json() as { result: { isError: boolean; content: { text: string }[] } }
    expect(transitReply.result.isError).toBe(true)
    expect(transitReply.result.content[0]!.text).toMatch(/^PAYLOAD_TOO_LARGE: /)

    // The provider's session is untouched.
    expect(signals.map((signal) => signal.type)).toEqual(['ready', 'approved'])
    expect(adapter.isConnected).toBe(true)
    expect(activeServer.relayManager!.getRoom(room.state.id)?.state.phase).toBe('approved')
    expect(activeServer.roomManager.getRoom('wireframe-local')?.status).toBe('connected')
    expect(executed).toEqual([])

    const small = await fetch(`${base}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'echo', peer: 'wireframe-local', args: { v: 1 } }),
    })
    expect(small.status).toBe(200)
    expect(await small.json()).toEqual({ result: { content: [{ type: 'text', text: 'small' }] } })
    expect(executed).toEqual(['echo'])

    adapter.dispose()
    channel.dispose()
  })

  it('does not mark an announced peer connected without a provider connection', async () => {
    directory = await mkdtemp(join(tmpdir(), 'oa-peer-announce-'))
    activeServer = createPeerServer({ port: 0, storePath: join(directory, 'peers.json') })
    const { port } = await activeServer.start()
    const res = await fetch(`http://127.0.0.1:${port}/announce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias: 'tab-a', cachedTools: [{ name: 'echo' }] }),
    })
    expect(res.status).toBe(200)
    expect(activeServer.roomManager.getRoom('tab-a')?.status).toBe('disconnected')
    const status = await (await fetch(`http://127.0.0.1:${port}/status?peer=tab-a`)).json() as { connected: boolean; toolsCount: number }
    expect(status).toMatchObject({ connected: false, toolsCount: 1 })
  })
})
