/**
 * Host side of a popup session: opens the window, runs the verified handshake, then exposes
 * typed `call` / `subscribe` / `close` on top of the symmetric RPC endpoint.
 *
 *   CREATED → OPENING → WAITING_HELLO → CONNECTING → INITIALIZING → READY → CLOSING → CLOSED
 *                                                                              (FAILED before READY)
 * A popup reload sends the session back to WAITING_HELLO and on to READY again with a new port.
 */
import type {
  AnyContract,
  CallArgs,
  CallOptions,
  Handlers,
  EventName,
  InitOf,
  InputOf,
  MethodName,
  OutputOf,
  PayloadOf,
  RpcApi,
} from '../contract/define.js'
import type { PopupDefinition } from '../contract/definition.js'
import { createMethodCaller, createRpcApi } from '../contract/client.js'
import { HandlerRegistry } from '../contract/registry.js'
import { runSchema } from '../contract/schema.js'
import { resolveBackoff, type BackoffOptions, type ResolvedBackoff, type RetryEvent } from '../backoff.js'
import { MAX_TIMER_DELAY_MS, systemClock, type HostEnvironment, type IncomingWindowMessage, type PeerHandle } from '../env.js'
import { BridgeError, isBridgeError, toBridgeError } from '../protocol/errors.js'
import {
  DEFAULT_FEATURES,
  NO_FEATURES,
  assertFeatureIds,
  createFeatureSet,
  negotiateFeatures,
  type FeatureSet,
} from '../protocol/features.js'
import {
  attachSession,
  createId,
  isBridgeMessage,
  parseBridgeMessage,
  type BridgeMessage,
  type Capability,
  type CloseReason,
  type ConnectMessage,
  type HelloMessage,
  type ReadyMessage,
} from '../protocol/messages.js'
import type { SecurityListener } from '../protocol/security.js'
import { negotiateProtocol, satisfies } from '../protocol/version.js'
import { fromMessagePort } from '../rpc/channel.js'
import { createRpcEndpoint, type EndpointLimits, type RpcEndpoint, type RpcRegistration } from '../rpc/endpoint.js'
import type { RpcChannel } from '../rpc/channel.js'
import { LinkController, type PeerAttention, type PeerLink } from '../node/link.js'
import { coreOf, type BridgeNode } from '../node/node.js'
import { Subscriptions, type EventMeta, type ResyncReport } from './subscriptions.js'

export type SessionState =
  | 'CREATED'
  | 'OPENING'
  | 'WAITING_HELLO'
  | 'CONNECTING'
  | 'INITIALIZING'
  | 'READY'
  | 'CLOSING'
  | 'CLOSED'
  | 'FAILED'

export type CloseInfo = {
  reason: 'host-close' | 'popup-close' | 'window-closed' | 'error'
  error?: BridgeError
}

export type HostAuthorizeCall = { method: string; permission: string | undefined; sessionId: string }

export type HostOpenOptions<C extends AnyContract = AnyContract> = {
  /** Sent to the popup with `bridge.connect`; validated against `contract.init` before the window opens. */
  init?: InitOf<C>
  /** Methods the popup may call on the host. Only what is listed here is reachable. */
  host?: Partial<Handlers<C['host']>>
  /** Time allowed for HELLO → READY. Default 15 000 ms. */
  handshakeTimeoutMs?: number
  /** Default RPC timeout. Default 30 000 ms. */
  rpcTimeoutMs?: number
  signal?: AbortSignal
  windowName?: string
  windowFeatures?: string
  /** Close the popup window together with the session. Default `true`. */
  closeWindowOnClose?: boolean
  /** Re-establish the connection when the popup reloads. Default `true`. */
  allowReconnect?: boolean
  /** Return `false` or throw to refuse a popup → host call. */
  authorize?: (call: HostAuthorizeCall) => boolean | void | Promise<boolean | void>
  onSecurityEvent?: SecurityListener
  /** Validate params/results/payloads against the contract schemas. Default `true`. */
  validate?: boolean
  /** How often to check whether the popup window was closed. Default 500 ms. */
  closedPollMs?: number
  /**
   * Liveness probe. A `bridge.ping` goes out every `intervalMs` (default 5 000); a popup that does not
   * answer within `timeoutMs` (default 10 000), e.g. because its page hung or was frozen, ends the
   * session with `PEER_UNRESPONSIVE` instead of leaving every call to wait for its own timeout.
   * `false` turns it off.
   */
  heartbeat?: false | { intervalMs?: number; timeoutMs?: number }
  /** Caps on what the popup may impose. Defaults: 256 requests in flight, 5 000 notifications per second. */
  limits?: EndpointLimits
  onError?: (error: unknown) => void
  /** The page's node: shares its attention policy, topology and trace with this session. */
  node?: BridgeNode
  /**
   * Optional protocol features to offer the popup; the session uses those both sides offer.
   * Defaults to `DEFAULT_FEATURES`; `[]` behaves like a host that predates features. Validated
   * before any window opens.
   */
  features?: readonly string[]
  /** Tuning of event replay, which applies only when `events.replay` was agreed. */
  replay?: HostReplayOptions
  /**
   * How events are subscribed again after the popup reloaded or was restored: a `bridge.subscribe`
   * that times out, is refused as overloaded or fails inside the popup is retried with exponential
   * backoff and jitter, `maxRetries` times (default 4, starting at 250 ms and capped at 4 000 ms).
   * `timeoutMs` bounds each attempt (default 10 000). `false` makes a single attempt. Progress is
   * reported through the session's `retry` event. Validated before any window opens.
   */
  resubscribeRetry?: false | (BackoffOptions & { timeoutMs?: number })
}

export type HostReplayOptions = {
  /** Time allowed for one replay request. Default 5 000 ms. */
  timeoutMs?: number
  /** Live events kept while an event catches up; the oldest is dropped beyond that. Default 256. */
  maxHeld?: number
}

/** What a `reconnect` listener learns about the subscriptions it had. */
export type ReconnectInfo = {
  /** Events subscribed again on the new connection. */
  resubscribed: string[]
  /** Events that could not be subscribed again; their handlers stay registered. */
  failed: string[]
  /** How each resubscribed event came out; replayed events were delivered before this fires. */
  replay: ResyncReport
}

export type SessionHealth = 'ok' | 'unresponsive'

export interface SessionEvents {
  state: (state: SessionState) => void
  /**
   * The popup reloaded or was restored and the session is READY again. Events that the popup
   * still buffered were replayed first; `info.replay` says which events still need a snapshot.
   */
  reconnect: (info: ReconnectInfo) => void
  /**
   * A retry of resubscribing an event after a reconnect is waiting, being made, or has ended. The
   * `reconnect` event fires after the last of them settled.
   */
  retry: (event: RetryEvent) => void
  /** A heartbeat went unanswered (`unresponsive`) or was answered again (`ok`, with the round trip in ms). */
  health: (health: SessionHealth, rttMs?: number) => void
  close: (info: CloseInfo) => void
}

export interface PopupSession<C extends AnyContract = AnyContract> {
  readonly sessionId: string
  readonly state: SessionState
  readonly protocolVersion: string
  /** Capabilities the popup advertised in READY. */
  readonly capabilities: readonly Capability[]
  /** Optional protocol features both sides agreed on; empty until READY and after the connection ends. */
  readonly features: FeatureSet
  /** `unresponsive` while a heartbeat is overdue. */
  readonly health: SessionHealth
  /** Asks the popup to draw the user's attention, or raises its window. */
  readonly attention: PeerAttention
  /** This session as a link of the page's node; the same surface a popup has for its host. */
  readonly link: PeerLink
  /** Nested typed client: `session.api.asset.select({ multiple: false })`. */
  readonly api: RpcApi<C['methods']>
  call<K extends MethodName<C['methods']>>(
    name: K,
    ...args: CallArgs<InputOf<C['methods'][K]>>
  ): Promise<OutputOf<C['methods'][K]>>
  subscribe<K extends EventName<C['events']>>(
    name: K,
    handler: (payload: PayloadOf<C['events'][K]>, meta: EventMeta) => void,
  ): Promise<() => Promise<void>>
  on<E extends keyof SessionEvents>(event: E, listener: SessionEvents[E]): () => void
  /**
   * Asks the popup again for what a subscribed event (default: every one) is missing and delivers
   * it, when the popup agreed to `events.replay`. A dropped last event shows as a gap only when
   * another follows; calling this finds it. Resolves with how each event came out.
   */
  resync(name?: EventName<C['events']>): Promise<ResyncReport>
  /** Resolves (never rejects) when the session ends. */
  readonly closed: Promise<CloseInfo>
  close(): Promise<CloseInfo>
}

/** The members of a session that do not depend on its contract. */
export type SessionHandle = Pick<PopupSession, 'sessionId' | 'state' | 'protocolVersion' | 'capabilities' | 'features' | 'closed' | 'close' | 'on' | 'attention' | 'link'>

export type ContractOf<D> = D extends { contract: infer C extends AnyContract } ? C : AnyContract

type Transport = {
  endpoint: RpcEndpoint
  channel: RpcChannel
  instanceId: string
  unsubscribeControl: () => void
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 15_000
const DEFAULT_RPC_TIMEOUT_MS = 30_000
const DEFAULT_CLOSED_POLL_MS = 500
const DEFAULT_HEARTBEAT = { intervalMs: 5_000, timeoutMs: 10_000 }
const DEFAULT_LIMITS: EndpointLimits = { maxInflight: 256, maxNotificationsPerSecond: 5_000 }
const DEFAULT_RESUBSCRIBE_RETRIES = 4
const DEFAULT_RESUBSCRIBE_TIMEOUT_MS = 10_000
/** Dropped popup instances remembered, so a late HELLO of one of them is recognized. */
const RETIRED_INSTANCES = 8

function assertReplayOptions(replay: HostReplayOptions | undefined): void {
  if (replay === undefined) return
  for (const [key, value] of [['timeoutMs', replay.timeoutMs], ['maxHeld', replay.maxHeld]] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
      throw new TypeError(`replay.${key} must be a positive integer, got ${String(value)}`)
    }
  }
  if (replay.timeoutMs !== undefined && replay.timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new TypeError(`replay.timeoutMs must be at most ${MAX_TIMER_DELAY_MS}, got ${String(replay.timeoutMs)}`)
  }
}

function resolveResubscribeRetry(option: HostOpenOptions['resubscribeRetry']): { policy: ResolvedBackoff; timeoutMs: number } | undefined {
  if (option === false) return undefined
  const policy = resolveBackoff(option, DEFAULT_RESUBSCRIBE_RETRIES, 'resubscribeRetry')
  const timeoutMs = option?.timeoutMs ?? DEFAULT_RESUBSCRIBE_TIMEOUT_MS
  if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new TypeError(`resubscribeRetry.timeoutMs must be a positive integer of at most ${MAX_TIMER_DELAY_MS}, got ${String(timeoutMs)}`)
  }
  return policy === undefined ? undefined : { policy, timeoutMs }
}

export function openPopupSession<D extends PopupDefinition>(
  env: HostEnvironment,
  definition: D,
  options?: HostOpenOptions<ContractOf<D>>,
): Promise<PopupSession<ContractOf<D>>>
export function openPopupSession(env: HostEnvironment, definition: PopupDefinition, options: HostOpenOptions = {}): Promise<PopupSession> {
  try {
    return start(env, definition, options)
  } catch (error) {
    return Promise.reject(error)
  }
}

/**
 * Everything up to `env.open` runs synchronously, so a call made inside a click handler keeps the
 * user activation that browsers require to allow the popup.
 */
function start(env: HostEnvironment, definition: PopupDefinition, options: HostOpenOptions): Promise<PopupSession> {
  const contract = definition.contract
  const sessionId = createId()
  const clock = env.clock ?? systemClock
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS
  const rpcTimeoutMs = options.rpcTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS
  const allowReconnect = options.allowReconnect !== false
  const validate = options.validate !== false
  const reportError = options.onError ?? ((error: unknown) => console.error('[popup-bridge]', error))
  let activeLink: LinkController | undefined
  const security: SecurityListener = event => {
    activeLink?.traceSecurity({ sessionId, ...event })
    options.onSecurityEvent?.({ sessionId, ...event })
  }

  if (options.signal?.aborted) throw new BridgeError('CANCELLED', 'Opening the popup was cancelled')

  const ownFeatures = options.features ?? DEFAULT_FEATURES
  assertFeatureIds(ownFeatures)
  assertReplayOptions(options.replay)
  const resubscribeRetry = resolveResubscribeRetry(options.resubscribeRetry)

  const init =
    validate && contract?.init !== undefined
      ? runSchema(contract.init, options.init, 'INIT_INVALID', 'init')
      : options.init

  const registry = new HandlerRegistry(contract?.host, () => sessionId)
  for (const [name, handler] of Object.entries(options.host ?? {})) {
    if (contract === undefined) {
      registry.registerFeature({ name, version: '1.0.0', handler: handler as RpcRegistration['handler'] })
    } else {
      registry.register(name, handler as never)
    }
  }
  const pingRegistration: RpcRegistration = { handler: () => ({ now: clock.now() }) }

  let state: SessionState = 'CREATED'
  const stateListeners = new Set<(state: SessionState) => void>()
  const reconnectListeners = new Set<(info: ReconnectInfo) => void>()
  const retryListeners = new Set<(event: RetryEvent) => void>()
  const healthListeners = new Set<(health: SessionHealth, rttMs?: number) => void>()
  let health: SessionHealth = 'ok'
  let cancelHeartbeat: (() => void) | undefined
  const closeListeners = new Set<(info: CloseInfo) => void>()
  const setState = (next: SessionState) => {
    if (state === next) return
    state = next
    activeLink?.changed()
    for (const listener of [...stateListeners]) listener(next)
  }

  let transport: Transport | undefined
  // Instances of the popup this session stopped talking to, oldest first.
  const retiredInstances: string[] = []
  let protocolVersion = ''
  let capabilities: readonly Capability[] = []
  // Offered by both sides after CONNECT; becomes `features` once the popup's READY confirms it.
  let pendingFeatures: readonly string[] = []
  let features: FeatureSet = NO_FEATURES
  let everReady = false
  let cancelHandshakeTimer: (() => void) | undefined
  let cancelClosedPoll: (() => void) | undefined
  let finished = false
  let resolveOpen!: (session: PopupSession) => void
  let rejectOpen!: (error: BridgeError) => void
  let resolveClosed!: (info: CloseInfo) => void
  const closed = new Promise<CloseInfo>(resolve => {
    resolveClosed = resolve
  })
  const opened = new Promise<PopupSession>((resolve, reject) => {
    resolveOpen = resolve
    rejectOpen = reject
  })

  setState('OPENING')
  const url = attachSession(definition.url, sessionId)
  let handle: PeerHandle | null
  const unlisten = env.listen(onWindowMessage)
  try {
    handle = env.open(url, {
      ...(options.windowName === undefined ? {} : { name: options.windowName }),
      ...(options.windowFeatures === undefined ? {} : { features: options.windowFeatures }),
    })
  } catch (error) {
    unlisten()
    throw error
  }
  if (handle === null) {
    unlisten()
    setState('FAILED')
    throw new BridgeError('POPUP_BLOCKED', 'The browser blocked the popup; open it from a user click', {
      data: { url: definition.url },
    })
  }
  const peer: PeerHandle = handle
  const link = new LinkController({
    role: 'popup',
    sessionId,
    peerOrigin: definition.expectedOrigin,
    readStatus: () => state,
    readHealth: () => health,
    focusPeer: () => peer.focus(),
    node: coreOf(options.node),
  })
  activeLink = link
  link.register()
  setState('WAITING_HELLO')

  // ---- session object ------------------------------------------------------------------------

  const subscriptions = new Subscriptions({
    call: (method, params, callOptions) => invoke(method, params, callOptions ?? {}),
    validate: (name, payload) => {
      const spec = contract?.events[name]
      return validate && spec?.payload !== undefined ? runSchema(spec.payload, payload, 'INVALID_RESULT', `Payload of ${name}`) : payload
    },
    onHandlerError: reportError,
    features: () => features,
    clock,
    ...(resubscribeRetry === undefined ? {} : { retry: resubscribeRetry }),
    onRetry: event => {
      link.traceRetry(event)
      for (const listener of [...retryListeners]) {
        try {
          listener(event)
        } catch (error) {
          reportError(error)
        }
      }
    },
    limits: {
      ...(options.replay?.timeoutMs === undefined ? {} : { replayTimeoutMs: options.replay.timeoutMs }),
      ...(options.replay?.maxHeld === undefined ? {} : { maxHeld: options.replay.maxHeld }),
    },
  })

  function invoke(method: string, params: unknown, callOptions: CallOptions): Promise<unknown> {
    if (state !== 'READY' || transport === undefined) {
      return Promise.reject(new BridgeError('SESSION_NOT_READY', `The session is ${state}; calls need READY`, { data: { state } }))
    }
    return transport.endpoint.call(method, params, callOptions)
  }

  const call = createMethodCaller(contract?.methods, invoke, { validate, defaultTimeoutMs: rpcTimeoutMs })

  const session: PopupSession = {
    sessionId,
    get state() {
      return state
    },
    get protocolVersion() {
      return protocolVersion
    },
    get capabilities() {
      return capabilities
    },
    get features() {
      return features
    },
    get health() {
      return health
    },
    attention: link.attention,
    link,
    api: createRpcApi(contract?.methods ?? {}, call),
    call: ((name: string, params?: unknown, callOptions?: CallOptions) => call(name, params, callOptions)) as PopupSession['call'],
    subscribe: ((name: string, handler: (payload: unknown, meta: EventMeta) => void) => {
      if (contract !== undefined && contract.events[name] === undefined) return Promise.reject(Subscriptions.unknownEvent(name))
      if (state !== 'READY') {
        return Promise.reject(new BridgeError('SESSION_NOT_READY', `The session is ${state}; subscribe needs READY`))
      }
      return subscriptions.add(name, handler)
    }) as PopupSession['subscribe'],
    resync: (name => {
      if (state !== 'READY') return Promise.reject(new BridgeError('SESSION_NOT_READY', `The session is ${state}; resync needs READY`, { data: { state } }))
      return subscriptions.resync(name)
    }) as PopupSession['resync'],
    on(event, listener) {
      const set = (event === 'state' ? stateListeners : event === 'reconnect' ? reconnectListeners : event === 'retry' ? retryListeners : event === 'health' ? healthListeners : closeListeners) as Set<unknown>
      set.add(listener)
      return () => {
        set.delete(listener)
      }
    },
    closed,
    close: () => {
      terminate('CLOSED', { reason: 'host-close' }, 'host-close')
      return closed
    },
  }

  // ---- lifecycle -----------------------------------------------------------------------------

  const closeWindow = options.closeWindowOnClose !== false
  const unlistenPageHide = env.onPageHide(() => {
    // The host page is going away: tell the popup instead of leaving it waiting.
    if (transport !== undefined) sendControl('host-close')
  })

  cancelClosedPoll = clock.every(options.closedPollMs ?? DEFAULT_CLOSED_POLL_MS, () => {
    if (peer.closed) terminate(everReady ? 'CLOSED' : 'FAILED', { reason: 'window-closed' }, undefined, new BridgeError('SESSION_CLOSED', 'The popup window was closed'))
  })

  const onAbort = () => terminate(everReady ? 'CLOSED' : 'FAILED', { reason: 'host-close' }, 'host-close', new BridgeError('CANCELLED', 'Opening the popup was cancelled'))
  options.signal?.addEventListener('abort', onAbort, { once: true })

  armHandshakeTimer()

  function armHandshakeTimer(): void {
    cancelHandshakeTimer?.()
    cancelHandshakeTimer = clock.after(handshakeTimeoutMs, () => {
      const error = new BridgeError('HANDSHAKE_TIMEOUT', `The popup did not become ready within ${handshakeTimeoutMs}ms`, {
        data: { state, timeoutMs: handshakeTimeoutMs },
      })
      terminate(everReady ? 'CLOSED' : 'FAILED', { reason: 'error', error }, 'error', error)
    })
  }

  function sendControl(reason: CloseReason): void {
    if (transport === undefined) return
    try {
      transport.channel.send({ kind: 'bridge.close', sessionId, instanceId: transport.instanceId, reason })
    } catch {
      // The port is already gone.
    }
  }

  function dropTransport(error: BridgeError): void {
    pendingFeatures = []
    features = NO_FEATURES
    const current = transport
    if (current === undefined) return
    transport = undefined
    retiredInstances.push(current.instanceId)
    if (retiredInstances.length > RETIRED_INSTANCES) retiredInstances.shift()
    link.detach()
    stopHeartbeat()
    current.unsubscribeControl()
    current.endpoint.close(error)
    subscriptions.reset()
  }

  function setHealth(next: SessionHealth, rttMs?: number): void {
    if (health === next && rttMs === undefined) return
    const changed = health !== next
    health = next
    if (changed || rttMs !== undefined) for (const listener of [...healthListeners]) listener(next, rttMs)
  }

  function stopHeartbeat(): void {
    cancelHeartbeat?.()
    cancelHeartbeat = undefined
    health = 'ok'
  }

  function startHeartbeat(): void {
    stopHeartbeat()
    if (options.heartbeat === false || transport === undefined) return
    const intervalMs = options.heartbeat?.intervalMs ?? DEFAULT_HEARTBEAT.intervalMs
    const timeoutMs = options.heartbeat?.timeoutMs ?? DEFAULT_HEARTBEAT.timeoutMs
    const current = transport
    let outstanding = false
    cancelHeartbeat = clock.every(intervalMs, () => {
      if (transport !== current) return
      if (outstanding) {
        setHealth('unresponsive')
        return
      }
      outstanding = true
      const sentAt = clock.now()
      current.endpoint.call('bridge.ping', undefined, { timeoutMs }).then(
        () => {
          outstanding = false
          if (transport === current) setHealth('ok', clock.now() - sentAt)
        },
        (error: unknown) => {
          outstanding = false
          if (transport !== current || !isBridgeError(error) || error.code !== 'RPC_TIMEOUT') return
          fail(new BridgeError('PEER_UNRESPONSIVE', `The popup did not answer a heartbeat within ${timeoutMs}ms`, { data: { timeoutMs } }))
        },
      )
    })
  }

  /** Ends the session. `FAILED` rejects the pending `open()`; `CLOSED` resolves `closed`. */
  function terminate(final: 'CLOSED' | 'FAILED', info: CloseInfo, notify?: CloseReason, error?: BridgeError): void {
    if (finished) return
    finished = true
    setState('CLOSING')
    if (notify !== undefined) sendControl(notify)
    cancelHandshakeTimer?.()
    cancelClosedPoll?.()
    stopHeartbeat()
    options.signal?.removeEventListener('abort', onAbort)
    unlisten()
    unlistenPageHide()
    dropTransport(error ?? info.error ?? new BridgeError('SESSION_CLOSED', 'The session is closed'))
    // Also when there was no transport: retries of a resubscription may still be waiting.
    subscriptions.reset()
    if (closeWindow) {
      try {
        peer.close()
      } catch {
        // Cross-origin close can throw in exotic environments; the session is over regardless.
      }
    }
    const finalInfo: CloseInfo = error !== undefined && info.error === undefined ? { ...info, error } : info
    setState(final)
    link.dispose()
    if (!everReady) rejectOpen(finalInfo.error ?? new BridgeError('SESSION_CLOSED', 'The popup closed before it was ready'))
    for (const listener of [...closeListeners]) listener(finalInfo)
    resolveClosed(finalInfo)
  }

  function fail(error: BridgeError): void {
    terminate(everReady ? 'CLOSED' : 'FAILED', { reason: 'error', error }, 'error', error)
  }

  // ---- bootstrap (window messages) -------------------------------------------------------------

  function onWindowMessage(message: IncomingWindowMessage): void {
    if (finished || !isBridgeMessage(message.data)) return
    // Source and origin come first: nothing from a window that has not proven itself is parsed.
    const claimsSession = (message.data as { sessionId?: unknown }).sessionId === sessionId
    if (!peer.isSource(message.source)) {
      // Other popups of this host talk on the same window; only report impersonation of this session.
      if (claimsSession) security({ type: 'source-mismatch', origin: message.origin, detail: 'bridge message for this session from another window' })
      return
    }
    if (message.origin !== definition.expectedOrigin) {
      security({ type: 'origin-mismatch', origin: message.origin, detail: `expected ${definition.expectedOrigin}` })
      if (looksLikeHello(message.data)) {
        fail(new BridgeError('ORIGIN_MISMATCH', `The popup answered from ${message.origin}, expected ${definition.expectedOrigin}`, {
          data: { origin: message.origin, expected: definition.expectedOrigin },
        }))
      }
      return
    }
    const parsed = parseBridgeMessage(message.data)
    if (parsed === undefined) {
      security({ type: 'malformed-message', origin: message.origin })
      return
    }
    if (parsed.kind === 'bridge.hello') handleHello(parsed)
  }

  /** A HELLO by its envelope only; the rest of an unverified message is not read. */
  function looksLikeHello(data: unknown): boolean {
    const { kind, sessionId: id, instanceId: instance } = data as { kind?: unknown; sessionId?: unknown; instanceId?: unknown }
    return kind === 'bridge.hello' && typeof id === 'string' && typeof instance === 'string'
  }

  function handleHello(hello: HelloMessage): void {
    if (hello.sessionId !== sessionId) {
      security({ type: 'session-mismatch', origin: definition.expectedOrigin, detail: 'hello for another session' })
      return
    }
    // A late HELLO of a page this session already let go (a retry that overtook the page's `unload`
    // on the other channel) must not make the host wait for a page that is no longer there.
    if (retiredInstances.includes(hello.instanceId)) return
    if (transport?.instanceId === hello.instanceId) return // duplicate hello of the connected instance
    if (transport !== undefined) {
      // A new instance id while connected: the popup page was reloaded.
      if (!allowReconnect) {
        terminate(everReady ? 'CLOSED' : 'FAILED', { reason: 'popup-close' }, 'host-close', new BridgeError('SESSION_CLOSED', 'The popup was reloaded and reconnecting is disabled'))
        return
      }
      dropTransport(new BridgeError('SESSION_CLOSED', 'The popup page was reloaded; the call was not completed'))
    }
    connect(hello)
  }

  function connect(hello: HelloMessage): void {
    try {
      protocolVersion = negotiateProtocol(definition.protocolVersions, hello.protocolVersions)
    } catch (error) {
      const refusal = toBridgeError(error)
      try {
        peer.postMessage({ kind: 'bridge.reject', sessionId, instanceId: hello.instanceId, error: refusal.toWire() }, definition.expectedOrigin)
      } catch {
        // Nothing more to do for an unreachable popup.
      }
      fail(refusal)
      return
    }
    pendingFeatures = negotiateFeatures(ownFeatures, hello.features)
    setState('CONNECTING')
    const { port1, port2 } = new MessageChannel()
    const channel = fromMessagePort(port1)
    const endpoint = createRpcEndpoint({
      channel,
      idPrefix: 'h-',
      clock,
      defaultTimeoutMs: rpcTimeoutMs,
      limits: options.limits ?? DEFAULT_LIMITS,
      onLimit: event => security({ type: 'rate-limited', detail: `${event.kind}:${event.method}` }),
      onTrace: event => link.traceRpc(event),
      resolve: name => (name === 'bridge.ping' ? pingRegistration : link.resolve(name) ?? registry.resolve(name)),
      guard: async ({ method, registration }) => {
        let verdict: boolean | void
        try {
          verdict = await options.authorize?.({ method, permission: registration.permission, sessionId })
        } catch (error) {
          security({ type: 'unauthorized-call', detail: method })
          throw isBridgeError(error) ? error : new BridgeError('PERMISSION_DENIED', `Calling ${method} is not permitted`, { cause: error })
        }
        if (verdict === false) {
          security({ type: 'unauthorized-call', detail: method })
          throw new BridgeError('PERMISSION_DENIED', `Calling ${method} is not permitted`)
        }
      },
      onNotification: (method, params) => {
        if (method === 'bridge.event') subscriptions.dispatch(params)
        else link.handleNotification(method, params)
      },
    })
    const unsubscribeControl = channel.subscribe(onControl)
    transport = { endpoint, channel, instanceId: hello.instanceId, unsubscribeControl }
    link.attach({
      call: (method, params, callOptions) => endpoint.call(method, params, callOptions),
      notify: (method, params) => endpoint.notify(method, params),
      get pending() {
        return endpoint.pendingCount
      },
      get features() {
        return features
      },
    })
    const connectMessage: ConnectMessage = {
      kind: 'bridge.connect',
      sessionId,
      instanceId: hello.instanceId,
      protocolVersion,
      init,
      ...(pendingFeatures.length === 0 ? {} : { features: [...pendingFeatures] }),
    }
    try {
      peer.postMessage(connectMessage, definition.expectedOrigin, [port2])
    } catch (error) {
      fail(new BridgeError('INIT_INVALID', 'The init payload could not be sent to the popup', { cause: error }))
      return
    }
    setState('INITIALIZING')
    armHandshakeTimer()
  }

  // ---- control messages (port) ---------------------------------------------------------------

  function onControl(raw: unknown): void {
    const message = parseBridgeMessage(raw)
    if (message === undefined) return
    if (message.sessionId !== sessionId || message.instanceId !== transport?.instanceId) {
      security({ type: 'session-mismatch', detail: `control message ${message.kind}` })
      return
    }
    switch (message.kind) {
      case 'bridge.ready':
        void onReady(message)
        break
      case 'bridge.init-failed':
        fail(new BridgeError(codeOf(message), message.error.message, { data: message.error.data?.data }))
        break
      case 'bridge.close':
        onPopupClose(message)
        break
      default:
        break
    }
  }

  function codeOf(message: Extract<BridgeMessage, { kind: 'bridge.init-failed' }>): string {
    return message.error.data?.code ?? 'INIT_INVALID'
  }

  async function onReady(message: ReadyMessage): Promise<void> {
    if (state !== 'INITIALIZING') return
    const missing = definition.requiredCapabilities.filter(
      required => !message.capabilities.some(cap => cap.name === required.name && (cap.kind ?? 'method') === 'method' && safeSatisfies(cap.version, required.versionRange)),
    )
    if (missing.length > 0) {
      fail(new BridgeError('CAPABILITY_UNAVAILABLE', `The popup lacks required capabilities: ${missing.map(m => `${m.name}@${m.versionRange}`).join(', ')}`, {
        data: { missing, offered: message.capabilities },
      }))
      return
    }
    cancelHandshakeTimer?.()
    capabilities = message.capabilities
    // A popup may confirm fewer features than offered, never more: the intersection decides.
    features = createFeatureSet(negotiateFeatures(pendingFeatures, message.features))
    const reconnect = everReady
    everReady = true
    setState('READY')
    startHeartbeat()
    if (!reconnect) {
      resolveOpen(session)
      return
    }
    const current = transport
    const outcome = await subscriptions.resubscribe()
    // The connection may have ended or been replaced while events were recovered.
    if (finished || transport !== current) return
    const info: ReconnectInfo = { resubscribed: outcome.recovered, failed: outcome.failed, replay: outcome.replay }
    for (const listener of [...reconnectListeners]) {
      try {
        listener(info)
      } catch (error) {
        reportError(error)
      }
    }
  }

  function onPopupClose(message: Extract<BridgeMessage, { kind: 'bridge.close' }>): void {
    if (message.reason === 'unload' && allowReconnect) {
      // Reload or navigation: wait for a new HELLO; the window poll notices a real close.
      dropTransport(new BridgeError('SESSION_CLOSED', 'The popup page is unloading'))
      setState('WAITING_HELLO')
      armHandshakeTimer()
      return
    }
    terminate(everReady ? 'CLOSED' : 'FAILED', { reason: 'popup-close' }, undefined, new BridgeError('SESSION_CLOSED', 'The popup closed the session'))
  }

  return opened
}

function safeSatisfies(version: string, range: string): boolean {
  try {
    return satisfies(version, range)
  } catch {
    return false
  }
}
