/**
 * A bridge node is one page's identity in a network of windows. It owns what is shared by all of
 * the page's links (the attention policy, the trace stream, shared state) and answers "who is
 * connected to me?", so a page that is a popup of one window and the host of another uses a single
 * node for both roles: `createPopupRuntime({ node })` and `createPopupBridge({ node })`.
 */
import { createAttentionManager, type AttentionManager, type AttentionOptions } from '../attention/manager.js'
import type { AttentionResult } from '../attention/types.js'
import type { RetryPhase, RetryTarget } from '../backoff.js'
import type { HandlerContext } from '../contract/define.js'
import { BridgeError } from '../protocol/errors.js'
import { createId } from '../protocol/messages.js'
import type { SecurityEvent } from '../protocol/security.js'
import type { RpcRegistration, RpcTrace } from '../rpc/endpoint.js'
import { SharedStateRegistry, type SharedStates } from '../state/shared.js'
import type { LinkController, LinkRole, PeerLink } from './link.js'

/** Reserved method that returns a node's neighbours. */
export const TOPOLOGY_METHOD = 'bridge.topology'

export type TopologyLink = {
  role: LinkRole
  sessionId: string
  peerOrigin?: string
  status: string
  health?: string
  /** The popup's own neighbours, present when it exposes them and `depth` reached it. */
  node?: TopologyNode
}

export type TopologyNode = {
  nodeId: string
  name?: string
  origin?: string
  links: TopologyLink[]
}

export type TraceEvent = { at: number; nodeId: string } & (
  | { type: 'link'; sessionId: string; role: LinkRole; status: string }
  | { type: 'call'; sessionId: string; role: LinkRole; direction: 'in' | 'out'; method: string; durationMs: number; error?: string }
  | { type: 'notification'; sessionId: string; role: LinkRole; direction: 'in' | 'out'; method: string }
  | { type: 'security'; sessionId: string; role: LinkRole; event: SecurityEvent }
  | { type: 'attention'; sessionId: string; role: LinkRole; direction: 'in' | 'out'; result: AttentionResult }
  | { type: 'retry'; sessionId: string; role: LinkRole; target: RetryTarget; phase: RetryPhase; attempt: number; delayMs?: number; event?: string; error?: string }
  | { type: 'state'; name: string; revision: number; source: 'local' | 'remote'; sessionId?: string }
)

/** A trace event as emitted, before the node stamps it. */
export type TraceInput = TraceEvent extends infer E ? (E extends unknown ? Omit<E, 'at' | 'nodeId'> : never) : never

export type NodeSnapshot = {
  nodeId: string
  name?: string
  origin?: string
  at: number
  links: {
    role: LinkRole
    sessionId: string
    peerOrigin?: string
    status: string
    health?: string
    connected: boolean
    pendingCalls: number
  }[]
  /** The most recent trace events, oldest first. */
  trace: TraceEvent[]
}

export type BridgeNodeOptions = {
  /** Shown in topologies and snapshots. */
  name?: string
  /** This page's origin. Defaults to `location.origin` where there is one. */
  origin?: string
  /** Lets peers ask this page for attention. Pass options or a ready-made manager; unset refuses every request. */
  attention?: AttentionOptions | AttentionManager
  /**
   * Whether peers may read this node's neighbours. A topology reveals the origins of other windows,
   * so it is off by default; `true` allows every peer, a function decides per link.
   */
  topology?: boolean | ((link: PeerLink) => boolean)
  /** Trace events kept for `inspect()`. Default 200. */
  traceBuffer?: number
}

export interface BridgeNode {
  readonly id: string
  readonly name: string | undefined
  /** Links that have not ended yet, popups this page opened and its host. */
  readonly links: readonly PeerLink[]
  readonly attention: AttentionManager | undefined
  /** States this page owns and shares with its links. */
  readonly state: SharedStates
  /** The neighbours of this node and, where peers expose theirs, theirs too. */
  topology(options?: { depth?: number; signal?: AbortSignal }): Promise<TopologyNode>
  /** A serializable picture of the node's current state, for inspectors. */
  inspect(): NodeSnapshot
  /** Observes link changes, calls, notifications, attention and security events. */
  onTrace(listener: (event: TraceEvent) => void): () => void
  dispose(): void
}

export type ExtensionHandler = (link: LinkController, params: unknown, context: HandlerContext) => unknown | Promise<unknown>
export type NotificationHandler = (link: LinkController, params: unknown) => void

const DEFAULT_TRACE_BUFFER = 200
const MAX_TOPOLOGY_DEPTH = 8
const DEFAULT_TOPOLOGY_DEPTH = 2
const TOPOLOGY_CALL_TIMEOUT_MS = 2_000
const MAX_LINKS_PER_NODE = 64
const MAX_TEXT = 256
/** Chatty housekeeping that would only bury the interesting events. */
const QUIET_METHODS = new Set(['bridge.ping'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clip(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT) : undefined
}

/** A peer's topology is untrusted input: bound its depth, size and field types before showing it. */
export function sanitizeTopology(value: unknown, depth: number): TopologyNode {
  if (!isRecord(value) || !Array.isArray(value.links)) throw new BridgeError('INVALID_RESULT', 'The peer sent a malformed topology')
  const name = clip(value.name)
  const origin = clip(value.origin)
  const links: TopologyLink[] = []
  for (const raw of value.links.slice(0, MAX_LINKS_PER_NODE)) {
    if (!isRecord(raw) || (raw.role !== 'host' && raw.role !== 'popup')) continue
    const sessionId = clip(raw.sessionId)
    const status = clip(raw.status)
    if (sessionId === undefined || status === undefined) continue
    const peerOrigin = clip(raw.peerOrigin)
    const health = clip(raw.health)
    links.push({
      role: raw.role,
      sessionId,
      status,
      ...(peerOrigin === undefined ? {} : { peerOrigin }),
      ...(health === undefined ? {} : { health }),
      ...(depth > 0 && raw.node !== undefined ? { node: sanitizeTopology(raw.node, depth - 1) } : {}),
    })
  }
  return { nodeId: clip(value.nodeId) ?? '', ...(name === undefined ? {} : { name }), ...(origin === undefined ? {} : { origin }), links }
}

function depthOf(params: unknown): number {
  const depth = isRecord(params) ? params.depth : undefined
  if (depth === undefined) return DEFAULT_TOPOLOGY_DEPTH
  if (typeof depth !== 'number' || !Number.isInteger(depth) || depth < 0) {
    throw new BridgeError('INVALID_PARAMS', 'depth must be a non-negative integer')
  }
  return Math.min(depth, MAX_TOPOLOGY_DEPTH)
}

export class NodeCore implements BridgeNode {
  readonly id = createId()
  readonly name: string | undefined
  readonly origin: string | undefined
  readonly attention: AttentionManager | undefined
  readonly state: SharedStateRegistry
  readonly #links = new Set<LinkController>()
  readonly #detachHooks = new Set<(link: LinkController) => void>()
  readonly #listeners = new Set<(event: TraceEvent) => void>()
  readonly #trace: TraceEvent[] = []
  readonly #traceLimit: number
  readonly #topology: NonNullable<BridgeNodeOptions['topology']>
  readonly #extensions = new Map<string, ExtensionHandler>()
  readonly #notifications = new Map<string, NotificationHandler>()
  readonly #ownsAttention: boolean

  constructor(options: BridgeNodeOptions = {}) {
    this.name = options.name
    this.origin = options.origin ?? (typeof location === 'undefined' ? undefined : location.origin)
    this.#topology = options.topology ?? false
    this.#traceLimit = options.traceBuffer ?? DEFAULT_TRACE_BUFFER
    const attention = options.attention
    this.#ownsAttention = attention !== undefined && !('handle' in attention)
    this.attention = attention === undefined ? undefined : 'handle' in attention ? attention : createAttentionManager(attention)
    this.state = new SharedStateRegistry(this)
  }

  get links(): readonly PeerLink[] {
    return [...this.#links]
  }

  // ---- used by sessions and runtimes -----------------------------------------------------------

  addLink(link: LinkController): void {
    this.#links.add(link)
    this.emit({ type: 'link', sessionId: link.sessionId, role: link.role, status: link.status })
  }

  removeLink(link: LinkController): void {
    this.#links.delete(link)
  }

  onLinkDetached(hook: (link: LinkController) => void): void {
    this.#detachHooks.add(hook)
  }

  linkDetached(link: LinkController): void {
    for (const hook of [...this.#detachHooks]) hook(link)
  }

  linkChanged(link: LinkController): void {
    this.emit({ type: 'link', sessionId: link.sessionId, role: link.role, status: link.status })
  }

  traceRpc(link: LinkController, event: RpcTrace): void {
    if (QUIET_METHODS.has(event.method)) return
    this.emit(
      event.kind === 'call'
        ? { type: 'call', sessionId: link.sessionId, role: link.role, direction: event.direction, method: event.method, durationMs: event.durationMs, ...(event.error === undefined ? {} : { error: event.error }) }
        : { type: 'notification', sessionId: link.sessionId, role: link.role, direction: event.direction, method: event.method },
    )
  }

  emit(event: TraceInput): void {
    const stamped = { ...event, at: Date.now(), nodeId: this.id } as TraceEvent
    this.#trace.push(stamped)
    if (this.#trace.length > this.#traceLimit) this.#trace.splice(0, this.#trace.length - this.#traceLimit)
    for (const listener of [...this.#listeners]) {
      try {
        listener(stamped)
      } catch {
        // An observer must not break the bridge.
      }
    }
  }

  /** Registers a `bridge.*` method every link of this node answers (shared state, ...). */
  extend(method: string, handler: ExtensionHandler): void {
    this.#extensions.set(method, handler)
  }

  extendNotification(method: string, handler: NotificationHandler): void {
    this.#notifications.set(method, handler)
  }

  resolveExtension(link: LinkController, method: string): RpcRegistration | undefined {
    if (method === TOPOLOGY_METHOD) {
      if (!this.#exposesTopology(link)) return undefined
      return { handler: (params: unknown, context: HandlerContext) => this.#describe(depthOf(params), link, context.signal) }
    }
    const handler = this.#extensions.get(method)
    return handler === undefined ? undefined : { handler: (params: unknown, context: HandlerContext) => handler(link, params, context) }
  }

  handleExtensionNotification(link: LinkController, method: string, params: unknown): void {
    this.#notifications.get(method)?.(link, params)
  }

  // ---- public ----------------------------------------------------------------------------------

  topology(options: { depth?: number; signal?: AbortSignal } = {}): Promise<TopologyNode> {
    return this.#describe(Math.min(options.depth ?? DEFAULT_TOPOLOGY_DEPTH, MAX_TOPOLOGY_DEPTH), undefined, options.signal)
  }

  inspect(): NodeSnapshot {
    return {
      nodeId: this.id,
      ...(this.name === undefined ? {} : { name: this.name }),
      ...(this.origin === undefined ? {} : { origin: this.origin }),
      at: Date.now(),
      links: [...this.#links].map(link => ({
        role: link.role,
        sessionId: link.sessionId,
        ...(link.peerOrigin === undefined ? {} : { peerOrigin: link.peerOrigin }),
        status: link.status,
        ...(link.health === undefined ? {} : { health: link.health }),
        connected: link.connected,
        pendingCalls: link.pending,
      })),
      trace: [...this.#trace],
    }
  }

  onTrace(listener: (event: TraceEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  dispose(): void {
    if (this.#ownsAttention) this.attention?.dispose()
    this.#listeners.clear()
    this.#extensions.clear()
    this.#notifications.clear()
  }

  #exposesTopology(link: LinkController): boolean {
    return typeof this.#topology === 'function' ? this.#topology(link) : this.#topology
  }

  async #describe(depth: number, asker: LinkController | undefined, signal?: AbortSignal): Promise<TopologyNode> {
    const links = await Promise.all(
      [...this.#links].map(async (link): Promise<TopologyLink> => {
        const entry: TopologyLink = {
          role: link.role,
          sessionId: link.sessionId,
          ...(link.peerOrigin === undefined ? {} : { peerOrigin: link.peerOrigin }),
          status: link.status,
          ...(link.health === undefined ? {} : { health: link.health }),
        }
        // Only downward, and never back into the asker: a tree walk, not a loop.
        if (depth > 0 && link.role === 'popup' && link !== asker && link.connected) {
          try {
            const reply = await link.call(TOPOLOGY_METHOD, { depth: depth - 1 }, {
              timeoutMs: TOPOLOGY_CALL_TIMEOUT_MS,
              ...(signal === undefined ? {} : { signal }),
            })
            entry.node = sanitizeTopology(reply, depth - 1)
          } catch {
            // The popup does not expose its neighbours, or did not answer in time: leave it a leaf.
          }
        }
        return entry
      }),
    )
    return {
      nodeId: this.id,
      ...(this.name === undefined ? {} : { name: this.name }),
      ...(this.origin === undefined ? {} : { origin: this.origin }),
      links,
    }
  }
}

export function createBridgeNode(options: BridgeNodeOptions = {}): BridgeNode {
  return new NodeCore(options)
}

/** Narrows the public type to the implementation a session or runtime needs. */
export function coreOf(node: BridgeNode | undefined): NodeCore | undefined {
  if (node === undefined) return undefined
  if (!(node instanceof NodeCore)) throw new TypeError('node must come from createBridgeNode()')
  return node
}
