import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveSpecLensTypeSpecSourceReadBudget } from '@oa-sdk/codegen/spec-lens'
import { RefreshTimelineHandler } from '../application/commands/refresh-timeline.command.js'
import type { SpecSourcePort } from '../application/ports/spec-source.port.js'
import type { SpecFileEntry, SpecRevision } from '../domain/index.js'
import { createSpecProjectIdentity } from '../domain/project.js'
import { SqliteCache } from '../infrastructure/cache/sqlite/sqlite-cache.js'
import {
  TypeSpecBundleSnapshotBuilder,
  type TypeSpecBundleCompiler,
} from '../infrastructure/snapshot-engine/typespec-bundle-snapshot-builder.js'

const projectConfig = {
  kind: 'typespec-bundle',
  sourceRoot: 'packages/schemas/typespec',
  manifestPath: 'packages/schemas/typespec/oa-sdk.typespec-bundle.json',
  observationInputs: [{ path: 'pnpm-lock.yaml', class: 'evidence-only' }],
} as const
const TEST_TOOLCHAIN_FINGERPRINT = 'a'.repeat(64)
const project = createSpecProjectIdentity(projectConfig, 'manifest-digest', {
  adapterKind: 'local-git',
  repository: 'file:///test-repo',
  ref: 'main',
}, TEST_TOOLCHAIN_FINGERPRINT)

let cache: SqliteCache
let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'spec-lens-typespec-test-'))
  cache = new SqliteCache(join(tmpDir, 'cache.db'))
})

afterEach(() => {
  cache.close()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('TypeSpecBundleSnapshotBuilder', () => {
  it('refreshes TypeSpec-only revisions and reuses cached snapshots and diffs', async () => {
    const revisions = [makeRevision('r2', 2000), makeRevision('r1', 1000)]
    const compile = vi.fn<TypeSpecBundleCompiler>(async options => {
      const main = options.entries.find(entry => entry.relativePath === 'main.tsp')
      const path = main?.content.includes('2') ? '/v2' : '/v1'
      return compileResult(path)
    })
    const builder = new TypeSpecBundleSnapshotBuilder(compile, '/trusted-runtime')
    const source = makeSource(revisions, revision => makeEntries(revision.id))
    const handler = new RefreshTimelineHandler(source, builder, cache)

    const first = await handler.handle({
      kind: 'typespec-bundle',
      project,
      manifestPath: projectConfig.manifestPath,
    })
    const second = await handler.handle({
      kind: 'typespec-bundle',
      project,
      manifestPath: projectConfig.manifestPath,
    })

    expect(first).toEqual({ newRevisions: 2, builtSnapshots: 2, errors: [] })
    expect(second).toEqual({ newRevisions: 0, builtSnapshots: 0, errors: [] })
    expect(compile).toHaveBeenCalledTimes(2)
    expect(source.getFileEntries).toHaveBeenCalledTimes(2)
    expect(source.getFileEntries).toHaveBeenCalledWith(expect.objectContaining({
      sourceKind: 'typespec-bundle',
      readBudget: resolveSpecLensTypeSpecSourceReadBudget(),
    }))

    const snapshot = await cache.getSnapshotByRevision('r2', project.projectKey)
    expect(snapshot).toMatchObject({
      projectKind: 'typespec-bundle',
      provenance: {
        status: 'available',
        kind: 'typespec-source-ast',
        entries: expect.objectContaining({
          '#/paths/~1v2': expect.objectContaining({
            canonicalId: 'operation:typespec/main.tsp/getTest',
            sourcePath: 'main.tsp',
          }),
        }),
        sourceFiles: [{ relativePath: 'main.tsp', contentHash: 'main-r2' }],
        observedInputs: [{
          path: 'pnpm-lock.yaml', class: 'evidence-only', availability: 'available', contentHash: 'input-r2',
        }],
      },
    })
    const diff = await cache.getDiff('r1', 'r2', project.projectKey)
    expect(diff).toMatchObject({
      projectKind: 'typespec-bundle',
      provenanceDiff: {
        status: 'available',
        kind: 'typespec-source-ast',
        entries: expect.any(Array),
      },
      stats: { pathsAdded: 1, pathsRemoved: 1 },
    })
    expect(await cache.listTimeline({ projectKey: project.projectKey })).toHaveLength(2)
    expect(await cache.listPaths({ projectKey: project.projectKey })).toEqual([expect.objectContaining({
      path: '/v2',
      methods: ['get'],
      canonicalId: 'operation:typespec/main.tsp/getTest',
      sourceFile: 'main.tsp',
    })])
  })

  it('leaves a failed compile as an explicit uncached timeline error', async () => {
    const revisions = [makeRevision('bad', 2000), makeRevision('good', 1000)]
    const compile = vi.fn<TypeSpecBundleCompiler>(async options => {
      const main = options.entries.find(entry => entry.relativePath === 'main.tsp')
      if (main?.content.includes('bad')) throw new Error('TypeSpec compile failed: synthetic diagnostic')
      return compileResult('/good')
    })
    const source = makeSource(revisions, revision => makeEntries(revision.id))
    const handler = new RefreshTimelineHandler(
      source,
      new TypeSpecBundleSnapshotBuilder(compile, '/trusted-runtime'),
      cache,
    )

    const result = await handler.handle({
      kind: 'typespec-bundle',
      project,
      manifestPath: projectConfig.manifestPath,
    })

    expect(result).toMatchObject({ newRevisions: 2, builtSnapshots: 1 })
    expect(result.errors).toEqual([{
      revisionId: 'bad',
      message: 'TypeSpec compile failed: synthetic diagnostic',
    }])
    expect(await cache.getSnapshotByRevision('bad', project.projectKey)).toBeNull()
    expect(await cache.listTimeline({ projectKey: project.projectKey })).toEqual(expect.arrayContaining([
      expect.objectContaining({ revision: expect.objectContaining({ id: 'bad' }), snapshotCached: false }),
      expect.objectContaining({ revision: expect.objectContaining({ id: 'good' }), snapshotCached: true }),
    ]))
  })

  it('serializes bounded-heap TypeSpec compiles while refreshing multiple revisions', async () => {
    const revisions = Array.from({ length: 6 }, (_, index) => makeRevision(`r${6 - index}`, 6000 - index))
    let active = 0
    let maxActive = 0
    const compile = vi.fn<TypeSpecBundleCompiler>(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise(resolveWait => setTimeout(resolveWait, 5))
      active--
      return compileResult('/serialized')
    })
    const handler = new RefreshTimelineHandler(
      makeSource(revisions, revision => makeEntries(revision.id)),
      new TypeSpecBundleSnapshotBuilder(compile, '/trusted-runtime'),
      cache,
    )

    const result = await handler.handle({
      kind: 'typespec-bundle',
      project,
      manifestPath: projectConfig.manifestPath,
    })

    expect(result).toEqual({ newRevisions: 6, builtSnapshots: 6, errors: [] })
    expect(compile).toHaveBeenCalledTimes(6)
    expect(maxActive).toBe(1)
  })
})

function makeRevision(id: string, timestamp: number): SpecRevision {
  return {
    id,
    shortId: id,
    timestamp,
    message: id,
    source: 'local-git',
    sourceRef: 'main',
  }
}

function makeEntries(id: string): SpecFileEntry[] {
  return [
    {
      relativePath: 'oa-sdk.typespec-bundle.json',
      content: '{}',
      contentHash: 'manifest',
    },
    {
      relativePath: 'main.tsp',
      content: id,
      contentHash: `main-${id}`,
    },
  ]
}

function makeSource(
  revisions: SpecRevision[],
  entries: (revision: SpecRevision) => SpecFileEntry[],
): SpecSourcePort & { getFileEntries: ReturnType<typeof vi.fn> } {
  return {
    kind: 'local-git',
    resolveObservationIdentity: vi.fn().mockResolvedValue(project.observation),
    listRevisions: vi.fn().mockResolvedValue(revisions),
    getFileEntries: vi.fn(async ({ revision }: { revision: SpecRevision }) => entries(revision)),
    getObservationInputEvidence: vi.fn(async ({ revision }: { revision: SpecRevision }) => [{
      path: 'pnpm-lock.yaml', class: 'evidence-only' as const, availability: 'available' as const, contentHash: `input-${revision.id}`,
    }]),
  }
}

function compileResult(path: string) {
  return {
    document: {
      openapi: '3.2.0',
      info: { title: 'test', version: '1' },
      paths: { [path]: { get: { responses: { '200': { description: 'ok' } } } } },
    },
    evidence: {
      schemaVersion: 'oa-sdk.spec-lens.typespec-compile.v1' as const,
      manifestSchemaVersion: 'oa-sdk.typespec-bundle.v1' as const,
      entrypoint: 'main.tsp',
      sourceFiles: ['main.tsp'],
      compatibilitySource: 'typespec-extensions' as const,
      toolchain: {
        schemaVersion: 'oa-sdk.spec-lens.typespec-toolchain.v1' as const,
        fingerprint: TEST_TOOLCHAIN_FINGERPRINT,
        packages: {
          '@oa-sdk/typespec-decorators': '0.1.0',
          '@typespec/compiler': '1.13.0',
          '@typespec/http': '1.13.0',
          '@typespec/openapi': '1.13.0',
          '@typespec/openapi3': '1.13.0',
        },
        trustedLibraryDigests: {
          '@oa-sdk/typespec-decorators': 'a'.repeat(64),
        },
        restoreContract: 'oa-sdk.codegen.typespec-restore.v1' as const,
        isolationPolicy: 'oa-sdk.spec-lens.typespec-isolation.v2' as const,
        resourcePolicy: {
          compileTimeoutMs: 60_000,
          compileMaxOutputBytes: 256 * 1024,
          compileMaxOldSpaceSizeMb: 512,
          sourceReadBudget: resolveSpecLensTypeSpecSourceReadBudget(),
          maxArtifactBytes: 32 * 1024 * 1024,
        },
      },
      compiler: {
        configSource: 'generated-allowlist' as const,
        emitter: '@typespec/openapi3' as const,
        openapiVersion: '3.2.0' as const,
        packageImports: ['@oa-sdk/typespec-decorators', '@typespec/http', '@typespec/openapi'],
        resources: {
          timeoutMs: 60_000,
          maxOutputBytes: 256 * 1024,
          maxOldSpaceSizeMb: 512,
          sourceReadBudget: resolveSpecLensTypeSpecSourceReadBudget(),
          maxArtifactBytes: 32 * 1024 * 1024,
          isolationPolicy: 'oa-sdk.spec-lens.typespec-isolation.v2' as const,
        },
      },
      validation: {
        emitted: { valid: true, summary: 'valid' },
        restored: { valid: true, summary: 'valid' },
      },
      gates: {
        compatibilitySidecar: 'pass' as const,
        restoredValidation: 'pass' as const,
      },
    },
    provenance: {
      schemaVersion: 'oa-sdk.typespec-ref-provenance.v1' as const,
      provenanceKind: 'typespec-source-ast' as const,
      inputs: {
        sourceRoot: '.',
        sourceSha256: 'a'.repeat(64),
        restoredOpenApiSha256: 'b'.repeat(64),
        toolchainFingerprint: 'c'.repeat(64),
      },
      declarations: [{
        id: 'operation:main.tsp:getTest',
        kind: 'operation' as const,
        symbol: 'getTest',
        source: { file: 'main.tsp', start: { line: 1, column: 1 }, end: { line: 1, column: 10 } },
      }],
      edges: [{
        kind: 'emits' as const,
        declarationId: 'operation:main.tsp:getTest',
        outputPointer: `#/paths/${path.replaceAll('/', '~1')}/get`,
      }],
      exclusions: [],
    },
  }
}
