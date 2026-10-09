/**
 * Zero-dependency pure TypeScript MessagePack codec adapter.
 *
 * Implements binary JSON packing according to the MessagePack specification:
 * - Fixint, Uint8/16/32, Int8/16/32, Float64
 * - Fixstr, Str8/16/32 (UTF-8)
 * - Bin8/16/32 (Uint8Array / ArrayBuffer)
 * - Fixarray, Array16/32
 * - Fixmap, Map16/32
 * - Nil, Boolean
 *
 * 100% Zero-eval CSP compliant, operates in all JS runtimes (Browser, Node, Bun, Cloudflare Workers).
 */

import type { BinaryCodecAdapter } from '../codec-types.js'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export class MessagePackAdapter implements BinaryCodecAdapter<unknown> {
  public readonly mediaTypes: readonly string[] = [
    'application/msgpack',
    'application/x-msgpack',
    'application/vnd.msgpack',
  ]

  encode(data: unknown): Uint8Array {
    return encodeMessagePack(data)
  }

  decode(raw: ArrayBufferLike | Uint8Array): unknown {
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
    return decodeMessagePack(bytes)
  }
}

/** Pre-instantiated singleton instance for convenience */
export const messagePackAdapter = new MessagePackAdapter()

/**
 * Encodes a JavaScript value to MessagePack binary Uint8Array.
 */
export function encodeMessagePack(value: unknown): Uint8Array {
  const chunks: Uint8Array[] = []
  packValue(value, chunks)

  let totalLength = 0
  for (const c of chunks) totalLength += c.length

  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const c of chunks) {
    result.set(c, offset)
    offset += c.length
  }
  return result
}

function packValue(value: unknown, chunks: Uint8Array[]): void {
  if (value === null || value === undefined) {
    chunks.push(new Uint8Array([0xc0]))
    return
  }

  if (typeof value === 'boolean') {
    chunks.push(new Uint8Array([value ? 0xc3 : 0xc2]))
    return
  }

  if (typeof value === 'number') {
    packNumber(value, chunks)
    return
  }

  if (typeof value === 'string') {
    packString(value, chunks)
    return
  }

  if (value instanceof Uint8Array) {
    packBinary(value, chunks)
    return
  }

  if (value instanceof ArrayBuffer) {
    packBinary(new Uint8Array(value), chunks)
    return
  }

  if (Array.isArray(value)) {
    packArray(value, chunks)
    return
  }

  if (typeof value === 'object') {
    packObject(value as Record<string, unknown>, chunks)
    return
  }

  // Fallback for unsupported primitives: stringify
  packString(String(value), chunks)
}

function packNumber(n: number, chunks: Uint8Array[]): void {
  if (Number.isInteger(n)) {
    if (n >= 0) {
      if (n <= 0x7f) {
        chunks.push(new Uint8Array([n]))
      } else if (n <= 0xff) {
        chunks.push(new Uint8Array([0xcc, n]))
      } else if (n <= 0xffff) {
        const buf = new Uint8Array(3)
        buf[0] = 0xcd
        new DataView(buf.buffer).setUint16(1, n, false)
        chunks.push(buf)
      } else if (n <= 0xffffffff) {
        const buf = new Uint8Array(5)
        buf[0] = 0xce
        new DataView(buf.buffer).setUint32(1, n, false)
        chunks.push(buf)
      } else {
        packFloat64(n, chunks)
      }
    } else {
      if (n >= -32) {
        chunks.push(new Uint8Array([0xe0 | (n + 32)]))
      } else if (n >= -128) {
        const buf = new Uint8Array(2)
        buf[0] = 0xd0
        new DataView(buf.buffer).setInt8(1, n)
        chunks.push(buf)
      } else if (n >= -32768) {
        const buf = new Uint8Array(3)
        buf[0] = 0xd1
        new DataView(buf.buffer).setInt16(1, n, false)
        chunks.push(buf)
      } else if (n >= -2147483648) {
        const buf = new Uint8Array(5)
        buf[0] = 0xd2
        new DataView(buf.buffer).setInt32(1, n, false)
        chunks.push(buf)
      } else {
        packFloat64(n, chunks)
      }
    }
  } else {
    packFloat64(n, chunks)
  }
}

function packFloat64(n: number, chunks: Uint8Array[]): void {
  const buf = new Uint8Array(9)
  buf[0] = 0xcb
  new DataView(buf.buffer).setFloat64(1, n, false)
  chunks.push(buf)
}

function packString(s: string, chunks: Uint8Array[]): void {
  const bytes = textEncoder.encode(s)
  const len = bytes.length

  if (len <= 31) {
    chunks.push(new Uint8Array([0xa0 | len]))
  } else if (len <= 0xff) {
    chunks.push(new Uint8Array([0xd9, len]))
  } else if (len <= 0xffff) {
    const header = new Uint8Array(3)
    header[0] = 0xda
    new DataView(header.buffer).setUint16(1, len, false)
    chunks.push(header)
  } else {
    const header = new Uint8Array(5)
    header[0] = 0xdb
    new DataView(header.buffer).setUint32(1, len, false)
    chunks.push(header)
  }
  chunks.push(bytes)
}

function packBinary(bytes: Uint8Array, chunks: Uint8Array[]): void {
  const len = bytes.length
  if (len <= 0xff) {
    chunks.push(new Uint8Array([0xc4, len]))
  } else if (len <= 0xffff) {
    const header = new Uint8Array(3)
    header[0] = 0xc5
    new DataView(header.buffer).setUint16(1, len, false)
    chunks.push(header)
  } else {
    const header = new Uint8Array(5)
    header[0] = 0xc6
    new DataView(header.buffer).setUint32(1, len, false)
    chunks.push(header)
  }
  chunks.push(bytes)
}

function packArray(arr: unknown[], chunks: Uint8Array[]): void {
  const len = arr.length
  if (len <= 15) {
    chunks.push(new Uint8Array([0x90 | len]))
  } else if (len <= 0xffff) {
    const header = new Uint8Array(3)
    header[0] = 0xdc
    new DataView(header.buffer).setUint16(1, len, false)
    chunks.push(header)
  } else {
    const header = new Uint8Array(5)
    header[0] = 0xdd
    new DataView(header.buffer).setUint32(1, len, false)
    chunks.push(header)
  }
  for (const item of arr) {
    packValue(item, chunks)
  }
}

function packObject(obj: Record<string, unknown>, chunks: Uint8Array[]): void {
  const entries = Object.entries(obj).filter(([, val]) => val !== undefined)
  const len = entries.length

  if (len <= 15) {
    chunks.push(new Uint8Array([0x80 | len]))
  } else if (len <= 0xffff) {
    const header = new Uint8Array(3)
    header[0] = 0xde
    new DataView(header.buffer).setUint16(1, len, false)
    chunks.push(header)
  } else {
    const header = new Uint8Array(5)
    header[0] = 0xdf
    new DataView(header.buffer).setUint32(1, len, false)
    chunks.push(header)
  }

  for (const [key, val] of entries) {
    packString(key, chunks)
    packValue(val, chunks)
  }
}

/**
 * Decodes MessagePack binary Uint8Array into a JavaScript value.
 */
export function decodeMessagePack(bytes: Uint8Array): unknown {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0

  function readNext(): unknown {
    if (offset >= bytes.length) {
      throw new RangeError('Unexpected end of MessagePack buffer')
    }

    const byte = bytes[offset++]!

    // Positive fixint: 0x00 - 0x7f
    if (byte <= 0x7f) return byte

    // Fixmap: 0x80 - 0x8f
    if (byte >= 0x80 && byte <= 0x8f) {
      const size = byte & 0x0f
      return readMap(size)
    }

    // Fixarray: 0x90 - 0x9f
    if (byte >= 0x90 && byte <= 0x9f) {
      const size = byte & 0x0f
      return readArray(size)
    }

    // Fixstr: 0xa0 - 0xbf
    if (byte >= 0xa0 && byte <= 0xbf) {
      const size = byte & 0x1f
      return readString(size)
    }

    // Negative fixint: 0xe0 - 0xff (-32 to -1)
    if (byte >= 0xe0) {
      return byte - 0x100
    }

    switch (byte) {
      // nil
      case 0xc0:
        return null
      // false
      case 0xc2:
        return false
      // true
      case 0xc3:
        return true

      // bin 8/16/32
      case 0xc4: {
        const size = bytes[offset++]!
        return readBinary(size)
      }
      case 0xc5: {
        const size = view.getUint16(offset, false)
        offset += 2
        return readBinary(size)
      }
      case 0xc6: {
        const size = view.getUint32(offset, false)
        offset += 4
        return readBinary(size)
      }

      // float 32 / float 64
      case 0xca: {
        const val = view.getFloat32(offset, false)
        offset += 4
        return val
      }
      case 0xcb: {
        const val = view.getFloat64(offset, false)
        offset += 8
        return val
      }

      // uint 8/16/32/64
      case 0xcc:
        return bytes[offset++]!
      case 0xcd: {
        const val = view.getUint16(offset, false)
        offset += 2
        return val
      }
      case 0xce: {
        const val = view.getUint32(offset, false)
        offset += 4
        return val
      }
      case 0xcf: {
        const val = Number(view.getBigUint64(offset, false))
        offset += 8
        return val
      }

      // int 8/16/32/64
      case 0xd0: {
        const val = view.getInt8(offset)
        offset += 1
        return val
      }
      case 0xd1: {
        const val = view.getInt16(offset, false)
        offset += 2
        return val
      }
      case 0xd2: {
        const val = view.getInt32(offset, false)
        offset += 4
        return val
      }
      case 0xd3: {
        const val = Number(view.getBigInt64(offset, false))
        offset += 8
        return val
      }

      // str 8/16/32
      case 0xd9: {
        const size = bytes[offset++]!
        return readString(size)
      }
      case 0xda: {
        const size = view.getUint16(offset, false)
        offset += 2
        return readString(size)
      }
      case 0xdb: {
        const size = view.getUint32(offset, false)
        offset += 4
        return readString(size)
      }

      // array 16/32
      case 0xdc: {
        const size = view.getUint16(offset, false)
        offset += 2
        return readArray(size)
      }
      case 0xdd: {
        const size = view.getUint32(offset, false)
        offset += 4
        return readArray(size)
      }

      // map 16/32
      case 0xde: {
        const size = view.getUint16(offset, false)
        offset += 2
        return readMap(size)
      }
      case 0xdf: {
        const size = view.getUint32(offset, false)
        offset += 4
        return readMap(size)
      }

      default:
        throw new TypeError(`Unsupported MessagePack prefix byte: 0x${byte.toString(16)}`)
    }
  }

  function readString(size: number): string {
    const slice = bytes.subarray(offset, offset + size)
    offset += size
    return textDecoder.decode(slice)
  }

  function readBinary(size: number): Uint8Array {
    const slice = bytes.subarray(offset, offset + size)
    offset += size
    return new Uint8Array(slice)
  }

  function readArray(size: number): unknown[] {
    const arr: unknown[] = []
    for (let i = 0; i < size; i++) {
      arr.push(readNext())
    }
    return arr
  }

  function readMap(size: number): Record<string, unknown> {
    const obj: Record<string, unknown> = {}
    for (let i = 0; i < size; i++) {
      const key = String(readNext())
      const val = readNext()
      obj[key] = val
    }
    return obj
  }

  return readNext()
}
