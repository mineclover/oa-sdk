/**
 * Bounded exponential backoff with jitter, for the two places the bridge retries on its own: the
 * popup re-announcing itself (HELLO) while no host answers, and the host subscribing events again
 * after a reconnect.
 *
 * This module is arithmetic only. It owns no timers and no randomness: the callers wait with
 * `clock.after` and pass `clock.random`, so a test that drives a manual clock gets the same delays
 * every run.
 *
 *   delay(n) = min(maxMs, initialMs * factor^(n-1)) * (1 - jitter + jitter * random())
 *
 * `jitter` is the share of the delay that is randomized: 0 gives exact delays, 1 spreads them over
 * `[0, delay)`. Jitter only ever shortens a delay, so `maxMs` stays a hard ceiling.
 */
import { MAX_TIMER_DELAY_MS } from './env.js'
import type { BridgeError } from './protocol/errors.js'

export type BackoffOptions = {
  /** Delay before the first retry, in ms, at most 2 147 483 647 (the longest a timer honours). Default 250. */
  initialMs?: number
  /** Growth of the delay per retry, at least 1. Default 2. */
  factor?: number
  /** Ceiling of a single delay, in ms, from `initialMs` to 2 147 483 647. Default 4 000. */
  maxMs?: number
  /** Share of each delay that is randomized, from 0 to 1. Default 0.5. */
  jitter?: number
  /** Retries after the first attempt (0 means none). The default depends on what is retried. */
  maxRetries?: number
}

/** A validated policy; every field is set. */
export type ResolvedBackoff = {
  readonly initialMs: number
  readonly factor: number
  readonly maxMs: number
  readonly jitter: number
  readonly maxRetries: number
}

/** What is being retried. */
export type RetryTarget = 'hello' | 'resubscribe'

/**
 * Where a retry run stands:
 *
 * - `scheduled`: a retry is waiting; `delayMs` says for how long.
 * - `attempt`: the wait is over and the retry is being made now.
 * - `recovered`: the run ended in success after `attempt` retries.
 * - `exhausted`: it ended without success (no retries left, or an error that retrying cannot fix).
 */
export type RetryPhase = 'scheduled' | 'attempt' | 'recovered' | 'exhausted'

export type RetryEvent = {
  target: RetryTarget
  phase: RetryPhase
  /** The retry this refers to, counted from 1; for `recovered` and `exhausted`, how many were made. */
  attempt: number
  /** For `scheduled`: the wait before the retry. */
  delayMs?: number
  /** For `resubscribe`: the event the run is about. */
  event?: string
  /** For `scheduled` and `exhausted`: the failure that led here. */
  error?: BridgeError
}

/** Counts the retries of one run and hands out their delays. */
export interface Backoff {
  readonly policy: ResolvedBackoff
  /** Retries handed out so far. */
  readonly attempts: number
  /** The delay before the next retry, or `undefined` when `maxRetries` retries were handed out. */
  next(): number | undefined
  /** Starts a new run. */
  reset(): void
}

const DEFAULT_POLICY = { initialMs: 250, factor: 2, maxMs: 4_000, jitter: 0.5 } as const

function fail(label: string, key: string, expectation: string, value: unknown): never {
  throw new TypeError(`${label}.${key} must be ${expectation}, got ${String(value)}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Turns an option into a policy: `false` means "do not retry" (`undefined`), an omitted option or
 * missing fields take the defaults (`defaultMaxRetries` for the retry count). A value that cannot
 * work throws a `TypeError` naming `label` and the field, so a mistake surfaces when the option is
 * handed over, not in the middle of a reconnect.
 */
export function resolveBackoff(option: false | BackoffOptions | undefined, defaultMaxRetries: number, label: string): ResolvedBackoff | undefined {
  if (option === false) return undefined
  if (option !== undefined && !isRecord(option)) throw new TypeError(`${label} must be false or an options object, got ${String(option)}`)
  const initialMs = option?.initialMs ?? DEFAULT_POLICY.initialMs
  const factor = option?.factor ?? DEFAULT_POLICY.factor
  const maxMs = option?.maxMs ?? DEFAULT_POLICY.maxMs
  const jitter = option?.jitter ?? DEFAULT_POLICY.jitter
  const maxRetries = option?.maxRetries ?? defaultMaxRetries
  // A longer delay would not wait longer: timers clamp it to about 1 ms and every retry would fire at once.
  if (typeof initialMs !== 'number' || !Number.isFinite(initialMs) || initialMs <= 0 || initialMs > MAX_TIMER_DELAY_MS) {
    fail(label, 'initialMs', `a positive number of ms, at most ${MAX_TIMER_DELAY_MS}`, initialMs)
  }
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor < 1) fail(label, 'factor', 'a number of at least 1', factor)
  if (typeof maxMs !== 'number' || !Number.isFinite(maxMs) || maxMs < initialMs || maxMs > MAX_TIMER_DELAY_MS) {
    fail(label, 'maxMs', `a number from initialMs (${initialMs}) to ${MAX_TIMER_DELAY_MS}`, maxMs)
  }
  if (typeof jitter !== 'number' || !(jitter >= 0 && jitter <= 1)) fail(label, 'jitter', 'a number from 0 to 1', jitter)
  if (typeof maxRetries !== 'number' || !Number.isInteger(maxRetries) || maxRetries < 0) fail(label, 'maxRetries', 'a non-negative integer', maxRetries)
  return Object.freeze({ initialMs, factor, maxMs, jitter, maxRetries })
}

/**
 * The wait before retry number `attempt` (counted from 1). A large `attempt` or `factor` cannot
 * overflow: the exponential part saturates at `maxMs`. `random` is read once, for the jitter.
 */
export function backoffDelay(policy: ResolvedBackoff, attempt: number, random: () => number): number {
  const steps = Math.max(0, Math.floor(attempt) - 1)
  const grown = policy.initialMs * policy.factor ** steps
  const capped = Number.isFinite(grown) ? Math.min(grown, policy.maxMs) : policy.maxMs
  const drawn = random()
  const draw = Number.isFinite(drawn) ? Math.min(1, Math.max(0, drawn)) : 1
  return Math.round(capped * (1 - policy.jitter + policy.jitter * draw))
}

export function createBackoff(policy: ResolvedBackoff, random: () => number): Backoff {
  let attempts = 0
  return {
    policy,
    get attempts() {
      return attempts
    },
    next() {
      if (attempts >= policy.maxRetries) return undefined
      attempts += 1
      return backoffDelay(policy, attempts, random)
    },
    reset() {
      attempts = 0
    },
  }
}
