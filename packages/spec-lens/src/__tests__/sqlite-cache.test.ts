import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveSpecLensTypeSpecSourceReadBudget } from '@oa-sdk/codegen/spec-lens'
import { SqliteCache } from '../infrastructure/cache/sqlite/sqlite-cache.js'
import type { SpecFileEntry, SpecRevision, SpecSnapshotStored, SpecTimelineDiff, SpecTimelineEntry } from '../domain/index.js'

const PROJECT_A = 'project-a'
const PROJECT_B = 'project-b'
const TEST_TOOLCHAIN_FINGERPRINT = 'a'.repeat(64)

function makeRevision(id: string): SpecRevision {
  return { id, shortId: id.slice(0, 7), timestamp: 1000, message: 'test', source: 'local-git' }
}

function makeSnapshot(
  id: string,
  fragmentsDir: string,
  targetPath: string,
  projectKey = PROJECT_A,
): SpecSnapshotStored {
  return {
    schemaVersion: 'spec-lens.snapshot.v2',
    projectKey,
    projectKind: 'definition-builder',
    sourceRoot: fragmentsDir,
    revision: makeRevision(id),
    fragmentsDir,
    targetPath,
    targetConfigDigest: 'test-digest',
    spec: { openapi: '3.1.0', info: { title: 'test', version: '1' }, paths: {} },
    provenance: { status: 'available', kind: 'definition-builder', entries: {} },
    composition: makeComposition(fragmentsDir, targetPath),
    diagnostics: [],
    builtAt: 1000,
    entryRefs: [{ relativePath: 'schema/User.yaml', contentHash: 'abc123' }],
  }
}

function makeEntries(): SpecFileEntry[] {
  return [{ relativePath: 'schema/User.yaml', content: 'type: object', contentHash: 'abc123' }]
}

function makeComposition(fragmentsDir: string, targetPath: string) {
  return {
    schemaVersion: 'oa-gen.composition-report.v1' as const,
    target: {
      name: 'test',
      targetPath,
      fragmentsDir,
      scopes: [],
      domains: [],
      includePaths: [],
      includeDefinitions: [],
    },
    summary: {
      registryNodeCount: 0,
      selectedNodeCount: 0,
      directPathCount: 0,
      directDefinitionCount: 0,
      transitiveComponentCount: 0,
      omittedNodeCount: 0,
      sourceRefCount: 0,
      outputAliasCount: 0,
      renamedOutputAliasCount: 0,
      collisionReportCount: 0,
    },
    selected: {
      directPathIds: [],
      directDefinitionIds: [],
      transitiveComponentIds: [],
      selectedNodeIds: [],
    },
    output: { paths: [], components: [], aliases: [], renamedAliases: [], collisionReport: [] },
    omitted: { total: 0, byScope: {}, byDomain: {}, byKind: {} },
    sourceRefs: [],
  }
}

function makeDiff(baseId: string, headId: string, projectKey = PROJECT_A): SpecTimelineDiff {
  const base = makeRevision(baseId)
  const head = makeRevision(headId)
  return {
    schemaVersion: 'spec-lens.diff.v2',
    projectKey,
    projectKind: 'definition-builder',
    baseRevision: base,
    headRevision: head,
    normalizedDiff: [{ category: 'component', kind: 'added', pointer: '#/components/schemas/User', message: 'schema added.' }],
    breakingDiff: [],
    provenanceDiff: { status: 'available', kind: 'definition-builder', entries: [] },
    affectedFragments: ['schema/User.yaml'],
    stats: { pathsAdded: 0, pathsRemoved: 0, pathsChanged: 0, schemasAdded: 1, schemasRemoved: 0, schemasChanged: 0, breakingChanges: 0 },
  }
}

function makePathEntry(sourceFile: string) {
  return {
    path: '/users',
    methods: ['get'],
    canonicalId: 'path:public/users/Users',
    scope: 'public',
    domain: 'users',
    sourceFile,
    contentHash: `hash-${sourceFile}`,
    lastChangedRevisionId: 'rev-001',
    lastChangedTimestamp: 1000,
  }
}

function makeTypeSpecSnapshot(id: string): SpecSnapshotStored {
  return {
    schemaVersion: 'spec-lens.snapshot.v2',
    projectKey: PROJECT_B,
    projectKind: 'typespec-bundle',
    sourceRoot: 'packages/schemas/typespec',
    manifestPath: 'packages/schemas/typespec/oa-sdk.typespec-bundle.json',
    revision: makeRevision(id),
    spec: null,
    provenance: {
      status: 'unavailable',
      kind: 'typespec-source-files',
      reason: 'output-pointer-mapping-unavailable',
      sourceFiles: [{ relativePath: 'main.tsp', contentHash: 'tsp-hash' }],
      observedInputs: [],
      compile: {
        schemaVersion: 'oa-sdk.spec-lens.typespec-compile.v1',
        manifestSchemaVersion: 'oa-sdk.typespec-bundle.v1',
        entrypoint: 'main.tsp',
        sourceFiles: ['main.tsp'],
        compatibilitySource: 'typespec-extensions',
        toolchain: {
          schemaVersion: 'oa-sdk.spec-lens.typespec-toolchain.v1',
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
          restoreContract: 'oa-sdk.codegen.typespec-restore.v1',
          isolationPolicy: 'oa-sdk.spec-lens.typespec-isolation.v2',
          resourcePolicy: {
            compileTimeoutMs: 60_000,
            compileMaxOutputBytes: 256 * 1024,
            compileMaxOldSpaceSizeMb: 512,
            sourceReadBudget: resolveSpecLensTypeSpecSourceReadBudget(),
            maxArtifactBytes: 32 * 1024 * 1024,
          },
        },
        compiler: {
          configSource: 'generated-allowlist',
          emitter: '@typespec/openapi3',
          openapiVersion: '3.2.0',
          packageImports: ['@oa-sdk/typespec-decorators', '@typespec/http', '@typespec/openapi'],
          resources: {
            timeoutMs: 60_000,
            maxOutputBytes: 256 * 1024,
            maxOldSpaceSizeMb: 512,
            sourceReadBudget: resolveSpecLensTypeSpecSourceReadBudget(),
            maxArtifactBytes: 32 * 1024 * 1024,
            isolationPolicy: 'oa-sdk.spec-lens.typespec-isolation.v2',
          },
        },
        validation: {
          emitted: { valid: true, summary: 'valid' },
          restored: { valid: true, summary: 'valid' },
        },
        gates: {
          compatibilitySidecar: 'pass',
          emittedValidation: 'pass',
          restoredValidation: 'pass',
          provenance: 'pass',
        },
      },
    },
    diagnostics: [{
      code: 'typespec-builder/pending',
      severity: 'info',
      message: 'fixture',
    }],
    builtAt: 1000,
    entryRefs: [{ relativePath: 'main.tsp', contentHash: 'tsp-hash' }],
  }
}

let cache: SqliteCache
let tmpDir: string

function overwriteStoredJson(
  table: 'snapshots' | 'diffs',
  where: string,
  params: string[],
  value: unknown,
): void {
  runRaw(`UPDATE ${table} SET data = ? WHERE ${where}`, JSON.stringify(value), ...params)
}

function runRaw(sql: string, ...values: string[]): void {
  const raw = cache as unknown as { db: { prepare(statement: string): { run(...args: string[]): unknown } } }
  raw.db.prepare(sql).run(...values)
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'spec-lens-test-'))
  cache = new SqliteCache(join(tmpDir, 'test.db'))
})

afterEach(() => {
  cache.close()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('SqliteCache — saveSnapshot / getSnapshotByRevision', () => {
  it('roundtrips a snapshot', async () => {
    const snap = makeSnapshot('rev-001', '/fragments', 'book-api')
    await cache.saveSnapshot(snap, makeEntries())

    const loaded = await cache.getSnapshotByRevision('rev-001', PROJECT_A)
    expect(loaded).not.toBeNull()
    expect(loaded?.revision.id).toBe('rev-001')
    expect(loaded?.entryRefs).toHaveLength(1)
    expect(loaded?.entryRefs[0]?.relativePath).toBe('schema/User.yaml')
  })

  it('returns null for unknown revision', async () => {
    const result = await cache.getSnapshotByRevision('unknown', PROJECT_A)
    expect(result).toBeNull()
  })

  it('isolates the same revision by projectKey', async () => {
    await cache.saveSnapshot(makeSnapshot('rev-001', '/fragments-a', 'api-a', PROJECT_A), makeEntries())
    await cache.saveSnapshot(makeSnapshot('rev-001', '/fragments-a', 'api-a', PROJECT_B), makeEntries())
    expect((await cache.getSnapshotByRevision('rev-001', PROJECT_A))?.projectKey).toBe(PROJECT_A)
    expect((await cache.getSnapshotByRevision('rev-001', PROJECT_B))?.projectKey).toBe(PROJECT_B)
  })

  it('stores blob content and retrieves it', async () => {
    await cache.saveSnapshot(makeSnapshot('rev-001', '/f', 'api'), makeEntries())
    const blob = await cache.getFragmentBlob('abc123')
    expect(blob).toBe('type: object')
  })

  it('stores the TypeSpec snapshot shape without Definition Builder fields', async () => {
    const snapshot = makeTypeSpecSnapshot('rev-typespec')
    await cache.saveSnapshot(snapshot, [])
    const loaded = await cache.getSnapshotByRevision('rev-typespec', PROJECT_B)
    expect(loaded).toMatchObject({
      projectKind: 'typespec-bundle',
      manifestPath: 'packages/schemas/typespec/oa-sdk.typespec-bundle.json',
    })
    expect(await cache.getSnapshotByRevision(
      'rev-typespec',
      PROJECT_B,
      'different-toolchain-fingerprint',
    )).toBeNull()
    expect(await cache.getSnapshotByRevision(
      'rev-typespec',
      PROJECT_B,
      TEST_TOOLCHAIN_FINGERPRINT,
    )).not.toBeNull()
  })

  it('deduplicates blobs across snapshots', async () => {
    await cache.saveSnapshot(makeSnapshot('rev-001', '/f', 'api'), makeEntries())
    await cache.saveSnapshot(makeSnapshot('rev-002', '/f', 'api'), makeEntries())
    const blob = await cache.getFragmentBlob('abc123')
    expect(blob).toBe('type: object')
  })
})

describe('SqliteCache — saveDiff / getDiff', () => {
  it('roundtrips a diff with explicit fragmentsDir/targetPath', async () => {
    const diff = makeDiff('base-001', 'head-001')
    await cache.saveDiff(diff, PROJECT_A)

    const loaded = await cache.getDiff('base-001', 'head-001', PROJECT_A)
    expect(loaded).not.toBeNull()
    expect(loaded?.stats.schemasAdded).toBe(1)
    expect(loaded?.affectedFragments).toEqual(['schema/User.yaml'])
  })

  it('isolates diffs by projectKey', async () => {
    const diff = makeDiff('base-001', 'head-001')
    await cache.saveDiff(diff, PROJECT_A)
    expect(await cache.getDiff('base-001', 'head-001', PROJECT_B)).toBeNull()
  })
})

describe('SqliteCache — upsertTimelineEntry / listTimeline', () => {
  it('roundtrips a timeline entry', async () => {
    const entry: SpecTimelineEntry = {
      revision: makeRevision('rev-001'),
      affectedFiles: ['schema/User.yaml'],
      snapshotCached: true,
      diffStats: { pathsAdded: 2, pathsRemoved: 0, pathsChanged: 1, breakingChanges: 1 },
}

    await cache.upsertTimelineEntry(entry, PROJECT_A)

    const list = await cache.listTimeline({ projectKey: PROJECT_A })
    expect(list).toHaveLength(1)
    expect(list[0]?.revision.id).toBe('rev-001')
    expect(list[0]?.diffStats.pathsAdded).toBe(2)
    expect(list[0]?.diffStats.breakingChanges).toBe(1)
    expect(list[0]?.affectedFiles).toEqual(['schema/User.yaml'])
  })

  it('upsert overwrites on duplicate revision+fragmentsDir+targetPath', async () => {
    const entry: SpecTimelineEntry = {
      revision: makeRevision('rev-001'),
      affectedFiles: [],
      snapshotCached: false,
      diffStats: { pathsAdded: 0, pathsRemoved: 0, pathsChanged: 0, breakingChanges: 0 },
    }
    await cache.upsertTimelineEntry(entry, PROJECT_A)
    await cache.upsertTimelineEntry({ ...entry, diffStats: { ...entry.diffStats, pathsAdded: 5 } }, PROJECT_A)

    const list = await cache.listTimeline({ projectKey: PROJECT_A })
    expect(list).toHaveLength(1)
    expect(list[0]?.diffStats.pathsAdded).toBe(5)
  })

  it('isolates timeline entries by projectKey', async () => {
    const entry: SpecTimelineEntry = {
      revision: makeRevision('rev-001'),
      affectedFiles: [],
      snapshotCached: true,
      diffStats: { pathsAdded: 0, pathsRemoved: 0, pathsChanged: 0, breakingChanges: 0 },
    }
    await cache.upsertTimelineEntry(entry, PROJECT_A)
    await cache.upsertTimelineEntry(entry, PROJECT_B)

    expect(await cache.listTimeline({ projectKey: PROJECT_A })).toHaveLength(1)
    expect(await cache.listTimeline({ projectKey: PROJECT_B })).toHaveLength(1)
  })

  it('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      const entry: SpecTimelineEntry = {
        revision: { ...makeRevision(`rev-00${i}`), timestamp: i },
        affectedFiles: [],
        snapshotCached: true,
        diffStats: { pathsAdded: 0, pathsRemoved: 0, pathsChanged: 0, breakingChanges: 0 },
      }
      await cache.upsertTimelineEntry(entry, PROJECT_A)
    }
    const list = await cache.listTimeline({ projectKey: PROJECT_A, limit: 3 })
    expect(list).toHaveLength(3)
  })

  it('filters malformed affected-files JSON instead of trusting a read-model cast', async () => {
    await cache.upsertTimelineEntry({
      revision: makeRevision('bad-timeline-json'),
      affectedFiles: ['a.yaml'],
      snapshotCached: true,
      diffStats: { pathsAdded: 0, pathsRemoved: 0, pathsChanged: 0, breakingChanges: 0 },
    }, PROJECT_A)
    runRaw(
      'UPDATE timeline_entries SET affected_files = ? WHERE project_key = ? AND revision_id = ?',
      '{"not":"an-array"}',
      PROJECT_A,
      'bad-timeline-json',
    )
    expect(await cache.listTimeline({ projectKey: PROJECT_A })).toEqual([])
  })
})

describe('SqliteCache — path read model', () => {
  it('isolates the same API path by projectKey', async () => {
    await cache.replacePathEntries(PROJECT_A, [makePathEntry('a.yaml')])
    await cache.replacePathEntries(PROJECT_B, [makePathEntry('b.tsp')])

    expect((await cache.listPaths({ projectKey: PROJECT_A }))[0]?.sourceFile).toBe('a.yaml')
    expect((await cache.listPaths({ projectKey: PROJECT_B }))[0]?.sourceFile).toBe('b.tsp')
  })

  it('uses replace semantics so removed paths cannot survive refresh', async () => {
    await cache.replacePathEntries(PROJECT_A, [makePathEntry('a.yaml')])
    await cache.replacePathEntries(PROJECT_A, [])
    expect(await cache.listPaths({ projectKey: PROJECT_A })).toEqual([])
  })

  it('filters malformed methods JSON instead of trusting a read-model cast', async () => {
    await cache.replacePathEntries(PROJECT_A, [makePathEntry('a.yaml')])
    runRaw(
      'UPDATE path_entries SET methods = ? WHERE project_key = ? AND path = ?',
      '["get",7]',
      PROJECT_A,
      '/users',
    )
    expect(await cache.listPaths({ projectKey: PROJECT_A })).toEqual([])
  })
})

describe('SqliteCache — reachable revision reconciliation', () => {
  it('atomically removes stale snapshots, entries, diffs, timeline, paths, and orphan blobs', async () => {
    const reachable = makeSnapshot('reachable', '/f', '/t')
    const stale = makeSnapshot('stale', '/f', '/t')
    const reachableEntries = [{ relativePath: 'reachable.yaml', content: 'reachable', contentHash: 'hash-reachable' }]
    const staleEntries = [{ relativePath: 'stale.yaml', content: 'stale', contentHash: 'hash-stale' }]
    reachable.entryRefs = [{ relativePath: 'reachable.yaml', contentHash: 'hash-reachable' }]
    stale.entryRefs = [{ relativePath: 'stale.yaml', contentHash: 'hash-stale' }]
    await cache.saveSnapshot(reachable, reachableEntries)
    await cache.saveSnapshot(stale, staleEntries)
    await cache.saveDiff(makeDiff('stale', 'reachable'), PROJECT_A)
    for (const revision of [reachable.revision, stale.revision]) {
      await cache.upsertTimelineEntry({
        revision,
        affectedFiles: [],
        snapshotCached: true,
        diffStats: { pathsAdded: 0, pathsRemoved: 0, pathsChanged: 0, breakingChanges: 0 },
      }, PROJECT_A)
    }
    await cache.replacePathEntries(PROJECT_A, [makePathEntry('stale.yaml')])

    await cache.reconcileReachableRevisions(PROJECT_A, ['reachable'])

    expect(await cache.getSnapshotByRevision('reachable', PROJECT_A)).not.toBeNull()
    expect(await cache.getSnapshotByRevision('stale', PROJECT_A)).toBeNull()
    expect(await cache.getDiff('stale', 'reachable', PROJECT_A)).toBeNull()
    expect((await cache.listTimeline({ projectKey: PROJECT_A })).map(entry => entry.revision.id)).toEqual(['reachable'])
    expect(await cache.listPaths({ projectKey: PROJECT_A })).toEqual([])
    expect(await cache.getFragmentBlob('hash-reachable')).toBe('reachable')
    expect(await cache.getFragmentBlob('hash-stale')).toBeNull()
  })

  it('accepts authoritative histories larger than SQLite variable limits', async () => {
    const snapshot = makeSnapshot('reachable-large', '/f', '/t')
    await cache.saveSnapshot(snapshot, makeEntries())
    const revisions = [
      'reachable-large',
      ...Array.from({ length: 1_200 }, (_, index) => `historical-${index}`),
    ]

    await expect(cache.reconcileReachableRevisions(PROJECT_A, revisions)).resolves.toBeUndefined()
    expect(await cache.getSnapshotByRevision('reachable-large', PROJECT_A)).not.toBeNull()
  })
})

describe('SqliteCache — clearCache', () => {
  it('removes snapshots, entries, diffs, timeline, and returns counts', async () => {
    await cache.saveSnapshot(makeSnapshot('rev-001', '/f', 'api'), makeEntries())
    await cache.saveDiff(makeDiff('base', 'rev-001'), PROJECT_A)
    await cache.upsertTimelineEntry(
      { revision: makeRevision('rev-001'), affectedFiles: [], snapshotCached: true,
        diffStats: { pathsAdded: 0, pathsRemoved: 0, pathsChanged: 0, breakingChanges: 0 } },
      PROJECT_A,
    )
    await cache.replacePathEntries(PROJECT_A, [makePathEntry('a.yaml')])

    const result = await cache.clearCache(PROJECT_A)
    expect(result.deletedSnapshots).toBe(1)
    expect(result.deletedDiffs).toBe(1)
    expect(result.deletedTimeline).toBe(1)
    expect(result.deletedEntries).toBe(1)
    expect(result.deletedPaths).toBe(1)

    expect(await cache.getSnapshotByRevision('rev-001', PROJECT_A)).toBeNull()
    expect(await cache.listTimeline({ projectKey: PROJECT_A })).toHaveLength(0)
  })

  it('removes orphaned fragment_blobs after clear', async () => {
    await cache.saveSnapshot(makeSnapshot('rev-001', '/f', 'api'), makeEntries())
    expect(await cache.getFragmentBlob('abc123')).toBe('type: object')

    const result = await cache.clearCache(PROJECT_A)
    expect(result.deletedBlobs).toBe(1)
    expect(await cache.getFragmentBlob('abc123')).toBeNull()
  })

  it('does not remove blobs shared with another project', async () => {
    await cache.saveSnapshot(makeSnapshot('rev-001', '/f', 'api-a', PROJECT_A), makeEntries())
    await cache.saveSnapshot(makeSnapshot('rev-002', '/f', 'api-b', PROJECT_B), makeEntries())

    await cache.clearCache(PROJECT_A)
    // abc123 is still referenced by the project-b snapshot entry.
    expect(await cache.getFragmentBlob('abc123')).toBe('type: object')
  })

  it('does not delete data for a different project', async () => {
    await cache.saveSnapshot(makeSnapshot('rev-001', '/f', 'api-a', PROJECT_A), makeEntries())
    await cache.saveSnapshot(makeSnapshot('rev-001', '/f', 'api-b', PROJECT_B), makeEntries())

    await cache.clearCache(PROJECT_A)
    expect(await cache.getSnapshotByRevision('rev-001', PROJECT_B)).not.toBeNull()
  })
})

describe('SqliteCache — schemaVersion and malformed data guards', () => {
  it('returns null for snapshot with wrong schemaVersion in DB', async () => {
    const snap = makeSnapshot('rev-bad', '/f', 'api')
    const broken = { ...snap, schemaVersion: 'spec-lens.snapshot.v99' }
    await cache.saveSnapshot(broken as never, makeEntries())
    expect(await cache.getSnapshotByRevision('rev-bad', PROJECT_A)).toBeNull()
  })

  it('returns null for diff with wrong schemaVersion in DB', async () => {
    const diff = makeDiff('base', 'head')
    const broken = { ...diff, schemaVersion: 'spec-lens.diff.v99' }
    await cache.saveDiff(broken as never, PROJECT_A)
    expect(await cache.getDiff('base', 'head', PROJECT_A)).toBeNull()
  })

  it('treats a projectKind/provenance mismatch as a cache miss', async () => {
    const snapshot = makeSnapshot('rev-variant', '/f', 'api')
    const broken = {
      ...snapshot,
      projectKind: 'typespec-bundle',
      manifestPath: 'typespec/bundle.json',
    }
    await cache.saveSnapshot(broken as never, makeEntries())
    expect(await cache.getSnapshotByRevision('rev-variant', PROJECT_A)).toBeNull()
  })

  it('treats a malformed discriminated diff as a cache miss', async () => {
    const diff = makeDiff('base-variant', 'head-variant')
    const broken = {
      ...diff,
      projectKind: 'typespec-bundle',
    }
    await cache.saveDiff(broken as never, PROJECT_A)
    expect(await cache.getDiff('base-variant', 'head-variant', PROJECT_A)).toBeNull()
  })

  it('fails closed for malformed nested snapshot diagnostics, provenance, and composition', async () => {
    const malformed = [
      {
        ...makeSnapshot('bad-diagnostic', '/f', '/t'),
        diagnostics: [{ code: 'bad', severity: 'fatal', message: 'bad' }],
      },
      {
        ...makeSnapshot('bad-provenance', '/f', '/t'),
        provenance: {
          status: 'available',
          kind: 'definition-builder',
          entries: { '#/paths': { canonicalId: 'path:x', kind: 'path' } },
        },
      },
      {
        ...makeSnapshot('bad-composition', '/f', '/t'),
        composition: {
          ...makeComposition('/f', '/t'),
          summary: { ...makeComposition('/f', '/t').summary, registryNodeCount: 'zero' },
        },
      },
    ]

    for (const snapshot of malformed) {
      await cache.saveSnapshot(snapshot as never, makeEntries())
      expect(await cache.getSnapshotByRevision(snapshot.revision.id, PROJECT_A)).toBeNull()
    }
  })

  it('fails closed for malformed nested TypeSpec compile evidence', async () => {
    const snapshot = makeTypeSpecSnapshot('bad-compile')
    if (snapshot.projectKind !== 'typespec-bundle') throw new Error('invalid test fixture')
    const broken = {
      ...snapshot,
      provenance: {
        ...snapshot.provenance,
        compile: {
          ...snapshot.provenance.compile,
          compiler: {
            ...snapshot.provenance.compile.compiler,
            packageImports: ['@typespec/http', '@evil/runtime'],
          },
        },
      },
    }
    await cache.saveSnapshot(broken as never, [])
    expect(await cache.getSnapshotByRevision('bad-compile', PROJECT_B)).toBeNull()
  })

  it('fails closed for malformed nested normalized, breaking, provenance, and stats diff entries', async () => {
    const malformed = [
      { ...makeDiff('base-normalized', 'head-normalized'), normalizedDiff: [{ category: 'path', kind: 'added', pointer: '#/paths/x', message: 7 }] },
      { ...makeDiff('base-breaking', 'head-breaking'), breakingDiff: [{ code: 'x', endpoint: 'GET /x', detail: 'bad', severity: 'fatal' }] },
      { ...makeDiff('base-stats', 'head-stats'), stats: { ...makeDiff('x', 'y').stats, pathsAdded: -1 } },
      {
        ...makeDiff('base-provenance', 'head-provenance'),
        provenanceDiff: {
          status: 'available',
          kind: 'definition-builder',
          entries: [{ kind: 'changed', pointer: '#/paths/x', message: 'changed', base: { canonicalId: 'x' } }],
        },
      },
    ]

    for (const diff of malformed) {
      await cache.saveDiff(diff as never, PROJECT_A)
      expect(await cache.getDiff(diff.baseRevision.id, diff.headRevision.id, PROJECT_A)).toBeNull()
    }
  })

  it('rejects snapshot and diff payload revision IDs that disagree with their selected rows', async () => {
    const snapshot = makeSnapshot('row-snapshot', '/f', '/t')
    await cache.saveSnapshot(snapshot, makeEntries())
    overwriteStoredJson(
      'snapshots',
      'project_key = ? AND revision_id = ?',
      [PROJECT_A, 'row-snapshot'],
      { ...snapshot, revision: makeRevision('payload-snapshot') },
    )
    expect(await cache.getSnapshotByRevision('row-snapshot', PROJECT_A)).toBeNull()

    const diff = makeDiff('row-base', 'row-head')
    await cache.saveDiff(diff, PROJECT_A)
    overwriteStoredJson(
      'diffs',
      'project_key = ? AND base_revision_id = ? AND head_revision_id = ?',
      [PROJECT_A, 'row-base', 'row-head'],
      { ...diff, baseRevision: makeRevision('payload-base') },
    )
    expect(await cache.getDiff('row-base', 'row-head', PROJECT_A)).toBeNull()
  })
})

describe('SqliteCache — v2 invalidation', () => {
  it('drops an unscoped v1 cache and rebuilds the v2 schema', async () => {
    const legacyPath = join(tmpDir, 'legacy-v1.db')
    const legacy = new DatabaseSync(legacyPath)
    legacy.exec(`
      PRAGMA user_version = 1;
      CREATE TABLE snapshots (
        cache_key TEXT PRIMARY KEY,
        revision_id TEXT NOT NULL,
        fragments_dir TEXT NOT NULL,
        target_path TEXT NOT NULL,
        target_config_digest TEXT NOT NULL,
        data TEXT NOT NULL,
        built_at INTEGER NOT NULL
      );
      INSERT INTO snapshots VALUES ('old', 'rev-old', '/f', '/t', 'digest', '{}', 1);
    `)
    legacy.close()

    const migrated = new SqliteCache(legacyPath)
    expect(await migrated.getSnapshotByRevision('rev-old', PROJECT_A)).toBeNull()
    await migrated.saveSnapshot(makeSnapshot('rev-new', '/f', '/t'), makeEntries())
    expect(await migrated.getSnapshotByRevision('rev-new', PROJECT_A)).not.toBeNull()
    migrated.close()

    const verified = new DatabaseSync(legacyPath)
    const version = verified.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(version.user_version).toBe(2)
    verified.close()
  })

  it('refuses to overwrite a future cache schema', () => {
    const futurePath = join(tmpDir, 'future-v3.db')
    const future = new DatabaseSync(futurePath)
    future.exec('PRAGMA user_version = 3;')
    future.close()
    expect(() => new SqliteCache(futurePath)).toThrow('newer than supported schema 2')
  })
})
