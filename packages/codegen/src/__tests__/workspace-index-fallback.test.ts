import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createSQLiteWorkspaceIndex,
  loadSqliteDriver,
  type SqliteDriverName,
} from '../sqlite-workspace-index.js'
import type { WorkspaceFileRecord } from '../workspace-index.js'

/**
 * These tests force `loadSqliteDriver()` to walk past the preferred
 * `node:sqlite` driver into the optional `better-sqlite3` fallback (and, separately,
 * past both drivers into the diagnostic error path) so the production
 * fallback chain has real coverage.
 *
 * The production code in `sqlite-workspace-index.ts` resolves drivers via
 * `createRequire(import.meta.url)`; that `require` ultimately delegates to
 * `Module._load`, so monkey-patching `Module._load` to throw for the targeted
 * specifier is sufficient to simulate a missing native dependency without
 * touching disk or the package's `node_modules` tree.
 */

type ModuleLoadFn = (request: string, parent: unknown, isMain: boolean) => unknown

interface ModuleLoaderInternals {
  _load: ModuleLoadFn
}

const moduleLoader = createRequire(import.meta.url)('node:module') as ModuleLoaderInternals

let originalLoad: ModuleLoadFn

const apiFile: WorkspaceFileRecord = {
  filePath: 'api.yaml',
  realPath: '/workspace/api.yaml',
  contentHash: 'hash-a',
  size: 100,
  mtimeMs: 1,
  parserVersion: 'parser-a',
  lastSeenRun: 'run-a',
}

function patchModuleLoad(failFor: ReadonlySet<string>): void {
  const original = originalLoad
  moduleLoader._load = function patchedLoad(this: unknown, request: string, parent: unknown, isMain: boolean): unknown {
    if (failFor.has(request)) {
      throw new Error(`Simulated missing module: ${request}`)
    }
    return original.call(this, request, parent, isMain)
  }
}

function expectNodeSqliteAvailable(): void {
  // Sanity check: this suite assumes the runtime exposes `node:sqlite`.
  // Newer Node.js (>= 22 with --experimental-sqlite, >= 24 by default) ships it.
  const r = createRequire(import.meta.url)
  try {
    r('node:sqlite')
  } catch (error) {
    throw new Error(
      `node:sqlite is required for these fallback tests but could not be loaded: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

function canRequireBetterSqlite3(): boolean {
  const r = createRequire(import.meta.url)
  try {
    r('better-sqlite3')
    return true
  } catch {
    return false
  }
}

describe('SQLiteWorkspaceIndex fallback driver chain', () => {
  beforeEach(() => {
    originalLoad = moduleLoader._load
    expectNodeSqliteAvailable()
  })

  afterEach(() => {
    moduleLoader._load = originalLoad
  })

  it('falls back to node:sqlite when better-sqlite3 cannot be required', () => {
    patchModuleLoad(new Set(['better-sqlite3']))

    const driver = loadSqliteDriver()
    expect(driver.name).toBe<SqliteDriverName>('node:sqlite')
    expect(typeof driver.open).toBe('function')

    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-sqlite-fallback-'))
    try {
      const dbPath = join(tmp, 'driver.sqlite')
      const db = driver.open(dbPath)
      try {
        expect(typeof db.exec).toBe('function')
        expect(typeof db.prepare).toBe('function')
        db.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, label TEXT NOT NULL)')
        db.prepare('INSERT INTO probe (id, label) VALUES (?, ?)').run(1, 'fallback-ok')
        const row = db.prepare('SELECT label FROM probe WHERE id = ?').get(1)
        expect(row).toEqual({ label: 'fallback-ok' })
      } finally {
        db.close()
      }
      expect(existsSync(dbPath)).toBe(true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('drives a full createSQLiteWorkspaceIndex lifecycle on the node:sqlite fallback', () => {
    patchModuleLoad(new Set(['better-sqlite3']))

    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-sqlite-fallback-'))
    const cacheDir = join(tmp, '.oa-cache')
    const index = createSQLiteWorkspaceIndex({
      cacheDir,
      compatibility: { command: 'fallback-test', parser: 'parser-a' },
    })

    try {
      expect(index.fallbackReason).toBeUndefined()
      expect(index.driverName).toBe<SqliteDriverName>('node:sqlite')
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
        diagnostics: [{
          producer: 'fallback-test',
          severity: 'info',
          code: 'fallback-roundtrip',
          message: 'verified node:sqlite fallback roundtrip',
          filePath: apiFile.filePath,
          pointer: '#/components/schemas/User',
        }],
      })

      expect(index.getFile(apiFile.filePath)).toEqual(apiFile)
      expect(index.listComponents({ name: 'User' })).toHaveLength(1)
      expect(index.listDiagnostics({ producer: 'fallback-test' })).toHaveLength(1)
      expect(index.detectChanges([apiFile])).toEqual({
        changed: [],
        unchanged: [apiFile],
        deleted: [],
      })
    } finally {
      index.close()
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('persists across reopen on the node:sqlite fallback driver', () => {
    patchModuleLoad(new Set(['better-sqlite3']))

    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-sqlite-fallback-'))
    const cacheDir = join(tmp, '.oa-cache')
    const compatibility = { command: 'fallback-reopen', parser: 'parser-a' }

    try {
      const seeded = createSQLiteWorkspaceIndex({ cacheDir, compatibility })
      try {
        expect(seeded.driverName).toBe<SqliteDriverName>('node:sqlite')
        seeded.upsertFile(apiFile)
        expect(seeded.listFiles()).toEqual([apiFile])
      } finally {
        seeded.close()
      }

      const reopened = createSQLiteWorkspaceIndex({ cacheDir, compatibility })
      try {
        expect(reopened.fallbackReason).toBeUndefined()
        expect(reopened.driverName).toBe<SqliteDriverName>('node:sqlite')
        expect(reopened.listFiles()).toEqual([apiFile])
      } finally {
        reopened.close()
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('throws a diagnostic error that names both drivers when neither can load', () => {
    patchModuleLoad(new Set(['better-sqlite3', 'node:sqlite']))

    let caught: unknown
    try {
      loadSqliteDriver()
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    const message = (caught as Error).message
    expect(message).toContain('better-sqlite3:')
    expect(message).toContain('node:sqlite:')
    expect(message).toContain('Simulated missing module: better-sqlite3')
    expect(message).toContain('Simulated missing module: node:sqlite')
  })

  it('falls back to better-sqlite3 when node:sqlite cannot be required (older Node simulation)', () => {
    if (!canRequireBetterSqlite3()) return

    patchModuleLoad(new Set(['node:sqlite']))

    const driver = loadSqliteDriver()
    expect(driver.name).toBe<SqliteDriverName>('better-sqlite3')

    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-sqlite-fallback-'))
    try {
      const dbPath = join(tmp, 'driver.sqlite')
      let db: ReturnType<typeof driver.open>
      try {
        db = driver.open(dbPath)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('Could not locate the bindings file')) return
        throw error
      }
      try {
        db.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, label TEXT NOT NULL)')
        db.prepare('INSERT INTO probe (id, label) VALUES (?, ?)').run(1, 'better-sqlite3-fallback-ok')
        const row = db.prepare('SELECT label FROM probe WHERE id = ?').get(1)
        expect(row).toEqual({ label: 'better-sqlite3-fallback-ok' })
      } finally {
        db.close()
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
