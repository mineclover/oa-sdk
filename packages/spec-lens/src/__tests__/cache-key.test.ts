import { describe, expect, it } from 'vitest'
import { buildCacheKey, buildTargetConfigDigest } from '../infrastructure/cache/sqlite/cache-key.js'

describe('buildCacheKey', () => {
  it('returns a 64-char hex string', () => {
    const key = buildCacheKey({
      revisionId: 'abc123',
      fragmentsDir: '/fragments',
      targetConfigDigest: 'digest',
      codegenVersion: '0.2.0',
      schemaVersion: 'spec-lens.snapshot.v1',
    })
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic for the same input', () => {
    const input = {
      revisionId: 'abc123',
      fragmentsDir: '/fragments',
      targetConfigDigest: 'digest',
      codegenVersion: '0.2.0',
      schemaVersion: 'spec-lens.snapshot.v1',
    }
    expect(buildCacheKey(input)).toBe(buildCacheKey(input))
  })

  it('differs when revisionId changes', () => {
    const base = {
      revisionId: 'aaa',
      fragmentsDir: '/f',
      targetConfigDigest: 'd',
      codegenVersion: '1',
      schemaVersion: 'v1',
    }
    expect(buildCacheKey(base)).not.toBe(buildCacheKey({ ...base, revisionId: 'bbb' }))
  })

  it('differs when targetConfigDigest changes', () => {
    const base = {
      revisionId: 'aaa',
      fragmentsDir: '/f',
      targetConfigDigest: 'd1',
      codegenVersion: '1',
      schemaVersion: 'v1',
    }
    expect(buildCacheKey(base)).not.toBe(buildCacheKey({ ...base, targetConfigDigest: 'd2' }))
  })

  it('differs when codegenVersion changes', () => {
    const base = {
      revisionId: 'aaa',
      fragmentsDir: '/f',
      targetConfigDigest: 'd',
      codegenVersion: '0.1.0',
      schemaVersion: 'v1',
    }
    expect(buildCacheKey(base)).not.toBe(buildCacheKey({ ...base, codegenVersion: '0.2.0' }))
  })
})

describe('buildTargetConfigDigest', () => {
  it('returns a 64-char hex string', () => {
    expect(buildTargetConfigDigest({ name: 'api', scopes: ['public'] })).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is stable regardless of key ordering', () => {
    const a = buildTargetConfigDigest({ name: 'api', scopes: ['public'], domains: ['users'] })
    const b = buildTargetConfigDigest({ domains: ['users'], scopes: ['public'], name: 'api' })
    expect(a).toBe(b)
  })

  it('differs for different configs', () => {
    const a = buildTargetConfigDigest({ name: 'api-a' })
    const b = buildTargetConfigDigest({ name: 'api-b' })
    expect(a).not.toBe(b)
  })

  it('handles nested objects stably', () => {
    const a = buildTargetConfigDigest({ servers: [{ url: 'https://a.test', z: 1, a: 2 }] })
    const b = buildTargetConfigDigest({ servers: [{ url: 'https://a.test', a: 2, z: 1 }] })
    expect(a).toBe(b)
  })
})
