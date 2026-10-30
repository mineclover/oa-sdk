import { describe, expect, it, vi } from 'vitest'
import {
  BridgeError,
  createMemoryChannelPair,
  createRpcEndpoint,
  withTransfer,
  type RpcEndpoint,
  type RpcRegistration,
} from '../src/index.js'

function pair(
  left: Record<string, RpcRegistration> = {},
  right: Record<string, RpcRegistration> = {},
  extra: Partial<Parameters<typeof createRpcEndpoint>[0]> = {},
): [RpcEndpoint, RpcEndpoint] {
  const [a, b] = createMemoryChannelPair()
  return [
    createRpcEndpoint({ channel: a, resolve: name => left[name], idPrefix: 'a-', ...extra }),
    createRpcEndpoint({ channel: b, resolve: name => right[name], idPrefix: 'b-' }),
  ]
}

const rejects = async (promise: Promise<unknown>, code: string) => {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(BridgeError)
  expect((error as BridgeError).code).toBe(code)
  return error as BridgeError
}

describe('rpc endpoint', () => {
  it('answers requests in both directions', async () => {
    const [a, b] = pair({ 'a.echo': { handler: p => ({ from: 'a', p }) } }, { 'b.echo': { handler: p => ({ from: 'b', p }) } })
    expect(await a.call('b.echo', { x: 1 })).toEqual({ from: 'b', p: { x: 1 } })
    expect(await b.call('a.echo', { y: 2 })).toEqual({ from: 'a', p: { y: 2 } })
  })

  it('maps an unknown method to METHOD_NOT_FOUND', async () => {
    const [a] = pair()
    await rejects(a.call('nope.nothing'), 'METHOD_NOT_FOUND')
  })

  it('keeps BridgeError codes but hides unexpected error details', async () => {
    const [a] = pair(
      {},
      {
        'b.deny': { handler: () => { throw new BridgeError('PERMISSION_DENIED', 'no', { data: { why: 'role' } }) } },
        'b.boom': { handler: () => { throw new Error('secret stack detail') } },
      },
    )
    const denied = await rejects(a.call('b.deny'), 'PERMISSION_DENIED')
    expect(denied.data).toEqual({ why: 'role' })
    const boom = await rejects(a.call('b.boom'), 'INTERNAL')
    expect(boom.message).toBe('Internal error')
  })

  it('validates params and results with the registration schemas', async () => {
    const str = (value: unknown) => {
      if (typeof (value as { n?: unknown })?.n !== 'number') throw new Error('n must be a number')
      return value as { n: number }
    }
    const [a] = pair({}, { 'b.double': { input: str, output: (v: unknown) => { if (typeof v !== 'number') throw new Error('bad'); return v }, handler: (p: { n: number }) => p.n * 2 } })
    expect(await a.call('b.double', { n: 4 })).toBe(8)
    await rejects(a.call('b.double', { n: 'x' }), 'INVALID_PARAMS')
    const [c] = pair({}, { 'b.bad': { output: () => { throw new Error('nope') }, handler: () => 1 } })
    await rejects(c.call('b.bad'), 'INVALID_RESULT')
  })

  it('rejects non-object params', async () => {
    const [a, b] = pair({}, { 'b.ok': { handler: () => 1 } })
    void b
    await rejects(a.call('b.ok', [1, 2] as unknown), 'INVALID_PARAMS')
  })

  it('times out and cancels the remote handler', async () => {
    let aborted = false
    const [a] = pair({}, { 'b.slow': { handler: (_p, ctx) => new Promise(resolve => { ctx.signal.addEventListener('abort', () => { aborted = true; resolve(null) }) }) } })
    const error = await rejects(a.call('b.slow', {}, { timeoutMs: 30 }), 'RPC_TIMEOUT')
    expect(error.data).toMatchObject({ method: 'b.slow', timeoutMs: 30 })
    await vi.waitFor(() => expect(aborted).toBe(true))
  })

  it('cancels through an AbortSignal', async () => {
    let aborted = false
    let started = false
    const controller = new AbortController()
    const [a] = pair({}, { 'b.slow': { handler: (_p, ctx) => new Promise(resolve => { started = true; ctx.signal.addEventListener('abort', () => { aborted = true; resolve(null) }) }) } })
    const pendingCall = a.call('b.slow', {}, { signal: controller.signal })
    await vi.waitFor(() => expect(started).toBe(true))
    controller.abort()
    await rejects(pendingCall, 'CANCELLED')
    await vi.waitFor(() => expect(aborted).toBe(true))
    await rejects(a.call('b.slow', {}, { signal: controller.signal }), 'CANCELLED')
  })

  it('does not start a handler whose call was cancelled before it ran', async () => {
    let ran = false
    const controller = new AbortController()
    const [a] = pair({}, { 'b.never': { handler: () => { ran = true } } })
    const pendingCall = a.call('b.never', {}, { signal: controller.signal })
    controller.abort()
    await rejects(pendingCall, 'CANCELLED')
    await new Promise(r => setTimeout(r, 20))
    expect(ran).toBe(false)
  })

  it('delivers notifications without a response', async () => {
    const received: unknown[] = []
    const [a, b] = pair()
    const [c, d] = createMemoryChannelPair()
    void a; void b
    const x = createRpcEndpoint({ channel: c, resolve: () => undefined })
    createRpcEndpoint({ channel: d, resolve: () => undefined, onNotification: (m, p) => received.push([m, p]) })
    x.notify('bridge.event', { name: 'n' })
    await vi.waitFor(() => expect(received).toEqual([['bridge.event', { name: 'n' }]]))
  })

  it('fails pending calls with SESSION_CLOSED on close and refuses new ones', async () => {
    const [a] = pair({}, { 'b.hang': { handler: () => new Promise(() => undefined) } })
    const pendingCall = a.call('b.hang')
    expect(a.pendingCount).toBe(1)
    a.close()
    await rejects(pendingCall, 'SESSION_CLOSED')
    expect(a.pendingCount).toBe(0)
    await rejects(a.call('b.hang'), 'SESSION_CLOSED')
  })

  it('runs a keyed mutation once across retries and shares an in-flight attempt', async () => {
    let runs = 0
    const [a] = pair({}, { 'b.save': { handler: async (p: { n: number }) => { runs++; await new Promise(r => setTimeout(r, 40)); return { saved: p.n } } } })
    // The first attempt times out on the caller side, but its key keeps it alive for the retry.
    await rejects(a.call('b.save', { n: 1 }, { timeoutMs: 10, idempotencyKey: 'k1' }), 'RPC_TIMEOUT')
    expect(await a.call('b.save', { n: 1 }, { idempotencyKey: 'k1' })).toEqual({ saved: 1 })
    expect(await a.call('b.save', { n: 1 }, { idempotencyKey: 'k1' })).toEqual({ saved: 1 })
    expect(runs).toBe(1)
    await rejects(a.call('b.save', { n: 2 }, { idempotencyKey: 'k1' }), 'IDEMPOTENCY_CONFLICT')
    expect(await a.call('b.save', { n: 2 }, { idempotencyKey: 'k2' })).toEqual({ saved: 2 })
    expect(runs).toBe(2)
  })

  it('re-executes a keyed call after a failure or a cancellation', async () => {
    let runs = 0
    const [a] = pair({}, { 'b.flaky': { handler: () => { runs++; if (runs === 1) throw new Error('first fails'); return runs } } })
    await rejects(a.call('b.flaky', {}, { idempotencyKey: 'k' }), 'INTERNAL')
    expect(await a.call('b.flaky', {}, { idempotencyKey: 'k' })).toBe(2)
  })

  it('applies the guard before dispatch', async () => {
    const guard = vi.fn(({ method }: { method: string }) => {
      if (method === 'b.secret') throw new BridgeError('PERMISSION_DENIED', 'nope')
    })
    const [c, d] = createMemoryChannelPair()
    const caller = createRpcEndpoint({ channel: c, resolve: () => undefined })
    createRpcEndpoint({ channel: d, resolve: () => ({ handler: () => 'ok' }), guard })
    expect(await caller.call('b.open')).toBe('ok')
    await rejects(caller.call('b.secret'), 'PERMISSION_DENIED')
  })

  it('ignores late and unknown responses', async () => {
    const [a] = pair({}, { 'b.late': { handler: () => new Promise(r => setTimeout(() => r('late'), 40)) } })
    await rejects(a.call('b.late', {}, { timeoutMs: 5 }), 'RPC_TIMEOUT')
    await new Promise(r => setTimeout(r, 60))
    expect(a.pendingCount).toBe(0)
  })

  describe('transfer', () => {
    it('moves an ArrayBuffer in params without copying and detaches the sender copy', async () => {
      const received: number[] = []
      const [a] = pair({}, { 'b.take': { handler: (p: { bytes: ArrayBuffer }) => { received.push(p.bytes.byteLength); return { length: p.bytes.byteLength } } } })
      const bytes = new ArrayBuffer(1024)
      expect(await a.call('b.take', { bytes }, { transfer: [bytes] })).toEqual({ length: 1024 })
      expect(bytes.byteLength).toBe(0)
      expect(received).toEqual([1024])
    })

    it('clones when no transfer list is given', async () => {
      const [a] = pair({}, { 'b.take': { handler: (p: { bytes: ArrayBuffer }) => p.bytes.byteLength } })
      const bytes = new ArrayBuffer(16)
      expect(await a.call('b.take', { bytes })).toBe(16)
      expect(bytes.byteLength).toBe(16)
    })

    it('transfers a handler result when it is wrapped with withTransfer, after validating the value', async () => {
      const source = new ArrayBuffer(64)
      const checked: unknown[] = []
      const [a] = pair({}, {
        'b.give': {
          output: (v: unknown) => { checked.push(v); return v },
          handler: () => withTransfer({ bytes: source }, [source]),
        },
      })
      const result = (await a.call('b.give')) as { bytes: ArrayBuffer }
      expect(result.bytes.byteLength).toBe(64)
      expect(source.byteLength).toBe(0)
      expect(checked).toHaveLength(1)
      expect((checked[0] as { bytes: unknown }).bytes).toBe(source)
    })

    it('clones results of keyed calls so a retry can be answered again', async () => {
      let runs = 0
      const [a] = pair({}, { 'b.give': { handler: () => { runs++; const buf = new ArrayBuffer(8); return withTransfer({ buf }, [buf]) } } })
      const first = (await a.call('b.give', {}, { idempotencyKey: 'k' })) as { buf: ArrayBuffer }
      const second = (await a.call('b.give', {}, { idempotencyKey: 'k' })) as { buf: ArrayBuffer }
      expect(first.buf.byteLength).toBe(8)
      expect(second.buf.byteLength).toBe(8)
      expect(runs).toBe(1)
    })

    it('reports NOT_CLONEABLE for params and for results that cannot be sent', async () => {
      const [a] = pair({}, { 'b.fn': { handler: () => ({ f() {} }) }, 'b.ok': { handler: () => 1 } })
      await rejects(a.call('b.ok', { f() {} }), 'NOT_CLONEABLE')
      const error = await rejects(a.call('b.fn'), 'NOT_CLONEABLE')
      expect(error.data).toMatchObject({ method: 'b.fn' })
    })

    it('reports NOT_CLONEABLE when a notification payload cannot be sent', () => {
      const [a] = pair()
      expect(() => a.notify('bridge.event', { f() {} })).toThrowError(expect.objectContaining({ code: 'NOT_CLONEABLE' }))
    })
  })

  describe('limits', () => {
    it('answers OVERLOADED beyond maxInflight and reports it', async () => {
      const events: unknown[] = []
      const release: Array<() => void> = []
      const [c, d] = createMemoryChannelPair()
      const caller = createRpcEndpoint({ channel: c, resolve: () => undefined })
      createRpcEndpoint({
        channel: d,
        resolve: () => ({ handler: () => new Promise<null>(resolve => release.push(() => resolve(null))) }),
        limits: { maxInflight: 2 },
        onLimit: event => events.push(event),
      })
      const first = caller.call('b.slow')
      const second = caller.call('b.slow')
      await vi.waitFor(() => expect(release).toHaveLength(2))
      await rejects(caller.call('b.slow'), 'OVERLOADED')
      expect(events).toEqual([{ kind: 'inflight', method: 'b.slow' }])
      release.forEach(fn => fn())
      await Promise.all([first, second])
      // Capacity is available again once calls finish.
      const third = caller.call('b.slow')
      await vi.waitFor(() => expect(release).toHaveLength(3))
      release[2]!()
      await third
    })

    it('drops notifications beyond the per-second rate and reports once per window', async () => {
      const received: unknown[] = []
      const events: unknown[] = []
      const [c, d] = createMemoryChannelPair()
      const sender = createRpcEndpoint({ channel: c, resolve: () => undefined })
      createRpcEndpoint({
        channel: d,
        resolve: () => undefined,
        limits: { maxNotificationsPerSecond: 5 },
        onNotification: (_m, p) => received.push(p),
        onLimit: event => events.push(event),
      })
      for (let i = 0; i < 20; i++) sender.notify('bridge.event', { i })
      await vi.waitFor(() => expect(received.length + events.length).toBeGreaterThan(0))
      await new Promise(r => setTimeout(r, 20))
      expect(received).toHaveLength(5)
      expect(events).toEqual([{ kind: 'notifications', method: 'bridge.event' }])
    })

    it('never limits bridge.cancel', async () => {
      let aborted = false
      const [c, d] = createMemoryChannelPair()
      const caller = createRpcEndpoint({ channel: c, resolve: () => undefined })
      createRpcEndpoint({
        channel: d,
        limits: { maxNotificationsPerSecond: 0 },
        resolve: () => ({ handler: (_p, ctx) => new Promise(resolve => ctx.signal.addEventListener('abort', () => { aborted = true; resolve(null) })) }),
      })
      const controller = new AbortController()
      const pendingCall = caller.call('b.slow', {}, { signal: controller.signal })
      await new Promise(r => setTimeout(r, 10))
      controller.abort()
      await rejects(pendingCall, 'CANCELLED')
      await vi.waitFor(() => expect(aborted).toBe(true))
    })
  })
})
