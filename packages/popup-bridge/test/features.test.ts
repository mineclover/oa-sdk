import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FEATURES,
  FEATURE_EVENTS_COALESCE,
  FEATURE_EVENTS_REPLAY,
  MAX_FEATURES,
  NO_FEATURES,
  assertFeatureIds,
  attachSession,
  createFeatureSet,
  definePopup,
  fromMessagePort,
  isFeatureId,
  negotiateFeatures,
  normalizeFeatures,
  parseBridgeMessage,
  readSession,
} from '../src/index.js'
import { createPopupBridge } from '../src/host.js'
import { createPopupRuntime } from '../src/popup.js'
import { isFeatureGated } from '../src/protocol/features.js'
import { createMemoryBrowser, type MemoryBrowser } from '../src/testing.js'
import { assetContract, definition, init, setup } from './fixture.js'

const sorted = (ids: readonly string[]) => [...ids].sort()

describe('feature ids and sets', () => {
  it('accepts dotted lowerCamel ids and rejects everything else', () => {
    for (const id of ['events.replay', 'events.coalesce', 'x.a', 'x.my-thing', 'a', 'x.a1.b2', 'a'.repeat(64)]) {
      expect(isFeatureId(id), id).toBe(true)
    }
    for (const id of ['', 'Events.replay', '1x', 'x.', '.x', 'x..y', 'x.a b', 'x_a', 'x.é', 'x.-a', 'a'.repeat(65)]) {
      expect(isFeatureId(id), id).toBe(false)
    }
    for (const value of [1, null, undefined, {}, ['x.a']]) expect(isFeatureId(value)).toBe(false)
  })

  it('names the built-in ids and offers only what is implemented by default', () => {
    expect(FEATURE_EVENTS_REPLAY).toBe('events.replay')
    expect(FEATURE_EVENTS_COALESCE).toBe('events.coalesce')
    expect(isFeatureId(FEATURE_EVENTS_REPLAY) && isFeatureId(FEATURE_EVENTS_COALESCE)).toBe(true)
    expect(DEFAULT_FEATURES).toEqual([FEATURE_EVENTS_REPLAY, FEATURE_EVENTS_COALESCE])
  })

  it('builds an immutable set that drops repeats and keeps the first order', () => {
    const set = createFeatureSet(['x.b', 'x.a', 'x.b'])
    expect(set.ids).toEqual(['x.b', 'x.a'])
    expect(set.size).toBe(2)
    expect(set.has('x.a')).toBe(true)
    expect(set.has('x.c')).toBe(false)
    expect(Object.isFrozen(set)).toBe(true)
    expect(Object.isFrozen(set.ids)).toBe(true)
    expect(NO_FEATURES.size).toBe(0)
    expect(NO_FEATURES.ids).toEqual([])
    expect(NO_FEATURES.has('x.a')).toBe(false)
  })

  it('validates options strictly and names the offending id', () => {
    expect(() => assertFeatureIds([])).not.toThrow()
    expect(() => assertFeatureIds(['x.a', 'x.a', 'events.replay'])).not.toThrow()
    expect(() => assertFeatureIds(['x.a', 'Bad Id'])).toThrow(/"Bad Id"/)
    expect(() => assertFeatureIds([7])).toThrow(/Invalid feature id 7/)
    expect(() => assertFeatureIds('events.replay')).toThrow(TypeError)
    expect(() => assertFeatureIds(undefined)).toThrow(TypeError)
    const many = Array.from({ length: MAX_FEATURES + 1 }, (_, i) => `x.f${i}`)
    expect(() => assertFeatureIds(many)).toThrow(/limit is 64/)
    expect(() => assertFeatureIds(many.slice(0, MAX_FEATURES))).not.toThrow()
  })

  it('reads untrusted input leniently: drops the invalid, removes repeats, caps the count', () => {
    expect(normalizeFeatures(undefined)).toEqual([])
    expect(normalizeFeatures('x.a')).toEqual([])
    expect(normalizeFeatures({ 0: 'x.a', length: 1 })).toEqual([])
    expect(normalizeFeatures(['x.a', 7, 'Bad Id', null, {}, 'x.b', 'x.a'])).toEqual(['x.a', 'x.b'])
    const flood = Array.from({ length: 500 }, (_, i) => `x.f${i}`)
    expect(normalizeFeatures(flood)).toEqual(flood.slice(0, MAX_FEATURES))
  })

  it('negotiates the intersection in the order of the first list', () => {
    expect(negotiateFeatures(['x.c', 'x.a', 'x.b'], ['x.b', 'x.c', 'x.z'])).toEqual(['x.c', 'x.b'])
    expect(negotiateFeatures(['x.a', 'x.a'], ['x.a'])).toEqual(['x.a'])
    expect(negotiateFeatures(['x.a'], ['x.b'])).toEqual([])
    expect(negotiateFeatures(['x.a'], [])).toEqual([])
    // A peer that sent no `features` member offers none.
    expect(negotiateFeatures(['x.a'], undefined)).toEqual([])
    expect(negotiateFeatures([], ['x.a'])).toEqual([])
  })

  it('gates a method only when its feature was not agreed', () => {
    const gates = { 'bridge.replay': 'x.replay' }
    expect(isFeatureGated('bridge.replay', gates, NO_FEATURES)).toBe(true)
    expect(isFeatureGated('bridge.replay', gates, createFeatureSet(['x.other']))).toBe(true)
    expect(isFeatureGated('bridge.replay', gates, createFeatureSet(['x.replay']))).toBe(false)
    expect(isFeatureGated('bridge.ping', gates, NO_FEATURES)).toBe(false)
    // Names inherited from Object.prototype are not gates.
    expect(isFeatureGated('constructor', gates, NO_FEATURES)).toBe(false)
    expect(isFeatureGated('bridge.ping', {}, NO_FEATURES)).toBe(false)
  })
})

describe('negotiation between two current peers', () => {
  it('settles the intersection on both sides before READY and exposes it everywhere', async () => {
    const { bridge, booted } = setup({ popupFeatures: ['x.c', 'x.a', 'x.d'] })
    const session = await bridge.open(definition, { init, features: ['x.a', 'x.b', 'x.c'] })
    const popup = booted[0]!

    // Host order for the host, popup order for the popup: the same set either way.
    expect(session.features.ids).toEqual(['x.a', 'x.c'])
    expect(session.link.features.ids).toEqual(['x.a', 'x.c'])
    expect(session.features.has('x.b')).toBe(false)
    expect(session.features.has('x.d')).toBe(false)
    expect(sorted(popup.runtime.features.ids)).toEqual(['x.a', 'x.c'])
    expect(sorted(popup.runtime.link.features.ids)).toEqual(['x.a', 'x.c'])
    expect(sorted((await popup.started)!.features)).toEqual(['x.a', 'x.c'])
    // The popup knows the set while it initializes, before it answers READY.
    expect(popup.initFeatures.map(f => [sorted(f.context), sorted(f.link)])).toEqual([[['x.a', 'x.c'], ['x.a', 'x.c']]])
    expect(await session.call('asset.select', {})).toEqual({ assetIds: ['a1'] })
    await session.close()
  })

  it('agrees on the default features, and on nothing when asked or when the offers do not overlap', async () => {
    const plain = setup()
    const first = await plain.bridge.open(definition, { init })
    expect(first.features.ids).toEqual([FEATURE_EVENTS_REPLAY, FEATURE_EVENTS_COALESCE])
    expect(plain.booted[0]!.runtime.features.ids).toEqual([FEATURE_EVENTS_REPLAY, FEATURE_EVENTS_COALESCE])
    expect((await plain.booted[0]!.started)!.features).toEqual([FEATURE_EVENTS_REPLAY, FEATURE_EVENTS_COALESCE])
    await first.close()

    const optedOut = setup({ popupFeatures: [] })
    const none = await optedOut.bridge.open(definition, { init })
    expect(none.features.size).toBe(0)
    expect((await optedOut.booted[0]!.started)!.features).toEqual([])
    await none.close()

    const disjoint = setup({ popupFeatures: ['x.b'] })
    const second = await disjoint.bridge.open(definition, { init, features: ['x.a'] })
    expect(second.state).toBe('READY')
    expect(second.features.size).toBe(0)
    expect(disjoint.booted[0]!.runtime.features.size).toBe(0)
    expect(disjoint.booted[0]!.initFeatures).toEqual([{ context: [], link: [] }])
    await second.close()
  })

  it('takes the host offer from bridge defaults too', async () => {
    const { browser, booted } = setup({ popupFeatures: ['x.a'] })
    const bridge = createPopupBridge({ env: browser.hostEnv, defaults: { closedPollMs: 20, features: ['x.a'] } })
    const session = await bridge.open(definition, { init })
    expect(session.features.ids).toEqual(['x.a'])
    expect(booted[0]!.runtime.features.ids).toEqual(['x.a'])
    await session.close()
  })

  it('empties the set when the connection ends', async () => {
    const { bridge, booted } = setup({ popupFeatures: ['x.a'] })
    const session = await bridge.open(definition, { init, features: ['x.a'] })
    expect(session.features.size).toBe(1)
    const link = session.link
    await session.close()
    expect(session.features.size).toBe(0)
    expect(link.features.size).toBe(0)
    await vi.waitFor(() => expect(booted[0]!.runtime.state).toBe('CLOSED'))
    expect(booted[0]!.runtime.features.size).toBe(0)
    expect(booted[0]!.runtime.link.features.size).toBe(0)
  })
})

// ---- hand-written peers: speak the wire the way a release without (or with hostile) features would ----

type Raw = Record<string, unknown>

/** A popup written against the raw protocol; `helloExtra` / `readyExtra` add members to its messages. */
function handPopup(browser: MemoryBrowser, options: { helloExtra?: Raw; readyExtra?: Raw } = {}) {
  const seen: { hello?: Raw; connect?: Raw; ready?: Raw } = {}
  browser.onPopupLoad(page => {
    const sessionId = readSession(page.env.hash)!
    const instanceId = 'hand-popup'
    page.env.listen(message => {
      const data = message.data as Raw
      if (data.kind !== 'bridge.connect') return
      seen.connect = data
      const channel = fromMessagePort(message.ports[0]!)
      channel.subscribe(() => undefined)
      seen.ready = { kind: 'bridge.ready', sessionId, instanceId, capabilities: [], ...options.readyExtra }
      channel.send(seen.ready)
    })
    seen.hello = { kind: 'bridge.hello', sessionId, instanceId, protocolVersions: ['1.0'], ...options.helloExtra }
    page.env.host!.postMessage(seen.hello, browser.hostOrigin)
  })
  return seen
}

function handPopupSetup(options: { helloExtra?: Raw; readyExtra?: Raw } = {}) {
  const browser = createMemoryBrowser()
  const seen = handPopup(browser, options)
  const bridge = createPopupBridge({ env: browser.hostEnv, defaults: { closedPollMs: 20, heartbeat: false } })
  const legacy = definePopup(assetContract, { url: 'https://tools.example.com/asset-selector', requiredCapabilities: [] })
  return { seen, open: (features?: readonly string[]) => bridge.open(legacy, { init, ...(features === undefined ? {} : { features }) }) }
}

/** A host written against the raw protocol that opens one popup and answers its HELLO with CONNECT. */
function handHost(browser: MemoryBrowser, connectExtra: Raw | ((hello: Raw) => Raw) = {}) {
  const sessionId = 'hand-host'
  const seen: { hello?: Raw; connect?: Raw; ready?: Raw } = {}
  let resolveReady!: (ready: Raw) => void
  const ready = new Promise<Raw>(resolve => {
    resolveReady = resolve
  })
  const channels: Array<{ close(): void }> = []
  const stop = browser.hostEnv.listen(message => {
    const hello = message.data as Raw
    if (hello.kind !== 'bridge.hello') return
    seen.hello = hello
    const { port1, port2 } = new MessageChannel()
    const channel = fromMessagePort(port1)
    channels.push(channel)
    channel.subscribe(raw => {
      const control = raw as Raw
      if (control.kind !== 'bridge.ready') return
      seen.ready = control
      resolveReady(control)
    })
    seen.connect = {
      kind: 'bridge.connect',
      sessionId,
      instanceId: hello.instanceId,
      protocolVersion: '1.0',
      init,
      ...(typeof connectExtra === 'function' ? connectExtra(hello) : connectExtra),
    }
    peer.postMessage(seen.connect, definition.expectedOrigin, [port2])
  })
  const peer = browser.hostEnv.open(attachSession(definition.url, sessionId), {})!
  return {
    seen,
    ready,
    stop() {
      stop()
      for (const channel of channels) channel.close()
      peer.close()
    },
  }
}

describe('a peer that predates features', () => {
  it('connects a legacy popup: no features member goes out and none is assumed', async () => {
    const { seen, open } = handPopupSetup()
    const session = await open(['x.a'])
    expect(session.state).toBe('READY')
    expect(session.features.size).toBe(0)
    expect(seen.connect).toBeDefined()
    // The host offers x.a but the popup offered nothing: the intersection is empty and omitted.
    expect('features' in seen.connect!).toBe(false)
    await session.close()
  })

  it('connects a legacy host: the popup offers, hears nothing back and stays on the baseline', async () => {
    const { browser, booted } = setup({ popupFeatures: ['x.a'] })
    const host = handHost(browser)
    const ready = await host.ready
    expect(host.seen.hello!.features).toEqual(['x.a'])
    expect('features' in host.seen.connect!).toBe(false)
    expect('features' in ready).toBe(false)
    const popup = booted[0]!
    const connection = (await popup.started)!
    expect(connection.features).toEqual([])
    expect(popup.runtime.features.size).toBe(0)
    expect(popup.runtime.link.features.size).toBe(0)
    expect(popup.initFeatures).toEqual([{ context: [], link: [] }])
    expect(popup.runtime.state).toBe('READY')
    host.stop()
    popup.runtime.close()
  })

  it('treats `features: []` exactly like a peer without features, on both ends', async () => {
    const hostSide = handPopupSetup({ helloExtra: { features: ['x.a'] } })
    const session = await hostSide.open([])
    expect('features' in hostSide.seen.connect!).toBe(false)
    expect(session.features.size).toBe(0)
    await session.close()

    const { browser, booted } = setup({ popupFeatures: [] })
    const host = handHost(browser, { features: ['x.a'] })
    const ready = await host.ready
    expect('features' in host.seen.hello!).toBe(false)
    expect('features' in ready).toBe(false)
    expect(booted[0]!.runtime.features.size).toBe(0)
    host.stop()
    booted[0]!.runtime.close()
  })

  it('keeps calls working between a feature-less popup and a host that offers features', async () => {
    const { bridge, booted } = setup({ popupFeatures: [] })
    const session = await bridge.open(definition, { init, features: ['x.a', 'events.replay'] })
    expect(session.features.size).toBe(0)
    expect(await session.call('asset.select', { multiple: true })).toEqual({ assetIds: ['a1', 'a2'] })
    const received: number[] = []
    await session.subscribe('asset.selectionChanged', (_payload, meta) => received.push(meta.revision))
    booted[0]!.runtime.emit('asset.selectionChanged', { assetIds: [] })
    await vi.waitFor(() => expect(received).toEqual([1]))
    await session.close()
  })
})

describe('hostile or unexpected feature values', () => {
  it('ignores malformed ids in a HELLO but keeps the valid ones', async () => {
    const { seen, open } = handPopupSetup({ helloExtra: { features: ['x.a', 7, 'Bad Id', null, {}, 'x.a', 'x.b'] }, readyExtra: { features: ['x.a'] } })
    const session = await open(['x.a', 'x.c'])
    expect(seen.connect!.features).toEqual(['x.a'])
    expect(session.features.ids).toEqual(['x.a'])
    await session.close()
  })

  it('reads a non-array `features` member as offering none, without refusing the popup', async () => {
    const { seen, open } = handPopupSetup({ helloExtra: { features: 'x.a' }, readyExtra: { features: { 0: 'x.a' } } })
    const session = await open(['x.a'])
    expect(session.state).toBe('READY')
    expect('features' in seen.connect!).toBe(false)
    expect(session.features.size).toBe(0)
    await session.close()
  })

  it('never lets READY add a feature the host did not offer in CONNECT', async () => {
    const claimsMore = handPopupSetup({ helloExtra: { features: ['x.a'] }, readyExtra: { features: ['x.a', 'x.z', 'x.b'] } })
    const first = await claimsMore.open(['x.a', 'x.b'])
    // x.b was never offered by the popup in HELLO, x.z never by the host.
    expect(first.features.ids).toEqual(['x.a'])
    await first.close()

    const claimsUnoffered = handPopupSetup({ readyExtra: { features: ['x.a'] } })
    const second = await claimsUnoffered.open(['x.a'])
    expect(second.features.size).toBe(0)
    await second.close()
  })

  it('has the popup use only what it offered itself, whatever CONNECT lists', async () => {
    const { browser, booted } = setup({ popupFeatures: ['x.a'] })
    const host = handHost(browser, { features: ['x.a', 'x.b', 'x.zz'] })
    const ready = await host.ready
    expect(ready.features).toEqual(['x.a'])
    expect(booted[0]!.runtime.features.ids).toEqual(['x.a'])
    expect(booted[0]!.runtime.features.has('x.b')).toBe(false)
    host.stop()
    booted[0]!.runtime.close()
  })

  it('reads a garbage CONNECT features member as none and still becomes READY', async () => {
    const { browser, booted } = setup({ popupFeatures: ['x.a'] })
    const host = handHost(browser, { features: 5 })
    const ready = await host.ready
    expect('features' in ready).toBe(false)
    expect(booted[0]!.runtime.state).toBe('READY')
    expect(booted[0]!.runtime.features.size).toBe(0)
    host.stop()
    booted[0]!.runtime.close()
  })

  it('lets READY confirm fewer features than the host offered in CONNECT', async () => {
    const { seen, open } = handPopupSetup({ helloExtra: { features: ['x.a', 'x.b'] }, readyExtra: { features: ['x.a'] } })
    const session = await open(['x.a', 'x.b'])
    expect(seen.connect!.features).toEqual(['x.a', 'x.b'])
    // The host uses what the popup confirmed, not everything it offered.
    expect(session.features.ids).toEqual(['x.a'])
    await session.close()
  })

  it('survives a flood of features: the connection settles on the capped intersection', async () => {
    const flood = Array.from({ length: 1_000 }, (_, i) => `x.f${i}`)
    const { seen, open } = handPopupSetup({ helloExtra: { features: flood }, readyExtra: { features: flood } })
    const session = await open(flood.slice(0, MAX_FEATURES))
    expect((seen.connect!.features as string[]).length).toBe(MAX_FEATURES)
    expect(session.features.size).toBe(MAX_FEATURES)
    await session.close()
  })
})

/** Generous against a parse that takes microseconds, tiny against the seconds a walk over the claimed length costs. */
const PARSE_BUDGET_MS = 250

function timed<T>(work: () => T): { result: T; ms: number } {
  const start = performance.now()
  const result = work()
  return { result, ms: performance.now() - start }
}

describe('sparse arrays in untrusted messages', () => {
  // A hole pattern with a huge length is a few bytes on the wire, and structured clone keeps it.
  const sparse = () => structuredClone(new Array<unknown>(2 ** 31))
  const hello = (extra: Raw) => ({ kind: 'bridge.hello', sessionId: 's', instanceId: 'i', protocolVersions: ['1.0'], ...extra })

  it('reads only the start of a huge sparse `features` list', () => {
    expect(timed(() => normalizeFeatures(sparse())).ms).toBeLessThan(PARSE_BUDGET_MS)
    for (const kind of ['bridge.hello', 'bridge.connect', 'bridge.ready']) {
      const base: Raw = { kind, sessionId: 's', instanceId: 'i', protocolVersion: '1.0', protocolVersions: ['1.0'], capabilities: [], features: sparse() }
      const { result, ms } = timed(() => parseBridgeMessage(base))
      expect(ms, kind).toBeLessThan(PARSE_BUDGET_MS)
      expect(result, kind).toBeDefined()
      expect(result && 'features' in result, kind).toBe(false)
    }
  })

  it('keeps the valid ids at the start of a list that claims a huge length', () => {
    const list = sparse()
    list[0] = 'x.a'
    list[1] = 'x.b'
    expect(normalizeFeatures(list)).toEqual(['x.a', 'x.b'])
  })

  it('refuses a HELLO whose protocol versions claim a huge length, without walking it', () => {
    const { result, ms } = timed(() => parseBridgeMessage(hello({ protocolVersions: sparse() })))
    expect(ms).toBeLessThan(PARSE_BUDGET_MS)
    expect(result).toBeUndefined()
  })

  it('refuses a HELLO with more protocol versions than any peer speaks, and one with holes', () => {
    const many = Array.from({ length: 65 }, (_, i) => `1.${i}`)
    expect(parseBridgeMessage(hello({ protocolVersions: many }))).toBeUndefined()
    expect(parseBridgeMessage(hello({ protocolVersions: many.slice(0, 64) }))).toMatchObject({ protocolVersions: many.slice(0, 64) })
    // A hole is not a version: it must not turn into an `undefined` entry.
    expect(parseBridgeMessage(hello({ protocolVersions: ['1.0', , '1.1'] }))).toBeUndefined() // eslint-disable-line no-sparse-arrays
    expect(parseBridgeMessage(hello({ protocolVersions: ['1.0', 7] }))).toBeUndefined()
  })

  it('does not parse a message from a window that failed the origin check', async () => {
    const browser = createMemoryBrowser()
    // Answers from an origin the host does not expect, with a flood the parser would have to walk.
    browser.onPopupLoad(page => {
      const sessionId = readSession(page.env.hash)!
      page.env.host!.postMessage({ kind: 'bridge.hello', sessionId, instanceId: 'evil', protocolVersions: sparse(), features: sparse() }, browser.hostOrigin)
    })
    const bridge = createPopupBridge({ env: browser.hostEnv, defaults: { closedPollMs: 20, heartbeat: false } })
    const hostile = definePopup(assetContract, { url: 'https://evil.example.net/asset-selector', expectedOrigin: 'https://tools.example.com' })
    const { result, ms } = await (async () => {
      const start = performance.now()
      const outcome = await bridge.open(hostile, { init }).then(() => undefined, (error: unknown) => error)
      return { result: outcome, ms: performance.now() - start }
    })()
    expect(result).toMatchObject({ code: 'ORIGIN_MISMATCH' })
    expect(ms).toBeLessThan(PARSE_BUDGET_MS * 4)
  })
})

describe('renegotiation', () => {
  it('negotiates again after a popup reload and agrees on nothing until the new page is READY', async () => {
    let offer = ['x.a', 'x.b']
    const { bridge, browser, booted } = setup({ popupFeatures: () => offer })
    const session = await bridge.open(definition, { init, features: ['x.a', 'x.b'] })
    expect(session.features.ids).toEqual(['x.a', 'x.b'])
    const atState: Array<[string, number]> = []
    session.on('state', state => atState.push([state, session.features.size]))
    const reconnected = vi.fn()
    session.on('reconnect', reconnected)

    offer = ['x.b']
    browser.popups[0]!.reload()
    await vi.waitFor(() => expect(reconnected).toHaveBeenCalledTimes(1))
    // Whatever the path back to READY (HELLO may overtake the unload notice), nothing is agreed before it.
    const beforeReady = atState.slice(0, atState.findIndex(([state]) => state === 'READY'))
    expect(beforeReady.length).toBeGreaterThan(0)
    expect(beforeReady.every(([, size]) => size === 0)).toBe(true)
    expect(session.features.ids).toEqual(['x.b'])
    expect(booted[1]!.runtime.features.ids).toEqual(['x.b'])
    expect(booted[1]!.initFeatures).toEqual([{ context: ['x.b'], link: ['x.b'] }])
    await session.close()
  })

  it('drops to the baseline when a legacy page replaces a newer one on reload', async () => {
    let offer: string[] = ['x.a']
    const { bridge, browser } = setup({ popupFeatures: () => offer })
    const session = await bridge.open(definition, { init, features: ['x.a'] })
    expect(session.features.size).toBe(1)
    const reconnected = vi.fn()
    session.on('reconnect', reconnected)
    offer = []
    browser.popups[0]!.reload()
    await vi.waitFor(() => expect(reconnected).toHaveBeenCalledTimes(1))
    expect(session.features.size).toBe(0)
    expect(await session.call('asset.select', {})).toEqual({ assetIds: ['a1'] })
    await session.close()
  })

  it('forgets the agreed set when the page is restored from the back/forward cache, then agrees again', async () => {
    const { bridge, browser, booted } = setup({ popupFeatures: ['x.a'] })
    const session = await bridge.open(definition, { init, features: ['x.a'] })
    const runtime = booted[0]!.runtime
    expect(runtime.features.ids).toEqual(['x.a'])
    const reconnected = vi.fn()
    session.on('reconnect', reconnected)

    browser.popups[0]!.freeze()
    await vi.waitFor(() => expect(session.state).toBe('WAITING_HELLO'))
    expect(session.features.size).toBe(0)

    browser.popups[0]!.restore()
    // restart() runs inside the pageshow handler: the old agreement is gone before the new HELLO is answered.
    expect(runtime.state).toBe('WAITING_CONNECT')
    expect(runtime.features.size).toBe(0)
    expect(runtime.link.features.size).toBe(0)

    await vi.waitFor(() => expect(reconnected).toHaveBeenCalledTimes(1))
    expect(runtime.features.ids).toEqual(['x.a'])
    expect(session.features.ids).toEqual(['x.a'])
    await session.close()
  })
})

describe('option validation', () => {
  it('rejects bad host features before any window opens', async () => {
    const { bridge, browser } = setup()
    const error = await bridge.open(definition, { init, features: ['x.ok', 'Not Valid'] }).then(
      () => undefined,
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(TypeError)
    expect((error as TypeError).message).toContain('"Not Valid"')
    expect(browser.popups).toHaveLength(0)

    await expect(bridge.open(definition, { init, features: 'events.replay' as never })).rejects.toBeInstanceOf(TypeError)
    expect(browser.popups).toHaveLength(0)
  })

  it('rejects bad popup features synchronously when the runtime is created', () => {
    const env = { host: null, hash: '', listen: () => () => undefined, onPageHide: () => () => undefined }
    const create = (features: unknown) =>
      createPopupRuntime({ allowedHostOrigins: ['https://app.example.com'], env, features: features as never })
    expect(() => create(['Not Valid'])).toThrow(/"Not Valid"/)
    expect(() => create('events.replay')).toThrow(TypeError)
    expect(() => create(Array.from({ length: MAX_FEATURES + 1 }, (_, i) => `x.f${i}`))).toThrow(TypeError)
    expect(() => create([])).not.toThrow()
    expect(() => create(undefined)).not.toThrow()
  })
})
