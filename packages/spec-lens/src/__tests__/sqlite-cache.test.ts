import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteCache } from '../infrastructure/cache/sqlite/sqlite-cache.js'
import type { SpecFileEntry, SpecRevision, SpecSnapshotStored, SpecTimelineDiff, SpecTimelineEntry } from '../domain/index.js'

function makeRevision(id: string): SpecRevision {
  return { id, shortId: id.slice(0, 7), timestamp: 1000, message: 'test', source: 'local-git' }
}

function makeSnapshot(id: string, fragmentsDir: string, targetPath: string): SpecSnapshotStored {
  return {
    schemaVersion: 'spec-lens.snapshot.v1',
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

function makeDiff(baseId: string, headId: string): SpecTimelineDiff {
  const base = makeRevision(baseId)
  const head = makeRevision(headId)
  return {
    schemaVersion: 'spec-lens.diff.v1',
    baseRevision: base,
    headRevision: head,
    normalizedDiff: [{ category: 'component', kind: 'added', pointer: '#/components/schemas/User', message: 'schema added.' }],
    breakingDiff: [],
    provenanceDiff: [],
    affectedFragments: ['schema/User.yaml'],
    stats: { pathsAdded: 0, pathsRemoved: 0, pathsChanged: 0, schemasAdded: 1, schemasRemoved: 0, schemasChanged: 0, breakingChanges: 0 },
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

    const loaded = await cache.getSnapshotByRevision('rev-001', '/fragments', 'book-api', 'test-digest')
    expect(loaded).not.toBeNull()
    expect(loaded?.revision.id).toBe('rev-001')
    expect(loaded?.entryRefs).toHaveLength(1)
    expect(loaded?.entryRefs[0]?.relativePath).toBe('schema/User.yaml')
  })

  it('returns null for unknown revision', async () => {
    const result = await cache.getSnapshotByRevision('unknown', '/fragments', 'book-api', 'test-digest')
    expect(result).toBeNull()
  })

  it('isolates by fragmentsDir + targetPath', async () => {
    await cache.saveSnapshot(makeSnapshot('rev-001', '/fragments-a', 'api-a'), makeEntries())
    expect(await cache.getSnapshotByRevision('rev-001', '/fragments-b', 'api-a', 'test-digest')).toBeNull()
    expect(await cache.getSnapshotByRevision('rev-001', '/fragments-a', 'api-b', 'test-digest')).toBeNull()
    expect(await cache.getSnapshotByRevision('rev-001', '/fragments-a', 'api-a', 'test-digest')).not.toBeNull()
  })

  it('stores blob content and retrieves it', async () => {
    await cache.saveSnapshot(makeSnapshot('rev-001', '/f', 'api'), makeEntries())
    const blob = await cache.getFragmentBlob('abc123')
    expect(blob).toBe('type: object')
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
    await cache.saveDiff(diff, '/fragments', 'book-api')

    const loaded = await cache.getDiff('base-001', 'head-001', '/fragments', 'book-api')
    expect(loaded).not.toBeNull()
    expect(loaded?.stats.schemasAdded).toBe(1)
    expect(loaded?.affectedFragments).toEqual(['schema/User.yaml'])
  })

  it('returns null when fragmentsDir does not match', async () => {
    const diff = makeDiff('base-001', 'head-001')
    await cache.saveDiff(diff, '/fragments', 'book-api')
    expect(await cache.getDiff('base-001', 'head-001', '/other', 'book-api')).toBeNull()
  })

  it('returns null when targetPath does not match', async () => {
    const diff = makeDiff('base-001', 'head-001')
    await cache.saveDiff(diff, '/fragments', 'book-api')
    expect(await cache.getDiff('base-001', 'head-001', '/fragments', 'other-api')).toBeNull()
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
    await cache.upsertTimelineEntry(entry, '/fragments', 'book-api')

    const list = await cache.listTimeline({ fragmentsDir: '/fragments', targetPath: 'book-api' })
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
    await cache.upsertTimelineEntry(entry, '/f', 'api')
    await cache.upsertTimelineEntry({ ...entry, diffStats: { ...entry.diffStats, pathsAdded: 5 } }, '/f', 'api')

    const list = await cache.listTimeline({ fragmentsDir: '/f', targetPath: 'api' })
    expect(list).toHaveLength(1)
    expect(list[0]?.diffStats.pathsAdded).toBe(5)
  })

  it('isolates by fragmentsDir + targetPath', async () => {
    const entry: SpecTimelineEntry = {
      revision: makeRevision('rev-001'),
      affectedFiles: [],
      snapshotCached: true,
      diffStats: { pathsAdded: 0, pathsRemoved: 0, pathsChanged: 0, breakingChanges: 0 },
    }
    await cache.upsertTimelineEntry(entry, '/f-a', 'api-a')
    await cache.upsertTimelineEntry(entry, '/f-b', 'api-b')

    expect(await cache.listTimeline({ fragmentsDir: '/f-a', targetPath: 'api-a' })).toHaveLength(1)
    expect(await cache.listTimeline({ fragmentsDir: '/f-b', targetPath: 'api-b' })).toHaveLength(1)
    expect(await cache.listTimeline({ fragmentsDir: '/f-a', targetPath: 'api-b' })).toHaveLength(0)
  })

  it('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      const entry: SpecTimelineEntry = {
        revision: { ...makeRevision(`rev-00${i}`), timestamp: i },
        affectedFiles: [],
        snapshotCached: true,
        diffStats: { pathsAdded: 0, pathsRemoved: 0, pathsChanged: 0, breakingChanges: 0 },
      }
      await cache.upsertTimelineEntry(entry, '/f', 'api')
    }
    const list = await cache.listTimeline({ fragmentsDir: '/f', targetPath: 'api', limit: 3 })
    expect(list).toHaveLength(3)
  })
})

describe('SqliteCache — clearCache', () => {
  it('removes snapshots, entries, diffs, timeline, and returns counts', async () => {
    await cache.saveSnapshot(makeSnapshot('rev-001', '/f', 'api'), makeEntries())
    await cache.saveDiff(makeDiff('base', 'rev-001'), '/f', 'api')
    await cache.upsertTimelineEntry(
      { revision: makeRevision('rev-001'), affectedFiles: [], snapshotCached: true,
        diffStats: { pathsAdded: 0, pathsRemoved: 0, pathsChanged: 0, breakingChanges: 0 } },
      '/f', 'api',
    )

    const result = await cache.clearCache('/f', 'api')
    expect(result.deletedSnapshots).toBe(1)
    expect(result.deletedDiffs).toBe(1)
    expect(result.deletedTimeline).toBe(1)
    expect(result.deletedEntries).toBe(1)

    expect(await cache.getSnapshotByRevision('rev-001', '/f', 'api', 'test-digest')).toBeNull()
    expect(await cache.listTimeline({ fragmentsDir: '/f', targetPath: 'api' })).toHaveLength(0)
  })

  it('removes orphaned fragment_blobs after clear', async () => {
    await cache.saveSnapshot(makeSnapshot('rev-001', '/f', 'api'), makeEntries())
    expect(await cache.getFragmentBlob('abc123')).toBe('type: object')

    const result = await cache.clearCache('/f', 'api')
    expect(result.deletedBlobs).toBe(1)
    expect(await cache.getFragmentBlob('abc123')).toBeNull()
  })

  it('does not remove blobs shared with another target', async () => {
    await cache.saveSnapshot(makeSnapshot('rev-001', '/f', 'api-a'), makeEntries())
    await cache.saveSnapshot(makeSnapshot('rev-002', '/f', 'api-b'), makeEntries())

    await cache.clearCache('/f', 'api-a')
    // abc123 still referenced by api-b snapshot_entry
    expect(await cache.getFragmentBlob('abc123')).toBe('type: object')
  })

  it('does not delete data for a different target', async () => {
    await cache.saveSnapshot(makeSnapshot('rev-001', '/f', 'api-a'), makeEntries())
    await cache.saveSnapshot(makeSnapshot('rev-001', '/f', 'api-b'), makeEntries())

    await cache.clearCache('/f', 'api-a')
    expect(await cache.getSnapshotByRevision('rev-001', '/f', 'api-b', 'test-digest')).not.toBeNull()
  })
})

describe('SqliteCache — schemaVersion and malformed data guards', () => {
  it('returns null for snapshot with wrong schemaVersion in DB', async () => {
    const snap = makeSnapshot('rev-bad', '/f', 'api')
    const broken = { ...snap, schemaVersion: 'spec-lens.snapshot.v99' }
    await cache.saveSnapshot(broken as never, makeEntries())
    expect(await cache.getSnapshotByRevision('rev-bad', '/f', 'api', 'test-digest')).toBeNull()
  })

  it('returns null for diff with wrong schemaVersion in DB', async () => {
    const diff = makeDiff('base', 'head')
    const broken = { ...diff, schemaVersion: 'spec-lens.diff.v99' }
    await cache.saveDiff(broken as never, '/f', 'api')
    expect(await cache.getDiff('base', 'head', '/f', 'api')).toBeNull()
  })
})
