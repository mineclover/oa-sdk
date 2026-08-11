import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createSQLiteWorkspaceIndex,
  loadSqliteDriver,
  SQLITE_WORKSPACE_INDEX_SCHEMA_VERSION,
} from '../sqlite-workspace-index.js'
import {
  createMemoryTypeRegistry,
  type WorkspaceTypeFileIndexData,
} from '../type-registry.js'
import { createMemoryWorkspaceIndex, type WorkspaceFileRecord } from '../workspace-index.js'

const sourceFile = '/workspace/src/types.ts'
const fileRecord: WorkspaceFileRecord = {
  filePath: sourceFile,
  realPath: sourceFile,
  contentHash: 'file-hash',
  size: 128,
  mtimeMs: 1,
  parserVersion: 'typescript-5.9/type-registry-v1',
}

const typeIndexData: WorkspaceTypeFileIndexData = {
  artifacts: [{
    artifactId: 'artifact:types',
    filePath: sourceFile,
    packageName: '@fixture/types',
    logicalModule: '.',
    runtime: 'neutral',
    origin: 'handwritten',
    role: 'authority',
    contentHash: 'file-hash',
    compilerVersion: '5.9.3',
    tsconfigHash: 'tsconfig-hash',
  }],
  declarations: [{
    declarationId: 'declaration:user',
    artifactId: 'artifact:types',
    filePath: sourceFile,
    symbolName: 'User',
    qualifiedName: '@fixture/types:.:User',
    kind: 'interface',
    exported: true,
    genericArity: 0,
    line: 1,
    column: 1,
    endLine: 4,
    endColumn: 2,
    syntaxHash: 'syntax-hash',
    shapeHash: 'shape-hash',
    semanticHash: 'semantic-hash',
    canonicalIr: '{"kind":"interface","members":[{"name":"id","type":"string"}]}',
  }],
  relations: [{
    relationId: 'relation:user-role',
    filePath: sourceFile,
    fromDeclarationId: 'declaration:user',
    kind: 'type-ref',
    targetSymbol: 'Role',
    typeOnly: true,
    resolved: false,
    exportMapped: true,
  }],
  boundaries: [{
    boundaryId: 'boundary:payload',
    filePath: sourceFile,
    line: 8,
    column: 17,
    kind: 'deserialize',
    sourceType: 'unknown',
    targetType: 'User',
    validatorSymbol: 'isUser',
  }],
  exposures: [{
    exposureId: 'exposure:user',
    declarationId: 'declaration:user',
    filePath: sourceFile,
    packageName: '@fixture/types',
    exportKey: '.',
    exportName: 'User',
    localName: 'User',
    runtime: 'neutral',
    kind: 'type',
    reexport: false,
  }],
}

describe('TypeRegistry', () => {
  it('stores, filters, replaces, and invalidates type records in memory', () => {
    const registry = createMemoryTypeRegistry()
    registry.replaceTypeFileIndex(sourceFile, typeIndexData)

    expect(registry.listTypeArtifacts({ packageName: '@fixture/types' })).toEqual(typeIndexData.artifacts)
    expect(registry.listTypeDeclarations({ shapeHash: 'shape-hash' })).toEqual(typeIndexData.declarations)
    expect(registry.listTypeRelations({ kind: 'type-ref' })).toEqual(typeIndexData.relations)
    expect(registry.listTypeBoundaries({ kind: 'deserialize' })).toEqual(typeIndexData.boundaries)
    expect(registry.listTypeExposures({ runtime: 'neutral' })).toEqual(typeIndexData.exposures)

    registry.replaceTypeFileIndex(sourceFile, { artifacts: typeIndexData.artifacts ?? [] })
    expect(registry.listTypeArtifacts()).toHaveLength(1)
    expect(registry.listTypeDeclarations()).toEqual([])

    registry.invalidateTypeFiles([sourceFile])
    expect(registry.snapshotTypes()).toEqual({
      artifacts: [],
      declarations: [],
      relations: [],
      boundaries: [],
      exposures: [],
    })
  })

  it('keeps the Type Registry separate from the OpenAPI replacement lifecycle', () => {
    const index = createMemoryWorkspaceIndex()
    index.upsertFile(fileRecord)
    index.replaceFileIndex(sourceFile, {
      components: [{
        filePath: sourceFile,
        section: 'schemas',
        name: 'User',
        pointer: '#/components/schemas/User',
        contentHash: 'component-hash',
      }],
    })
    index.replaceTypeFileIndex(sourceFile, typeIndexData)
    expect(index.listComponents()).toHaveLength(1)

    index.replaceFileIndex(sourceFile, { diagnostics: [] })
    expect(index.listTypeDeclarations()).toEqual(typeIndexData.declarations)

    index.replaceFileIndex(sourceFile, {
      components: [{
        filePath: sourceFile,
        section: 'schemas',
        name: 'User',
        pointer: '#/components/schemas/User',
        contentHash: 'component-hash',
      }],
    })
    index.replaceTypeFileIndex(sourceFile, typeIndexData)
    expect(index.listComponents()).toHaveLength(1)
    expect(index.getFile(sourceFile)).toEqual(fileRecord)

    index.invalidateTypeFiles([sourceFile])
    expect(index.listComponents()).toHaveLength(1)
    expect(index.getFile(sourceFile)).toEqual(fileRecord)

    index.replaceTypeFileIndex(sourceFile, typeIndexData)
    index.invalidateFiles([sourceFile])
    expect(index.snapshotTypes().declarations).toEqual([])
    expect(index.listComponents()).toEqual([])
    expect(index.getFile(sourceFile)).toBeUndefined()
  })

  it('round-trips all five record categories through SQLite without replacing OpenAPI rows', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-type-registry-'))
    const index = createSQLiteWorkspaceIndex({ cacheDir: join(tmp, '.oa-cache') })

    try {
      expect(index.fallbackReason).toBeUndefined()
      index.upsertFile(fileRecord)
      index.replaceFileIndex(sourceFile, {
        components: [{
          filePath: sourceFile,
          section: 'schemas',
          name: 'User',
          pointer: '#/components/schemas/User',
          contentHash: 'component-hash',
        }],
      })
      index.replaceTypeFileIndex(sourceFile, typeIndexData)

      expect(index.snapshotTypes()).toEqual({
        artifacts: typeIndexData.artifacts,
        declarations: typeIndexData.declarations,
        relations: typeIndexData.relations,
        boundaries: typeIndexData.boundaries,
        exposures: typeIndexData.exposures,
      })
      expect(index.listComponents({ name: 'User' })).toHaveLength(1)

      index.replaceTypeFileIndex(sourceFile, { artifacts: typeIndexData.artifacts ?? [] })
      expect(index.listComponents({ name: 'User' })).toHaveLength(1)
      expect(index.listTypeDeclarations()).toEqual([])

      index.clearTypes()
      expect(index.listFiles()).toEqual([fileRecord])
      expect(index.listComponents({ name: 'User' })).toHaveLength(1)
    } finally {
      index.close()
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('upgrades schema v1 additively while retaining OpenAPI cache rows', () => {
    expect(SQLITE_WORKSPACE_INDEX_SCHEMA_VERSION).toBe(2)
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-type-registry-upgrade-'))
    const cacheDir = join(tmp, '.oa-cache')
    const compatibility = { command: 'type-registry-upgrade-test' }

    try {
      const versionOne = createSQLiteWorkspaceIndex({ cacheDir, schemaVersion: 1, compatibility })
      try {
        versionOne.upsertFile(fileRecord)
        versionOne.replaceFileIndex(sourceFile, {
          components: [{
            filePath: sourceFile,
            section: 'schemas',
            name: 'User',
            pointer: '#/components/schemas/User',
            contentHash: 'component-hash',
          }],
        })
      } finally {
        versionOne.close()
      }

      const legacyDb = loadSqliteDriver().open(join(cacheDir, 'state.sqlite'))
      try {
        legacyDb.exec(`
          DROP TABLE type_exposures;
          DROP TABLE type_boundaries;
          DROP TABLE type_relations;
          DROP TABLE type_declarations;
          DROP TABLE type_artifacts;
        `)
      } finally {
        legacyDb.close()
      }

      const upgraded = createSQLiteWorkspaceIndex({ cacheDir, compatibility })
      try {
        expect(upgraded.fallbackReason).toBeUndefined()
        expect(upgraded.listFiles()).toEqual([fileRecord])
        expect(upgraded.listComponents({ name: 'User' })).toHaveLength(1)
        expect(upgraded.detectChanges([fileRecord])).toEqual({
          changed: [],
          unchanged: [fileRecord],
          deleted: [],
        })
        expect(upgraded.snapshotTypes()).toEqual({
          artifacts: [],
          declarations: [],
          relations: [],
          boundaries: [],
          exposures: [],
        })
      } finally {
        upgraded.close()
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
