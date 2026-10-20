/**
 * @oa-sdk/peer-server/relay — relay room and session limits
 *
 * One validation path for the time limits SignalingRoom and PeerRelayManager
 * accept, so a bad configuration fails the same way wherever it is given,
 * and as early as possible. This module is internal: the relay entry point
 * re-exports only the defaults, through signaling-room.ts.
 */

/** Default idle limit of an approved relay session; any relay frame renews it. */
export const DEFAULT_RELAY_IDLE_TIMEOUT_MS = 5 * 60_000
/** Default hard limit of an approved relay session. */
export const DEFAULT_RELAY_MAX_SESSION_MS = 24 * 60 * 60_000

/** Largest delay a timer accepts (2^31 - 1 ms); larger values fire at once. */
const MAX_TIMER_MS = 2_147_483_647

/** Validate a millisecond option used as a timer delay or deadline: an integer between `min` and 2^31 - 1. */
export function timerMs(value: number, name: string, min: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > MAX_TIMER_MS) {
    throw new RangeError(`${name} must be an integer between ${min} and ${MAX_TIMER_MS}`)
  }
  return value
}

/** Validate a room TTL in ms: a positive safe integer. */
export function roomTtlMs(value: number, name = 'roomTtlMs'): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`)
  }
  return value
}

export interface RelaySessionLimits {
  /** Idle limit of an approved relay session in ms; 0 disables it. */
  relayIdleTimeoutMs: number
  /** Hard limit of an approved relay session in ms. */
  relayMaxSessionMs: number
}

/**
 * Apply the defaults and validate both relay session limits:
 * relayIdleTimeoutMs is an integer from 0 (disabled) to 2^31 - 1 and
 * relayMaxSessionMs an integer from 1 to 2^31 - 1. Throws RangeError otherwise.
 */
export function resolveRelaySessionLimits(options: {
  relayIdleTimeoutMs?: number | undefined
  relayMaxSessionMs?: number | undefined
}): RelaySessionLimits {
  return {
    relayIdleTimeoutMs: timerMs(options.relayIdleTimeoutMs ?? DEFAULT_RELAY_IDLE_TIMEOUT_MS, 'relayIdleTimeoutMs', 0),
    relayMaxSessionMs: timerMs(options.relayMaxSessionMs ?? DEFAULT_RELAY_MAX_SESSION_MS, 'relayMaxSessionMs', 1),
  }
}
