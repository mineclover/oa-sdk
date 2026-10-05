/**
 * @oa-sdk/tools — WebMCP bridge protocol validation for the built-in peer client.
 *
 * The bridge daemon, the local peers.json registry, and MCP callers are all
 * outside this process. Their JSON passes through these named schemas before
 * it becomes a WebMCP domain type.
 */
import type { WebMcpPeerRecord, WebMcpPeerStatus } from './peer.js'

/** A named runtime validator: `parse` returns the validated value or throws a TypeError. */
export interface PeerProtocolSchema<T> {
  parse(value: unknown): T
}

export interface PeerToolDescriptor {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface PeerCallResponse {
  error?: string | undefined
  message?: string | undefined
  /** The `result` member, or the whole document when the bridge replies without one. */
  result: unknown
}

/** Arguments of the `webmcp_call` meta-tool. */
export interface WebMcpCallInput {
  tool: string
  args: Record<string, unknown>
  peer?: string | undefined
}

type CachedTool = NonNullable<WebMcpPeerRecord['cachedTools']>[number]
type SkillManifest = NonNullable<WebMcpPeerRecord['skillManifest']>

const OPTIONAL_STRING_FIELDS = ['id', 'title', 'origin', 'signalingUrl', 'invitationUrl', 'status'] as const

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isToolName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value)
}

function parseCachedTool(value: unknown): CachedTool | undefined {
  if (!isRecord(value) || !isToolName(value.name)) return undefined
  return {
    name: value.name,
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(isRecord(value.inputSchema) ? { inputSchema: value.inputSchema } : {}),
  }
}

/**
 * An allow-list only ever narrows a peer, so it fails closed: unusable names
 * are left out, and an `allowedTools` that is present but not an array (null
 * included) becomes an empty list. Dropping it instead would leave the record
 * with no allow-list, which consumers such as mcp-mesh read as "every tool".
 */
function parseAllowedTools(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  return Array.isArray(value) ? value.filter(isToolName) : []
}

/** A skill manifest needs its four identifying strings; `instructions` is kept when it is a string. */
function parseSkillManifest(value: unknown): SkillManifest | undefined {
  if (!isRecord(value)) return undefined
  const { id, name, version, description, instructions } = value
  if (typeof id !== 'string' || typeof name !== 'string' || typeof version !== 'string' || typeof description !== 'string') {
    return undefined
  }
  return { id, name, version, description, ...(typeof instructions === 'string' ? { instructions } : {}) }
}

/**
 * Rebuild a peer record from typed known fields; credentials and unknown fields
 * are not copied. A wrong-typed optional field is dropped, except
 * `allowedTools`, which fails closed (see parseAllowedTools).
 */
function parsePeerRecord(value: unknown): WebMcpPeerRecord | undefined {
  if (!isRecord(value) || typeof value.alias !== 'string' || value.alias.length === 0) return undefined
  const record: WebMcpPeerRecord = { alias: value.alias }
  for (const field of OPTIONAL_STRING_FIELDS) {
    const fieldValue = value[field]
    if (typeof fieldValue === 'string') record[field] = fieldValue
  }
  const allowedTools = parseAllowedTools(value.allowedTools)
  if (allowedTools !== undefined) record.allowedTools = allowedTools
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
 * Validate an alias-keyed peer directory. Invalid entries are skipped, and the
 * result has no prototype so an alias such as `__proto__` stays an own key.
 */
function parsePeerDirectory(value: Record<string, unknown>): Record<string, WebMcpPeerRecord> {
  const directory: Record<string, WebMcpPeerRecord> = Object.create(null)
  for (const [alias, entry] of Object.entries(value)) {
    const peer = parsePeerRecord(entry)
    if (peer !== undefined) directory[alias] = peer
  }
  return directory
}

/**
 * Validate `/status` peers without changing their form: an array stays an
 * array and an alias-keyed directory stays keyed.
 */
function parseStatusPeers(value: unknown): NonNullable<WebMcpPeerStatus['peers']> | undefined {
  if (isRecord(value)) return parsePeerDirectory(value)
  if (!Array.isArray(value)) return undefined
  return value.flatMap((entry) => {
    const peer = parsePeerRecord(entry)
    return peer === undefined ? [] : [peer]
  })
}

/** The local peers.json registry, as its alias-keyed `peers` directory. */
export const PeerStoreSchema: PeerProtocolSchema<Record<string, WebMcpPeerRecord>> = {
  parse(value) {
    if (!isRecord(value)) throw new TypeError('Peer registry must be a JSON object')
    return parsePeerDirectory(isRecord(value.peers) ? value.peers : {})
  },
}

/** The bridge `/status` document. Each peer record is validated; `peers` keeps the form the bridge sent. */
export const PeerStatusSchema: PeerProtocolSchema<WebMcpPeerStatus> = {
  parse(value) {
    if (!isRecord(value)) throw new TypeError('Bridge status must be a JSON object')
    const peers = parseStatusPeers(value.peers)
    const toolsCount = value.toolsCount
    return {
      ok: value.ok === true,
      ...(typeof value.activeAlias === 'string' ? { activeAlias: value.activeAlias } : {}),
      ...(typeof value.targetAlias === 'string' ? { targetAlias: value.targetAlias } : {}),
      ...(typeof value.connected === 'boolean' ? { connected: value.connected } : {}),
      ...(typeof toolsCount === 'number' && Number.isSafeInteger(toolsCount) && toolsCount >= 0 ? { toolsCount } : {}),
      ...(Array.isArray(value.tools) ? { tools: value.tools.filter(isToolName) } : {}),
      ...(peers === undefined ? {} : { peers }),
    }
  },
}

/** The bridge `/tools` document. Entries without a usable tool name are skipped. */
export const PeerToolListSchema: PeerProtocolSchema<PeerToolDescriptor[]> = {
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

/** The bridge `/call` document. A tool result is arbitrary JSON by protocol, so it stays `unknown`. */
export const PeerCallResponseSchema: PeerProtocolSchema<PeerCallResponse> = {
  parse(value) {
    if (!isRecord(value)) return { result: value }
    return {
      ...(typeof value.error === 'string' ? { error: value.error } : {}),
      ...(typeof value.message === 'string' ? { message: value.message } : {}),
      result: value.result ?? value,
    }
  },
}

/** `webmcp_call` arguments, checked again here because execute can be called directly. */
export const WebMcpCallInputSchema: PeerProtocolSchema<WebMcpCallInput> = {
  parse(value) {
    if (!isRecord(value) || !isToolName(value.tool)) throw new TypeError('webmcp_call requires a tool name')
    if (value.args !== undefined && !isRecord(value.args)) throw new TypeError('webmcp_call args must be an object')
    if (value.peer !== undefined && typeof value.peer !== 'string') throw new TypeError('webmcp_call peer must be a string')
    return { tool: value.tool, args: value.args ?? {}, ...(value.peer === undefined ? {} : { peer: value.peer }) }
  },
}

/** Arguments forwarded to a discovered peer tool: an object, or nothing. */
export const PeerToolArgumentsSchema: PeerProtocolSchema<Record<string, unknown>> = {
  parse(value) {
    if (value === undefined || value === null) return {}
    if (!isRecord(value)) throw new TypeError('Peer tool arguments must be an object')
    return value
  },
}
