import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BridgeError,
  FEATURE_EVENTS_REPLAY,
  defineContract,
  event,
  type ReplayEntry,
} from '../src/index.js'
import { createPopupBridge, type EventMeta, type ReconnectInfo } from '../src/host.js'
import { createPopupRuntime, type PopupRuntime } from '../src/popup.js'
import {
  MAX_REPLAY_CAPACITY,
  REPLAY_METHOD,
  ReplayBuffer,
  assertReplayCapacity,
  buildReplayReply,
  parseReplayReply,
  parseReplayRequest,
} from '../src/events/replay.js'
import { createMemoryBrowser } from '../src/testing.js'
import { definition, init, setup } from './fixture.js'

async function rejectsWith(promise: Promise<unknown>, code: string): Promise<BridgeError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(BridgeError)
  expect((error as BridgeError).code).toBe(code)
  return error as BridgeError
}

const PROGRESS = 'asset.progress' as const
const SELECTION = 'asset.selectionChanged' as const

describe('ReplayBuffer', () => {
  it('keeps the newest revisions and moves its window forward', () => {
    const buffer = new ReplayBuffer(3)
    expect([buffer.current, buffer.oldest, buffer.size]).toEqual([0, 1, 0])
    for (let revision = 1; revision <= 5; revision++) buffer.record(revision, `p${revision}`)
    expect([buffer.current, buffer.oldest, buffer.size]).toEqual([5, 3, 3])
    expect(buffer.since(2).map(e => e.revision)).toEqual([3, 4, 5])
    expect(buffer.since(3).map(e => e.revision)).toEqual([4, 5])
    expect(buffer.since(5)).toEqual([])
    expect(buffer.since(9)).toEqual([])
  })

  it('starts after revisions consumed before it existed', () => {
    const buffer = new ReplayBuffer(2, 7)
    expect([buffer.current, buffer.oldest]).toEqual([7, 8])
    buffer.record(8, 'x')
    expect(buffer.since(7)).toEqual([{ revision: 8, payload: 'x' }])
    expect(buffer.since(5)).toEqual([{ revision: 8, payload: 'x' }]) // 6 and 7 are not held
    expect(buffer.oldest).toBe(8)
  })

  it('drops everything older when a revision cannot be kept', () => {
    const buffer = new ReplayBuffer(4)
    buffer.record(1, 'a')
    buffer.record(2, 'b')
    buffer.evictThrough(3)
    expect([buffer.current, buffer.oldest, buffer.size]).toEqual([3, 4, 0]) // 3 happened and cannot be replayed
    expect(buffer.since(0)).toEqual([])
    buffer.record(4, 'd')
    expect(buffer.since(0).map(e => e.revision)).toEqual([4])
    expect(buffer.oldest).toBe(4)
  })

  it('refuses revisions that do not follow the previous one and keeps coalesced counts', () => {
    const buffer = new ReplayBuffer(2)
    buffer.record(1, 'a', 5)
    expect(() => buffer.record(3, 'c')).toThrow(RangeError)
    expect(() => buffer.evictThrough(1)).toThrow(RangeError)
    expect(buffer.since(0)).toEqual([{ revision: 1, coalesced: 5, payload: 'a' }])
  })

  it('validates capacities', () => {
    expect(() => new ReplayBuffer(0)).toThrow(TypeError)
    expect(() => new ReplayBuffer(MAX_REPLAY_CAPACITY + 1)).toThrow(TypeError)
    expect(() => assertReplayCapacity(0, 'x', 0)).not.toThrow()
    for (const bad of [1.5, -1, '3', undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => assertReplayCapacity(bad, 'replay.capacity', 0), String(bad)).toThrow(/replay\.capacity/)
    }
  })
})

describe('replay wire format', () => {
  it('reads a request strictly', () => {
    expect(parseReplayRequest({ name: 'a.b', since: 0 })).toEqual({ name: 'a.b', since: 0 })
    for (const bad of [undefined, null, [], { name: 'a.b' }, { name: 1, since: 0 }, { name: 'a.b', since: -1 }, { name: 'a.b', since: 1.5 }, { name: 'a.b', since: '1' }]) {
      expect(() => parseReplayRequest(bad), JSON.stringify(bad)).toThrowError(expect.objectContaining({ code: 'INVALID_PARAMS' }))
    }
  })

  it('builds a reply from the buffer, or an honest empty one without a buffer', () => {
    const buffer = new ReplayBuffer(2)
    for (let revision = 1; revision <= 3; revision++) buffer.record(revision, revision)
    expect(buildReplayReply('e', 3, buffer, 1)).toEqual({ epoch: 'e', revision: 3, oldest: 2, capacity: 2, entries: [{ revision: 2, payload: 2 }, { revision: 3, payload: 3 }] })
    expect(buildReplayReply('e', 3, undefined, 1)).toEqual({ epoch: 'e', revision: 3, oldest: 4, capacity: 0, entries: [] })
  })

  it('accepts a coherent reply and keeps valid coalesced counts', () => {
    const reply = { epoch: 'e', revision: 4, oldest: 2, capacity: 8, entries: [{ revision: 2, payload: 'a' }, { revision: 4, coalesced: 3, payload: 'b', extra: 1 }] }
    expect(parseReplayReply(reply)).toEqual({
      epoch: 'e', revision: 4, oldest: 2, capacity: 8, entries: [{ revision: 2, payload: 'a' }, { revision: 4, coalesced: 3, payload: 'b' }],
    })
    expect(parseReplayReply({ epoch: 'e', revision: 0, oldest: 1, capacity: 0, entries: [] })).toBeDefined()
  })

  it.each([
    ['not an object', null],
    ['missing epoch', { revision: 1, oldest: 1, capacity: 1, entries: [] }],
    ['empty epoch', { epoch: '', revision: 1, oldest: 1, capacity: 1, entries: [] }],
    ['oversized epoch', { epoch: 'x'.repeat(129), revision: 1, oldest: 1, capacity: 1, entries: [] }],
    ['fractional revision', { epoch: 'e', revision: 1.5, oldest: 1, capacity: 1, entries: [] }],
    ['oldest beyond revision + 1', { epoch: 'e', revision: 1, oldest: 3, capacity: 1, entries: [] }],
    ['capacity above the maximum', { epoch: 'e', revision: 1, oldest: 1, capacity: MAX_REPLAY_CAPACITY + 1, entries: [] }],
    ['entries not an array', { epoch: 'e', revision: 1, oldest: 1, capacity: 1, entries: {} }],
    ['entries out of order', { epoch: 'e', revision: 3, oldest: 1, capacity: 3, entries: [{ revision: 2, payload: 0 }, { revision: 1, payload: 0 }] }],
    ['duplicate entry', { epoch: 'e', revision: 3, oldest: 1, capacity: 3, entries: [{ revision: 2, payload: 0 }, { revision: 2, payload: 0 }] }],
    ['entry beyond revision', { epoch: 'e', revision: 2, oldest: 1, capacity: 3, entries: [{ revision: 3, payload: 0 }] }],
    ['entry below oldest', { epoch: 'e', revision: 3, oldest: 2, capacity: 3, entries: [{ revision: 1, payload: 0 }] }],
    ['entry revision 0', { epoch: 'e', revision: 3, oldest: 1, capacity: 3, entries: [{ revision: 0, payload: 0 }] }],
    ['coalesced of 1', { epoch: 'e', revision: 3, oldest: 1, capacity: 3, entries: [{ revision: 1, coalesced: 1, payload: 0 }] }],
    ['revision as text', { epoch: 'e', revision: 3, oldest: 1, capacity: 3, entries: [{ revision: '2', payload: 0 }] }],
    ['fractional entry revision', { epoch: 'e', revision: 3, oldest: 1, capacity: 3, entries: [{ revision: 2.5, payload: 0 }] }],
    ['coalesced as text', { epoch: 'e', revision: 3, oldest: 1, capacity: 3, entries: [{ revision: 1, coalesced: '2', payload: 0 }] }],
    ['more entries than any buffer holds', { epoch: 'e', revision: 5_000, oldest: 1, capacity: 1_000, entries: Array.from({ length: MAX_REPLAY_CAPACITY + 1 }, (_, i): ReplayEntry => ({ revision: i + 1, payload: 0 })) }],
  ])('refuses a reply with %s', (_label, reply) => {
    expect(parseReplayReply(reply)).toBeUndefined()
  })
})

describe('event declarations with replay', () => {
  it('stores a validated capacity on the spec', () => {
    expect(event({ replay: { capacity: 8 } }).replay).toEqual({ capacity: 8 })
    expect(event().replay).toBeUndefined()
    expect(event({ replay: { capacity: MAX_REPLAY_CAPACITY } }).replay?.capacity).toBe(MAX_REPLAY_CAPACITY)
  })

  it.each([0, -1, 1.5, MAX_REPLAY_CAPACITY + 1, Number.NaN, '4'])('rejects capacity %s', capacity => {
    expect(() => event({ replay: { capacity: capacity as number } })).toThrow(TypeError)
  })
})

/** Reads the popup's replay buffer directly, the way a host does on the wire. */
async function replayOf(session: { call(name: string, params?: unknown): Promise<unknown> }, name: string, since: number) {
  return (await session.call(REPLAY_METHOD, { name, since })) as { epoch: string; revision: number; oldest: number; capacity: number; entries: ReplayEntry[] }
}

const raw = { id: 'asset-selector', url: 'https://tools.example.com/asset-selector', expectedOrigin: 'https://tools.example.com', protocolVersions: ['1.0'], requiredCapabilities: [] }

describe('bridge.replay on the popup', () => {
  it('returns what the event buffered, with the popup epoch', async () => {
    const { bridge, booted } = setup()
    const session = await bridge.open(raw, { init })
    const popup = booted[0]!.runtime
    for (let percent = 1; percent <= 3; percent++) popup.emit(PROGRESS, { percent })
    const reply = await replayOf(session, PROGRESS, 1)
    expect(reply).toMatchObject({ revision: 3, oldest: 1, capacity: 8 })
    expect(reply.entries).toEqual([{ revision: 2, payload: { percent: 2 } }, { revision: 3, payload: { percent: 3 } }])
    expect(reply.epoch).toEqual(expect.any(String))
    expect((await replayOf(session, PROGRESS, 3)).entries).toEqual([])
    await session.close()
  })

  it('reports the revision but no history for an event without a buffer', async () => {
    const { bridge, booted } = setup()
    const session = await bridge.open(raw, { init })
    booted[0]!.runtime.emit(SELECTION, { assetIds: ['a'] })
    booted[0]!.runtime.emit(SELECTION, { assetIds: ['b'] })
    expect(await replayOf(session, SELECTION, 0)).toMatchObject({ revision: 2, oldest: 3, capacity: 0, entries: [] })
    await session.close()
  })

  it('keeps history of what was emitted before anyone subscribed', async () => {
    const { bridge, booted } = setup()
    const session = await bridge.open(raw, { init })
    booted[0]!.runtime.emit(PROGRESS, { percent: 10 })
    expect((await replayOf(session, PROGRESS, 0)).entries).toEqual([{ revision: 1, payload: { percent: 10 } }])
    await session.close()
  })

  it('stores a private copy, so changing the payload afterwards does not rewrite history', async () => {
    const { bridge, booted } = setup()
    const session = await bridge.open(raw, { init })
    const payload = { percent: 1 }
    booted[0]!.runtime.emit(PROGRESS, payload)
    payload.percent = 99
    expect((await replayOf(session, PROGRESS, 0)).entries[0]!.payload).toEqual({ percent: 1 })
    await session.close()
  })

  it('answers bad requests with INVALID_PARAMS and unknown events with CAPABILITY_UNAVAILABLE', async () => {
    const { bridge } = setup()
    const session = await bridge.open(raw, { init })
    await rejectsWith(session.call(REPLAY_METHOD, { name: PROGRESS }), 'INVALID_PARAMS')
    await rejectsWith(session.call(REPLAY_METHOD, { name: PROGRESS, since: -1 }), 'INVALID_PARAMS')
    await rejectsWith(session.call(REPLAY_METHOD, { name: 'asset.nope', since: 0 }), 'CAPABILITY_UNAVAILABLE')
    await session.close()
  })

  it('goes through the popup authorize hook like any other call', async () => {
    const seen: string[] = []
    const { bridge } = setup({ popupAuthorize: call => { seen.push(call.method); return call.method !== REPLAY_METHOD } })
    const session = await bridge.open(raw, { init })
    await rejectsWith(session.call(REPLAY_METHOD, { name: PROGRESS, since: 0 }), 'PERMISSION_DENIED')
    expect(seen).toContain(REPLAY_METHOD)
    await session.close()
  })

  it('does not exist on a connection that did not agree on replay', async () => {
    for (const config of [
      { popup: { popupFeatures: [] as string[] }, host: {} },
      { popup: {}, host: { features: [] as string[] } },
    ]) {
      const { bridge, booted } = setup(config.popup)
      const session = await bridge.open(raw, { init, ...config.host })
      expect(session.features.has(FEATURE_EVENTS_REPLAY)).toBe(false)
      booted[0]!.runtime.emit(PROGRESS, { percent: 1 })
      await rejectsWith(session.call(REPLAY_METHOD, { name: PROGRESS, since: 0 }), 'METHOD_NOT_FOUND')
      await session.close()
    }
  })
})

describe('emit and the replay buffer', () => {
  it('refuses a payload it cannot copy before it consumes a revision, even with nobody subscribed', async () => {
    const { bridge, booted } = setup()
    const session = await bridge.open(raw, { init })
    const popup = booted[0]!.runtime
    expect(() => popup.emit(PROGRESS, { percent: (() => 1) as never })).toThrowError(expect.objectContaining({ code: 'NOT_CLONEABLE' }))
    popup.emit(PROGRESS, { percent: 5 })
    const reply = await replayOf(session, PROGRESS, 0)
    expect(reply.revision).toBe(1)
    expect(reply.entries).toEqual([{ revision: 1, payload: { percent: 5 } }])
    await session.close()
  })

  it('does not buffer when the popup does not offer replay, and then keeps the old behavior', async () => {
    const { bridge, booted } = setup({ popupFeatures: [] })
    const session = await bridge.open(definition, { init })
    const popup = booted[0]!.runtime
    // Nothing is copied for a buffer, so an uncloneable payload only matters once it is sent.
    expect(() => popup.emit(PROGRESS, { percent: (() => 1) as never })).not.toThrow()
    const metas: EventMeta[] = []
    await session.subscribe(PROGRESS, (_p, meta) => metas.push(meta))
    popup.emit(PROGRESS, { percent: 2 })
    await vi.waitFor(() => expect(metas).toHaveLength(1))
    expect(metas[0]).toMatchObject({ revision: 2, gap: false, replayed: false })
    await session.close()
  })

  it('does not buffer an event that declares no capacity unless the runtime sets a default', async () => {
    const plain = setup()
    const first = await plain.bridge.open(raw, { init })
    plain.booted[0]!.runtime.emit(SELECTION, { assetIds: [] })
    expect((await replayOf(first, SELECTION, 0)).capacity).toBe(0)
    await first.close()
  })

  it('validates the default capacity of the runtime', () => {
    const env = { host: null, hash: '', listen: () => () => undefined, onPageHide: () => () => undefined }
    const create = (capacity: number) => createPopupRuntime({ allowedHostOrigins: ['https://app.example.com'], env, replay: { capacity } })
    expect(() => create(-1)).toThrow(/replay\.capacity/)
    expect(() => create(MAX_REPLAY_CAPACITY + 1)).toThrow(TypeError)
    expect(() => create(0)).not.toThrow()
    expect(() => create(50)).not.toThrow()
  })
})

// ---- a contract with a transferable payload and a runtime default capacity -----------------------

const chunkContract = defineContract({
  id: 'chunks',
  events: {
    'chunk.ready': event<{ n: number; bytes?: ArrayBuffer }>({ replay: { capacity: 4 } }),
    'chunk.log': event<{ line: string }>(),
  },
})
const chunkDefinition = { id: 'chunks', url: 'https://tools.example.com/chunks', expectedOrigin: 'https://tools.example.com', protocolVersions: ['1.0'], requiredCapabilities: [] }

function chunkSetup(runtimeOptions: { replay?: { capacity?: number }; features?: readonly string[] } = {}) {
  const browser = createMemoryBrowser()
  const runtimes: Array<PopupRuntime<typeof chunkContract>> = []
  browser.onPopupLoad(page => {
    const runtime = createPopupRuntime({ contract: chunkContract, allowedHostOrigins: [browser.hostOrigin], env: page.env, openerPollMs: 20, ...runtimeOptions })
    runtimes.push(runtime)
    void runtime.start().catch(() => undefined)
  })
  const bridge = createPopupBridge({ env: browser.hostEnv, defaults: { closedPollMs: 20, heartbeat: false } })
  return { browser, bridge, runtimes }
}

describe('events with a transfer list or a runtime default', () => {
  it('cannot replay a transferred payload and says so instead of pretending the window is continuous', async () => {
    const { bridge, runtimes } = chunkSetup()
    const session = await bridge.open(chunkDefinition)
    const popup = runtimes[0]!
    popup.emit('chunk.ready', { n: 1 })
    const bytes = new ArrayBuffer(8)
    popup.emit('chunk.ready', { n: 2, bytes }, { transfer: [bytes] })
    popup.emit('chunk.ready', { n: 3 })
    const reply = await replayOf(session, 'chunk.ready', 0)
    expect(reply).toMatchObject({ revision: 3, oldest: 3 })
    expect(reply.entries).toEqual([{ revision: 3, payload: { n: 3 } }])
    await session.close()
  })

  it('uses the default capacity for events that declare none', async () => {
    const { bridge, runtimes } = chunkSetup({ replay: { capacity: 2 } })
    const session = await bridge.open(chunkDefinition)
    for (let i = 1; i <= 3; i++) runtimes[0]!.emit('chunk.log', { line: `l${i}` })
    const reply = await replayOf(session, 'chunk.log', 0)
    expect(reply).toMatchObject({ revision: 3, oldest: 2, capacity: 2 })
    expect(reply.entries.map(e => e.revision)).toEqual([2, 3])
    // An event's own capacity wins over the default.
    for (let i = 1; i <= 6; i++) runtimes[0]!.emit('chunk.ready', { n: i })
    expect((await replayOf(session, 'chunk.ready', 0)).capacity).toBe(4)
    await session.close()
  })

  it('keeps no history when replay is switched off through features, whatever the capacities say', async () => {
    const { bridge, runtimes } = chunkSetup({ replay: { capacity: 5 }, features: [] })
    const session = await bridge.open(chunkDefinition)
    runtimes[0]!.emit('chunk.ready', { n: 1 })
    await rejectsWith(session.call(REPLAY_METHOD, { name: 'chunk.ready', since: 0 }), 'METHOD_NOT_FOUND')
    await session.close()
  })

  it('replays a payload that holds a buffer after a restore, and flags what a transfer lost', async () => {
    const { bridge, browser, runtimes } = chunkSetup()
    const session = await bridge.open(chunkDefinition)
    const metas: EventMeta[] = []
    await session.subscribe('chunk.ready', (_p, meta) => metas.push(meta))
    browser.popups[0]!.freeze()
    await vi.waitFor(() => expect(session.state).toBe('WAITING_HELLO'))
    const bytes = new ArrayBuffer(8)
    runtimes[0]!.emit('chunk.ready', { n: 1 })
    runtimes[0]!.emit('chunk.ready', { n: 2, bytes }, { transfer: [bytes] })
    runtimes[0]!.emit('chunk.ready', { n: 3 })
    const info = new Promise<ReconnectInfo>(resolve => session.on('reconnect', resolve))
    browser.popups[0]!.restore()
    expect((await info).replay['chunk.ready']).toEqual({ outcome: 'gap', replayed: 1, missed: 2 })
    expect(metas.map(m => [m.revision, m.gap, m.missed, m.replayed])).toEqual([[3, true, 2, true]])
    await session.close()
  })
})

describe('recovery across a restored page', () => {
  it('replays the events emitted while the page was cached, before reconnect fires', async () => {
    const { bridge, browser, booted } = setup()
    const session = await bridge.open(definition, { init })
    const order: string[] = []
    const metas: EventMeta[] = []
    await session.subscribe(PROGRESS, (payload, meta) => {
      metas.push(meta)
      order.push(`event:${payload.percent}`)
    })
    const popup = booted[0]!.runtime
    popup.emit(PROGRESS, { percent: 10 })
    popup.emit(PROGRESS, { percent: 20 })
    await vi.waitFor(() => expect(metas).toHaveLength(2))

    browser.popups[0]!.freeze()
    await vi.waitFor(() => expect(session.state).toBe('WAITING_HELLO'))
    popup.emit(PROGRESS, { percent: 30 })
    popup.emit(PROGRESS, { percent: 40 })
    popup.emit(PROGRESS, { percent: 50 })

    const infos: ReconnectInfo[] = []
    session.on('reconnect', info => {
      order.push('reconnect')
      infos.push(info)
    })
    browser.popups[0]!.restore()
    await vi.waitFor(() => expect(infos).toHaveLength(1))

    expect(metas.map(m => [m.revision, m.gap, m.replayed])).toEqual([[1, false, false], [2, false, false], [3, false, true], [4, false, true], [5, false, true]])
    expect(order).toEqual(['event:10', 'event:20', 'event:30', 'event:40', 'event:50', 'reconnect'])
    expect(infos[0]).toEqual({ resubscribed: [PROGRESS], failed: [], replay: { [PROGRESS]: { outcome: 'replayed', replayed: 3, missed: 0 } } })

    // The stream continues live from where the replay ended.
    popup.emit(PROGRESS, { percent: 60 })
    await vi.waitFor(() => expect(metas).toHaveLength(6))
    expect(metas[5]).toMatchObject({ revision: 6, gap: false, replayed: false })
    await session.close()
  })

  it('flags a gap when the page was cached longer than the buffer reaches', async () => {
    const { bridge, browser, booted } = setup()
    const session = await bridge.open(definition, { init })
    const metas: EventMeta[] = []
    await session.subscribe(PROGRESS, (_p, meta) => metas.push(meta))
    const popup = booted[0]!.runtime
    popup.emit(PROGRESS, { percent: 1 })
    await vi.waitFor(() => expect(metas).toHaveLength(1))
    browser.popups[0]!.freeze()
    await vi.waitFor(() => expect(session.state).toBe('WAITING_HELLO'))
    for (let percent = 2; percent <= 13; percent++) popup.emit(PROGRESS, { percent }) // capacity is 8
    const info = new Promise<ReconnectInfo>(resolve => session.on('reconnect', resolve))
    browser.popups[0]!.restore()
    const reconnected = await info
    // Revisions 2..13 happened; the buffer holds 6..13.
    expect(reconnected.replay[PROGRESS]).toEqual({ outcome: 'gap', replayed: 8, missed: 4 })
    expect(metas.slice(1).map(m => [m.revision, m.gap, m.missed])).toEqual([[6, true, 4], [7, false, 0], [8, false, 0], [9, false, 0], [10, false, 0], [11, false, 0], [12, false, 0], [13, false, 0]])
    await session.close()
  })

  it('has nothing to replay for an event without a buffer and flags the gap on its next event', async () => {
    const { bridge, browser, booted } = setup()
    const session = await bridge.open(definition, { init })
    const metas: EventMeta[] = []
    await session.subscribe(SELECTION, (_p, meta) => metas.push(meta))
    const popup = booted[0]!.runtime
    browser.popups[0]!.freeze()
    await vi.waitFor(() => expect(session.state).toBe('WAITING_HELLO'))
    popup.emit(SELECTION, { assetIds: ['a'] })
    popup.emit(SELECTION, { assetIds: ['b'] })
    const info = new Promise<ReconnectInfo>(resolve => session.on('reconnect', resolve))
    browser.popups[0]!.restore()
    expect((await info).replay[SELECTION]).toEqual({ outcome: 'gap', replayed: 0, missed: 2 })
    expect(metas).toEqual([])
    popup.emit(SELECTION, { assetIds: ['c'] })
    await vi.waitFor(() => expect(metas).toHaveLength(1))
    expect(metas[0]).toMatchObject({ revision: 3, gap: true, missed: 2, replayed: false })
    await session.close()
  })

  it('reports current for an event that stayed quiet', async () => {
    const { bridge, browser } = setup()
    const session = await bridge.open(definition, { init })
    await session.subscribe(PROGRESS, () => undefined)
    browser.popups[0]!.freeze()
    await vi.waitFor(() => expect(session.state).toBe('WAITING_HELLO'))
    const info = new Promise<ReconnectInfo>(resolve => session.on('reconnect', resolve))
    browser.popups[0]!.restore()
    expect((await info).replay[PROGRESS]).toEqual({ outcome: 'current', replayed: 0, missed: 0 })
    await session.close()
  })

  it('treats a reloaded popup as a reset: nothing is replayed and revisions start over', async () => {
    const { bridge, browser, booted } = setup()
    const session = await bridge.open(definition, { init })
    const metas: EventMeta[] = []
    await session.subscribe(PROGRESS, (_p, meta) => metas.push(meta))
    booted[0]!.runtime.emit(PROGRESS, { percent: 1 })
    booted[0]!.runtime.emit(PROGRESS, { percent: 2 })
    await vi.waitFor(() => expect(metas).toHaveLength(2))
    const info = new Promise<ReconnectInfo>(resolve => session.on('reconnect', resolve))
    browser.popups[0]!.reload()
    expect((await info).replay[PROGRESS]).toEqual({ outcome: 'reset', replayed: 0, missed: 0 })
    booted[1]!.runtime.emit(PROGRESS, { percent: 7 })
    await vi.waitFor(() => expect(metas).toHaveLength(3))
    expect(metas[2]).toMatchObject({ revision: 1, gap: false, replayed: false })
    await session.close()
  })

  it('works against a popup that does not offer replay: unsupported, as before', async () => {
    const { bridge, browser, booted } = setup({ popupFeatures: [] })
    const session = await bridge.open(definition, { init })
    const metas: EventMeta[] = []
    await session.subscribe(PROGRESS, (_p, meta) => metas.push(meta))
    const popup = booted[0]!.runtime
    popup.emit(PROGRESS, { percent: 1 })
    await vi.waitFor(() => expect(metas).toHaveLength(1))
    browser.popups[0]!.freeze()
    await vi.waitFor(() => expect(session.state).toBe('WAITING_HELLO'))
    popup.emit(PROGRESS, { percent: 2 })
    const info = new Promise<ReconnectInfo>(resolve => session.on('reconnect', resolve))
    browser.popups[0]!.restore()
    expect((await info).replay[PROGRESS]).toEqual({ outcome: 'unsupported', replayed: 0, missed: 0 })
    expect(metas).toHaveLength(1)
    // Still usable; the lost event is only visible as a gap on the next one, as it always was.
    popup.emit(PROGRESS, { percent: 3 })
    await vi.waitFor(() => expect(metas).toHaveLength(2))
    expect(metas[1]).toMatchObject({ revision: 3, gap: false })
    await session.close()
  })

  it('works against a host that does not offer replay', async () => {
    const { bridge, browser, booted } = setup()
    const session = await bridge.open(definition, { init, features: [] })
    const metas: EventMeta[] = []
    await session.subscribe(PROGRESS, (_p, meta) => metas.push(meta))
    const popup = booted[0]!.runtime
    browser.popups[0]!.freeze()
    await vi.waitFor(() => expect(session.state).toBe('WAITING_HELLO'))
    popup.emit(PROGRESS, { percent: 2 })
    const info = new Promise<ReconnectInfo>(resolve => session.on('reconnect', resolve))
    browser.popups[0]!.restore()
    expect((await info).replay[PROGRESS]).toMatchObject({ outcome: 'unsupported' })
    expect(metas).toEqual([])
    await session.close()
  })

  it('does not announce a reconnect for a connection that was closed while events were recovered', async () => {
    const errors: unknown[] = []
    const { bridge, browser } = setup()
    const session = await bridge.open(definition, { init, onError: error => errors.push(error) })
    await session.subscribe(PROGRESS, () => undefined)
    const reconnected = vi.fn()
    session.on('reconnect', reconnected)
    session.on('state', state => {
      if (state === 'READY') void session.close()
    })
    browser.popups[0]!.freeze()
    await vi.waitFor(() => expect(session.state).toBe('WAITING_HELLO'))
    browser.popups[0]!.restore()
    await session.closed
    await new Promise(r => setTimeout(r, 30))
    expect(reconnected).not.toHaveBeenCalled()
  })
})

describe('recovery from a dropped notification', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('delivers every event once, in order and without a gap, although the host dropped some', async () => {
    const { bridge, booted, securityEvents } = setup()
    const session = await bridge.open(definition, { init, limits: { maxNotificationsPerSecond: 3 }, heartbeat: false })
    const metas: EventMeta[] = []
    await session.subscribe(PROGRESS, (_p, meta) => metas.push(meta))
    const popup = booted[0]!.runtime
    vi.useFakeTimers({ toFake: ['Date'] })
    for (let percent = 1; percent <= 8; percent++) popup.emit(PROGRESS, { percent })
    await vi.waitFor(() => expect(securityEvents.some(e => e.type === 'rate-limited')).toBe(true))
    await new Promise(r => setTimeout(r, 20))
    expect(metas.map(m => m.revision)).toEqual([1, 2, 3])

    // The next rate window: the event that gets through reveals the hole and the host repairs it.
    vi.setSystemTime(Date.now() + 1_500)
    popup.emit(PROGRESS, { percent: 9 })
    await vi.waitFor(() => expect(metas).toHaveLength(9))
    expect(metas.map(m => m.revision)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(metas.every(m => !m.gap && m.missed === 0)).toBe(true)
    expect(metas.map(m => m.replayed)).toEqual([false, false, false, true, true, true, true, true, true])
    await session.close()
  })

  it('replays after a resync that ran before the event was ever emitted', async () => {
    const { bridge, booted, securityEvents } = setup()
    const session = await bridge.open(definition, { init, limits: { maxNotificationsPerSecond: 3 }, heartbeat: false })
    const metas: EventMeta[] = []
    await session.subscribe(PROGRESS, (_p, meta) => metas.push(meta))
    // A health check at startup: nothing was emitted, so the popup has no buffer yet, but it still must report its capacity.
    expect(await session.resync(PROGRESS)).toEqual({ [PROGRESS]: { outcome: 'current', replayed: 0, missed: 0 } })
    const popup = booted[0]!.runtime
    vi.useFakeTimers({ toFake: ['Date'] })
    for (let percent = 1; percent <= 8; percent++) popup.emit(PROGRESS, { percent })
    await vi.waitFor(() => expect(securityEvents.some(e => e.type === 'rate-limited')).toBe(true))
    await new Promise(r => setTimeout(r, 20))
    expect(metas.map(m => m.revision)).toEqual([1, 2, 3])
    vi.setSystemTime(Date.now() + 1_500)
    popup.emit(PROGRESS, { percent: 9 })
    await vi.waitFor(() => expect(metas).toHaveLength(9))
    expect(metas.map(m => m.revision)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(metas.every(m => !m.gap && m.missed === 0)).toBe(true)
    await session.close()
  })

  it('answers a replay request for an event nobody emitted with its declared capacity', async () => {
    const { bridge, booted } = setup()
    const session = await bridge.open(raw, { init, heartbeat: false })
    expect(booted[0]!.runtime.state).toBe('READY')
    const reply = await replayOf(session, PROGRESS, 0)
    expect(reply).toMatchObject({ revision: 0, oldest: 1, capacity: 8, entries: [] })
    // An event without a declared capacity keeps no history.
    expect(await replayOf(session, SELECTION, 0)).toMatchObject({ capacity: 0, entries: [] })
    await session.close()
  })

  it('finds a lost last event with resync', async () => {
    const { bridge, booted } = setup()
    const session = await bridge.open(definition, { init, limits: { maxNotificationsPerSecond: 3 }, heartbeat: false })
    const metas: EventMeta[] = []
    await session.subscribe(PROGRESS, (_p, meta) => metas.push(meta))
    for (let percent = 1; percent <= 6; percent++) booted[0]!.runtime.emit(PROGRESS, { percent })
    await new Promise(r => setTimeout(r, 20))
    expect(metas.map(m => m.revision)).toEqual([1, 2, 3])
    const report = await session.resync(PROGRESS)
    expect(report).toEqual({ [PROGRESS]: { outcome: 'replayed', replayed: 3, missed: 0 } })
    expect(metas.map(m => m.revision)).toEqual([1, 2, 3, 4, 5, 6])
    expect(metas.slice(3).every(m => m.replayed && !m.gap)).toBe(true)
    expect(await session.resync(PROGRESS)).toEqual({ [PROGRESS]: { outcome: 'current', replayed: 0, missed: 0 } })
    await session.close()
  })

  it('needs a ready session and a subscription to resync', async () => {
    const { bridge } = setup()
    const session = await bridge.open(definition, { init })
    await session.subscribe(PROGRESS, () => undefined)
    await rejectsWith(session.resync(SELECTION), 'CAPABILITY_UNAVAILABLE')
    await session.close()
    await rejectsWith(session.resync(), 'SESSION_NOT_READY')
  })

  it('applies the replay timeout and held-event limit options and rejects bad ones', async () => {
    const { bridge } = setup()
    for (const replay of [{ timeoutMs: 0 }, { maxHeld: 1.5 }, { maxHeld: -1 }]) {
      await expect(bridge.open(definition, { init, replay })).rejects.toBeInstanceOf(TypeError)
    }
    const session = await bridge.open(definition, { init, replay: { timeoutMs: 1_000, maxHeld: 4 } })
    expect(session.state).toBe('READY')
    await session.close()
  })
})
