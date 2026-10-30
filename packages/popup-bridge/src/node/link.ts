/**
 * A link is one bridge connection seen from either end: a popup the page opened (`role: 'popup'`)
 * or the host that opened the page (`role: 'host'`). Hosts and popups expose the same surface
 * here, so a page that is both (popup A of the root, host of popup B) treats both neighbours alike
 * and the two ends of a link can ask each other for attention with one interface.
 */
import type { RetryEvent } from '../backoff.js'
import type { CallOptions } from '../contract/define.js'
import { BridgeError, isBridgeError } from '../protocol/errors.js'
import { NO_FEATURES, type FeatureSet } from '../protocol/features.js'
import { createId } from '../protocol/messages.js'
import type { SecurityEvent } from '../protocol/security.js'
import type { RpcRegistration, RpcTrace } from '../rpc/endpoint.js'
import type { AttentionSource } from '../attention/manager.js'
import {
  ATTENTION_ACK_METHOD,
  ATTENTION_METHOD,
  type AttentionRequest,
  type AttentionResult,
} from '../attention/types.js'
import { createReplica, type ReplicaState, type SharedStateDefinition } from '../state/shared.js'
import type { NodeCore, TraceInput } from './node.js'

/** What the peer on the other end is: this page's `host`, or a `popup` this page opened. */
export type LinkRole = 'host' | 'popup'

export type AttentionRequestOptions = {
  signal?: AbortSignal
  /** How long to wait for the peer's answer. Default 5 000 ms. */
  timeoutMs?: number
}

export type AttentionWaitOptions = AttentionRequestOptions & {
  /** How long to wait for the user to see the request. Default 60 000 ms. */
  acknowledgeTimeoutMs?: number
}

export interface PeerAttention {
  /**
   * Asks the peer to draw the user's attention. The peer's policy decides what happens; read
   * `appliedEffects` and `skipped` in the answer. A peer without an attention manager answers
   * `{ accepted: false, reason: 'unsupported' }`.
   */
  request(request?: AttentionRequest, options?: AttentionRequestOptions): Promise<AttentionResult>
  /** Like `request`, and also waits until the peer reports that the user has seen it. */
  requestAndWait(request?: AttentionRequest, options?: AttentionWaitOptions): Promise<{ result: AttentionResult; acknowledged: boolean }>
  /**
   * Raises the peer's window from this window, without involving the peer. Call it directly from
   * a click handler: browsers refuse focus changes that are not backed by a user gesture.
   */
  focus(): void
  /** Fires when the peer reports that the user has seen an earlier request. */
  onAcknowledge(listener: (id: string) => void): () => void
}

export interface PeerLink {
  readonly role: LinkRole
  readonly sessionId: string
  readonly peerOrigin: string | undefined
  /** The lifecycle state of the owning session or popup runtime (`READY`, `CLOSED`, ...). */
  readonly status: string
  /** True while a transport is attached, i.e. calls can go out. */
  readonly connected: boolean
  readonly attention: PeerAttention
  /**
   * Optional protocol features agreed with this peer; empty until the connection is negotiated and
   * after it ends. A popup's runtime knows the set from its INITIALIZING state on, a host (and the
   * host-role link of a popup) only once the connection is READY.
   */
  readonly features: FeatureSet
  /**
   * A live, read-mostly copy of a state the peer owns (`node.state.own(definition)` on its side).
   * It follows the peer across reloads and reconnects.
   */
  replicate<T>(definition: SharedStateDefinition<T>): ReplicaState<T>
  /** Calls a method of the peer by name, without contract typing. Meant for `bridge.*` extensions. */
  call(method: string, params?: unknown, options?: CallOptions): Promise<unknown>
}

/** The sending half of a connected transport. */
export type LinkTransport = {
  call(method: string, params: unknown, options?: CallOptions): Promise<unknown>
  notify(method: string, params: unknown): void
  readonly pending: number
  /** Read on every access: the agreed set can be settled after the transport attached. */
  readonly features: FeatureSet
}

export type LinkInit = {
  role: LinkRole
  sessionId: string
  peerOrigin?: string
  readStatus: () => string
  readHealth?: () => string
  focusPeer: () => void
  node?: NodeCore | undefined
}

const DEFAULT_ATTENTION_TIMEOUT_MS = 5_000
const DEFAULT_ACKNOWLEDGE_TIMEOUT_MS = 60_000

export class LinkController implements PeerLink {
  readonly role: LinkRole
  readonly sessionId: string
  peerOrigin: string | undefined
  readonly attention: PeerAttention
  readonly #init: LinkInit
  readonly #node: NodeCore | undefined
  readonly #ackListeners = new Set<(id: string) => void>()
  readonly #attachListeners = new Set<() => void>()
  readonly #detachListeners = new Set<() => void>()
  readonly #notificationListeners = new Map<string, Set<(params: unknown) => void>>()
  #transport: LinkTransport | undefined
  #registered = false

  constructor(init: LinkInit) {
    this.#init = init
    this.role = init.role
    this.sessionId = init.sessionId
    this.peerOrigin = init.peerOrigin
    this.#node = init.node
    this.attention = this.#createAttention()
  }

  get status(): string {
    return this.#init.readStatus()
  }

  get health(): string | undefined {
    return this.#init.readHealth?.()
  }

  get connected(): boolean {
    return this.#transport !== undefined
  }

  get pending(): number {
    return this.#transport?.pending ?? 0
  }

  get features(): FeatureSet {
    return this.#transport?.features ?? NO_FEATURES
  }

  call(method: string, params?: unknown, options?: CallOptions): Promise<unknown> {
    const transport = this.#transport
    if (transport === undefined) {
      return Promise.reject(new BridgeError('SESSION_NOT_READY', `The link is ${this.status}; calls need a connection`))
    }
    return transport.call(method, params, options)
  }

  // ---- lifecycle, driven by the owning session or runtime -------------------------------------

  /** Makes the link known to its node. Sessions register at once, popups once they know their session. */
  register(): void {
    if (this.#registered) return
    this.#registered = true
    this.#node?.addLink(this)
  }

  attach(transport: LinkTransport): void {
    this.#transport = transport
    for (const listener of [...this.#attachListeners]) listener()
  }

  detach(): void {
    if (this.#transport === undefined) return
    this.#transport = undefined
    this.#node?.linkDetached(this)
    for (const listener of [...this.#detachListeners]) listener()
  }

  dispose(): void {
    this.detach()
    this.#ackListeners.clear()
    this.#attachListeners.clear()
    this.#detachListeners.clear()
    this.#notificationListeners.clear()
    if (this.#registered) this.#node?.removeLink(this)
    this.#registered = false
  }

  /** The owner's lifecycle state changed. */
  changed(): void {
    if (this.#registered) this.#node?.linkChanged(this)
  }

  // ---- inbound ---------------------------------------------------------------------------------

  resolve(method: string): RpcRegistration | undefined {
    const node = this.#node
    if (node === undefined) return undefined
    if (method === ATTENTION_METHOD) {
      const manager = node.attention
      if (manager === undefined) return undefined
      return {
        handler: async (params: unknown) => {
          const result = await manager.handle(params, this.#source(), id => this.#acknowledge(id))
          node.emit({ type: 'attention', sessionId: this.sessionId, role: this.role, direction: 'in', result })
          return result
        },
      }
    }
    return node.resolveExtension(this, method)
  }

  /** Runs `listener` every time a transport is attached, i.e. on connect and after a reconnect. */
  onAttach(listener: () => void): () => void {
    this.#attachListeners.add(listener)
    return () => {
      this.#attachListeners.delete(listener)
    }
  }

  onDetach(listener: () => void): () => void {
    this.#detachListeners.add(listener)
    return () => {
      this.#detachListeners.delete(listener)
    }
  }

  /** Receives a peer notification by method name. Used by features that own their notifications. */
  listen(method: string, listener: (params: unknown) => void): () => void {
    let set = this.#notificationListeners.get(method)
    if (set === undefined) {
      set = new Set()
      this.#notificationListeners.set(method, set)
    }
    set.add(listener)
    return () => {
      set.delete(listener)
    }
  }

  trace(event: TraceInput): void {
    this.#node?.emit(event)
  }

  replicate<T>(definition: SharedStateDefinition<T>): ReplicaState<T> {
    return createReplica(this, definition)
  }

  handleNotification(method: string, params: unknown): void {
    const listeners = this.#notificationListeners.get(method)
    if (listeners !== undefined) {
      for (const listener of [...listeners]) listener(params)
      return
    }
    if (method === ATTENTION_ACK_METHOD) {
      const id = typeof params === 'object' && params !== null ? (params as { id?: unknown }).id : undefined
      if (typeof id === 'string') for (const listener of [...this.#ackListeners]) listener(id)
      return
    }
    this.#node?.handleExtensionNotification(this, method, params)
  }

  traceRpc(event: RpcTrace): void {
    this.#node?.traceRpc(this, event)
  }

  traceRetry(event: RetryEvent): void {
    this.#node?.emit({
      type: 'retry',
      sessionId: this.sessionId,
      role: this.role,
      target: event.target,
      phase: event.phase,
      attempt: event.attempt,
      ...(event.delayMs === undefined ? {} : { delayMs: event.delayMs }),
      ...(event.event === undefined ? {} : { event: event.event }),
      ...(event.error === undefined ? {} : { error: event.error.code }),
    })
  }

  traceSecurity(event: SecurityEvent): void {
    this.#node?.emit({ type: 'security', sessionId: this.sessionId, role: this.role, event })
  }

  focusPeer(): void {
    this.#init.focusPeer()
  }

  notify(method: string, params: unknown): void {
    this.#transport?.notify(method, params)
  }

  #source(): AttentionSource {
    return { sessionId: this.sessionId, role: this.role, origin: this.peerOrigin }
  }

  #acknowledge(id: string): void {
    try {
      this.#transport?.notify(ATTENTION_ACK_METHOD, { id })
    } catch {
      // The link ended before the user came back; nobody is waiting any more.
    }
  }

  // ---- outbound attention ----------------------------------------------------------------------

  #createAttention(): PeerAttention {
    const link = this
    const send = async (request: AttentionRequest, id: string, options: AttentionRequestOptions): Promise<AttentionResult> => {
      let result: AttentionResult
      try {
        result = (await link.call(
          ATTENTION_METHOD,
          { ...request, id },
          { timeoutMs: options.timeoutMs ?? DEFAULT_ATTENTION_TIMEOUT_MS, ...(options.signal === undefined ? {} : { signal: options.signal }) },
        )) as AttentionResult
      } catch (error) {
        if (!isBridgeError(error) || error.code !== 'METHOD_NOT_FOUND') throw error
        result = { id, accepted: false, appliedEffects: [], skipped: [], reason: 'unsupported' }
      }
      link.#node?.emit({ type: 'attention', sessionId: link.sessionId, role: link.role, direction: 'out', result })
      return result
    }
    return {
      request: (request = {}, options = {}) => send(request, createId(), options),
      async requestAndWait(request = {}, options = {}) {
        const id = createId()
        let seen!: () => void
        const acknowledged = new Promise<boolean>(resolve => {
          seen = () => resolve(true)
        })
        // Listen first: a page that is already in front acknowledges before its answer arrives.
        const stop = link.attention.onAcknowledge(received => {
          if (received === id) seen()
        })
        try {
          const result = await send(request, id, options)
          if (!result.accepted) return { result, acknowledged: false }
          const timeoutMs = options.acknowledgeTimeoutMs ?? DEFAULT_ACKNOWLEDGE_TIMEOUT_MS
          let timer: ReturnType<typeof setTimeout> | undefined
          let onAbort: (() => void) | undefined
          const gaveUp = new Promise<boolean>(resolve => {
            timer = setTimeout(() => resolve(false), timeoutMs)
            onAbort = () => resolve(false)
            options.signal?.addEventListener('abort', onAbort, { once: true })
          })
          try {
            return { result, acknowledged: await Promise.race([acknowledged, gaveUp]) }
          } finally {
            clearTimeout(timer)
            if (onAbort !== undefined) options.signal?.removeEventListener('abort', onAbort)
          }
        } finally {
          stop()
        }
      },
      focus: () => link.focusPeer(),
      onAcknowledge(listener) {
        link.#ackListeners.add(listener)
        return () => {
          link.#ackListeners.delete(listener)
        }
      },
    }
  }
}
