import { describe, expect, it, vi } from 'vitest'
import type { ReplayEntry } from '../src/events/replay.js'
import { Subscriptions, type EventMeta, type ResyncResult } from '../src/host/subscriptions.js'
import { BridgeError } from '../src/protocol/errors.js'
import { FEATURE_EVENTS_REPLAY, NO_FEATURES, createFeatureSet } from '../src/protocol/features.js'

function make(revisions: Record<string, number> = {}) {
  const call = vi.fn(async (method: string) => (method === 'bridge.subscribe' ? { revisions } : {}))
  const errors: unknown[] = []
  const subs = new Subscriptions({ call, validate: (_n, payload) => payload, onHandlerError: e => errors.push(e), features: () => NO_FEATURES })
  return { subs, call, errors }
}

describe('Subscriptions revision tracking', () => {
  it('flags gaps, drops stale and duplicate events, and starts from the revision of the subscribe reply', async () => {
    const { subs } = make({ 'a.changed': 5 })
    const metas: EventMeta[] = []
    await subs.add('a.changed', (_p, meta) => metas.push(meta))
    subs.dispatch({ name: 'a.changed', revision: 6, payload: 1 })
    subs.dispatch({ name: 'a.changed', revision: 9, payload: 2 })
    subs.dispatch({ name: 'a.changed', revision: 9, payload: 2 })
    subs.dispatch({ name: 'a.changed', revision: 7, payload: 3 })
    expect(metas.map(m => [m.revision, m.gap, m.missed])).toEqual([[6, false, 0], [9, true, 2]])
  })

  it('subscribes once on the wire per event and unsubscribes with the last handler', async () => {
    const { subs, call } = make()
    const off1 = await subs.add('a.changed', () => undefined)
    const off2 = await subs.add('a.changed', () => undefined)
    expect(call.mock.calls.filter(c => c[0] === 'bridge.subscribe')).toHaveLength(1)
    await off1()
    expect(call.mock.calls.some(c => c[0] === 'bridge.unsubscribe')).toBe(false)
    await off2()
    await off2()
    expect(call.mock.calls.filter(c => c[0] === 'bridge.unsubscribe')).toHaveLength(1)
  })

  it('isolates handler failures and reports them', async () => {
    const { subs, errors } = make()
    const ok = vi.fn()
    await subs.add('a.changed', () => { throw new Error('handler bug') })
    await subs.add('a.changed', ok)
    subs.dispatch({ name: 'a.changed', revision: 1, payload: null })
    expect(ok).toHaveBeenCalledTimes(1)
    expect(errors).toHaveLength(1)
  })

  it('re-subscribes after a transport reset and forgets old revisions', async () => {
    const { subs, call } = make()
    const metas: EventMeta[] = []
    await subs.add('a.changed', (_p, meta) => metas.push(meta))
    subs.dispatch({ name: 'a.changed', revision: 4, payload: 0 })
    subs.reset()
    await subs.resubscribe()
    expect(call.mock.calls.filter(c => c[0] === 'bridge.subscribe')).toHaveLength(2)
    subs.dispatch({ name: 'a.changed', revision: 1, payload: 0 })
    expect(metas.map(m => m.revision)).toEqual([4, 1])
  })

  it('ignores malformed notifications', async () => {
    const { subs } = make()
    const handler = vi.fn()
    await subs.add('a.changed', handler)
    subs.dispatch(null)
    subs.dispatch({ name: 'a.changed' })
    subs.dispatch({ name: 5, revision: 1 })
    expect(handler).not.toHaveBeenCalled()
  })
})

const NAME = 'a.progress'

/** A scripted popup: answers bridge.subscribe and bridge.replay from `state`, the way a real runtime would. */
function fakePopup(initial: Partial<PopupState> = {}) {
  const state: PopupState = { epoch: 'epoch-1', revision: 0, capacity: 8, entries: [], replayError: undefined, subscribeError: undefined, gate: undefined, reply: undefined, ...initial }
  const calls: Array<{ method: string; params: unknown; options: unknown }> = []
  const errors: unknown[] = []
  let features = createFeatureSet([FEATURE_EVENTS_REPLAY])
  const subs = new Subscriptions({
    call: async (method, params, options) => {
      calls.push({ method, params, options })
      if (method === 'bridge.subscribe') {
        if (state.subscribeError !== undefined) throw state.subscribeError
        return { revisions: { [NAME]: state.revision }, ...(features.has(FEATURE_EVENTS_REPLAY) || state.forceEpoch === true ? { epoch: state.epoch } : {}) }
      }
      if (method === 'bridge.replay') {
        await state.gate
        if (state.replayError !== undefined) throw state.replayError
        if (state.reply !== undefined) return state.reply
        const since = (params as { since: number }).since
        const entries = state.entries.filter(entry => entry.revision > since)
        return {
          epoch: state.epoch,
          revision: state.revision,
          oldest: state.entries[0]?.revision ?? state.revision + 1,
          capacity: state.capacity,
          entries,
        }
      }
      return {}
    },
    validate: (_name, payload) => payload,
    onHandlerError: error => errors.push(error),
    features: () => features,
    limits: state.limits ?? {},
  })
  /** The popup emits revision n: buffered, and sent live unless `lost`. */
  const emit = (revision: number, options: { lost?: boolean } = {}) => {
    state.revision = revision
    state.entries.push({ revision, payload: revision })
    if (state.entries.length > state.capacity) state.entries.shift()
    if (options.lost !== true) subs.dispatch({ name: NAME, revision, payload: revision })
  }
  const replays = () => calls.filter(call => call.method === 'bridge.replay')
  return { subs, state, calls, errors, emit, replays, setFeatures: (next: readonly string[]) => { features = createFeatureSet(next) } }
}

type PopupState = {
  epoch: string
  revision: number
  capacity: number
  entries: ReplayEntry[]
  replayError: unknown
  subscribeError: unknown
  gate: Promise<void> | undefined
  reply: unknown
  limits?: { replayTimeoutMs?: number; maxHeld?: number }
  /** The popup names its epoch even when replay was not agreed (a popup that disregards the negotiation). */
  forceEpoch?: boolean
}

const summary = (metas: EventMeta[]) => metas.map(m => [m.revision, m.gap, m.missed, m.replayed])

describe('replay recovery of a live gap', () => {
  it('fetches the skipped events and delivers everything in order without a gap', async () => {
    const popup = fakePopup()
    const metas: EventMeta[] = []
    await popup.subs.add(NAME, (_p, meta) => metas.push(meta))
    popup.emit(1)
    popup.emit(2, { lost: true })
    popup.emit(3, { lost: true })
    popup.emit(4)
    await vi.waitFor(() => expect(metas).toHaveLength(4))
    // 2 and 3 come from the buffer, 4 is the live event that revealed the hole (and the buffer holds it too).
    expect(summary(metas)).toEqual([[1, false, 0, false], [2, false, 0, true], [3, false, 0, true], [4, false, 0, true]])
    expect(popup.replays()).toHaveLength(1)
    expect(popup.replays()[0]!.params).toEqual({ name: NAME, since: 1 })
    expect(popup.replays()[0]!.options).toEqual({ timeoutMs: 5000 })
    popup.emit(5)
    expect(metas.at(-1)).toMatchObject({ revision: 5, gap: false, replayed: false })
  })

  it('holds live events while the request is out and drops those the reply already contained', async () => {
    const popup = fakePopup()
    let release!: () => void
    popup.state.gate = new Promise<void>(resolve => (release = resolve))
    const metas: EventMeta[] = []
    await popup.subs.add(NAME, (_p, meta) => metas.push(meta))
    popup.emit(1)
    popup.emit(2, { lost: true })
    popup.emit(3) // reveals the gap and waits
    popup.emit(4) // arrives during the request
    popup.emit(5)
    expect(summary(metas)).toEqual([[1, false, 0, false]])
    release()
    await vi.waitFor(() => expect(metas).toHaveLength(5))
    expect(metas.map(m => m.revision)).toEqual([1, 2, 3, 4, 5])
    expect(metas.map(m => m.gap)).toEqual([false, false, false, false, false])
    expect(popup.replays()).toHaveLength(1)
  })

  it('flags a gap when the buffer no longer reaches back far enough', async () => {
    const popup = fakePopup({ capacity: 2 })
    const metas: EventMeta[] = []
    await popup.subs.add(NAME, (_p, meta) => metas.push(meta))
    popup.emit(1)
    for (const revision of [2, 3, 4, 5]) popup.emit(revision, { lost: true })
    popup.emit(6)
    await vi.waitFor(() => expect(metas).toHaveLength(3))
    // The buffer holds 5 and 6: 2..4 are gone and the first replayed event says so.
    expect(summary(metas)).toEqual([[1, false, 0, false], [5, true, 3, true], [6, false, 0, true]])
  })

  it('delivers a live event the buffer no longer holds, in order, between the replayed ones', async () => {
    const popup = fakePopup({ capacity: 2 })
    let release!: () => void
    popup.state.gate = new Promise<void>(resolve => (release = resolve))
    const metas: EventMeta[] = []
    await popup.subs.add(NAME, (_p, meta) => metas.push(meta))
    for (const revision of [1, 2, 3, 4, 5]) popup.emit(revision)
    popup.emit(6, { lost: true })
    popup.emit(7, { lost: true })
    popup.emit(8) // reveals the gap and waits
    popup.emit(9) // arrives during the request
    popup.emit(10)
    release()
    await vi.waitFor(() => expect(metas.map(m => m.revision)).toEqual([1, 2, 3, 4, 5, 8, 9, 10]))
    // The buffer holds 9 and 10 only: 8 came live, was held and must not be lost; 6 and 7 are the real gap.
    expect(summary(metas.slice(5))).toEqual([[8, true, 2, false], [9, false, 0, true], [10, false, 0, true]])
  })

  it('does not ask again for a hole it already knows cannot be filled', async () => {
    const popup = fakePopup({ capacity: 1 })
    const metas: EventMeta[] = []
    await popup.subs.add(NAME, (_p, meta) => metas.push(meta))
    popup.emit(1)
    popup.emit(2, { lost: true })
    popup.emit(3, { lost: true })
    popup.emit(4)
    await vi.waitFor(() => expect(metas).toHaveLength(2))
    expect(summary(metas)).toEqual([[1, false, 0, false], [4, true, 2, true]])
    popup.emit(5)
    expect(popup.replays()).toHaveLength(1)
    expect(metas.at(-1)).toMatchObject({ revision: 5, gap: false })
  })

  it('stops asking once the popup reports it keeps no history for the event', async () => {
    const popup = fakePopup({ capacity: 0 })
    popup.state.entries = []
    const metas: EventMeta[] = []
    await popup.subs.add(NAME, (_p, meta) => metas.push(meta))
    popup.state.revision = 0
    popup.subs.dispatch({ name: NAME, revision: 1, payload: 1 })
    popup.state.revision = 3
    popup.subs.dispatch({ name: NAME, revision: 3, payload: 3 })
    await vi.waitFor(() => expect(metas).toHaveLength(2))
    expect(summary(metas)).toEqual([[1, false, 0, false], [3, true, 1, false]])
    popup.state.revision = 6
    popup.subs.dispatch({ name: NAME, revision: 6, payload: 6 })
    expect(metas.at(-1)).toMatchObject({ revision: 6, gap: true, missed: 2 })
    expect(popup.replays()).toHaveLength(1)
  })

  it('does not ask at all when replay was not agreed', async () => {
    const popup = fakePopup()
    popup.setFeatures([])
    const metas: EventMeta[] = []
    await popup.subs.add(NAME, (_p, meta) => metas.push(meta))
    popup.emit(1)
    popup.emit(2, { lost: true })
    popup.emit(3)
    expect(summary(metas)).toEqual([[1, false, 0, false], [3, true, 1, false]])
    expect(popup.replays()).toHaveLength(0)
    expect(popup.calls.find(c => c.method === 'bridge.subscribe')).toBeDefined()
  })

  it('degrades silently when the popup cannot replay and reports other failures once', async () => {
    const silent = fakePopup()
    silent.state.replayError = new BridgeError('METHOD_NOT_FOUND', 'no such method')
    const metas: EventMeta[] = []
    await silent.subs.add(NAME, (_p, meta) => metas.push(meta))
    silent.emit(1)
    silent.emit(2, { lost: true })
    silent.emit(3)
    await vi.waitFor(() => expect(metas).toHaveLength(2))
    expect(summary(metas)).toEqual([[1, false, 0, false], [3, true, 1, false]])
    expect(silent.errors).toEqual([])

    const noisy = fakePopup()
    noisy.state.replayError = new BridgeError('RPC_TIMEOUT', 'bridge.replay timed out')
    const noisyMetas: EventMeta[] = []
    await noisy.subs.add(NAME, (_p, meta) => noisyMetas.push(meta))
    noisy.emit(1)
    noisy.emit(2, { lost: true })
    noisy.emit(3)
    await vi.waitFor(() => expect(noisyMetas).toHaveLength(2))
    // The failure costs the recovery, not the event: it is still delivered, flagged as a gap.
    expect(summary(noisyMetas)).toEqual([[1, false, 0, false], [3, true, 1, false]])
    expect(noisy.errors).toHaveLength(1)
    expect((noisy.errors[0] as BridgeError).code).toBe('RPC_TIMEOUT')
  })

  it('refuses a malformed reply as a whole and falls back to the gap', async () => {
    const popup = fakePopup()
    popup.state.reply = { epoch: 'epoch-1', revision: 3, oldest: 2, capacity: 8, entries: [{ revision: 3, payload: 3 }, { revision: 2, payload: 2 }] }
    const metas: EventMeta[] = []
    await popup.subs.add(NAME, (_p, meta) => metas.push(meta))
    popup.emit(1)
    popup.emit(2, { lost: true })
    popup.emit(3)
    await vi.waitFor(() => expect(metas).toHaveLength(2))
    expect(summary(metas)).toEqual([[1, false, 0, false], [3, true, 1, false]])
    expect(popup.errors).toHaveLength(1)
    expect((popup.errors[0] as BridgeError).code).toBe('INVALID_RESULT')
  })

  it('treats a changed epoch as a new popup: no replay, revisions start over', async () => {
    const popup = fakePopup()
    const metas: EventMeta[] = []
    await popup.subs.add(NAME, (_p, meta) => metas.push(meta))
    popup.emit(1)
    popup.emit(2, { lost: true })
    // The popup was replaced behind the same transport: its buffer belongs to another history.
    popup.state.epoch = 'epoch-2'
    popup.state.entries = [{ revision: 1, payload: 'other' }, { revision: 2, payload: 'other' }]
    popup.state.revision = 2
    popup.subs.dispatch({ name: NAME, revision: 3, payload: 3 })
    await vi.waitFor(() => expect(metas).toHaveLength(2))
    expect(popup.replays()).toHaveLength(1)
    // Nothing of the other history is delivered; the stream continues from the new popup's revision.
    expect(summary(metas)).toEqual([[1, false, 0, false], [3, false, 0, false]])
  })

  it('delivers nothing after the transport was replaced while a request was out', async () => {
    const popup = fakePopup()
    let release!: () => void
    popup.state.gate = new Promise<void>(resolve => (release = resolve))
    const metas: EventMeta[] = []
    await popup.subs.add(NAME, (_p, meta) => metas.push(meta))
    popup.emit(1)
    popup.emit(2, { lost: true })
    popup.emit(3)
    popup.subs.reset()
    release()
    await new Promise(r => setTimeout(r, 10))
    expect(summary(metas)).toEqual([[1, false, 0, false]])
  })

  it('delivers nothing after the last handler unsubscribed during a request', async () => {
    const popup = fakePopup()
    let release!: () => void
    popup.state.gate = new Promise<void>(resolve => (release = resolve))
    const metas: EventMeta[] = []
    const off = await popup.subs.add(NAME, (_p, meta) => metas.push(meta))
    popup.emit(1)
    popup.emit(2, { lost: true })
    popup.emit(3)
    await off()
    release()
    await new Promise(r => setTimeout(r, 10))
    expect(metas.map(m => m.revision)).toEqual([1])
  })

  it('bounds what it holds: the oldest held event is dropped and the hole shows as a gap', async () => {
    const popup = fakePopup({ limits: { maxHeld: 2 } })
    let release!: () => void
    popup.state.gate = new Promise<void>(resolve => (release = resolve))
    // The reply is useless (nothing buffered), so only the held events remain.
    popup.state.capacity = 0
    const metas: EventMeta[] = []
    await popup.subs.add(NAME, (_p, meta) => metas.push(meta))
    popup.emit(1)
    popup.emit(2, { lost: true })
    for (const revision of [3, 4, 5, 6]) popup.emit(revision)
    release()
    await vi.waitFor(() => expect(metas.length).toBeGreaterThanOrEqual(3))
    expect(summary(metas)).toEqual([[1, false, 0, false], [5, true, 3, false], [6, false, 0, false]])
  })
})

describe('initial subscription race', () => {
  it('holds events that arrive before the subscribe reply and delivers only the newer ones', async () => {
    let answer!: (value: unknown) => void
    const subs = new Subscriptions({
      call: () => new Promise(resolve => (answer = resolve)),
      validate: (_n, payload) => payload,
      onHandlerError: () => undefined,
      features: () => NO_FEATURES,
    })
    const metas: EventMeta[] = []
    const added = subs.add(NAME, (_p, meta) => metas.push(meta))
    // Sent by the popup after it registered the subscription but before the reply reached the host.
    subs.dispatch({ name: NAME, revision: 5, payload: 'old' })
    subs.dispatch({ name: NAME, revision: 6, payload: 'new' })
    expect(metas).toEqual([])
    answer({ revisions: { [NAME]: 5 } })
    await added
    expect(summary(metas)).toEqual([[6, false, 0, false]])
    subs.dispatch({ name: NAME, revision: 7, payload: 'next' })
    expect(summary(metas)).toEqual([[6, false, 0, false], [7, false, 0, false]])
  })

  it('does not let a late subscribe reply move the revision backwards', async () => {
    let answer!: (value: unknown) => void
    const subs = new Subscriptions({
      call: () => new Promise(resolve => (answer = resolve)),
      validate: (_n, payload) => payload,
      onHandlerError: () => undefined,
      features: () => NO_FEATURES,
    })
    const metas: EventMeta[] = []
    const added = subs.add(NAME, (_p, meta) => metas.push(meta))
    subs.dispatch({ name: NAME, revision: 3, payload: 3 })
    answer({ revisions: { [NAME]: 2 } })
    await added
    subs.dispatch({ name: NAME, revision: 4, payload: 4 })
    expect(summary(metas)).toEqual([[3, false, 0, false], [4, false, 0, false]])
  })
})

describe('resubscribe after the transport was replaced', () => {
  it('replays what the same popup runtime buffered meanwhile', async () => {
    const popup = fakePopup()
    const metas: EventMeta[] = []
    await popup.subs.add(NAME, (_p, meta) => metas.push(meta))
    popup.emit(1)
    popup.subs.reset()
    popup.emit(2, { lost: true })
    popup.emit(3, { lost: true })
    const outcome = await popup.subs.resubscribe()
    expect(outcome).toEqual({ recovered: [NAME], failed: [], replay: { [NAME]: { outcome: 'replayed', replayed: 2, missed: 0 } } })
    expect(summary(metas)).toEqual([[1, false, 0, false], [2, false, 0, true], [3, false, 0, true]])
    popup.emit(4)
    expect(metas.at(-1)).toMatchObject({ revision: 4, gap: false, replayed: false })
  })

  it('reports current when nothing was missed', async () => {
    const popup = fakePopup()
    await popup.subs.add(NAME, () => undefined)
    popup.emit(1)
    popup.subs.reset()
    const outcome = await popup.subs.resubscribe()
    expect(outcome.replay[NAME]).toEqual({ outcome: 'current', replayed: 0, missed: 0 })
    expect(popup.replays()).toHaveLength(0)
  })

  it('counts what the buffer no longer holds as missed', async () => {
    const popup = fakePopup({ capacity: 2 })
    const metas: EventMeta[] = []
    await popup.subs.add(NAME, (_p, meta) => metas.push(meta))
    popup.emit(1)
    popup.subs.reset()
    for (const revision of [2, 3, 4, 5]) popup.emit(revision, { lost: true })
    const outcome = await popup.subs.resubscribe()
    expect(outcome.replay[NAME]).toEqual({ outcome: 'gap', replayed: 2, missed: 2 })
    expect(summary(metas)).toEqual([[1, false, 0, false], [4, true, 2, true], [5, false, 0, true]])
  })

  it('reports a tail it cannot fill, and the next event shows the gap', async () => {
    const popup = fakePopup({ capacity: 0 })
    const metas: EventMeta[] = []
    await popup.subs.add(NAME, (_p, meta) => metas.push(meta))
    popup.subs.dispatch({ name: NAME, revision: 1, payload: 1 })
    popup.subs.reset()
    popup.state.revision = 4
    const outcome = await popup.subs.resubscribe()
    expect(outcome.replay[NAME]).toEqual({ outcome: 'gap', replayed: 0, missed: 3 })
    popup.state.revision = 5
    popup.subs.dispatch({ name: NAME, revision: 5, payload: 5 })
    expect(metas.at(-1)).toMatchObject({ revision: 5, gap: true, missed: 3 })
  })

  it('treats a different epoch as a reset and does not ask for history', async () => {
    const popup = fakePopup()
    const metas: EventMeta[] = []
    await popup.subs.add(NAME, (_p, meta) => metas.push(meta))
    popup.emit(1)
    popup.emit(2)
    popup.subs.reset()
    popup.state.epoch = 'epoch-2'
    popup.state.revision = 0
    popup.state.entries = []
    const outcome = await popup.subs.resubscribe()
    expect(outcome.replay[NAME]).toEqual({ outcome: 'reset', replayed: 0, missed: 0 })
    expect(popup.replays()).toHaveLength(0)
    popup.emit(1)
    expect(metas.at(-1)).toMatchObject({ revision: 1, gap: false, replayed: false })
  })

  it('reports unsupported when the new connection did not agree on replay', async () => {
    const popup = fakePopup()
    await popup.subs.add(NAME, () => undefined)
    popup.emit(1)
    popup.subs.reset()
    popup.setFeatures([])
    popup.state.revision = 3
    const outcome = await popup.subs.resubscribe()
    expect(outcome.replay[NAME]).toEqual({ outcome: 'unsupported', replayed: 0, missed: 0 })
    expect(popup.replays()).toHaveLength(0)
  })

  it('never rejects: failed events are listed, keep their handlers and resume point, and succeed on a retry', async () => {
    const popup = fakePopup()
    const metas: EventMeta[] = []
    await popup.subs.add(NAME, (_p, meta) => metas.push(meta))
    popup.emit(1)
    popup.subs.reset()
    popup.emit(2, { lost: true })
    popup.state.subscribeError = new BridgeError('RPC_TIMEOUT', 'bridge.subscribe timed out')
    const first = await popup.subs.resubscribe()
    expect(first).toEqual({ recovered: [], failed: [NAME], replay: {} })
    expect(popup.errors).toHaveLength(1)
    // Events of an event that is not subscribed are ignored rather than delivered out of context.
    popup.subs.dispatch({ name: NAME, revision: 3, payload: 3 })
    expect(metas).toHaveLength(1)
    popup.state.subscribeError = undefined
    const second = await popup.subs.resubscribe()
    expect(second.recovered).toEqual([NAME])
    expect(second.replay[NAME]).toEqual({ outcome: 'replayed', replayed: 1, missed: 0 })
    expect(summary(metas)).toEqual([[1, false, 0, false], [2, false, 0, true]])
  })

  it('subscribes every event again, each with its own outcome', async () => {
    const calls: string[] = []
    const subs = new Subscriptions({
      call: async (method, params) => {
        calls.push(`${method}:${JSON.stringify(params)}`)
        return { revisions: { 'a.one': 0, 'a.two': 0 } }
      },
      validate: (_n, payload) => payload,
      onHandlerError: () => undefined,
      features: () => NO_FEATURES,
    })
    await subs.add('a.one', () => undefined)
    await subs.add('a.two', () => undefined)
    subs.reset()
    const outcome = await subs.resubscribe()
    expect(outcome.recovered.sort()).toEqual(['a.one', 'a.two'])
    expect(Object.keys(outcome.replay).sort()).toEqual(['a.one', 'a.two'])
    expect(calls.filter(call => call.startsWith('bridge.subscribe'))).toHaveLength(4)
  })
})

describe('resync', () => {
  it('finds a lost tail that no later event would reveal', async () => {
    const popup = fakePopup()
    const metas: EventMeta[] = []
    await popup.subs.add(NAME, (_p, meta) => metas.push(meta))
    popup.emit(1)
    popup.emit(2, { lost: true })
    popup.emit(3, { lost: true })
    expect(metas).toHaveLength(1)
    const report = await popup.subs.resync(NAME)
    expect(report).toEqual({ [NAME]: { outcome: 'replayed', replayed: 2, missed: 0 } })
    expect(summary(metas)).toEqual([[1, false, 0, false], [2, false, 0, true], [3, false, 0, true]])
    expect((await popup.subs.resync())[NAME]).toEqual({ outcome: 'current', replayed: 0, missed: 0 })
  })

  it('counts a live event the buffer lost the same way the events themselves report it', async () => {
    const popup = fakePopup({ capacity: 2 })
    let release!: () => void
    popup.state.gate = new Promise<void>(resolve => (release = resolve))
    const metas: EventMeta[] = []
    await popup.subs.add(NAME, (_p, meta) => metas.push(meta))
    for (const revision of [1, 2, 3, 4, 5]) popup.emit(revision)
    popup.emit(6, { lost: true })
    popup.emit(7, { lost: true })
    const report = popup.subs.resync(NAME)
    for (const revision of [8, 9, 10]) popup.emit(revision) // held while the request is out
    release()
    // 6 and 7 are gone for good; 8 was only ever live, 9 and 10 are replayed.
    expect((await report)[NAME]).toEqual({ outcome: 'gap', replayed: 3, missed: 2 })
    expect(summary(metas.slice(5))).toEqual([[8, true, 2, false], [9, false, 0, true], [10, false, 0, true]])
    expect(metas.slice(5).reduce((sum, meta) => sum + meta.missed, 0)).toBe(2)
  })

  it('does not replay when the popup names an epoch but replay was not agreed', async () => {
    const popup = fakePopup({ forceEpoch: true })
    popup.setFeatures([])
    const metas: EventMeta[] = []
    await popup.subs.add(NAME, (_p, meta) => metas.push(meta))
    popup.emit(1)
    popup.emit(2, { lost: true })
    popup.emit(3)
    expect(popup.replays()).toHaveLength(0)
    expect(summary(metas)).toEqual([[1, false, 0, false], [3, true, 1, false]])
    expect(await popup.subs.resync()).toEqual({ [NAME]: { outcome: 'unsupported', replayed: 0, missed: 0 } })
    expect(popup.replays()).toHaveLength(0)
  })

  it('reports unsupported without a request when replay was not agreed, and rejects an unsubscribed event', async () => {
    const popup = fakePopup()
    popup.setFeatures([])
    await popup.subs.add(NAME, () => undefined)
    expect(await popup.subs.resync()).toEqual({ [NAME]: { outcome: 'unsupported', replayed: 0, missed: 0 } })
    expect(popup.replays()).toHaveLength(0)
    await expect(popup.subs.resync('a.other')).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })
  })

  it('waits for a synchronization in progress instead of racing it', async () => {
    const popup = fakePopup()
    let release!: () => void
    popup.state.gate = new Promise<void>(resolve => (release = resolve))
    const metas: EventMeta[] = []
    await popup.subs.add(NAME, (_p, meta) => metas.push(meta))
    popup.emit(1)
    popup.emit(2, { lost: true })
    popup.emit(3) // starts the live recovery, which waits on the gate
    const report = popup.subs.resync(NAME)
    await new Promise(r => setTimeout(r, 5))
    expect(popup.replays()).toHaveLength(1)
    release()
    expect((await report)[NAME]).toEqual({ outcome: 'current', replayed: 0, missed: 0 })
    expect(metas.map(m => m.revision)).toEqual([1, 2, 3])
    expect(popup.replays()).toHaveLength(2)
  })

  it('reports failed when the request cannot be made', async () => {
    const popup = fakePopup()
    await popup.subs.add(NAME, () => undefined)
    popup.emit(1)
    popup.emit(2, { lost: true })
    popup.state.replayError = new BridgeError('SESSION_CLOSED', 'gone')
    const report: Record<string, ResyncResult> = { ...(await popup.subs.resync()) }
    expect(report[NAME]).toEqual({ outcome: 'failed', replayed: 0, missed: 0 })
    expect(popup.errors).toEqual([])
  })
})
