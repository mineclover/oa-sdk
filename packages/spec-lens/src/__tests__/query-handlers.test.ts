import { describe, expect, it, vi } from 'vitest'
import { GetDiffHandler } from '../application/queries/get-diff.query.js'
import { GetPathsHandler } from '../application/queries/get-paths.query.js'
import { GetSnapshotHandler } from '../application/queries/get-snapshot.query.js'
import { GetTimelineHandler } from '../application/queries/get-timeline.query.js'
import type { CachePort } from '../application/ports/cache.port.js'
import type { SnapshotBuilderPort } from '../application/ports/snapshot-builder.port.js'
import type {
  SpecPathEntry,
  SpecSnapshotStored,
  SpecTimelineDiff,
  SpecTimelineEntry,
} from '../domain/index.js'

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeRevision(id: string) {
  return { id, shortId: id.slice(0, 7), timestamp: 1000, message: `msg ${id}`, source: 'local-git' as const }
}

function makeStored(id: string): SpecSnapshotStored {
  return {
    schemaVersion: 'spec-lens.snapshot.v2',
    projectKey: 'project-a',
    projectKind: 'definition-builder',
    sourceRoot: '/f',
    revision: makeRevision(id),
    fragmentsDir: '/f',
    targetPath: '/t',
    targetConfigDigest: 'd',
    spec: { openapi: '3.1.0', paths: {} },
    provenance: { status: 'available', kind: 'definition-builder', entries: {} },
    composition: {} as never,
    diagnostics: [],
    builtAt: 1000,
    entryRefs: [{ relativePath: 'a.yaml', contentHash: 'h1' }],
  }
}

function makeDiff(baseId: string, headId: string): SpecTimelineDiff {
  return {
    schemaVersion: 'spec-lens.diff.v2',
    projectKey: 'project-a',
    projectKind: 'definition-builder',
    baseRevision: makeRevision(baseId),
    headRevision: makeRevision(headId),
    normalizedDiff: [],
    breakingDiff: [],
    provenanceDiff: { status: 'available', kind: 'definition-builder', entries: [] },
    affectedFragments: [],
    stats: { pathsAdded: 0, pathsRemoved: 0, pathsChanged: 0, schemasAdded: 0, schemasRemoved: 0, schemasChanged: 0, breakingChanges: 0 },
  }
}

function makeTimelineEntry(id: string): SpecTimelineEntry {
  return {
    revision: makeRevision(id),
    affectedFiles: [],
    snapshotCached: true,
    diffStats: { pathsAdded: 0, pathsRemoved: 0, pathsChanged: 0, breakingChanges: 0 },
  }
}

function makePathEntry(path: string): SpecPathEntry {
  return {
    path,
    methods: ['get'],
    canonicalId: `path:public/users/${path.slice(1)}`,
    scope: 'public',
    domain: 'users',
    sourceFile: 'f.yaml',
    contentHash: 'h',
    lastChangedRevisionId: 'abc',
    lastChangedTimestamp: 1000,
  }
}

const BASE_OPTIONS = { projectKey: 'project-a', toolchainFingerprint: 'toolchain-a' }

// ── GetDiffHandler ─────────────────────────────────────────────────────────

describe('GetDiffHandler', () => {
  function makeCache(opts: {
    cachedDiff?: SpecTimelineDiff | null
    base?: SpecSnapshotStored | null
    head?: SpecSnapshotStored | null
  }): CachePort {
    return {
      getDiff: vi.fn().mockResolvedValue(opts.cachedDiff ?? null),
      getSnapshotByRevision: vi.fn().mockImplementation((id: string) =>
        Promise.resolve(id === 'base' ? (opts.base ?? null) : (opts.head ?? null))),
      saveDiff: vi.fn().mockResolvedValue(undefined),
    } as unknown as CachePort
  }

  function makeBuilder(diff: SpecTimelineDiff): SnapshotBuilderPort {
    return { diff: vi.fn().mockReturnValue(diff) } as unknown as SnapshotBuilderPort
  }

  it('returns cached diff without computing', async () => {
    const cached = makeDiff('base', 'head')
    const cache = makeCache({ cachedDiff: cached })
    const builder = makeBuilder(makeDiff('base', 'head'))
    const handler = new GetDiffHandler(cache, builder)

    const result = await handler.handle({ baseRevisionId: 'base', headRevisionId: 'head', ...BASE_OPTIONS })

    expect(result).toBe(cached)
    expect(builder.diff).not.toHaveBeenCalled()
    expect(cache.saveDiff).not.toHaveBeenCalled()
  })

  it('computes on-demand when not cached', async () => {
    const computed = makeDiff('base', 'head')
    const cache = makeCache({ base: makeStored('base'), head: makeStored('head') })
    const builder = makeBuilder(computed)
    const handler = new GetDiffHandler(cache, builder)

    const result = await handler.handle({ baseRevisionId: 'base', headRevisionId: 'head', ...BASE_OPTIONS })

    expect(result).toBe(computed)
    expect(builder.diff).toHaveBeenCalledOnce()
  })

  it('saves computed diff to cache', async () => {
    const cache = makeCache({ base: makeStored('base'), head: makeStored('head') })
    const builder = makeBuilder(makeDiff('base', 'head'))
    const handler = new GetDiffHandler(cache, builder)

    await handler.handle({ baseRevisionId: 'base', headRevisionId: 'head', ...BASE_OPTIONS })

    expect(cache.saveDiff).toHaveBeenCalledOnce()
  })

  it('returns null when base snapshot missing', async () => {
    const cache = makeCache({ base: null, head: makeStored('head') })
    const builder = makeBuilder(makeDiff('base', 'head'))
    const handler = new GetDiffHandler(cache, builder)

    const result = await handler.handle({ baseRevisionId: 'base', headRevisionId: 'head', ...BASE_OPTIONS })

    expect(result).toBeNull()
    expect(builder.diff).not.toHaveBeenCalled()
  })

  it('returns null when head snapshot missing', async () => {
    const cache = makeCache({ base: makeStored('base'), head: null })
    const handler = new GetDiffHandler(cache, { diff: vi.fn() } as unknown as SnapshotBuilderPort)

    const result = await handler.handle({ baseRevisionId: 'base', headRevisionId: 'head', ...BASE_OPTIONS })

    expect(result).toBeNull()
  })
})

// ── GetPathsHandler ────────────────────────────────────────────────────────

describe('GetPathsHandler', () => {
  function makeCache(entries: SpecPathEntry[]): CachePort {
    return { listPaths: vi.fn().mockResolvedValue(entries) } as unknown as CachePort
  }

  it('returns entries from cache', async () => {
    const entries = [makePathEntry('/users'), makePathEntry('/items')]
    const cache = makeCache(entries)
    const handler = new GetPathsHandler(cache)

    const result = await handler.handle({ projectKey: 'project-a', projectKind: 'definition-builder' })

    expect(result).toEqual({ status: 'available', projectKind: 'definition-builder', entries })
    expect(cache.listPaths).toHaveBeenCalledWith({ projectKey: 'project-a' })
  })

  it('forwards scope filter', async () => {
    const cache = makeCache([])
    const handler = new GetPathsHandler(cache)

    await handler.handle({ projectKey: 'project-a', projectKind: 'definition-builder', scope: 'public' })

    expect(cache.listPaths).toHaveBeenCalledWith({ projectKey: 'project-a', scope: 'public' })
  })

  it('forwards domain filter', async () => {
    const cache = makeCache([])
    const handler = new GetPathsHandler(cache)

    await handler.handle({ projectKey: 'project-a', projectKind: 'definition-builder', domain: 'users' })

    expect(cache.listPaths).toHaveBeenCalledWith({ projectKey: 'project-a', domain: 'users' })
  })

  it('omits undefined filters', async () => {
    const cache = makeCache([])
    const handler = new GetPathsHandler(cache)

    await handler.handle({ projectKey: 'project-a', projectKind: 'definition-builder' })

    const call = (cache.listPaths as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(call).not.toHaveProperty('scope')
    expect(call).not.toHaveProperty('domain')
  })

  it('returns TypeSpec path rows when AST provenance populated the path index', async () => {
    const cache = makeCache([makePathEntry('/users')])
    const handler = new GetPathsHandler(cache)

    expect(await handler.handle({
      projectKey: 'project-typespec',
      projectKind: 'typespec-bundle',
    })).toEqual({
      status: 'available',
      projectKind: 'typespec-bundle',
      entries: [makePathEntry('/users')],
    })
    expect(cache.listPaths).toHaveBeenCalledWith({ projectKey: 'project-typespec' })
  })
})

// ── GetSnapshotHandler ─────────────────────────────────────────────────────

describe('GetSnapshotHandler', () => {
  function makeCache(stored: SpecSnapshotStored | null, blobContent = 'yaml content'): CachePort {
    return {
      getSnapshotByRevision: vi.fn().mockResolvedValue(stored),
      getFragmentBlob: vi.fn().mockResolvedValue(blobContent),
    } as unknown as CachePort
  }

  it('returns null when not cached', async () => {
    const handler = new GetSnapshotHandler(makeCache(null))
    const result = await handler.handle({ revisionId: 'abc', ...BASE_OPTIONS })
    expect(result).toBeNull()
  })

  it('strips entryRefs from wire format', async () => {
    const stored = makeStored('abc')
    const handler = new GetSnapshotHandler(makeCache(stored))
    const result = await handler.handle({ revisionId: 'abc', ...BASE_OPTIONS })

    expect(result).not.toBeNull()
    expect(result).not.toHaveProperty('entryRefs')
  })

  it('does not resolve entries by default', async () => {
    const stored = makeStored('abc')
    const cache = makeCache(stored)
    const handler = new GetSnapshotHandler(cache)

    const result = await handler.handle({ revisionId: 'abc', ...BASE_OPTIONS })

    expect(result?.entries).toBeUndefined()
    expect(cache.getFragmentBlob).not.toHaveBeenCalled()
  })

  it('resolves entries when includeEntries=true', async () => {
    const stored = makeStored('abc')
    const cache = makeCache(stored, 'content: foo')
    const handler = new GetSnapshotHandler(cache)

    const result = await handler.handle({ revisionId: 'abc', ...BASE_OPTIONS, includeEntries: true })

    expect(result?.entries).toHaveLength(1)
    expect(result?.entries?.[0]).toMatchObject({ relativePath: 'a.yaml', content: 'content: foo', contentHash: 'h1' })
    expect(cache.getFragmentBlob).toHaveBeenCalledWith('h1')
  })

  it('omits entry when blob not found', async () => {
    const stored = makeStored('abc')
    const cache = makeCache(stored, null as unknown as string)
    const handler = new GetSnapshotHandler(cache)

    const result = await handler.handle({ revisionId: 'abc', ...BASE_OPTIONS, includeEntries: true })

    expect(result?.entries).toHaveLength(0)
  })
})

// ── GetTimelineHandler ─────────────────────────────────────────────────────

describe('GetTimelineHandler', () => {
  function makeCache(entries: SpecTimelineEntry[]): CachePort {
    return { listTimeline: vi.fn().mockResolvedValue(entries) } as unknown as CachePort
  }

  it('returns entries from cache', async () => {
    const entries = [makeTimelineEntry('abc'), makeTimelineEntry('def')]
    const cache = makeCache(entries)
    const handler = new GetTimelineHandler(cache)

    const result = await handler.handle({ projectKey: 'project-a' })

    expect(result).toEqual(entries)
  })

  it('forwards limit', async () => {
    const cache = makeCache([])
    const handler = new GetTimelineHandler(cache)

    await handler.handle({ projectKey: 'project-a', limit: 50 })

    expect(cache.listTimeline).toHaveBeenCalledWith({ projectKey: 'project-a', limit: 50 })
  })

  it('omits limit when not provided', async () => {
    const cache = makeCache([])
    const handler = new GetTimelineHandler(cache)

    await handler.handle({ projectKey: 'project-a' })

    const call = (cache.listTimeline as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(call).not.toHaveProperty('limit')
  })
})
