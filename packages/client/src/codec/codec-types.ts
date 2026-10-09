/**
 * Binary Codec Adapter Pattern for wire serialization, RPC, and compression.
 *
 * Provides a decoupled interface for pluggable binary formats:
 * - Protocol Buffers (application/x-protobuf, application/vnd.google.protobuf)
 * - MessagePack (application/msgpack, application/x-msgpack)
 * - Custom binary / CBOR / FlatBuffers (application/octet-stream, application/cbor)
 *
 * @oa-sdk/client
 */

/**
 * Wire payload body types accepted by fetch implementations across Browser, Node, Bun, and Workers.
 */
export type BinaryBodyInit =
  | Uint8Array
  | ArrayBuffer
  | Blob
  | FormData
  | URLSearchParams
  | string
  | null
  | undefined

export interface BinaryCodecAdapter<T = unknown> {
  /**
   * One or more MIME media types supported by this codec.
   * E.g. ['application/x-protobuf', 'application/protobuf'] or ['application/msgpack']
   */
  readonly mediaTypes: readonly string[]

  /**
   * Serializes high-level typed data into wire binary format.
   * Can return Uint8Array, ArrayBuffer, Blob, or other valid body types.
   */
  encode(payload: T, mediaType?: string): BinaryBodyInit | Promise<BinaryBodyInit>

  /**
   * Deserializes wire binary buffer into high-level typed data.
   */
  decode(raw: ArrayBufferLike | Uint8Array, mediaType?: string): T | Promise<T>
}

/**
 * Registry holding and resolving binary codecs by media type.
 */
export class BinaryCodecRegistry {
  private readonly codecs = new Map<string, BinaryCodecAdapter>()

  constructor(codecs?: Record<string, BinaryCodecAdapter> | readonly BinaryCodecAdapter[]) {
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

  /**
   * Registers a codec adapter. If explicitMediaType is given, it is indexed under that type
   * as well as the codec's declared mediaTypes.
   */
  register(codec: BinaryCodecAdapter, explicitMediaType?: string): this {
    if (explicitMediaType) {
      this.codecs.set(this.normalize(explicitMediaType), codec)
    }
    for (const mt of codec.mediaTypes) {
      this.codecs.set(this.normalize(mt), codec)
    }
    return this
  }

  /**
   * Resolves a registered codec by incoming or outgoing media type.
   * Strips parameters such as charset and normalizes case.
   */
  resolve(mediaType: string | null | undefined): BinaryCodecAdapter | undefined {
    if (!mediaType) return undefined
    const normalized = this.normalize(mediaType)
    return this.codecs.get(normalized)
  }

  /** Checks whether a codec is registered for the specified media type */
  has(mediaType: string): boolean {
    return this.codecs.has(this.normalize(mediaType))
  }

  /** All registered media types */
  get registeredMediaTypes(): string[] {
    return Array.from(this.codecs.keys())
  }

  /** Returns record representation */
  toRecord(): Record<string, BinaryCodecAdapter> {
    const res: Record<string, BinaryCodecAdapter> = {}
    for (const [key, val] of this.codecs.entries()) {
      res[key] = val
    }
    return res
  }

  private normalize(mediaType: string): string {
    return mediaType.split(';', 1)[0]!.trim().toLowerCase()
  }
}
