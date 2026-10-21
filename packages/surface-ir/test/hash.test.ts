import { describe, expect, it } from 'vitest'
import {
  canonicalJsonStringify,
  computeCanonicalHash,
  sha256,
  stableStringify,
} from '../src/index.js'

describe('surface-ir hash and canonicalization', () => {
  it('sha256 computes standard hex digest', () => {
    expect(sha256('hello world')).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    )
  })

  it('canonicalJsonStringify deterministically sorts object keys by UTF-16 code units', () => {
    const input1 = { z: 1, a: 2, m: { c: 3, b: 4 } }
    const input2 = { a: 2, m: { b: 4, c: 3 }, z: 1 }

    expect(canonicalJsonStringify(input1)).toBe('{"a":2,"m":{"b":4,"c":3},"z":1}')
    expect(canonicalJsonStringify(input1)).toBe(canonicalJsonStringify(input2))
  })

  it('canonicalJsonStringify excludes undefined, functions, and symbols from objects', () => {
    const input = {
      keep: 'value',
      ignoredUndefined: undefined,
      ignoredFn: () => 'noop',
      ignoredSymbol: Symbol('test'),
    }
    expect(canonicalJsonStringify(input)).toBe('{"keep":"value"}')
  })

  it('canonicalJsonStringify preserves arrays in order and serializes undefined elements as null', () => {
    const arr = [1, undefined, 'text', { b: 2, a: 1 }]
    expect(canonicalJsonStringify(arr)).toBe('[1,null,"text",{"a":1,"b":2}]')
  })

  it('computeCanonicalHash formats as sha256:<hex> and produces identical digests for equivalent objects', () => {
    const docA = {
      title: 'Workflow Spec',
      version: 1,
      metadata: { owner: 'agent-1', tags: ['pipeline', 'shared'] },
    }
    const docB = {
      metadata: { tags: ['pipeline', 'shared'], owner: 'agent-1' },
      version: 1,
      title: 'Workflow Spec',
    }

    const hashA = computeCanonicalHash(docA)
    const hashB = computeCanonicalHash(docB)

    expect(hashA).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(hashA).toBe(hashB)
  })

  it('canonicalJsonStringify rejects non-finite numbers instead of colliding with null', () => {
    expect(() => canonicalJsonStringify({ a: Number.NaN })).toThrow(TypeError)
    expect(() => canonicalJsonStringify({ a: Number.POSITIVE_INFINITY })).toThrow(/non-finite/)
    expect(() => canonicalJsonStringify([Number.NEGATIVE_INFINITY])).toThrow(/non-finite/)
    expect(() => computeCanonicalHash({ confidence: 0 / 0 })).toThrow(TypeError)
    expect(computeCanonicalHash({ confidence: null })).toMatch(/^sha256:/)
  })

  it('canonicalJsonStringify rejects bigint with a clear TypeError', () => {
    expect(() => canonicalJsonStringify({ n: 1n })).toThrow(/bigint/)
  })

  it('canonicalJsonStringify serializes function and symbol array elements as null (valid JSON)', () => {
    const out = canonicalJsonStringify([() => 1, Symbol('s')])
    expect(out).toBe('[null,null]')
    expect(out).toBe(JSON.stringify([() => 1, Symbol('s')]))
    expect(JSON.parse(out)).toEqual([null, null])
  })

  it('canonicalJsonStringify applies toJSON so a Date hashes like its JSON round trip', () => {
    const live = { d: new Date(0) }
    const roundTripped: unknown = JSON.parse(JSON.stringify(live))
    expect(canonicalJsonStringify(live)).toBe('{"d":"1970-01-01T00:00:00.000Z"}')
    expect(computeCanonicalHash(live)).toBe(computeCanonicalHash(roundTripped))
    expect(computeCanonicalHash(live)).not.toBe(computeCanonicalHash({ d: {} }))
  })

  it('canonicalJsonStringify unboxes boxed primitives like JSON.stringify', () => {
    // eslint-disable-next-line no-new-wrappers
    const boxed = { n: new Number(1), s: new String('x'), b: new Boolean(false) }
    expect(canonicalJsonStringify(boxed)).toBe('{"b":false,"n":1,"s":"x"}')
  })

  it('canonicalJsonStringify rejects non-plain objects without toJSON', () => {
    class Point {
      constructor(public x: number) {}
    }
    expect(() => canonicalJsonStringify({ m: new Map([['a', 1]]) })).toThrow(/Map/)
    expect(() => canonicalJsonStringify(new Set([1]))).toThrow(/Set/)
    expect(() => canonicalJsonStringify({ p: new Point(1) })).toThrow(/Point/)
    const nullProto: Record<string, unknown> = Object.create(null)
    nullProto['b'] = 1
    nullProto['a'] = 2
    expect(canonicalJsonStringify(nullProto)).toBe('{"a":2,"b":1}')
  })

  it('canonicalJsonStringify rejects lone surrogates in strings and keys', () => {
    expect(() => canonicalJsonStringify({ a: '\ud800' })).toThrow(/lone surrogate/)
    expect(() => canonicalJsonStringify({ '\udc00': 1 })).toThrow(/lone surrogate/)
    expect(canonicalJsonStringify({ a: '😀' })).toBe('{"a":"😀"}')
  })

  it('computeCanonicalHash(undefined) throws a clear TypeError instead of a crypto error', () => {
    expect(() => computeCanonicalHash(undefined)).toThrow(TypeError)
    expect(() => computeCanonicalHash(undefined)).toThrow(/canonicalJsonStringify/)
    expect(() => canonicalJsonStringify(() => 1)).toThrow(/top-level function/)
  })

  it('canonicalJsonStringify matches the RFC 8785 non-ASCII key ordering vector', () => {
    expect(canonicalJsonStringify({ '€': 1, '\r': 2, '😀': 3, 'ö': 4 })).toBe('{"\\r":2,"ö":4,"€":1,"😀":3}')
  })

  it('canonicalJsonStringify keeps ECMAScript number formatting', () => {
    expect(canonicalJsonStringify([-0, 1e21, 0.000001, 1e-7])).toBe('[0,1e+21,0.000001,1e-7]')
  })

  it('stableStringify preserves backward compatibility', () => {
    const obj = { b: 2, a: 1 }
    expect(stableStringify(obj)).toBe('{"a":1,"b":2}')
  })
})
