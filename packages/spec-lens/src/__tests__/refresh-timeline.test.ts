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
    schemaVersion: 'spec-lens.snapshot.v2',
    projectKey: 'project-a',
    projectKind: 'definition-builder',
    sourceRoot: '/f',
    revision: makeRevision(id),
    fragmentsDir: '/f',
    targetPath: '/t',
    targetConfigDigest: 'd',
    spec,
    provenance: { status: 'available', kind: 'definition-builder', entries: {} },
    composition: {} as never,
    diagnostics: [],
    builtAt: 1000,
    entryRefs: [],
  }
}

function makeDiff(partial: Partial<SpecTimelineDiff['stats']> = {}, normalizedDiff: SpecTimelineDiff['normalizedDiff'] = []): SpecTimelineDiff {
  return {
    schemaVersion: 'spec-lens.diff.v2',
    projectKey: 'project-a',
    projectKind: 'definition-builder',
    baseRevision: makeRevision('base'),
    headRevision: makeRevision('head'),
    normalizedDiff,
    breakingDiff: [],
    provenanceDiff: { status: 'available', kind: 'definition-builder', entries: [] },
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
  kind: 'definition-builder' as const,
  project: {
    projectKey: 'project-a',
    sourceKind: 'definition-builder',
    sourceRoot: '/f',
    manifestOrTargetDigest: 'd',
    builderVersion: 'spec-lens.definition-builder.v1',
    snapshotSchemaVersion: 'spec-lens.snapshot.v2',
    toolchainFingerprint: 'oa-sdk.definition-builder.toolchain.v1',
    observation: {
      adapterKind: 'local-git',
      repository: 'file:///repo-a',
      ref: 'main',
    },
  } as const,
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

    const reconcileReachableRevisions = vi.fn().mockResolvedValue(undefined)
    const cache: CachePort = {
      getSnapshotByRevision: vi.fn().mockImplementation((id: string) =>
        Promise.resolve(id === 'r1' ? cached : null)),
      saveSnapshot: vi.fn().mockResolvedValue(undefined),
      saveDiff: vi.fn().mockResolvedValue(undefined),
      getDiff: vi.fn().mockResolvedValue(null),
      upsertTimelineEntry: vi.fn().mockResolvedValue(undefined),
      replacePathEntries: vi.fn().mockResolvedValue(undefined),
      reconcileReachableRevisions,
    } as unknown as CachePort

    const handler = new RefreshTimelineHandler(source, builder, cache)
    const result = await handler.handle(OPTIONS)

    // r1 was cached — only r2 and r3 are new
    expect(result.newRevisions).toBe(2)
    expect(result.builtSnapshots).toBe(2)
    expect(result.errors).toHaveLength(0)
    expect(source.listRevisions).toHaveBeenCalledWith({
      sourceRoot: '/f',
      sourceKind: 'definition-builder',
    })
    expect(source.getFileEntries).toHaveBeenCalledWith(expect.objectContaining({
      sourceRoot: '/f',
      sourceKind: 'definition-builder',
    }))
    expect(reconcileReachableRevisions).toHaveBeenCalledWith('project-a', ['r1', 'r2', 'r3'])
  })

  it('never prunes from an explicitly bounded revision window', async () => {
    const reconcileReachableRevisions = vi.fn().mockResolvedValue(undefined)
    const source = {
      listRevisions: vi.fn().mockResolvedValue([]),
      getFileEntries: vi.fn(),
    } as unknown as SpecSourcePort
    const cache = {
      reconcileReachableRevisions,
      replacePathEntries: vi.fn().mockResolvedValue(undefined),
    } as unknown as CachePort
    const handler = new RefreshTimelineHandler(
      source,
      { build: vi.fn(), diff: vi.fn() } as unknown as SnapshotBuilderPort,
      cache,
    )

    await handler.handle({ ...OPTIONS, limit: 2 })

    expect(source.listRevisions).toHaveBeenCalledWith(expect.objectContaining({ limit: 2 }))
    expect(reconcileReachableRevisions).not.toHaveBeenCalled()
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
      replacePathEntries: vi.fn().mockResolvedValue(undefined),
      reconcileReachableRevisions: vi.fn().mockResolvedValue(undefined),
    } as unknown as CachePort

    const handler = new RefreshTimelineHandler(source, builder, cache)
    const result = await handler.handle(OPTIONS)

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.message).toBe('parse failed')
    expect(upsertTimelineEntry).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotCached: false }),
      'project-a',
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

    const prov = {
      status: 'available' as const,
      kind: 'definition-builder' as const,
      entries: { '#/paths/~1users': { canonicalId: 'path:public/users/Users', kind: 'path', sourcePath: 'f.yaml', sourcePointer: '#', contentHash: 'h' } },
    } as never
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
    const replacePathEntries = vi.fn().mockResolvedValue(undefined)
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
      replacePathEntries,
      reconcileReachableRevisions: vi.fn().mockResolvedValue(undefined),
    } as unknown as CachePort

    const handler = new RefreshTimelineHandler(source, builder, cache)
    await handler.handle(OPTIONS)

    expect(replacePathEntries).toHaveBeenCalled()
    const pathEntries = replacePathEntries.mock.calls[0]?.[1] as Array<{ path: string; lastChangedRevisionId: string }>
    const usersEntry = pathEntries?.find(e => e.path === '/users')
    expect(usersEntry?.lastChangedRevisionId).toBe('r1')
  })

  it('maps escaped path-item diff pointers back to the spec path that changed in an older revision', async () => {
    // r1 (newest) → r2 → r3 (oldest). Nothing changed in r2→r1, so the
    // latest-revision fallback (r1) must not hide the r3→r2 change.
    const r1 = makeRevision('r1', 3000)
    const r2 = makeRevision('r2', 2000)
    const r3 = makeRevision('r3', 1000)
    const revisions = [r1, r2, r3]

    const ok = { get: { responses: { '200': { description: 'ok' } } } }
    const spec = {
      openapi: '3.1.0',
      info: { title: 'test', version: '1' },
      paths: { '/users': ok, '/a~b/{id}': ok, '/users/parameters': ok },
    }
    const provenanceEntry = (canonicalId: string) => ({ canonicalId, kind: 'path', sourcePath: 'f.yaml', sourcePointer: '#', contentHash: 'h' })
    const prov = {
      status: 'available' as const,
      kind: 'definition-builder' as const,
      entries: {
        '#/paths/~1users': provenanceEntry('path:public/users/Users'),
        '#/paths/~1a~0b~1{id}': provenanceEntry('path:public/users/Tilde'),
        '#/paths/~1users~1parameters': provenanceEntry('path:public/users/UserParameters'),
      },
    } as never
    const storedMap: Record<string, SpecSnapshotStored> = {
      r1: { ...makeStored('r1', spec), revision: r1, provenance: prov },
      r2: { ...makeStored('r2', spec), revision: r2, provenance: prov },
      r3: { ...makeStored('r3', spec), revision: r3, provenance: prov },
    }

    const diff_r2_r1 = makeDiff({}, [])
    const diff_r3_r2 = makeDiff({}, [
      { category: 'path', kind: 'changed', pointer: '#/paths/~1users', message: 'changed' },
      { category: 'path', kind: 'changed', pointer: '#/paths/~1a~0b~1{id}', message: 'changed' },
      // A pointer below a path item is not the path item `/users/parameters`.
      { category: 'path', kind: 'changed', pointer: '#/paths/~1users/parameters', message: 'changed' },
    ])

    const source: SpecSourcePort = {
      listRevisions: vi.fn().mockResolvedValue(revisions),
      getFileEntries: vi.fn().mockResolvedValue([]),
    } as unknown as SpecSourcePort
    const builder: SnapshotBuilderPort = {
      build: vi.fn().mockResolvedValue(makeStored('x')),
      diff: vi.fn().mockReturnValue(makeDiff()),
    } as unknown as SnapshotBuilderPort
    const replacePathEntries = vi.fn().mockResolvedValue(undefined)
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
      replacePathEntries,
      reconcileReachableRevisions: vi.fn().mockResolvedValue(undefined),
    } as unknown as CachePort

    await new RefreshTimelineHandler(source, builder, cache).handle(OPTIONS)

    const pathEntries = replacePathEntries.mock.calls[0]?.[1] as Array<{ path: string; lastChangedRevisionId: string }>
    const lastChangedByPath = Object.fromEntries(pathEntries.map(entry => [entry.path, entry.lastChangedRevisionId]))
    expect(lastChangedByPath).toEqual({
      '/users': 'r2',
      '/a~b/{id}': 'r2',
      '/users/parameters': 'r1',
    })
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
      replacePathEntries: vi.fn().mockResolvedValue(undefined),
      reconcileReachableRevisions: vi.fn().mockResolvedValue(undefined),
    } as unknown as CachePort

    const handler = new RefreshTimelineHandler(source, builder, cache)
    const result = await handler.handle(OPTIONS)

    expect(result.newRevisions).toBe(1)
    expect(result.builtSnapshots).toBe(1)
    expect(saveSnapshot).toHaveBeenCalledOnce()
  })
})
