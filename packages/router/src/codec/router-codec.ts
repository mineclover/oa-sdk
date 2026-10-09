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
    return mediaType.split(';', 1)[0]!.trim().toLowerCase()
  }
}

/**
 * Negotiates outgoing media type based on Accept header and declared response types.
 */
export function negotiateResponseMediaType(
  acceptHeader: string | null | undefined,
  declaredTypes: readonly string[] = [],
  supportedCodecs?: RouterCodecRegistry,
): string {
  if (!acceptHeader) {
    return declaredTypes[0] ?? 'application/json'
  }

  const accepted = acceptHeader
    .split(',')
    .map(s => s.split(';', 1)[0]!.trim().toLowerCase())
    .filter(Boolean)

  for (const acc of accepted) {
    if (acc === '*/*') continue
    if (declaredTypes.some(d => d.toLowerCase() === acc)) {
      return acc
    }
    if (supportedCodecs?.has(acc)) {
      return acc
    }
  }

  return declaredTypes[0] ?? 'application/json'
}
