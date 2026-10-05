/**
 * @oa-sdk/peer-transport — Bridge protocol validation
 *
 * The bridge daemon and the local peers.json registry are both outside this
 * process. Every JSON document read from them passes through one of the named
 * schemas below before it becomes a domain type, so a malformed or hostile
 * response cannot hand callers fields of an unexpected type. Bridge tokens are
 * never surfaced from a parsed peer record.
 */
import type { WebMcpPeerRecord } from './types.js'

/** A named runtime validator: `parse` returns the validated value or throws a TypeError. */
export interface BridgeSchema<T> {
  parse(value: unknown): T
}

type CachedTool = NonNullable<WebMcpPeerRecord['cachedTools']>[number]
type SkillManifest = NonNullable<WebMcpPeerRecord['skillManifest']>

export interface BridgeToolDescriptor {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface BridgeStatus {
  ok: boolean
  activeAlias?: string | undefined
  targetAlias?: string | undefined
  connected?: boolean | undefined
  toolsCount?: number | undefined
  tools?: string[] | undefined
  peers?: WebMcpPeerRecord[] | undefined
}

export interface BridgeCallResponse {
  error?: string | undefined
  message?: string | undefined
  /** The `result` member, or the whole document for bridges that reply with a bare result. */
  result: unknown
}

const SAFE_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
const OPTIONAL_STRING_FIELDS = ['id', 'title', 'origin', 'signalingUrl', 'invitationUrl', 'status'] as const

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isSafeAlias(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ALIAS.test(value)
}

export function isSafeToolName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !CONTROL_CHARACTERS.test(value)
}

function parseCachedTool(value: unknown): CachedTool | undefined {
  if (!isRecord(value) || !isSafeToolName(value.name)) return undefined
  return {
    name: value.name,
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(isRecord(value.inputSchema) ? { inputSchema: value.inputSchema } : {}),
  }
}

function parseSkillManifest(value: unknown): SkillManifest | undefined {
  if (!isRecord(value)) return undefined
  const { id, name, version, description, instructions } = value
  if (typeof id !== 'string' || typeof name !== 'string' || typeof version !== 'string' || typeof description !== 'string') {
    return undefined
  }
  return { id, name, version, description, ...(typeof instructions === 'string' ? { instructions } : {}) }
}

/**
 * Validate one peer record. A record without a safe alias is rejected; an
 * optional field with the wrong type is dropped, unknown fields are not
 * copied, and the bridge token is never part of the result.
 */
export function parsePeerRecord(value: unknown): WebMcpPeerRecord | undefined {
  if (!isRecord(value) || !isSafeAlias(value.alias)) return undefined
  const record: WebMcpPeerRecord = { alias: value.alias }
  for (const field of OPTIONAL_STRING_FIELDS) {
    const fieldValue = value[field]
    if (typeof fieldValue === 'string') record[field] = fieldValue
  }
  if (Array.isArray(value.allowedTools)) record.allowedTools = value.allowedTools.filter(isSafeToolName)
  if (Array.isArray(value.cachedTools)) {
    record.cachedTools = value.cachedTools.flatMap((entry) => {
      const tool = parseCachedTool(entry)
      return tool === undefined ? [] : [tool]
    })
  }
  const manifest = parseSkillManifest(value.skillManifest)
  if (manifest !== undefined) record.skillManifest = manifest
  if (typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)) record.updatedAt = value.updatedAt
  return record
}

/**
 * Validate a peer directory. The bridge may send an alias-keyed object or an
 * array of records; invalid entries are skipped. `undefined` means the
 * document carries no directory at all.
 */
function parsePeerDirectory(value: unknown): Record<string, WebMcpPeerRecord> | undefined {
  const directory: Record<string, WebMcpPeerRecord> = {}
  if (Array.isArray(value)) {
    for (const entry of value) {
      const peer = parsePeerRecord(entry)
      if (peer !== undefined) directory[peer.alias] = peer
    }
    return directory
  }
  if (!isRecord(value)) return undefined
  for (const [alias, entry] of Object.entries(value)) {
    const peer = isSafeAlias(alias) ? parsePeerRecord(entry) : undefined
    if (peer !== undefined) directory[alias] = peer
  }
  return directory
}

/** `/status` peers, or the `peers` object of a local peers.json registry. */
export const PeerDirectorySchema: BridgeSchema<Record<string, WebMcpPeerRecord> | undefined> = {
  parse(value) {
    if (!isRecord(value)) throw new TypeError('Peer directory document must be a JSON object')
    return parsePeerDirectory(value.peers)
  },
}

/** The bridge `/status` document. `peers` is normalized to the declared array form. */
export const BridgeStatusSchema: BridgeSchema<BridgeStatus> = {
  parse(value) {
    if (!isRecord(value)) throw new TypeError('Bridge status must be a JSON object')
    const peers = parsePeerDirectory(value.peers)
    const toolsCount = value.toolsCount
    return {
      ok: value.ok === true,
      ...(typeof value.activeAlias === 'string' ? { activeAlias: value.activeAlias } : {}),
      ...(typeof value.targetAlias === 'string' ? { targetAlias: value.targetAlias } : {}),
      ...(typeof value.connected === 'boolean' ? { connected: value.connected } : {}),
      ...(typeof toolsCount === 'number' && Number.isSafeInteger(toolsCount) && toolsCount >= 0 ? { toolsCount } : {}),
      ...(Array.isArray(value.tools) ? { tools: value.tools.filter(isSafeToolName) } : {}),
      ...(peers === undefined ? {} : { peers: Object.values(peers) }),
    }
  },
}

/** The bridge `/tools` document. Entries without a safe tool name are skipped. */
export const BridgeToolListSchema: BridgeSchema<BridgeToolDescriptor[]> = {
  parse(value) {
    if (!isRecord(value) || !Array.isArray(value.tools)) throw new TypeError('Bridge tool list must contain a tools array')
    return value.tools.flatMap((entry) => {
      const tool = parseCachedTool(entry)
      if (tool === undefined) return []
      return [{
        name: tool.name,
        description: tool.description ?? `WebMCP tool ${tool.name}`,
        inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
      }]
    })
  },
}

/**
 * The bridge `/call` document. A tool result is arbitrary JSON by protocol, so
 * it stays `unknown`; only the envelope members are typed.
 */
export const BridgeCallResponseSchema: BridgeSchema<BridgeCallResponse> = {
  parse(value) {
    if (!isRecord(value)) return { result: value }
    return {
      ...(typeof value.error === 'string' ? { error: value.error } : {}),
      ...(typeof value.message === 'string' ? { message: value.message } : {}),
      result: 'result' in value ? value.result : value,
    }
  },
}
