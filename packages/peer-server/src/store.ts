/**
 * @oa-sdk/peer-server — Local Peer Store
 *
 * Atomically manages ~/.webmcp/peers.json registry.
 */
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { PeerStoreData } from './types.js'
import type { WebMcpPeerRecord } from '@oa-sdk/peer-transport'
import { PeerRecordError, isPlainRecord, parsePeerRecord } from './peer-record.js'

const MAX_STORE_BYTES = 16 * 1024 * 1024
const MAX_PEERS = 10_000

function normalizeStore(value: unknown): PeerStoreData {
  if (!isPlainRecord(value)) throw new PeerRecordError()
  const version = value.version
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1 || !isPlainRecord(value.peers)) {
    throw new PeerRecordError()
  }
  const aliases = Object.keys(value.peers)
  if (aliases.length > MAX_PEERS) throw new PeerRecordError()
  const peers: Record<string, WebMcpPeerRecord> = Object.create(null) as Record<string, WebMcpPeerRecord>
  for (const alias of aliases) {
    if (!isSafeAlias(alias)) throw new PeerRecordError()
    peers[alias] = parsePeerRecord(alias, value.peers[alias])
  }
  let activeAlias: string | undefined
  if (value.activeAlias !== undefined) {
    if (!isSafeAlias(value.activeAlias)) throw new PeerRecordError()
    activeAlias = value.activeAlias
  }
  return { version, ...(activeAlias === undefined ? {} : { activeAlias }), peers }
}

/** The peers.json document. Any violation is reported as PEER_STORE_CORRUPT. */
const PeerStoreSchema = { parse: normalizeStore }

export class FilePeerStore {
  readonly path: string
  private static readonly mutationQueues = new Map<string, Promise<void>>()

  constructor(customPath?: string) {
    this.path = customPath ?? join(homedir(), '.webmcp', 'peers.json')
  }

  async load(): Promise<PeerStoreData> {
    let text: string
    try {
      const metadata = await stat(this.path)
      if (metadata.size > MAX_STORE_BYTES) throw new Error('PEER_STORE_TOO_LARGE')
      text = await readFile(this.path, 'utf-8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, peers: {} }
      if (error instanceof Error && (error.message === 'PEER_STORE_TOO_LARGE' || error.message === 'PEER_STORE_CORRUPT')) throw error
      throw new Error('PEER_STORE_UNREADABLE')
    }
    try {
      return PeerStoreSchema.parse(JSON.parse(text))
    } catch {
      // Malformed JSON and schema violations are both a corrupt store.
      throw new PeerRecordError()
    }
  }

  async save(data: PeerStoreData): Promise<void> {
    const normalized = normalizeStore(data)
    await this.mutate(async () => this.write(normalized))
  }

  async updatePeer(alias: string, patch: Partial<WebMcpPeerRecord>): Promise<WebMcpPeerRecord> {
    if (!isSafeAlias(alias) || !isPlainRecord(patch)) throw new Error('Invalid peer alias or patch')
    return this.mutate(async () => {
      const data = await this.load()
      const existing = data.peers[alias] ?? { alias }
      const updated = parsePeerRecord(alias, { ...existing, ...patch, alias, updatedAt: Date.now() })
      data.peers[alias] = updated
      if (!data.activeAlias) data.activeAlias = alias
      await this.write(data)
      return updated
    })
  }

  async removePeer(alias: string): Promise<boolean> {
    if (!isSafeAlias(alias)) return false
    return this.mutate(async () => {
      const data = await this.load()
      if (!Object.prototype.hasOwnProperty.call(data.peers, alias)) return false
      delete data.peers[alias]
      if (data.activeAlias === alias) {
        const remaining = Object.keys(data.peers)
        data.activeAlias = remaining[0]
      }
      await this.write(data)
      return true
    })
  }

  async getPeer(alias: string): Promise<WebMcpPeerRecord | null> {
    if (!isSafeAlias(alias)) return null
    const data = await this.load()
    return data.peers[alias] ?? null
  }

  private async write(data: PeerStoreData): Promise<void> {
    const normalized = normalizeStore(data)
    const directory = dirname(this.path)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    try {
      await chmod(directory, 0o700)
    } catch {
      // Best effort on filesystems that do not support chmod.
    }
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(temporaryPath, JSON.stringify(normalized, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await rename(temporaryPath, this.path)
    } finally {
      // A failed rename/write must not leave a credential-bearing temp file.
      try {
        await import('node:fs/promises').then(({ unlink }) => unlink(temporaryPath))
      } catch {
        // The temporary file was renamed or did not get created.
      }
    }
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = FilePeerStore.mutationQueues.get(this.path) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(operation)
    const queue = run.then(() => undefined, () => undefined)
    FilePeerStore.mutationQueues.set(this.path, queue)
    try {
      return await run
    } finally {
      if (FilePeerStore.mutationQueues.get(this.path) === queue) FilePeerStore.mutationQueues.delete(this.path)
    }
  }
}

export function isSafeAlias(alias: unknown): alias is string {
  return typeof alias === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(alias)
}
