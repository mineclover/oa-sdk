/**
 * Receiving side of attention requests. It owns the page's policy: what a peer may ask for, how
 * often, and which effect fits the page's current state (the user's table of "in front → toast,
 * another tab → blink, asked to return → focus, important and permitted → notification").
 */
import { BridgeError } from '../protocol/errors.js'
import { browserAttentionSurface, type AttentionSurface } from './surface.js'
import {
  parseAttentionRequest,
  type AttentionEffect,
  type AttentionResult,
  type AttentionSkipReason,
  type AttentionVisibility,
  type AttentionWireRequest,
} from './types.js'

/** Who is asking: the link the request arrived on. */
export type AttentionSource = {
  sessionId: string
  /** `host` when the sender is this page's host, `popup` when it is a popup this page opened. */
  role: 'host' | 'popup'
  origin: string | undefined
}

export type AttentionOptions = {
  /** Defaults to the browser's `window`, resolved on first use so importing stays SSR-safe. */
  surface?: AttentionSurface
  /** Effects a peer may trigger. Default: all of them. */
  allow?: readonly AttentionEffect[]
  /** Refuse a request outright, e.g. for a link the user did not choose to trust. */
  authorize?: (request: AttentionWireRequest, source: AttentionSource) => boolean | Promise<boolean>
  /** Replace the default choice of effects. Return the effects to try, in order. */
  select?: (request: AttentionWireRequest, context: { visibility: AttentionVisibility; defaults: readonly AttentionEffect[] }) => readonly AttentionEffect[]
  /** The page's own UI (a toast, a badge). Called for the `toast` effect. */
  onAttention?: (request: AttentionWireRequest, context: { visibility: AttentionVisibility; source: AttentionSource }) => void
  /** Every effect fires at most once per this interval. Default 1 000 ms. */
  minIntervalMs?: number
  /** Requests accepted per minute across all peers. Default 30. */
  maxRequestsPerMinute?: number
  /** Title alternation period of `blink`. Default 1 000 ms. */
  blinkIntervalMs?: number
  /** How long to wait before reading back whether `focus` worked. Default 100 ms. */
  focusSettleMs?: number
}

export interface AttentionManager {
  /**
   * Validates, authorizes and applies a request. `acknowledge` is called with the request id once
   * the user has seen it (immediately if the page is already in front).
   */
  handle(params: unknown, source: AttentionSource, acknowledge?: (id: string) => void): Promise<AttentionResult>
  /** Requests shown but not yet seen by the user. */
  readonly pending: number
  /** Stops blinking and marks, and acknowledges everything pending. Called when the page is activated. */
  acknowledgeAll(): void
  dispose(): void
}

const ALL_EFFECTS: readonly AttentionEffect[] = ['focus', 'blink', 'notification', 'toast']
const DEFAULTS = { minIntervalMs: 1_000, maxRequestsPerMinute: 30, blinkIntervalMs: 1_000, focusSettleMs: 100 }

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** The effects an intent asks for, before the page's state narrows them down. */
function defaultEffects(request: AttentionWireRequest): AttentionEffect[] {
  switch (request.intent ?? 'info') {
    case 'return':
      return ['focus', 'blink']
    case 'input-needed':
      return ['toast', 'blink', 'notification']
    default:
      // `info` and `completed`: a system notification only when the sender marks it important.
      return request.urgency === 'high' ? ['toast', 'blink', 'notification'] : ['toast', 'blink']
  }
}

export function createAttentionManager(options: AttentionOptions = {}): AttentionManager {
  let surface = options.surface
  const allow = new Set(options.allow ?? ALL_EFFECTS)
  const minIntervalMs = options.minIntervalMs ?? DEFAULTS.minIntervalMs
  const maxPerMinute = options.maxRequestsPerMinute ?? DEFAULTS.maxRequestsPerMinute
  const blinkIntervalMs = options.blinkIntervalMs ?? DEFAULTS.blinkIntervalMs
  const focusSettleMs = options.focusSettleMs ?? DEFAULTS.focusSettleMs

  const lastApplied = new Map<AttentionEffect, number>()
  const recent: number[] = []
  const waiting = new Map<string, (id: string) => void>()
  let blinkTimer: ReturnType<typeof setInterval> | undefined
  let originalTitle: string | undefined
  let unsubscribeActivate: (() => void) | undefined
  let disposed = false

  const surfaceNow = (): AttentionSurface => (surface ??= browserAttentionSurface())

  function stopMarks(): void {
    if (blinkTimer !== undefined) {
      clearInterval(blinkTimer)
      blinkTimer = undefined
    }
    if (originalTitle !== undefined) {
      surfaceNow().setTitle(originalTitle)
      originalTitle = undefined
      surfaceNow().setMark(false)
    }
  }

  function acknowledgeAll(): void {
    stopMarks()
    const callbacks = [...waiting]
    waiting.clear()
    unsubscribeActivate?.()
    unsubscribeActivate = undefined
    for (const [id, acknowledge] of callbacks) acknowledge(id)
  }

  function watchActivation(): void {
    unsubscribeActivate ??= surfaceNow().onActivate(acknowledgeAll)
  }

  function startBlink(label: string): void {
    const page = surfaceNow()
    if (blinkTimer === undefined) originalTitle = page.getTitle()
    else clearInterval(blinkTimer)
    const base = originalTitle ?? page.getTitle()
    let alternate = true
    page.setTitle(`● ${label}`)
    page.setMark(true)
    blinkTimer = setInterval(() => {
      page.setTitle(alternate ? base : `● ${label}`)
      alternate = !alternate
    }, blinkIntervalMs)
  }

  function admitted(now: number): boolean {
    while (recent.length > 0 && now - recent[0]! >= 60_000) recent.shift()
    if (recent.length >= maxPerMinute) return false
    recent.push(now)
    return true
  }

  function refuse(id: string, reason: NonNullable<AttentionResult['reason']>, visibility?: AttentionVisibility): AttentionResult {
    return { id, accepted: false, appliedEffects: [], skipped: [], ...(visibility === undefined ? {} : { visibility }), reason }
  }

  async function handle(params: unknown, source: AttentionSource, acknowledge?: (id: string) => void): Promise<AttentionResult> {
    const request = parseAttentionRequest(params)
    if (disposed) return refuse(request.id, 'unsupported')
    const page = surfaceNow()
    const visibility = page.visibility()

    let permitted: boolean
    try {
      permitted = (await options.authorize?.(request, source)) !== false
    } catch (error) {
      throw new BridgeError('INTERNAL', 'Attention authorization failed', { cause: error })
    }
    if (!permitted) return refuse(request.id, 'denied', visibility)
    if (!admitted(Date.now())) return refuse(request.id, 'rate-limited', visibility)

    const defaults = request.effects ?? defaultEffects(request)
    const chosen = options.select?.(request, { visibility, defaults }) ?? defaults
    const applied: AttentionEffect[] = []
    const skipped: AttentionResult['skipped'] = []
    const skip = (effect: AttentionEffect, reason: AttentionSkipReason) => skipped.push({ effect, reason })
    let focusObserved: boolean | undefined
    let shown = false

    for (const effect of new Set(chosen)) {
      if (!allow.has(effect)) {
        skip(effect, 'not-allowed')
        continue
      }
      const now = Date.now()
      const previous = lastApplied.get(effect)
      if (previous !== undefined && now - previous < minIntervalMs) {
        skip(effect, 'rate-limited')
        continue
      }
      // A previous effect (focus) may have brought the page forward; judge each effect on current state.
      const current = effect === 'toast' ? visibility : page.visibility()
      if (effect !== 'toast' && current === 'focused') {
        skip(effect, 'not-needed')
        continue
      }
      if (effect === 'focus') {
        page.focus()
        lastApplied.set(effect, now)
        applied.push(effect)
        await delay(focusSettleMs)
        focusObserved = page.visibility() === 'focused'
      } else if (effect === 'blink') {
        startBlink(request.title ?? request.message ?? 'Needs your attention')
        lastApplied.set(effect, now)
        applied.push(effect)
        shown = true
      } else if (effect === 'notification') {
        if (!page.notify({ title: request.title ?? 'Needs your attention', ...(request.message === undefined ? {} : { body: request.message }), tag: source.sessionId })) {
          skip(effect, 'unsupported')
          continue
        }
        lastApplied.set(effect, now)
        applied.push(effect)
        shown = true
      } else {
        if (options.onAttention === undefined) {
          skip(effect, 'unsupported')
          continue
        }
        options.onAttention(request, { visibility, source })
        lastApplied.set(effect, now)
        applied.push(effect)
        shown = true
      }
    }

    if (acknowledge !== undefined) {
      if (page.visibility() === 'focused') acknowledge(request.id)
      else if (shown || applied.includes('focus')) {
        waiting.set(request.id, acknowledge)
        watchActivation()
      }
    }
    return {
      id: request.id,
      accepted: true,
      appliedEffects: applied,
      skipped,
      ...(focusObserved === undefined ? {} : { focusObserved }),
      visibility,
    }
  }

  return {
    handle,
    get pending() {
      return waiting.size
    },
    acknowledgeAll,
    dispose() {
      disposed = true
      stopMarks()
      unsubscribeActivate?.()
      unsubscribeActivate = undefined
      waiting.clear()
    },
  }
}
