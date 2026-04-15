import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type {
  WorkspaceComponentFilter,
  WorkspaceComponentRecord,
  WorkspaceDiagnosticFilter,
  WorkspaceDiagnosticRecord,
  WorkspaceFileIndexData,
  WorkspaceFileRecord,
  WorkspaceIndex,
  WorkspaceIndexCompatibilityMetadata,
  WorkspaceIndexDiff,
  WorkspaceIndexSnapshot,
  WorkspaceRefFilter,
  WorkspaceRefRecord,
  WorkspaceSourceLocationRecord,
  WorkspaceTypeAliasFilter,
  WorkspaceTypeAliasRecord,
} from './workspace-index.js'

export const SQLITE_WORKSPACE_INDEX_SCHEMA_VERSION = 1

export type SQLiteWorkspaceIndexOptions = {
  cacheDir?: string
  dbPath?: string
  schemaVersion?: number
  compatibility?: WorkspaceIndexCompatibilityMetadata
  busyTimeoutMs?: number
}

export interface SQLiteWorkspaceIndex extends WorkspaceIndex {
  readonly mode: 'sqlite'
  readonly dbPath: string
  readonly driverName?: SqliteDriverName
  readonly fallbackReason?: string
  close(): void
}

type SqliteValue = string | number | bigint | null | Uint8Array

type SqliteStatement = {
  all(...values: SqliteValue[]): Record<string, unknown>[]
  get(...values: SqliteValue[]): Record<string, unknown> | undefined
  run(...values: SqliteValue[]): { changes: number, lastInsertRowid: number | bigint }
}

type SqliteDatabase = {
  close(): void
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
}

export type SqliteDriverName = 'better-sqlite3' | 'node:sqlite'

type SqliteDriver = {
  name: SqliteDriverName
  open(path: string): SqliteDatabase
}

const require = createRequire(import.meta.url)

export function createSQLiteWorkspaceIndex(options: SQLiteWorkspaceIndexOptions = {}): SQLiteWorkspaceIndex {
  return new NodeSQLiteWorkspaceIndex(options)
}

class NodeSQLiteWorkspaceIndex implements SQLiteWorkspaceIndex {
  readonly mode = 'sqlite'
  readonly dbPath: string
  driverName?: SqliteDriverName
  fallbackReason?: string

  private readonly schemaVersion: number
  private readonly compatibilityJson: string
  private readonly compatibilityHash: string
  private readonly busyTimeoutMs: number
  private db: SqliteDatabase | undefined
  private forceFullRebuildOnce = false

  constructor(options: SQLiteWorkspaceIndexOptions) {
    this.dbPath = options.dbPath ?? join(options.cacheDir ?? '.oa-cache', 'state.sqlite')
    this.schemaVersion = options.schemaVersion ?? SQLITE_WORKSPACE_INDEX_SCHEMA_VERSION
    this.busyTimeoutMs = options.busyTimeoutMs ?? 5_000
    this.compatibilityJson = stableStringify(options.compatibility ?? {})
    this.compatibilityHash = createHash('sha256').update(this.compatibilityJson).digest('hex')

    this.open()
  }

  getFile(filePath: string): WorkspaceFileRecord | undefined {
    return this.read(() => {
      const row = this.database()
        .prepare('SELECT * FROM files WHERE file_path = ?')
        .get(filePath)
      return row ? fileFromRow(row) : undefined
    }, undefined)
  }

  listFiles(): WorkspaceFileRecord[] {
    return this.read(() => this.database()
      .prepare('SELECT * FROM files ORDER BY file_path')
      .all()
      .map(fileFromRow), [])
  }

  upsertFile(file: WorkspaceFileRecord): void {
    this.write(() => {
      this.database().prepare(`
        INSERT INTO files (
          file_path,
          real_path,
          content_hash,
          size,
          mtime_ms,
          parser_version,
          last_seen_run
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_path) DO UPDATE SET
          real_path = excluded.real_path,
          content_hash = excluded.content_hash,
          size = excluded.size,
          mtime_ms = excluded.mtime_ms,
          parser_version = excluded.parser_version,
          last_seen_run = excluded.last_seen_run,
          updated_at = CURRENT_TIMESTAMP
      `).run(
        file.filePath,
        file.realPath ?? null,
        file.contentHash,
        file.size,
        file.mtimeMs,
        file.parserVersion ?? null,
        file.lastSeenRun ?? null,
      )
    })
  }

  deleteFile(filePath: string): void {
    this.invalidateFiles([filePath])
  }

  detectChanges(files: readonly WorkspaceFileRecord[]): WorkspaceIndexDiff {
    if (this.isFallback()) return fullRebuildDiff(files)

    if (this.forceFullRebuildOnce) {
      this.forceFullRebuildOnce = false
      return fullRebuildDiff(files)
    }

    return this.read(() => {
      const changed: WorkspaceFileRecord[] = []
      const unchanged: WorkspaceFileRecord[] = []
      const incoming = new Set<string>()

      for (const file of files) {
        incoming.add(file.filePath)
        const previous = this.getFile(file.filePath)
        if (previous && isSameFileRecord(previous, file)) {
          unchanged.push({ ...file })
        } else {
          changed.push({ ...file })
        }
      }

      const deleted = this.listFiles().filter(file => !incoming.has(file.filePath))
      return { changed, unchanged, deleted }
    }, fullRebuildDiff(files))
  }

  replaceFileIndex(filePath: string, data: WorkspaceFileIndexData): void {
    this.write(() => {
      const db = this.database()
      db.prepare('DELETE FROM components WHERE owner_file_path = ?').run(filePath)
      db.prepare('DELETE FROM refs WHERE from_file = ?').run(filePath)
      db.prepare('DELETE FROM source_locations WHERE file_path = ?').run(filePath)
      db.prepare('DELETE FROM diagnostics WHERE owner_file_path = ?').run(filePath)
      db.prepare('DELETE FROM type_aliases WHERE source_file = ?').run(filePath)

      const insertComponent = db.prepare(`
        INSERT INTO components (
          owner_file_path,
          file_path,
          section,
          name,
          pointer,
          content_hash,
          owner,
          line,
          column
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const component of data.components ?? []) {
        insertComponent.run(
          filePath,
          component.filePath,
          component.section,
          component.name,
          component.pointer,
          component.contentHash,
          component.owner ?? null,
          component.line ?? null,
          component.column ?? null,
        )
      }

      const insertRef = db.prepare(`
        INSERT INTO refs (
          from_file,
          from_pointer,
          ref_text,
          kind,
          resolved,
          to_file,
          to_pointer,
          diagnostic_code
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const ref of data.refs ?? []) {
        insertRef.run(
          ref.fromFile,
          ref.fromPointer,
          ref.refText,
          ref.kind,
          ref.resolved ? 1 : 0,
          ref.toFile ?? null,
          ref.toPointer ?? null,
          ref.diagnosticCode ?? null,
        )
      }

      const insertSourceLocation = db.prepare(`
        INSERT INTO source_locations (
          file_path,
          pointer,
          line,
          column
        ) VALUES (?, ?, ?, ?)
      `)
      for (const location of data.sourceLocations ?? []) {
        insertSourceLocation.run(
          location.filePath,
          location.pointer,
          location.line,
          location.column,
        )
      }

      const insertDiagnostic = db.prepare(`
        INSERT INTO diagnostics (
          owner_file_path,
          producer,
          severity,
          code,
          message,
          file_path,
          pointer,
          line,
          column
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const diagnostic of data.diagnostics ?? []) {
        insertDiagnostic.run(
          filePath,
          diagnostic.producer,
          diagnostic.severity,
          diagnostic.code,
          diagnostic.message,
          diagnostic.filePath ?? null,
          diagnostic.pointer ?? null,
          diagnostic.line ?? null,
          diagnostic.column ?? null,
        )
      }

      const insertTypeAlias = db.prepare(`
        INSERT INTO type_aliases (
          source_file,
          source_pointer,
          ref_text,
          alias_name,
          content_hash,
          renamed_from
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      for (const alias of data.typeAliases ?? []) {
        insertTypeAlias.run(
          alias.sourceFile,
          alias.sourcePointer,
          alias.refText,
          alias.aliasName,
          alias.contentHash,
          alias.renamedFrom ?? null,
        )
      }
    })
  }

  invalidateFiles(filePaths: readonly string[]): void {
    this.write(() => {
      const deleteFile = this.database().prepare('DELETE FROM files WHERE file_path = ?')
      for (const filePath of filePaths) deleteFile.run(filePath)
    })
  }

  listComponents(filter: WorkspaceComponentFilter = {}): WorkspaceComponentRecord[] {
    return this.read(() => this.database()
      .prepare('SELECT * FROM components ORDER BY file_path, section, name, pointer, id')
      .all()
      .map(componentFromRow)
      .filter(component =>
        matchesOptional(filter.filePath, component.filePath)
        && matchesOptional(filter.section, component.section)
        && matchesOptional(filter.name, component.name)
      ), [])
  }

  listRefs(filter: WorkspaceRefFilter = {}): WorkspaceRefRecord[] {
    return this.read(() => {
      const db = this.database()
      if (filter.fromFile !== undefined && filter.toFile !== undefined) {
        return db.prepare('SELECT * FROM refs WHERE from_file = ? AND to_file = ? ORDER BY from_file, from_pointer, id')
          .all(filter.fromFile, filter.toFile)
          .map(refFromRow)
      }
      if (filter.fromFile !== undefined) {
        return db.prepare('SELECT * FROM refs WHERE from_file = ? ORDER BY from_file, from_pointer, id')
          .all(filter.fromFile)
          .map(refFromRow)
      }
      if (filter.toFile !== undefined) {
        return db.prepare('SELECT * FROM refs WHERE to_file = ? ORDER BY from_file, from_pointer, id')
          .all(filter.toFile)
          .map(refFromRow)
      }
      return db.prepare('SELECT * FROM refs ORDER BY from_file, from_pointer, id')
        .all()
        .map(refFromRow)
    }, [])
  }

  listSourceLocations(filePath?: string): WorkspaceSourceLocationRecord[] {
    return this.read(() => {
      const rows = filePath === undefined
        ? this.database()
          .prepare('SELECT * FROM source_locations ORDER BY file_path, pointer, id')
          .all()
        : this.database()
          .prepare('SELECT * FROM source_locations WHERE file_path = ? ORDER BY pointer, id')
          .all(filePath)
      return rows.map(sourceLocationFromRow)
    }, [])
  }

  listDiagnostics(filter: WorkspaceDiagnosticFilter = {}): WorkspaceDiagnosticRecord[] {
    return this.read(() => this.database()
      .prepare('SELECT * FROM diagnostics ORDER BY owner_file_path, producer, code, id')
      .all()
      .map(diagnosticFromRow)
      .filter(diagnostic =>
        matchesOptional(filter.filePath, diagnostic.filePath)
        && matchesOptional(filter.producer, diagnostic.producer)
        && matchesOptional(filter.severity, diagnostic.severity)
      ), [])
  }

  listTypeAliases(filter: WorkspaceTypeAliasFilter = {}): WorkspaceTypeAliasRecord[] {
    return this.read(() => this.database()
      .prepare('SELECT * FROM type_aliases ORDER BY source_file, alias_name, source_pointer, id')
      .all()
      .map(typeAliasFromRow)
      .filter(alias =>
        matchesOptional(filter.sourceFile, alias.sourceFile)
        && matchesOptional(filter.aliasName, alias.aliasName)
      ), [])
  }

  clear(): void {
    if (this.isFallback()) {
      removeDatabaseFiles(this.dbPath)
      return
    }

    this.write(() => {
      this.clearData()
      this.writeCurrentMeta()
    })
    this.forceFullRebuildOnce = true
  }

  snapshot(): WorkspaceIndexSnapshot {
    return {
      files: this.listFiles(),
      components: this.listComponents(),
      refs: this.listRefs(),
      sourceLocations: this.listSourceLocations(),
      diagnostics: this.listDiagnostics(),
      typeAliases: this.listTypeAliases(),
    }
  }

  close(): void {
    if (!this.db) return
    try {
      this.db.close()
    } finally {
      this.db = undefined
    }
  }

  private open(): void {
    try {
      mkdirSync(dirname(this.dbPath), { recursive: true })
      const driver = loadSqliteDriver()
      this.driverName = driver.name
      this.db = driver.open(this.dbPath)
      this.configureDatabase()
      this.initializeSchema()
      this.checkCompatibility()
    } catch (error) {
      this.enterFallback(error)
    }
  }

  private configureDatabase(): void {
    const db = this.database()
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = ${this.busyTimeoutMs};
      PRAGMA foreign_keys = ON;
    `)
  }

  private initializeSchema(): void {
    this.database().exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS files (
        file_path TEXT PRIMARY KEY,
        real_path TEXT,
        content_hash TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime_ms REAL NOT NULL,
        parser_version TEXT,
        last_seen_run TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS components (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_file_path TEXT NOT NULL,
        file_path TEXT NOT NULL,
        section TEXT NOT NULL,
        name TEXT NOT NULL,
        pointer TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        owner TEXT,
        line INTEGER,
        column INTEGER,
        FOREIGN KEY(owner_file_path) REFERENCES files(file_path) ON DELETE CASCADE,
        FOREIGN KEY(file_path) REFERENCES files(file_path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS components_file_section_name_idx
        ON components(file_path, section, name);

      CREATE TABLE IF NOT EXISTS refs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_file TEXT NOT NULL,
        from_pointer TEXT NOT NULL,
        ref_text TEXT NOT NULL,
        kind TEXT NOT NULL,
        resolved INTEGER NOT NULL,
        to_file TEXT,
        to_pointer TEXT,
        diagnostic_code TEXT,
        FOREIGN KEY(from_file) REFERENCES files(file_path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS refs_from_file_idx
        ON refs(from_file);

      CREATE INDEX IF NOT EXISTS refs_to_file_idx
        ON refs(to_file);

      CREATE TABLE IF NOT EXISTS source_locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        pointer TEXT NOT NULL,
        line INTEGER NOT NULL,
        column INTEGER NOT NULL,
        FOREIGN KEY(file_path) REFERENCES files(file_path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS source_locations_file_pointer_idx
        ON source_locations(file_path, pointer);

      CREATE TABLE IF NOT EXISTS diagnostics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_file_path TEXT NOT NULL,
        producer TEXT NOT NULL,
        severity TEXT NOT NULL,
        code TEXT NOT NULL,
        message TEXT NOT NULL,
        file_path TEXT,
        pointer TEXT,
        line INTEGER,
        column INTEGER,
        FOREIGN KEY(owner_file_path) REFERENCES files(file_path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS diagnostics_source_idx
        ON diagnostics(file_path, producer, severity);

      CREATE TABLE IF NOT EXISTS type_aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_file TEXT NOT NULL,
        source_pointer TEXT NOT NULL,
        ref_text TEXT NOT NULL,
        alias_name TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        renamed_from TEXT,
        FOREIGN KEY(source_file) REFERENCES files(file_path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS type_aliases_source_alias_idx
        ON type_aliases(source_file, alias_name);
    `)
  }

  private checkCompatibility(): void {
    const existingSchemaVersion = this.readMeta('schema_version')
    const existingCompatibilityHash = this.readMeta('compatibility_hash')
    const existingDriverName = this.readMeta('driver_name')

    if (existingSchemaVersion === undefined && existingCompatibilityHash === undefined) {
      this.write(() => {
        this.writeCurrentMeta()
      })
      return
    }

    if (
      existingSchemaVersion !== String(this.schemaVersion)
      || existingCompatibilityHash !== this.compatibilityHash
      || (existingDriverName !== undefined && existingDriverName !== this.driverName)
    ) {
      this.write(() => {
        this.clearData()
        this.writeCurrentMeta()
      })
      this.forceFullRebuildOnce = true
    }
  }

  private writeCurrentMeta(): void {
    const insertMeta = this.database().prepare(`
      INSERT INTO meta (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)
    insertMeta.run('schema_version', String(this.schemaVersion))
    insertMeta.run('compatibility_hash', this.compatibilityHash)
    insertMeta.run('compatibility_json', this.compatibilityJson)
    if (this.driverName) insertMeta.run('driver_name', this.driverName)
  }

  private readMeta(key: string): string | undefined {
    const row = this.database()
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get(key)
    const value = row?.value
    return typeof value === 'string' ? value : undefined
  }

  private clearData(): void {
    const db = this.database()
    db.exec(`
      DELETE FROM type_aliases;
      DELETE FROM diagnostics;
      DELETE FROM source_locations;
      DELETE FROM refs;
      DELETE FROM components;
      DELETE FROM files;
      DELETE FROM meta;
    `)
  }

  private write(operation: () => void): void {
    if (this.isFallback()) return

    const db = this.database()
    try {
      db.exec('BEGIN IMMEDIATE')
      try {
        operation()
        db.exec('COMMIT')
      } catch (error) {
        try {
          db.exec('ROLLBACK')
        } catch {
          // The original write error determines fallback; rollback can fail if SQLite already aborted.
        }
        throw error
      }
    } catch (error) {
      this.enterFallback(error)
    }
  }

  private read<T>(operation: () => T, fallback: T): T {
    if (this.isFallback()) return fallback
    try {
      return operation()
    } catch (error) {
      this.enterFallback(error)
      return fallback
    }
  }

  private database(): SqliteDatabase {
    if (!this.db) throw new Error('SQLite workspace index is in fallback mode')
    return this.db
  }

  private isFallback(): boolean {
    return this.db === undefined || this.fallbackReason !== undefined
  }

  private enterFallback(error: unknown): void {
    this.fallbackReason = error instanceof Error ? error.message : String(error)
    this.forceFullRebuildOnce = true
    try {
      this.close()
    } catch {
      this.db = undefined
    }
  }
}

export function loadSqliteDriver(): SqliteDriver {
  const errors: string[] = []

  try {
    const betterSqlite = require('better-sqlite3') as BetterSqliteModule
    return {
      name: 'better-sqlite3',
      open(path: string): SqliteDatabase {
        return betterSqlite(path)
      },
    }
  } catch (error) {
    errors.push(`better-sqlite3: ${errorMessage(error)}`)
  }

  try {
    const sqlite = require('node:sqlite') as NodeSqliteModule
    return {
      name: 'node:sqlite',
      open(path: string): SqliteDatabase {
        return new sqlite.DatabaseSync(path)
      },
    }
  } catch (error) {
    errors.push(`node:sqlite: ${errorMessage(error)}`)
  }

  throw new Error(`No supported SQLite driver found (${errors.join('; ')})`)
}

type BetterSqliteModule = {
  (path: string): SqliteDatabase
}

type NodeSqliteModule = {
  DatabaseSync: new (path: string) => SqliteDatabase
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function fullRebuildDiff(files: readonly WorkspaceFileRecord[]): WorkspaceIndexDiff {
  return {
    changed: cloneRecords(files),
    unchanged: [],
    deleted: [],
  }
}

function isSameFileRecord(previous: WorkspaceFileRecord, current: WorkspaceFileRecord): boolean {
  return previous.contentHash === current.contentHash
    && previous.size === current.size
    && previous.mtimeMs === current.mtimeMs
    && previous.parserVersion === current.parserVersion
    && (previous.realPath ?? previous.filePath) === (current.realPath ?? current.filePath)
}

function matchesOptional<T>(expected: T | undefined, actual: T | undefined): boolean {
  return expected === undefined || expected === actual
}

function cloneRecords<T extends object>(records: Iterable<T>): T[] {
  return [...records].map(record => ({ ...record }))
}

function fileFromRow(row: Record<string, unknown>): WorkspaceFileRecord {
  const record: WorkspaceFileRecord = {
    filePath: requireString(row, 'file_path'),
    contentHash: requireString(row, 'content_hash'),
    size: requireNumber(row, 'size'),
    mtimeMs: requireNumber(row, 'mtime_ms'),
  }
  assignOptionalString(record, 'realPath', row.real_path)
  assignOptionalString(record, 'parserVersion', row.parser_version)
  assignOptionalString(record, 'lastSeenRun', row.last_seen_run)
  return record
}

function componentFromRow(row: Record<string, unknown>): WorkspaceComponentRecord {
  const record: WorkspaceComponentRecord = {
    filePath: requireString(row, 'file_path'),
    section: requireString(row, 'section'),
    name: requireString(row, 'name'),
    pointer: requireString(row, 'pointer'),
    contentHash: requireString(row, 'content_hash'),
  }
  assignOptionalString(record, 'owner', row.owner)
  assignOptionalNumber(record, 'line', row.line)
  assignOptionalNumber(record, 'column', row.column)
  return record
}

function refFromRow(row: Record<string, unknown>): WorkspaceRefRecord {
  const record: WorkspaceRefRecord = {
    fromFile: requireString(row, 'from_file'),
    fromPointer: requireString(row, 'from_pointer'),
    refText: requireString(row, 'ref_text'),
    kind: requireString(row, 'kind') as WorkspaceRefRecord['kind'],
    resolved: requireNumber(row, 'resolved') === 1,
  }
  assignOptionalString(record, 'toFile', row.to_file)
  assignOptionalString(record, 'toPointer', row.to_pointer)
  assignOptionalString(record, 'diagnosticCode', row.diagnostic_code)
  return record
}

function sourceLocationFromRow(row: Record<string, unknown>): WorkspaceSourceLocationRecord {
  return {
    filePath: requireString(row, 'file_path'),
    pointer: requireString(row, 'pointer'),
    line: requireNumber(row, 'line'),
    column: requireNumber(row, 'column'),
  }
}

function diagnosticFromRow(row: Record<string, unknown>): WorkspaceDiagnosticRecord {
  const record: WorkspaceDiagnosticRecord = {
    producer: requireString(row, 'producer'),
    severity: requireString(row, 'severity') as WorkspaceDiagnosticRecord['severity'],
    code: requireString(row, 'code'),
    message: requireString(row, 'message'),
  }
  assignOptionalString(record, 'filePath', row.file_path)
  assignOptionalString(record, 'pointer', row.pointer)
  assignOptionalNumber(record, 'line', row.line)
  assignOptionalNumber(record, 'column', row.column)
  return record
}

function typeAliasFromRow(row: Record<string, unknown>): WorkspaceTypeAliasRecord {
  const record: WorkspaceTypeAliasRecord = {
    sourceFile: requireString(row, 'source_file'),
    sourcePointer: requireString(row, 'source_pointer'),
    refText: requireString(row, 'ref_text'),
    aliasName: requireString(row, 'alias_name'),
    contentHash: requireString(row, 'content_hash'),
  }
  assignOptionalString(record, 'renamedFrom', row.renamed_from)
  return record
}

function requireString(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== 'string') throw new Error(`Expected SQLite column ${key} to be a string`)
  return value
}

function requireNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key]
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  throw new Error(`Expected SQLite column ${key} to be a number`)
}

function assignOptionalString<T extends object, K extends keyof T>(target: T, key: K, value: unknown): void {
  if (typeof value === 'string') {
    ;(target as Record<K, string>)[key] = value
  }
}

function assignOptionalNumber<T extends object, K extends keyof T>(target: T, key: K, value: unknown): void {
  if (typeof value === 'number') {
    ;(target as Record<K, number>)[key] = value
  } else if (typeof value === 'bigint') {
    ;(target as Record<K, number>)[key] = Number(value)
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortJson((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}

function removeDatabaseFiles(dbPath: string): void {
  for (const filePath of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (!existsSync(filePath)) continue
    try {
      if (statSync(filePath).isFile()) rmSync(filePath, { force: true })
    } catch {
      // Cache cleanup is best-effort once the index has already fallen back.
    }
  }
}
