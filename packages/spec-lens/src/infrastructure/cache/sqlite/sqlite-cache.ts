import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
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

export class SqliteCache implements CachePort {
  private readonly db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('busy_timeout = 5000')
    this.db.pragma('foreign_keys = ON')
    this.db.exec(SCHEMA_SQL)
  }

  async saveSnapshot(snapshot: SpecSnapshotStored, entries: SpecFileEntry[]): Promise<void> {
    const cacheKey = this.snapshotCacheKey(snapshot)
    const save = this.db.transaction(() => {
      for (const entry of entries) {
        this.db.prepare(
          'INSERT OR IGNORE INTO fragment_blobs (content_hash, content) VALUES (?, ?)',
        ).run(entry.contentHash, entry.content)
        this.db.prepare(
          'INSERT OR REPLACE INTO snapshot_entries (cache_key, relative_path, content_hash) VALUES (?, ?, ?)',
        ).run(cacheKey, entry.relativePath, entry.contentHash)
      }
      this.db.prepare(`
        INSERT OR REPLACE INTO snapshots (cache_key, revision_id, fragments_dir, target_path, target_config_digest, data, built_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        cacheKey,
        snapshot.revision.id,
        snapshot.fragmentsDir,
        snapshot.targetPath,
        snapshot.targetConfigDigest,
        JSON.stringify(snapshot),
        snapshot.builtAt,
      )
    })
    save()
  }

  async saveDiff(diff: SpecTimelineDiff, fragmentsDir: string, targetPath: string): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO diffs (base_revision_id, head_revision_id, fragments_dir, target_path, data)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      diff.baseRevision.id,
      diff.headRevision.id,
      fragmentsDir,
      targetPath,
      JSON.stringify(diff),
    )
  }

  async upsertTimelineEntry(entry: SpecTimelineEntry, fragmentsDir: string, targetPath: string): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO timeline_entries
        (revision_id, fragments_dir, target_path, short_id, timestamp, message, author,
         source, source_ref, affected_files, snapshot_cached,
         paths_added, paths_removed, paths_changed, breaking_changes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.revision.id,
      fragmentsDir,
      targetPath,
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

  async upsertPathEntries(fragmentsDir: string, targetPath: string, entries: SpecPathEntry[]): Promise<void> {
    const upsert = this.db.transaction(() => {
      for (const entry of entries) {
        this.db.prepare(`
          INSERT OR REPLACE INTO path_entries
            (fragments_dir, target_path, path, methods, canonical_id, scope, domain,
             source_file, content_hash, last_changed_revision, last_changed_timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          fragmentsDir,
          targetPath,
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
    upsert()
  }

  async listTimeline(options: ListTimelineOptions): Promise<SpecTimelineEntry[]> {
    const rows = this.db.prepare(`
      SELECT * FROM timeline_entries
      WHERE fragments_dir = ? AND target_path = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(options.fragmentsDir, options.targetPath, options.limit ?? 100) as TimelineRow[]

    return rows.map(rowToTimelineEntry)
  }

  async getSnapshotByRevision(
    revisionId: string,
    fragmentsDir: string,
    targetPath: string,
    targetConfigDigest: string,
  ): Promise<SpecSnapshotStored | null> {
    const row = this.db.prepare(
      'SELECT data FROM snapshots WHERE revision_id = ? AND fragments_dir = ? AND target_path = ? AND target_config_digest = ? LIMIT 1',
    ).get(revisionId, fragmentsDir, targetPath, targetConfigDigest) as { data: string } | undefined
    if (row === undefined) return null
    const snapshot = JSON.parse(row.data) as SpecSnapshotStored
    if (snapshot.schemaVersion !== 'spec-lens.snapshot.v1') return null
    return snapshot
  }

  async getDiff(
    baseRevisionId: string,
    headRevisionId: string,
    fragmentsDir: string,
    targetPath: string,
  ): Promise<SpecTimelineDiff | null> {
    const row = this.db.prepare(
      'SELECT data FROM diffs WHERE base_revision_id = ? AND head_revision_id = ? AND fragments_dir = ? AND target_path = ?',
    ).get(baseRevisionId, headRevisionId, fragmentsDir, targetPath) as { data: string } | undefined
    if (row === undefined) return null
    const diff = JSON.parse(row.data) as SpecTimelineDiff
    if (diff.schemaVersion !== 'spec-lens.diff.v1') return null
    return diff
  }

  async listPaths(options: ListPathsOptions): Promise<SpecPathEntry[]> {
    let query = 'SELECT * FROM path_entries WHERE fragments_dir = ? AND target_path = ?'
    const params: (string | number)[] = [options.fragmentsDir, options.targetPath]

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

  async clearCache(fragmentsDir: string, targetPath: string): Promise<ClearCacheResult> {
    const run = this.db.transaction((): ClearCacheResult => {
      // snapshot_entries first — must precede snapshots deletion to avoid orphans
      const entries = this.db.prepare(
        'DELETE FROM snapshot_entries WHERE cache_key IN (SELECT cache_key FROM snapshots WHERE fragments_dir = ? AND target_path = ?)',
      ).run(fragmentsDir, targetPath)
      const snapshots = this.db.prepare(
        'DELETE FROM snapshots WHERE fragments_dir = ? AND target_path = ?',
      ).run(fragmentsDir, targetPath)
      const diffs = this.db.prepare(
        'DELETE FROM diffs WHERE fragments_dir = ? AND target_path = ?',
      ).run(fragmentsDir, targetPath)
      const timeline = this.db.prepare(
        'DELETE FROM timeline_entries WHERE fragments_dir = ? AND target_path = ?',
      ).run(fragmentsDir, targetPath)
      const paths = this.db.prepare(
        'DELETE FROM path_entries WHERE fragments_dir = ? AND target_path = ?',
      ).run(fragmentsDir, targetPath)
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
    return run()
  }

  close(): void {
    this.db.close()
  }

  private snapshotCacheKey(snapshot: SpecSnapshotStored): string {
    return `${snapshot.revision.id}:${snapshot.fragmentsDir}:${snapshot.targetPath}:${snapshot.targetConfigDigest}`
  }
}

type TimelineRow = {
  revision_id: string
  fragments_dir: string
  target_path: string
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
  fragments_dir: string
  target_path: string
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
