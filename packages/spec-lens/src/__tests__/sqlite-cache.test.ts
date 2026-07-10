import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteCache } from '../infrastructure/cache/sqlite/sqlite-cache.js'
import type { SpecFileEntry, SpecRevision, SpecSnapshotStored, SpecTimelineDiff, SpecTimelineEntry } from '../domain/index.js'

const PROJECT_A = 'project-a'
const PROJECT_B = 'project-b'

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
    provenance: {},
    composition: {} as never,
    diagnostics: [],
    builtAt: 1000,
    entryRefs: [{ relativePath: 'schema/User.yaml', contentHash: 'abc123' }],
  }
}

function makeEntries(): SpecFileEntry[] {
  return [{ relativePath: 'schema/User.yaml', content: 'type: object', contentHash: 'abc123' }]
}

function makeDiff(baseId: string, headId: string, projectKey = PROJECT_A): SpecTimelineDiff {
  const base = makeRevision(baseId)
  const head = makeRevision(headId)
  return {
    schemaVersion: 'spec-lens.diff.v2',
    projectKey,
    baseRevision: base,
    headRevision: head,
    normalizedDiff: [{ category: 'component', kind: 'added', pointer: '#/components/schemas/User', message: 'schema added.' }],
    breakingDiff: [],
    provenanceDiff: [],
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

let cache: SqliteCache
let tmpDir: string

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
    const snapshot: SpecSnapshotStored = {
      schemaVersion: 'spec-lens.snapshot.v2',
      projectKey: PROJECT_B,
      projectKind: 'typespec-bundle',
      sourceRoot: 'packages/schemas/typespec',
      manifestPath: 'packages/schemas/typespec/oa-sdk.typespec-bundle.json',
      revision: makeRevision('rev-typespec'),
      spec: null,
      provenance: {},
      diagnostics: [{
        code: 'typespec-builder/pending',
        severity: 'info',
        message: 'fixture',
      }],
      builtAt: 1000,
      entryRefs: [],
    }
    await cache.saveSnapshot(snapshot, [])
    const loaded = await cache.getSnapshotByRevision('rev-typespec', PROJECT_B)
    expect(loaded).toMatchObject({
      projectKind: 'typespec-bundle',
      manifestPath: 'packages/schemas/typespec/oa-sdk.typespec-bundle.json',
    })
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
})

describe('SqliteCache — path read model', () => {
  it('isolates the same API path by projectKey', async () => {
    await cache.upsertPathEntries(PROJECT_A, [makePathEntry('a.yaml')])
    await cache.upsertPathEntries(PROJECT_B, [makePathEntry('b.tsp')])

    expect((await cache.listPaths({ projectKey: PROJECT_A }))[0]?.sourceFile).toBe('a.yaml')
    expect((await cache.listPaths({ projectKey: PROJECT_B }))[0]?.sourceFile).toBe('b.tsp')
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
    await cache.upsertPathEntries(PROJECT_A, [makePathEntry('a.yaml')])

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
