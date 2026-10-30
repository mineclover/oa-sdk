/**
 * Zero-copy hand-over of buffers. A value passed to `withTransfer` is sent with a transfer list, so
 * `ArrayBuffer`s, `MessagePort`s and similar objects move to the peer instead of being copied; the
 * sender's handles are detached afterwards.
 */

const TRANSFERRED = Symbol.for('oa-sdk.popup-bridge.transferred')

/** A handler result together with the objects to transfer. Create it with `withTransfer`. */
export type Transferred<T> = {
  readonly [TRANSFERRED]: true
  readonly value: T
  readonly transfer: Transferable[]
}

/**
 * Marks a handler result so the listed objects are transferred rather than cloned. Each transferred
 * object must be reachable from `value` and must not be used again by the sender.
 * Results of calls that carry an `idempotencyKey` are cloned instead, because a stored result
 * cannot be sent twice once its buffers are detached.
 */
export function withTransfer<T>(value: T, transfer: Transferable[]): Transferred<T> {
  return { [TRANSFERRED]: true, value, transfer }
}

export function isTransferred(value: unknown): value is Transferred<unknown> {
  return typeof value === 'object' && value !== null && (value as { [TRANSFERRED]?: unknown })[TRANSFERRED] === true
}

/** True for the error `postMessage` throws when a value (or the transfer list) cannot be cloned. */
export function isDataCloneError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'DataCloneError'
}
