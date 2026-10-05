import { mkdtemp, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPeerServer, type PeerServerInstance } from '../src/index.js'
import { PeerAnnouncementSchema } from '../src/request-schemas.js'

describe('@oa-sdk/peer-server — request body schemas', () => {
  let directory: string
  let peerServer: PeerServerInstance
  let baseUrl: string

  async function post(path: string, body: string): Promise<{ status: number; data: Record<string, unknown> }> {
    const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    return { status: res.status, data: await res.json() as Record<string, unknown> }
  }

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'oa-peer-server-'))
    // Port 0 lets the OS pick a free port so parallel test runs cannot collide.
    peerServer = createPeerServer({ port: 0, hostname: '127.0.0.1', storePath: join(directory, 'peers.json') })
    await peerServer.start()
    baseUrl = `http://127.0.0.1:${(peerServer.server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await peerServer.close()
    await rm(directory, { recursive: true, force: true })
  })

  it('rejects an announcement whose known fields have the wrong type with 400', async () => {
    const { status, data } = await post('/announce', JSON.stringify({ alias: 'peer-a', title: 42 }))
    expect(status).toBe(400)
    expect(data).toEqual({ error: 'Invalid peer record' })
    expect(await peerServer.store.getPeer('peer-a')).toBeNull()
  })

  it('ignores a client updatedAt of any type because the server stamps its own', async () => {
    for (const [alias, updatedAt] of [['peer-iso', '2026-10-05T00:00:00Z'], ['peer-null', null], ['peer-number', 1]] as const) {
      const before = Date.now()
      const { status, data } = await post('/announce', JSON.stringify({ alias, updatedAt }))
      expect(status).toBe(200)
      const stored = await peerServer.store.getPeer(alias)
      expect(stored?.updatedAt).toBeGreaterThanOrEqual(before)
      expect(data.peer).toEqual({ alias, cachedTools: [], updatedAt: stored?.updatedAt })
    }
  })

  it('stores an announcement but never serves its token or invitation URL', async () => {
    const announced = await post('/announce', JSON.stringify({
      alias: 'peer-b',
      title: 'Peer B',
      token: 'secret',
      invitationUrl: 'https://invite.example/peer-b',
      cachedTools: [{ name: 'echo', description: 'Echo' }],
      unknownField: true,
    }))
    expect(announced.status).toBe(200)
    expect(announced.data.peer).toEqual({
      alias: 'peer-b',
      title: 'Peer B',
      cachedTools: [{ name: 'echo', description: 'Echo' }],
      updatedAt: expect.any(Number),
    })
    expect(peerServer.roomManager.getRoom('peer-b')).toMatchObject({ id: 'peer-b', title: 'Peer B', cachedTools: [{ name: 'echo', description: 'Echo' }] })
    expect((await peerServer.store.getPeer('peer-b'))?.token).toBe('secret')

    const status = await fetch(`${baseUrl}/status?peer=peer-b`).then(async (res) => res.json() as Promise<{ peers: Record<string, unknown> }>)
    expect(status.peers['peer-b']).not.toHaveProperty('token')
    expect(status.peers['peer-b']).not.toHaveProperty('invitationUrl')
  })

  it('serves the announced tool members of a live peer from GET /tools', async () => {
    const search = {
      name: 'search',
      title: 'Search items',
      description: 'Search',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object', properties: { hits: { type: 'array' } } },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { 'vendor/rank': 1 },
    }
    const announced = await post('/announce', JSON.stringify({
      alias: 'peer-tools',
      cachedTools: [
        search,
        // Known optional members of the wrong type are left out; the tool stays.
        { name: 'echo', title: 7, annotations: 'read-only', outputSchema: [], icons: [{ src: 'https://icons.example/echo.png' }] },
      ],
    }))
    expect(announced.status).toBe(200)

    const tools = await fetch(`${baseUrl}/tools?peer=peer-tools`).then(async (res) => res.json())
    expect(tools).toEqual({
      tools: [search, { name: 'echo', icons: [{ src: 'https://icons.example/echo.png' }] }],
    })

    // The peer store keeps its normalized record.
    expect((await peerServer.store.getPeer('peer-tools'))?.cachedTools).toEqual([
      { name: 'search', description: 'Search', inputSchema: { type: 'object' } },
      { name: 'echo' },
    ])
  })

  it('never copies an announced __proto__ tool member onto the room catalog', async () => {
    const announced = await post('/announce', '{"alias":"peer-proto","cachedTools":[{"name":"echo","__proto__":{"polluted":true}}]}')
    expect(announced.status).toBe(200)
    const [tool] = peerServer.roomManager.getRoom('peer-proto')?.cachedTools ?? []
    expect(tool).toEqual({ name: 'echo' })
    expect(Object.getPrototypeOf(tool)).toBe(Object.prototype)
    expect(Object.hasOwn(tool ?? {}, '__proto__')).toBe(false)
  })

  it('reports each /call payload violation with the route error message', async () => {
    await expect(post('/call', '[]')).resolves.toEqual({ status: 400, data: { error: 'Request payload must be an object' } })
    await expect(post('/call', JSON.stringify({ tool: 'echo', args: [] }))).resolves.toEqual({ status: 400, data: { error: 'Invalid tool call payload' } })
    await expect(post('/call', JSON.stringify({ tool: 'echo', sessionId: 5 }))).resolves.toEqual({ status: 400, data: { error: 'Invalid sessionId' } })
    await expect(post('/call', JSON.stringify({ tool: 'echo', peer: 7 }))).resolves.toEqual({ status: 400, data: { error: 'Invalid peer alias' } })
    await expect(post('/call', '{"tool":')).resolves.toEqual({ status: 400, data: { error: 'Invalid JSON payload' } })
  })

  it('answers home MCP envelopes with JSON-RPC ids of the protocol types only', async () => {
    const list = await post('/home/mcp', JSON.stringify({ jsonrpc: '2.0', id: { nested: true }, method: 'tools/list' }))
    expect(list.status).toBe(200)
    expect(list.data.id).toBeNull()

    const invalid = await post('/home/mcp', JSON.stringify([1]))
    expect(invalid).toEqual({ status: 400, data: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } } })

    const badParams = await post('/home/mcp', JSON.stringify({ jsonrpc: '2.0', id: 'call-1', method: 'tools/call', params: { name: 'home_service_status', arguments: [] } }))
    expect(badParams.data).toEqual({ jsonrpc: '2.0', id: 'call-1', error: { code: -32600, message: 'Invalid tools/call params' } })
  })
})

describe('@oa-sdk/peer-server — announced room tool catalog', () => {
  it('keeps only JSON data among the members it does not know', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const { roomTools } = PeerAnnouncementSchema.parse({
      alias: 'peer-json',
      cachedTools: [{
        name: 'echo',
        _meta: { rank: 1, tags: ['a', null, true] },
        notFinite: { score: Number.NaN },
        callback: () => 'not JSON',
        cyclic,
        date: new Date(0),
      }],
    })
    expect(roomTools).toEqual([{ name: 'echo', _meta: { rank: 1, tags: ['a', null, true] } }])
  })

  it('checks deeply nested members without overflowing the stack', () => {
    let nested: unknown = 'leaf'
    for (let depth = 0; depth < 100_000; depth += 1) nested = [nested]
    const { roomTools } = PeerAnnouncementSchema.parse({ alias: 'peer-deep', cachedTools: [{ name: 'echo', nested }] })
    expect(roomTools[0]?.nested).toBe(nested)
  })
})
