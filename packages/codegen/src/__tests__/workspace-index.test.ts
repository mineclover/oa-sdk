import { describe, it, expect, expectTypeOf } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createMemoryWorkspaceIndex,
  createWorkspaceIndex,
  detectWorkspaceDirtyFiles,
  invalidateWorkspaceDirtyFiles,
  scanWorkspaceFiles,
  type WorkspaceFileRecord,
  type WorkspaceIndex,
} from '../workspace-index.js'
import { createSQLiteWorkspaceIndex, loadSqliteDriver, SQLITE_WORKSPACE_INDEX_SCHEMA_VERSION } from '../sqlite-workspace-index.js'

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

  it('scans spec categories with real path metadata and classifies dirty files', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-workspace-scan-'))
    const entryPath = join(tmp, 'openapi.yaml')
    const domainPath = join(tmp, 'domains', 'users', 'spec.yaml')
    const profilePath = join(tmp, 'profiles', 'local.yaml')
    const externalPath = join(tmp, 'shared.yaml')
    const stalePath = join(tmp, 'deleted.yaml')

    try {
      mkdirSync(join(tmp, 'domains', 'users'), { recursive: true })
      mkdirSync(join(tmp, 'profiles'), { recursive: true })
      writeFileSync(entryPath, 'openapi: 3.2.0\n')
      writeFileSync(profilePath, 'servers: []\n')
      writeFileSync(externalPath, 'components: {}\n')

      const initial = scanWorkspaceFiles({
        baseDir: tmp,
        entrySpecs: ['openapi.yaml'],
        profileSpecs: ['profiles/local.yaml'],
        externalRefFiles: ['shared.yaml'],
        parserVersion: 'parser-a',
        runId: 'run-a',
      })
      const index = createMemoryWorkspaceIndex({
        files: [
          ...initial,
          { ...initial[0]!, filePath: stalePath, realPath: stalePath, contentHash: 'stale-hash' },
        ],
      })

      writeFileSync(domainPath, 'paths: {}\n')
      writeFileSync(externalPath, 'components:\n  schemas: {}\n')

      const dirty = detectWorkspaceDirtyFiles(index, scanWorkspaceFiles({
        baseDir: tmp,
        entrySpecs: ['openapi.yaml'],
        domainSpecs: ['domains/users/spec.yaml'],
        profileSpecs: ['profiles/local.yaml'],
        externalRefFiles: ['shared.yaml'],
        parserVersion: 'parser-a',
        runId: 'run-a',
      }))

      expect(dirty.newFiles.map(file => file.filePath)).toEqual([domainPath])
      expect(dirty.modified.map(file => file.filePath)).toEqual([externalPath])
      expect(dirty.unchanged.map(file => file.filePath)).toEqual([entryPath, profilePath])
      expect(dirty.deleted.map(file => file.filePath)).toEqual([stalePath])
      expect(dirty.changed.map(file => file.filePath)).toEqual([domainPath, externalPath])
      expect(dirty.changed[0]).toMatchObject({
        filePath: domainPath,
        parserVersion: 'parser-a',
        lastSeenRun: 'run-a',
      })
      expect(dirty.changed[0]!.realPath).toBeTruthy()
      expect(dirty.changed[0]!.contentHash).toMatch(/^[a-f0-9]{64}$/)
      expect(dirty.changed[0]!.size).toBeGreaterThan(0)
      expect(dirty.changed[0]!.mtimeMs).toBeGreaterThan(0)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('marks specs that reference a changed external ref file dirty before invalidation', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-workspace-dirty-'))
    const apiPath = join(tmp, 'api.yaml')
    const sharedPath = join(tmp, 'shared.yaml')

    try {
      writeFileSync(apiPath, 'openapi: 3.2.0\n')
      writeFileSync(sharedPath, 'components:\n  schemas:\n    User:\n      type: object\n')
      const [apiRecord, sharedRecord] = scanWorkspaceFiles({
        entrySpecs: [apiPath],
        externalRefFiles: [sharedPath],
      })
      const index = createMemoryWorkspaceIndex({ files: [apiRecord!, sharedRecord!] })
      index.replaceFileIndex(apiPath, {
        refs: [{
          fromFile: apiPath,
          fromPointer: '#/paths/~1users/get/responses/200/content/application~1json/schema/$ref',
          refText: './shared.yaml#/components/schemas/User',
          kind: 'external',
          resolved: true,
          toFile: sharedPath,
          toPointer: '#/components/schemas/User',
        }],
        diagnostics: [{
          producer: 'ref-graph',
          severity: 'warning',
          code: 'old-warning',
          message: 'old warning',
          filePath: apiPath,
        }],
      })

      writeFileSync(sharedPath, 'components:\n  schemas:\n    User:\n      type: object\n      description: Changed\n')
      const dirty = detectWorkspaceDirtyFiles(index, scanWorkspaceFiles({
        entrySpecs: [apiPath],
        externalRefFiles: [sharedPath],
      }))

      expect(dirty.modified.map(file => file.filePath)).toEqual([sharedPath])
      expect(dirty.unchanged.map(file => file.filePath)).toEqual([apiPath])
      expect(dirty.dependentFilePaths).toEqual([apiPath])
      expect(dirty.dirtyFilePaths).toEqual([apiPath, sharedPath])

      invalidateWorkspaceDirtyFiles(index, dirty)

      expect(index.listFiles()).toEqual([])
      expect(index.listRefs()).toEqual([])
      expect(index.listDiagnostics()).toEqual([])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('removes stale diagnostics for deleted files', () => {
    const index = createMemoryWorkspaceIndex({
      files: [
        apiFile,
        { ...apiFile, filePath: 'deleted.yaml', contentHash: 'hash-deleted' },
      ],
    })
    index.replaceFileIndex('deleted.yaml', {
      diagnostics: [{
        producer: 'validate',
        severity: 'error',
        code: 'stale-diagnostic',
        message: 'stale diagnostic',
        filePath: 'deleted.yaml',
      }],
    })

    const dirty = detectWorkspaceDirtyFiles(index, [apiFile])
    invalidateWorkspaceDirtyFiles(index, dirty)

    expect(dirty.deleted.map(file => file.filePath)).toEqual(['deleted.yaml'])
    expect(index.listFiles()).toEqual([apiFile])
    expect(index.listDiagnostics({ filePath: 'deleted.yaml' })).toEqual([])
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

  it('initializes the SQLite schema and persists workspace metadata', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-sqlite-index-'))
    const cacheDir = join(tmp, '.oa-cache')
    const index = createSQLiteWorkspaceIndex({
      cacheDir,
      compatibility: { command: 'validate', parser: 'parser-a' },
    })

    try {
      expect(index.fallbackReason).toBeUndefined()
      expect(index.driverName).toMatch(/^(better-sqlite3|node:sqlite)$/)
      expect(index.dbPath).toBe(join(cacheDir, 'state.sqlite'))
      expect(existsSync(index.dbPath)).toBe(true)

      index.upsertFile(apiFile)
      index.replaceFileIndex(apiFile.filePath, {
        components: [{
          filePath: apiFile.filePath,
          section: 'schemas',
          name: 'User',
          pointer: '#/components/schemas/User',
          contentHash: 'component-hash',
        }],
        refs: [{
          fromFile: apiFile.filePath,
          fromPointer: '#/components/schemas/User/properties/role/$ref',
          refText: './shared.yaml#/components/schemas/Role',
          kind: 'external',
          resolved: true,
          toFile: 'shared.yaml',
          toPointer: '#/components/schemas/Role',
        }],
        sourceLocations: [{
          filePath: apiFile.filePath,
          pointer: '#/components/schemas/User',
          line: 12,
          column: 5,
        }],
        diagnostics: [{
          producer: 'ref-graph',
          severity: 'info',
          code: 'indexed',
          message: 'indexed file',
          filePath: apiFile.filePath,
          pointer: '#/components/schemas/User',
        }],
        typeAliases: [{
          sourceFile: apiFile.filePath,
          sourcePointer: '#/components/schemas/User/properties/role/$ref',
          refText: './shared.yaml#/components/schemas/Role',
          aliasName: 'SharedRole',
          contentHash: 'alias-hash',
        }],
      })

      expect(index.getFile(apiFile.filePath)).toEqual(apiFile)
      expect(index.listComponents({ name: 'User' })).toHaveLength(1)
      expect(index.listRefs({ toFile: 'shared.yaml' })).toHaveLength(1)
      expect(index.listSourceLocations(apiFile.filePath)).toHaveLength(1)
      expect(index.listDiagnostics({ producer: 'ref-graph' })).toHaveLength(1)
      expect(index.listTypeAliases({ aliasName: 'SharedRole' })).toHaveLength(1)

      const db = openSqliteForTest(index.dbPath)
      try {
        expect(listTables(db)).toEqual([
          'components',
          'diagnostics',
          'files',
          'meta',
          'refs',
          'source_locations',
          'type_aliases',
          'type_artifacts',
          'type_boundaries',
          'type_declarations',
          'type_exposures',
          'type_relations',
        ])
        expect(readMeta(db, 'schema_version')).toBe(String(SQLITE_WORKSPACE_INDEX_SCHEMA_VERSION))
        expect(readMeta(db, 'compatibility_json')).toBe('{"command":"validate","parser":"parser-a"}')
        expect(readMeta(db, 'driver_name')).toBe(index.driverName)
        expect(readJournalMode(db)).toBe('wal')
      } finally {
        db.close()
      }
    } finally {
      index.close()
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('loads a supported SQLite driver with node:sqlite preferred and better-sqlite3 fallback', () => {
    const driver = loadSqliteDriver()
    expect(['better-sqlite3', 'node:sqlite']).toContain(driver.name)
  })

  it('clears SQLite cache and forces one full rebuild when the driver changes', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-sqlite-index-'))
    const cacheDir = join(tmp, '.oa-cache')
    const seeded = createSQLiteWorkspaceIndex({ cacheDir })

    try {
      seeded.upsertFile(apiFile)
      expect(seeded.listFiles()).toHaveLength(1)
      const db = openSqliteForTest(seeded.dbPath)
      try {
        setMeta(db, 'driver_name', seeded.driverName === 'better-sqlite3' ? 'node:sqlite' : 'better-sqlite3')
      } finally {
        db.close()
      }
    } finally {
      seeded.close()
    }

    const current = createSQLiteWorkspaceIndex({ cacheDir })
    try {
      expect(current.fallbackReason).toBeUndefined()
      expect(current.listFiles()).toEqual([])
      expect(current.detectChanges([apiFile])).toEqual({
        changed: [apiFile],
        unchanged: [],
        deleted: [],
      })
      const db = openSqliteForTest(current.dbPath)
      try {
        expect(readMeta(db, 'driver_name')).toBe(current.driverName)
      } finally {
        db.close()
      }
    } finally {
      current.close()
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('clears incompatible SQLite caches and forces one full rebuild diff', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-sqlite-index-'))
    const cacheDir = join(tmp, '.oa-cache')
    const stale = createSQLiteWorkspaceIndex({
      cacheDir,
      schemaVersion: 0,
      compatibility: { command: 'validate' },
    })

    try {
      stale.upsertFile({ ...apiFile, contentHash: 'stale-hash' })
      expect(stale.listFiles()).toHaveLength(1)
    } finally {
      stale.close()
    }

    const current = createSQLiteWorkspaceIndex({
      cacheDir,
      compatibility: { command: 'typegen' },
    })

    try {
      expect(current.fallbackReason).toBeUndefined()
      expect(current.listFiles()).toEqual([])
      expect(current.detectChanges([apiFile])).toEqual({
        changed: [apiFile],
        unchanged: [],
        deleted: [],
      })

      const db = openSqliteForTest(current.dbPath)
      try {
        expect(readMeta(db, 'schema_version')).toBe(String(SQLITE_WORKSPACE_INDEX_SCHEMA_VERSION))
        expect(readMeta(db, 'compatibility_json')).toBe('{"command":"typegen"}')
      } finally {
        db.close()
      }
    } finally {
      current.close()
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('rolls back failed SQLite writes before falling back', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-sqlite-index-'))
    const cacheDir = join(tmp, '.oa-cache')
    const index = createSQLiteWorkspaceIndex({ cacheDir })

    try {
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

      index.replaceFileIndex(apiFile.filePath, {
        components: [
          {
            filePath: apiFile.filePath,
            section: 'schemas',
            name: 'UserV2',
            pointer: '#/components/schemas/UserV2',
            contentHash: 'component-hash-v2',
          },
          {
            filePath: 'missing.yaml',
            section: 'schemas',
            name: 'Missing',
            pointer: '#/components/schemas/Missing',
            contentHash: 'missing-hash',
          },
        ],
      })

      expect(index.fallbackReason).toBeDefined()
      index.close()

      const reopened = createSQLiteWorkspaceIndex({ cacheDir })
      try {
        expect(reopened.fallbackReason).toBeUndefined()
        expect(reopened.listComponents()).toEqual([{
          filePath: apiFile.filePath,
          section: 'schemas',
          name: 'User',
          pointer: '#/components/schemas/User',
          contentHash: 'component-hash',
        }])
      } finally {
        reopened.close()
      }
    } finally {
      index.close()
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('falls back to full rebuild behavior when SQLite cannot open', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-sqlite-index-'))
    const dbPath = join(tmp, '.oa-cache', 'state.sqlite')
    mkdirSync(dbPath, { recursive: true })
    const index = createSQLiteWorkspaceIndex({ dbPath })

    try {
      expect(index.fallbackReason).toBeDefined()
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
    } finally {
      index.close()
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

type TestSqliteDatabase = {
  close(): void
  prepare(sql: string): {
    all(...values: unknown[]): Record<string, unknown>[]
    get(...values: unknown[]): Record<string, unknown> | undefined
    run(...values: unknown[]): unknown
  }
}

function openSqliteForTest(dbPath: string): TestSqliteDatabase {
  return loadSqliteDriver().open(dbPath) as TestSqliteDatabase
}

function listTables(db: TestSqliteDatabase): string[] {
  return db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map(row => String(row.name))
}

function readMeta(db: TestSqliteDatabase, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key)
  return typeof row?.value === 'string' ? row.value : undefined
}

function setMeta(db: TestSqliteDatabase, key: string, value: string): void {
  db.prepare('UPDATE meta SET value = ? WHERE key = ?').run(value, key)
}

function readJournalMode(db: TestSqliteDatabase): string | undefined {
  const row = db.prepare('PRAGMA journal_mode').get()
  return typeof row?.journal_mode === 'string' ? row.journal_mode : undefined
}
