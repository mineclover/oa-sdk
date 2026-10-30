import { describe, expect, it } from 'vitest'
import { backoffDelay, createBackoff, resolveBackoff, type ResolvedBackoff } from '../src/index.js'

const policy = (overrides: Partial<ResolvedBackoff> = {}): ResolvedBackoff => ({
  initialMs: 100,
  factor: 2,
  maxMs: 1_000,
  jitter: 0,
  maxRetries: 5,
  ...overrides,
})

describe('resolveBackoff', () => {
  it('fills in the defaults, with the retry count of the caller', () => {
    expect(resolveBackoff(undefined, 6, 'helloRetry')).toEqual({ initialMs: 250, factor: 2, maxMs: 4_000, jitter: 0.5, maxRetries: 6 })
    expect(resolveBackoff({}, 4, 'resubscribeRetry')).toMatchObject({ maxRetries: 4 })
    expect(resolveBackoff({ initialMs: 10, maxMs: 20, maxRetries: 0 }, 4, 'x')).toEqual({ initialMs: 10, factor: 2, maxMs: 20, jitter: 0.5, maxRetries: 0 })
  })

  it('reads false as "do not retry"', () => {
    expect(resolveBackoff(false, 6, 'helloRetry')).toBeUndefined()
  })

  it.each([
    ['initialMs', { initialMs: 0 }],
    ['initialMs', { initialMs: -5 }],
    ['initialMs', { initialMs: Number.NaN }],
    ['initialMs', { initialMs: Number.POSITIVE_INFINITY }],
    ['factor', { factor: 0.5 }],
    ['factor', { factor: Number.NaN }],
    ['maxMs', { initialMs: 100, maxMs: 50 }],
    ['maxMs', { maxMs: Number.POSITIVE_INFINITY }],
    ['jitter', { jitter: -0.1 }],
    ['jitter', { jitter: 1.1 }],
    ['jitter', { jitter: Number.NaN }],
    ['initialMs', { initialMs: 2 ** 31 }],
    ['maxMs', { initialMs: 100, maxMs: 2 ** 31 }],
    ['maxRetries', { maxRetries: -1 }],
    ['maxRetries', { maxRetries: 1.5 }],
    ['maxRetries', { maxRetries: Number.POSITIVE_INFINITY }],
  ])('refuses an invalid %s', (field, option) => {
    expect(() => resolveBackoff(option, 4, 'helloRetry')).toThrowError(new RegExp(`^helloRetry\\.${field} must be`))
    expect(() => resolveBackoff(option, 4, 'helloRetry')).toThrow(TypeError)
  })

  it('accepts the longest delay a timer honours and refuses anything above it', () => {
    const longest = 2_147_483_647
    expect(resolveBackoff({ initialMs: longest, maxMs: longest }, 1, 'x')).toMatchObject({ initialMs: longest, maxMs: longest })
    // Above it a timer would fire after about 1 ms, so every retry would run at once.
    expect(() => resolveBackoff({ initialMs: longest + 1 }, 1, 'x')).toThrow(/at most 2147483647/)
    expect(() => resolveBackoff({ maxMs: longest + 1 }, 1, 'x')).toThrow(/to 2147483647/)
  })

  it('refuses something that is neither false nor an options object', () => {
    for (const bad of [true, 5, 'fast', null, []]) {
      expect(() => resolveBackoff(bad as never, 4, 'helloRetry'), String(bad)).toThrow(/helloRetry must be false or an options object/)
    }
  })

  it('returns a frozen policy', () => {
    expect(Object.isFrozen(resolveBackoff({}, 1, 'x'))).toBe(true)
  })
})

describe('backoffDelay', () => {
  it('doubles from the initial delay up to the ceiling', () => {
    const p = policy()
    expect([1, 2, 3, 4, 5, 6, 7].map(n => backoffDelay(p, n, () => 1))).toEqual([100, 200, 400, 800, 1_000, 1_000, 1_000])
  })

  it('uses the factor given', () => {
    expect([1, 2, 3].map(n => backoffDelay(policy({ factor: 3, maxMs: 10_000 }), n, () => 1))).toEqual([100, 300, 900])
    expect([1, 2, 3].map(n => backoffDelay(policy({ factor: 1 }), n, () => 1))).toEqual([100, 100, 100])
  })

  it('spreads the randomized share downward only, so the ceiling holds', () => {
    const p = policy({ jitter: 0.5 })
    expect(backoffDelay(p, 3, () => 1)).toBe(400)
    expect(backoffDelay(p, 3, () => 0)).toBe(200)
    expect(backoffDelay(p, 3, () => 0.5)).toBe(300)
    const full = policy({ jitter: 1 })
    expect(backoffDelay(full, 3, () => 0)).toBe(0)
    for (let n = 1; n < 20; n++) {
      for (const draw of [0, 0.25, 0.999999]) {
        const delay = backoffDelay(p, n, () => draw)
        expect(delay).toBeLessThanOrEqual(p.maxMs)
        expect(delay).toBeGreaterThanOrEqual(Math.min(p.maxMs, p.initialMs * p.factor ** (n - 1)) * (1 - p.jitter) - 1)
      }
    }
  })

  it('does not overflow for a huge attempt number or factor', () => {
    const p = policy({ factor: 1e9, maxMs: 5_000 })
    expect(backoffDelay(p, 10_000, () => 1)).toBe(5_000)
    expect(backoffDelay(policy(), 1_000_000, () => 1)).toBe(1_000)
    expect(backoffDelay(policy({ factor: Number.MAX_VALUE }), 3, () => 1)).toBe(1_000)
  })

  it('tolerates a random source that misbehaves', () => {
    const p = policy({ jitter: 0.5 })
    expect(backoffDelay(p, 1, () => Number.NaN)).toBe(100)
    expect(backoffDelay(p, 1, () => 7)).toBe(100)
    expect(backoffDelay(p, 1, () => -3)).toBe(50)
  })

  it('treats an attempt below 1 as the first', () => {
    expect(backoffDelay(policy(), 0, () => 1)).toBe(100)
    expect(backoffDelay(policy(), -4, () => 1)).toBe(100)
  })
})

describe('createBackoff', () => {
  it('hands out the delays in order, then nothing', () => {
    const backoff = createBackoff(policy({ maxRetries: 3 }), () => 1)
    expect([backoff.next(), backoff.next(), backoff.next(), backoff.next(), backoff.next()]).toEqual([100, 200, 400, undefined, undefined])
    expect(backoff.attempts).toBe(3)
  })

  it('draws a fresh random number for every delay', () => {
    const draws = [0, 1, 0.5]
    const backoff = createBackoff(policy({ jitter: 1, maxRetries: 3, factor: 1 }), () => draws.shift() ?? 1)
    expect([backoff.next(), backoff.next(), backoff.next()]).toEqual([0, 100, 50])
  })

  it('has no retries at all for maxRetries 0', () => {
    const backoff = createBackoff(policy({ maxRetries: 0 }), () => 1)
    expect(backoff.next()).toBeUndefined()
    expect(backoff.attempts).toBe(0)
  })

  it('starts over after reset', () => {
    const backoff = createBackoff(policy({ maxRetries: 2 }), () => 1)
    backoff.next()
    backoff.next()
    expect(backoff.next()).toBeUndefined()
    backoff.reset()
    expect(backoff.attempts).toBe(0)
    expect(backoff.next()).toBe(100)
  })
})
