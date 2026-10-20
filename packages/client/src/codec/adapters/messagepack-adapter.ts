/**
 * Zero-dependency pure TypeScript MessagePack codec adapter.
 *
 * Implements binary JSON packing according to the MessagePack specification:
 * - Fixint, Uint8/16/32/64, Int8/16/32/64, Float32/64
 * - Fixstr, Str8/16/32 (UTF-8)
 * - Bin8/16/32 (Uint8Array / ArrayBuffer / any ArrayBuffer view)
 * - Fixarray, Array16/32
 * - Fixmap, Map16/32
 * - Nil, Boolean
 *
 * Encoding follows JSON semantics where MessagePack has no native type: a value with a
 * `toJSON()` method (such as a `Date`) is encoded as that method's result, and `undefined`
 * object properties are omitted. A `bigint` is encoded as an integer (uint64/int64 beyond the
 * safe range). Values with no faithful encoding (symbols, functions, `Map`, `Set`, integers
 * wider than 64 bits) throw instead of being silently changed.
 *
 * Decoding is strict: a truncated buffer, a length prefix that runs past the end, or bytes left
 * after the value throw a `RangeError`. 64-bit integers outside the safe integer range decode to
 * `bigint`, never to a rounded `number`. Map keys are always own data properties, so a
 * `__proto__` key cannot replace the decoded object's prototype.
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

/**
 * @param applyToJSON Whether a `toJSON()` method of `value` is honored. Like `JSON.stringify`,
 *   it is called once per value: the value it returns is encoded as is.
 */
function packValue(value: unknown, chunks: Uint8Array[], applyToJSON = true): void {
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

  if (typeof value === 'bigint') {
    packBigInt(value, chunks)
    return
  }

  if (typeof value === 'string') {
    packString(value, chunks)
    return
  }

  if (typeof value !== 'object') {
    throw new TypeError(`Unsupported MessagePack value type: ${typeof value}`)
  }

  // Binary first: a Node.js Buffer is a Uint8Array whose toJSON() would turn it into an object.
  if (value instanceof Uint8Array) {
    packBinary(value, chunks)
    return
  }

  if (ArrayBuffer.isView(value)) {
    packBinary(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), chunks)
    return
  }

  if (value instanceof ArrayBuffer) {
    packBinary(new Uint8Array(value), chunks)
    return
  }

  if (applyToJSON && hasToJSON(value)) {
    packValue(value.toJSON(), chunks, false)
    return
  }

  if (Array.isArray(value)) {
    packArray(value, chunks)
    return
  }

  if (value instanceof Map || value instanceof Set) {
    throw new TypeError(
      `Cannot encode a ${value instanceof Map ? 'Map' : 'Set'} as MessagePack; convert it to a plain object or an array first`,
    )
  }

  packObject(value, chunks)
}

function hasToJSON(value: object): value is { toJSON(): unknown } {
  return typeof (value as { toJSON?: unknown }).toJSON === 'function'
}

const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER)
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)
const MAX_UINT64 = 0xffff_ffff_ffff_ffffn
const MIN_INT64 = -(2n ** 63n)

function packBigInt(value: bigint, chunks: Uint8Array[]): void {
  if (value >= MIN_SAFE_BIGINT && value <= MAX_SAFE_BIGINT) {
    packNumber(Number(value), chunks)
    return
  }
  const buf = new Uint8Array(9)
  const view = new DataView(buf.buffer)
  if (value > 0n && value <= MAX_UINT64) {
    buf[0] = 0xcf
    view.setBigUint64(1, value, false)
  } else if (value < 0n && value >= MIN_INT64) {
    buf[0] = 0xd3
    view.setBigInt64(1, value, false)
  } else {
    throw new RangeError(`BigInt ${value} does not fit in a 64-bit MessagePack integer`)
  }
  chunks.push(buf)
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

function packObject(obj: object, chunks: Uint8Array[]): void {
  const entries: [string, unknown][] = Object.entries(obj).filter(([, val]) => val !== undefined)
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
 * Decodes one MessagePack value that spans the whole buffer.
 *
 * Throws a `RangeError` when the buffer ends inside the value (including a str/bin/array/map
 * length prefix that claims more bytes than remain) or when bytes are left after it, and a
 * `TypeError` for a prefix byte this codec does not support (such as an extension type).
 */
export function decodeMessagePack(bytes: Uint8Array): unknown {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0

  /** Reserves the next `size` bytes and returns their start offset. */
  function take(size: number): number {
    if (size > bytes.length - offset) {
      throw new RangeError('Unexpected end of MessagePack buffer')
    }
    const start = offset
    offset += size
    return start
  }

  function readNext(): unknown {
    const byte = view.getUint8(take(1))

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
      case 0xc4:
        return readBinary(view.getUint8(take(1)))
      case 0xc5:
        return readBinary(view.getUint16(take(2), false))
      case 0xc6:
        return readBinary(view.getUint32(take(4), false))

      // float 32 / float 64
      case 0xca:
        return view.getFloat32(take(4), false)
      case 0xcb:
        return view.getFloat64(take(8), false)

      // uint 8/16/32/64
      case 0xcc:
        return view.getUint8(take(1))
      case 0xcd:
        return view.getUint16(take(2), false)
      case 0xce:
        return view.getUint32(take(4), false)
      case 0xcf:
        return toSafeInteger(view.getBigUint64(take(8), false))

      // int 8/16/32/64
      case 0xd0:
        return view.getInt8(take(1))
      case 0xd1:
        return view.getInt16(take(2), false)
      case 0xd2:
        return view.getInt32(take(4), false)
      case 0xd3:
        return toSafeInteger(view.getBigInt64(take(8), false))

      // str 8/16/32
      case 0xd9:
        return readString(view.getUint8(take(1)))
      case 0xda:
        return readString(view.getUint16(take(2), false))
      case 0xdb:
        return readString(view.getUint32(take(4), false))

      // array 16/32
      case 0xdc:
        return readArray(view.getUint16(take(2), false))
      case 0xdd:
        return readArray(view.getUint32(take(4), false))

      // map 16/32
      case 0xde:
        return readMap(view.getUint16(take(2), false))
      case 0xdf:
        return readMap(view.getUint32(take(4), false))

      default:
        throw new TypeError(`Unsupported MessagePack prefix byte: 0x${byte.toString(16)}`)
    }
  }

  function readString(size: number): string {
    const start = take(size)
    const slice = bytes.subarray(start, start + size)
    return textDecoder.decode(slice)
  }

  function readBinary(size: number): Uint8Array {
    const start = take(size)
    return bytes.slice(start, start + size)
  }

  function readArray(size: number): unknown[] {
    // Every element takes at least one byte; reject an impossible length before allocating.
    if (size > bytes.length - offset) {
      throw new RangeError('Unexpected end of MessagePack buffer')
    }
    const arr: unknown[] = []
    for (let i = 0; i < size; i++) {
      arr.push(readNext())
    }
    return arr
  }

  function readMap(size: number): Record<string, unknown> {
    // Every entry takes at least two bytes (key and value).
    if (size * 2 > bytes.length - offset) {
      throw new RangeError('Unexpected end of MessagePack buffer')
    }
    const obj: Record<string, unknown> = {}
    for (let i = 0; i < size; i++) {
      const key = String(readNext())
      const val = readNext()
      // An own data property: assigning a `__proto__` key would replace the prototype instead.
      Object.defineProperty(obj, key, { value: val, enumerable: true, writable: true, configurable: true })
    }
    return obj
  }

  const value = readNext()
  if (offset !== bytes.length) {
    throw new RangeError(`Unexpected ${bytes.length - offset} trailing byte(s) after the MessagePack value`)
  }
  return value
}

/** 64-bit integers stay `number` while exact, and are `bigint` beyond the safe integer range. */
function toSafeInteger(value: bigint): number | bigint {
  return value >= MIN_SAFE_BIGINT && value <= MAX_SAFE_BIGINT ? Number(value) : value
}
