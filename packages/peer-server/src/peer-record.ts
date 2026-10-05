/**
 * @oa-sdk/peer-server — Peer record validation shared by the store and the HTTP API.
 *
 * Peer records reach the server from browser announcements and from the
 * peers.json file on disk. Both are untrusted, so every record is rebuilt from
 * validated fields before it is stored or served.
 */
import type { WebMcpPeerRecord } from '@oa-sdk/peer-transport'

const MAX_TOOLS = 1_000
const MAX_STRING_LENGTH = 16_384

type CachedTool = NonNullable<WebMcpPeerRecord['cachedTools']>[number]

/** Thrown when a stored or announced peer record violates the record contract. */
export class PeerRecordError extends Error {
  constructor() {
    super('PEER_STORE_CORRUPT')
  }
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function isSafeToolName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value)
}

export function boundedString(value: unknown, max = MAX_STRING_LENGTH): value is string {
  return typeof value === 'string' && value.length <= max
}

function parseCachedTool(value: unknown): CachedTool {
  if (!isPlainRecord(value) || !isSafeToolName(value.name)) throw new PeerRecordError()
  const tool: CachedTool = { name: value.name }
  if (value.description !== undefined) {
    if (!boundedString(value.description)) throw new PeerRecordError()
    tool.description = value.description
  }
  if (value.inputSchema !== undefined) {
    if (!isPlainRecord(value.inputSchema)) throw new PeerRecordError()
    tool.inputSchema = value.inputSchema
  }
  return tool
}

/**
 * Rebuild a peer record from validated fields. Unknown fields are dropped and
 * any known field with the wrong type rejects the whole record.
 */
export function parsePeerRecord(alias: string, value: unknown): WebMcpPeerRecord {
  if (!isPlainRecord(value)) throw new PeerRecordError()
  const record: WebMcpPeerRecord = { alias }
  for (const field of ['id', 'title', 'origin', 'signalingUrl', 'invitationUrl', 'token'] as const) {
    if (value[field] !== undefined) {
      if (!boundedString(value[field])) throw new PeerRecordError()
      record[field] = value[field]
    }
  }
  if (value.status !== undefined) {
    if (!boundedString(value.status)) throw new PeerRecordError()
    record.status = value.status
  }
  if (value.allowedTools !== undefined) {
    if (!Array.isArray(value.allowedTools) || value.allowedTools.length > MAX_TOOLS || !value.allowedTools.every(isSafeToolName)) {
      throw new PeerRecordError()
    }
    record.allowedTools = [...value.allowedTools]
  }
  if (value.cachedTools !== undefined) {
    if (!Array.isArray(value.cachedTools) || value.cachedTools.length > MAX_TOOLS) throw new PeerRecordError()
    record.cachedTools = value.cachedTools.map(parseCachedTool)
  }
  if (value.skillManifest !== undefined) {
    const manifest = value.skillManifest
    if (!isPlainRecord(manifest) || !boundedString(manifest.id) || !boundedString(manifest.name) || !boundedString(manifest.version) || !boundedString(manifest.description)) {
      throw new PeerRecordError()
    }
    if (manifest.instructions !== undefined && !boundedString(manifest.instructions)) throw new PeerRecordError()
    record.skillManifest = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      ...(manifest.instructions === undefined ? {} : { instructions: manifest.instructions }),
    }
  }
  if (value.updatedAt !== undefined) {
    if (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)) throw new PeerRecordError()
    record.updatedAt = value.updatedAt
  }
  return record
}
