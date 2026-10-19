import { describe, expect, it } from 'vitest'
import { decodeMessagePack, encodeMessagePack, messagePackAdapter } from '../codec/index.js'

const text = new TextEncoder()

/** MessagePack fixstr bytes of a short ASCII string. */
function fixstr(value: string): number[] {
  const bytes = Array.from(text.encode(value))
  if (bytes.length > 31) throw new Error('fixstr holds at most 31 bytes')
  return [0xa0 | bytes.length, ...bytes]
}

/** A 9-byte uint64 (0xcf) or int64 (0xd3) MessagePack value. */
function int64Bytes(prefix: 0xcf | 0xd3, value: bigint): Uint8Array {
  const buf = new Uint8Array(9)
  buf[0] = prefix
  const view = new DataView(buf.buffer)
  if (prefix === 0xcf) view.setBigUint64(1, value, false)
  else view.setBigInt64(1, value, false)
  return buf
}

describe('MessagePack decoder keeps map keys as own data', () => {
  it('does not let a __proto__ key replace the prototype of the decoded map', () => {
    // {"__proto__": {"isAdmin": true}}
    const bytes = Uint8Array.from([0x81, ...fixstr('__proto__'), 0x81, ...fixstr('isAdmin'), 0xc3])
    const decoded = messagePackAdapter.decode(bytes) as Record<string, unknown>

    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype)
    expect(Object.hasOwn(decoded, '__proto__')).toBe(true)
    expect(Object.keys(decoded)).toEqual(['__proto__'])
    expect(decoded.isAdmin).toBeUndefined()
    expect(Object.getOwnPropertyDescriptor(decoded, '__proto__')?.value).toEqual({ isAdmin: true })
  })

  it('round-trips an own __proto__ key the way JSON.parse produces it, also when nested', () => {
    const source = JSON.parse('{"__proto__":{"x":1},"list":[{"__proto__":{"y":2}}]}') as Record<string, unknown>
    const decoded = decodeMessagePack(encodeMessagePack(source)) as Record<string, unknown>

    expect(Object.keys(decoded)).toEqual(['__proto__', 'list'])
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype)
    expect(Object.getOwnPropertyDescriptor(decoded, '__proto__')?.value).toEqual({ x: 1 })
    const [nested] = decoded.list as Record<string, unknown>[]
    expect(Object.getPrototypeOf(nested)).toBe(Object.prototype)
    expect(Object.hasOwn(nested!, '__proto__')).toBe(true)
    expect(nested!.y).toBeUndefined()
  })
})

describe('MessagePack decoder rejects truncated and oversized input', () => {
  const alice = encodeMessagePack({ name: 'Alice' })

  it.each([
    ['fixstr shorter than its length', [0xa5, 0x61]],
    ['bin8 shorter than its length', [0xc4, 5, 1]],
    ['str8 without its length byte', [0xd9]],
    ['bin8 without its length byte', [0xc4]],
    ['uint8 without its value byte', [0xcc]],
    ['str16 shorter than its length', [0xda, 0, 10, 0x61]],
    ['array claiming more elements than bytes remain', [0xdd, 0xff, 0xff, 0xff, 0xff]],
    ['map claiming more entries than bytes remain', [0xdf, 0xff, 0xff, 0xff, 0xff]],
    ['map value cut off', [0x81, ...fixstr('a')]],
    ['object cut inside a string value', Array.from(alice.subarray(0, alice.length - 3))],
  ])('throws RangeError for a %s', (_label, bytes) => {
    expect(() => decodeMessagePack(Uint8Array.from(bytes))).toThrow(RangeError)
  })

  it('throws RangeError for bytes left after the value', () => {
    expect(() => decodeMessagePack(Uint8Array.of(1, 2))).toThrow(/trailing byte/)
    expect(() => decodeMessagePack(Uint8Array.from([...alice, 0xc0]))).toThrow(RangeError)
  })

  it('still decodes values that span exactly the buffer, also from an offset view', () => {
    expect(decodeMessagePack(alice)).toEqual({ name: 'Alice' })
    const padded = Uint8Array.from([0xff, ...alice, 0xff])
    expect(decodeMessagePack(padded.subarray(1, padded.length - 1))).toEqual({ name: 'Alice' })
  })
})

describe('MessagePack 64-bit integers and bigint', () => {
  it('decodes uint64/int64 beyond the safe integer range to an exact bigint', () => {
    expect(decodeMessagePack(int64Bytes(0xcf, 2n ** 53n + 1n))).toBe(9007199254740993n)
    expect(decodeMessagePack(int64Bytes(0xcf, 2n ** 64n - 1n))).toBe(18446744073709551615n)
    expect(decodeMessagePack(int64Bytes(0xd3, -(2n ** 53n) - 1n))).toBe(-9007199254740993n)
    expect(decodeMessagePack(int64Bytes(0xd3, -(2n ** 63n)))).toBe(-(2n ** 63n))
  })

  it('decodes uint64/int64 inside the safe range to a number', () => {
    expect(decodeMessagePack(int64Bytes(0xcf, 42n))).toBe(42)
    expect(decodeMessagePack(int64Bytes(0xd3, -1n))).toBe(-1)
    expect(decodeMessagePack(int64Bytes(0xcf, BigInt(Number.MAX_SAFE_INTEGER)))).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('encodes bigint as an integer instead of a string', () => {
    expect(decodeMessagePack(encodeMessagePack({ id: 10n }))).toEqual({ id: 10 })
    expect(decodeMessagePack(encodeMessagePack(-5n))).toBe(-5)

    const big = 2n ** 53n + 1n
    const encoded = encodeMessagePack(big)
    expect(encoded[0]).toBe(0xcf)
    expect(decodeMessagePack(encoded)).toBe(big)

    const negative = -(2n ** 60n)
    const encodedNegative = encodeMessagePack(negative)
    expect(encodedNegative[0]).toBe(0xd3)
    expect(decodeMessagePack(encodedNegative)).toBe(negative)

    expect(decodeMessagePack(encodeMessagePack(2n ** 64n - 1n))).toBe(2n ** 64n - 1n)
    expect(decodeMessagePack(encodeMessagePack(-(2n ** 63n)))).toBe(-(2n ** 63n))
  })

  it('throws RangeError for a bigint wider than 64 bits', () => {
    expect(() => encodeMessagePack(2n ** 64n)).toThrow(RangeError)
    expect(() => encodeMessagePack(-(2n ** 63n) - 1n)).toThrow(RangeError)
  })
})

describe('MessagePack encoder follows JSON for non-native values and fails loudly otherwise', () => {
  it('encodes a Date as its ISO string, like JSON', () => {
    const payload = { at: new Date('2026-01-01T00:00:00.000Z'), invalid: new Date(Number.NaN) }

    expect(decodeMessagePack(encodeMessagePack(payload))).toEqual(JSON.parse(JSON.stringify(payload)))
    expect(decodeMessagePack(encodeMessagePack(payload))).toEqual({ at: '2026-01-01T00:00:00.000Z', invalid: null })
  })

  it('honors toJSON() once per value, as JSON.stringify does', () => {
    class Point {
      constructor(readonly x: number, readonly y: number) {}
      toJSON(): this { return this }
    }
    const money = { amount: 5, toJSON: () => ({ cents: 500 }) }
    const payload = { money, point: new Point(1, 2) }

    expect(decodeMessagePack(encodeMessagePack(payload))).toEqual({ money: { cents: 500 }, point: { x: 1, y: 2 } })
    expect(decodeMessagePack(encodeMessagePack(payload))).toEqual(JSON.parse(JSON.stringify(payload)))
  })

  it('encodes every ArrayBuffer view as binary, including a Node.js Buffer', () => {
    expect(decodeMessagePack(encodeMessagePack(Buffer.from([1, 2, 3])))).toEqual(Uint8Array.of(1, 2, 3))

    const backing = Uint8Array.of(9, 1, 2, 9).buffer
    expect(decodeMessagePack(encodeMessagePack(new DataView(backing, 1, 2)))).toEqual(Uint8Array.of(1, 2))
    expect(decodeMessagePack(encodeMessagePack(new Uint8Array(backing, 1, 2)))).toEqual(Uint8Array.of(1, 2))
  })

  it.each([
    ['symbol', Symbol('x')],
    ['function', () => 1],
    ['Map', new Map([['a', 1]])],
    ['Set', new Set([1])],
  ])('throws TypeError for a %s instead of encoding a lossy substitute', (_label, value) => {
    expect(() => encodeMessagePack(value)).toThrow(TypeError)
    expect(() => encodeMessagePack({ nested: value })).toThrow(TypeError)
  })
})
