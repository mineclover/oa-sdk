/**
 * @oa-sdk/mcp-mesh — `peer list` against a live @oa-sdk/peer-server
 */
import { mkdtemp, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPeerServer, type PeerServerInstance } from '@oa-sdk/peer-server'
import { createMeshCli } from '../src/cli/index.js'

describe('oa-mesh peer list with a live peer server', () => {
  let directory: string
  let storePath: string
  let peerServer: PeerServerInstance
  let bridgeUrl: string

  async function announce(body: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${bridgeUrl}/announce`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(200)
  }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'oa-mesh-peer-list-'))
    // The server and the CLI share one registry, as they do with the default ~/.webmcp/peers.json.
    storePath = join(directory, 'peers.json')
    peerServer = createPeerServer({ port: 0, hostname: '127.0.0.1', storePath })
    await peerServer.start()
    bridgeUrl = `http://127.0.0.1:${(peerServer.server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await peerServer.close()
    await rm(directory, { recursive: true, force: true })
  })

  it('reports each peer from its own registry record', async () => {
    await announce({ alias: 'tab-a', origin: 'http://localhost:5173', cachedTools: [{ name: 'echo' }] })
    await announce({ alias: 'tab-b' })
    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(' '))
    })

    await createMeshCli().parseAsync(['node', 'oa-mesh', '-o', 'json', '--bridge', bridgeUrl, '--store', storePath, 'peer', 'list'])

    // The bridge reports peers as an alias-keyed directory, so the command
    // reads the registry: status and origin come from each peer's record,
    // never from the connection flag of the bridge's target alias.
    const rows = JSON.parse(output.join('\n')) as Array<Record<string, unknown>>
    expect(rows.map(({ updatedAt: _updatedAt, ...row }) => row)).toEqual([
      { alias: 'tab-a', id: '-', status: 'idle', tools: 1, origin: 'http://localhost:5173' },
      { alias: 'tab-b', id: '-', status: 'idle', tools: 0, origin: '-' },
    ])
  })
})
