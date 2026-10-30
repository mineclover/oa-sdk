/**
 * Optional protocol features.
 *
 * The protocol version (`1.0`) says which messages exist; features say which *optional behaviors*
 * a peer implements on top of it. Each side advertises the features it offers during the
 * handshake and both use only the intersection, so a newer peer stays compatible with an older
 * one that has never heard of a feature: the older peer simply does not list it.
 *
 *   popup  HELLO{features: popupOffer}
 *   host   CONNECT{features: hostOffer ∩ popupOffer}
 *   popup  effective = popupOffer ∩ connect.features        READY{features: effective}
 *   host   effective = (hostOffer ∩ popupOffer) ∩ ready.features
 *
 * A feature carries no authority: it never widens what a peer may call. `features` members are
 * optional on the wire, so a peer that omits them (or sends garbage) is treated as offering none.
 */

/** A bounded per-event buffer lets a subscriber recover missed events instead of only a snapshot. */
export const FEATURE_EVENTS_REPLAY = 'events.replay'
/** The popup may merge high-frequency events inside a window before sending them. */
export const FEATURE_EVENTS_COALESCE = 'events.coalesce'

/** What a peer offers unless told otherwise. Features are appended here as their behavior ships. */
export const DEFAULT_FEATURES: readonly string[] = [FEATURE_EVENTS_REPLAY, FEATURE_EVENTS_COALESCE]

/** Upper bound on the features of one peer; the excess of a hostile message is ignored. */
export const MAX_FEATURES = 64

/** How far into an untrusted list {@link normalizeFeatures} reads: room for junk, not for a flood. */
const MAX_SCANNED_ENTRIES = 4 * MAX_FEATURES
const MAX_FEATURE_ID_LENGTH = 64
const FEATURE_ID = /^[a-z][a-zA-Z0-9]*([.-][a-zA-Z0-9]+)*$/

/** The features agreed for one connection. */
export interface FeatureSet {
  has(id: string): boolean
  /** In the order they were offered; stable across calls. */
  readonly ids: readonly string[]
  readonly size: number
}

/** The agreed set of a connection that has not finished its handshake, or of a legacy peer. */
export const NO_FEATURES: FeatureSet = createFeatureSet([])

/** Builds an immutable set; repeats are dropped, the first occurrence fixes the order. */
export function createFeatureSet(ids: Iterable<string>): FeatureSet {
  const unique = Object.freeze([...new Set(ids)])
  const lookup: ReadonlySet<string> = new Set(unique)
  return Object.freeze({
    has: (id: string) => lookup.has(id),
    ids: unique,
    size: unique.length,
  })
}

/**
 * `lowerCamel` segments joined by `.` or `-` (`events.replay`, `x.custom-thing`), at most 64
 * characters. Applications use an `x.` prefix for their own features.
 */
export function isFeatureId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_FEATURE_ID_LENGTH && FEATURE_ID.test(value)
}

/**
 * Strict validation for options a developer wrote: throws a `TypeError` naming the first bad id.
 * Repeats are harmless and accepted.
 */
export function assertFeatureIds(value: unknown): asserts value is readonly string[] {
  if (!Array.isArray(value)) throw new TypeError('features must be an array of feature ids')
  if (value.length > MAX_FEATURES) throw new TypeError(`features lists ${value.length} ids; the limit is ${MAX_FEATURES}`)
  for (const id of value as unknown[]) {
    if (!isFeatureId(id)) {
      throw new TypeError(`Invalid feature id ${typeof id === 'string' ? `"${id}"` : String(id)}: use dotted lowerCamel names such as "events.replay" or "x.myFeature" (at most ${MAX_FEATURE_ID_LENGTH} characters)`)
    }
  }
}

/**
 * Lenient reading of an untrusted `features` member: never throws, drops anything that is not a
 * valid id, removes repeats and keeps at most {@link MAX_FEATURES}. Only the first
 * {@link MAX_SCANNED_ENTRIES} entries are looked at: a sparse array claims any length for a few
 * bytes, so the work must not follow `length`.
 */
export function normalizeFeatures(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const scanned = Math.min(value.length, MAX_SCANNED_ENTRIES)
  for (let index = 0; index < scanned && seen.size < MAX_FEATURES; index += 1) {
    const id: unknown = value[index]
    if (isFeatureId(id)) seen.add(id)
  }
  return [...seen]
}

/**
 * The features both sides offer, in the order of `ours`. `theirs` is `undefined` for a peer that
 * sent no `features` member at all, which means it offers none.
 */
export function negotiateFeatures(ours: readonly string[], theirs: readonly string[] | undefined): string[] {
  if (theirs === undefined || theirs.length === 0) return []
  const offered = new Set(theirs)
  return [...new Set(ours)].filter(id => offered.has(id))
}

/**
 * True when `method` belongs to a feature this connection did not agree on. Such a method answers
 * `METHOD_NOT_FOUND`, exactly like it would on a peer that never implemented it.
 */
export function isFeatureGated(method: string, gates: Readonly<Record<string, string>>, features: FeatureSet): boolean {
  if (!Object.hasOwn(gates, method)) return false
  const required = gates[method]
  return required !== undefined && !features.has(required)
}
