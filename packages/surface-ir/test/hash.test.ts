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

  it('stableStringify preserves backward compatibility', () => {
    const obj = { b: 2, a: 1 }
    expect(stableStringify(obj)).toBe('{"a":1,"b":2}')
  })
})
