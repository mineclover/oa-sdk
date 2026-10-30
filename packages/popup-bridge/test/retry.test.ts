import { describe, expect, it, vi } from 'vitest'
import {
  BridgeError,
  FEATURE_EVENTS_REPLAY,
  attachSession,
  createBridgeNode,
  createFeatureSet,
  resolveBackoff,
  type BackoffOptions,
  type RetryEvent,
  type TraceEvent,
} from '../src/index.js'
import type { EventMeta, ReconnectInfo, ResubscribeOutcome } from '../src/host.js'
import { Subscriptions } from '../src/host/subscriptions.js'
import { NO_FEATURES, type FeatureSet } from '../src/protocol/features.js'
import { createPopupRuntime, type PopupRuntime } from '../src/popup.js'
import { createManualClock, createMemoryBrowser } from '../src/testing.js'
import { assetContract, definition, init, setup } from './fixture.js'

const NAME = 'a.progress'
const PROGRESS = 'asset.progress' as const

const policyOf = (options: BackoffOptions = {}) => resolveBackoff(options, 4, 'test')!

const isMessage = (kind: string) => (message: unknown) => typeof message === 'object' && message !== null && (message as { kind?: unknown }).kind === kind
const isHello = isMessage('bridge.hello')
const isConnect = isMessage('bridge.connect')

function timeout(): BridgeError {
  return new BridgeError('RPC_TIMEOUT', 'bridge.subscribe timed out')
}

// ---- Subscriptions on their own --------------------------------------------------------------------

type Call = { method: string; params: unknown; options: unknown; at: number }

function harness(options: { retry?: BackoffOptions | false; timeoutMs?: number; features?: FeatureSet } = {}) {
  const clock = createManualClock({ random: () => 1 })
  const calls: Call[] = []
  const errors: unknown[] = []
  const events: RetryEvent[] = []
  /** What the next `bridge.subscribe` calls do: each entry is consumed by one call, then `reply` is used. */
  const script: Array<() => unknown> = []
  const state = {
    reply: (): unknown => ({ revisions: { [NAME]: 0 } }),
    replay: (): unknown => ({ epoch: 'e1', revision: 0, oldest: 1, capacity: 8, entries: [] }),
  }
  const retry = options.retry === false ? undefined : { policy: policyOf(options.retry ?? {}), timeoutMs: options.timeoutMs ?? 10_000 }
  const subs = new Subscriptions({
    call: async (method, params, callOptions) => {
      calls.push({ method, params, options: callOptions, at: clock.now() })
      if (method === 'bridge.subscribe') return (script.shift() ?? state.reply)()
      if (method === 'bridge.replay') return state.replay()
      return {}
    },
    validate: (_name, payload) => payload,
    onHandlerError: error => errors.push(error),
    features: () => options.features ?? NO_FEATURES,
    clock,
    ...(retry === undefined ? {} : { retry }),
    onRetry: event => events.push(event),
  })
  const subscribes = () => calls.filter(call => call.method === 'bridge.subscribe')
  const failWith = (error: () => BridgeError, times: number) => {
    for (let i = 0; i < times; i++) {
      script.push(() => {
        throw error()
      })
    }
  }
  return { clock, calls, errors, events, subs, script, state, subscribes, failWith }
}

/** Subscribes `NAME`, then loses the transport the way a popup reload does. */
async function subscribedThenReset(h: ReturnType<typeof harness>, handler: (payload: never, meta: EventMeta) => void = () => undefined) {
  const off = await h.subs.add(NAME, handler)
  h.subs.reset()
  return off
}

describe('Subscriptions: resubscribe retry', () => {
  it('retries a failed attempt after the backoff delay, with a bounded time for every attempt', async () => {
    const h = harness()
    await subscribedThenReset(h)
    h.failWith(timeout, 2)
    const outcome = h.subs.resubscribe()
    await h.clock.settle()
    expect(h.subscribes()).toHaveLength(2) // the subscribe of add() and the first attempt
    await h.clock.advance(249)
    expect(h.subscribes()).toHaveLength(2)
    await h.clock.advance(1)
    expect(h.subscribes()).toHaveLength(3)
    await h.clock.advance(499)
    expect(h.subscribes()).toHaveLength(3)
    await h.clock.advance(1)

    const result: ResubscribeOutcome = await outcome
    expect(result).toMatchObject({ recovered: [NAME], failed: [] })
    expect(h.subscribes().map(call => call.at)).toEqual([0, 0, 250, 750])
    expect(h.subscribes().map(call => call.options)).toEqual([undefined, { timeoutMs: 10_000 }, { timeoutMs: 10_000 }, { timeoutMs: 10_000 }])
    expect(h.errors).toEqual([]) // a failure that was retried successfully is nobody's error
    expect(h.events.map(e => [e.phase, e.attempt, e.delayMs])).toEqual([
      ['scheduled', 1, 250],
      ['attempt', 1, undefined],
      ['scheduled', 2, 500],
      ['attempt', 2, undefined],
      ['recovered', 2, undefined],
    ])
    expect(h.events.every(e => e.target === 'resubscribe' && e.event === NAME)).toBe(true)
    expect(h.events[0]!.error).toMatchObject({ code: 'RPC_TIMEOUT' })
    expect(h.clock.pending).toBe(0)
  })

  it('uses the timeout of the policy for each attempt', async () => {
    const h = harness({ timeoutMs: 1_234 })
    await subscribedThenReset(h)
    await h.subs.resubscribe()
    expect(h.subscribes().at(-1)!.options).toEqual({ timeoutMs: 1_234 })
  })

  it.each(['OVERLOADED', 'INTERNAL'])('retries %s as well', async code => {
    const h = harness()
    await subscribedThenReset(h)
    h.failWith(() => new BridgeError(code, 'try later'), 1)
    const outcome = h.subs.resubscribe()
    await h.clock.advance(250)
    expect(await outcome).toMatchObject({ recovered: [NAME], failed: [] })
  })

  it.each(['CAPABILITY_UNAVAILABLE', 'PERMISSION_DENIED', 'SESSION_CLOSED', 'SESSION_NOT_READY', 'INVALID_PARAMS'])('does not retry %s: waiting cannot fix it', async code => {
    const h = harness()
    await subscribedThenReset(h)
    h.failWith(() => new BridgeError(code, 'no'), 1)
    const outcome = await h.subs.resubscribe()
    expect(outcome).toMatchObject({ recovered: [], failed: [NAME] })
    expect(h.subscribes()).toHaveLength(2)
    expect(h.events).toEqual([])
    expect(h.errors).toHaveLength(1)
    expect(h.clock.pending).toBe(0)
  })

  it('does not retry a failure that is not a bridge error', async () => {
    const h = harness()
    await subscribedThenReset(h)
    h.script.push(() => {
      throw new Error('bug')
    })
    expect(await h.subs.resubscribe()).toMatchObject({ failed: [NAME] })
    expect(h.subscribes()).toHaveLength(2)
  })

  it('gives up after maxRetries, reports the last error once and keeps the handler for another attempt', async () => {
    const h = harness({ retry: { maxRetries: 2 } })
    const seen: EventMeta[] = []
    await subscribedThenReset(h, (_payload, meta) => seen.push(meta))
    h.failWith(timeout, 3)
    const outcome = h.subs.resubscribe()
    await h.clock.advance(250 + 500)
    const result = await outcome
    expect(result).toMatchObject({ recovered: [], failed: [NAME], replay: {} })
    expect(h.subscribes()).toHaveLength(4) // add() + the first attempt + two retries
    expect(h.errors).toHaveLength(1)
    expect(h.errors[0]).toMatchObject({ code: 'RPC_TIMEOUT' })
    expect(h.events.map(e => [e.phase, e.attempt])).toEqual([['scheduled', 1], ['attempt', 1], ['scheduled', 2], ['attempt', 2], ['exhausted', 2]])
    expect(h.events.at(-1)!.error).toMatchObject({ code: 'RPC_TIMEOUT' })

    // The handler is still registered: another resubscribe brings the event back.
    expect(await h.subs.resubscribe()).toMatchObject({ recovered: [NAME], failed: [] })
    h.subs.dispatch({ name: NAME, revision: 1, payload: 1 })
    expect(seen.map(meta => meta.revision)).toEqual([1])
  })

  it('ends a run that fails for good after some retries as exhausted', async () => {
    const h = harness()
    await subscribedThenReset(h)
    h.failWith(timeout, 1)
    h.failWith(() => new BridgeError('CAPABILITY_UNAVAILABLE', 'gone'), 1)
    const outcome = h.subs.resubscribe()
    await h.clock.advance(250)
    expect(await outcome).toMatchObject({ failed: [NAME] })
    expect(h.events.map(e => e.phase)).toEqual(['scheduled', 'attempt', 'exhausted'])
    expect(h.events.at(-1)).toMatchObject({ attempt: 1, error: expect.objectContaining({ code: 'CAPABILITY_UNAVAILABLE' }) })
  })

  it('makes a single attempt, with the default timeout, when retrying is off', async () => {
    const h = harness({ retry: false })
    await subscribedThenReset(h)
    h.failWith(timeout, 1)
    const outcome = await h.subs.resubscribe()
    expect(outcome).toMatchObject({ recovered: [], failed: [NAME] })
    expect(h.subscribes()).toHaveLength(2)
    expect(h.subscribes().at(-1)!.options).toBeUndefined()
    expect(h.events).toEqual([])
    expect(h.clock.pending).toBe(0)
    expect(h.errors).toHaveLength(1)
  })

  it('makes a single attempt for maxRetries 0', async () => {
    const h = harness({ retry: { maxRetries: 0 } })
    await subscribedThenReset(h)
    h.failWith(timeout, 1)
    expect(await h.subs.resubscribe()).toMatchObject({ failed: [NAME] })
    expect(h.subscribes()).toHaveLength(2)
    expect(h.events).toEqual([])
  })

  it('retries every event on its own schedule and merges them into one report', async () => {
    const h = harness()
    await h.subs.add('a.one', () => undefined)
    await h.subs.add('a.two', () => undefined)
    h.subs.reset()
    // `a.one` succeeds at once; `a.two` needs a retry.
    h.script.push(() => ({ revisions: {} }))
    h.script.push(() => {
      throw timeout()
    })
    const outcome = h.subs.resubscribe()
    await h.clock.advance(250)
    const result = await outcome
    expect(result.recovered).toEqual(['a.one', 'a.two'])
    expect(result.failed).toEqual([])
    expect(h.events.filter(e => e.event === 'a.one')).toEqual([])
    expect(h.events.filter(e => e.event === 'a.two').map(e => e.phase)).toEqual(['scheduled', 'attempt', 'recovered'])
  })

  describe('while waiting for a retry', () => {
    it('stops when the transport is replaced: no more attempts, in neither list, nothing left on the clock', async () => {
      const h = harness()
      await subscribedThenReset(h)
      h.failWith(timeout, 99)
      const outcome = h.subs.resubscribe()
      await h.clock.settle()
      expect(h.clock.pending).toBe(1)
      h.subs.reset()
      expect(h.clock.pending).toBe(0)
      expect(await outcome).toEqual({ recovered: [], failed: [], replay: {} })
      await h.clock.advance(60_000)
      expect(h.subscribes()).toHaveLength(2)
      expect(h.errors).toEqual([])
      expect(h.events.map(e => e.phase)).toEqual(['scheduled'])

      // The registration survived, so the next connection resubscribes normally.
      h.script.length = 0
      expect(await h.subs.resubscribe()).toMatchObject({ recovered: [NAME], failed: [] })
    })

    it('stops when the last handler leaves', async () => {
      const h = harness()
      const off = await subscribedThenReset(h)
      h.failWith(timeout, 99)
      const outcome = h.subs.resubscribe()
      await h.clock.settle()
      await off()
      await h.clock.advance(60_000)
      expect(await outcome).toEqual({ recovered: [], failed: [], replay: {} })
      expect(h.subscribes()).toHaveLength(2)
      expect(h.errors).toEqual([])
    })

    it('does not subscribe a second time when add() subscribes the event meanwhile: it joins that', async () => {
      const h = harness()
      const first: EventMeta[] = []
      const second: EventMeta[] = []
      await subscribedThenReset(h, (_payload, meta) => first.push(meta))
      h.failWith(timeout, 1)
      const outcome = h.subs.resubscribe()
      await h.clock.settle()
      await h.subs.add(NAME, (_payload, meta) => second.push(meta)) // succeeds
      await h.clock.advance(250)
      expect(await outcome).toMatchObject({ recovered: [NAME], failed: [] })
      expect(h.subscribes()).toHaveLength(3) // add(), the failed attempt, the second add()
      h.subs.dispatch({ name: NAME, revision: 1, payload: 0 })
      expect([first.length, second.length]).toEqual([1, 1])
    })
  })

  it('recovers missed events on a retry: the position kept for the old connection survives failed attempts', async () => {
    const h = harness({ features: createFeatureSet([FEATURE_EVENTS_REPLAY]) })
    h.state.reply = () => ({ revisions: { [NAME]: 3 }, epoch: 'e1' })
    const seen: Array<[number, unknown, boolean]> = []
    await h.subs.add(NAME, (payload: never, meta) => seen.push([meta.revision, payload, meta.replayed]))
    h.subs.dispatch({ name: NAME, revision: 4, payload: 'four' })
    h.subs.reset()

    // The popup went on to revision 6 meanwhile; the first attempt to ask is lost.
    h.state.reply = () => ({ revisions: { [NAME]: 6 }, epoch: 'e1' })
    h.state.replay = () => ({ epoch: 'e1', revision: 6, oldest: 5, capacity: 8, entries: [{ revision: 5, payload: 'five' }, { revision: 6, payload: 'six' }] })
    h.failWith(timeout, 1)
    const outcome = h.subs.resubscribe()
    await h.clock.advance(250)
    const result = await outcome
    expect(result.replay[NAME]).toEqual({ outcome: 'replayed', replayed: 2, missed: 0 })
    expect(seen).toEqual([
      [4, 'four', false],
      [5, 'five', true],
      [6, 'six', true],
    ])
    expect(h.calls.filter(call => call.method === 'bridge.replay')).toHaveLength(1)
  })
})

// ---- the session on top of it -----------------------------------------------------------------------

function sessionHarness(options: { resubscribeRetry?: false | (BackoffOptions & { timeoutMs?: number }); node?: ReturnType<typeof createBridgeNode> } = {}) {
  const clock = createManualClock({ random: () => 1 })
  // `bridge.subscribe` of the popup goes through its authorize hook, which lets a test make it fail.
  const gate = { failures: 0, attempts: 0, error: (): BridgeError => new BridgeError('OVERLOADED', 'busy') }
  const env = setup({
    clock,
    popupAuthorize: ({ method }) => {
      if (method !== 'bridge.subscribe') return
      gate.attempts += 1
      if (gate.failures > 0) {
        gate.failures -= 1
        throw gate.error()
      }
    },
  })
  const hostErrors: unknown[] = []
  const retries: RetryEvent[] = []
  const reconnects: ReconnectInfo[] = []
  const open = async () => {
    const session = await env.bridge.open(definition, {
      init,
      closedPollMs: 1_000,
      onError: error => hostErrors.push(error),
      ...(options.resubscribeRetry === undefined ? {} : { resubscribeRetry: options.resubscribeRetry }),
      ...(options.node === undefined ? {} : { node: options.node }),
    })
    session.on('retry', event => retries.push(event))
    session.on('reconnect', info => reconnects.push(info))
    const seen: EventMeta[] = []
    await session.subscribe(PROGRESS, (_payload, meta) => seen.push(meta))
    return { session, seen }
  }
  return { clock, gate, hostErrors, retries, reconnects, open, ...env }
}

describe('session: resubscribe retry', () => {
  it('delays reconnect until the subscriptions are back, retrying with backoff', async () => {
    const s = sessionHarness()
    const { session, seen } = await s.open()
    expect(s.gate.attempts).toBe(1)
    s.gate.failures = 2
    s.browser.popups[0]!.reload()

    await vi.waitFor(() => expect(s.retries).toHaveLength(1))
    expect(s.retries[0]).toMatchObject({ target: 'resubscribe', phase: 'scheduled', attempt: 1, delayMs: 250, event: PROGRESS })
    expect(s.reconnects).toEqual([]) // the event is not subscribed yet
    expect(session.state).toBe('READY') // calls work meanwhile
    expect(await session.call('asset.getSnapshot')).toMatchObject({ assetIds: ['a1'] })

    await s.clock.advance(250)
    await vi.waitFor(() => expect(s.retries.at(-1)).toMatchObject({ phase: 'scheduled', attempt: 2, delayMs: 500 }))
    expect(s.reconnects).toEqual([])
    await s.clock.advance(500)
    await vi.waitFor(() => expect(s.reconnects).toHaveLength(1))

    expect(s.reconnects[0]).toMatchObject({ resubscribed: [PROGRESS], failed: [] })
    expect(s.retries.map(e => [e.phase, e.attempt])).toEqual([['scheduled', 1], ['attempt', 1], ['scheduled', 2], ['attempt', 2], ['recovered', 2]])
    expect(s.gate.attempts).toBe(4)
    expect(s.hostErrors).toEqual([])

    // The event flows again.
    s.booted[1]!.runtime.emit(PROGRESS, { percent: 7 })
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    await session.close()
  })

  it('reports reconnect with the event as failed once the retries are used up', async () => {
    const s = sessionHarness({ resubscribeRetry: { maxRetries: 1 } })
    const { session } = await s.open()
    s.gate.failures = 99
    s.browser.popups[0]!.reload()
    await vi.waitFor(() => expect(s.retries).toHaveLength(1))
    await s.clock.advance(250)
    await vi.waitFor(() => expect(s.reconnects).toHaveLength(1))
    expect(s.reconnects[0]).toMatchObject({ resubscribed: [], failed: [PROGRESS] })
    expect(s.retries.map(e => e.phase)).toEqual(['scheduled', 'attempt', 'exhausted'])
    expect(s.retries.at(-1)!.error).toMatchObject({ code: 'OVERLOADED' })
    expect(s.hostErrors).toHaveLength(1)
    expect(s.hostErrors[0]).toMatchObject({ code: 'OVERLOADED' })
    expect(session.state).toBe('READY')
    await session.close()
  })

  it('makes a single attempt when resubscribeRetry is false', async () => {
    const s = sessionHarness({ resubscribeRetry: false })
    const { session } = await s.open()
    s.gate.failures = 1
    s.browser.popups[0]!.reload()
    await vi.waitFor(() => expect(s.reconnects).toHaveLength(1))
    expect(s.reconnects[0]).toMatchObject({ resubscribed: [], failed: [PROGRESS] })
    await s.clock.advance(30_000)
    expect(s.gate.attempts).toBe(2) // add() and the one attempt
    expect(s.retries).toEqual([])
    await session.close()
  })

  it('does not retry an error that waiting cannot fix', async () => {
    const s = sessionHarness()
    const { session } = await s.open()
    s.gate.failures = 1
    s.gate.error = () => new BridgeError('PERMISSION_DENIED', 'not for you')
    s.browser.popups[0]!.reload()
    await vi.waitFor(() => expect(s.reconnects).toHaveLength(1))
    expect(s.reconnects[0]).toMatchObject({ failed: [PROGRESS] })
    expect(s.gate.attempts).toBe(2)
    expect(s.retries).toEqual([])
    await session.close()
  })

  it('abandons the retries of a connection when the popup reloads again, and resubscribes on the new one', async () => {
    const s = sessionHarness()
    const { session } = await s.open()
    s.gate.failures = 99
    s.browser.popups[0]!.reload()
    await vi.waitFor(() => expect(s.retries).toHaveLength(1))
    const attemptsBefore = s.gate.attempts // add() and one failed attempt
    expect(attemptsBefore).toBe(2)

    s.gate.failures = 0
    s.browser.popups[0]!.reload()
    await vi.waitFor(() => expect(s.reconnects).toHaveLength(1))
    expect(s.reconnects[0]).toMatchObject({ resubscribed: [PROGRESS], failed: [] })
    expect(s.gate.attempts).toBe(attemptsBefore + 1) // one attempt on the new connection, none from the old schedule
    await s.clock.advance(30_000)
    expect(s.gate.attempts).toBe(attemptsBefore + 1)
    expect(s.reconnects).toHaveLength(1)
    // The abandoned run reported no outcome of its own.
    expect(s.retries.map(e => e.phase)).toEqual(['scheduled'])
    expect(s.hostErrors).toEqual([])
    await session.close()
  })

  it('stops retrying when the session closes during the wait and leaves no timer behind', async () => {
    const s = sessionHarness()
    const { session } = await s.open()
    s.gate.failures = 99
    // A restored page keeps its runtime (a reload would leave the dead page's timers on the clock).
    s.browser.popups[0]!.freeze()
    await vi.waitFor(() => expect(session.state).toBe('WAITING_HELLO'))
    s.browser.popups[0]!.restore()
    await vi.waitFor(() => expect(s.retries).toHaveLength(1))
    await session.close()
    await s.clock.advance(60_000)
    expect(s.gate.attempts).toBe(2)
    expect(s.reconnects).toEqual([])
    expect(s.clock.pending).toBe(0)
    expect(s.hostErrors).toEqual([])
  })

  it('replays what was missed once a retry gets through', async () => {
    const s = sessionHarness()
    const { session, seen } = await s.open()
    const first = s.booted[0]!.runtime
    first.emit(PROGRESS, { percent: 10 })
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    s.gate.failures = 1
    s.browser.popups[0]!.freeze()
    await vi.waitFor(() => expect(session.state).toBe('WAITING_HELLO'))
    first.emit(PROGRESS, { percent: 20 })
    first.emit(PROGRESS, { percent: 30 })
    s.browser.popups[0]!.restore()
    await vi.waitFor(() => expect(s.retries).toHaveLength(1))
    expect(seen).toHaveLength(1)
    await s.clock.advance(250)
    await vi.waitFor(() => expect(s.reconnects).toHaveLength(1))
    expect(s.reconnects[0]!.replay[PROGRESS]).toEqual({ outcome: 'replayed', replayed: 2, missed: 0 })
    expect(seen.map(meta => [meta.revision, meta.replayed])).toEqual([[1, false], [2, true], [3, true]])
    await session.close()
  })

  it('traces the retries on the node of the page', async () => {
    const node = createBridgeNode()
    const traced: TraceEvent[] = []
    node.onTrace(event => {
      if (event.type === 'retry') traced.push(event)
    })
    const s = sessionHarness({ node })
    const { session } = await s.open()
    s.gate.failures = 1
    s.browser.popups[0]!.reload()
    await vi.waitFor(() => expect(s.retries).toHaveLength(1))
    await s.clock.advance(250)
    await vi.waitFor(() => expect(s.reconnects).toHaveLength(1))
    expect(traced.map(e => (e.type === 'retry' ? [e.target, e.phase, e.attempt, e.delayMs, e.event, e.error, e.role] : undefined))).toEqual([
      ['resubscribe', 'scheduled', 1, 250, PROGRESS, 'OVERLOADED', 'popup'],
      ['resubscribe', 'attempt', 1, undefined, PROGRESS, undefined, 'popup'],
      ['resubscribe', 'recovered', 1, undefined, PROGRESS, undefined, 'popup'],
    ])
    expect(traced.every(e => e.type === 'retry' && e.sessionId === session.sessionId)).toBe(true)
    await session.close()
  })

  it('contains a failing retry listener', async () => {
    const s = sessionHarness()
    const { session } = await s.open()
    session.on('retry', () => {
      throw new Error('listener bug')
    })
    s.gate.failures = 1
    s.browser.popups[0]!.reload()
    await vi.waitFor(() => expect(s.hostErrors.length).toBeGreaterThan(0))
    await s.clock.advance(250)
    await vi.waitFor(() => expect(s.reconnects).toHaveLength(1))
    expect(s.reconnects[0]).toMatchObject({ resubscribed: [PROGRESS], failed: [] })
    await session.close()
  })

  it('refuses invalid resubscribeRetry options before opening a window', async () => {
    const { bridge, browser } = setup()
    for (const bad of [{ maxRetries: -1 }, { jitter: 2 }, { initialMs: 0 }, { timeoutMs: 0 }, { timeoutMs: 1.5 }, { timeoutMs: 2 ** 31 }, { initialMs: 3e9, maxMs: 3e9 }, { maxMs: 5e9 }, true as never]) {
      await expect(bridge.open(definition, { init, resubscribeRetry: bad }), JSON.stringify(bad)).rejects.toThrow(TypeError)
    }
    expect(browser.popups).toHaveLength(0)
  })

  it('refuses a replay timeout no timer can honour', async () => {
    const { bridge, browser } = setup()
    await expect(bridge.open(definition, { init, replay: { timeoutMs: 2 ** 31 } })).rejects.toThrow(/replay\.timeoutMs/)
    expect(browser.popups).toHaveLength(0)
  })
})

// ---- the popup's HELLO retry ------------------------------------------------------------------------

/** A page that opened a popup but never answers it: all it does is record the window messages it gets. */
function silentHost(options: { helloRetry?: false | BackoffOptions; handshakeTimeoutMs?: number; node?: ReturnType<typeof createBridgeNode> } = {}) {
  const clock = createManualClock({ random: () => 1 })
  const browser = createMemoryBrowser({ clock })
  const received: unknown[] = []
  browser.hostEnv.listen(message => received.push(message.data))
  const retries: RetryEvent[] = []
  let runtime!: PopupRuntime<typeof assetContract>
  let outcome: Promise<unknown> = Promise.resolve()
  browser.onPopupLoad(page => {
    runtime = createPopupRuntime({
      contract: assetContract,
      allowedHostOrigins: [browser.hostOrigin],
      env: page.env,
      handshakeTimeoutMs: options.handshakeTimeoutMs ?? 5_000,
      ...(options.helloRetry === undefined ? {} : { helloRetry: options.helloRetry }),
      ...(options.node === undefined ? {} : { node: options.node }),
    })
    runtime.onRetry(event => retries.push(event))
    outcome = runtime.start().then(
      connection => connection,
      (error: unknown) => error,
    )
  })
  const sessionId = 'session-under-test'
  browser.hostEnv.open(attachSession(definition.url, sessionId), {})
  const hellos = () => received.filter(isHello) as Array<{ kind: string; sessionId: string; instanceId: string; protocolVersions: string[]; features?: string[] }>
  return { clock, browser, retries, sessionId, hellos, runtime: () => runtime, outcome: () => outcome }
}

describe('popup: HELLO retry', () => {
  it('sends the same HELLO again while nobody answers, on the backoff schedule', async () => {
    const h = silentHost()
    await h.clock.settle()
    expect(h.hellos()).toHaveLength(1)
    await h.clock.advance(249)
    expect(h.hellos()).toHaveLength(1)
    await h.clock.advance(1)
    expect(h.hellos()).toHaveLength(2)
    await h.clock.advance(499)
    expect(h.hellos()).toHaveLength(2)
    await h.clock.advance(1)
    expect(h.hellos()).toHaveLength(3)
    await h.clock.advance(1_000)
    expect(h.hellos()).toHaveLength(4)

    const [first, ...repeats] = h.hellos()
    expect(first!.sessionId).toBe(h.sessionId)
    expect(first!.features).toBeDefined()
    // The same message of the same page instance: a new instance id would read as a reload.
    for (const repeat of repeats) expect(repeat).toEqual(first)
    expect(h.retries.map(e => [e.phase, e.attempt, e.delayMs])).toEqual([
      ['scheduled', 1, 250],
      ['attempt', 1, undefined],
      ['scheduled', 2, 500],
      ['attempt', 2, undefined],
      ['scheduled', 3, 1000],
      ['attempt', 3, undefined],
      ['scheduled', 4, 2000],
    ])
    expect(h.retries.every(e => e.target === 'hello' && e.event === undefined)).toBe(true)
  })

  it('stops after maxRetries, calls the run exhausted, and fails at the handshake deadline with the number of attempts', async () => {
    const h = silentHost({ helloRetry: { maxRetries: 2 } })
    await h.clock.advance(4_999)
    expect(h.hellos()).toHaveLength(3) // the first and two retries, at 0, 250 and 750
    expect(h.retries.map(e => [e.phase, e.attempt])).toEqual([['scheduled', 1], ['attempt', 1], ['scheduled', 2], ['attempt', 2], ['exhausted', 2]])
    await h.clock.advance(1)
    const failure = (await h.outcome()) as BridgeError
    expect(failure).toBeInstanceOf(BridgeError)
    expect(failure.code).toBe('HANDSHAKE_TIMEOUT')
    expect(failure.data).toEqual({ timeoutMs: 5_000, attempts: 3 })
    expect(h.runtime().state).toBe('FAILED')
    expect(h.clock.pending).toBe(0)
  })

  it('sends HELLO once when helloRetry is false', async () => {
    const h = silentHost({ helloRetry: false })
    await h.clock.advance(5_000)
    expect(h.hellos()).toHaveLength(1)
    expect(h.retries).toEqual([])
    const failure = (await h.outcome()) as BridgeError
    expect(failure.data).toEqual({ timeoutMs: 5_000, attempts: 1 })
  })

  it('stops repeating when the handshake deadline comes first, with no timer left over', async () => {
    const h = silentHost({ handshakeTimeoutMs: 600 })
    await h.clock.advance(600)
    expect(h.hellos()).toHaveLength(2) // 0 and 250; the retry due at 750 never happens
    const failure = (await h.outcome()) as BridgeError
    expect(failure.data).toEqual({ timeoutMs: 600, attempts: 2 })
    expect(h.clock.pending).toBe(0)
    await h.clock.advance(10_000)
    expect(h.hellos()).toHaveLength(2)
  })

  it('stops repeating when the popup is closed', async () => {
    const h = silentHost()
    await h.clock.advance(300)
    expect(h.hellos()).toHaveLength(2)
    h.runtime().close()
    expect(h.clock.pending).toBe(0)
    await h.clock.advance(10_000)
    expect(h.hellos()).toHaveLength(2)
  })

  it('honors the policy given, and a policy of zero retries means one HELLO', async () => {
    const custom = silentHost({ helloRetry: { initialMs: 100, factor: 3, maxMs: 500, jitter: 0, maxRetries: 3 } })
    await custom.clock.advance(2_000)
    expect(custom.retries.filter(e => e.phase === 'scheduled').map(e => e.delayMs)).toEqual([100, 300, 500])
    expect(custom.hellos()).toHaveLength(4)

    const none = silentHost({ helloRetry: { maxRetries: 0 } })
    await none.clock.advance(2_000)
    expect(none.hellos()).toHaveLength(1)
    expect(none.retries).toEqual([])
  })

  it('refuses invalid helloRetry options when the runtime is created', () => {
    const browser = createMemoryBrowser()
    browser.hostEnv.open(attachSession(definition.url, 's'), {})
    const env = browser.popups[0]!.page.env
    for (const bad of [{ maxRetries: -1 }, { factor: 0 }, { jitter: 5 }, { initialMs: 100, maxMs: 10 }, true as never]) {
      expect(() => createPopupRuntime({ allowedHostOrigins: [browser.hostOrigin], env, helloRetry: bad }), JSON.stringify(bad)).toThrow(TypeError)
    }
  })

  it('stops repeating once the host answers, and recovers when it needed retries', async () => {
    const node = createBridgeNode()
    const traced: TraceEvent[] = []
    node.onTrace(event => {
      if (event.type === 'retry') traced.push(event)
    })
    const clock = createManualClock({ random: () => 1 })
    const s = setup({ clock, popupHandshakeTimeoutMs: 5_000, popupNode: node })
    const hellos: unknown[] = []
    s.browser.hostEnv.listen(message => {
      if (isHello(message.data)) hellos.push(message.data)
    })
    // The page was not listening when the popup spoke the first two times.
    const lost = s.browser.dropWindowMessages(isHello, 2)
    const opening = s.bridge.open(definition, { init })
    await clock.advance(249)
    expect(s.booted[0]!.runtime.state).toBe('WAITING_CONNECT')
    await clock.advance(1)
    await clock.advance(500)
    const session = await opening
    expect(session.state).toBe('READY')
    expect(lost.dropped).toBe(2)
    expect(hellos).toHaveLength(1) // the third one is the first to arrive

    expect(traced.map(e => (e.type === 'retry' ? [e.target, e.phase, e.attempt, e.delayMs, e.role] : undefined))).toEqual([
      ['hello', 'scheduled', 1, 250, 'host'],
      ['hello', 'attempt', 1, undefined, 'host'],
      ['hello', 'scheduled', 2, 500, 'host'],
      ['hello', 'attempt', 2, undefined, 'host'],
      ['hello', 'scheduled', 3, 1000, 'host'],
      ['hello', 'recovered', 2, undefined, 'host'],
    ])
    // Nothing is sent after the handshake.
    await clock.advance(5_000)
    expect(hellos).toHaveLength(1)
    expect(traced).toHaveLength(6)
    await session.close()
  })

  it('does not repeat or report anything for a host that answers at once', async () => {
    const clock = createManualClock({ random: () => 1 })
    const node = createBridgeNode()
    const traced: TraceEvent[] = []
    node.onTrace(event => {
      if (event.type === 'retry') traced.push(event)
    })
    const s = setup({ clock, popupHandshakeTimeoutMs: 5_000, popupNode: node })
    const hellos: unknown[] = []
    s.browser.hostEnv.listen(message => {
      if (isHello(message.data)) hellos.push(message.data)
    })
    const session = await s.bridge.open(definition, { init })
    await clock.advance(5_000)
    expect(hellos).toHaveLength(1)
    expect(traced.filter(e => e.type === 'retry' && (e.phase === 'attempt' || e.phase === 'recovered' || e.phase === 'exhausted'))).toEqual([])
    await session.close()
  })

  it('does not answer a repeated HELLO of an instance the host already connected', async () => {
    const clock = createManualClock({ random: () => 1 })
    const s = setup({ clock, popupHandshakeTimeoutMs: 5_000 })
    const hellos: unknown[] = []
    s.browser.hostEnv.listen(message => {
      if (isHello(message.data)) hellos.push(message.data)
    })
    let connects = 0
    s.browser.dropWindowMessages(message => {
      if (isConnect(message)) connects += 1
      return false
    })
    // The CONNECT is lost on its way, so the popup keeps announcing itself to a host that is waiting for its READY.
    const lostConnect = s.browser.dropWindowMessages(isConnect, 1)
    const node = createBridgeNode()
    const opening = s.bridge.open(definition, { init, handshakeTimeoutMs: 3_000, node })
    const settled = opening.then(
      () => undefined,
      (error: unknown) => error,
    )
    await clock.advance(1_000)
    expect(hellos.length).toBeGreaterThanOrEqual(3)
    expect(lostConnect.dropped).toBe(1)
    expect(connects).toBe(1)
    expect(node.inspect().links.map(link => link.status)).toEqual(['INITIALIZING'])
    expect(s.securityEvents).toEqual([])
    await clock.advance(2_000)
    expect(((await settled) as BridgeError).code).toBe('HANDSHAKE_TIMEOUT')
  })

  it('announces a page restored from the back/forward cache again when the first HELLO is lost', async () => {
    const clock = createManualClock({ random: () => 1 })
    const s = setup({ clock, popupHandshakeTimeoutMs: 5_000 })
    const hellos: Array<{ instanceId: string }> = []
    s.browser.hostEnv.listen(message => {
      if (isHello(message.data)) hellos.push(message.data as { instanceId: string })
    })
    const session = await s.bridge.open(definition, { init })
    const reconnects: ReconnectInfo[] = []
    session.on('reconnect', info => reconnects.push(info))
    const seen: EventMeta[] = []
    await session.subscribe(PROGRESS, (_payload, meta) => seen.push(meta))
    s.booted[0]!.runtime.emit(PROGRESS, { percent: 1 })
    await vi.waitFor(() => expect(seen).toHaveLength(1))

    s.browser.popups[0]!.freeze()
    await vi.waitFor(() => expect(session.state).toBe('WAITING_HELLO'))
    s.booted[0]!.runtime.emit(PROGRESS, { percent: 2 })
    const lost = s.browser.dropWindowMessages(isHello, 1)
    s.browser.popups[0]!.restore()
    await clock.settle()
    expect(lost.dropped).toBe(1)
    expect(session.state).toBe('WAITING_HELLO')
    expect(reconnects).toEqual([])

    await clock.advance(250)
    await vi.waitFor(() => expect(reconnects).toHaveLength(1))
    expect(session.state).toBe('READY')
    expect(hellos).toHaveLength(2) // the page's first, and the restored page's retry
    expect(hellos[1]!.instanceId).not.toBe(hellos[0]!.instanceId)
    // The restored page continues its revisions, so what it emitted while cached is replayed.
    expect(reconnects[0]!.replay[PROGRESS]).toEqual({ outcome: 'replayed', replayed: 1, missed: 0 })
    expect(seen.map(meta => [meta.revision, meta.replayed])).toEqual([[1, false], [2, true]])
    await session.close()
  })
})

describe('host: late HELLO of a page it let go', () => {
  it('ignores a HELLO of an instance whose unload it already processed', async () => {
    const clock = createManualClock({ random: () => 1 })
    const s = setup({ clock, popupHandshakeTimeoutMs: 5_000 })
    const hellos: unknown[] = []
    s.browser.hostEnv.listen(message => {
      if (isHello(message.data)) hellos.push(message.data)
    })
    const session = await s.bridge.open(definition, { init })
    const reconnects: ReconnectInfo[] = []
    session.on('reconnect', info => reconnects.push(info))
    const oldHello = hellos[0]!

    s.browser.popups[0]!.freeze() // pagehide: the 'unload' goes over the port
    await vi.waitFor(() => expect(session.state).toBe('WAITING_HELLO'))

    // A retry of the old page's HELLO that was still on its way arrives only now.
    s.browser.popups[0]!.page.env.host!.postMessage(oldHello, s.browser.hostOrigin)
    await clock.advance(100)
    expect(session.state).toBe('WAITING_HELLO') // not CONNECTING: nobody would answer
    expect(s.securityEvents).toEqual([])

    // The page that is really there still gets in.
    s.browser.popups[0]!.restore()
    await vi.waitFor(() => expect(reconnects).toHaveLength(1))
    expect(session.state).toBe('READY')
    await session.close()
  })

  it('still accepts an instance it has never seen, such as a reloaded page', async () => {
    const { bridge, browser } = setup()
    const session = await bridge.open(definition, { init })
    const reconnected = vi.fn()
    session.on('reconnect', reconnected)
    browser.popups[0]!.reload()
    await vi.waitFor(() => expect(reconnected).toHaveBeenCalledTimes(1))
    browser.popups[0]!.reload()
    await vi.waitFor(() => expect(reconnected).toHaveBeenCalledTimes(2))
    await session.close()
  })
})

// ---- the testing utility ----------------------------------------------------------------------------

describe('MemoryBrowser.dropWindowMessages', () => {
  function pair() {
    const browser = createMemoryBrowser()
    const got: unknown[] = []
    browser.hostEnv.listen(message => got.push(message.data))
    browser.hostEnv.open('https://tools.example.com/popup', {})
    const host = browser.popups[0]!.page.env.host!
    const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))
    return { browser, got, host, flush, send: (n: number) => host.postMessage({ kind: 'bridge.test', n }, browser.hostOrigin) }
  }

  it('loses the first `count` matching messages and lets the rest through', async () => {
    const { browser, got, send, flush } = pair()
    const handle = browser.dropWindowMessages(isMessage('bridge.test'), 2)
    for (const n of [1, 2, 3, 4]) send(n)
    await flush()
    expect(got).toEqual([{ kind: 'bridge.test', n: 3 }, { kind: 'bridge.test', n: 4 }])
    expect(handle.dropped).toBe(2)
  })

  it('drops every match until stopped when no count is given', async () => {
    const { browser, got, send, flush } = pair()
    const handle = browser.dropWindowMessages(isMessage('bridge.test'))
    send(1)
    send(2)
    handle.stop()
    send(3)
    await flush()
    expect(got).toEqual([{ kind: 'bridge.test', n: 3 }])
    expect(handle.dropped).toBe(2)
  })

  it('leaves messages alone that do not match, and tells the matcher where a message travels', async () => {
    const { browser, got, host, flush } = pair()
    const routes: unknown[] = []
    browser.dropWindowMessages((message, route) => {
      routes.push(route)
      return (message as { n?: number }).n === 2
    })
    host.postMessage({ n: 1 }, browser.hostOrigin)
    host.postMessage({ n: 2 }, browser.hostOrigin)
    await flush()
    expect(got).toEqual([{ n: 1 }])
    expect(routes[0]).toEqual({ from: 'https://tools.example.com', to: browser.hostOrigin })
  })

  it('does not see messages the browser would drop anyway', async () => {
    const { browser, host, flush } = pair()
    const match = vi.fn(() => true)
    const handle = browser.dropWindowMessages(match)
    host.postMessage({ n: 1 }, 'https://elsewhere.example.com')
    await flush()
    expect(match).not.toHaveBeenCalled()
    expect(handle.dropped).toBe(0)
  })

  it('drops nothing for a count of 0, and only the first of two overlapping rules takes a message', async () => {
    const { browser, got, send, flush } = pair()
    const none = browser.dropWindowMessages(() => true, 0)
    send(1)
    await flush()
    expect(got).toHaveLength(1)
    expect(none.dropped).toBe(0)

    const a = browser.dropWindowMessages(() => true, 1)
    const b = browser.dropWindowMessages(() => true, 1)
    send(2)
    send(3)
    send(4)
    await flush()
    expect(got.map(m => (m as { n: number }).n)).toEqual([1, 4])
    expect([a.dropped, b.dropped]).toEqual([1, 1])
  })
})
