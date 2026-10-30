/**
 * Popup side: boots as an ordinary page, connects to the opener, initializes the feature and then
 * serves registered handlers. Feature code only calls `register`, `emit` and `host.call`.
 *
 *   BOOTING → WAITING_CONNECT → INITIALIZING → READY → CLOSED   (FAILED on any error before READY)
 */
import { backoffDelay, createBackoff, resolveBackoff, type Backoff, type BackoffOptions, type RetryEvent } from '../backoff.js'
import { createMethodCaller, createRpcApi } from '../contract/client.js'
import type { AnyContract, CallArgs, EventName, InitOf, InputOf, MethodName, OutputOf, PayloadOf, RpcApi } from '../contract/define.js'
import { HandlerRegistry, type FeatureRegistration } from '../contract/registry.js'
import { runSchema } from '../contract/schema.js'
import { browserPopupEnvironment, systemClock, type IncomingWindowMessage, type PopupEnvironment } from '../env.js'
import { widenCoalesce } from '../events/coalesce.js'
import { REPLAY_METHOD, ReplayBuffer, assertReplayCapacity, buildReplayReply, copyPayload, parseReplayRequest } from '../events/replay.js'
import { LinkController, type PeerAttention, type PeerLink } from '../node/link.js'
import { coreOf, type BridgeNode } from '../node/node.js'
import { BridgeError, toBridgeError } from '../protocol/errors.js'
import {
  DEFAULT_FEATURES,
  FEATURE_EVENTS_COALESCE,
  FEATURE_EVENTS_REPLAY,
  NO_FEATURES,
  assertFeatureIds,
  createFeatureSet,
  isFeatureGated,
  negotiateFeatures,
  type FeatureSet,
} from '../protocol/features.js'
import {
  createId,
  isBridgeMessage,
  parseBridgeMessage,
  readSession,
  type CloseReason,
  type ConnectMessage,
  type HelloMessage,
} from '../protocol/messages.js'
import type { SecurityListener } from '../protocol/security.js'
import { PROTOCOL_VERSION } from '../protocol/version.js'
import { fromMessagePort } from '../rpc/channel.js'
import { createRpcEndpoint, type EndpointLimits, type RpcEndpoint, type RpcRegistration } from '../rpc/endpoint.js'
import type { RpcChannel } from '../rpc/channel.js'
import { EventCoalescer, type CoalescedCommit } from './coalescer.js'

export type PopupState = 'BOOTING' | 'WAITING_CONNECT' | 'INITIALIZING' | 'READY' | 'CLOSED' | 'FAILED'

export type InitContext = {
  sessionId: string
  hostOrigin: string
  protocolVersion: string
  /** Optional protocol features both sides agreed on; already settled while `onInit` runs. */
  features: FeatureSet
  /** Calls the host while still initializing, e.g. to read the current document selection. */
  host: PopupRuntime<AnyContract>['host']
}

export type PopupRuntimeOptions<C extends AnyContract> = {
  contract?: C
  /** Origins allowed to host this popup. Anything else is refused. */
  allowedHostOrigins: readonly string[]
  /** Validates and applies `init`; throw to refuse (reported to the host as `INIT_INVALID`). */
  onInit?: (init: InitOf<C>, context: InitContext) => void | Promise<void>
  /** Return `false` or throw to refuse a host → popup call. Receives the method's `permission` label. */
  authorize?: (call: { method: string; permission: string | undefined; sessionId: string }) => boolean | void | Promise<boolean | void>
  env?: PopupEnvironment
  protocolVersions?: string[]
  /** Time to wait for `bridge.connect`. Default 15 000 ms. */
  handshakeTimeoutMs?: number
  rpcTimeoutMs?: number
  onSecurityEvent?: SecurityListener
  /** Validate params/results/payloads against the contract schemas. Default `true`. */
  validate?: boolean
  /** How often to check that the opener still exists. Default 1 000 ms. */
  openerPollMs?: number
  /** Caps on what the host may impose. Defaults: 256 requests in flight, 5 000 notifications per second. */
  limits?: EndpointLimits
  /**
   * The page's node: shares its attention policy, topology and trace with this runtime. Pass the
   * same node to `createPopupBridge` when this page also opens popups of its own.
   */
  node?: BridgeNode
  /**
   * Optional protocol features to offer the host; the runtime uses those both sides offer.
   * Defaults to `DEFAULT_FEATURES`; `[]` behaves like a popup that predates features. Validated
   * when the runtime is created.
   */
  features?: readonly string[]
  /**
   * Event replay, which needs `events.replay` among `features`. An event keeps its last
   * `capacity` payloads for a host that missed some; an event declares its own capacity with
   * `event({ replay })`, and `capacity` here is the default for events that declare none.
   * Default 0: no history unless the event asks for it.
   */
  replay?: { capacity?: number }
  /**
   * While no host has connected yet, HELLO is sent again with exponential backoff and jitter
   * (`maxRetries` times, default 6, starting at 250 ms and capped at 4 000 ms), so a host that was
   * not listening yet, or lost the first message, still finds the popup. Every repeat is the same
   * message of the same page instance, which a host that already answered ignores. The handshake
   * timeout stays the overall deadline. `false` sends HELLO once. Progress is reported through
   * `onRetry`. Validated when the runtime is created.
   */
  helloRetry?: false | BackoffOptions
  /**
   * Receives failures that happen where no caller can: merging events on a timer (a window that
   * ended with a payload that cannot be sent). Default: `console.error('[popup-bridge]', error)`.
   */
  onError?: (error: unknown) => void
}

export type EmitOptions = {
  /**
   * Objects in the payload to transfer instead of clone; they are detached here afterwards. Not
   * allowed for an event with a `coalesce` policy (merging needs to keep the payload), which
   * throws a `TypeError`.
   */
  transfer?: Transferable[]
}

export type PopupConnection = {
  sessionId: string
  hostOrigin: string
  protocolVersion: string
  init: unknown
  /** Ids of the optional protocol features agreed with the host for this connection. */
  features: readonly string[]
}

export type PopupCloseInfo = { reason: 'host-close' | 'popup-close' | 'opener-gone' | 'error'; error?: BridgeError }

export interface PopupRuntime<C extends AnyContract> {
  readonly state: PopupState
  readonly sessionId: string | undefined
  /** Optional protocol features agreed with the host; empty until connected and after the connection ends. */
  readonly features: FeatureSet
  readonly registry: HandlerRegistry<C['methods']>
  /** Register a contract method (`register('asset.select', handler)`) or a free-form feature. */
  register: HandlerRegistry<C['methods']>['register']
  implement: HandlerRegistry<C['methods']>['implement']
  registerFeature: HandlerRegistry<C['methods']>['registerFeature']
  /** Calls into the host (reverse RPC). Only methods the host exposed explicitly succeed. */
  readonly host: {
    readonly api: RpcApi<C['host']>
    call<K extends MethodName<C['host']>>(name: K, ...args: CallArgs<InputOf<C['host'][K]>>): Promise<OutputOf<C['host'][K]>>
    /** Asks the host to draw the user's attention, or raises its window. */
    readonly attention: PeerAttention
  }
  /** The host as a link of the page's node; the same surface a host has for its popups. */
  readonly link: PeerLink
  /**
   * Publishes an event to subscribed hosts. Every event that leaves advances the event's revision,
   * and the revisions continue when the page is restored from the back/forward cache. An event
   * with a `coalesce` policy may merge several emits into one revision (see `flushEvents`), but
   * only toward a host that agreed to `events.coalesce`.
   */
  emit<K extends EventName<C['events']>>(name: K, payload: PayloadOf<C['events'][K]>, options?: EmitOptions): void
  /**
   * Sends the merged events that are still waiting for their window now (one event, or all) instead
   * of when the window ends. Only events with a `coalesce` policy wait; others are already sent.
   */
  flushEvents(name?: EventName<C['events']>): void
  /** Sends HELLO and resolves once the feature is READY. Register handlers before calling it. */
  start(): Promise<PopupConnection>
  close(): void
  onClose(listener: (info: PopupCloseInfo) => void): () => void
  /** Fires after the runtime reconnected on its own, e.g. when the page came back from the back/forward cache. */
  onReconnect(listener: () => void): () => void
  /** Observes the HELLO retries: scheduled, made, recovered (a host answered) or exhausted. */
  onRetry(listener: (event: RetryEvent) => void): () => void
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 15_000
const DEFAULT_RPC_TIMEOUT_MS = 30_000
const DEFAULT_OPENER_POLL_MS = 1_000
const DEFAULT_HELLO_RETRIES = 6
const DEFAULT_LIMITS: EndpointLimits = { maxInflight: 256, maxNotificationsPerSecond: 5_000 }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createPopupRuntime<C extends AnyContract = AnyContract>(options: PopupRuntimeOptions<C>): PopupRuntime<C> {
  const contract = options.contract
  const env = options.env ?? browserPopupEnvironment()
  const clock = env.clock ?? systemClock
  let instanceId = createId()
  const protocolVersions = options.protocolVersions ?? [PROTOCOL_VERSION]
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS
  const rpcTimeoutMs = options.rpcTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS
  const validate = options.validate !== false
  const allowed = new Set(options.allowedHostOrigins)
  for (const origin of allowed) {
    if (origin === '*' || new URL(origin).origin !== origin) {
      throw new TypeError(`allowedHostOrigins must be exact origins such as "https://app.example.com", got "${origin}"`)
    }
  }
  if (allowed.size === 0) throw new TypeError('allowedHostOrigins must list at least one origin')
  const ownFeatures = options.features ?? DEFAULT_FEATURES
  assertFeatureIds(ownFeatures)
  const helloRetry = resolveBackoff(options.helloRetry, DEFAULT_HELLO_RETRIES, 'helloRetry')
  const defaultReplayCapacity = options.replay?.capacity ?? 0
  assertReplayCapacity(defaultReplayCapacity, 'replay.capacity', 0)
  // Buffering is a local decision: it needs this popup to offer replay, not a connection that agreed
  // on it, so events emitted while disconnected (a restored page) can still be replayed afterwards.
  const replayOffered = ownFeatures.includes(FEATURE_EVENTS_REPLAY)
  // Identifies this runtime: revisions and buffers live exactly as long as the page does.
  const epoch = createId()

  let state: PopupState = 'BOOTING'
  let sessionId: string | undefined
  // Settled in `connect`, before the link attaches or `onInit` runs; reset whenever the transport goes.
  let features: FeatureSet = NO_FEATURES
  let transport: { endpoint: RpcEndpoint; channel: RpcChannel; unsubscribeControl: () => void } | undefined
  let cancelHandshakeTimer: (() => void) | undefined
  let cancelOpenerPoll: (() => void) | undefined
  let started = false
  let finished = false
  let unlisten: (() => void) | undefined
  let unlistenPageHide: (() => void) | undefined
  // The HELLO retry of the wait in progress: HELLOs sent so far (the first included), the schedule,
  // and whether it ran out. A run ends when a host connects, the runtime ends or the page restarts.
  let helloAttempts = 0
  let helloBackoff: Backoff | undefined
  let helloExhausted = false
  let cancelHelloRetry: (() => void) | undefined
  let resolveStart!: (connection: PopupConnection) => void
  let rejectStart!: (error: BridgeError) => void
  const startPromise = new Promise<PopupConnection>((resolve, reject) => {
    resolveStart = resolve
    rejectStart = reject
  })
  startPromise.catch(() => undefined)
  const closeListeners = new Set<(info: PopupCloseInfo) => void>()
  const reconnectListeners = new Set<() => void>()
  const retryListeners = new Set<(event: RetryEvent) => void>()
  let reconnecting = false
  let unlistenPageShow: (() => void) | undefined
  const subscribed = new Set<string>()
  const revisions = new Map<string, number>()
  const buffers = new Map<string, ReplayBuffer>()
  const reportError = options.onError ?? ((error: unknown) => console.error('[popup-bridge]', error))
  const coalescer = new EventCoalescer({
    after: clock.after,
    commit: (name, payload, how) => commit(name, payload, how),
    validate: (name, payload) => {
      const schema = contract?.events[name]?.payload
      if (validate && schema !== undefined) runSchema(schema, payload, 'INVALID_PARAMS', `Merged payload of ${name}`)
    },
    onError: reportError,
  })

  const registry = new HandlerRegistry<C['methods']>(contract?.methods, () => sessionId)
  const ping: RpcRegistration = { handler: () => ({ now: clock.now() }) }
  /**
   * Built-in methods that exist only when a feature was negotiated, by method name. A gated method
   * answers `METHOD_NOT_FOUND` on a connection without its feature, like on a peer that lacks it.
   */
  const builtinFeature: Readonly<Record<string, string>> = { [REPLAY_METHOD]: FEATURE_EVENTS_REPLAY }
  const builtins: Record<string, RpcRegistration> = {
    'bridge.ping': ping,
    'bridge.subscribe': {
      handler: (params: unknown) => {
        const events = eventNames(params)
        for (const name of events) {
          if (contract !== undefined && contract.events[name] === undefined) {
            throw new BridgeError('CAPABILITY_UNAVAILABLE', `"${name}" is not an event of this popup`)
          }
        }
        for (const name of events) subscribed.add(name)
        return {
          revisions: Object.fromEntries(events.map(name => [name, revisions.get(name) ?? 0])),
          // Only a host that can replay needs to tell this runtime from a reloaded one.
          ...(features.has(FEATURE_EVENTS_REPLAY) ? { epoch } : {}),
        }
      },
    },
    [REPLAY_METHOD]: {
      handler: (params: unknown) => {
        const { name, since } = parseReplayRequest(params)
        if (contract !== undefined && contract.events[name] === undefined) {
          throw new BridgeError('CAPABILITY_UNAVAILABLE', `"${name}" is not an event of this popup`)
        }
        // The buffer is created on demand: an event nobody emitted yet still has a capacity to report,
        // or the host would conclude this popup keeps no history and stop asking for replays.
        return buildReplayReply(epoch, revisions.get(name) ?? 0, bufferOf(name), since)
      },
    },
    'bridge.unsubscribe': {
      handler: (params: unknown) => {
        for (const name of eventNames(params)) {
          // What is waiting was emitted while this host listened; send it before it stops.
          settleEvents(name)
          subscribed.delete(name)
        }
        return {}
      },
    },
  }

  /** The buffer of an event, created on first use; `undefined` when it keeps no history. */
  function bufferOf(name: string): ReplayBuffer | undefined {
    const existing = buffers.get(name)
    if (existing !== undefined || !replayOffered) return existing
    const capacity = contract?.events[name]?.replay?.capacity ?? defaultReplayCapacity
    if (capacity === 0) return undefined
    const created = new ReplayBuffer(capacity, revisions.get(name) ?? 0)
    buffers.set(name, created)
    return created
  }

  /**
   * The one place an event gets its revision: records it for replay, then sends it to a subscribed
   * host. A payload that cannot be copied is refused before it consumes a revision.
   */
  function commit(name: string, payload: unknown, commitOptions: CoalescedCommit & { transfer?: Transferable[] | undefined }): void {
    const buffer = bufferOf(name)
    const transferred = commitOptions.transfer !== undefined && commitOptions.transfer.length > 0
    // A transferred payload is gone after sending, so there is nothing to replay.
    const kept = buffer === undefined || transferred ? undefined : { payload: commitOptions.owned ? payload : copyPayload(name, payload, 'kept for replay') }
    const revision = (revisions.get(name) ?? 0) + 1
    revisions.set(name, revision)
    if (buffer !== undefined) {
      if (kept === undefined) buffer.evictThrough(revision)
      else buffer.record(revision, kept.payload, commitOptions.coalesced)
    }
    if (state !== 'READY' || transport === undefined || !subscribed.has(name)) return
    try {
      transport.endpoint.notify(
        'bridge.event',
        { name, revision, payload, ...(commitOptions.coalesced === undefined ? {} : { coalesced: commitOptions.coalesced }) },
        commitOptions.transfer,
      )
    } catch (error) {
      // A payload that cannot be sent is a bug of the emitter; a session that ended in between is not.
      if (error instanceof BridgeError && error.code === 'NOT_CLONEABLE') throw error
    }
  }

  /** Sends what coalescing events are holding (one event, or all); failures go to `onError`. */
  function settleEvents(name?: string): void {
    try {
      coalescer.flush(name)
    } catch (error) {
      reportError(error)
    }
  }

  /** True when a host is listening to `name` and agreed to receive merged events. */
  function mergesFor(name: string): boolean {
    return state === 'READY' && transport !== undefined && subscribed.has(name) && features.has(FEATURE_EVENTS_COALESCE)
  }

  function eventNames(params: unknown): string[] {
    const events = isRecord(params) ? params.events : undefined
    if (!Array.isArray(events) || !events.every(name => typeof name === 'string')) {
      throw new BridgeError('INVALID_PARAMS', 'events must be an array of event names')
    }
    return events as string[]
  }

  const invokeHost = (method: string, params: unknown, callOptions: Parameters<RpcEndpoint['call']>[2] = {}): Promise<unknown> => {
    if (transport === undefined || (state !== 'INITIALIZING' && state !== 'READY')) {
      return Promise.reject(new BridgeError('SESSION_NOT_READY', `The popup is ${state}; host calls need a connection`))
    }
    return transport.endpoint.call(method, params, callOptions)
  }
  const callHost = createMethodCaller(contract?.host, invokeHost, { validate, defaultTimeoutMs: rpcTimeoutMs })
  const link = new LinkController({
    role: 'host',
    sessionId: readSession(env.hash) ?? '',
    readStatus: () => state,
    focusPeer: () => env.host?.focus(),
    node: coreOf(options.node),
  })
  const host = {
    api: createRpcApi((contract?.host ?? {}) as C['host'], callHost),
    call: ((name: string, params?: unknown, callOptions?: Parameters<typeof callHost>[2]) => callHost(name, params, callOptions)) as PopupRuntime<C>['host']['call'],
    attention: link.attention,
  }

  function reportSecurity(event: Parameters<SecurityListener>[0]): void {
    link.traceSecurity(event)
    options.onSecurityEvent?.(event)
  }

  function setState(next: PopupState): void {
    state = next
    link.changed()
  }

  function armHandshakeTimer(): void {
    cancelHandshakeTimer?.()
    cancelHandshakeTimer = clock.after(handshakeTimeoutMs, () => {
      fail(new BridgeError('HANDSHAKE_TIMEOUT', `The host did not connect within ${handshakeTimeoutMs}ms`, { data: { timeoutMs: handshakeTimeoutMs, attempts: helloAttempts } }))
    })
  }

  function sendControl(reason: CloseReason): void {
    if (transport === undefined || sessionId === undefined) return
    try {
      transport.channel.send({ kind: 'bridge.close', sessionId, instanceId, reason })
    } catch {
      // The port is already gone.
    }
  }

  function finish(final: 'CLOSED' | 'FAILED', info: PopupCloseInfo, notify?: CloseReason): void {
    if (finished) return
    finished = true
    // While the transport is still alive, so the host gets what was waiting before the close.
    settleEvents()
    coalescer.dispose()
    if (notify !== undefined) sendControl(notify)
    cancelHandshakeTimer?.()
    endHelloRetry(false)
    cancelOpenerPoll?.()
    unlisten?.()
    unlistenPageHide?.()
    unlistenPageShow?.()
    const current = transport
    transport = undefined
    features = NO_FEATURES
    link.detach()
    current?.unsubscribeControl()
    current?.endpoint.close(info.error ?? new BridgeError('SESSION_CLOSED', 'The session is closed'))
    const wasReady = state === 'READY'
    setState(final)
    link.dispose()
    if (!wasReady) rejectStart(info.error ?? new BridgeError('SESSION_CLOSED', 'The session closed before it was ready'))
    for (const listener of [...closeListeners]) listener(info)
  }

  function fail(error: BridgeError): void {
    finish('FAILED', { reason: 'error', error }, 'error')
  }

  function onWindowMessage(message: IncomingWindowMessage): void {
    if (finished || !isBridgeMessage(message.data)) return
    const opener = env.host
    if (opener === null || !opener.isSource(message.source)) return
    if (!allowed.has(message.origin)) {
      reportSecurity({ type: 'origin-mismatch', origin: message.origin, ...(sessionId === undefined ? {} : { sessionId }), detail: 'not in allowedHostOrigins' })
      return
    }
    const parsed = parseBridgeMessage(message.data)
    if (parsed === undefined) {
      reportSecurity({ type: 'malformed-message', origin: message.origin })
      return
    }
    if (parsed.sessionId !== sessionId || parsed.instanceId !== instanceId) {
      reportSecurity({ type: 'session-mismatch', origin: message.origin, detail: parsed.kind })
      return
    }
    if (parsed.kind === 'bridge.connect' && state === 'WAITING_CONNECT') {
      void connect(parsed, message)
    } else if (parsed.kind === 'bridge.reject') {
      fail(new BridgeError(parsed.error.data?.code ?? 'PROTOCOL_INCOMPATIBLE', parsed.error.message, { data: parsed.error.data?.data }))
    }
  }

  async function connect(message: ConnectMessage, source: IncomingWindowMessage): Promise<void> {
    const port = source.ports[0]
    if (port === undefined) {
      fail(new BridgeError('INVALID_REQUEST', 'bridge.connect carried no MessagePort'))
      return
    }
    if (!protocolVersions.includes(message.protocolVersion)) {
      fail(new BridgeError('PROTOCOL_INCOMPATIBLE', `The host chose unsupported protocol ${message.protocolVersion}`, { data: { supported: protocolVersions } }))
      return
    }
    cancelHandshakeTimer?.()
    endHelloRetry(true)
    features = createFeatureSet(negotiateFeatures(ownFeatures, message.features))
    setState('INITIALIZING')
    const channel = fromMessagePort(port)
    const endpoint = createRpcEndpoint({
      channel,
      idPrefix: 'p-',
      clock,
      defaultTimeoutMs: rpcTimeoutMs,
      limits: options.limits ?? DEFAULT_LIMITS,
      onLimit: event => reportSecurity({ type: 'rate-limited', ...(sessionId === undefined ? {} : { sessionId }), detail: `${event.kind}:${event.method}` }),
      onTrace: event => link.traceRpc(event),
      onNotification: (method, params) => link.handleNotification(method, params),
      resolve: name => {
        if (Object.hasOwn(builtins, name)) return isFeatureGated(name, builtinFeature, features) ? undefined : builtins[name]
        return link.resolve(name) ?? registry.resolve(name)
      },
      guard: async ({ method, registration }) => {
        if (state !== 'READY' && !method.startsWith('bridge.')) {
          throw new BridgeError('SESSION_NOT_READY', `${method} was called before the popup was ready`, { data: { state } })
        }
        let verdict: boolean | void
        try {
          verdict = await options.authorize?.({ method, permission: registration.permission, sessionId: message.sessionId })
        } catch (error) {
          reportSecurity({ type: 'unauthorized-call', sessionId: message.sessionId, detail: method })
          throw error instanceof BridgeError ? error : new BridgeError('PERMISSION_DENIED', `Calling ${method} is not permitted`, { cause: error })
        }
        if (verdict === false) {
          reportSecurity({ type: 'unauthorized-call', sessionId: message.sessionId, detail: method })
          throw new BridgeError('PERMISSION_DENIED', `Calling ${method} is not permitted`)
        }
      },
    })
    const unsubscribeControl = channel.subscribe(raw => {
      const control = parseBridgeMessage(raw)
      if (control?.kind === 'bridge.close' && control.sessionId === message.sessionId) {
        finish('CLOSED', { reason: 'host-close' })
      }
    })
    const connection = { endpoint, channel, unsubscribeControl }
    transport = connection
    link.peerOrigin = source.origin
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

    try {
      const init = validate && contract?.init !== undefined ? runSchema(contract.init, message.init, 'INIT_INVALID', 'init') : message.init
      await options.onInit?.(init as InitOf<C>, {
        sessionId: message.sessionId,
        hostOrigin: source.origin,
        protocolVersion: message.protocolVersion,
        features,
        host: host as InitContext['host'],
      })
    } catch (error) {
      // A restart replaced this connection while `onInit` was pending; its outcome is not news.
      if (finished || transport !== connection) return
      const failure = toBridgeError(error)
      const reported = failure.code === 'INTERNAL' ? new BridgeError('INIT_INVALID', 'Initialization failed', { cause: error }) : failure
      channel.send({ kind: 'bridge.init-failed', sessionId: message.sessionId, instanceId, error: reported.toWire() })
      finish('FAILED', { reason: 'error', error: reported })
      return
    }
    // Same as above: only the connection that is still current may become ready.
    if (finished || transport !== connection) return
    channel.send({
      kind: 'bridge.ready',
      sessionId: message.sessionId,
      instanceId,
      capabilities: capabilities(),
      ...(features.size === 0 ? {} : { features: [...features.ids] }),
    })
    setState('READY')
    if (reconnecting) {
      reconnecting = false
      for (const listener of [...reconnectListeners]) listener()
    }
    resolveStart({
      sessionId: message.sessionId,
      hostOrigin: source.origin,
      protocolVersion: message.protocolVersion,
      init: message.init,
      features: features.ids,
    })
  }

  /** The one place a HELLO is built, so every announcement of this instance reads the same. */
  function helloMessage(id: string): HelloMessage {
    return {
      kind: 'bridge.hello',
      sessionId: id,
      instanceId,
      protocolVersions,
      ...(ownFeatures.length === 0 ? {} : { features: [...new Set(ownFeatures)] }),
    }
  }

  /** HELLO goes to every allowed origin: the browser delivers it only where the origin matches. */
  function postHello(opener: NonNullable<PopupEnvironment['host']>, id: string): void {
    const hello = helloMessage(id)
    for (const origin of allowed) opener.postMessage(hello, origin)
  }

  function reportRetry(event: Omit<RetryEvent, 'target'>): void {
    const full: RetryEvent = { target: 'hello', ...event }
    link.traceRetry(full)
    for (const listener of [...retryListeners]) {
      try {
        listener(full)
      } catch (error) {
        reportError(error)
      }
    }
  }

  /** The first HELLO of a wait for CONNECT was just sent: arms the repeats. */
  function beginHelloRetry(opener: NonNullable<PopupEnvironment['host']>, id: string): void {
    endHelloRetry(false)
    helloAttempts = 1
    helloExhausted = false
    if (helloRetry === undefined || helloRetry.maxRetries === 0) return
    helloBackoff = createBackoff(helloRetry, clock.random)
    scheduleHelloRetry(opener, id)
  }

  function scheduleHelloRetry(opener: NonNullable<PopupEnvironment['host']>, id: string): void {
    const backoff = helloBackoff
    if (backoff === undefined) return
    const delayMs = backoff.next()
    if (delayMs === undefined) {
      // Every retry was sent; the last one gets one more interval to be answered before the run is called exhausted.
      cancelHelloRetry = clock.after(backoffDelay(backoff.policy, backoff.attempts + 1, clock.random), () => {
        cancelHelloRetry = undefined
        if (finished || state !== 'WAITING_CONNECT') return
        helloExhausted = true
        reportRetry({ phase: 'exhausted', attempt: backoff.attempts })
      })
      return
    }
    reportRetry({ phase: 'scheduled', attempt: backoff.attempts, delayMs })
    cancelHelloRetry = clock.after(delayMs, () => {
      cancelHelloRetry = undefined
      if (finished || state !== 'WAITING_CONNECT') return
      reportRetry({ phase: 'attempt', attempt: backoff.attempts })
      try {
        postHello(opener, id)
        helloAttempts += 1
      } catch (error) {
        reportError(error)
      }
      scheduleHelloRetry(opener, id)
    })
  }

  /** Stops the repeats; `connected` says a host answered, which counts as recovered if any repeat was needed. */
  function endHelloRetry(connected: boolean): void {
    cancelHelloRetry?.()
    cancelHelloRetry = undefined
    const retried = helloAttempts - 1
    const reportable = connected && helloBackoff !== undefined && retried > 0 && !helloExhausted
    helloBackoff = undefined
    if (reportable) reportRetry({ phase: 'recovered', attempt: retried })
  }

  /**
   * The page came back from the back/forward cache. The host dropped its side when the page went
   * away, so the old port is dead: join again as a new instance and let the host reconnect.
   */
  function restart(): void {
    const opener = env.host
    if (finished || opener === null || sessionId === undefined || (state !== 'READY' && state !== 'INITIALIZING')) return
    const current = transport
    transport = undefined
    // With no transport this only records into the replay buffer, which the host reads after it
    // reconnects; the pending events keep their place in the revision order.
    settleEvents()
    link.detach()
    current?.unsubscribeControl()
    current?.endpoint.close(new BridgeError('SESSION_CLOSED', 'The page was restored; the connection was replaced'))
    features = NO_FEATURES
    subscribed.clear()
    // Revisions and replay buffers are kept: this is the same page, and the host that comes back
    // continues from where it stopped.
    instanceId = createId()
    reconnecting = true
    setState('WAITING_CONNECT')
    armHandshakeTimer()
    postHello(opener, sessionId)
    beginHelloRetry(opener, sessionId)
  }

  function capabilities() {
    return [
      ...registry.capabilities(),
      ...Object.entries(contract?.events ?? {}).map(([name, spec]) => ({ name, version: spec.version, kind: 'event' as const })),
    ]
  }

  return {
    get state() {
      return state
    },
    get sessionId() {
      return sessionId
    },
    get features() {
      return features
    },
    registry,
    register: registry.register.bind(registry),
    implement: registry.implement.bind(registry),
    registerFeature: registry.registerFeature.bind(registry),
    host,
    link,
    emit(name, payload, emitOptions) {
      const spec = contract?.events[name]
      if (contract !== undefined && spec === undefined) throw new TypeError(`"${name}" is not an event of this contract`)
      const policy = spec?.coalesce
      if (policy !== undefined && emitOptions?.transfer !== undefined && emitOptions.transfer.length > 0) {
        throw new TypeError(`${name} merges emits (it has a coalesce policy), so its payload cannot be transferred`)
      }
      if (validate && spec?.payload !== undefined) runSchema(spec.payload, payload, 'INVALID_PARAMS', `Payload of ${name}`)
      if (policy !== undefined) {
        if (mergesFor(name)) {
          coalescer.emit(name, widenCoalesce(policy), payload)
          return
        }
        // Nobody to merge for: send at once, after anything still waiting so revisions follow emit order.
        settleEvents(name)
      }
      commit(name, payload, { owned: false, transfer: emitOptions?.transfer })
    },
    flushEvents(name) {
      settleEvents(name)
    },
    start() {
      if (started) return startPromise
      started = true
      const opener = env.host
      sessionId = readSession(env.hash)
      if (opener === null || sessionId === undefined) {
        const error = new BridgeError('HOST_UNAVAILABLE', 'This page was not opened by a popup bridge host')
        finish('FAILED', { reason: 'error', error })
        return startPromise
      }
      link.register()
      unlisten = env.listen(onWindowMessage)
      unlistenPageHide = env.onPageHide(() => {
        settleEvents()
        sendControl('unload')
      })
      cancelOpenerPoll = clock.every(options.openerPollMs ?? DEFAULT_OPENER_POLL_MS, () => {
        if (opener.closed) finish('CLOSED', { reason: 'opener-gone', error: new BridgeError('SESSION_CLOSED', 'The host window is gone') })
      })
      setState('WAITING_CONNECT')
      armHandshakeTimer()
      unlistenPageShow = env.onPageShow?.(persisted => {
        if (persisted) restart()
      })
      postHello(opener, sessionId)
      beginHelloRetry(opener, sessionId)
      return startPromise
    },
    close() {
      finish('CLOSED', { reason: 'popup-close' }, 'popup-close')
    },
    onReconnect(listener) {
      reconnectListeners.add(listener)
      return () => {
        reconnectListeners.delete(listener)
      }
    },
    onRetry(listener) {
      retryListeners.add(listener)
      return () => {
        retryListeners.delete(listener)
      }
    },
    onClose(listener) {
      closeListeners.add(listener)
      return () => {
        closeListeners.delete(listener)
      }
    },
  }
}
