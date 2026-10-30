/**
 * Attention requests: one window asks the window on the other end of a bridge link to draw the
 * user's eye. The sender states what happened (`intent`); the receiver decides how to show it,
 * because only it knows whether the page is in front, which notifications the user allowed and
 * how much focus stealing is acceptable.
 */
import { BridgeError } from '../protocol/errors.js'

/** Reserved method a receiving window answers when it has an attention manager. */
export const ATTENTION_METHOD = 'bridge.attention'
/** Notification sent back to the requester once the user has seen the request. */
export const ATTENTION_ACK_METHOD = 'bridge.attention.ack'

/**
 * How a request can be shown. `focus` asks the browser to raise the window, `blink` alternates the
 * tab title and marks the favicon, `notification` raises a system notification (only when the user
 * granted permission) and `toast` hands the request to the page's own UI.
 */
export type AttentionEffect = 'focus' | 'blink' | 'notification' | 'toast'

/**
 * What the sender wants the user to know.
 * `info` is passive, `completed` reports finished work, `input-needed` waits for the user and
 * `return` asks the user to come back to the receiving window.
 */
export type AttentionIntent = 'info' | 'completed' | 'input-needed' | 'return'

export type AttentionUrgency = 'normal' | 'high'

export type AttentionRequest = {
  /** Default `info`. */
  intent?: AttentionIntent
  /** Effects the sender would like; the receiver intersects them with what it allows. */
  effects?: readonly AttentionEffect[]
  title?: string
  message?: string
  /** `high` also makes the receiver consider a system notification. Default `normal`. */
  urgency?: AttentionUrgency
}

/** Where the receiving page stands: in front, visible but unfocused, or not visible at all. */
export type AttentionVisibility = 'focused' | 'visible' | 'hidden'

export type AttentionSkipReason =
  /** The receiver's policy does not allow the effect. */
  | 'not-allowed'
  /** The effect fired too recently. */
  | 'rate-limited'
  /** The environment cannot do it, e.g. notifications without permission. */
  | 'unsupported'
  /** The page is already in front, so the effect would add nothing. */
  | 'not-needed'

export type AttentionResult = {
  id: string
  /** False when the request was refused outright (`reason`) and nothing was shown. */
  accepted: boolean
  appliedEffects: AttentionEffect[]
  skipped: { effect: AttentionEffect; reason: AttentionSkipReason }[]
  /** After a `focus` effect: whether the window really was in front shortly afterwards. */
  focusObserved?: boolean
  /** The receiver's visibility when the request arrived; absent when it never got that far. */
  visibility?: AttentionVisibility
  /** Present when `accepted` is false. */
  reason?: 'denied' | 'rate-limited' | 'unsupported'
}

const EFFECTS: readonly AttentionEffect[] = ['focus', 'blink', 'notification', 'toast']
const INTENTS: readonly AttentionIntent[] = ['info', 'completed', 'input-needed', 'return']
const URGENCIES: readonly AttentionUrgency[] = ['normal', 'high']

const MAX_TITLE = 120
const MAX_MESSAGE = 500

/** A request as it travels on the wire: the sender's request plus the id its acknowledgement carries. */
export type AttentionWireRequest = AttentionRequest & { id: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(message: string): never {
  throw new BridgeError('INVALID_PARAMS', message)
}

function text(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return invalid(`${field} must be a string`)
  // Text comes from another origin: cap it so it cannot flood a title bar or a notification.
  return value.length > max ? value.slice(0, max) : value
}

/** The peer is untrusted; unknown fields are dropped and every known one is checked. */
export function parseAttentionRequest(params: unknown): AttentionWireRequest {
  if (!isRecord(params)) return invalid('params must be an attention request object')
  const { id, intent, effects, urgency } = params
  if (typeof id !== 'string' || id.length === 0 || id.length > 128) return invalid('id must be a non-empty string')
  if (intent !== undefined && !INTENTS.includes(intent as AttentionIntent)) return invalid(`intent must be one of ${INTENTS.join(', ')}`)
  if (urgency !== undefined && !URGENCIES.includes(urgency as AttentionUrgency)) return invalid(`urgency must be one of ${URGENCIES.join(', ')}`)
  if (effects !== undefined && (!Array.isArray(effects) || !effects.every(effect => EFFECTS.includes(effect as AttentionEffect)))) {
    return invalid(`effects must be a list of ${EFFECTS.join(', ')}`)
  }
  const title = text(params.title, 'title', MAX_TITLE)
  const message = text(params.message, 'message', MAX_MESSAGE)
  return {
    id,
    ...(intent === undefined ? {} : { intent: intent as AttentionIntent }),
    ...(effects === undefined ? {} : { effects: [...new Set(effects as AttentionEffect[])] }),
    ...(title === undefined ? {} : { title }),
    ...(message === undefined ? {} : { message }),
    ...(urgency === undefined ? {} : { urgency: urgency as AttentionUrgency }),
  }
}
