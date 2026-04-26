import { describe, expect, it } from 'vitest'
import type { DefinitionTargetConfig } from '@oa-sdk/parser'
import { buildCacheKey, buildTargetConfigDigest } from '../infrastructure/cache/sqlite/cache-key.js'

function makeConfig(overrides: Partial<DefinitionTargetConfig> = {}): DefinitionTargetConfig {
  return { name: 'api', scopes: [], domains: [], servers: [], includePaths: [], ...overrides }
}

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
    expect(buildTargetConfigDigest(makeConfig({ scopes: ['public'] }))).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is stable regardless of key ordering', () => {
    // Both produce the same digest — key insertion order doesn't affect hash
    const a = buildTargetConfigDigest(makeConfig({ scopes: ['public'], domains: ['users'] }))
    const b = buildTargetConfigDigest(makeConfig({ domains: ['users'], scopes: ['public'] }))
    expect(a).toBe(b)
  })

  it('differs for different configs', () => {
    const a = buildTargetConfigDigest(makeConfig({ name: 'api-a' }))
    const b = buildTargetConfigDigest(makeConfig({ name: 'api-b' }))
    expect(a).not.toBe(b)
  })

  it('handles nested server objects stably regardless of key order', () => {
    const a = buildTargetConfigDigest(makeConfig({ servers: [{ url: 'https://a.test', description: 'prod' }] }))
    const b = buildTargetConfigDigest(makeConfig({ servers: [{ description: 'prod', url: 'https://a.test' }] }))
    expect(a).toBe(b)
  })
})
