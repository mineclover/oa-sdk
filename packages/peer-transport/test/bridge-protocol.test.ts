import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebMcpBridgeClient } from '../src/index.js'
import {
  BridgeCallResponseSchema,
  BridgeStatusSchema,
  BridgeToolListSchema,
  PeerDirectorySchema,
  parsePeerRecord,
} from '../src/bridge-protocol.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('bridge protocol schemas', () => {
  it('keeps typed peer fields, drops wrong-typed and unknown fields, and never returns the token', () => {
    const peer = parsePeerRecord({
      alias: 'wireframe-local',
      id: 'tab-1',
      title: 42,
      token: 'secret',
      status: 'connected',
      allowedTools: ['echo', 7, ''],
      cachedTools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' }, extra: true }, { name: 3 }],
      skillManifest: { id: 's', name: 'S', version: '1', description: 'd', instructions: 5 },
      updatedAt: Number.NaN,
      injected: { admin: true },
    })

    expect(peer).toEqual({
      alias: 'wireframe-local',
      id: 'tab-1',
      status: 'connected',
      allowedTools: ['echo'],
      cachedTools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }],
      skillManifest: { id: 's', name: 'S', version: '1', description: 'd' },
    })
  })

  it('rejects peer records without a safe alias', () => {
    expect(parsePeerRecord({ alias: '../escape' })).toBeUndefined()
    expect(parsePeerRecord(['wireframe-local'])).toBeUndefined()
  })

  it('reads alias-keyed and array peer directories and reports a missing directory', () => {
    expect(PeerDirectorySchema.parse({ peers: { good: { alias: 'good' }, 'bad alias': { alias: 'bad' }, empty: null } }))
      .toEqual({ good: { alias: 'good' } })
    expect(PeerDirectorySchema.parse({ peers: [{ alias: 'a' }, { alias: 1 }] })).toEqual({ a: { alias: 'a' } })
    expect(PeerDirectorySchema.parse({ ok: true })).toBeUndefined()
    expect(() => PeerDirectorySchema.parse('peers')).toThrow(TypeError)
  })

  it('normalizes bridge status peers to the declared array form', () => {
    expect(BridgeStatusSchema.parse({
      ok: true,
      connected: 'yes',
      targetAlias: 'a',
      toolsCount: -1,
      tools: ['echo', 1],
      peers: { a: { alias: 'a', token: 'secret' } },
    })).toEqual({ ok: true, targetAlias: 'a', tools: ['echo'], peers: [{ alias: 'a' }] })
    expect(BridgeStatusSchema.parse({ ok: 'true' }).ok).toBe(false)
    expect(() => BridgeStatusSchema.parse([])).toThrow(TypeError)
  })

  it('validates tool catalogs and keeps call results opaque', () => {
    expect(BridgeToolListSchema.parse({ tools: [{ name: 'echo' }, { name: '' }, 'echo'] })).toEqual([
      { name: 'echo', description: 'WebMCP tool echo', inputSchema: { type: 'object', properties: {} } },
    ])
    expect(() => BridgeToolListSchema.parse({ tools: 'echo' })).toThrow(TypeError)
    expect(BridgeCallResponseSchema.parse({ result: [1, 2], error: 5 })).toEqual({ result: [1, 2] })
    expect(BridgeCallResponseSchema.parse({ error: 'PEER_UNAVAILABLE', message: 'm' })).toEqual({
      error: 'PEER_UNAVAILABLE',
      message: 'm',
      result: { error: 'PEER_UNAVAILABLE', message: 'm' },
    })
    expect(BridgeCallResponseSchema.parse('bare')).toEqual({ result: 'bare' })
  })
})

describe('WebMcpBridgeClient boundary validation', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'peer-transport-'))
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await rm(directory, { recursive: true, force: true })
  })

  it('sanitizes peers returned by the bridge status endpoint', async () => {
    // A Response body can be read once, so every request gets a fresh one.
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonResponse({
      ok: true,
      peers: { 'wireframe-local': { alias: 'wireframe-local', token: 'secret', cachedTools: 'not-a-list' } },
    })))
    const client = new WebMcpBridgeClient({ storePath: join(directory, 'missing.json') })

    await expect(client.listPeers()).resolves.toEqual({ 'wireframe-local': { alias: 'wireframe-local' } })
    await expect(client.getStatus()).resolves.toEqual({ ok: true, peers: [{ alias: 'wireframe-local' }] })
  })

  it('falls back to the local registry when the bridge status is not an object', async () => {
    const storePath = join(directory, 'peers.json')
    await writeFile(storePath, JSON.stringify({ version: 1, peers: { 'wireframe-local': { alias: 'wireframe-local', status: 'connected', token: 't' } } }))
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonResponse(['not', 'a', 'status'])))
    const client = new WebMcpBridgeClient({ storePath })

    await expect(client.getStatus()).resolves.toMatchObject({
      ok: true,
      connected: true,
      peers: [{ alias: 'wireframe-local', status: 'connected' }],
    })
    const peer = await client.resolvePeer('wireframe-local')
    expect(peer).not.toHaveProperty('token')
  })

  it('treats a corrupt local registry as empty', async () => {
    const storePath = join(directory, 'peers.json')
    await writeFile(storePath, '{"peers":')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const client = new WebMcpBridgeClient({ storePath })

    await expect(client.listPeers()).resolves.toEqual({})
  })

  it('falls back to cached tools when the bridge tool catalog is malformed', async () => {
    const storePath = join(directory, 'peers.json')
    await writeFile(storePath, JSON.stringify({ peers: { 'wireframe-local': { alias: 'wireframe-local', cachedTools: [{ name: 'cached' }] } } }))
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => (
      url.includes('/tools') ? jsonResponse({ tools: { name: 'not-an-array' } }) : jsonResponse({}, 503)
    )))
    const client = new WebMcpBridgeClient({ storePath })

    await expect(client.listTools()).resolves.toEqual([
      { name: 'cached', description: 'WebMCP tool cached', inputSchema: { type: 'object', properties: {} } },
    ])
  })

  it('only forwards string continuation fields from an input_required result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      result: { status: 'input_required', continuationToken: 7, prompt: 'Pick one' },
    })))
    const client = new WebMcpBridgeClient({ storePath: join(directory, 'missing.json') })

    await expect(client.callTool({ tool: 'echo' })).resolves.toEqual({
      result: { status: 'input_required', continuationToken: 7, prompt: 'Pick one' },
      status: 'input_required',
      continuationToken: undefined,
      prompt: 'Pick one',
      isError: false,
    })
  })
})
