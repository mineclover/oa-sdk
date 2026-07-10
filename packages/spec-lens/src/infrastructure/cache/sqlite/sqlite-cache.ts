import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CachePort, ClearCacheResult, ListPathsOptions, ListTimelineOptions } from '../../../application/ports/cache.port.js'
import type {
  SpecFileEntry,
  SpecPathEntry,
  SpecSnapshotStored,
  SpecTimelineDiff,
  SpecTimelineEntry,
} from '../../../domain/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCHEMA_SQL = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
const STORAGE_SCHEMA_VERSION = 2
const require = createRequire(import.meta.url)

export class SqliteCache implements CachePort {
  private readonly db: SqliteDatabase
  readonly driverName: SqliteDriverName

  constructor(dbPath: string) {
    const driver = loadSpecLensSqliteDriver()
    this.driverName = driver.name
    this.db = driver.open(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.db.exec('PRAGMA foreign_keys = ON')
    try {
      initializeSchema(this.db)
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  async saveSnapshot(snapshot: SpecSnapshotStored, entries: SpecFileEntry[]): Promise<void> {
    const cacheKey = this.snapshotCacheKey(snapshot)
    runTransaction(this.db, () => {
      for (const entry of entries) {
        this.db.prepare(
          'INSERT OR IGNORE INTO fragment_blobs (content_hash, content) VALUES (?, ?)',
        ).run(entry.contentHash, entry.content)
        this.db.prepare(
          'INSERT OR REPLACE INTO snapshot_entries (cache_key, relative_path, content_hash) VALUES (?, ?, ?)',
        ).run(cacheKey, entry.relativePath, entry.contentHash)
      }
      this.db.prepare(`
        INSERT OR REPLACE INTO snapshots (cache_key, project_key, revision_id, data, built_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        cacheKey,
        snapshot.projectKey,
        snapshot.revision.id,
        JSON.stringify(snapshot),
        snapshot.builtAt,
      )
    })
  }

  async saveDiff(diff: SpecTimelineDiff, projectKey: string): Promise<void> {
    if (diff.projectKey !== projectKey) {
      throw new Error('diff projectKey does not match cache projectKey')
    }
    this.db.prepare(`
      INSERT OR REPLACE INTO diffs (project_key, base_revision_id, head_revision_id, data)
      VALUES (?, ?, ?, ?)
    `).run(
      projectKey,
      diff.baseRevision.id,
      diff.headRevision.id,
      JSON.stringify(diff),
    )
  }

  async upsertTimelineEntry(entry: SpecTimelineEntry, projectKey: string): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO timeline_entries
        (project_key, revision_id, short_id, timestamp, message, author,
         source, source_ref, affected_files, snapshot_cached,
         paths_added, paths_removed, paths_changed, breaking_changes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      projectKey,
      entry.revision.id,
      entry.revision.shortId,
      entry.revision.timestamp,
      entry.revision.message,
      entry.revision.author ?? null,
      entry.revision.source,
      entry.revision.sourceRef ?? null,
      JSON.stringify(entry.affectedFiles),
      entry.snapshotCached ? 1 : 0,
      entry.diffStats.pathsAdded,
      entry.diffStats.pathsRemoved,
      entry.diffStats.pathsChanged,
      entry.diffStats.breakingChanges,
    )
  }

  async upsertPathEntries(projectKey: string, entries: SpecPathEntry[]): Promise<void> {
    runTransaction(this.db, () => {
      for (const entry of entries) {
        this.db.prepare(`
          INSERT OR REPLACE INTO path_entries
            (project_key, path, methods, canonical_id, scope, domain,
             source_file, content_hash, last_changed_revision, last_changed_timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          projectKey,
          entry.path,
          JSON.stringify(entry.methods),
          entry.canonicalId,
          entry.scope,
          entry.domain,
          entry.sourceFile,
          entry.contentHash,
          entry.lastChangedRevisionId,
          entry.lastChangedTimestamp,
        )
      }
    })
  }

  async listTimeline(options: ListTimelineOptions): Promise<SpecTimelineEntry[]> {
    const rows = this.db.prepare(`
      SELECT * FROM timeline_entries
      WHERE project_key = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(options.projectKey, options.limit ?? 100) as TimelineRow[]

    return rows.map(rowToTimelineEntry)
  }

  async getSnapshotByRevision(
    revisionId: string,
    projectKey: string,
  ): Promise<SpecSnapshotStored | null> {
    const row = this.db.prepare(
      'SELECT data FROM snapshots WHERE revision_id = ? AND project_key = ? LIMIT 1',
    ).get(revisionId, projectKey) as { data: string } | undefined
    if (row === undefined) return null
    let snapshot: SpecSnapshotStored
    try {
      snapshot = JSON.parse(row.data) as SpecSnapshotStored
    } catch {
      return null
    }
    if (snapshot.schemaVersion !== 'spec-lens.snapshot.v2' || snapshot.projectKey !== projectKey) return null
    return snapshot
  }

  async getDiff(
    baseRevisionId: string,
    headRevisionId: string,
    projectKey: string,
  ): Promise<SpecTimelineDiff | null> {
    const row = this.db.prepare(
      'SELECT data FROM diffs WHERE base_revision_id = ? AND head_revision_id = ? AND project_key = ?',
    ).get(baseRevisionId, headRevisionId, projectKey) as { data: string } | undefined
    if (row === undefined) return null
    let diff: SpecTimelineDiff
    try {
      diff = JSON.parse(row.data) as SpecTimelineDiff
    } catch {
      return null
    }
    if (diff.schemaVersion !== 'spec-lens.diff.v2' || diff.projectKey !== projectKey) return null
    return diff
  }

  async listPaths(options: ListPathsOptions): Promise<SpecPathEntry[]> {
    let query = 'SELECT * FROM path_entries WHERE project_key = ?'
    const params: (string | number)[] = [options.projectKey]

    if (options.scope !== undefined) {
      query += ' AND scope = ?'
      params.push(options.scope)
    }
    if (options.domain !== undefined) {
      query += ' AND domain = ?'
      params.push(options.domain)
    }
    query += ' ORDER BY path ASC'

    const rows = this.db.prepare(query).all(...params) as PathRow[]
    return rows.map(rowToPathEntry)
  }

  async getFragmentBlob(contentHash: string): Promise<string | null> {
    const row = this.db.prepare(
      'SELECT content FROM fragment_blobs WHERE content_hash = ?',
    ).get(contentHash) as { content: string } | undefined
    return row?.content ?? null
  }

  async clearCache(projectKey: string): Promise<ClearCacheResult> {
    return runTransaction(this.db, (): ClearCacheResult => {
      // snapshot_entries first — must precede snapshots deletion to avoid orphans
      const entries = this.db.prepare(
        'DELETE FROM snapshot_entries WHERE cache_key IN (SELECT cache_key FROM snapshots WHERE project_key = ?)',
      ).run(projectKey)
      const snapshots = this.db.prepare(
        'DELETE FROM snapshots WHERE project_key = ?',
      ).run(projectKey)
      const diffs = this.db.prepare(
        'DELETE FROM diffs WHERE project_key = ?',
      ).run(projectKey)
      const timeline = this.db.prepare(
        'DELETE FROM timeline_entries WHERE project_key = ?',
      ).run(projectKey)
      const paths = this.db.prepare(
        'DELETE FROM path_entries WHERE project_key = ?',
      ).run(projectKey)
      // Remove fragment_blobs that are no longer referenced by any snapshot_entry
      const blobs = this.db.prepare(
        'DELETE FROM fragment_blobs WHERE content_hash NOT IN (SELECT DISTINCT content_hash FROM snapshot_entries)',
      ).run()
      return {
        deletedSnapshots: snapshots.changes,
        deletedDiffs: diffs.changes,
        deletedTimeline: timeline.changes,
        deletedPaths: paths.changes,
        deletedEntries: entries.changes,
        deletedBlobs: blobs.changes,
      }
    })
  }

  close(): void {
    this.db.close()
  }

  private snapshotCacheKey(snapshot: SpecSnapshotStored): string {
    return `${snapshot.projectKey}:${snapshot.revision.id}`
  }
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

type SqliteDriverName = 'node:sqlite' | 'better-sqlite3'

type SqliteDriver = {
  name: SqliteDriverName
  open(path: string): SqliteDatabase
}

type NodeSqliteModule = {
  DatabaseSync: new (path: string) => SqliteDatabase
}

type BetterSqliteModule = {
  (path: string): SqliteDatabase
}

function initializeSchema(db: SqliteDatabase): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: unknown } | undefined
  const currentVersion = typeof row?.user_version === 'number' ? row.user_version : 0
  if (currentVersion > STORAGE_SCHEMA_VERSION) {
    throw new Error(`spec-lens cache schema ${currentVersion} is newer than supported schema ${STORAGE_SCHEMA_VERSION}`)
  }

  if (currentVersion === STORAGE_SCHEMA_VERSION) {
    db.exec(SCHEMA_SQL)
    return
  }

  runTransaction(db, () => {
    db.exec(`
      DROP TABLE IF EXISTS snapshot_entries;
      DROP TABLE IF EXISTS diffs;
      DROP TABLE IF EXISTS timeline_entries;
      DROP TABLE IF EXISTS path_entries;
      DROP TABLE IF EXISTS snapshots;
      DROP TABLE IF EXISTS fragment_blobs;
    `)
    db.exec(SCHEMA_SQL)
  })
}

function loadSpecLensSqliteDriver(): SqliteDriver {
  const errors: string[] = []
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

  throw new Error(`No supported SQLite driver found (${errors.join('; ')})`)
}

function runTransaction<T>(db: SqliteDatabase, callback: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = callback()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // Preserve the original transaction failure.
    }
    throw error
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type TimelineRow = {
  revision_id: string
  short_id: string
  timestamp: number
  message: string
  author: string | null
  source: string
  source_ref: string | null
  affected_files: string
  snapshot_cached: number
  paths_added: number
  paths_removed: number
  paths_changed: number
  breaking_changes: number
}

type PathRow = {
  path: string
  methods: string
  canonical_id: string
  scope: string
  domain: string
  source_file: string
  content_hash: string
  last_changed_revision: string
  last_changed_timestamp: number
}

function rowToTimelineEntry(row: TimelineRow): SpecTimelineEntry {
  const author = row.author ?? undefined
  const sourceRef = row.source_ref ?? undefined
  return {
    revision: {
      id: row.revision_id,
      shortId: row.short_id,
      timestamp: row.timestamp,
      message: row.message,
      source: row.source as SpecTimelineEntry['revision']['source'],
      ...(author !== undefined ? { author } : {}),
      ...(sourceRef !== undefined ? { sourceRef } : {}),
    },
    affectedFiles: JSON.parse(row.affected_files) as string[],
    snapshotCached: row.snapshot_cached === 1,
    diffStats: {
      pathsAdded: row.paths_added,
      pathsRemoved: row.paths_removed,
      pathsChanged: row.paths_changed,
      breakingChanges: row.breaking_changes,
    },
  }
}

function rowToPathEntry(row: PathRow): SpecPathEntry {
  return {
    path: row.path,
    methods: JSON.parse(row.methods) as string[],
    canonicalId: row.canonical_id,
    scope: row.scope,
    domain: row.domain,
    sourceFile: row.source_file,
    contentHash: row.content_hash,
    lastChangedRevisionId: row.last_changed_revision,
    lastChangedTimestamp: row.last_changed_timestamp,
  }
}
