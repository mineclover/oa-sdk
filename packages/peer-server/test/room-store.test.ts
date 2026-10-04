import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FilePeerStore, PeerRoomManager, type SignalingPeerSocket } from '../src/index.js'

function room(alias = 'peer-a', socket?: SignalingPeerSocket) {
  return {
    id: alias,
    alias,
    status: socket ? 'connected' as const : 'refreshing' as const,
    providerSocket: socket,
    cachedTools: [{ name: 'echo' }],
    allowedTools: ['echo'],
    updatedAt: Date.now(),
  }
}

describe('PeerRoomManager safety boundaries', () => {
  const managers: PeerRoomManager[] = []
  afterEach(() => {
    for (const manager of managers.splice(0)) manager.dispose()
    vi.useRealTimers()
  })

  it('counts reconnect waiters against the pending-call capacity', async () => {
    const manager = new PeerRoomManager({ maxPendingCalls: 1 })
    managers.push(manager)
    manager.registerRoom(room())

    const first = manager.executeMcpCallOnPeer('peer-a', 'echo', {}, 25, 25)
    await expect(manager.executeMcpCallOnPeer('peer-a', 'echo', {}, 25, 25)).rejects.toThrow('TOO_MANY_PENDING_CALLS')
    await expect(first).rejects.toThrow('PEER_UNAVAILABLE')
  })

  it('wakes a reconnecting call when its provider socket arrives', async () => {
    const manager = new PeerRoomManager()
    managers.push(manager)
    manager.registerRoom(room())
    const sent: any[] = []
    const socket: SignalingPeerSocket = { send: (message) => void sent.push(message) }

    const call = manager.executeMcpCallOnPeer('peer-a', 'echo', { value: 1 }, 500, 500)
    await new Promise((resolve) => setTimeout(resolve, 5))
    manager.setProviderSocket('peer-a', socket)
    await vi.waitFor(() => expect(sent).toHaveLength(1))

    const id = sent[0].message.id
    manager.handleProviderMessage('peer-a', { type: 'mcp', message: { id, result: { value: 1 } } }, socket)
    await expect(call).resolves.toEqual({ value: 1 })
  })

  it('does not allow a replaced provider socket to settle an old call', async () => {
    const manager = new PeerRoomManager()
    managers.push(manager)
    const firstSent: any[] = []
    const firstSocket: SignalingPeerSocket = { send: (message) => void firstSent.push(message) }
    const secondSocket: SignalingPeerSocket = { send: () => undefined }
    manager.registerRoom(room('peer-a', firstSocket))

    const call = manager.executeMcpCallOnPeer('peer-a', 'echo', {}, 0, 100)
    await vi.waitFor(() => expect(firstSent).toHaveLength(1))
    const id = firstSent[0].message.id
    manager.setProviderSocket('peer-a', secondSocket)
    manager.handleProviderMessage('peer-a', { type: 'mcp', message: { id, result: 'stale' } }, firstSocket)
    await new Promise((resolve) => setTimeout(resolve, 5))
    manager.handleProviderMessage('peer-a', { type: 'mcp', message: { id, result: 'fresh' } }, secondSocket)
    await expect(call).resolves.toBe('fresh')
  })

  it('enforces the room allow-list and validates timeout options', async () => {
    const manager = new PeerRoomManager()
    managers.push(manager)
    manager.registerRoom(room('peer-a', { send: () => undefined }))
    await expect(manager.executeMcpCallOnPeer('peer-a', 'delete-all', {}, 0, 100)).rejects.toThrow('TOOL_NOT_ALLOWED')
    await expect(manager.executeMcpCallOnPeer('peer-a', 'echo', {}, Number.NaN, 100)).rejects.toThrow('waitTimeoutMs')
    await expect(manager.executeMcpCallOnPeer('peer-a', 'echo', {}, 0, Number.POSITIVE_INFINITY)).rejects.toThrow('callTimeoutMs')
  })

  it('rejects calls and releases timers when disposed', async () => {
    const manager = new PeerRoomManager()
    manager.registerRoom(room())
    const call = manager.executeMcpCallOnPeer('peer-a', 'echo', {}, 10_000, 10_000)
    manager.dispose()
    await expect(call).rejects.toThrow('ROOM_MANAGER_CLOSED')
    expect(() => manager.registerRoom(room('peer-b'))).toThrow('ROOM_MANAGER_CLOSED')
  })
})

describe('FilePeerStore integrity and concurrency', () => {
  const directories: string[] = []
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  async function storePair() {
    const directory = await mkdtemp(join(tmpdir(), 'oa-peer-store-'))
    directories.push(directory)
    const path = join(directory, 'peers.json')
    return { path, first: new FilePeerStore(path), second: new FilePeerStore(path) }
  }

  it('serializes read-modify-write updates across store instances', async () => {
    const { first, second } = await storePair()
    await Promise.all([
      first.updatePeer('peer-a', { title: 'A' }),
      second.updatePeer('peer-b', { title: 'B' }),
    ])
    const data = await first.load()
    expect(Object.keys(data.peers).sort()).toEqual(['peer-a', 'peer-b'])
  })

  it('writes a private registry and preserves it when a corrupt file is found', async () => {
    const { path, first } = await storePair()
    await first.updatePeer('peer-a', { token: 'secret' })
    expect((await stat(path)).mode & 0o777).toBe(0o600)

    await writeFile(path, '{not-json', 'utf8')
    await expect(first.load()).rejects.toThrow('PEER_STORE_CORRUPT')
    await expect(first.updatePeer('peer-b', { title: 'B' })).rejects.toThrow('PEER_STORE_CORRUPT')
    expect(await readFile(path, 'utf8')).toBe('{not-json')
  })

  it('rejects inherited-key aliases and malformed peer patches', async () => {
    const { first } = await storePair()
    await expect(first.updatePeer('__proto__', { title: 'unsafe' })).rejects.toThrow('Invalid peer alias')
    await expect(first.updatePeer('peer-a', { cachedTools: [{} as any] })).rejects.toThrow('PEER_STORE_CORRUPT')
    expect(await first.getPeer('__proto__')).toBeNull()
    expect(await first.removePeer('constructor')).toBe(false)
  })
})
