import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BridgeError,
  FEATURE_EVENTS_COALESCE,
  FEATURE_EVENTS_REPLAY,
  defineContract,
  definePopup,
  describeContract,
  event,
  type AnyContract,
  type AnyEventSpec,
  type CoalescePolicy,
  type EventName,
} from '../src/index.js'
import { createPopupBridge, type EventMeta, type HostOpenOptions, type PopupSession, type ReconnectInfo } from '../src/host.js'
import { createPopupRuntime, type PopupRuntime } from '../src/popup.js'
import { MAX_COALESCE_WINDOW_MS } from '../src/events/coalesce.js'
import { REPLAY_METHOD, type ReplayEntry } from '../src/events/replay.js'
import { Subscriptions } from '../src/host/subscriptions.js'
import { EventCoalescer, type CoalescedCommit } from '../src/popup/coalescer.js'
import { NO_FEATURES } from '../src/protocol/features.js'
import { createManualClock, createMemoryBrowser } from '../src/testing.js'
import { assetContract, definition, init, setup, type SetupOptions } from './fixture.js'

afterEach(() => {
  vi.restoreAllMocks()
})

async function rejectsWith(promise: Promise<unknown>, code: string): Promise<BridgeError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(BridgeError)
  expect((error as BridgeError).code).toBe(code)
  return error as BridgeError
}

// ---- the coalescer on its own -----------------------------------------------------------------

type Commit = { name: string; payload: unknown } & CoalescedCommit

function makeCoalescer(overrides: Partial<ConstructorParameters<typeof EventCoalescer>[0]> = {}) {
  const clock = createManualClock()
  const commits: Commit[] = []
  const errors: unknown[] = []
  const coalescer = new EventCoalescer({
    after: clock.after,
    commit: (name, payload, how) => {
      commits.push({ name, payload, ...how })
    },
    onError: error => errors.push(error),
    ...overrides,
  })
  return { clock, commits, errors, coalescer }
}

const latest: CoalescePolicy<unknown> = { windowMs: 50, strategy: 'latest' }
const leading: CoalescePolicy<unknown> = { windowMs: 50, strategy: 'latest', leading: true }
const union: CoalescePolicy<unknown> = {
  windowMs: 50,
  strategy: (accumulated, next) => [...new Set([...(accumulated as string[]), ...(next as string[])])],
}

describe('EventCoalescer', () => {
  it('keeps the newest payload of a window and sends it when the window ends', async () => {
    const { clock, commits, coalescer } = makeCoalescer()
    coalescer.emit('a.moved', latest, { x: 1 })
    coalescer.emit('a.moved', latest, { x: 2 })
    coalescer.emit('a.moved', latest, { x: 3 })
    expect(coalescer.hasPending('a.moved')).toBe(true)
    await clock.advance(49)
    expect(commits).toEqual([])
    await clock.advance(1)
    expect(commits).toEqual([{ name: 'a.moved', payload: { x: 3 }, owned: true, coalesced: 3 }])
    expect(coalescer.hasPending('a.moved')).toBe(false)
    expect(clock.pending).toBe(0)
  })

  it('sends a window that held one emit as an ordinary event, without a merge count', async () => {
    const { clock, commits, coalescer } = makeCoalescer()
    coalescer.emit('a.moved', latest, { x: 1 })
    await clock.advance(50)
    expect(commits).toEqual([{ name: 'a.moved', payload: { x: 1 }, owned: true }])
    expect('coalesced' in commits[0]!).toBe(false)
  })

  it('throttles: the window starts at the first emit and later emits do not extend it', async () => {
    const { clock, commits, coalescer } = makeCoalescer()
    coalescer.emit('a.moved', latest, 1)
    await clock.advance(30)
    coalescer.emit('a.moved', latest, 2)
    await clock.advance(19)
    expect(commits).toEqual([])
    await clock.advance(1)
    expect(commits.map(c => [c.payload, c.coalesced])).toEqual([[2, 2]])
    // The next emit opens a fresh window of its own.
    await clock.advance(10)
    coalescer.emit('a.moved', latest, 3)
    await clock.advance(49)
    expect(commits).toHaveLength(1)
    await clock.advance(1)
    expect(commits.map(c => c.payload)).toEqual([2, 3])
  })

  it('folds every payload of the window with the reducer', async () => {
    const { clock, commits, coalescer } = makeCoalescer()
    coalescer.emit('a.touched', union, ['a'])
    coalescer.emit('a.touched', union, ['b', 'a'])
    coalescer.emit('a.touched', union, ['c'])
    await clock.advance(50)
    expect(commits).toEqual([{ name: 'a.touched', payload: ['a', 'b', 'c'], owned: true, coalesced: 3 }])
  })

  it('copies the payload when it arrives, so the emitter can keep reusing its object', async () => {
    const { clock, commits, coalescer } = makeCoalescer()
    const shared = { ids: ['a'] }
    coalescer.emit('a.moved', latest, shared)
    shared.ids.push('mutated')
    await clock.advance(50)
    expect(commits[0]!.payload).toEqual({ ids: ['a'] })
    expect(commits[0]!.payload).not.toBe(shared)
  })

  it('with leading, sends the first emit at once and merges what follows into one trailing event', async () => {
    const { clock, commits, coalescer } = makeCoalescer()
    coalescer.emit('a.hover', leading, 'a')
    // Not owned: the committer copies it, because this is the emitter's own object.
    expect(commits).toEqual([{ name: 'a.hover', payload: 'a', owned: false }])
    await clock.advance(10)
    coalescer.emit('a.hover', leading, 'b')
    coalescer.emit('a.hover', leading, 'c')
    expect(commits).toHaveLength(1)
    await clock.advance(40)
    expect(commits[1]).toEqual({ name: 'a.hover', payload: 'c', owned: true, coalesced: 2 })
  })

  it('with leading, stays rate limited after the trailing event and goes quiet after an empty window', async () => {
    const { clock, commits, coalescer } = makeCoalescer()
    coalescer.emit('a.hover', leading, 1) // sent now
    await clock.advance(10)
    coalescer.emit('a.hover', leading, 2)
    coalescer.emit('a.hover', leading, 3)
    await clock.advance(40) // t=50: trailing {3, x2}, and a new window until 100
    await clock.advance(10)
    coalescer.emit('a.hover', leading, 4) // inside that window: waits
    expect(commits.map(c => c.payload)).toEqual([1, 3])
    await clock.advance(40) // t=100: trailing {4}, window until 150
    expect(commits.map(c => [c.payload, c.coalesced])).toEqual([[1, undefined], [3, 2], [4, undefined]])
    await clock.advance(50) // t=150: nothing pending, goes quiet
    expect(clock.pending).toBe(0)
    coalescer.emit('a.hover', leading, 5) // quiet again: sent at once
    expect(commits.map(c => c.payload)).toEqual([1, 3, 4, 5])
  })

  it('keeps a window per event', async () => {
    const { clock, commits, coalescer } = makeCoalescer()
    coalescer.emit('a.one', latest, 1)
    await clock.advance(30)
    coalescer.emit('a.two', { windowMs: 100, strategy: 'latest' }, 'x')
    coalescer.emit('a.one', latest, 2)
    await clock.advance(20)
    expect(commits.map(c => [c.name, c.payload])).toEqual([['a.one', 2]])
    await clock.advance(80)
    expect(commits.map(c => [c.name, c.payload])).toEqual([['a.one', 2], ['a.two', 'x']])
  })

  it('flushes one event or all of them now, and ends their windows', async () => {
    const { clock, commits, coalescer } = makeCoalescer()
    coalescer.emit('a.one', latest, 1)
    coalescer.emit('a.one', latest, 2)
    coalescer.emit('a.two', latest, 'x')
    coalescer.flush('a.one')
    expect(commits.map(c => [c.name, c.payload, c.coalesced])).toEqual([['a.one', 2, 2]])
    expect(coalescer.hasPending('a.one')).toBe(false)
    expect(coalescer.hasPending('a.two')).toBe(true)
    coalescer.flush()
    expect(commits.map(c => c.name)).toEqual(['a.one', 'a.two'])
    // Nothing is sent a second time when the old timers would have fired.
    await clock.advance(200)
    expect(commits).toHaveLength(2)
    expect(clock.pending).toBe(0)
    coalescer.flush('a.unknown')
  })

  it('flushing a leading event that has nothing pending only ends its quiet period', async () => {
    const { commits, coalescer } = makeCoalescer()
    coalescer.emit('a.hover', leading, 1)
    coalescer.flush('a.hover')
    expect(commits).toHaveLength(1)
    coalescer.emit('a.hover', leading, 2) // not waiting out the old window
    expect(commits.map(c => c.payload)).toEqual([1, 2])
  })

  it('attempts every event when one fails to send, then rethrows the first failure', () => {
    const boom = new Error('cannot send a')
    const { commits, coalescer } = makeCoalescer({
      commit: (name, payload) => {
        if (name === 'a.one') throw boom
        commits.push({ name, payload, owned: true })
      },
    })
    coalescer.emit('a.one', latest, 1)
    coalescer.emit('a.two', latest, 2)
    expect(() => coalescer.flush()).toThrow(boom)
    expect(commits.map(c => c.name)).toEqual(['a.two'])
    expect(coalescer.hasPending('a.one')).toBe(false)
  })

  it('drops what is pending and cancels its timers on dispose', async () => {
    const { clock, commits, coalescer } = makeCoalescer()
    coalescer.emit('a.one', latest, 1)
    coalescer.emit('a.hover', leading, 2)
    expect(clock.pending).toBe(2)
    coalescer.dispose()
    expect(clock.pending).toBe(0)
    await clock.advance(500)
    expect(commits.map(c => c.name)).toEqual(['a.hover']) // only the leading emit, sent before
  })

  describe('failures', () => {
    it('refuses a payload that cannot be copied and leaves no window behind', () => {
      const { clock, commits, coalescer } = makeCoalescer()
      const error = (() => {
        try {
          coalescer.emit('a.moved', latest, { fn: () => 1 })
        } catch (e) {
          return e
        }
      })()
      expect(error).toMatchObject({ code: 'NOT_CLONEABLE' })
      expect(clock.pending).toBe(0)
      expect(commits).toEqual([])
    })

    it('refuses an uncloneable payload inside a window without touching what is pending', async () => {
      const { clock, commits, coalescer } = makeCoalescer()
      coalescer.emit('a.moved', latest, 'kept')
      expect(() => coalescer.emit('a.moved', latest, { fn: () => 1 })).toThrowError(expect.objectContaining({ code: 'NOT_CLONEABLE' }))
      await clock.advance(50)
      expect(commits).toEqual([{ name: 'a.moved', payload: 'kept', owned: true }])
    })

    it('leaves the pending payload alone when the reducer throws', async () => {
      const { clock, commits, coalescer } = makeCoalescer()
      const policy: CoalescePolicy<unknown> = {
        windowMs: 50,
        strategy: (_accumulated, next) => {
          if (next === 'bad') throw new Error('cannot fold')
          return next
        },
      }
      coalescer.emit('a.moved', policy, 'one')
      coalescer.emit('a.moved', policy, 'two')
      expect(() => coalescer.emit('a.moved', policy, 'bad')).toThrow('cannot fold')
      await clock.advance(50)
      expect(commits).toEqual([{ name: 'a.moved', payload: 'two', owned: true, coalesced: 2 }])
    })

    it('leaves the pending payload alone when the merged payload is invalid', async () => {
      const { clock, commits, coalescer } = makeCoalescer({
        validate: (_name, payload) => {
          if (typeof payload === 'number' && payload > 10) throw new BridgeError('INVALID_PARAMS', 'too large')
        },
      })
      const sum: CoalescePolicy<unknown> = { windowMs: 50, strategy: (a, b) => (a as number) + (b as number) }
      coalescer.emit('a.sum', sum, 4)
      coalescer.emit('a.sum', sum, 3)
      expect(() => coalescer.emit('a.sum', sum, 8)).toThrowError(expect.objectContaining({ code: 'INVALID_PARAMS' }))
      await clock.advance(50)
      expect(commits).toEqual([{ name: 'a.sum', payload: 7, owned: true, coalesced: 2 }])
    })

    it('reports a failure on the timer path instead of throwing into the void', async () => {
      const boom = new Error('cannot send')
      let failing = true
      const { clock, commits, errors, coalescer } = makeCoalescer({
        commit: (name, payload, how) => {
          if (failing) throw boom
          commits.push({ name, payload, ...how })
        },
      })
      coalescer.emit('a.moved', latest, 1)
      await clock.advance(50)
      expect(errors).toEqual([boom])
      // The event is usable afterwards.
      failing = false
      coalescer.emit('a.moved', latest, 2)
      await clock.advance(50)
      expect(commits.map(c => c.payload)).toEqual([2])
    })

    it('keeps a leading event rate limited even when its trailing send failed', async () => {
      let failing = false
      const { clock, commits, errors, coalescer } = makeCoalescer({
        commit: (name, payload, how) => {
          if (failing) throw new Error('cannot send')
          commits.push({ name, payload, ...how })
        },
      })
      coalescer.emit('a.hover', leading, 1)
      coalescer.emit('a.hover', leading, 2)
      failing = true
      await clock.advance(50)
      expect(errors).toHaveLength(1)
      failing = false
      coalescer.emit('a.hover', leading, 3) // a new window is open, so this waits
      expect(commits.map(c => c.payload)).toEqual([1])
      await clock.advance(50)
      expect(commits.map(c => c.payload)).toEqual([1, 3])
    })

    it('opens no window when the leading emit could not be sent', () => {
      const { clock, coalescer } = makeCoalescer({
        commit: () => {
          throw new BridgeError('NOT_CLONEABLE', 'no')
        },
      })
      expect(() => coalescer.emit('a.hover', leading, 1)).toThrowError(expect.objectContaining({ code: 'NOT_CLONEABLE' }))
      expect(clock.pending).toBe(0)
      expect(coalescer.hasPending('a.hover')).toBe(false)
    })
  })
})

// ---- the declaration ------------------------------------------------------------------------

describe('event declarations with coalesce', () => {
  it('stores a validated policy on the spec and leaves out what is default', () => {
    const reducer = (a: number, b: number) => a + b
    expect(event<number>({ coalesce: { windowMs: 50, strategy: 'latest' } }).coalesce).toEqual({ windowMs: 50, strategy: 'latest' })
    expect(event<number>({ coalesce: { windowMs: 50, strategy: 'latest', leading: false } }).coalesce).toEqual({ windowMs: 50, strategy: 'latest' })
    expect(event<number>({ coalesce: { windowMs: 5, strategy: reducer, leading: true } }).coalesce).toEqual({ windowMs: 5, strategy: reducer, leading: true })
    expect(event<number>().coalesce).toBeUndefined()
    expect(event<number>({ coalesce: { windowMs: MAX_COALESCE_WINDOW_MS, strategy: 'latest' } }).coalesce?.windowMs).toBe(MAX_COALESCE_WINDOW_MS)
    expect(event<number>({ coalesce: { windowMs: 0.5, strategy: 'latest' } }).coalesce?.windowMs).toBe(0.5)
  })

  it('stores a copy, so changing the options afterwards does not change the contract', () => {
    const options = { windowMs: 50, strategy: 'latest' as const }
    const spec = event<number>({ coalesce: options })
    options.windowMs = 1
    expect(spec.coalesce?.windowMs).toBe(50)
  })

  it('combines with replay', () => {
    const spec = event<number>({ replay: { capacity: 4 }, coalesce: { windowMs: 10, strategy: 'latest' } })
    expect(spec.replay).toEqual({ capacity: 4 })
    expect(spec.coalesce).toEqual({ windowMs: 10, strategy: 'latest' })
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, MAX_COALESCE_WINDOW_MS + 1, '50', null, undefined])('rejects windowMs %s', windowMs => {
    expect(() => event({ coalesce: { windowMs: windowMs as number, strategy: 'latest' } })).toThrow(TypeError)
  })

  it.each(['oldest', 5, null, undefined, {}])('rejects strategy %s', strategy => {
    expect(() => event({ coalesce: { windowMs: 10, strategy: strategy as 'latest' } })).toThrow(TypeError)
  })

  it('rejects a non-boolean leading and a policy that is not an object', () => {
    expect(() => event({ coalesce: { windowMs: 10, strategy: 'latest', leading: 'yes' as never } })).toThrow(TypeError)
    expect(() => event({ coalesce: 'latest' as never })).toThrow(TypeError)
  })

  it('describes the policy in the manifest without the reducer code', () => {
    const contract = defineContract({
      id: 'm',
      events: {
        'm.plain': event<number>(),
        'm.latest': event<number>({ coalesce: { windowMs: 50, strategy: 'latest' } }),
        'm.sum': event<number>({ replay: { capacity: 3 }, coalesce: { windowMs: 20, strategy: (a, b) => a + b, leading: true } }),
      },
    })
    const rows = describeContract(contract).events
    expect(rows.find(row => row.name === 'm.plain')).not.toHaveProperty('coalesce')
    expect(rows.find(row => row.name === 'm.latest')?.coalesce).toEqual({ windowMs: 50, strategy: 'latest' })
    expect(rows.find(row => row.name === 'm.sum')).toMatchObject({ replay: { capacity: 3 }, coalesce: { windowMs: 20, strategy: 'reduce', leading: true } })
    // A manifest is data: it survives a JSON round trip.
    expect(JSON.parse(JSON.stringify(describeContract(contract)))).toEqual(describeContract(contract))
  })

  it('keeps a typed event assignable to the untyped spec, and checks the reducer against the payload type', () => {
    const typed = event<{ n: number }>({ coalesce: { windowMs: 10, strategy: (accumulated, next) => ({ n: accumulated.n + next.n }) } })
    const untyped: AnyEventSpec = typed
    expect(untyped.coalesce?.windowMs).toBe(10)
    // Compile-time only: these lines are never run.
    const rejectedByTheCompiler = () => {
      // @ts-expect-error a reducer must return the payload type
      event<{ n: number }>({ coalesce: { windowMs: 10, strategy: (accumulated, next) => accumulated.n + next.n } })
      // @ts-expect-error only 'latest' is a named strategy
      event<{ n: number }>({ coalesce: { windowMs: 10, strategy: 'newest' } })
      // @ts-expect-error a reducer that expects more than the payload would read members that are not there
      event<{ n: number }>({ coalesce: { windowMs: 10, strategy: (a: { n: number; extra: string }, b: { n: number; extra: string }) => ({ n: a.n + b.n }) } })
      // @ts-expect-error a reducer for one variant of a union would fold the others as if they were its own
      event<{ kind: 'a'; n: number } | { kind: 'b'; s: string }>({ coalesce: { windowMs: 10, strategy: (acc: { kind: 'a'; n: number }, next: { kind: 'a'; n: number }) => ({ kind: 'a', n: acc.n + next.n }) } })
      // A reducer that accepts a wider type than the payload is fine.
      event<{ n: number }>({ coalesce: { windowMs: 10, strategy: (a: { n: number } | undefined, b: { n: number } | undefined) => ({ n: (a?.n ?? 0) + (b?.n ?? 0) }) } })
    }
    expect(rejectedByTheCompiler).toBeTypeOf('function')
  })

  it('is part of the fixture contract', () => {
    const rows = describeContract(assetContract).events
    expect(rows.find(row => row.name === 'asset.cursorMoved')?.coalesce).toEqual({ windowMs: 50, strategy: 'latest' })
    expect(rows.find(row => row.name === 'asset.itemsTouched')?.coalesce).toEqual({ windowMs: 50, strategy: 'reduce' })
    expect(rows.find(row => row.name === 'asset.hover')?.coalesce).toEqual({ windowMs: 50, strategy: 'latest', leading: true })
    expect(rows.find(row => row.name === 'asset.progress')).not.toHaveProperty('coalesce')
  })
})

// ---- the host side of the wire ---------------------------------------------------------------

describe('Subscriptions and merged events', () => {
  function make() {
    const call = vi.fn(async (method: string) => (method === 'bridge.subscribe' ? { revisions: {} } : {}))
    const subs = new Subscriptions({ call, validate: (_n, payload) => payload, onHandlerError: () => undefined, features: () => NO_FEATURES })
    return subs
  }

  it('reports how many emits an event stands for, 1 when nothing was merged', async () => {
    const subs = make()
    const metas: EventMeta[] = []
    await subs.add('a.moved', (_p, meta) => metas.push(meta))
    subs.dispatch({ name: 'a.moved', revision: 1, payload: 0 })
    subs.dispatch({ name: 'a.moved', revision: 2, payload: 0, coalesced: 5 })
    subs.dispatch({ name: 'a.moved', revision: 3, payload: 0, coalesced: 1 })
    expect(metas.map(m => [m.revision, m.coalesced, m.gap])).toEqual([[1, 1, false], [2, 5, false], [3, 1, false]])
  })

  it.each([0, -3, 1.5, '4', Number.NaN, Number.POSITIVE_INFINITY, null, true, {}])('reads a merge count of %s as an unmerged event', async bad => {
    const subs = make()
    const metas: EventMeta[] = []
    await subs.add('a.moved', (_p, meta) => metas.push(meta))
    subs.dispatch({ name: 'a.moved', revision: 1, payload: 'kept', coalesced: bad })
    expect(metas).toHaveLength(1)
    expect(metas[0]).toMatchObject({ revision: 1, coalesced: 1, gap: false })
  })

  it('judges gaps by revision alone, however many emits the events stand for', async () => {
    const subs = make()
    const metas: EventMeta[] = []
    await subs.add('a.moved', (_p, meta) => metas.push(meta))
    subs.dispatch({ name: 'a.moved', revision: 1, payload: 0, coalesced: 40 })
    subs.dispatch({ name: 'a.moved', revision: 2, payload: 0, coalesced: 900 })
    subs.dispatch({ name: 'a.moved', revision: 4, payload: 0, coalesced: 3 }) // revision 3 really is missing
    expect(metas.map(m => [m.revision, m.gap, m.missed, m.coalesced])).toEqual([[1, false, 0, 40], [2, false, 0, 900], [4, true, 1, 3]])
  })
})

// ---- a popup and a host talking ---------------------------------------------------------------

const CURSOR = 'asset.cursorMoved' as const
const TOUCHED = 'asset.itemsTouched' as const
const HOVER = 'asset.hover' as const
const SCROLLED = 'asset.scrolled' as const
const SELECTION = 'asset.selectionChanged' as const

type Seen = Array<{ payload: unknown; meta: EventMeta }>

const untyped = { id: 'asset-selector', url: 'https://tools.example.com/asset-selector', expectedOrigin: 'https://tools.example.com', protocolVersions: ['1.0'], requiredCapabilities: [] }

type HostExtras<C extends AnyContract> = Omit<HostOpenOptions<C>, 'init'>

async function connect(options: SetupOptions = {}, host: HostExtras<typeof assetContract> = {}) {
  const clock = createManualClock()
  const env = setup({ ...options, clock })
  const session = await env.bridge.open(definition, { init, ...host })
  return { ...env, clock, session, popup: env.booted[0]!.runtime }
}

/** The same, against a definition without a contract, so built-in requests can be called by name. */
async function connectRaw(options: SetupOptions = {}, host: HostExtras<AnyContract> = {}) {
  const clock = createManualClock()
  const env = setup({ ...options, clock })
  const session = await env.bridge.open(untyped, { init, ...host })
  return { ...env, clock, session, popup: env.booted[0]!.runtime }
}

async function listen<C extends AnyContract>(session: PopupSession<C>, name: EventName<C['events']>): Promise<Seen> {
  const seen: Seen = []
  await session.subscribe(name, (payload: unknown, meta) => seen.push({ payload, meta }))
  return seen
}

const revisions = (seen: Seen) => seen.map(entry => entry.meta.revision)

/** Reads the popup's replay buffer directly, the way a host does on the wire. */
async function replayOf(session: { call(name: string, params?: unknown): Promise<unknown> }, name: string, since: number) {
  return (await session.call(REPLAY_METHOD, { name, since })) as { epoch: string; revision: number; oldest: number; capacity: number; entries: ReplayEntry[] }
}


describe('coalescing between a popup and a host', () => {
  it('delivers one event for a burst, with the newest payload and the number of emits it stands for', async () => {
    const { clock, session, popup } = await connect()
    const seen = await listen(session, CURSOR)
    for (let i = 1; i <= 10; i++) popup.emit(CURSOR, { x: i, y: i * 2 })
    await clock.advance(49)
    expect(seen).toEqual([])
    await clock.advance(1)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.payload).toEqual({ x: 10, y: 20 })
    expect(seen[0]!.meta).toEqual({ name: CURSOR, revision: 1, gap: false, missed: 0, replayed: false, coalesced: 10 })

    popup.emit(CURSOR, { x: 0, y: 0 })
    await clock.advance(50)
    expect(seen[1]!.meta).toMatchObject({ revision: 2, gap: false, coalesced: 1 })
    await session.close()
  })

  it('starts the window at the first emit of a burst', async () => {
    const { clock, session, popup } = await connect()
    const seen = await listen(session, CURSOR)
    popup.emit(CURSOR, { x: 1, y: 1 })
    await clock.advance(30)
    popup.emit(CURSOR, { x: 2, y: 2 })
    await clock.advance(20)
    expect(seen.map(entry => entry.payload)).toEqual([{ x: 2, y: 2 }])
    popup.emit(CURSOR, { x: 3, y: 3 })
    await clock.advance(50)
    expect(revisions(seen)).toEqual([1, 2])
    await session.close()
  })

  it('folds with the reducer of the event', async () => {
    const { clock, session, popup } = await connect()
    const seen = await listen(session, TOUCHED)
    popup.emit(TOUCHED, { ids: ['a'] })
    popup.emit(TOUCHED, { ids: ['b', 'a'] })
    popup.emit(TOUCHED, { ids: ['c'] })
    await clock.advance(50)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.payload).toEqual({ ids: ['a', 'b', 'c'] })
    expect(seen[0]!.meta).toMatchObject({ revision: 1, coalesced: 3, gap: false })
    await session.close()
  })

  it('sends a leading event at once and merges the rest of the burst', async () => {
    const { clock, session, popup } = await connect()
    const seen = await listen(session, HOVER)
    popup.emit(HOVER, { id: 'a' })
    await clock.settle()
    expect(seen.map(entry => [entry.payload, entry.meta.revision, entry.meta.coalesced])).toEqual([[{ id: 'a' }, 1, 1]])
    popup.emit(HOVER, { id: 'b' })
    popup.emit(HOVER, { id: 'c' })
    popup.emit(HOVER, { id: 'd' })
    await clock.advance(50)
    expect(seen.map(entry => [entry.payload, entry.meta.revision, entry.meta.coalesced, entry.meta.gap])).toEqual([
      [{ id: 'a' }, 1, 1, false],
      [{ id: 'd' }, 2, 3, false],
    ])
    await session.close()
  })

  it('merges each event on its own', async () => {
    const { clock, session, popup } = await connect()
    const cursor = await listen(session, CURSOR)
    const touched = await listen(session, TOUCHED)
    popup.emit(CURSOR, { x: 1, y: 1 })
    popup.emit(TOUCHED, { ids: ['a'] })
    popup.emit(CURSOR, { x: 2, y: 2 })
    await clock.advance(50)
    expect([revisions(cursor), cursor[0]!.meta.coalesced]).toEqual([[1], 2])
    expect([revisions(touched), touched[0]!.meta.coalesced]).toEqual([[1], 1])
    await session.close()
  })

  it('turns a burst into one notification, so a rate limit that would drop events does not', async () => {
    const { clock, session, popup, securityEvents } = await connect({}, { limits: { maxNotificationsPerSecond: 5 } })
    const seen = await listen(session, CURSOR)
    for (let i = 0; i < 200; i++) popup.emit(CURSOR, { x: i, y: i })
    await clock.advance(50)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.meta.coalesced).toBe(200)
    expect(securityEvents.filter(event => event.type === 'rate-limited')).toEqual([])
    await session.close()
  })

  describe('when nobody is merging for', () => {
    it('sends each emit at once with a revision of its own while the host is not subscribed', async () => {
      const { clock, session, popup } = await connect()
      const armed = clock.pending
      for (let i = 1; i <= 3; i++) popup.emit(CURSOR, { x: i, y: i })
      expect(clock.pending).toBe(armed) // no window was opened
      const seen = await listen(session, CURSOR)
      // The three emits consumed three revisions; the first merged event is the fourth.
      popup.emit(CURSOR, { x: 4, y: 4 })
      popup.emit(CURSOR, { x: 5, y: 5 })
      await clock.advance(50)
      expect(seen.map(entry => [entry.meta.revision, entry.meta.gap, entry.meta.coalesced])).toEqual([[4, false, 2]])
      await session.close()
    })

    it.each([
      ['a host that offers no features', {}, { features: [] as string[] }],
      ['a host that predates coalescing', {}, { features: [FEATURE_EVENTS_REPLAY] }],
      ['a popup that offers no features', { popupFeatures: [] as string[] }, {}],
      ['a popup that predates coalescing', { popupFeatures: [FEATURE_EVENTS_REPLAY] }, {}],
    ])('sends every emit as its own event to %s', async (_label, popupOptions, hostOptions) => {
      const { clock, session, popup } = await connect(popupOptions, hostOptions)
      expect(session.features.has(FEATURE_EVENTS_COALESCE)).toBe(false)
      const armed = clock.pending
      const seen = await listen(session, CURSOR)
      for (let i = 1; i <= 5; i++) popup.emit(CURSOR, { x: i, y: i })
      expect(clock.pending).toBe(armed) // no timer for events nobody merges
      await clock.settle() // delivered without any time passing
      expect(revisions(seen)).toEqual([1, 2, 3, 4, 5])
      expect(seen.map(entry => entry.meta.coalesced)).toEqual([1, 1, 1, 1, 1])
      expect(seen.every(entry => !entry.meta.gap)).toBe(true)
      expect(seen.map(entry => entry.payload)).toEqual([1, 2, 3, 4, 5].map(i => ({ x: i, y: i })))
      await session.close()
    })

    it('does not merge for a connection that agreed on it, once the host listens no more', async () => {
      const { clock, session, popup } = await connect()
      const off = await session.subscribe(CURSOR, () => undefined)
      popup.emit(CURSOR, { x: 1, y: 1 })
      popup.emit(CURSOR, { x: 2, y: 2 })
      await off()
      const armed = clock.pending
      popup.emit(CURSOR, { x: 3, y: 3 }) // consumes a revision straight away
      expect(clock.pending).toBe(armed)
      const seen = await listen(session, CURSOR)
      popup.emit(CURSOR, { x: 4, y: 4 })
      await clock.advance(50)
      // Revision 1 was the two emits settled at unsubscribe, 2 the unobserved one; this is the third.
      expect(seen.map(entry => [entry.meta.revision, entry.meta.gap, entry.meta.coalesced])).toEqual([[3, false, 1]])
      await session.close()
    })
  })

  describe('transfer lists', () => {
    it('refuses to transfer the payload of a merging event and consumes nothing', async () => {
      const { clock, session, popup } = await connect()
      const seen = await listen(session, CURSOR)
      popup.emit(CURSOR, { x: 1, y: 1 })
      const buffer = new ArrayBuffer(8)
      expect(() => popup.emit(CURSOR, { x: 2, y: 2 }, { transfer: [buffer] })).toThrow(TypeError)
      expect(buffer.byteLength).toBe(8) // not detached
      await clock.advance(50)
      expect(seen.map(entry => [entry.payload, entry.meta.revision, entry.meta.coalesced])).toEqual([[{ x: 1, y: 1 }, 1, 1]])
      await session.close()
    })

    it('refuses even when nobody is subscribed, and accepts an empty list', async () => {
      const { clock, session, popup } = await connect()
      expect(() => popup.emit(CURSOR, { x: 1, y: 1 }, { transfer: [new ArrayBuffer(1)] })).toThrow(TypeError)
      expect(() => popup.emit(CURSOR, { x: 1, y: 1 }, { transfer: [] })).not.toThrow()
      const seen = await listen(session, CURSOR)
      popup.emit(CURSOR, { x: 2, y: 2 })
      await clock.advance(50)
      expect(revisions(seen)).toEqual([2]) // only the empty-list emit consumed a revision
      await session.close()
    })
  })

  describe('events that wait are never lost', () => {
    it('settles on unsubscribe, so the next subscription does not receive the old burst', async () => {
      const { clock, session, popup } = await connect()
      const off = await session.subscribe(CURSOR, () => undefined)
      popup.emit(CURSOR, { x: 1, y: 1 })
      popup.emit(CURSOR, { x: 2, y: 2 })
      popup.emit(CURSOR, { x: 3, y: 3 })
      await off() // settles the burst as revision 1
      const seen = await listen(session, CURSOR)
      popup.emit(CURSOR, { x: 9, y: 9 })
      await clock.advance(50)
      expect(seen.map(entry => [entry.payload, entry.meta.revision, entry.meta.gap, entry.meta.coalesced])).toEqual([[{ x: 9, y: 9 }, 2, false, 1]])
      await session.close()
    })

    it('sends what is waiting on flushEvents, cancels the window and can flush one event or all', async () => {
      const { clock, session, popup } = await connect()
      const cursor = await listen(session, CURSOR)
      const touched = await listen(session, TOUCHED)
      popup.emit(CURSOR, { x: 1, y: 1 })
      popup.emit(CURSOR, { x: 2, y: 2 })
      popup.emit(TOUCHED, { ids: ['a'] })
      popup.flushEvents(CURSOR)
      await clock.settle()
      expect(cursor.map(entry => [entry.payload, entry.meta.coalesced])).toEqual([[{ x: 2, y: 2 }, 2]])
      expect(touched).toEqual([])
      popup.flushEvents()
      await clock.settle()
      expect(touched.map(entry => entry.payload)).toEqual([{ ids: ['a'] }])
      await clock.advance(500) // the cancelled windows do not send again
      expect(cursor).toHaveLength(1)
      expect(touched).toHaveLength(1)
      popup.flushEvents() // nothing waits: harmless
      await session.close()
    })

    it('sends what is waiting before the page goes away, ahead of the unload notice', async () => {
      const { clock, session, popup, browser } = await connect()
      const seen = await listen(session, CURSOR)
      popup.emit(CURSOR, { x: 1, y: 1 })
      popup.emit(CURSOR, { x: 2, y: 2 })
      popup.emit(CURSOR, { x: 3, y: 3 })
      browser.popups[0]!.freeze() // pagehide
      await vi.waitFor(() => expect(session.state).toBe('WAITING_HELLO'))
      expect(seen.map(entry => [entry.payload, entry.meta.revision, entry.meta.coalesced])).toEqual([[{ x: 3, y: 3 }, 1, 3]])
      await clock.advance(500)
      expect(seen).toHaveLength(1)
      await session.close()
    })

    it('sends what is waiting when the popup closes, before the session ends', async () => {
      const { session, popup } = await connect()
      const order: string[] = []
      await session.subscribe(CURSOR, (_payload, meta) => order.push(`event:${meta.coalesced}`))
      session.on('close', () => order.push('close'))
      popup.emit(CURSOR, { x: 1, y: 1 })
      popup.emit(CURSOR, { x: 2, y: 2 })
      popup.close()
      await session.closed
      expect(order).toEqual(['event:2', 'close'])
    })

    it('starts a reloaded page over: its own revisions, and nothing of the old page after reconnect', async () => {
      const { clock, session, popup, browser, booted } = await connect()
      const seen = await listen(session, CURSOR)
      popup.emit(CURSOR, { x: 1, y: 1 })
      popup.emit(CURSOR, { x: 2, y: 2 })
      const info = new Promise<ReconnectInfo>(resolve => session.on('reconnect', resolve))
      browser.popups[0]!.reload()
      expect((await info).replay[CURSOR]).toMatchObject({ outcome: 'reset' })
      // Whether the old page's last event beat the reload is a race the host cannot win; it does not matter.
      const before = seen.length
      booted[1]!.runtime.emit(CURSOR, { x: 7, y: 7 })
      await clock.advance(500)
      expect(seen.slice(before).map(entry => [entry.payload, entry.meta.revision, entry.meta.gap, entry.meta.coalesced])).toEqual([[{ x: 7, y: 7 }, 1, false, 1]])
      await session.close()
    })
  })

  describe('payload validation and failures', () => {
    const payload = (value: unknown): { n: number } => {
      const candidate = value as { n?: unknown } | null
      if (typeof candidate?.n !== 'number' || candidate.n < 0) throw new Error('n must be a non-negative number')
      return { n: candidate.n }
    }
    const contract = defineContract({
      id: 'validated',
      events: {
        'v.sum': event<{ n: number }>({ payload, coalesce: { windowMs: 50, strategy: (a, b) => ({ n: a.n + b.n }) } }),
        'v.cap': event<{ n: number }>({ payload, coalesce: { windowMs: 50, strategy: (a, b) => ({ n: a.n + b.n > 100 ? -1 : a.n + b.n }) } }),
        'v.throws': event<{ n: number }>({ payload, coalesce: { windowMs: 50, strategy: (a, b) => { if (b.n === 13) throw new Error('unlucky'); return { n: a.n + b.n } } } }),
        'v.sneaky': event<{ n: number }>({ coalesce: { windowMs: 50, strategy: (a, b) => ({ n: a.n + b.n, send: () => 1 } as never) } }),
      },
    })
    const validatedDefinition = definePopup(contract, { url: 'https://tools.example.com/validated' })

    async function open(popupOptions: { onError?: (error: unknown) => void } = {}) {
      const clock = createManualClock()
      const browser = createMemoryBrowser({ clock })
      let runtime!: PopupRuntime<typeof contract>
      browser.onPopupLoad(page => {
        runtime = createPopupRuntime({ contract, allowedHostOrigins: [browser.hostOrigin], env: page.env, ...popupOptions })
        void runtime.start().catch(() => undefined)
      })
      const bridge = createPopupBridge({ env: browser.hostEnv, defaults: { closedPollMs: 20 } })
      const session = await bridge.open(validatedDefinition, {})
      const seen: Seen = []
      const listenTo = async (name: EventName<(typeof contract)['events']>) => {
        await session.subscribe(name, (value: unknown, meta) => seen.push({ payload: value, meta }))
      }
      return { clock, session, runtime, seen, listenTo }
    }

    it('merges validated payloads and keeps the merged one valid', async () => {
      const { clock, session, runtime, seen, listenTo } = await open()
      await listenTo('v.sum')
      runtime.emit('v.sum', { n: 1 })
      runtime.emit('v.sum', { n: 2 })
      runtime.emit('v.sum', { n: 3 })
      await clock.advance(50)
      expect(seen.map(entry => [entry.payload, entry.meta.coalesced])).toEqual([[{ n: 6 }, 3]])
      await session.close()
    })

    it('rejects an invalid payload at emit, merged or not, and does not touch what is pending', async () => {
      const { clock, session, runtime, seen, listenTo } = await open()
      await listenTo('v.sum')
      runtime.emit('v.sum', { n: 1 })
      expect(() => runtime.emit('v.sum', { n: -5 })).toThrowError(expect.objectContaining({ code: 'INVALID_PARAMS' }))
      runtime.emit('v.sum', { n: 2 })
      await clock.advance(50)
      expect(seen.map(entry => [entry.payload, entry.meta.coalesced])).toEqual([[{ n: 3 }, 2]])
      await session.close()
    })

    it('rejects an emit whose merge is invalid and keeps the events merged so far', async () => {
      const { clock, session, runtime, seen, listenTo } = await open()
      await listenTo('v.cap')
      runtime.emit('v.cap', { n: 60 })
      runtime.emit('v.cap', { n: 30 })
      expect(() => runtime.emit('v.cap', { n: 20 })).toThrowError(expect.objectContaining({ code: 'INVALID_PARAMS' }))
      await clock.advance(50)
      expect(seen.map(entry => [entry.payload, entry.meta.coalesced])).toEqual([[{ n: 90 }, 2]])
      await session.close()
    })

    it('lets the error of a failing reducer reach the emitter', async () => {
      const { clock, session, runtime, seen, listenTo } = await open()
      await listenTo('v.throws')
      runtime.emit('v.throws', { n: 1 })
      expect(() => runtime.emit('v.throws', { n: 13 })).toThrow('unlucky')
      runtime.emit('v.throws', { n: 2 })
      await clock.advance(50)
      expect(seen.map(entry => [entry.payload, entry.meta.coalesced])).toEqual([[{ n: 3 }, 2]])
      await session.close()
    })

    it('reports a merged event that cannot be sent to onError and counts its revision as lost', async () => {
      const errors: unknown[] = []
      const { clock, session, runtime, seen, listenTo } = await open({ onError: error => errors.push(error) })
      await listenTo('v.sneaky')
      runtime.emit('v.sneaky', { n: 1 })
      runtime.emit('v.sneaky', { n: 2 }) // the merge holds a function: caught only when it is sent
      await clock.advance(50)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatchObject({ code: 'NOT_CLONEABLE' })
      expect(seen).toEqual([])
      runtime.emit('v.sneaky', { n: 5 })
      await clock.advance(50)
      // The lost event used revision 1, so the host sees the hole instead of silently skipping it.
      expect(seen.map(entry => [entry.meta.revision, entry.meta.gap, entry.meta.missed])).toEqual([[2, true, 1]])
      await session.close()
    })

    it('writes timer-path failures to the console by default', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const { clock, session, runtime, listenTo } = await open()
      await listenTo('v.sneaky')
      runtime.emit('v.sneaky', { n: 1 })
      runtime.emit('v.sneaky', { n: 2 })
      await clock.advance(50)
      expect(spy).toHaveBeenCalledWith('[popup-bridge]', expect.objectContaining({ code: 'NOT_CLONEABLE' }))
      await session.close()
    })

    it('refuses an uncloneable payload at emit without consuming a revision', async () => {
      const { clock, session, runtime, seen, listenTo } = await open()
      await listenTo('v.sum')
      expect(() => runtime.emit('v.sum', { n: 1, send: () => 1 } as never)).toThrowError(expect.objectContaining({ code: 'NOT_CLONEABLE' }))
      runtime.emit('v.sum', { n: 4 })
      await clock.advance(50)
      expect(seen.map(entry => [entry.meta.revision, entry.meta.gap])).toEqual([[1, false]])
      await session.close()
    })
  })
})

// ---- coalescing together with replay and a restored page --------------------------------------

describe('coalescing and replay', () => {
  it('replays the events that left, with their merge counts, and not the ones still waiting', async () => {
    const { clock, session, popup } = await connectRaw()
    const seen = await listen(session, SCROLLED)
    for (let top = 1; top <= 3; top++) popup.emit(SCROLLED, { top })
    await clock.advance(50)
    popup.emit(SCROLLED, { top: 4 })
    popup.emit(SCROLLED, { top: 5 }) // still waiting for its window
    expect(revisions(seen)).toEqual([1])
    const reply = await replayOf(session, SCROLLED, 0)
    expect(reply).toMatchObject({ revision: 1, oldest: 1, capacity: 8 })
    expect(reply.entries).toEqual([{ revision: 1, coalesced: 3, payload: { top: 3 } }])
    await session.close()
  })

  it('refills a hole left by a dropped event from the buffer, keeping the merge counts', async () => {
    const { clock, session, popup, securityEvents } = await connect({}, { limits: { maxNotificationsPerSecond: 2 } })
    const seen = await listen(session, SCROLLED)
    const burst = async (from: number, count: number) => {
      for (let i = 0; i < count; i++) popup.emit(SCROLLED, { top: from + i })
      await clock.advance(50)
    }
    await burst(10, 2) // revision 1, merged 2
    await burst(20, 3) // revision 2, merged 3
    await burst(30, 4) // revision 3, merged 4: over the limit, dropped by the host
    expect(securityEvents.filter(event => event.type === 'rate-limited')).toHaveLength(1)
    expect(revisions(seen)).toEqual([1, 2])
    await clock.advance(1_000) // the limit window is over
    await burst(40, 5) // revision 4 arrives and reveals the hole
    await vi.waitFor(() => expect(seen).toHaveLength(4))
    expect(seen.map(entry => [entry.meta.revision, entry.meta.gap, entry.meta.replayed, entry.meta.coalesced])).toEqual([
      [1, false, false, 2],
      [2, false, false, 3],
      [3, false, true, 4],
      [4, false, true, 5],
    ])
    expect(seen.map(entry => entry.payload)).toEqual([{ top: 11 }, { top: 22 }, { top: 33 }, { top: 44 }])
    await session.close()
  })

  it('records the events waiting when the page is restored, and the host replays them after it reconnects', async () => {
    const { clock, session, popup, browser } = await connect()
    const seen = await listen(session, SCROLLED)
    popup.emit(SCROLLED, { top: 1 })
    await clock.advance(50)
    expect(revisions(seen)).toEqual([1])

    popup.emit(SCROLLED, { top: 2 })
    popup.emit(SCROLLED, { top: 3 })
    popup.emit(SCROLLED, { top: 4 }) // waiting when the page is restored, with no pagehide before it
    const info = new Promise<ReconnectInfo>(resolve => session.on('reconnect', resolve))
    browser.popups[0]!.restore()
    const reconnected = await info

    expect(reconnected.replay[SCROLLED]).toEqual({ outcome: 'replayed', replayed: 1, missed: 0 })
    expect(seen.map(entry => [entry.meta.revision, entry.meta.gap, entry.meta.replayed, entry.meta.coalesced, entry.payload])).toEqual([
      [1, false, false, 1, { top: 1 }],
      [2, false, true, 3, { top: 4 }],
    ])
    // Nothing is sent twice when the old window would have ended, and the stream goes on live.
    await clock.advance(200)
    expect(seen).toHaveLength(2)
    popup.emit(SCROLLED, { top: 5 })
    await clock.advance(50)
    expect(seen.at(-1)!.meta).toMatchObject({ revision: 3, gap: false, replayed: false, coalesced: 1 })
    await session.close()
  })

  it('cannot replay what was waiting for an event that keeps no history, and flags the gap on its next event', async () => {
    const { clock, session, popup, browser } = await connect()
    const seen = await listen(session, CURSOR) // merges, but has no replay buffer
    popup.emit(CURSOR, { x: 1, y: 1 })
    await clock.advance(50)
    popup.emit(CURSOR, { x: 2, y: 2 })
    popup.emit(CURSOR, { x: 3, y: 3 })
    const info = new Promise<ReconnectInfo>(resolve => session.on('reconnect', resolve))
    browser.popups[0]!.restore()
    // The pending event used revision 2 and nobody kept it.
    expect((await info).replay[CURSOR]).toEqual({ outcome: 'gap', replayed: 0, missed: 1 })
    popup.emit(CURSOR, { x: 4, y: 4 })
    await clock.advance(50)
    expect(seen.map(entry => [entry.meta.revision, entry.meta.gap, entry.meta.missed])).toEqual([[1, false, 0], [3, true, 1]])
    await session.close()
  })

  it('treats an emit made while the page is cached like one that was waiting', async () => {
    const { clock, session, popup, browser } = await connect()
    const seen = await listen(session, SCROLLED)
    popup.emit(SCROLLED, { top: 1 })
    popup.emit(SCROLLED, { top: 2 })
    await clock.advance(50)
    browser.popups[0]!.freeze() // pagehide, then the host drops the connection
    await vi.waitFor(() => expect(session.state).toBe('WAITING_HELLO'))
    popup.emit(SCROLLED, { top: 3 })
    const info = new Promise<ReconnectInfo>(resolve => session.on('reconnect', resolve))
    browser.popups[0]!.restore()
    await info
    expect(seen.map(entry => [entry.meta.revision, entry.meta.replayed, entry.meta.coalesced])).toEqual([[1, false, 2], [2, true, 1]])
    await session.close()
  })

  it('buffers the emits nobody listens to one by one, because nothing merges for them', async () => {
    const { clock, session, popup } = await connectRaw()
    const armed = clock.pending
    for (let top = 1; top <= 4; top++) popup.emit(SCROLLED, { top })
    expect(clock.pending).toBe(armed) // no window was opened
    const reply = await replayOf(session, SCROLLED, 0)
    expect(reply.entries.map(entry => [entry.revision, entry.coalesced])).toEqual([[1, undefined], [2, undefined], [3, undefined], [4, undefined]])
    await session.close()
  })
})
