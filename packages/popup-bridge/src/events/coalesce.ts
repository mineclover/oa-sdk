/**
 * Event coalescing, declaration side: how an event that fires faster than anyone can use is merged
 * before it crosses the wire. The merging itself lives in the popup runtime (`popup/coalescer.ts`);
 * this file is what a contract declares and the manifest reports.
 */

import { MAX_TIMER_DELAY_MS } from '../env.js'

/** Longest window a policy can have: the longest delay a timer honours. */
export const MAX_COALESCE_WINDOW_MS = MAX_TIMER_DELAY_MS

/**
 * Folds the next payload into the one accumulated so far and returns the result. It must be pure:
 * it receives private copies, but a reducer that mutates `accumulated` and then throws would leave
 * the pending event half merged.
 */
export type CoalesceReducer<P> = (accumulated: P, next: P) => P

export type CoalescePolicy<P> = {
  /**
   * Throttle window in ms (greater than 0, at most 2 147 483 647): at most one event leaves per
   * window. Time in a background tab may run slower than this; browsers throttle timers there.
   */
  readonly windowMs: number
  /** `'latest'` keeps only the newest payload; a reducer folds every payload of the window into one. */
  readonly strategy: 'latest' | CoalesceReducer<P>
  /**
   * Send the first emit of a quiet period immediately and merge only what follows within the
   * window (sent when it ends). Default `false`: the first emit also waits for the window to end.
   */
  readonly leading?: boolean
}

/**
 * A policy with its payload type erased, as a contract stores it. A reducer typed for one payload
 * is assignable here (its parameters are only ever fed that payload), which keeps every concrete
 * `EventSpec<P>` assignable to the untyped `AnyEventSpec` while `event()` still checks the reducer
 * against `P` strictly. Read it back with {@link widenCoalesce}.
 */
export type ErasedCoalescePolicy = {
  readonly windowMs: number
  readonly strategy: 'latest' | ((accumulated: never, next: never) => unknown)
  readonly leading?: boolean
}

/**
 * Types an erased policy for use with unknown payloads. Sound for the one caller that matters: the
 * popup feeds a reducer only payloads of its own event, which `emit` has validated against the
 * contract.
 */
export function widenCoalesce(policy: ErasedCoalescePolicy): CoalescePolicy<unknown> {
  return policy as CoalescePolicy<unknown>
}

/** Checks a policy written by a developer; throws a `TypeError` naming the problem. */
export function assertCoalescePolicy(value: unknown): asserts value is CoalescePolicy<unknown> {
  if (typeof value !== 'object' || value === null) throw new TypeError('event coalesce must be an object { windowMs, strategy, leading? }')
  const { windowMs, strategy, leading } = value as Record<string, unknown>
  if (typeof windowMs !== 'number' || !Number.isFinite(windowMs) || windowMs <= 0 || windowMs > MAX_COALESCE_WINDOW_MS) {
    throw new TypeError(`event coalesce.windowMs must be a number above 0 and at most ${MAX_COALESCE_WINDOW_MS}, got ${String(windowMs)}`)
  }
  if (strategy !== 'latest' && typeof strategy !== 'function') {
    throw new TypeError(`event coalesce.strategy must be 'latest' or a reducer function, got ${typeof strategy === 'string' ? `"${strategy}"` : typeof strategy}`)
  }
  if (leading !== undefined && typeof leading !== 'boolean') throw new TypeError('event coalesce.leading must be a boolean')
}

/** What the manifest says about a policy: the reducer itself is code, not data. */
export function describeCoalesce(policy: ErasedCoalescePolicy): { windowMs: number; strategy: 'latest' | 'reduce'; leading?: boolean } {
  return {
    windowMs: policy.windowMs,
    strategy: policy.strategy === 'latest' ? 'latest' : 'reduce',
    ...(policy.leading === true ? { leading: true } : {}),
  }
}
