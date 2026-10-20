/**
 * Backend Router Wire Codec & Compression Support
 *
 * Provides server-side binary serialization, RPC payload decoding,
 * and content-type negotiation across Hono, Express, Fastify, and Elysia.
 *
 * @oa-sdk/router
 */

export interface RouterCodecAdapter<T = unknown> {
  readonly mediaTypes: readonly string[]
  encode(data: T, mediaType?: string): Uint8Array | ArrayBuffer | Promise<Uint8Array | ArrayBuffer>
  decode(raw: ArrayBufferLike | Uint8Array, mediaType?: string): T | Promise<T>
}

export class RouterCodecRegistry {
  private readonly codecs = new Map<string, RouterCodecAdapter>()

  constructor(codecs?: Record<string, RouterCodecAdapter> | readonly RouterCodecAdapter[]) {
    if (codecs) {
      if (Array.isArray(codecs)) {
        for (const codec of codecs) {
          this.register(codec)
        }
      } else {
        for (const [key, codec] of Object.entries(codecs)) {
          this.register(codec, key)
        }
      }
    }
  }

  register(codec: RouterCodecAdapter, explicitMediaType?: string): this {
    if (explicitMediaType) {
      this.codecs.set(this.normalize(explicitMediaType), codec)
    }
    for (const mt of codec.mediaTypes ?? []) {
      this.codecs.set(this.normalize(mt), codec)
    }
    return this
  }

  resolve(mediaType: string | null | undefined): RouterCodecAdapter | undefined {
    if (!mediaType) return undefined
    return this.codecs.get(this.normalize(mediaType))
  }

  has(mediaType: string): boolean {
    return this.codecs.has(this.normalize(mediaType))
  }

  get registeredMediaTypes(): string[] {
    return Array.from(this.codecs.keys())
  }

  private normalize(mediaType: string): string {
    return normalizeMediaType(mediaType)
  }
}

/** The `type/subtype` part of a media type, lowercased and without parameters; used for matching only. */
function normalizeMediaType(mediaType: string): string {
  return mediaType.split(';', 1)[0]!.trim().toLowerCase()
}

/** One media range of an Accept header (RFC 9110 §12.5.1). */
interface AcceptedRange {
  /** `type/subtype`, a `type/*` range, or the full wildcard; lowercased and without parameters. */
  range: string
  q: number
  /** 2 for `type/subtype`, 1 for a `type/*` range, 0 for the full wildcard. */
  specificity: number
  index: number
}

function parseAccept(header: string): AcceptedRange[] {
  const ranges: AcceptedRange[] = []
  header.split(',').forEach((entry, index) => {
    const [rawRange = '', ...params] = entry.split(';')
    const range = rawRange.trim().toLowerCase()
    const slash = range.indexOf('/')
    if (slash <= 0 || slash === range.length - 1) return
    let q = 1
    for (const param of params) {
      const [name = '', value = ''] = param.split('=', 2).map(part => part.trim())
      if (name.toLowerCase() !== 'q') continue
      const parsed = Number(value)
      // A malformed weight is ignored (the range keeps the default weight of 1).
      if (value !== '' && Number.isFinite(parsed)) q = Math.min(1, Math.max(0, parsed))
    }
    const specificity = range === '*/*' ? 0 : range.endsWith('/*') ? 1 : 2
    ranges.push({ range, q, specificity, index })
  })
  return ranges
}

function rangeMatches(entry: AcceptedRange, mediaType: string): boolean {
  if (entry.specificity === 2) return entry.range === mediaType
  // `type/*` keeps its `type/` prefix; the full wildcard matches every type.
  return entry.specificity === 0 || mediaType.startsWith(entry.range.slice(0, -1))
}

/**
 * The Accept range that sets the weight of `mediaType`: the most specific matching range, and on a
 * specificity tie (the same range listed twice) the higher weight, then the earlier entry.
 * `undefined` when no range matches, i.e. the client did not name the type at all.
 */
function governingRange(accepted: readonly AcceptedRange[], mediaType: string): AcceptedRange | undefined {
  let governing: AcceptedRange | undefined
  for (const entry of accepted) {
    if (!rangeMatches(entry, mediaType)) continue
    if (
      governing === undefined
      || entry.specificity > governing.specificity
      || (entry.specificity === governing.specificity && entry.q > governing.q)
    ) {
      governing = entry
    }
  }
  return governing
}

/** Orders the governing ranges of two acceptable types: higher weight, then more specific, then earlier. */
function compareAcceptable(left: AcceptedRange, right: AcceptedRange): number {
  return right.q - left.q || right.specificity - left.specificity || left.index - right.index
}

/**
 * Negotiates the outgoing media type from the Accept header, the declared response media types,
 * and the media types of the registered codecs.
 *
 * The server's types are ranked, not the Accept entries (RFC 9110 §12.5.1). The candidates are the
 * declared types in order (`application/json` when none are declared), then the codec media types.
 * Each candidate takes its weight from the most specific Accept range that matches it: the exact
 * `type/subtype`, then a `type/*` range, then the full wildcard. So `application/json;q=0.1`
 * next to a full wildcard ranks JSON below every other type, and a range with `q=0` refuses every
 * type it governs, including a `type/*` range or the full wildcard with `q=0` when nothing more
 * specific names the type. The candidate with the highest weight wins; ties go to the more
 * specific matching range, then the earlier Accept entry, then the server's order.
 *
 * When no candidate is acceptable, the first declared type that no Accept range refused is
 * returned (the caller decides whether to answer 406), then the first declared type, then
 * `application/json`.
 *
 * Types are compared by their lowercased `type/subtype` without parameters, but a declared type is
 * returned exactly as the caller passed it (`text/plain; charset=utf-8` stays intact), the same
 * string the no-Accept path returns. When two declared types share a `type/subtype`, the first one
 * is returned. A type only a codec serves is returned as its registry key, i.e. normalized.
 */
export function negotiateResponseMediaType(
  acceptHeader: string | null | undefined,
  declaredTypes: readonly string[] = [],
  supportedCodecs?: RouterCodecRegistry,
): string {
  if (!acceptHeader) {
    return declaredTypes[0] ?? 'application/json'
  }

  const accepted = parseAccept(acceptHeader)
  // Normalized form for matching -> the first declared string with that form, returned as given.
  const original = new Map<string, string>()
  for (const type of declaredTypes) {
    const normalized = normalizeMediaType(type)
    if (!original.has(normalized)) original.set(normalized, type)
  }
  const declared = [...original.keys()]
  const served = declared.length > 0 ? declared : ['application/json']
  // Every type the server can answer with, in its order of preference.
  const pool = [...new Set([...served, ...(supportedCodecs?.registeredMediaTypes ?? []).map(normalizeMediaType)])]
  const governing = new Map(pool.map(type => [type, governingRange(accepted, type)] as const))

  let best: { type: string; range: AcceptedRange } | undefined
  for (const type of pool) {
    const range = governing.get(type)
    if (range === undefined || range.q === 0) continue
    // `pool` is in server order, so only a strictly better candidate replaces the current one.
    if (best === undefined || compareAcceptable(range, best.range) < 0) best = { type, range }
  }
  const chosen = best?.type ?? served.find(type => governing.get(type)?.q !== 0) ?? served[0] ?? 'application/json'
  return original.get(chosen) ?? chosen
}
