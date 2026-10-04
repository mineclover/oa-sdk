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

const MAX_STORE_BYTES = 16 * 1024 * 1024
const MAX_PEERS = 10_000
const MAX_TOOLS = 1_000
const MAX_STRING_LENGTH = 16_384

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function boundedString(value: unknown, max = MAX_STRING_LENGTH): value is string {
  return typeof value === 'string' && value.length <= max
}

function normalizeTool(value: unknown): { name: string; description?: string; inputSchema?: Record<string, unknown> } | null {
  if (!isRecord(value) || !isSafeToolName(value.name)) return null
  const tool: { name: string; description?: string; inputSchema?: Record<string, unknown> } = { name: value.name }
  if (value.description !== undefined) {
    if (!boundedString(value.description)) return null
    tool.description = value.description
  }
  if (value.inputSchema !== undefined) {
    if (!isRecord(value.inputSchema)) return null
    tool.inputSchema = value.inputSchema
  }
  return tool
}

function isSafeToolName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value)
}

function normalizePeer(alias: string, value: unknown): WebMcpPeerRecord {
  if (!isRecord(value)) throw new Error('PEER_STORE_CORRUPT')
  const record: WebMcpPeerRecord = { alias }
  for (const field of ['id', 'title', 'origin', 'signalingUrl', 'invitationUrl', 'token'] as const) {
    if (value[field] !== undefined) {
      if (!boundedString(value[field])) throw new Error('PEER_STORE_CORRUPT')
      record[field] = value[field]
    }
  }
  if (value.status !== undefined) {
    if (!boundedString(value.status)) throw new Error('PEER_STORE_CORRUPT')
    record.status = value.status
  }
  if (value.allowedTools !== undefined) {
    if (!Array.isArray(value.allowedTools) || value.allowedTools.length > MAX_TOOLS || value.allowedTools.some((tool) => !isSafeToolName(tool))) {
      throw new Error('PEER_STORE_CORRUPT')
    }
    record.allowedTools = [...value.allowedTools]
  }
  if (value.cachedTools !== undefined) {
    if (!Array.isArray(value.cachedTools) || value.cachedTools.length > MAX_TOOLS) throw new Error('PEER_STORE_CORRUPT')
    const tools = value.cachedTools.map(normalizeTool)
    if (tools.some((tool) => tool === null)) throw new Error('PEER_STORE_CORRUPT')
    record.cachedTools = tools as Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>
  }
  if (value.skillManifest !== undefined) {
    const manifest = value.skillManifest
    if (!isRecord(manifest) || !boundedString(manifest.id) || !boundedString(manifest.name) || !boundedString(manifest.version) || !boundedString(manifest.description)) {
      throw new Error('PEER_STORE_CORRUPT')
    }
    if (manifest.instructions !== undefined && !boundedString(manifest.instructions)) throw new Error('PEER_STORE_CORRUPT')
    record.skillManifest = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      ...(manifest.instructions === undefined ? {} : { instructions: manifest.instructions }),
    }
  }
  if (value.updatedAt !== undefined) {
    if (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)) throw new Error('PEER_STORE_CORRUPT')
    record.updatedAt = value.updatedAt
  }
  return record
}

function normalizeStore(value: unknown): PeerStoreData {
  if (!isRecord(value)) throw new Error('PEER_STORE_CORRUPT')
  const version = value.version
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1 || !isRecord(value.peers)) {
    throw new Error('PEER_STORE_CORRUPT')
  }
  const aliases = Object.keys(value.peers)
  if (aliases.length > MAX_PEERS) throw new Error('PEER_STORE_CORRUPT')
  const peers: Record<string, WebMcpPeerRecord> = Object.create(null) as Record<string, WebMcpPeerRecord>
  for (const alias of aliases) {
    if (!isSafeAlias(alias)) throw new Error('PEER_STORE_CORRUPT')
    peers[alias] = normalizePeer(alias, value.peers[alias])
  }
  let activeAlias: string | undefined
  if (value.activeAlias !== undefined) {
    if (!isSafeAlias(value.activeAlias)) throw new Error('PEER_STORE_CORRUPT')
    activeAlias = value.activeAlias
  }
  return { version, ...(activeAlias === undefined ? {} : { activeAlias }), peers }
}

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
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('PEER_STORE_CORRUPT')
    }
    return normalizeStore(parsed)
  }

  async save(data: PeerStoreData): Promise<void> {
    const normalized = normalizeStore(data)
    await this.mutate(async () => this.write(normalized))
  }

  async updatePeer(alias: string, patch: Partial<WebMcpPeerRecord>): Promise<WebMcpPeerRecord> {
    if (!isSafeAlias(alias) || !isRecord(patch)) throw new Error('Invalid peer alias or patch')
    return this.mutate(async () => {
      const data = await this.load()
      const existing = data.peers[alias] ?? { alias }
      const updated = normalizePeer(alias, { ...existing, ...patch, alias, updatedAt: Date.now() })
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
