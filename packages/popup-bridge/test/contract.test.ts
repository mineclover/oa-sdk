import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  BridgeError,
  HandlerRegistry,
  createMethodCaller,
  createRpcApi,
  defineContract,
  definePopup,
  describeContract,
  event,
  method,
  negotiateProtocol,
  satisfies,
  attachSession,
  readSession,
  parseBridgeMessage,
} from '../src/index.js'

const contract = defineContract({
  id: 'asset-selector',
  methods: {
    'asset.select': method<{ multiple?: boolean }, { assetIds: string[] }>({ version: '1.2.0', permission: 'assets:read' }),
    'asset.getSnapshot': method<void, { revision: number }>(),
    'asset.rename': method<{ id: string; name: string }, void>({ timeoutMs: 5000 }),
  },
  events: { 'asset.selectionChanged': event<{ assetIds: string[] }>() },
  host: { 'host.document.getSelection': method<void, { text: string }>() },
})

describe('naming convention', () => {
  it.each(['select', 'Asset.select', 'asset.Select', 'asset..select', 'asset.sel-ect', 'bridge.ping'])('rejects %s', name => {
    expect(() => defineContract({ id: 'x', methods: { [name]: method() } })).toThrow(TypeError)
  })

  it('rejects a name that is also a namespace', () => {
    expect(() => defineContract({ id: 'x', methods: { 'asset.select': method(), 'asset.select.one': method() } })).toThrow(/namespace/)
  })

  it('rejects an invalid version', () => {
    expect(() => method({ version: '1.0' })).toThrow(TypeError)
  })
})

describe('type derivation', () => {
  it('derives call arguments from the declared types', () => {
    const call = createRpcApi(contract.methods, async () => undefined)
    expectTypeOf(call.asset.select).parameters.toEqualTypeOf<[params?: { multiple?: boolean }, options?: import('../src/index.js').CallOptions]>()
    expectTypeOf(call.asset.select).returns.resolves.toEqualTypeOf<{ assetIds: string[] }>()
    expectTypeOf(call.asset.getSnapshot).parameters.toEqualTypeOf<[params?: undefined, options?: import('../src/index.js').CallOptions]>()
    expectTypeOf(call.asset.rename).parameters.toEqualTypeOf<[params: { id: string; name: string }, options?: import('../src/index.js').CallOptions]>()
  })

  it('types a flat handler registry by method name', () => {
    const registry = new HandlerRegistry(contract.methods)
    registry.register('asset.select', params => {
      expectTypeOf(params).toEqualTypeOf<{ multiple?: boolean }>()
      return { assetIds: [] }
    })
    // @ts-expect-error not a method of the contract
    expect(() => registry.register('asset.missing', () => 1)).toThrow(TypeError)
  })
})

describe('handler registry', () => {
  it('advertises only registered methods and reports the missing ones', () => {
    const registry = new HandlerRegistry(contract.methods)
    registry.register('asset.select', () => ({ assetIds: [] }))
    expect(registry.capabilities()).toEqual([{ name: 'asset.select', version: '1.2.0' }])
    expect(registry.missing().sort()).toEqual(['asset.getSnapshot', 'asset.rename'])
    expect(() => registry.register('asset.select', () => ({ assetIds: [] }))).toThrow(/already registered/)
  })

  it('supports free-form feature registration without a contract', () => {
    const registry = new HandlerRegistry()
    registry.registerFeature({ name: 'tool.run', version: '2.0.0', handler: (p: { a: number }) => p.a })
    expect(registry.resolve('tool.run')).toBeDefined()
    expect(() => registry.register('x.y' as never, () => 1)).toThrow(TypeError)
  })
})

describe('rpc generation utilities', () => {
  it('builds a nested api whose leaves call the invoker with the dotted name', async () => {
    const invoke = vi.fn(async (name: string, params: unknown) => ({ name, params }))
    const caller = createMethodCaller(contract.methods, invoke)
    const api = createRpcApi(contract.methods, caller)
    await api.asset.select({ multiple: true }, { timeoutMs: 1 })
    expect(invoke).toHaveBeenCalledWith('asset.select', { multiple: true }, expect.objectContaining({ timeoutMs: 1 }))
    expect(Object.keys(api)).toEqual(['asset'])
    expect(await Promise.resolve(api)).toBe(api) // safe to await: no `then`
  })

  it('applies the per-method timeout unless the call overrides it', async () => {
    const invoke = vi.fn(async (_name: string, _params: unknown, _options: import('../src/index.js').CallOptions) => undefined)
    const caller = createMethodCaller(contract.methods, invoke, { defaultTimeoutMs: 100 })
    await caller('asset.rename', { id: '1', name: 'n' })
    await caller('asset.rename', { id: '1', name: 'n' }, { timeoutMs: 7 })
    expect(invoke.mock.calls.map(c => c[2].timeoutMs)).toEqual([5000, 7])
  })

  it('validates params before sending and results before returning', async () => {
    const typed = defineContract({
      id: 'x',
      methods: {
        'a.b': method({
          input: (v: unknown) => { if (typeof (v as { n?: unknown })?.n !== 'number') throw new Error('n'); return v as { n: number } },
          output: (v: unknown) => { if (typeof v !== 'string') throw new Error('s'); return v },
        }),
      },
    })
    const invoke = vi.fn(async () => 42)
    const caller = createMethodCaller(typed.methods, invoke)
    await expect(caller('a.b', { n: 'x' })).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    expect(invoke).not.toHaveBeenCalled()
    await expect(caller('a.b', { n: 1 })).rejects.toMatchObject({ code: 'INVALID_RESULT' })
    await expect(caller('a.zzz')).rejects.toMatchObject({ code: 'METHOD_NOT_FOUND' })
  })

  it('collects Zod-style issues', async () => {
    const schema = { parse: () => { throw Object.assign(new Error('bad'), { issues: [{ path: ['n'], message: 'Expected number' }] }) } }
    const typed = defineContract({ id: 'x', methods: { 'a.b': method({ input: schema }) } })
    const error = await createMethodCaller(typed.methods, async () => 1)('a.b', {}).catch((e: BridgeError) => e)
    expect((error as BridgeError).data).toEqual({ issues: [{ path: 'n', message: 'Expected number' }] })
  })

  it('describes a contract as a serializable manifest', () => {
    const manifest = describeContract(contract)
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest)
    expect(manifest.methods.find(m => m.name === 'asset.select')).toMatchObject({ version: '1.2.0', permission: 'assets:read' })
    expect(manifest.events).toEqual([{ name: 'asset.selectionChanged', version: '1.0.0' }])
    expect(manifest.host).toHaveLength(1)
  })

  it('lists the replay capacity of an event in the manifest, and only when it has one', () => {
    const withReplay = defineContract({
      id: 'x',
      events: { 'a.plain': event(), 'a.kept': event<{ n: number }>({ replay: { capacity: 16 }, description: 'progress' }) },
    })
    const manifest = describeContract(withReplay)
    expect(manifest.events).toEqual([
      { name: 'a.plain', version: '1.0.0' },
      { name: 'a.kept', version: '1.0.0', description: 'progress', replay: { capacity: 16 } },
    ])
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest)
  })
})

describe('popup definition', () => {
  it('derives origin, protocol versions and required capabilities from the contract', () => {
    const def = definePopup(contract, { url: 'https://tools.example.com/asset-selector' })
    expect(def.expectedOrigin).toBe('https://tools.example.com')
    expect(def.protocolVersions).toEqual(['1.0'])
    expect(def.requiredCapabilities).toContainEqual({ name: 'asset.select', versionRange: '^1.2.0' })
  })

  it('rejects an expectedOrigin that carries a path and invalid ranges', () => {
    expect(() => definePopup(contract, { url: 'https://t.example.com/x', expectedOrigin: 'https://t.example.com/x' })).toThrow(/bare origin/)
    expect(() => definePopup(contract, { url: 'https://t.example.com/x', requiredCapabilities: [{ name: 'a.b', versionRange: 'latest' }] })).toThrow(TypeError)
  })
})

describe('versions', () => {
  it.each([
    ['1.2.3', '^1.0.0', true],
    ['2.0.0', '^1.0.0', false],
    ['0.2.5', '^0.2.0', true],
    ['0.3.0', '^0.2.0', false],
    ['1.2.9', '~1.2.0', true],
    ['1.3.0', '~1.2.0', false],
    ['1.0.0', '1.0.0', true],
    ['1.0.1', '1.0.0', false],
    ['3.0.0', '>=2.0.0', true],
    ['1.9.9', '*', true],
  ])('satisfies(%s, %s) = %s', (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected)
  })

  it('negotiates the highest common protocol version', () => {
    expect(negotiateProtocol(['1.0', '1.2', '2.0'], ['1.2', '1.0', '0.9'])).toBe('1.2')
    expect(() => negotiateProtocol(['2.0'], ['1.0'])).toThrowError(expect.objectContaining({ code: 'PROTOCOL_INCOMPATIBLE' }))
  })
})

describe('bootstrap messages', () => {
  it('round-trips the session id through the URL fragment and keeps other params', () => {
    const url = attachSession('https://tools.example.com/a?x=1#theme=dark', 'abc')
    expect(new URL(url).search).toBe('?x=1')
    expect(readSession(new URL(url).hash)).toBe('abc')
    expect(new URLSearchParams(new URL(url).hash.slice(1)).get('theme')).toBe('dark')
  })

  it('drops unknown members and rejects malformed messages', () => {
    expect(parseBridgeMessage({ kind: 'bridge.hello', sessionId: 's', instanceId: 'i', protocolVersions: ['1.0'], extra: 1 })).toEqual({
      kind: 'bridge.hello', sessionId: 's', instanceId: 'i', protocolVersions: ['1.0'],
    })
    expect(parseBridgeMessage({ kind: 'bridge.hello', sessionId: 's', instanceId: 'i', protocolVersions: [1] })).toBeUndefined()
    expect(parseBridgeMessage({ kind: 'bridge.ready', sessionId: 's', instanceId: 'i', capabilities: [{ name: 1 }] })).toBeUndefined()
    expect(parseBridgeMessage({ kind: 'other' })).toBeUndefined()
  })

  it('carries optional features on hello, connect and ready, and omits them when empty', () => {
    const ids = { sessionId: 's', instanceId: 'i' }
    expect(parseBridgeMessage({ kind: 'bridge.hello', ...ids, protocolVersions: ['1.0'], features: ['x.a', 'x.b'] })).toEqual({
      kind: 'bridge.hello', ...ids, protocolVersions: ['1.0'], features: ['x.a', 'x.b'],
    })
    expect(parseBridgeMessage({ kind: 'bridge.connect', ...ids, protocolVersion: '1.0', init: 1, features: ['x.a'] })).toEqual({
      kind: 'bridge.connect', ...ids, protocolVersion: '1.0', init: 1, features: ['x.a'],
    })
    expect(parseBridgeMessage({ kind: 'bridge.ready', ...ids, capabilities: [], features: ['x.a'] })).toEqual({
      kind: 'bridge.ready', ...ids, capabilities: [], features: ['x.a'],
    })
    // Absent and empty both read as "no features", and the member is not materialized.
    for (const features of [undefined, [], 'x.a', 7, null, ['Bad Id'], [1]]) {
      const hello = parseBridgeMessage({ kind: 'bridge.hello', ...ids, protocolVersions: ['1.0'], features })
      expect(hello, JSON.stringify(features)).toEqual({ kind: 'bridge.hello', ...ids, protocolVersions: ['1.0'] })
      expect(hello !== undefined && 'features' in hello).toBe(false)
    }
  })

  it('never rejects a message over a malformed features member, and cleans a hostile one', () => {
    const ids = { sessionId: 's', instanceId: 'i' }
    const flood = Array.from({ length: 300 }, (_, i) => `x.f${i}`)
    const parsed = parseBridgeMessage({ kind: 'bridge.ready', ...ids, capabilities: [], features: ['x.a', 5, 'x.a', 'NOPE', ...flood] })
    expect(parsed).toMatchObject({ kind: 'bridge.ready' })
    const features = parsed !== undefined && 'features' in parsed ? parsed.features : undefined
    expect(features).toHaveLength(64)
    expect(features?.slice(0, 3)).toEqual(['x.a', 'x.f0', 'x.f1'])
    expect(parseBridgeMessage({ kind: 'bridge.connect', ...ids, protocolVersion: '1.0', init: null, features: { length: 1 } })).toEqual({
      kind: 'bridge.connect', ...ids, protocolVersion: '1.0', init: null,
    })
  })
})
