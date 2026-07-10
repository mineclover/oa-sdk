import { describe, expect, it } from 'vitest'
import { SnapshotBuilder } from '../infrastructure/snapshot-engine/snapshot-builder.js'
import type { SpecRevision, SpecSnapshotStored } from '../domain/index.js'

function makeRevision(id: string): SpecRevision {
  return { id, shortId: id.slice(0, 7), timestamp: 1000, message: 'test', source: 'local-git' }
}

function makeStored(
  id: string,
  spec: Record<string, unknown>,
  entryRefs: Array<{ relativePath: string; contentHash: string }> = [],
): SpecSnapshotStored {
  return {
    schemaVersion: 'spec-lens.snapshot.v2',
    projectKey: 'project-a',
    projectKind: 'definition-builder',
    sourceRoot: '/f',
    targetConfigDigest: 'test-digest',
    revision: makeRevision(id),
    fragmentsDir: '/f',
    targetPath: 'api',
    spec,
    provenance: {},
    composition: {} as never,
    diagnostics: [],
    builtAt: 1000,
    entryRefs,
  }
}

const EMPTY_SPEC = { openapi: '3.1.0', info: { title: 'test', version: '1' }, paths: {} }

const SPEC_WITH_USERS = {
  openapi: '3.1.0',
  info: { title: 'test', version: '1' },
  paths: { '/users': { get: { operationId: 'listUsers', responses: { '200': { description: 'ok' } } } } },
  components: { schemas: { User: { type: 'object', properties: { id: { type: 'string' } } } } },
}

const SPEC_WITH_USERS_AND_NOTES = {
  ...SPEC_WITH_USERS,
  paths: {
    ...SPEC_WITH_USERS.paths,
    '/notes': { get: { operationId: 'listNotes', responses: { '200': { description: 'ok' } } } },
  },
}

describe('SnapshotBuilder.diff', () => {
  const builder = new SnapshotBuilder()

  it('reports zero stats for identical specs', () => {
    const base = makeStored('base', SPEC_WITH_USERS)
    const head = makeStored('head', SPEC_WITH_USERS)
    const diff = builder.diff(base, head)
    expect(diff.stats).toEqual({
      pathsAdded: 0, pathsRemoved: 0, pathsChanged: 0,
      schemasAdded: 0, schemasRemoved: 0, schemasChanged: 0,
      breakingChanges: 0,
    })
    expect(diff.normalizedDiff).toHaveLength(0)
  })

  it('detects added paths', () => {
    const base = makeStored('base', SPEC_WITH_USERS)
    const head = makeStored('head', SPEC_WITH_USERS_AND_NOTES)
    const diff = builder.diff(base, head)
    expect(diff.stats.pathsAdded).toBe(1)
    expect(diff.stats.pathsRemoved).toBe(0)
  })

  it('detects removed paths', () => {
    const base = makeStored('base', SPEC_WITH_USERS_AND_NOTES)
    const head = makeStored('head', SPEC_WITH_USERS)
    const diff = builder.diff(base, head)
    expect(diff.stats.pathsRemoved).toBe(1)
    expect(diff.stats.pathsAdded).toBe(0)
  })

  it('sets baseRevision and headRevision correctly', () => {
    const base = makeStored('base-sha', EMPTY_SPEC)
    const head = makeStored('head-sha', EMPTY_SPEC)
    const diff = builder.diff(base, head)
    expect(diff.baseRevision.id).toBe('base-sha')
    expect(diff.headRevision.id).toBe('head-sha')
  })

  it('computes affectedFragments from entryRefs diff', () => {
    const base = makeStored('base', EMPTY_SPEC, [
      { relativePath: 'schema/User.yaml', contentHash: 'hash-a' },
      { relativePath: 'schema/Note.yaml', contentHash: 'hash-b' },
    ])
    const head = makeStored('head', EMPTY_SPEC, [
      { relativePath: 'schema/User.yaml', contentHash: 'hash-a' },  // unchanged
      { relativePath: 'schema/Note.yaml', contentHash: 'hash-c' },  // changed
      { relativePath: 'schema/Book.yaml', contentHash: 'hash-d' },  // added
    ])
    const diff = builder.diff(base, head)
    expect(diff.affectedFragments.sort()).toEqual(['schema/Book.yaml', 'schema/Note.yaml'])
  })

  it('includes removed files in affectedFragments', () => {
    const base = makeStored('base', EMPTY_SPEC, [
      { relativePath: 'schema/User.yaml', contentHash: 'hash-a' },
    ])
    const head = makeStored('head', EMPTY_SPEC, [])
    const diff = builder.diff(base, head)
    expect(diff.affectedFragments).toEqual(['schema/User.yaml'])
  })

  it('returns empty affectedFragments when entryRefs are identical', () => {
    const refs = [{ relativePath: 'schema/User.yaml', contentHash: 'hash-a' }]
    const base = makeStored('base', EMPTY_SPEC, refs)
    const head = makeStored('head', EMPTY_SPEC, refs)
    const diff = builder.diff(base, head)
    expect(diff.affectedFragments).toHaveLength(0)
  })

  it('handles null spec gracefully', () => {
    const base = makeStored('base', EMPTY_SPEC)
    const head = makeStored('head', EMPTY_SPEC)
    ;(head as { spec: null }).spec = null
    expect(() => builder.diff(base, head)).not.toThrow()
  })

  it('rejects a cross-project diff', () => {
    const base = makeStored('base', EMPTY_SPEC)
    const head = { ...makeStored('head', EMPTY_SPEC), projectKey: 'project-b' }
    expect(() => builder.diff(base, head)).toThrow('different spec projects')
  })
})
