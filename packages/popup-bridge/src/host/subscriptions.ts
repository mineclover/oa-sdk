import { createBackoff, type ResolvedBackoff, type RetryEvent } from '../backoff.js'
import { systemClock, type Clock } from '../env.js'
import { REPLAY_METHOD, parseReplayReply, type ReplayReply } from '../events/replay.js'
import { BridgeError, isBridgeError, toBridgeError } from '../protocol/errors.js'
import { FEATURE_EVENTS_REPLAY, type FeatureSet } from '../protocol/features.js'

export type EventMeta = {
  name: string
  revision: number
  /** True when events were missed since the previous one; fetch a snapshot to resynchronize. */
  gap: boolean
  /** How many events were skipped (0 when `gap` is false). */
  missed: number
  /** True when the popup re-sent this event from its replay buffer instead of delivering it live. */
  replayed: boolean
  /**
   * How many emits of the popup this event stands for: 1 for an event sent as emitted, more when the
   * popup merged emits inside a window (`event({ coalesce })`). Informational only: a merged event
   * is one revision, so it never counts as `missed`.
   */
  coalesced: number
}

export type EventHandler = (payload: never, meta: EventMeta) => void

/**
 * How one event came out of a synchronization with the popup:
 *
 * - `current`: nothing was missed.
 * - `replayed`: everything that was missed has been redelivered (`meta.replayed`), without a gap.
 * - `gap`: the buffer no longer covered all of it; what it held was delivered and `missed` events are lost.
 * - `reset`: the popup is a new page (or went backwards); its history is gone, fetch a snapshot.
 * - `unsupported`: no replay on this connection; events missed meanwhile are lost, fetch a snapshot.
 * - `failed`: the request failed; the next event shows the gap as usual.
 */
export type ResyncOutcome = 'current' | 'replayed' | 'gap' | 'reset' | 'unsupported' | 'failed'

export type ResyncResult = {
  outcome: ResyncOutcome
  /** Events redelivered from the buffer. */
  replayed: number
  /** Events known to be lost (counted from revisions); 0 when the outcome cannot tell. */
  missed: number
}

/** Per event name. */
export type ResyncReport = Readonly<Record<string, ResyncResult>>

export type ResubscribeOutcome = {
  /** Events that are subscribed again on the new connection. */
  recovered: string[]
  /** Events that could not be subscribed; their handlers stay registered for another attempt. */
  failed: string[]
  replay: ResyncReport
}

type CallOptions = { timeoutMs?: number }

type Deps = {
  /** Calls a `bridge.*` method of the popup. */
  call: (method: string, params: unknown, options?: CallOptions) => Promise<unknown>
  /** Validates a payload against the contract; throws when invalid. */
  validate: (name: string, payload: unknown) => unknown
  onHandlerError: (error: unknown) => void
  /** The features agreed with the connected popup; empty while there is no negotiated connection. */
  features: () => FeatureSet
  /** Time source for the waits between retries. Default: {@link systemClock}. */
  clock?: Clock
  /**
   * How `resubscribe()` retries an event that could not be subscribed: the policy and the time
   * allowed for each `bridge.subscribe` attempt. Without it there is a single attempt.
   */
  retry?: { policy: ResolvedBackoff; timeoutMs: number }
  /** Progress of the retries of `resubscribe()`. */
  onRetry?: (event: RetryEvent) => void
  limits?: {
    /** Time allowed for one `bridge.replay` request. Default 5 000 ms. */
    replayTimeoutMs?: number
    /** Live events kept while a stream catches up; the oldest is dropped beyond that. Default 256. */
    maxHeld?: number
  }
}

/** A notification as received, before it is validated and delivered. */
type Incoming = { revision: number; payload: unknown; coalesced?: number }

/**
 * The state of one subscribed event. `last` is the revision the handlers are caught up to; it is
 * deliberately not advanced past what was delivered, so a hole that could not be filled shows up as
 * `gap` on the next event.
 */
type Stream = {
  /** Identifies the popup runtime the revisions belong to; `undefined` when replay is not agreed. */
  epoch: string | undefined
  last: number | undefined
  /** While true, live events wait in `held`: the stream is subscribing or catching up. */
  syncing: boolean
  held: Incoming[]
  /** False once the popup said it keeps no history for this event, so gaps are not worth a request. */
  buffered: boolean
  /** Settles when the synchronization in progress is over. */
  idle: Promise<void>
}

type Resume = { epoch: string | undefined; last: number }

/** How `resubscribe()` left one event. `aborted`: the transport was replaced or the handlers left, so nobody waits for it. */
type Resubscribed = { kind: 'recovered'; result: ResyncResult } | { kind: 'failed' } | { kind: 'aborted' }

const ABORTED: Resubscribed = { kind: 'aborted' }
const FAILED_RESUBSCRIBE: Resubscribed = { kind: 'failed' }

/** Failures that say "try again later" rather than "this will never work". */
const RETRIABLE_CODES: ReadonlySet<string> = new Set(['RPC_TIMEOUT', 'OVERLOADED', 'INTERNAL'])

function isRetriable(error: unknown): boolean {
  return isBridgeError(error) && RETRIABLE_CODES.has(error.code)
}

const DEFAULT_REPLAY_TIMEOUT_MS = 5_000
const DEFAULT_MAX_HELD = 256

const CURRENT: ResyncResult = { outcome: 'current', replayed: 0, missed: 0 }
const RESET: ResyncResult = { outcome: 'reset', replayed: 0, missed: 0 }
const UNSUPPORTED: ResyncResult = { outcome: 'unsupported', replayed: 0, missed: 0 }
const FAILED: ResyncResult = { outcome: 'failed', replayed: 0, missed: 0 }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** The merge count of an event as sent; anything but a positive integer reads as an unmerged event. */
function readCoalesced(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined
}

/**
 * Event subscriptions of one host session. Handlers are reference counted so each event is
 * subscribed on the wire once, and revisions detect lost or duplicated notifications. When the
 * popup agreed to `events.replay`, a gap or a restored connection is repaired from its buffer.
 */
export class Subscriptions {
  readonly #handlers = new Map<string, Set<EventHandler>>()
  readonly #streams = new Map<string, Stream>()
  readonly #wire = new Map<string, Promise<ResyncResult>>()
  /** Where each stream stood when the transport was replaced, for the stream that replaces it. */
  readonly #resume = new Map<string, Resume>()
  readonly #deps: Deps
  readonly #clock: Clock
  /** Aborted by `reset()`: the retries of the transport that just went away stop with it. */
  #epoch = new AbortController()
  readonly #replayTimeoutMs: number
  readonly #maxHeld: number

  constructor(deps: Deps) {
    this.#deps = deps
    this.#clock = deps.clock ?? systemClock
    this.#replayTimeoutMs = deps.limits?.replayTimeoutMs ?? DEFAULT_REPLAY_TIMEOUT_MS
    this.#maxHeld = deps.limits?.maxHeld ?? DEFAULT_MAX_HELD
  }

  async add(name: string, handler: EventHandler): Promise<() => Promise<void>> {
    let set = this.#handlers.get(name)
    if (set === undefined) {
      set = new Set()
      this.#handlers.set(name, set)
    }
    set.add(handler)
    try {
      await this.#subscribeOnWire(name)
    } catch (error) {
      set.delete(handler)
      if (set.size === 0) this.#handlers.delete(name)
      throw error
    }
    let active = true
    return async () => {
      if (!active) return
      active = false
      const current = this.#handlers.get(name)
      current?.delete(handler)
      if (current !== undefined && current.size === 0) {
        this.#handlers.delete(name)
        this.#streams.delete(name)
        this.#resume.delete(name)
        this.#wire.delete(name)
        // The session may already be gone; the popup forgets subscriptions with its port anyway.
        await this.#deps.call('bridge.unsubscribe', { events: [name] }).catch(() => undefined)
      }
    }
  }

  #replayOn(): boolean {
    return this.#deps.features().has(FEATURE_EVENTS_REPLAY)
  }

  /** True while `stream` is still the live state of `name` (not replaced, reset or unsubscribed). */
  #current(name: string, stream: Stream): boolean {
    return this.#streams.get(name) === stream
  }

  /** The only place that subscribes on the wire. One attempt; callers retry. */
  #subscribeOnWire(name: string, timeoutMs?: number): Promise<ResyncResult> {
    const existing = this.#wire.get(name)
    if (existing !== undefined) return existing
    const stream: Stream = { epoch: undefined, last: undefined, syncing: true, held: [], buffered: true, idle: Promise.resolve() }
    this.#streams.set(name, stream)
    const attempt = (async () => {
      const response = await this.#deps.call('bridge.subscribe', { events: [name] }, timeoutMs === undefined ? undefined : { timeoutMs })
      if (!this.#current(name, stream)) return FAILED
      try {
        return await this.#adopt(name, stream, response)
      } finally {
        // Events that arrived meanwhile are delivered in the same turn that finishes the catch-up.
        this.#drain(name, stream)
      }
    })()
    const request = attempt.catch((error: unknown): never => {
      if (this.#current(name, stream)) this.#streams.delete(name)
      if (this.#wire.get(name) === request) this.#wire.delete(name)
      throw error
    })
    stream.idle = request.then(() => undefined, () => undefined)
    this.#wire.set(name, request)
    return request
  }

  /** Fixes where a freshly subscribed stream stands, repairing what a previous connection missed. */
  async #adopt(name: string, stream: Stream, response: unknown): Promise<ResyncResult> {
    const reported = isRecord(response) && isRecord(response.revisions) ? response.revisions[name] : undefined
    const revision = isRevision(reported) ? reported : 0
    const offered = isRecord(response) ? response.epoch : undefined
    stream.epoch = this.#replayOn() && typeof offered === 'string' && offered !== '' ? offered : undefined
    const resume = this.#resume.get(name)
    if (resume === undefined) {
      stream.last = revision
      return CURRENT
    }
    this.#resume.delete(name)
    if (stream.epoch === undefined) {
      stream.last = revision
      return UNSUPPORTED
    }
    if (stream.epoch !== resume.epoch || revision < resume.last) {
      stream.last = revision
      return RESET
    }
    stream.last = resume.last
    return revision === resume.last ? CURRENT : this.#recoverTail(name, stream)
  }

  /** Handles a `bridge.event` notification. */
  dispatch(params: unknown): void {
    if (!isRecord(params) || typeof params.name !== 'string' || !isRevision(params.revision) || params.revision < 1) return
    const name = params.name
    const stream = this.#streams.get(name)
    if (stream === undefined || !this.#handlers.has(name)) return
    const coalesced = readCoalesced(params.coalesced)
    const incoming: Incoming = { revision: params.revision, payload: params.payload, ...(coalesced === undefined ? {} : { coalesced }) }
    if (stream.syncing) {
      this.#hold(stream, incoming)
      return
    }
    const last = stream.last
    if (last !== undefined && incoming.revision <= last) return // duplicate or out of order
    if (last !== undefined && incoming.revision > last + 1 && stream.epoch !== undefined && stream.buffered && this.#replayOn()) {
      // The wire dropped something: hold this event, fetch what was skipped, then deliver it in order.
      this.#hold(stream, incoming)
      void this.#synchronize(name, stream, () => this.#recoverTail(name, stream))
      return
    }
    this.#deliver(name, stream, incoming, false)
  }

  #hold(stream: Stream, incoming: Incoming): void {
    if (stream.held.length >= this.#maxHeld) stream.held.shift() // keep the newest; the hole shows as a gap
    stream.held.push(incoming)
  }

  /** Runs `work` with live events held back, then delivers them. `work` must not throw. */
  #synchronize(name: string, stream: Stream, work: () => Promise<ResyncResult>): Promise<ResyncResult> {
    stream.syncing = true
    const run = (async () => {
      try {
        return await work()
      } finally {
        this.#drain(name, stream)
      }
    })()
    stream.idle = run.then(() => undefined, () => undefined)
    return run
  }

  /** Ends a synchronization: delivers the held live events that are still news. */
  #drain(name: string, stream: Stream): void {
    const held = stream.held
    stream.held = []
    stream.syncing = false
    for (const incoming of held) {
      if (!this.#current(name, stream)) return // a handler unsubscribed
      if (stream.last !== undefined && incoming.revision <= stream.last) continue
      // A hole left here stays a hole: it is flagged as a gap, not recovered again.
      this.#deliver(name, stream, incoming, false)
    }
  }

  /** Validates and hands one event to the handlers; false when it was refused. */
  #deliver(name: string, stream: Stream, incoming: Incoming, replayed: boolean): boolean {
    const handlers = this.#handlers.get(name)
    if (handlers === undefined) return false
    let payload: unknown
    try {
      payload = this.#deps.validate(name, incoming.payload)
    } catch (error) {
      this.#deps.onHandlerError(error)
      return false
    }
    const missed = stream.last === undefined ? 0 : Math.max(0, incoming.revision - stream.last - 1)
    stream.last = incoming.revision
    const meta: EventMeta = { name, revision: incoming.revision, gap: missed > 0, missed, replayed, coalesced: incoming.coalesced ?? 1 }
    for (const handler of [...handlers]) {
      try {
        handler(payload as never, meta)
      } catch (error) {
        this.#deps.onHandlerError(error)
      }
    }
    return true
  }

  /**
   * Asks the popup for the events after `stream.last` and delivers them. Never throws: a failure
   * is a result, and the stream stays where it was so the next event shows the gap.
   */
  async #recoverTail(name: string, stream: Stream): Promise<ResyncResult> {
    const since = stream.last
    if (since === undefined || stream.epoch === undefined || !this.#replayOn()) return UNSUPPORTED
    let reply: ReplayReply | undefined
    try {
      const raw = await this.#deps.call(REPLAY_METHOD, { name, since }, { timeoutMs: this.#replayTimeoutMs })
      reply = parseReplayReply(raw)
      if (reply === undefined) throw new BridgeError('INVALID_RESULT', `The reply of ${REPLAY_METHOD} for "${name}" is malformed`)
    } catch (error) {
      if (!this.#current(name, stream)) return FAILED
      if (isBridgeError(error)) {
        // A popup that does not know the request (or the event) simply cannot replay.
        if (error.code === 'METHOD_NOT_FOUND' || error.code === 'CAPABILITY_UNAVAILABLE') return UNSUPPORTED
        // The connection going away is not worth a report; the reconnect handles it.
        if (error.code === 'SESSION_CLOSED' || error.code === 'SESSION_NOT_READY') return FAILED
      }
      this.#deps.onHandlerError(error)
      return FAILED
    }
    if (!this.#current(name, stream)) return FAILED
    return this.#applyReplay(name, stream, since, reply)
  }

  #applyReplay(name: string, stream: Stream, since: number, reply: ReplayReply): ResyncResult {
    stream.buffered = reply.capacity > 0
    if (reply.epoch !== stream.epoch || reply.revision < since) {
      stream.epoch = reply.epoch
      stream.last = reply.revision
      return RESET
    }
    // Contiguity is judged here from the revisions, not taken from the popup's word. Live events
    // held meanwhile belong to the same range: one the popup no longer buffers (it fell out of the
    // window, or was sent with a transfer list) is delivered here, in order, like a replayed one.
    // A revision both sides have is taken from the replay. Held events beyond the reply stay held.
    const inRange = new Map<number, { incoming: Incoming; replayed: boolean }>()
    for (const held of stream.held) if (held.revision > since && held.revision <= reply.revision) inRange.set(held.revision, { incoming: held, replayed: false })
    for (const entry of reply.entries) inRange.set(entry.revision, { incoming: entry, replayed: true })
    stream.held = stream.held.filter(held => held.revision > reply.revision)
    const delivered = new Set<number>()
    for (const revision of [...inRange.keys()].sort((a, b) => a - b)) {
      const item = inRange.get(revision)
      if (item === undefined || (stream.last !== undefined && revision <= stream.last)) continue
      if (!this.#current(name, stream)) return FAILED
      if (this.#deliver(name, stream, item.incoming, item.replayed)) delivered.add(revision)
    }
    const missed = reply.revision - since - delivered.size
    if (missed > 0) return { outcome: 'gap', replayed: delivered.size, missed }
    return { outcome: delivered.size > 0 ? 'replayed' : 'current', replayed: delivered.size, missed: 0 }
  }

  /**
   * Forgets wire state after the transport was replaced; handlers stay registered. Where each
   * stream stood is kept, so the next connection to the same popup can pick up from there.
   */
  reset(): void {
    this.#epoch.abort()
    this.#epoch = new AbortController()
    for (const [name, stream] of this.#streams) {
      if (stream.last !== undefined) this.#resume.set(name, { epoch: stream.epoch, last: stream.last })
    }
    this.#streams.clear()
    this.#wire.clear()
  }

  /**
   * Re-subscribes every event that still has handlers (after the popup reloaded or was restored)
   * and repairs what it can. Each event is retried with backoff when the failure may pass (see
   * `retry` in the dependencies). Never rejects: events that could not be subscribed are listed in
   * `failed`, and a later call tries them again. An event whose transport was replaced meanwhile
   * (`reset()`) or whose handlers all left appears in neither list.
   */
  async resubscribe(): Promise<ResubscribeOutcome> {
    const names = [...this.#handlers.keys()]
    const signal = this.#epoch.signal
    const results = await Promise.all(names.map(name => this.#resubscribeOne(name, signal)))
    const recovered: string[] = []
    const failed: string[] = []
    const replay: Array<[string, ResyncResult]> = []
    names.forEach((name, index) => {
      const outcome = results[index]
      if (outcome?.kind === 'recovered') {
        recovered.push(name)
        replay.push([name, outcome.result])
      } else if (outcome?.kind === 'failed') {
        failed.push(name)
      }
    })
    return { recovered, failed, replay: Object.fromEntries(replay) }
  }

  /**
   * Subscribes `name` again, retrying failures that may pass. The whole run, however many attempts,
   * is one outcome; the replay and resume logic of {@link #subscribeOnWire} runs inside each
   * attempt, and the position a failed attempt left behind is still there for the next one.
   */
  async #resubscribeOne(name: string, signal: AbortSignal): Promise<Resubscribed> {
    const retry = this.#deps.retry
    const backoff = retry === undefined ? undefined : createBackoff(retry.policy, this.#clock.random)
    const report = (event: Omit<RetryEvent, 'target' | 'event'>) => this.#deps.onRetry?.({ target: 'resubscribe', event: name, ...event })
    for (;;) {
      try {
        // A concurrent add() of the same event joins the same request, so this is never a second subscribe.
        const result = await this.#subscribeOnWire(name, retry?.timeoutMs)
        if (signal.aborted) return ABORTED
        if (backoff !== undefined && backoff.attempts > 0) report({ phase: 'recovered', attempt: backoff.attempts })
        return { kind: 'recovered', result }
      } catch (error) {
        if (signal.aborted || !this.#handlers.has(name)) return ABORTED
        const failure = toBridgeError(error)
        const delayMs = backoff === undefined || !isRetriable(error) ? undefined : backoff.next()
        if (backoff === undefined || delayMs === undefined) {
          this.#deps.onHandlerError(error)
          if (backoff !== undefined && backoff.attempts > 0) report({ phase: 'exhausted', attempt: backoff.attempts, error: failure })
          return FAILED_RESUBSCRIBE
        }
        report({ phase: 'scheduled', attempt: backoff.attempts, delayMs, error: failure })
        await this.#sleep(delayMs, signal)
        if (signal.aborted || !this.#handlers.has(name)) return ABORTED
        report({ phase: 'attempt', attempt: backoff.attempts })
      }
    }
  }

  /** Waits `ms` on the clock; resolves early, with the timer cancelled, when `signal` aborts. */
  #sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      if (signal.aborted) {
        resolve()
        return
      }
      const onAbort = () => {
        cancel()
        resolve()
      }
      const cancel = this.#clock.after(ms, () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      })
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  /**
   * Asks the popup again for what `name` (default: every subscribed event) is missing. Use it to
   * check for a lost tail: a dropped last event shows as a gap only when another one follows.
   */
  async resync(name?: string): Promise<ResyncReport> {
    if (name !== undefined && !this.#handlers.has(name)) {
      throw new BridgeError('CAPABILITY_UNAVAILABLE', `"${name}" is not subscribed`)
    }
    const names = name === undefined ? [...this.#handlers.keys()] : [name]
    const results = await Promise.all(names.map(event => this.#resyncOne(event)))
    return Object.fromEntries(names.map((event, index) => [event, results[index]!]))
  }

  async #resyncOne(name: string): Promise<ResyncResult> {
    for (;;) {
      const stream = this.#streams.get(name)
      if (stream === undefined) return FAILED
      if (!stream.syncing) {
        return stream.epoch === undefined || !this.#replayOn() ? UNSUPPORTED : this.#synchronize(name, stream, () => this.#recoverTail(name, stream))
      }
      await stream.idle // another synchronization is running; ask again after it
    }
  }

  static unknownEvent(name: string): BridgeError {
    return new BridgeError('CAPABILITY_UNAVAILABLE', `"${name}" is not an event of this contract`)
  }
}
