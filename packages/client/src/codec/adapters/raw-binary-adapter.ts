/**
 * Raw binary passthrough codec adapter for application/octet-stream and generic byte streams.
 */

import type { BinaryCodecAdapter, BinaryBodyInit } from '../codec-types.js'

export class RawBinaryAdapter implements BinaryCodecAdapter<Uint8Array | ArrayBuffer | Blob> {
  public readonly mediaTypes: readonly string[]

  constructor(mediaTypes: readonly string[] = ['application/octet-stream', 'application/binary']) {
    this.mediaTypes = mediaTypes
  }

  encode(data: Uint8Array | ArrayBuffer | Blob): BinaryBodyInit {
    if (data instanceof Uint8Array || data instanceof ArrayBuffer || (typeof Blob !== 'undefined' && data instanceof Blob)) {
      return data
    }
    throw new TypeError('RawBinaryAdapter requires Uint8Array, ArrayBuffer, or Blob data')
  }

  decode(raw: ArrayBufferLike | Uint8Array): Uint8Array {
    return raw instanceof Uint8Array ? raw : new Uint8Array(raw)
  }
}

export function createRawBinaryAdapter(mediaTypes?: readonly string[]): BinaryCodecAdapter<Uint8Array | ArrayBuffer | Blob> {
  return new RawBinaryAdapter(mediaTypes)
}
