/**
 * Protocol Buffers adapter factory.
 *
 * Wraps any Protobuf encoder/decoder (Typia AOT, @bufbuild/protobuf, protobufjs, ts-proto)
 * into a standardized BinaryCodecAdapter.
 */

import type { BinaryCodecAdapter, BinaryBodyInit } from '../codec-types.js'

export interface ProtobufAdapterOptions<T = unknown> {
  /**
   * One or more media types to bind.
   * Default: ['application/x-protobuf', 'application/protobuf', 'application/vnd.google.protobuf']
   */
  readonly mediaTypes?: readonly string[] | undefined

  /**
   * Function converting high-level typed data into a binary Uint8Array or ArrayBuffer.
   */
  encode(data: T): Uint8Array | ArrayBuffer | Promise<Uint8Array | ArrayBuffer>

  /**
   * Function converting raw binary buffer into high-level typed data.
   */
  decode(raw: Uint8Array | ArrayBufferLike): T | Promise<T>
}

export class ProtobufAdapter<T = unknown> implements BinaryCodecAdapter<T> {
  public readonly mediaTypes: readonly string[]
  private readonly encoder: (data: T) => Uint8Array | ArrayBuffer | Promise<Uint8Array | ArrayBuffer>
  private readonly decoder: (raw: Uint8Array | ArrayBufferLike) => T | Promise<T>

  constructor(options: ProtobufAdapterOptions<T>) {
    this.mediaTypes = options.mediaTypes ?? [
      'application/x-protobuf',
      'application/protobuf',
      'application/vnd.google.protobuf',
    ]
    this.encoder = options.encode
    this.decoder = options.decode
  }

  async encode(data: T): Promise<BinaryBodyInit> {
    const res = await this.encoder(data)
    return res instanceof Uint8Array ? res : new Uint8Array(res)
  }

  async decode(raw: ArrayBufferLike | Uint8Array): Promise<T> {
    return await this.decoder(raw)
  }
}

/**
 * Creates a pluggable Protobuf binary codec adapter.
 *
 * Example with Typia:
 *   const userCodec = createProtobufAdapter<User>({
 *     encode: typia.protobuf.createEncode<User>(),
 *     decode: typia.protobuf.createDecode<User>(),
 *   })
 *
 * Example with protobufjs:
 *   const userCodec = createProtobufAdapter<User>({
 *     encode: (data) => UserMessage.encode(data).finish(),
 *     decode: (raw) => UserMessage.decode(new Uint8Array(raw)) as User,
 *   })
 */
export function createProtobufAdapter<T = unknown>(options: ProtobufAdapterOptions<T>): BinaryCodecAdapter<T> {
  return new ProtobufAdapter<T>(options)
}
