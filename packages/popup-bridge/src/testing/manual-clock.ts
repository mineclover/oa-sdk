/**
 * A clock that only moves when the test says so. Every timer the bridge arms through its
 * environment lands here, so a test advances time instead of sleeping and the outcome does not
 * depend on how loaded the machine is.
 *
 * The bridge delivers messages through real `MessagePort`s, which take a few turns of the event
 * loop. `advance` therefore runs each due timer, then lets those turns pass before the next one.
 */
import type { Clock } from '../env.js'

export interface ManualClock extends Clock {
  /**
   * Moves time forward by `ms`, firing the timers that fall due in order, each at its own
   * instant, and lets message delivery settle after every one.
   */
  advance(ms: number): Promise<void>
  /** Lets in-flight messages be delivered without moving time. */
  settle(): Promise<void>
  /** Timers (one-shot or repeating) that are armed and not cancelled. */
  readonly pending: number
}

export type ManualClockOptions = {
  /** What `now()` returns before the first `advance`. Default 0. */
  start?: number
  /** Source of `random()`. Default: a fixed-seed generator, so jitter is reproducible. */
  random?: () => number
  /** Event-loop turns `settle` waits for. Default 4. */
  turns?: number
}

type Timer = { id: number; at: number; every: number | undefined; run: () => void }

/**
 * One turn of the event loop for message delivery. A message through a fresh `MessageChannel` is
 * not affected by fake timers and is much cheaper than a zero-delay timeout.
 */
function turn(): Promise<void> {
  return new Promise(resolve => {
    const { port1, port2 } = new MessageChannel()
    port1.onmessage = () => {
      port1.close()
      port2.close()
      resolve()
    }
    port2.postMessage(null)
  })
}

/** mulberry32: small, fast and good enough for jitter in tests. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function createManualClock(options: ManualClockOptions = {}): ManualClock {
  let current = options.start ?? 0
  let nextId = 1
  const timers = new Map<number, Timer>()
  const random = options.random ?? seededRandom(0x5eed)
  const turns = options.turns ?? 4

  const settle = async (): Promise<void> => {
    for (let i = 0; i < turns; i++) await turn()
  }

  const arm = (ms: number, run: () => void, every: number | undefined): (() => void) => {
    const id = nextId++
    timers.set(id, { id, at: current + Math.max(0, ms), every, run })
    return () => {
      timers.delete(id)
    }
  }

  const earliest = (limit: number): Timer | undefined => {
    let best: Timer | undefined
    for (const timer of timers.values()) {
      if (timer.at > limit) continue
      if (best === undefined || timer.at < best.at || (timer.at === best.at && timer.id < best.id)) best = timer
    }
    return best
  }

  return {
    now: () => current,
    after: (ms, run) => arm(ms, run, undefined),
    every: (ms, run) => arm(ms, run, Math.max(1, ms)),
    random,
    settle,
    get pending() {
      return timers.size
    },
    async advance(ms) {
      if (!Number.isFinite(ms) || ms < 0) throw new RangeError(`advance expects a non-negative number of ms, got ${String(ms)}`)
      const target = current + ms
      await settle()
      for (let timer = earliest(target); timer !== undefined; timer = earliest(target)) {
        current = Math.max(current, timer.at)
        if (timer.every === undefined) timers.delete(timer.id)
        else timer.at = current + timer.every
        timer.run()
        await settle()
      }
      current = target
      await settle()
    },
  }
}
