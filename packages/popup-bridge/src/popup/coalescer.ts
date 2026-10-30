/**
 * Merges the emits of high-frequency events inside a window before they are committed.
 *
 * Throttle semantics. Without `leading`, the first emit of a quiet period opens a window and waits
 * for it to end; with `leading` it is committed at once and the window only collects what follows.
 * When a window ends with something pending it is committed and, for a leading event, a new window
 * opens (so at most one event leaves per window); otherwise the event goes quiet again.
 *
 * Folding is eager: every emit is copied, folded into the pending payload and validated right away,
 * so a bad payload fails the emit that carried it and never corrupts what is already pending. The
 * revision is assigned by `commit` when an event leaves, never when it is merged away; merging is
 * therefore invisible to gap detection.
 */
import type { CoalescePolicy } from '../events/coalesce.js'
import { copyPayload } from '../events/replay.js'
import type { Clock } from '../env.js'

export type CoalescedCommit = {
  /** How many emits were merged; `undefined` when the event stands for one emit. */
  coalesced?: number
  /** True when `payload` is already a private copy, so the committer need not copy it again. */
  owned: boolean
}

export type EventCoalescerDeps = {
  after: Clock['after']
  /** Gives the event its revision and sends it. May throw; on a timer the error goes to `onError`. */
  commit: (name: string, payload: unknown, options: CoalescedCommit) => void
  /** Checks a merged payload against the contract; throws when invalid. */
  validate?: (name: string, payload: unknown) => void
  onError: (error: unknown) => void
}

type Pending = { payload: unknown; count: number }

type Window = {
  policy: CoalescePolicy<unknown>
  pending: Pending | undefined
  cancel: () => void
}

export class EventCoalescer {
  readonly #deps: EventCoalescerDeps
  readonly #windows = new Map<string, Window>()

  constructor(deps: EventCoalescerDeps) {
    this.#deps = deps
  }

  /** True while `name` has an emit waiting for its window to end. */
  hasPending(name: string): boolean {
    return this.#windows.get(name)?.pending !== undefined
  }

  /**
   * Takes one emit of an event with a coalesce policy. Throws (and changes nothing) when the
   * payload cannot be copied, the reducer throws or the merged payload is invalid.
   */
  emit(name: string, policy: CoalescePolicy<unknown>, payload: unknown): void {
    const window = this.#windows.get(name)
    if (window === undefined) {
      if (policy.leading === true) {
        // Committed before any state exists: a payload that cannot be sent leaves no window behind.
        this.#deps.commit(name, payload, { owned: false })
        this.#open(name, policy, undefined)
      } else {
        this.#open(name, policy, { payload: copyPayload(name, payload, 'merged'), count: 1 })
      }
      return
    }
    window.pending = this.#fold(name, window, payload)
  }

  /**
   * Commits what is pending now (for one event or all) and ends the windows, so the next emit
   * starts a fresh one. Every event is attempted; the first failure is rethrown afterwards.
   */
  flush(name?: string): void {
    const names = name === undefined ? [...this.#windows.keys()] : [name]
    let failure: { error: unknown } | undefined
    for (const target of names) {
      const window = this.#windows.get(target)
      if (window === undefined) continue
      window.cancel()
      this.#windows.delete(target)
      if (window.pending === undefined) continue
      try {
        this.#send(target, window.pending)
      } catch (error) {
        failure ??= { error }
      }
    }
    if (failure !== undefined) throw failure.error
  }

  /** Cancels every timer and forgets what is pending. Flush first to keep it. */
  dispose(): void {
    for (const window of this.#windows.values()) window.cancel()
    this.#windows.clear()
  }

  #fold(name: string, window: Window, payload: unknown): Pending {
    const next = copyPayload(name, payload, 'merged')
    const current = window.pending
    if (current === undefined) return { payload: next, count: 1 }
    const { strategy } = window.policy
    if (strategy === 'latest') return { payload: next, count: current.count + 1 }
    const merged = strategy(current.payload, next)
    this.#deps.validate?.(name, merged)
    return { payload: merged, count: current.count + 1 }
  }

  #send(name: string, pending: Pending): void {
    this.#deps.commit(name, pending.payload, { owned: true, ...(pending.count >= 2 ? { coalesced: pending.count } : {}) })
  }

  #open(name: string, policy: CoalescePolicy<unknown>, pending: Pending | undefined): void {
    const window: Window = { policy, pending, cancel: () => undefined }
    window.cancel = this.#deps.after(policy.windowMs, () => this.#end(name, window))
    this.#windows.set(name, window)
  }

  /** The window ran out. Runs on a timer, so nothing may throw out of it. */
  #end(name: string, window: Window): void {
    if (this.#windows.get(name) !== window) return // flushed or disposed meanwhile
    this.#windows.delete(name)
    const pending = window.pending
    if (pending === undefined) return
    try {
      this.#send(name, pending)
    } catch (error) {
      this.#deps.onError(error)
    } finally {
      // A leading event stays rate limited after the trailing send.
      if (window.policy.leading === true) this.#open(name, window.policy, undefined)
    }
  }
}
