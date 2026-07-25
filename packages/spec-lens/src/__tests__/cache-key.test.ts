import { describe, expect, it } from 'vitest'
import type { DefinitionTargetConfig } from '@oa-sdk/parser'
import { buildTargetConfigDigest } from '../infrastructure/cache/sqlite/cache-key.js'
import {
  SPEC_LENS_SNAPSHOT_SCHEMA_VERSION,
  MAX_TYPESPEC_EVIDENCE_INPUTS,
  MAX_TYPESPEC_OBSERVATION_INPUTS,
  buildSpecProjectKey,
  createSpecProjectIdentity,
  resolveSpecProjectConfig,
  type SpecProjectKeyInput,
} from '../domain/project.js'
import { selectSnapshotBuilder } from '../infrastructure/snapshot-engine/snapshot-builder-selection.js'
import { normalizeCredentialFreeRemote } from '../infrastructure/source-adapters/observation-identity.js'

function makeConfig(overrides: Partial<DefinitionTargetConfig> = {}): DefinitionTargetConfig {
  return { name: 'api', scopes: [], domains: [], servers: [], includePaths: [], ...overrides }
}

describe('SpecProjectKey', () => {
  const observation = {
    adapterKind: 'local-git',
    repository: 'file:///repo-a',
    ref: 'main',
  } as const
  const base: SpecProjectKeyInput = {
    sourceKind: 'typespec-bundle',
    sourceRoot: 'packages/schemas/typespec',
    manifestOrTargetDigest: 'manifest-a',
    builderVersion: 'typespec-builder.v1',
    snapshotSchemaVersion: SPEC_LENS_SNAPSHOT_SCHEMA_VERSION,
    toolchainFingerprint: 'a'.repeat(64),
    observation,
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
    expect(buildSpecProjectKey({ ...base, toolchainFingerprint: 'b'.repeat(64) })).not.toBe(key)
    expect(buildSpecProjectKey({
      ...base,
      observation: { ...observation, repository: 'file:///repo-b' },
    })).not.toBe(key)
    expect(buildSpecProjectKey({
      ...base,
      observation: { ...observation, ref: 'release' },
    })).not.toBe(key)
    expect(buildSpecProjectKey({
      ...base,
      observation: { ...observation, adapterKind: 'github' },
    })).not.toBe(key)
  })

  it('normalizes equivalent source roots', () => {
    expect(buildSpecProjectKey(base)).toBe(buildSpecProjectKey({ ...base, sourceRoot: './packages/schemas/typespec/' }))
  })

  it('creates identities for both project kinds', () => {
    const definition = createSpecProjectIdentity({
      kind: 'definition-builder',
      sourceRoot: 'fragments',
      targetPath: 'targets/public.yaml',
    }, 'target-digest', observation)
    const typespec = createSpecProjectIdentity({
      kind: 'typespec-bundle',
      sourceRoot: 'typespec',
      manifestPath: 'typespec/oa-sdk.typespec-bundle.json',
    }, 'manifest-digest', observation, 'c'.repeat(64))
    expect(definition.sourceKind).toBe('definition-builder')
    expect(typespec.sourceKind).toBe('typespec-bundle')
    expect(definition.projectKey).not.toBe(typespec.projectKey)
  })

  it('rejects a non-SHA TypeSpec toolchain identity', () => {
    expect(() => createSpecProjectIdentity({
      kind: 'typespec-bundle',
      sourceRoot: 'typespec',
      manifestPath: 'typespec/oa-sdk.typespec-bundle.json',
    }, 'manifest-digest', observation, 'not-a-fingerprint')).toThrow('must be a SHA-256 fingerprint')
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

  it('maps legacy watch paths to candidate-only inputs and scopes them into the project identity', () => {
    const watched = resolveSpecProjectConfig({
      project: {
        kind: 'typespec-bundle',
        sourceRoot: 'packages/schemas/typespec',
        manifestPath: 'packages/schemas/typespec/oa-sdk.typespec-bundle.json',
        watchPaths: ['pnpm-lock.yaml', 'package.json'],
      },
    })
    expect(watched).toMatchObject({
      observationInputs: [
        { path: 'package.json', class: 'candidate-only' },
        { path: 'pnpm-lock.yaml', class: 'candidate-only' },
      ],
    })
    if (watched.kind !== 'typespec-bundle') throw new Error('expected TypeSpec bundle')
    const withoutWatch = createSpecProjectIdentity({
      kind: 'typespec-bundle',
      sourceRoot: watched.sourceRoot,
      manifestPath: watched.manifestPath,
    }, 'manifest-digest', { adapterKind: 'local-git', repository: 'file:///repo-a', ref: 'main' }, 'a'.repeat(64))
    const withWatch = createSpecProjectIdentity(watched, 'manifest-digest', { adapterKind: 'local-git', repository: 'file:///repo-a', ref: 'main' }, 'a'.repeat(64))
    expect(withWatch.projectKey).not.toBe(withoutWatch.projectKey)
  })

  it('maps the simple observation config to typed inputs and scopes it into the project identity', () => {
    const project = resolveSpecProjectConfig({
      project: {
        kind: 'typespec-bundle',
        sourceRoot: 'packages/schemas/typespec',
        manifestPath: 'packages/schemas/typespec/oa-sdk.typespec-bundle.json',
        observation: {
          candidates: ['packages/typespec-decorators'],
          evidence: ['pnpm-lock.yaml', 'package.json'],
        },
      },
    })
    expect(project).toMatchObject({
      observationInputs: [
        { path: 'package.json', class: 'evidence-only' },
        { path: 'packages/typespec-decorators', class: 'candidate-only' },
        { path: 'pnpm-lock.yaml', class: 'evidence-only' },
      ],
    })
    if (project.kind !== 'typespec-bundle') throw new Error('expected TypeSpec bundle')
    const observation = { adapterKind: 'local-git', repository: 'file:///repo-a', ref: 'main' } as const
    const baseline = createSpecProjectIdentity({
      kind: 'typespec-bundle', sourceRoot: project.sourceRoot, manifestPath: project.manifestPath,
    }, 'manifest-digest', observation, 'a'.repeat(64))
    const observed = createSpecProjectIdentity(project, 'manifest-digest', observation, 'a'.repeat(64))
    expect(observed.projectKey).not.toBe(baseline.projectKey)
  })

  it('accepts explicit evidence-only inputs and isolates their project identity', () => {
    const project = resolveSpecProjectConfig({
      project: {
        kind: 'typespec-bundle',
        sourceRoot: 'packages/schemas/typespec',
        manifestPath: 'packages/schemas/typespec/oa-sdk.typespec-bundle.json',
        observationInputs: [
          { path: 'pnpm-lock.yaml', class: 'evidence-only' },
          { path: 'packages/typespec-decorators', class: 'candidate-only' },
        ],
      },
    })
    expect(project).toMatchObject({
      observationInputs: [
        { path: 'packages/typespec-decorators', class: 'candidate-only' },
        { path: 'pnpm-lock.yaml', class: 'evidence-only' },
      ],
    })
    if (project.kind !== 'typespec-bundle') throw new Error('expected TypeSpec bundle')
    const inputObservation = { adapterKind: 'local-git', repository: 'file:///repo-a', ref: 'main' } as const
    const baseline = createSpecProjectIdentity({
      kind: 'typespec-bundle', sourceRoot: project.sourceRoot, manifestPath: project.manifestPath,
    }, 'manifest-digest', inputObservation, 'a'.repeat(64))
    const observed = createSpecProjectIdentity(project, 'manifest-digest', inputObservation, 'a'.repeat(64))
    expect(observed.projectKey).not.toBe(baseline.projectKey)
  })

  it('selects a kind-correlated ready builder for TypeSpec snapshots', () => {
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
      status: 'ready',
      projectKind: 'typespec-bundle',
    })
  })

  it('rejects unsafe project paths and manifests outside sourceRoot', () => {
    expect(() => resolveSpecProjectConfig({
      project: {
        kind: 'typespec-bundle',
        sourceRoot: '../typespec',
        manifestPath: '../typespec/bundle.json',
      },
    })).toThrow('must stay inside the repository')
    expect(() => resolveSpecProjectConfig({
      project: {
        kind: 'typespec-bundle',
        sourceRoot: 'packages/schemas/typespec',
        manifestPath: 'packages/schemas/other/bundle.json',
      },
    })).toThrow('must name a file inside project.sourceRoot')
    expect(() => resolveSpecProjectConfig({
      project: {
        kind: 'typespec-bundle',
        sourceRoot: 'packages/schemas/typespec',
        manifestPath: 'packages/schemas/typespec/oa-sdk.typespec-bundle.json',
        watchPaths: ['../pnpm-lock.yaml'],
      },
    })).toThrow('must stay inside the repository')
    expect(() => resolveSpecProjectConfig({
      project: {
        kind: 'typespec-bundle',
        sourceRoot: 'packages/schemas/typespec',
        manifestPath: 'packages/schemas/typespec/oa-sdk.typespec-bundle.json',
        watchPaths: ['package.json'],
        observationInputs: [{ path: 'pnpm-lock.yaml', class: 'evidence-only' }],
      },
    })).toThrow('use only one of project.observation, project.observationInputs, or project.watchPaths')
    expect(() => resolveSpecProjectConfig({
      project: {
        kind: 'typespec-bundle',
        sourceRoot: 'packages/schemas/typespec',
        manifestPath: 'packages/schemas/typespec/oa-sdk.typespec-bundle.json',
        observation: { evidence: ['pnpm-lock.yaml'] },
        observationInputs: [{ path: 'package.json', class: 'evidence-only' }],
      },
    })).toThrow('use only one of project.observation, project.observationInputs, or project.watchPaths')
    expect(() => resolveSpecProjectConfig({
      project: {
        kind: 'typespec-bundle',
        sourceRoot: 'packages/schemas/typespec',
        manifestPath: 'packages/schemas/typespec/oa-sdk.typespec-bundle.json',
        observationInputs: Array.from({ length: MAX_TYPESPEC_OBSERVATION_INPUTS + 1 }, (_, index) => ({
          path: `observed/input-${index}.json`, class: 'candidate-only',
        })),
      },
    })).toThrow(`must not exceed ${MAX_TYPESPEC_OBSERVATION_INPUTS} entries`)
    expect(() => resolveSpecProjectConfig({
      project: {
        kind: 'typespec-bundle',
        sourceRoot: 'packages/schemas/typespec',
        manifestPath: 'packages/schemas/typespec/oa-sdk.typespec-bundle.json',
        observationInputs: Array.from({ length: MAX_TYPESPEC_EVIDENCE_INPUTS + 1 }, (_, index) => ({
          path: `observed/evidence-${index}.json`, class: 'evidence-only',
        })),
      },
    })).toThrow(`must not exceed ${MAX_TYPESPEC_EVIDENCE_INPUTS} entries`)
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

describe('observation identity normalization', () => {
  it('never retains remote URL credentials or query fragments', () => {
    expect(normalizeCredentialFreeRemote('https://user:secret@GHE.EXAMPLE.test/api?v=1#token')).toBe(
      'https://ghe.example.test/api',
    )
  })
})
