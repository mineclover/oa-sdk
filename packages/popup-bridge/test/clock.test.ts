import { afterEach, describe, expect, it, vi } from 'vitest'
import { BridgeError, systemClock } from '../src/index.js'
import type { EventMeta } from '../src/host.js'
import { createManualClock } from '../src/testing.js'
import { definition, init, setup } from './fixture.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('systemClock', () => {
  it('follows fake timers installed after it was imported', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const fired: string[] = []
    systemClock.after(10, () => fired.push('after'))
    const stopEvery = systemClock.every(4, () => fired.push('every'))
    expect(systemClock.now()).toBe(1_000)
    vi.advanceTimersByTime(9)
    expect(fired).toEqual(['every', 'every'])
    vi.advanceTimersByTime(1)
    expect(fired).toEqual(['every', 'every', 'after'])
    stopEvery()
    vi.advanceTimersByTime(100)
    expect(fired).toHaveLength(3)
    expect(systemClock.now()).toBe(1_110)
  })

  it('cancels a one-shot timer, and cancelling twice is harmless', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const cancel = systemClock.after(10, run)
    cancel()
    cancel()
    vi.advanceTimersByTime(50)
    expect(run).not.toHaveBeenCalled()
    expect(systemClock.random()).toBeGreaterThanOrEqual(0)
    expect(systemClock.random()).toBeLessThan(1)
  })
})

describe('createManualClock', () => {
  it('fires timers in time order, each at its own instant, and only when advanced', async () => {
    const clock = createManualClock({ start: 100 })
    const log: Array<[string, number]> = []
    clock.after(30, () => log.push(['b', clock.now()]))
    clock.after(10, () => log.push(['a', clock.now()]))
    clock.after(30, () => log.push(['c', clock.now()])) // same instant: armed order
    clock.after(80, () => log.push(['late', clock.now()]))
    expect(log).toEqual([])
    await clock.advance(50)
    expect(log).toEqual([['a', 110], ['b', 130], ['c', 130]])
    expect(clock.now()).toBe(150)
    expect(clock.pending).toBe(1)
    await clock.advance(30)
    expect(log.at(-1)).toEqual(['late', 180])
    expect(clock.pending).toBe(0)
  })

  it('runs repeating timers every period and stops them when cancelled', async () => {
    const clock = createManualClock()
    const ticks: number[] = []
    const stop = clock.every(10, () => ticks.push(clock.now()))
    await clock.advance(35)
    expect(ticks).toEqual([10, 20, 30])
    stop()
    await clock.advance(100)
    expect(ticks).toEqual([10, 20, 30])
    expect(clock.pending).toBe(0)
  })

  it('fires timers armed by a timer when they fall inside the same advance', async () => {
    const clock = createManualClock()
    const log: number[] = []
    clock.after(10, () => {
      log.push(clock.now())
      clock.after(10, () => log.push(clock.now()))
    })
    await clock.advance(25)
    expect(log).toEqual([10, 20])
  })

  it('lets a timer cancel another one that is due in the same advance', async () => {
    const clock = createManualClock()
    const second = vi.fn()
    let cancelSecond = () => {}
    clock.after(10, () => cancelSecond())
    cancelSecond = clock.after(20, second)
    await clock.advance(50)
    expect(second).not.toHaveBeenCalled()
  })

  it('gives reproducible jitter, or whatever generator the test supplies', () => {
    const first = createManualClock()
    const second = createManualClock()
    const sequence = Array.from({ length: 5 }, () => first.random())
    expect(Array.from({ length: 5 }, () => second.random())).toEqual(sequence)
    expect(new Set(sequence).size).toBe(5)
    expect(sequence.every(value => value >= 0 && value < 1)).toBe(true)
    expect(createManualClock({ random: () => 0.25 }).random()).toBe(0.25)
  })

  it('refuses to move backwards or by a non-number', async () => {
    const clock = createManualClock()
    await expect(clock.advance(-1)).rejects.toBeInstanceOf(RangeError)
    await expect(clock.advance(Number.NaN)).rejects.toBeInstanceOf(RangeError)
  })
})

describe('the bridge on a manual clock', () => {
  it('times out the handshake of a popup that never answers, without waiting', async () => {
    const clock = createManualClock()
    const { bridge } = setup({ silent: true, clock })
    let outcome: unknown = 'pending'
    const opening = bridge.open(definition, { init }).then(
      () => (outcome = 'opened'),
      (error: unknown) => (outcome = error),
    )
    await clock.advance(14_999)
    expect(outcome).toBe('pending')
    await clock.advance(1)
    await opening
    expect(outcome).toBeInstanceOf(BridgeError)
    expect((outcome as BridgeError).code).toBe('HANDSHAKE_TIMEOUT')
  })

  it('times out a call to a hung popup at the instant the clock says', async () => {
    const clock = createManualClock()
    const { bridge, booted } = setup({ freezable: true, clock })
    const session = await bridge.open(definition, { init })
    booted[0]!.freeze()
    let outcome: unknown = 'pending'
    const call = session.call('asset.getSnapshot', undefined, { timeoutMs: 1_000 }).then(
      () => (outcome = 'answered'),
      (error: unknown) => (outcome = error),
    )
    await clock.advance(999)
    expect(outcome).toBe('pending')
    await clock.advance(1)
    await call
    expect((outcome as BridgeError).code).toBe('RPC_TIMEOUT')
    await session.close()
  })

  it('applies the notification rate limit per second of the clock, not of the wall', async () => {
    const clock = createManualClock()
    const { bridge, booted, securityEvents } = setup({ clock })
    const session = await bridge.open(definition, { init, limits: { maxNotificationsPerSecond: 3 } })
    const metas: EventMeta[] = []
    await session.subscribe('asset.selectionChanged', (_payload, meta) => metas.push(meta))
    const popup = booted[0]!.runtime
    for (let i = 1; i <= 4; i++) popup.emit('asset.selectionChanged', { assetIds: [String(i)] })
    await clock.settle()
    expect(metas.map(m => m.revision)).toEqual([1, 2, 3])
    expect(securityEvents.filter(e => e.type === 'rate-limited')).toHaveLength(1)

    await clock.advance(1_000)
    popup.emit('asset.selectionChanged', { assetIds: ['5'] })
    await clock.settle()
    expect(metas.map(m => [m.revision, m.gap, m.missed])).toEqual([[1, false, 0], [2, false, 0], [3, false, 0], [5, true, 1]])
    await session.close()
  })
})
