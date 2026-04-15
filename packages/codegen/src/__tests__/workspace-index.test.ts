import { describe, it, expect, expectTypeOf } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  createMemoryWorkspaceIndex,
  createWorkspaceIndex,
  type WorkspaceFileRecord,
  type WorkspaceIndex,
} from '../workspace-index.js'

const apiFile: WorkspaceFileRecord = {
  filePath: 'api.yaml',
  realPath: '/workspace/api.yaml',
  contentHash: 'hash-a',
  size: 100,
  mtimeMs: 1,
  parserVersion: 'parser-a',
  lastSeenRun: 'run-a',
}

describe('WorkspaceIndex', () => {
  it('exposes the index interface shape', () => {
    const index = createWorkspaceIndex()
    const typedIndex: WorkspaceIndex = index

    expectTypeOf(typedIndex.detectChanges).parameter(0).toEqualTypeOf<readonly WorkspaceFileRecord[]>()
    expect(typedIndex.mode).toBe('noop')
  })

  it('defaults to no-op full rebuild behavior', () => {
    const index = createWorkspaceIndex()

    index.upsertFile(apiFile)
    index.replaceFileIndex(apiFile.filePath, {
      components: [{
        filePath: apiFile.filePath,
        section: 'schemas',
        name: 'User',
        pointer: '#/components/schemas/User',
        contentHash: 'component-hash',
      }],
    })

    expect(index.getFile(apiFile.filePath)).toBeUndefined()
    expect(index.listComponents()).toEqual([])
    expect(index.detectChanges([apiFile])).toEqual({
      changed: [apiFile],
      unchanged: [],
      deleted: [],
    })
  })

  it('stores all workspace metadata categories in memory', () => {
    const index = createMemoryWorkspaceIndex()
    index.upsertFile(apiFile)
    index.replaceFileIndex(apiFile.filePath, {
      components: [{
        filePath: apiFile.filePath,
        section: 'schemas',
        name: 'User',
        pointer: '#/components/schemas/User',
        contentHash: 'component-hash',
        line: 12,
        column: 5,
      }],
      refs: [{
        fromFile: apiFile.filePath,
        fromPointer: '#/paths/~1users/get/responses/200/content/application~1json/schema/$ref',
        refText: './shared.yaml#/components/schemas/User',
        kind: 'external',
        resolved: true,
        toFile: 'shared.yaml',
        toPointer: '#/components/schemas/User',
      }],
      sourceLocations: [{
        filePath: apiFile.filePath,
        pointer: '#/components/schemas/User',
        line: 12,
        column: 5,
      }],
      diagnostics: [{
        producer: 'ref-graph',
        severity: 'warning',
        code: 'external-schema-name-collision',
        message: 'renamed external alias',
        filePath: apiFile.filePath,
        pointer: '#/components/schemas/User',
      }],
      typeAliases: [{
        sourceFile: apiFile.filePath,
        sourcePointer: '#/paths/~1users/get/responses/200/content/application~1json/schema/$ref',
        refText: './shared.yaml#/components/schemas/User',
        aliasName: 'SharedUser',
        renamedFrom: 'User',
        contentHash: 'alias-hash',
      }],
    })

    expect(index.listFiles()).toEqual([apiFile])
    expect(index.listComponents({ section: 'schemas', name: 'User' })).toHaveLength(1)
    expect(index.listRefs({ toFile: 'shared.yaml' })).toHaveLength(1)
    expect(index.listSourceLocations(apiFile.filePath)).toHaveLength(1)
    expect(index.listDiagnostics({ producer: 'ref-graph' })).toHaveLength(1)
    expect(index.listTypeAliases({ aliasName: 'SharedUser' })).toHaveLength(1)
  })

  it('detects unchanged, changed, new, and deleted files in memory', () => {
    const index = createMemoryWorkspaceIndex({
      files: [
        apiFile,
        { ...apiFile, filePath: 'deleted.yaml', contentHash: 'hash-deleted' },
        { ...apiFile, filePath: 'shared.yaml', contentHash: 'hash-shared' },
      ],
    })
    const changedShared = { ...apiFile, filePath: 'shared.yaml', contentHash: 'hash-shared-v2' }
    const newFile = { ...apiFile, filePath: 'new.yaml', contentHash: 'hash-new' }

    const diff = index.detectChanges([apiFile, changedShared, newFile])

    expect(diff.unchanged.map(file => file.filePath)).toEqual(['api.yaml'])
    expect(diff.changed.map(file => file.filePath)).toEqual(['shared.yaml', 'new.yaml'])
    expect(diff.deleted.map(file => file.filePath)).toEqual(['deleted.yaml'])
  })

  it('invalidates per-file metadata in memory', () => {
    const index = createMemoryWorkspaceIndex()
    index.upsertFile(apiFile)
    index.replaceFileIndex(apiFile.filePath, {
      components: [{
        filePath: apiFile.filePath,
        section: 'schemas',
        name: 'User',
        pointer: '#/components/schemas/User',
        contentHash: 'component-hash',
      }],
      typeAliases: [{
        sourceFile: apiFile.filePath,
        sourcePointer: '#/components/schemas/User/$ref',
        refText: '#/components/schemas/User',
        aliasName: 'User',
        contentHash: 'alias-hash',
      }],
    })

    index.invalidateFiles([apiFile.filePath])

    expect(index.getFile(apiFile.filePath)).toBeUndefined()
    expect(index.snapshot()).toEqual({
      files: [],
      components: [],
      refs: [],
      sourceLocations: [],
      diagnostics: [],
      typeAliases: [],
    })
  })

  it('keeps the parser package free of SQLite dependencies', () => {
    const parserPackage = JSON.parse(readFileSync(new URL('../../../parser/package.json', import.meta.url), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
    const dependencyNames = [
      ...Object.keys(parserPackage.dependencies ?? {}),
      ...Object.keys(parserPackage.devDependencies ?? {}),
      ...Object.keys(parserPackage.peerDependencies ?? {}),
    ]

    expect(dependencyNames.filter(name => name.toLowerCase().includes('sqlite'))).toEqual([])
  })
})
