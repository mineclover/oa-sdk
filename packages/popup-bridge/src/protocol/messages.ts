/**
 * Bootstrap and control messages.
 *
 * Bootstrap messages cross `window.postMessage` and are therefore checked for origin and source.
 * Control messages travel over the transferred `MessagePort` next to the JSON-RPC traffic; the
 * port is trusted because it was handed over during the verified bootstrap.
 */
import type { WireError } from './errors.js'
import { normalizeFeatures } from './features.js'

/** Upper bound on the protocol versions of one HELLO; a longer list is refused as malformed. */
export const MAX_PROTOCOL_VERSIONS = 64

export type Capability = {
  name: string
  /** `major.minor.patch` of the method or event. */
  version: string
  /** Omitted means `method`. */
  kind?: 'method' | 'event'
}

/** Popup → Host (window). Sent once the popup is listening. */
export type HelloMessage = {
  kind: 'bridge.hello'
  sessionId: string
  /** New for every page load, so a reloaded popup is told apart from the previous page. */
  instanceId: string
  protocolVersions: string[]
  /** Optional features the popup offers; omitted when it offers none (or predates features). */
  features?: string[]
}

/** Host → Popup (window), carries `MessageChannel.port2` in the transfer list. */
export type ConnectMessage = {
  kind: 'bridge.connect'
  sessionId: string
  instanceId: string
  protocolVersion: string
  init: unknown
  /** The features both sides offer, in the host's order; omitted when there are none. */
  features?: string[]
}

/** Host → Popup (window). The host refuses this popup instance. */
export type RejectMessage = {
  kind: 'bridge.reject'
  sessionId: string
  instanceId: string
  error: WireError
}

/** Popup → Host (port). Initialization succeeded; the listed capabilities are callable. */
export type ReadyMessage = {
  kind: 'bridge.ready'
  sessionId: string
  instanceId: string
  capabilities: Capability[]
  /** The features the popup will actually use for this connection; omitted when there are none. */
  features?: string[]
}

/** Popup → Host (port). Initialization failed; no `ready` follows. */
export type InitFailedMessage = {
  kind: 'bridge.init-failed'
  sessionId: string
  instanceId: string
  error: WireError
}

export type CloseReason = 'host-close' | 'popup-close' | 'unload' | 'error'

/** Either side (port). `unload` means the page is going away and may come back (reload). */
export type CloseMessage = {
  kind: 'bridge.close'
  sessionId: string
  instanceId: string
  reason: CloseReason
}

export type BridgeMessage =
  | HelloMessage
  | ConnectMessage
  | RejectMessage
  | ReadyMessage
  | InitFailedMessage
  | CloseMessage

const KINDS: ReadonlySet<string> = new Set([
  'bridge.hello',
  'bridge.connect',
  'bridge.reject',
  'bridge.ready',
  'bridge.init-failed',
  'bridge.close',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Cheap pre-filter: windows receive plenty of unrelated messages. */
export function isBridgeMessage(value: unknown): value is { kind: string } {
  return isRecord(value) && typeof value.kind === 'string' && value.kind.startsWith('bridge.')
}

function ids(value: Record<string, unknown>): value is Record<string, unknown> & { sessionId: string; instanceId: string } {
  return typeof value.sessionId === 'string' && typeof value.instanceId === 'string'
}

function isWireError(value: unknown): value is WireError {
  return isRecord(value) && typeof value.code === 'number' && typeof value.message === 'string'
}

function isCapability(value: unknown): value is Capability {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.version === 'string' &&
    (value.kind === undefined || value.kind === 'method' || value.kind === 'event')
  )
}

/** A malformed `features` member never rejects a message: it reads as "offers none". */
function featuresOf(value: Record<string, unknown>): { features?: string[] } {
  const features = normalizeFeatures(value.features)
  return features.length === 0 ? {} : { features }
}

/**
 * Reads the versions of a HELLO. The length is checked before anything is walked, because a sparse
 * array of a huge length costs a few bytes on the wire and a long time to visit; a hole is not a
 * string, so it fails like any other bad entry.
 */
function versionsOf(list: unknown, sessionId: string, instanceId: string, value: Record<string, unknown>): HelloMessage | undefined {
  if (!Array.isArray(list) || list.length > MAX_PROTOCOL_VERSIONS) return undefined
  const protocolVersions: string[] = []
  for (let index = 0; index < list.length; index += 1) {
    const entry: unknown = list[index]
    if (typeof entry !== 'string') return undefined
    protocolVersions.push(entry)
  }
  return { kind: 'bridge.hello', sessionId, instanceId, protocolVersions, ...featuresOf(value) }
}

/**
 * Validates an untrusted message into one of the typed messages, or `undefined` when it is not a
 * well-formed bridge message. Extra members are dropped so peers cannot smuggle data through.
 */
export function parseBridgeMessage(value: unknown): BridgeMessage | undefined {
  if (!isRecord(value) || typeof value.kind !== 'string' || !KINDS.has(value.kind) || !ids(value)) return undefined
  const { sessionId, instanceId } = value
  switch (value.kind) {
    case 'bridge.hello':
      return versionsOf(value.protocolVersions, sessionId, instanceId, value)
    case 'bridge.connect':
      if (typeof value.protocolVersion !== 'string') return undefined
      return { kind: 'bridge.connect', sessionId, instanceId, protocolVersion: value.protocolVersion, init: value.init, ...featuresOf(value) }
    case 'bridge.reject':
      if (!isWireError(value.error)) return undefined
      return { kind: 'bridge.reject', sessionId, instanceId, error: value.error }
    case 'bridge.ready':
      if (!Array.isArray(value.capabilities) || !value.capabilities.every(isCapability)) return undefined
      return {
        kind: 'bridge.ready',
        sessionId,
        instanceId,
        capabilities: value.capabilities.map(c => ({ name: c.name, version: c.version, ...(c.kind === undefined ? {} : { kind: c.kind }) })),
        ...featuresOf(value),
      }
    case 'bridge.init-failed':
      if (!isWireError(value.error)) return undefined
      return { kind: 'bridge.init-failed', sessionId, instanceId, error: value.error }
    case 'bridge.close': {
      const reason = value.reason
      if (reason !== 'host-close' && reason !== 'popup-close' && reason !== 'unload' && reason !== 'error') return undefined
      return { kind: 'bridge.close', sessionId, instanceId, reason }
    }
    default:
      return undefined
  }
}

/** Fragment parameter that tells the popup which session opened it. */
export const SESSION_PARAM = 'oaBridgeSession'

/**
 * Appends the session id to the URL fragment. A fragment is never sent to the server, and the id
 * is only a correlation value: it carries no secret and grants nothing by itself.
 */
export function attachSession(url: string, sessionId: string): string {
  const target = new URL(url)
  const params = new URLSearchParams(target.hash.slice(1))
  params.set(SESSION_PARAM, sessionId)
  target.hash = params.toString()
  return target.toString()
}

export function readSession(hash: string): string | undefined {
  const value = new URLSearchParams(hash.replace(/^#/, '')).get(SESSION_PARAM)
  return value === null || value === '' ? undefined : value
}

export function createId(): string {
  return globalThis.crypto.randomUUID()
}
