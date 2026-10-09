import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebMcpBridgeClient, type WebMcpPeerRecord } from '@oa-sdk/peer-transport'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SkillRegistry } from '../src/index.js'

describe('@oa-sdk/mcp-mesh — peer allow-lists read through the bridge client', () => {
  let directory: string
  let storePath: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'mcp-mesh-allow-list-'))
    storePath = join(directory, 'peers.json')
    // The bridge is offline, so peers come from the local registry.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await rm(directory, { recursive: true, force: true })
  })

  async function resolveRegistryPeer(record: Record<string, unknown>): Promise<WebMcpPeerRecord> {
    await writeFile(storePath, JSON.stringify({ peers: { 'shop-local': { alias: 'shop-local', ...record } } }))
    const peer = await new WebMcpBridgeClient({ storePath }).resolvePeer('shop-local')
    if (peer === null) throw new Error('registry peer did not resolve')
    return peer
  }

  const cachedTools = [{ name: 'search' }, { name: 'delete_all' }]

  it('never registers the tools of a peer whose allowedTools is not an array', async () => {
    for (const allowedTools of ['search', { search: true }, 5, null]) {
      const peer = await resolveRegistryPeer({ allowedTools, cachedTools })
      const registry = new SkillRegistry()
      expect(() => registry.hydratePeerSession(peer)).toThrow('peer catalog contains tool not in allowedTools: search')
      expect(registry.listDomainSkills()).toEqual([])
    }
  })

  it('still registers the catalog of a peer without an allow-list or within its allow-list', async () => {
    for (const record of [{ cachedTools }, { allowedTools: ['search', 'delete_all'], cachedTools }]) {
      const { skill } = new SkillRegistry().hydratePeerSession(await resolveRegistryPeer(record))
      expect(skill.tools.map((tool) => tool.name)).toEqual(['search', 'delete_all'])
    }
  })

  it('hydrates peer session with CloudTransitClient or PeerToolCaller', async () => {
    const peer: WebMcpPeerRecord = {
      alias: 'wireframe-cloud',
      origin: 'https://relay.example.com/transit/wireframe-cloud/mcp',
      cachedTools: [{ name: 'storyboard_create' }],
      status: 'connected',
    }

    let invokedPayload: any = null
    const mockTransitCaller = {
      peerAlias: 'wireframe-cloud',
      callTool: async (payload: any) => {
        invokedPayload = payload
        return { result: { success: true }, isError: false, status: 'success' as const }
      },
    }

    const registry = new SkillRegistry()
    const { skill, session } = registry.hydratePeerSession(peer, mockTransitCaller)
    expect(skill.domain).toBe('wireframe')
    expect(session.transportType).toBe('cloud-transit')

    const res = await session.callTool('storyboard_create', { title: 'New Storyboard' })
    expect(res).toEqual({ success: true })
    expect(invokedPayload.tool).toBe('storyboard_create')
    expect(invokedPayload.args).toEqual({ title: 'New Storyboard' })
  })
})
