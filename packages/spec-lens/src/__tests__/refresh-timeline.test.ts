import { describe, expect, it, vi } from 'vitest'
import { RefreshTimelineHandler } from '../application/commands/refresh-timeline.command.js'
import type { CachePort } from '../application/ports/cache.port.js'
import type { SnapshotBuilderPort } from '../application/ports/snapshot-builder.port.js'
import type { SpecSourcePort } from '../application/ports/spec-source.port.js'
import type { SpecRevision, SpecSnapshotStored, SpecTimelineDiff } from '../domain/index.js'

function makeRevision(id: string, timestamp = 1000): SpecRevision {
  return { id, shortId: id.slice(0, 7), timestamp, message: `commit ${id}`, source: 'local-git' }
}

function makeStored(id: string, spec: Record<string, unknown> = {}): SpecSnapshotStored {
  return {
    schemaVersion: 'spec-lens.snapshot.v1',
    revision: makeRevision(id),
    fragmentsDir: '/f',
    targetPath: '/t',
    targetConfigDigest: 'd',
    spec,
    provenance: {},
    composition: {} as never,
    diagnostics: [],
    builtAt: 1000,
    entryRefs: [],
  }
}

function makeDiff(partial: Partial<SpecTimelineDiff['stats']> = {}, normalizedDiff: SpecTimelineDiff['normalizedDiff'] = []): SpecTimelineDiff {
  return {
    schemaVersion: 'spec-lens.diff.v1',
    baseRevision: makeRevision('base'),
    headRevision: makeRevision('head'),
    normalizedDiff,
    breakingDiff: [],
    provenanceDiff: [],
    affectedFragments: [],
    stats: {
      pathsAdded: 0, pathsRemoved: 0, pathsChanged: 0,
      schemasAdded: 0, schemasRemoved: 0, schemasChanged: 0,
      breakingChanges: 0,
      ...partial,
    },
  }
}

const OPTIONS = {
  fragmentsDir: '/f',
  targetPath: '/t',
  targetConfig: {} as never,
  targetConfigDigest: 'd',
}

describe('RefreshTimelineHandler', () => {
  it('counts only cache misses as newRevisions', async () => {
    const revisions = [makeRevision('r1'), makeRevision('r2'), makeRevision('r3')]
    const cached = makeStored('r1')

    const source: SpecSourcePort = {
      listRevisions: vi.fn().mockResolvedValue(revisions),
      getFileEntries: vi.fn().mockResolvedValue([]),
    } as unknown as SpecSourcePort

    const builder: SnapshotBuilderPort = {
      build: vi.fn().mockResolvedValue(makeStored('x')),
      diff: vi.fn().mockReturnValue(makeDiff()),
    } as unknown as SnapshotBuilderPort

    const cache: CachePort = {
      getSnapshotByRevision: vi.fn().mockImplementation((id: string) =>
        Promise.resolve(id === 'r1' ? cached : null)),
      saveSnapshot: vi.fn().mockResolvedValue(undefined),
      saveDiff: vi.fn().mockResolvedValue(undefined),
      getDiff: vi.fn().mockResolvedValue(null),
      upsertTimelineEntry: vi.fn().mockResolvedValue(undefined),
      upsertPathEntries: vi.fn().mockResolvedValue(undefined),
    } as unknown as CachePort

    const handler = new RefreshTimelineHandler(source, builder, cache)
    const result = await handler.handle(OPTIONS)

    // r1 was cached — only r2 and r3 are new
    expect(result.newRevisions).toBe(2)
    expect(result.builtSnapshots).toBe(2)
    expect(result.errors).toHaveLength(0)
  })

  it('records build failure as snapshotCached=false timeline entry', async () => {
    const revisions = [makeRevision('r1')]

    const source: SpecSourcePort = {
      listRevisions: vi.fn().mockResolvedValue(revisions),
      getFileEntries: vi.fn().mockResolvedValue([]),
    } as unknown as SpecSourcePort

    const builder: SnapshotBuilderPort = {
      build: vi.fn().mockRejectedValue(new Error('parse failed')),
      diff: vi.fn(),
    } as unknown as SnapshotBuilderPort

    const upsertTimelineEntry = vi.fn().mockResolvedValue(undefined)
    const cache: CachePort = {
      getSnapshotByRevision: vi.fn().mockResolvedValue(null),
      saveSnapshot: vi.fn(),
      saveDiff: vi.fn(),
      getDiff: vi.fn().mockResolvedValue(null),
      upsertTimelineEntry,
      upsertPathEntries: vi.fn().mockResolvedValue(undefined),
    } as unknown as CachePort

    const handler = new RefreshTimelineHandler(source, builder, cache)
    const result = await handler.handle(OPTIONS)

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.message).toBe('parse failed')
    expect(upsertTimelineEntry).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotCached: false }),
      '/f',
      '/t',
    )
  })

  it('assigns lastChanged using newest-first diff traversal', async () => {
    // r1 (newest) → r2 → r3 (oldest)
    // diff r2→r1 shows /users changed; diff r3→r2 shows /users changed too
    // /users lastChanged should be r1 (newest), not r2
    const r1 = makeRevision('r1', 3000)
    const r2 = makeRevision('r2', 2000)
    const r3 = makeRevision('r3', 1000)
    const revisions = [r1, r2, r3]

    const spec = {
      openapi: '3.1.0',
      info: { title: 'test', version: '1' },
      paths: {
        '/users': { get: { responses: { '200': { description: 'ok' } } } },
      },
    }

    const prov = { '#/paths/~1users': { canonicalId: 'path:public/users/Users', kind: 'path', sourcePath: 'f.yaml', sourcePointer: '#', contentHash: 'h' } } as never
    const stored1 = { ...makeStored('r1', spec), revision: r1, provenance: prov }
    const stored2 = { ...makeStored('r2', spec), revision: r2, provenance: prov }
    const stored3 = { ...makeStored('r3', spec), revision: r3, provenance: prov }

    const diff_r2_r1 = makeDiff({}, [{ category: 'path', kind: 'changed', pointer: '#/paths/~1users', message: 'changed' }])
    const diff_r3_r2 = makeDiff({}, [{ category: 'path', kind: 'changed', pointer: '#/paths/~1users', message: 'changed' }])

    const source: SpecSourcePort = {
      listRevisions: vi.fn().mockResolvedValue(revisions),
      getFileEntries: vi.fn().mockResolvedValue([]),
    } as unknown as SpecSourcePort

    const builder: SnapshotBuilderPort = {
      build: vi.fn().mockResolvedValue(makeStored('x')),
      diff: vi.fn().mockReturnValue(makeDiff()),
    } as unknown as SnapshotBuilderPort

    const storedMap: Record<string, SpecSnapshotStored> = { r1: stored1, r2: stored2, r3: stored3 }
    const upsertPathEntries = vi.fn().mockResolvedValue(undefined)
    const cache: CachePort = {
      getSnapshotByRevision: vi.fn().mockImplementation((id: string) =>
        Promise.resolve(storedMap[id] ?? null)),
      saveSnapshot: vi.fn().mockResolvedValue(undefined),
      saveDiff: vi.fn().mockResolvedValue(undefined),
      getDiff: vi.fn().mockImplementation((baseId: string, headId: string) => {
        if (baseId === 'r2' && headId === 'r1') return Promise.resolve(diff_r2_r1)
        if (baseId === 'r3' && headId === 'r2') return Promise.resolve(diff_r3_r2)
        return Promise.resolve(null)
      }),
      upsertTimelineEntry: vi.fn().mockResolvedValue(undefined),
      upsertPathEntries,
    } as unknown as CachePort

    const handler = new RefreshTimelineHandler(source, builder, cache)
    await handler.handle(OPTIONS)

    expect(upsertPathEntries).toHaveBeenCalled()
    const pathEntries = upsertPathEntries.mock.calls[0]?.[2] as Array<{ path: string; lastChangedRevisionId: string }>
    const usersEntry = pathEntries?.find(e => e.path === '/users')
    expect(usersEntry?.lastChangedRevisionId).toBe('r1')
  })

  it('treats getSnapshotByRevision rejection as cache miss and builds the revision', async () => {
    const revisions = [makeRevision('r1')]

    const source: SpecSourcePort = {
      listRevisions: vi.fn().mockResolvedValue(revisions),
      getFileEntries: vi.fn().mockResolvedValue([]),
    } as unknown as SpecSourcePort

    const built = makeStored('r1')
    const builder: SnapshotBuilderPort = {
      build: vi.fn().mockResolvedValue(built),
      diff: vi.fn().mockReturnValue(makeDiff()),
    } as unknown as SnapshotBuilderPort

    const saveSnapshot = vi.fn().mockResolvedValue(undefined)
    const cache: CachePort = {
      // throws instead of returning null — must be treated as miss
      getSnapshotByRevision: vi.fn().mockRejectedValue(new Error('DB locked')),
      saveSnapshot,
      saveDiff: vi.fn().mockResolvedValue(undefined),
      getDiff: vi.fn().mockResolvedValue(null),
      upsertTimelineEntry: vi.fn().mockResolvedValue(undefined),
      upsertPathEntries: vi.fn().mockResolvedValue(undefined),
    } as unknown as CachePort

    const handler = new RefreshTimelineHandler(source, builder, cache)
    const result = await handler.handle(OPTIONS)

    expect(result.newRevisions).toBe(1)
    expect(result.builtSnapshots).toBe(1)
    expect(saveSnapshot).toHaveBeenCalledOnce()
  })
})
