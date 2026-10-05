import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  BuildSpecCompositionReport,
  SpecLensTypeSpecCompileEvidence,
} from '@oa-sdk/codegen/spec-lens'
import type { CachePort, ClearCacheResult, ListPathsOptions, ListTimelineOptions } from '../../../application/ports/cache.port.js'
import type {
  SpecFileEntry,
  SpecPathEntry,
  SpecRevision,
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

  async replacePathEntries(projectKey: string, entries: SpecPathEntry[]): Promise<void> {
    runTransaction(this.db, () => {
      this.db.prepare('DELETE FROM path_entries WHERE project_key = ?').run(projectKey)
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

    return rows
      .map(rowToTimelineEntry)
      .filter((entry): entry is SpecTimelineEntry => entry !== null)
  }

  async getSnapshotByRevision(
    revisionId: string,
    projectKey: string,
    expectedToolchainFingerprint?: string,
  ): Promise<SpecSnapshotStored | null> {
    const row = this.db.prepare(
      'SELECT data FROM snapshots WHERE revision_id = ? AND project_key = ? LIMIT 1',
    ).get(revisionId, projectKey) as { data: string } | undefined
    if (row === undefined) return null
    try {
      return storedSnapshotSchema(projectKey, revisionId, expectedToolchainFingerprint).parse(JSON.parse(row.data))
    } catch (error) {
      // A row that is not JSON is a cache miss, like a row that fails the snapshot contract.
      if (error instanceof SyntaxError) return null
      throw error
    }
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
    try {
      return storedDiffSchema(projectKey, baseRevisionId, headRevisionId).parse(JSON.parse(row.data))
    } catch (error) {
      // A row that is not JSON is a cache miss, like a row that fails the diff contract.
      if (error instanceof SyntaxError) return null
      throw error
    }
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
    return rows
      .map(rowToPathEntry)
      .filter((entry): entry is SpecPathEntry => entry !== null)
  }

  async getFragmentBlob(contentHash: string): Promise<string | null> {
    const row = this.db.prepare(
      'SELECT content FROM fragment_blobs WHERE content_hash = ?',
    ).get(contentHash) as { content: string } | undefined
    return row?.content ?? null
  }

  async reconcileReachableRevisions(
    projectKey: string,
    revisionIds: readonly string[],
  ): Promise<void> {
    const reachable = [...new Set(revisionIds)]

    runTransaction(this.db, () => {
      // A full history can exceed SQLite's bound-variable limit. Materialize
      // the authoritative set one row at a time and reconcile with NOT EXISTS.
      this.db.exec(`
        CREATE TEMP TABLE IF NOT EXISTS spec_lens_reachable_revisions (
          revision_id TEXT PRIMARY KEY
        ) WITHOUT ROWID;
        DELETE FROM spec_lens_reachable_revisions;
      `)
      const insertReachable = this.db.prepare(
        'INSERT OR IGNORE INTO spec_lens_reachable_revisions (revision_id) VALUES (?)',
      )
      for (const revisionId of reachable) insertReachable.run(revisionId)
      this.db.prepare(`
        DELETE FROM snapshot_entries
        WHERE cache_key IN (
          SELECT snapshots.cache_key FROM snapshots
          WHERE snapshots.project_key = ?
            AND NOT EXISTS (
              SELECT 1 FROM spec_lens_reachable_revisions reachable
              WHERE reachable.revision_id = snapshots.revision_id
            )
        )
      `).run(projectKey)
      this.db.prepare(`
        DELETE FROM snapshots
        WHERE project_key = ?
          AND NOT EXISTS (
            SELECT 1 FROM spec_lens_reachable_revisions reachable
            WHERE reachable.revision_id = snapshots.revision_id
          )
      `).run(projectKey)
      this.db.prepare(`
        DELETE FROM diffs
        WHERE project_key = ?
          AND (
            NOT EXISTS (
              SELECT 1 FROM spec_lens_reachable_revisions reachable
              WHERE reachable.revision_id = diffs.base_revision_id
            )
            OR NOT EXISTS (
              SELECT 1 FROM spec_lens_reachable_revisions reachable
              WHERE reachable.revision_id = diffs.head_revision_id
            )
          )
      `).run(projectKey)
      this.db.prepare(`
        DELETE FROM timeline_entries
        WHERE project_key = ?
          AND NOT EXISTS (
            SELECT 1 FROM spec_lens_reachable_revisions reachable
            WHERE reachable.revision_id = timeline_entries.revision_id
          )
      `).run(projectKey)
      // Path provenance is a latest-snapshot projection. Clear it before the
      // refresh rebuild so removed paths can never survive a history rewrite.
      this.db.prepare('DELETE FROM path_entries WHERE project_key = ?').run(projectKey)
      this.db.prepare(
        'DELETE FROM fragment_blobs WHERE content_hash NOT IN (SELECT DISTINCT content_hash FROM snapshot_entries)',
      ).run()
    })
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

function rowToTimelineEntry(row: TimelineRow): SpecTimelineEntry | null {
  const affectedFiles = parseStoredStringArray(row.affected_files)
  if (affectedFiles === null
    || !['github', 'gitlab', 'local-git', 'file'].includes(row.source)
    || !isFiniteNumber(row.timestamp)
    || ![0, 1].includes(row.snapshot_cached)
    || !isNonNegativeInteger(row.paths_added)
    || !isNonNegativeInteger(row.paths_removed)
    || !isNonNegativeInteger(row.paths_changed)
    || !isNonNegativeInteger(row.breaking_changes)) {
    return null
  }
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
    affectedFiles,
    snapshotCached: row.snapshot_cached === 1,
    diffStats: {
      pathsAdded: row.paths_added,
      pathsRemoved: row.paths_removed,
      pathsChanged: row.paths_changed,
      breakingChanges: row.breaking_changes,
    },
  }
}

function rowToPathEntry(row: PathRow): SpecPathEntry | null {
  const methods = parseStoredStringArray(row.methods)
  if (methods === null || !isFiniteNumber(row.last_changed_timestamp)) return null
  return {
    path: row.path,
    methods,
    canonicalId: row.canonical_id,
    scope: row.scope,
    domain: row.domain,
    sourceFile: row.source_file,
    contentHash: row.content_hash,
    lastChangedRevisionId: row.last_changed_revision,
    lastChangedTimestamp: row.last_changed_timestamp,
  }
}

/** Decoder for a cached snapshot row of one project revision; a contract violation reads as a miss (null). */
function storedSnapshotSchema(
  projectKey: string,
  revisionId: string,
  expectedToolchainFingerprint?: string,
): { parse(value: unknown): SpecSnapshotStored | null } {
  return { parse: value => decodeStoredSnapshot(value, projectKey, revisionId, expectedToolchainFingerprint) }
}

/** Decoder for a cached diff row between two revisions; a contract violation reads as a miss (null). */
function storedDiffSchema(
  projectKey: string,
  baseRevisionId: string,
  headRevisionId: string,
): { parse(value: unknown): SpecTimelineDiff | null } {
  return { parse: value => decodeStoredDiff(value, projectKey, baseRevisionId, headRevisionId) }
}

function decodeStoredSnapshot(
  value: unknown,
  projectKey: string,
  revisionId: string,
  expectedToolchainFingerprint?: string,
): SpecSnapshotStored | null {
  if (!isRecord(value)
    || value.schemaVersion !== 'spec-lens.snapshot.v2'
    || value.projectKey !== projectKey
    || (value.projectKind !== 'definition-builder' && value.projectKind !== 'typespec-bundle')
    || typeof value.sourceRoot !== 'string'
    || !isRevision(value.revision)
    || value.revision.id !== revisionId
    || (value.spec !== null && !isRecord(value.spec))
    || !isSnapshotDiagnostics(value.diagnostics)
    || !isFiniteNumber(value.builtAt)
    || !isEntryRefs(value.entryRefs)
    || !isRecord(value.provenance)) {
    return null
  }

  if (value.projectKind === 'definition-builder') {
    if (value.provenance.status !== 'available'
      || value.provenance.kind !== 'definition-builder'
      || !isProvenanceMap(value.provenance.entries)
      || typeof value.fragmentsDir !== 'string'
      || typeof value.targetPath !== 'string'
      || typeof value.targetConfigDigest !== 'string'
      || !isCompositionReport(value.composition)
      || value.composition.target.targetPath !== value.targetPath
      || value.composition.target.fragmentsDir !== value.fragmentsDir) {
      return null
    }
  } else {
    const provenance = value.provenance
    const provenanceValid = (
      provenance.status === 'available'
      && provenance.kind === 'typespec-source-ast'
      && isProvenanceMap(provenance.entries)
    ) || (
      provenance.status === 'unavailable'
      && provenance.kind === 'typespec-source-files'
      && provenance.reason === 'output-pointer-mapping-unavailable'
    )
    if (!provenanceValid
      || !isSourceFileEvidence(provenance.sourceFiles)
      || !isObservedInputEvidence(provenance.observedInputs)
      || !isTypeSpecCompileEvidence(provenance.compile)
      || (expectedToolchainFingerprint !== undefined
        && provenance.compile.toolchain.fingerprint !== expectedToolchainFingerprint)
      || !sameStrings(provenance.compile.sourceFiles, provenance.sourceFiles.map(entry => entry.relativePath))
      || !sourceFileEvidenceMatchesEntries(provenance.sourceFiles, value.entryRefs)
      || typeof value.manifestPath !== 'string') return null
  }

  return value as SpecSnapshotStored
}

function decodeStoredDiff(
  value: unknown,
  projectKey: string,
  baseRevisionId: string,
  headRevisionId: string,
): SpecTimelineDiff | null {
  if (!isRecord(value)
    || value.schemaVersion !== 'spec-lens.diff.v2'
    || value.projectKey !== projectKey
    || (value.projectKind !== 'definition-builder' && value.projectKind !== 'typespec-bundle')
    || !isRevision(value.baseRevision)
    || !isRevision(value.headRevision)
    || value.baseRevision.id !== baseRevisionId
    || value.headRevision.id !== headRevisionId
    || !isNormalizedDiff(value.normalizedDiff)
    || !isBreakingDiff(value.breakingDiff)
    || !isStringArray(value.affectedFragments)
    || !isDiffStats(value.stats)
    || !isRecord(value.provenanceDiff)) {
    return null
  }
  if (value.projectKind === 'definition-builder') {
    if (value.provenanceDiff.status !== 'available'
      || value.provenanceDiff.kind !== 'definition-builder'
      || !isProvenanceDiff(value.provenanceDiff.entries)) {
      return null
    }
  } else {
    const provenanceDiff = value.provenanceDiff
    const provenanceValid = (
      provenanceDiff.status === 'available'
      && provenanceDiff.kind === 'typespec-source-ast'
      && isProvenanceDiff(provenanceDiff.entries)
    ) || (
      provenanceDiff.status === 'unavailable'
      && provenanceDiff.kind === 'typespec-source-files'
      && provenanceDiff.reason === 'output-pointer-mapping-unavailable'
      && isStringArray(provenanceDiff.affectedSourceFiles)
      && sameStrings(provenanceDiff.affectedSourceFiles, value.affectedFragments)
    )
    if (!provenanceValid) return null
  }
  return value as SpecTimelineDiff
}

function isRevision(value: unknown): value is SpecRevision {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.shortId === 'string'
    && isFiniteNumber(value.timestamp)
    && typeof value.message === 'string'
    && ['github', 'gitlab', 'local-git', 'file'].includes(String(value.source))
    && isOptionalString(value, 'author')
    && isOptionalString(value, 'sourceRef')
    && (value.metadata === undefined || isRecord(value.metadata))
}

function isEntryRefs(value: unknown): value is Array<{ relativePath: string; contentHash: string }> {
  return Array.isArray(value) && value.every(entry => (
    isRecord(entry)
    && typeof entry.relativePath === 'string'
    && typeof entry.contentHash === 'string'
  ))
}

function isSourceFileEvidence(value: unknown): value is Array<{ relativePath: string; contentHash: string }> {
  return Array.isArray(value) && value.every(entry => (
    isRecord(entry)
    && typeof entry.relativePath === 'string'
    && typeof entry.contentHash === 'string'
  ))
}

function isSnapshotDiagnostics(value: unknown): boolean {
  return Array.isArray(value) && value.every(diagnostic => (
    isRecord(diagnostic)
    && typeof diagnostic.code === 'string'
    && ['error', 'warning', 'info'].includes(String(diagnostic.severity))
    && typeof diagnostic.message === 'string'
    && isOptionalString(diagnostic, 'pointer')
    && isOptionalString(diagnostic, 'sourcePath')
  ))
}

function isProvenanceEntry(value: unknown): boolean {
  return isRecord(value)
    && typeof value.canonicalId === 'string'
    && typeof value.kind === 'string'
    && typeof value.sourcePath === 'string'
    && typeof value.sourcePointer === 'string'
    && typeof value.contentHash === 'string'
}

function isProvenanceMap(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(isProvenanceEntry)
}

function isCompositionReport(value: unknown): value is BuildSpecCompositionReport {
  return isRecord(value)
    && value.schemaVersion === 'oa-gen.composition-report.v1'
    && isRecord(value.target)
    && typeof value.target.name === 'string'
    && typeof value.target.targetPath === 'string'
    && typeof value.target.fragmentsDir === 'string'
    && isStringArray(value.target.scopes)
    && isStringArray(value.target.domains)
    && isStringArray(value.target.includePaths)
    && isStringArray(value.target.includeDefinitions)
    && isRecord(value.summary)
    && hasNonNegativeIntegerFields(value.summary, [
      'registryNodeCount',
      'selectedNodeCount',
      'directPathCount',
      'directDefinitionCount',
      'transitiveComponentCount',
      'omittedNodeCount',
      'sourceRefCount',
      'outputAliasCount',
      'renamedOutputAliasCount',
      'collisionReportCount',
    ])
    && isRecord(value.selected)
    && isStringArray(value.selected.directPathIds)
    && isStringArray(value.selected.directDefinitionIds)
    && isStringArray(value.selected.transitiveComponentIds)
    && isStringArray(value.selected.selectedNodeIds)
    && isRecord(value.output)
    && isCompositionOutputPaths(value.output.paths)
    && isCompositionOutputComponents(value.output.components)
    && isOutputAliases(value.output.aliases)
    && isOutputAliases(value.output.renamedAliases)
    && isOutputCollisionReport(value.output.collisionReport)
    && isRecord(value.omitted)
    && isNonNegativeInteger(value.omitted.total)
    && isCountMap(value.omitted.byScope)
    && isCountMap(value.omitted.byDomain)
    && isCountMap(value.omitted.byKind)
    && isCompositionSourceRefs(value.sourceRefs)
}

function isCompositionOutputPaths(value: unknown): boolean {
  return Array.isArray(value) && value.every(entry => (
    isRecord(entry)
    && typeof entry.canonicalId === 'string'
    && isOptionalString(entry, 'openApiPath')
    && typeof entry.direct === 'boolean'
    && typeof entry.sourcePath === 'string'
    && typeof entry.sourcePointer === 'string'
  ))
}

const COMPONENT_KINDS = [
  'schema',
  'response',
  'parameter',
  'requestBody',
  'header',
  'link',
  'callback',
  'securityScheme',
] as const

function isCompositionOutputComponents(value: unknown): boolean {
  return Array.isArray(value) && value.every(entry => (
    isRecord(entry)
    && typeof entry.canonicalId === 'string'
    && COMPONENT_KINDS.includes(entry.kind as typeof COMPONENT_KINDS[number])
    && typeof entry.section === 'string'
    && typeof entry.outputName === 'string'
    && typeof entry.outputPointer === 'string'
    && typeof entry.direct === 'boolean'
    && typeof entry.sourcePath === 'string'
    && typeof entry.sourcePointer === 'string'
  ))
}

function isOutputAliases(value: unknown): boolean {
  return Array.isArray(value) && value.every(entry => (
    isRecord(entry)
    && typeof entry.id === 'string'
    && COMPONENT_KINDS.includes(entry.kind as typeof COMPONENT_KINDS[number])
    && typeof entry.scope === 'string'
    && typeof entry.domain === 'string'
    && typeof entry.localName === 'string'
    && typeof entry.outputName === 'string'
    && ['preserve-if-unique', 'domain-prefix', 'explicit-alias'].includes(String(entry.reason))
  ))
}

function isOutputCollisionReport(value: unknown): boolean {
  return Array.isArray(value) && value.every(entry => (
    isRecord(entry)
    && typeof entry.canonicalId === 'string'
    && typeof entry.targetName === 'string'
    && COMPONENT_KINDS.includes(entry.kind as typeof COMPONENT_KINDS[number])
    && typeof entry.scope === 'string'
    && typeof entry.domain === 'string'
    && typeof entry.localName === 'string'
    && typeof entry.outputName === 'string'
    && ['preserve-if-unique', 'domain-prefix', 'explicit-alias', 'output-name-collision'].includes(String(entry.reason))
    && ['info', 'warning', 'error'].includes(String(entry.severity))
  ))
}

function isCompositionSourceRefs(value: unknown): boolean {
  return Array.isArray(value) && value.every(entry => (
    isRecord(entry)
    && typeof entry.sourceId === 'string'
    && typeof entry.ref === 'string'
    && typeof entry.sourcePath === 'string'
    && typeof entry.sourcePointer === 'string'
    && isOptionalString(entry, 'targetId')
  ))
}

function isObservedInputEvidence(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  let previousPath = ''
  for (const entry of value) {
    if (!isRecord(entry)
      || typeof entry.path !== 'string'
      || entry.class !== 'evidence-only'
      || !['available', 'missing', 'unreadable'].includes(String(entry.availability))
      || (entry.contentHash !== undefined && typeof entry.contentHash !== 'string')
      || (entry.reason !== undefined && typeof entry.reason !== 'string')
      || entry.path <= previousPath
      || (entry.availability === 'available' && typeof entry.contentHash !== 'string')
      || (entry.availability !== 'available' && entry.contentHash !== undefined)) {
      return false
    }
    previousPath = entry.path
  }
  return true
}

function isTypeSpecCompileEvidence(value: unknown): value is SpecLensTypeSpecCompileEvidence {
  return isRecord(value)
    && value.schemaVersion === 'oa-sdk.spec-lens.typespec-compile.v1'
    && value.manifestSchemaVersion === 'oa-sdk.typespec-bundle.v1'
    && typeof value.entrypoint === 'string'
    && isStringArray(value.sourceFiles)
    && ['sidecar', 'typespec-extensions'].includes(String(value.compatibilitySource))
    && isTypeSpecToolchain(value.toolchain)
    && isRecord(value.compiler)
    && value.compiler.configSource === 'generated-allowlist'
    && value.compiler.emitter === '@typespec/openapi3'
    && value.compiler.openapiVersion === '3.2.0'
    && isStringArray(value.compiler.packageImports)
    && sameStrings(value.compiler.packageImports, ['@oa-sdk/typespec-decorators', '@typespec/http', '@typespec/openapi'])
    && isRecord(value.compiler.resources)
    && isNonNegativeInteger(value.compiler.resources.timeoutMs)
    && Number(value.compiler.resources.timeoutMs) > 0
    && isNonNegativeInteger(value.compiler.resources.maxOutputBytes)
    && Number(value.compiler.resources.maxOutputBytes) > 0
    && isNonNegativeInteger(value.compiler.resources.maxOldSpaceSizeMb)
    && Number(value.compiler.resources.maxOldSpaceSizeMb) > 0
    && isCanonicalSourceReadBudget(value.compiler.resources.sourceReadBudget)
    && value.compiler.resources.maxArtifactBytes === 32 * 1024 * 1024
    && value.compiler.resources.isolationPolicy === 'oa-sdk.spec-lens.typespec-isolation.v2'
    && isRecord(value.validation)
    && isValidationResult(value.validation.emitted)
    && isValidationResult(value.validation.restored)
    && (value.validation.expected === undefined || isValidationResult(value.validation.expected))
    && isRecord(value.gates)
    && value.gates.compatibilitySidecar === 'pass'
    && value.gates.restoredValidation === 'pass'
    && (value.gates.expectedDiff === undefined || value.gates.expectedDiff === 'pass')
}

function isTypeSpecToolchain(value: unknown): boolean {
  return isRecord(value)
    && value.schemaVersion === 'oa-sdk.spec-lens.typespec-toolchain.v1'
    && typeof value.fingerprint === 'string'
    && /^[a-f0-9]{64}$/.test(value.fingerprint)
    && isRecord(value.packages)
    && typeof value.packages['@oa-sdk/typespec-decorators'] === 'string'
    && typeof value.packages['@typespec/compiler'] === 'string'
    && typeof value.packages['@typespec/http'] === 'string'
    && typeof value.packages['@typespec/openapi'] === 'string'
    && typeof value.packages['@typespec/openapi3'] === 'string'
    && isRecord(value.trustedLibraryDigests)
    && typeof value.trustedLibraryDigests['@oa-sdk/typespec-decorators'] === 'string'
    && value.restoreContract === 'oa-sdk.codegen.typespec-restore.v1'
    && value.isolationPolicy === 'oa-sdk.spec-lens.typespec-isolation.v2'
    && isRecord(value.resourcePolicy)
    && value.resourcePolicy.compileTimeoutMs === 60_000
    && value.resourcePolicy.compileMaxOutputBytes === 256 * 1024
    && value.resourcePolicy.compileMaxOldSpaceSizeMb === 512
    && isCanonicalSourceReadBudget(value.resourcePolicy.sourceReadBudget)
    && value.resourcePolicy.maxArtifactBytes === 32 * 1024 * 1024
}

function isCanonicalSourceReadBudget(value: unknown): boolean {
  return isRecord(value)
    && value.schemaVersion === 'oa-sdk.spec-lens.source-read-budget.v1'
    && value.maxFiles === 256
    && value.maxFileBytes === 2 * 1024 * 1024
    && value.maxTotalBytes === 16 * 1024 * 1024
    && value.maxConcurrency === 4
}

function isValidationResult(value: unknown): boolean {
  return isRecord(value)
    && typeof value.valid === 'boolean'
    && typeof value.summary === 'string'
}

function isNormalizedDiff(value: unknown): boolean {
  return Array.isArray(value) && value.every(entry => (
    isRecord(entry)
    && ['root', 'server', 'path', 'component', 'security'].includes(String(entry.category))
    && ['added', 'removed', 'changed'].includes(String(entry.kind))
    && typeof entry.pointer === 'string'
    && typeof entry.message === 'string'
  ))
}

function isBreakingDiff(value: unknown): boolean {
  return Array.isArray(value) && value.every(entry => (
    isRecord(entry)
    && typeof entry.code === 'string'
    && typeof entry.endpoint === 'string'
    && typeof entry.detail === 'string'
    && ['breaking', 'non-breaking'].includes(String(entry.severity))
  ))
}

function isProvenanceDiff(value: unknown): boolean {
  return Array.isArray(value) && value.every(entry => (
    isRecord(entry)
    && ['added', 'removed', 'changed'].includes(String(entry.kind))
    && typeof entry.pointer === 'string'
    && typeof entry.message === 'string'
    && (entry.base === undefined || isProvenanceEntry(entry.base))
    && (entry.head === undefined || isProvenanceEntry(entry.head))
    && (entry.kind !== 'added' || (entry.base === undefined && isProvenanceEntry(entry.head)))
    && (entry.kind !== 'removed' || (isProvenanceEntry(entry.base) && entry.head === undefined))
    && (entry.kind !== 'changed' || (isProvenanceEntry(entry.base) && isProvenanceEntry(entry.head)))
  ))
}

function isDiffStats(value: unknown): boolean {
  return isRecord(value) && hasNonNegativeIntegerFields(value, [
    'pathsAdded',
    'pathsRemoved',
    'pathsChanged',
    'schemasAdded',
    'schemasRemoved',
    'schemasChanged',
    'breakingChanges',
  ])
}

function hasNonNegativeIntegerFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every(field => isNonNegativeInteger(value[field]))
}

function isCountMap(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(isNonNegativeInteger)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string')
}

function isOptionalString(value: Record<string, unknown>, key: string): boolean {
  return value[key] === undefined || typeof value[key] === 'string'
}

function isNonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function sourceFileEvidenceMatchesEntries(
  sourceFiles: Array<{ relativePath: string; contentHash: string }>,
  entryRefs: Array<{ relativePath: string; contentHash: string }>,
): boolean {
  const entries = new Map(entryRefs.map(entry => [entry.relativePath, entry.contentHash]))
  return sourceFiles.every(source => entries.get(source.relativePath) === source.contentHash)
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/** A JSON string-array column; any other JSON value reads as null. */
const StoredStringArraySchema = {
  parse(value: unknown): string[] | null {
    return isStringArray(value) ? value : null
  },
}

function parseStoredStringArray(value: string): string[] | null {
  try {
    return StoredStringArraySchema.parse(JSON.parse(value))
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
