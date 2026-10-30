/**
 * Symmetric JSON-RPC 2.0 endpoint.
 *
 * Both the host and the popup create one over their end of the channel, so calls, notifications
 * and cancellation work identically in both directions. The wire is structured-clone safe JSON-RPC
 * with two documented extensions: a top-level `meta` member on requests (idempotency key) and the
 * reserved `bridge.cancel` notification.
 */
import type { CallOptions, HandlerContext } from '../contract/define.js'
import { runSchema, type SchemaLike } from '../contract/schema.js'
import { systemClock, type Clock } from '../env.js'
import { BridgeError, fromWireError, toBridgeError } from '../protocol/errors.js'
import type { RpcChannel } from './channel.js'
import { IdempotencyStore, fingerprintParams } from './idempotency.js'
import { isDataCloneError, isTransferred, withTransfer } from './transfer.js'

export type RpcId = string | number

export type RpcRegistration = {
  // `never` accepts handlers of any params type; the endpoint validates the input before calling.
  handler: (params: never, context: HandlerContext) => unknown | Promise<unknown>
  input?: SchemaLike<unknown>
  output?: SchemaLike<unknown>
  permission?: string
}

export type GuardInfo = {
  method: string
  registration: RpcRegistration
  meta: Readonly<Record<string, unknown>>
}

export type RpcEndpointOptions = {
  channel: RpcChannel
  /** Finds the implementation of a method; `undefined` answers `METHOD_NOT_FOUND`. */
  resolve: (method: string) => RpcRegistration | undefined
  /** Runs before a request is dispatched; throw a `BridgeError` to refuse it (readiness, permissions). */
  guard?: (info: GuardInfo) => void | Promise<void>
  /** Receives notifications other than the built-in `bridge.cancel`. */
  onNotification?: (method: string, params: unknown) => void
  /** Default 30 000 ms. `Infinity` disables the timeout. */
  defaultTimeoutMs?: number
  /** Validate handler results against `registration.output`. Default `true`. */
  validateOutput?: boolean
  idempotencyLimit?: number
  /** Prefix of generated request ids; keeps the two directions readable in logs. */
  idPrefix?: string
  /** Caps on what the peer may impose on this side. Unset members are unlimited. */
  limits?: EndpointLimits
  /** Called when a limit refused or dropped something. */
  onLimit?: (event: LimitEvent) => void
  /** Observes finished calls and sent or received notifications, for inspectors and logs. */
  onTrace?: (event: RpcTrace) => void
  /** Time source for call timeouts, durations and the notification rate window. Default: the system clock. */
  clock?: Clock
}

/** `out` is a call or notification this side sent, `in` one it received. */
export type RpcTrace =
  | { kind: 'call'; direction: 'in' | 'out'; method: string; durationMs: number; error?: string }
  | { kind: 'notification'; direction: 'in' | 'out'; method: string }

export type EndpointLimits = {
  /** Requests being served at once; further requests are answered with `OVERLOADED`. */
  maxInflight?: number
  /** Notifications accepted per second; the excess is dropped (events show a revision gap). */
  maxNotificationsPerSecond?: number
}

export type LimitEvent = { kind: 'inflight' | 'notifications'; method: string }

export interface RpcEndpoint {
  call(method: string, params?: unknown, options?: CallOptions): Promise<unknown>
  notify(method: string, params?: unknown, transfer?: Transferable[]): void
  readonly pendingCount: number
  readonly closed: boolean
  /** Fails pending calls with `error` (default `SESSION_CLOSED`), aborts running handlers, closes the channel. */
  close(error?: BridgeError): void
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: BridgeError) => void
  cancelTimer: (() => void) | undefined
  detach: () => void
}

type Inflight = { controller: AbortController; cancel: () => void }

const DEFAULT_TIMEOUT_MS = 30_000
export const CANCEL_METHOD = 'bridge.cancel'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isId(value: unknown): value is RpcId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
}

export function createRpcEndpoint(options: RpcEndpointOptions): RpcEndpoint {
  const { channel } = options
  const clock = options.clock ?? systemClock
  const defaultTimeout = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
  const idPrefix = options.idPrefix ?? 'req-'
  const pending = new Map<RpcId, Pending>()
  const inflight = new Map<RpcId, Inflight>()
  const store = new IdempotencyStore(options.idempotencyLimit)
  let counter = 0
  let closed = false

  const trySend = (message: unknown, transfer?: Transferable[]): { error: unknown } | undefined => {
    try {
      channel.send(message, transfer)
      return undefined
    } catch (error) {
      return { error }
    }
  }
  const send = (message: unknown): boolean => trySend(message) === undefined

  const reply = (id: RpcId, method: string, outcome: { result: unknown } | { error: BridgeError }) => {
    if (closed) return
    if ('error' in outcome) {
      send({ jsonrpc: '2.0', id, error: outcome.error.toWire() })
      return
    }
    const transferred = isTransferred(outcome.result) ? outcome.result : undefined
    const result = transferred === undefined ? outcome.result : transferred.value
    const failure = trySend({ jsonrpc: '2.0', id, result: result ?? null }, transferred?.transfer)
    if (failure === undefined) return
    // A result the channel cannot send must not leave the caller waiting for its timeout.
    const error = isDataCloneError(failure.error)
      ? new BridgeError('NOT_CLONEABLE', `The result of ${method} cannot be sent: it holds a value that cannot be cloned or transferred`, { data: { method } })
      : new BridgeError('INTERNAL', 'Result could not be serialized')
    send({ jsonrpc: '2.0', id, error: error.toWire() })
  }

  async function serve(id: RpcId, method: string, params: unknown, meta: Record<string, unknown>): Promise<void> {
    const controller = new AbortController()
    let cancelNow!: () => void
    const cancelled = new Promise<never>((_, reject) => {
      cancelNow = () => reject(new BridgeError('CANCELLED', `Call ${String(id)} was cancelled`))
    })
    cancelled.catch(() => undefined)
    const key = typeof meta.idempotencyKey === 'string' ? meta.idempotencyKey : undefined
    inflight.set(id, {
      controller,
      cancel: () => {
        controller.abort()
        // A cancelled attempt must not satisfy a later retry of the same key.
        if (key !== undefined) store.forget(method, key)
        cancelNow()
      },
    })

    const run = async (): Promise<unknown> => {
      const registration = options.resolve(method)
      if (registration === undefined) throw new BridgeError('METHOD_NOT_FOUND', `Method not found: ${method}`)
      await options.guard?.({ method, registration, meta })
      if (controller.signal.aborted) throw new BridgeError('CANCELLED', `Call ${String(id)} was cancelled`)
      if (params !== undefined && !isRecord(params)) {
        throw new BridgeError('INVALID_PARAMS', 'params must be an object of named fields')
      }
      const input =
        registration.input === undefined ? params : runSchema(registration.input, params, 'INVALID_PARAMS', `Params of ${method}`)
      const execute = async (): Promise<unknown> => {
        const context: HandlerContext = { method, signal: controller.signal, sessionId: undefined, meta }
        const produced = await registration.handler(input as never, context)
        // Keyed results are stored for retries, so they are always cloned, never transferred.
        const transferred = key === undefined && isTransferred(produced) ? produced : undefined
        const result = isTransferred(produced) ? produced.value : produced
        const checked =
          options.validateOutput === false || registration.output === undefined
            ? result
            : runSchema(registration.output, result, 'INVALID_RESULT', `Result of ${method}`)
        return transferred === undefined ? checked : withTransfer(checked, transferred.transfer)
      }
      return key === undefined
        ? execute()
        : store.run(method, key, fingerprintParams(params), execute, () => !controller.signal.aborted)
    }

    const startedAt = clock.now()
    let failure: BridgeError | undefined
    try {
      reply(id, method, { result: await Promise.race([run(), cancelled]) })
    } catch (error) {
      failure = toBridgeError(error)
      reply(id, method, { error: failure })
    } finally {
      inflight.delete(id)
      options.onTrace?.({ kind: 'call', direction: 'in', method, durationMs: clock.now() - startedAt, ...(failure === undefined ? {} : { error: failure.code }) })
    }
  }

  function onMessage(message: unknown): void {
    if (closed || !isRecord(message) || message.jsonrpc !== '2.0') return
    const hasId = Object.hasOwn(message, 'id')
    if (typeof message.method === 'string') {
      if (!hasId) {
        notification(message.method, message.params)
      } else if (isId(message.id)) {
        const limit = options.limits?.maxInflight
        if (limit !== undefined && inflight.size >= limit) {
          options.onLimit?.({ kind: 'inflight', method: message.method })
          reply(message.id, message.method, {
            error: new BridgeError('OVERLOADED', `Too many requests in flight (limit ${limit})`, { data: { limit } }),
          })
          return
        }
        void serve(message.id, message.method, message.params, isRecord(message.meta) ? message.meta : {})
      }
      return
    }
    if (!hasId || !isId(message.id)) return
    const entry = pending.get(message.id)
    if (entry === undefined) return // late response of a timed-out or cancelled call
    pending.delete(message.id)
    entry.detach()
    if (isRecord(message.error)) entry.reject(fromWireError(message.error))
    else entry.resolve(message.result)
  }

  function notification(method: string, params: unknown): void {
    if (method === CANCEL_METHOD) {
      const id = isRecord(params) ? params.id : undefined
      if (isId(id)) inflight.get(id)?.cancel()
      return
    }
    if (!withinNotificationRate(method)) return
    options.onTrace?.({ kind: 'notification', direction: 'in', method })
    options.onNotification?.(method, params)
  }

  let rateWindowStart = 0
  let rateCount = 0
  let rateReported = false
  function withinNotificationRate(method: string): boolean {
    const limit = options.limits?.maxNotificationsPerSecond
    if (limit === undefined) return true
    const now = clock.now()
    if (now - rateWindowStart >= 1_000) {
      rateWindowStart = now
      rateCount = 0
      rateReported = false
    }
    if (rateCount < limit) {
      rateCount += 1
      return true
    }
    // Report once per window: a flood must not turn into a flood of reports.
    if (!rateReported) {
      rateReported = true
      options.onLimit?.({ kind: 'notifications', method })
    }
    return false
  }

  const unsubscribe = channel.subscribe(onMessage)

  return {
    call(method, params, callOptions = {}) {
      if (closed) return Promise.reject(new BridgeError('SESSION_CLOSED', 'The session is closed'))
      const id = `${idPrefix}${++counter}`
      const key = callOptions.idempotencyKey
      const timeoutMs = callOptions.timeoutMs ?? defaultTimeout
      const startedAt = clock.now()
      const outcome = new Promise<unknown>((resolve, reject) => {
        const signal = callOptions.signal
        if (signal?.aborted) return reject(new BridgeError('CANCELLED', `${method} was cancelled`))
        const entry: Pending = { resolve, reject, cancelTimer: undefined, detach: () => undefined }
        const settle = (error: BridgeError, cancelRemote: boolean) => {
          if (!pending.delete(id)) return
          entry.detach()
          if (cancelRemote) send({ jsonrpc: '2.0', method: CANCEL_METHOD, params: { id } })
          reject(error)
        }
        if (Number.isFinite(timeoutMs)) {
          entry.cancelTimer = clock.after(
            timeoutMs,
            // A keyed call is expected to be retried: leave the remote attempt running so the retry joins it.
            () => settle(new BridgeError('RPC_TIMEOUT', `${method} timed out after ${timeoutMs}ms`, { data: { method, timeoutMs } }), key === undefined),
          )
        }
        if (signal !== undefined) {
          const onAbort = () => settle(new BridgeError('CANCELLED', `${method} was cancelled`), true)
          signal.addEventListener('abort', onAbort, { once: true })
          entry.detach = () => {
            signal.removeEventListener('abort', onAbort)
            entry.cancelTimer?.()
          }
        } else {
          entry.detach = () => {
            entry.cancelTimer?.()
          }
        }
        pending.set(id, entry)
        const request = {
          jsonrpc: '2.0' as const,
          id,
          method,
          ...(params === undefined ? {} : { params }),
          ...(key === undefined ? {} : { meta: { idempotencyKey: key } }),
        }
        try {
          channel.send(request, callOptions.transfer)
        } catch (error) {
          settle(
            isDataCloneError(error)
              ? new BridgeError('NOT_CLONEABLE', `Params of ${method} cannot be sent: they hold a value that cannot be cloned or transferred`, { data: { method }, cause: error })
              : new BridgeError('INVALID_PARAMS', `Params of ${method} cannot be sent`, { cause: error }),
            false,
          )
        }
      })
      const trace = options.onTrace
      if (trace !== undefined) {
        const finished = (error?: string) =>
          trace({ kind: 'call', direction: 'out', method, durationMs: clock.now() - startedAt, ...(error === undefined ? {} : { error }) })
        outcome.then(
          () => finished(),
          (error: unknown) => finished(error instanceof BridgeError ? error.code : 'INTERNAL'),
        )
      }
      return outcome
    },
    notify(method, params, transfer) {
      if (closed) throw new BridgeError('SESSION_CLOSED', 'The session is closed')
      try {
        channel.send({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }, transfer)
        options.onTrace?.({ kind: 'notification', direction: 'out', method })
      } catch (error) {
        if (!isDataCloneError(error)) throw error
        throw new BridgeError('NOT_CLONEABLE', `Params of ${method} cannot be sent: they hold a value that cannot be cloned or transferred`, { data: { method }, cause: error })
      }
    },
    get pendingCount() {
      return pending.size
    },
    get closed() {
      return closed
    },
    close(error = new BridgeError('SESSION_CLOSED', 'The session is closed')) {
      if (closed) return
      closed = true
      unsubscribe()
      for (const entry of pending.values()) {
        entry.detach()
        entry.reject(error)
      }
      pending.clear()
      for (const entry of inflight.values()) entry.controller.abort()
      inflight.clear()
      store.clear()
      channel.close()
    },
  }
}
