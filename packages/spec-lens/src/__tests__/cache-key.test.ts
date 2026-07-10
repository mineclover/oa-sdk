import { describe, expect, it } from 'vitest'
import type { DefinitionTargetConfig } from '@oa-sdk/parser'
import { buildTargetConfigDigest } from '../infrastructure/cache/sqlite/cache-key.js'
import {
  SPEC_LENS_SNAPSHOT_SCHEMA_VERSION,
  buildSpecProjectKey,
  createSpecProjectIdentity,
  resolveSpecProjectConfig,
  type SpecProjectKeyInput,
} from '../domain/project.js'
import { selectSnapshotBuilder } from '../infrastructure/snapshot-engine/snapshot-builder-selection.js'

function makeConfig(overrides: Partial<DefinitionTargetConfig> = {}): DefinitionTargetConfig {
  return { name: 'api', scopes: [], domains: [], servers: [], includePaths: [], ...overrides }
}

describe('SpecProjectKey', () => {
  const base: SpecProjectKeyInput = {
    sourceKind: 'typespec-bundle',
    sourceRoot: 'packages/schemas/typespec',
    manifestOrTargetDigest: 'manifest-a',
    builderVersion: 'typespec-builder.v1',
    snapshotSchemaVersion: SPEC_LENS_SNAPSHOT_SCHEMA_VERSION,
  }

  it('returns a 64-char hex string', () => {
    const key = buildSpecProjectKey(base)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic for the same input', () => {
    expect(buildSpecProjectKey(base)).toBe(buildSpecProjectKey(base))
  })

  it('differs for every project build identity field', () => {
    const key = buildSpecProjectKey(base)
    expect(buildSpecProjectKey({ ...base, sourceKind: 'definition-builder' })).not.toBe(key)
    expect(buildSpecProjectKey({ ...base, sourceRoot: 'other' })).not.toBe(key)
    expect(buildSpecProjectKey({ ...base, manifestOrTargetDigest: 'manifest-b' })).not.toBe(key)
    expect(buildSpecProjectKey({ ...base, builderVersion: 'typespec-builder.v2' })).not.toBe(key)
    expect(buildSpecProjectKey({ ...base, snapshotSchemaVersion: 'spec-lens.snapshot.v3' })).not.toBe(key)
  })

  it('normalizes equivalent source roots', () => {
    expect(buildSpecProjectKey(base)).toBe(buildSpecProjectKey({ ...base, sourceRoot: './packages/schemas/typespec/' }))
  })

  it('creates identities for both project kinds', () => {
    const definition = createSpecProjectIdentity({
      kind: 'definition-builder',
      sourceRoot: 'fragments',
      targetPath: 'targets/public.yaml',
    }, 'target-digest')
    const typespec = createSpecProjectIdentity({
      kind: 'typespec-bundle',
      sourceRoot: 'typespec',
      manifestPath: 'typespec/oa-sdk.typespec-bundle.json',
    }, 'manifest-digest')
    expect(definition.sourceKind).toBe('definition-builder')
    expect(typespec.sourceKind).toBe('typespec-bundle')
    expect(definition.projectKey).not.toBe(typespec.projectKey)
  })
})

describe('resolveSpecProjectConfig', () => {
  it('preserves legacy fragmentsDir/targetPath config', () => {
    expect(resolveSpecProjectConfig({ fragmentsDir: 'fragments/', targetPath: 'target.yaml' })).toEqual({
      kind: 'definition-builder',
      sourceRoot: 'fragments',
      targetPath: 'target.yaml',
    })
  })

  it('accepts a TypeSpec bundle project', () => {
    expect(resolveSpecProjectConfig({
      project: {
        kind: 'typespec-bundle',
        sourceRoot: 'packages/schemas/typespec',
        manifestPath: 'packages/schemas/typespec/oa-sdk.typespec-bundle.json',
      },
    })).toEqual({
      kind: 'typespec-bundle',
      sourceRoot: 'packages/schemas/typespec',
      manifestPath: 'packages/schemas/typespec/oa-sdk.typespec-bundle.json',
    })
  })

  it('leaves a replaceable builder-selection seam for TypeSpec snapshots', () => {
    expect(selectSnapshotBuilder({
      kind: 'definition-builder',
      sourceRoot: 'fragments',
      targetPath: 'target.yaml',
    }).status).toBe('ready')
    expect(selectSnapshotBuilder({
      kind: 'typespec-bundle',
      sourceRoot: 'typespec',
      manifestPath: 'typespec/oa-sdk.typespec-bundle.json',
    })).toMatchObject({
      status: 'pending',
      adapterName: 'TypeSpecBundleSnapshotBuilder',
    })
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
