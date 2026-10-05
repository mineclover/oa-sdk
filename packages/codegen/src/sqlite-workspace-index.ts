import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type {
  TypeArtifactFilter,
  TypeArtifactRecord,
  TypeBoundaryFilter,
  TypeBoundaryRecord,
  TypeDeclarationFilter,
  TypeDeclarationRecord,
  TypeExposureFilter,
  TypeExposureRecord,
  TypeRegistrySnapshot,
  TypeRelationFilter,
  TypeRelationRecord,
  WorkspaceTypeFileIndexData,
} from './type-registry.js'
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
import {
  GENERATION_TARGET_INPUT_KINDS,
  type GenerationTargetInputKind,
  type GenerationTargetInputRecord,
  type GenerationTargetOutputRecord,
  type GenerationTargetRecord,
  type GenerationTargetStore,
} from './generation-target-store.js'

export const SQLITE_WORKSPACE_INDEX_SCHEMA_VERSION = 2

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

class NodeSQLiteWorkspaceIndex implements SQLiteWorkspaceIndex, GenerationTargetStore {
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

  replaceTypeFileIndex(filePath: string, data: WorkspaceTypeFileIndexData): void {
    this.write(() => {
      const db = this.database()
      db.prepare('DELETE FROM type_exposures WHERE file_path = ?').run(filePath)
      db.prepare('DELETE FROM type_boundaries WHERE file_path = ?').run(filePath)
      db.prepare('DELETE FROM type_relations WHERE file_path = ?').run(filePath)
      db.prepare('DELETE FROM type_declarations WHERE file_path = ?').run(filePath)
      db.prepare('DELETE FROM type_artifacts WHERE file_path = ?').run(filePath)

      const insertArtifact = db.prepare(`
        INSERT INTO type_artifacts (
          artifact_id,
          file_path,
          package_name,
          logical_module,
          runtime,
          origin,
          role,
          content_hash,
          compiler_version,
          tsconfig_hash,
          generator_id,
          generator_version,
          generator_input_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const artifact of data.artifacts ?? []) {
        insertArtifact.run(
          artifact.artifactId,
          artifact.filePath,
          artifact.packageName ?? null,
          artifact.logicalModule ?? null,
          artifact.runtime,
          artifact.origin,
          artifact.role,
          artifact.contentHash,
          artifact.compilerVersion ?? null,
          artifact.tsconfigHash ?? null,
          artifact.generatorId ?? null,
          artifact.generatorVersion ?? null,
          artifact.generatorInputHash ?? null,
        )
      }

      const insertDeclaration = db.prepare(`
        INSERT INTO type_declarations (
          declaration_id,
          artifact_id,
          file_path,
          symbol_name,
          qualified_name,
          kind,
          exported,
          generic_arity,
          line,
          column,
          end_line,
          end_column,
          syntax_hash,
          shape_hash,
          semantic_hash,
          canonical_ir
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const declaration of data.declarations ?? []) {
        insertDeclaration.run(
          declaration.declarationId,
          declaration.artifactId,
          declaration.filePath,
          declaration.symbolName,
          declaration.qualifiedName,
          declaration.kind,
          declaration.exported ? 1 : 0,
          declaration.genericArity,
          declaration.line,
          declaration.column,
          declaration.endLine,
          declaration.endColumn,
          declaration.syntaxHash,
          declaration.shapeHash,
          declaration.semanticHash,
          declaration.canonicalIr,
        )
      }

      const insertRelation = db.prepare(`
        INSERT INTO type_relations (
          relation_id,
          file_path,
          from_declaration_id,
          kind,
          to_declaration_id,
          target_specifier,
          target_symbol,
          type_only,
          resolved,
          export_mapped
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const relation of data.relations ?? []) {
        insertRelation.run(
          relation.relationId,
          relation.filePath,
          relation.fromDeclarationId ?? null,
          relation.kind,
          relation.toDeclarationId ?? null,
          relation.targetSpecifier ?? null,
          relation.targetSymbol ?? null,
          relation.typeOnly === undefined ? null : relation.typeOnly ? 1 : 0,
          relation.resolved ? 1 : 0,
          relation.exportMapped === undefined ? null : relation.exportMapped ? 1 : 0,
        )
      }

      const insertBoundary = db.prepare(`
        INSERT INTO type_boundaries (
          boundary_id,
          file_path,
          line,
          column,
          kind,
          source_type,
          target_type,
          validator_symbol,
          suppression
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const boundary of data.boundaries ?? []) {
        insertBoundary.run(
          boundary.boundaryId,
          boundary.filePath,
          boundary.line,
          boundary.column,
          boundary.kind,
          boundary.sourceType ?? null,
          boundary.targetType ?? null,
          boundary.validatorSymbol ?? null,
          boundary.suppression ?? null,
        )
      }

      const insertExposure = db.prepare(`
        INSERT INTO type_exposures (
          exposure_id,
          declaration_id,
          file_path,
          package_name,
          export_key,
          export_name,
          local_name,
          target_specifier,
          runtime,
          kind,
          reexport
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const exposure of data.exposures ?? []) {
        insertExposure.run(
          exposure.exposureId,
          exposure.declarationId ?? null,
          exposure.filePath,
          exposure.packageName ?? null,
          exposure.exportKey,
          exposure.exportName,
          exposure.localName ?? null,
          exposure.targetSpecifier ?? null,
          exposure.runtime,
          exposure.kind,
          exposure.reexport ? 1 : 0,
        )
      }
    })
  }

  invalidateTypeFiles(filePaths: readonly string[]): void {
    this.write(() => {
      const db = this.database()
      const deleteExposure = db.prepare('DELETE FROM type_exposures WHERE file_path = ?')
      const deleteBoundary = db.prepare('DELETE FROM type_boundaries WHERE file_path = ?')
      const deleteRelation = db.prepare('DELETE FROM type_relations WHERE file_path = ?')
      const deleteDeclaration = db.prepare('DELETE FROM type_declarations WHERE file_path = ?')
      const deleteArtifact = db.prepare('DELETE FROM type_artifacts WHERE file_path = ?')
      for (const filePath of filePaths) {
        deleteExposure.run(filePath)
        deleteBoundary.run(filePath)
        deleteRelation.run(filePath)
        deleteDeclaration.run(filePath)
        deleteArtifact.run(filePath)
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

  listTypeArtifacts(filter: TypeArtifactFilter = {}): TypeArtifactRecord[] {
    return this.read(() => this.database()
      .prepare('SELECT * FROM type_artifacts ORDER BY artifact_id')
      .all()
      .map(typeArtifactFromRow)
      .filter(artifact =>
        matchesOptional(filter.filePath, artifact.filePath)
        && matchesOptional(filter.packageName, artifact.packageName)
        && matchesOptional(filter.runtime, artifact.runtime)
        && matchesOptional(filter.origin, artifact.origin)
        && matchesOptional(filter.role, artifact.role)
      ), [])
  }

  listTypeDeclarations(filter: TypeDeclarationFilter = {}): TypeDeclarationRecord[] {
    return this.read(() => this.database()
      .prepare('SELECT * FROM type_declarations ORDER BY declaration_id')
      .all()
      .map(typeDeclarationFromRow)
      .filter(declaration =>
        matchesOptional(filter.artifactId, declaration.artifactId)
        && matchesOptional(filter.filePath, declaration.filePath)
        && matchesOptional(filter.symbolName, declaration.symbolName)
        && matchesOptional(filter.kind, declaration.kind)
        && matchesOptional(filter.exported, declaration.exported)
        && matchesOptional(filter.shapeHash, declaration.shapeHash)
        && matchesOptional(filter.semanticHash, declaration.semanticHash)
      ), [])
  }

  listTypeRelations(filter: TypeRelationFilter = {}): TypeRelationRecord[] {
    return this.read(() => this.database()
      .prepare('SELECT * FROM type_relations ORDER BY relation_id')
      .all()
      .map(typeRelationFromRow)
      .filter(relation =>
        matchesOptional(filter.filePath, relation.filePath)
        && matchesOptional(filter.fromDeclarationId, relation.fromDeclarationId)
        && matchesOptional(filter.kind, relation.kind)
        && matchesOptional(filter.toDeclarationId, relation.toDeclarationId)
        && matchesOptional(filter.targetSpecifier, relation.targetSpecifier)
      ), [])
  }

  listTypeBoundaries(filter: TypeBoundaryFilter = {}): TypeBoundaryRecord[] {
    return this.read(() => this.database()
      .prepare('SELECT * FROM type_boundaries ORDER BY boundary_id')
      .all()
      .map(typeBoundaryFromRow)
      .filter(boundary =>
        matchesOptional(filter.filePath, boundary.filePath)
        && matchesOptional(filter.kind, boundary.kind)
      ), [])
  }

  listTypeExposures(filter: TypeExposureFilter = {}): TypeExposureRecord[] {
    return this.read(() => this.database()
      .prepare('SELECT * FROM type_exposures ORDER BY exposure_id')
      .all()
      .map(typeExposureFromRow)
      .filter(exposure =>
        matchesOptional(filter.filePath, exposure.filePath)
        && matchesOptional(filter.packageName, exposure.packageName)
        && matchesOptional(filter.exportKey, exposure.exportKey)
        && matchesOptional(filter.exportName, exposure.exportName)
        && matchesOptional(filter.runtime, exposure.runtime)
        && matchesOptional(filter.kind, exposure.kind)
      ), [])
  }

  clearTypes(): void {
    this.write(() => {
      this.database().exec(`
        DELETE FROM type_exposures;
        DELETE FROM type_boundaries;
        DELETE FROM type_relations;
        DELETE FROM type_declarations;
        DELETE FROM type_artifacts;
      `)
    })
  }

  snapshotTypes(): TypeRegistrySnapshot {
    return {
      artifacts: this.listTypeArtifacts(),
      declarations: this.listTypeDeclarations(),
      relations: this.listTypeRelations(),
      boundaries: this.listTypeBoundaries(),
      exposures: this.listTypeExposures(),
    }
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

  getGenerationTarget(targetKey: string): GenerationTargetRecord | undefined {
    return this.read(() => {
      const db = this.database()
      const row = db.prepare('SELECT * FROM generation_targets WHERE target_key = ?').get(targetKey)
      if (!row) return undefined
      const inputRows = db
        .prepare('SELECT kind, path, value, verified FROM generation_target_observations WHERE target_key = ? ORDER BY path, kind')
        .all(targetKey)
      return generationTargetFromRows(row, inputRows)
    }, undefined)
  }

  replaceGenerationTarget(record: GenerationTargetRecord): void {
    this.write(() => {
      const db = this.database()
      db.prepare('DELETE FROM generation_target_observations WHERE target_key = ?').run(record.targetKey)
      db.prepare('DELETE FROM generation_targets WHERE target_key = ?').run(record.targetKey)
      db.prepare(`
        INSERT INTO generation_targets (
          target_key,
          command,
          options_hash,
          generator_hash,
          output_kind,
          output_path,
          output_hash,
          output_content,
          messages_json,
          last_run
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.targetKey,
        record.command,
        record.optionsHash,
        record.generatorHash,
        record.output.kind,
        record.output.kind === 'file' ? record.output.filePath : null,
        record.output.contentHash,
        record.output.kind === 'stdout' ? record.output.content : null,
        JSON.stringify(record.messages),
        record.lastRun ?? null,
      )
      const insertInput = db.prepare(`
        INSERT INTO generation_target_observations (target_key, kind, path, value, verified)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(target_key, kind, path) DO UPDATE SET value = excluded.value, verified = excluded.verified
      `)
      for (const input of record.inputs) {
        const verified = !('unverified' in input)
        insertInput.run(record.targetKey, input.kind, input.path, verified ? input.value : input.unverified, verified ? 1 : 0)
      }
    })
  }

  deleteGenerationTarget(targetKey: string): void {
    this.write(() => {
      const db = this.database()
      db.prepare('DELETE FROM generation_target_observations WHERE target_key = ?').run(targetKey)
      db.prepare('DELETE FROM generation_targets WHERE target_key = ?').run(targetKey)
    })
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

      CREATE TABLE IF NOT EXISTS type_artifacts (
        artifact_id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        package_name TEXT,
        logical_module TEXT,
        runtime TEXT NOT NULL,
        origin TEXT NOT NULL,
        role TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        compiler_version TEXT,
        tsconfig_hash TEXT,
        generator_id TEXT,
        generator_version TEXT,
        generator_input_hash TEXT,
        FOREIGN KEY(file_path) REFERENCES files(file_path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS type_artifacts_file_idx
        ON type_artifacts(file_path);

      CREATE INDEX IF NOT EXISTS type_artifacts_package_runtime_idx
        ON type_artifacts(package_name, runtime, origin);

      CREATE TABLE IF NOT EXISTS type_declarations (
        declaration_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        symbol_name TEXT NOT NULL,
        qualified_name TEXT NOT NULL,
        kind TEXT NOT NULL,
        exported INTEGER NOT NULL,
        generic_arity INTEGER NOT NULL,
        line INTEGER NOT NULL,
        column INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        end_column INTEGER NOT NULL,
        syntax_hash TEXT NOT NULL,
        shape_hash TEXT NOT NULL,
        semantic_hash TEXT NOT NULL,
        canonical_ir TEXT NOT NULL,
        FOREIGN KEY(artifact_id) REFERENCES type_artifacts(artifact_id) ON DELETE CASCADE,
        FOREIGN KEY(file_path) REFERENCES files(file_path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS type_declarations_file_symbol_idx
        ON type_declarations(file_path, symbol_name);

      CREATE INDEX IF NOT EXISTS type_declarations_shape_idx
        ON type_declarations(shape_hash);

      CREATE INDEX IF NOT EXISTS type_declarations_semantic_idx
        ON type_declarations(semantic_hash);

      CREATE TABLE IF NOT EXISTS type_relations (
        relation_id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        from_declaration_id TEXT,
        kind TEXT NOT NULL,
        to_declaration_id TEXT,
        target_specifier TEXT,
        target_symbol TEXT,
        type_only INTEGER,
        resolved INTEGER NOT NULL,
        export_mapped INTEGER,
        FOREIGN KEY(file_path) REFERENCES files(file_path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS type_relations_from_idx
        ON type_relations(from_declaration_id, kind);

      CREATE INDEX IF NOT EXISTS type_relations_target_idx
        ON type_relations(to_declaration_id, target_specifier);

      CREATE TABLE IF NOT EXISTS type_boundaries (
        boundary_id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        line INTEGER NOT NULL,
        column INTEGER NOT NULL,
        kind TEXT NOT NULL,
        source_type TEXT,
        target_type TEXT,
        validator_symbol TEXT,
        suppression TEXT,
        FOREIGN KEY(file_path) REFERENCES files(file_path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS type_boundaries_file_kind_idx
        ON type_boundaries(file_path, kind);

      CREATE TABLE IF NOT EXISTS type_exposures (
        exposure_id TEXT PRIMARY KEY,
        declaration_id TEXT,
        file_path TEXT NOT NULL,
        package_name TEXT,
        export_key TEXT NOT NULL,
        export_name TEXT NOT NULL,
        local_name TEXT,
        target_specifier TEXT,
        runtime TEXT NOT NULL,
        kind TEXT NOT NULL,
        reexport INTEGER NOT NULL,
        FOREIGN KEY(file_path) REFERENCES files(file_path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS type_exposures_surface_idx
        ON type_exposures(package_name, export_key, runtime, export_name);

      -- Generation targets are self-contained (no foreign key into files):
      -- their freshness is checked against their own input observations, so file
      -- invalidation for one command never makes another target look fresh.
      -- Additive tables: older readers ignore them, so the schema version is unchanged.
      CREATE TABLE IF NOT EXISTS generation_targets (
        target_key TEXT PRIMARY KEY,
        command TEXT NOT NULL,
        options_hash TEXT NOT NULL,
        generator_hash TEXT NOT NULL,
        output_kind TEXT NOT NULL,
        output_path TEXT,
        output_hash TEXT NOT NULL,
        output_content TEXT,
        messages_json TEXT NOT NULL,
        last_run TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      -- One file-system observation generation depended on (kind: content,
      -- entry or realpath). verified = 1: value is the observed value (NULL =
      -- absent / unresolvable). verified = 0: value is why the run could not
      -- establish what generation observed; such a row never matches.
      CREATE TABLE IF NOT EXISTS generation_target_observations (
        target_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        value TEXT,
        verified INTEGER NOT NULL,
        PRIMARY KEY (target_key, kind, path),
        FOREIGN KEY(target_key) REFERENCES generation_targets(target_key) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS generation_target_observations_path_idx
        ON generation_target_observations(path);
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

    const driverCompatible = existingDriverName === undefined || existingDriverName === this.driverName
    const isAdditiveTypeRegistryUpgrade = existingSchemaVersion === '1'
      && this.schemaVersion === SQLITE_WORKSPACE_INDEX_SCHEMA_VERSION
      && SQLITE_WORKSPACE_INDEX_SCHEMA_VERSION === 2
      && existingCompatibilityHash === this.compatibilityHash
      && driverCompatible

    if (isAdditiveTypeRegistryUpgrade) {
      // Schema v2 only adds Type Registry tables. initializeSchema() has already
      // created them, so retain the existing OpenAPI cache rows and advance meta.
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
      DELETE FROM generation_target_observations;
      DELETE FROM generation_targets;
      DELETE FROM type_exposures;
      DELETE FROM type_boundaries;
      DELETE FROM type_relations;
      DELETE FROM type_declarations;
      DELETE FROM type_artifacts;
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
  // Prefer node:sqlite (built-in, no native compilation, ~40% faster on the
  // warm-cache workload that dominates incremental tool runs — see
  // packages/codegen/scripts/bench-sqlite-driver.ts). Fall back to
  // better-sqlite3 when node:sqlite is unavailable (for example, Node <22.5
  // or Node 22.5–22.12 without --experimental-sqlite).
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

function typeArtifactFromRow(row: Record<string, unknown>): TypeArtifactRecord {
  const record: TypeArtifactRecord = {
    artifactId: requireString(row, 'artifact_id'),
    filePath: requireString(row, 'file_path'),
    runtime: requireString(row, 'runtime') as TypeArtifactRecord['runtime'],
    origin: requireString(row, 'origin') as TypeArtifactRecord['origin'],
    role: requireString(row, 'role') as TypeArtifactRecord['role'],
    contentHash: requireString(row, 'content_hash'),
  }
  assignOptionalString(record, 'packageName', row.package_name)
  assignOptionalString(record, 'logicalModule', row.logical_module)
  assignOptionalString(record, 'compilerVersion', row.compiler_version)
  assignOptionalString(record, 'tsconfigHash', row.tsconfig_hash)
  assignOptionalString(record, 'generatorId', row.generator_id)
  assignOptionalString(record, 'generatorVersion', row.generator_version)
  assignOptionalString(record, 'generatorInputHash', row.generator_input_hash)
  return record
}

function typeDeclarationFromRow(row: Record<string, unknown>): TypeDeclarationRecord {
  return {
    declarationId: requireString(row, 'declaration_id'),
    artifactId: requireString(row, 'artifact_id'),
    filePath: requireString(row, 'file_path'),
    symbolName: requireString(row, 'symbol_name'),
    qualifiedName: requireString(row, 'qualified_name'),
    kind: requireString(row, 'kind') as TypeDeclarationRecord['kind'],
    exported: requireNumber(row, 'exported') === 1,
    genericArity: requireNumber(row, 'generic_arity'),
    line: requireNumber(row, 'line'),
    column: requireNumber(row, 'column'),
    endLine: requireNumber(row, 'end_line'),
    endColumn: requireNumber(row, 'end_column'),
    syntaxHash: requireString(row, 'syntax_hash'),
    shapeHash: requireString(row, 'shape_hash'),
    semanticHash: requireString(row, 'semantic_hash'),
    canonicalIr: requireString(row, 'canonical_ir'),
  }
}

function typeRelationFromRow(row: Record<string, unknown>): TypeRelationRecord {
  const record: TypeRelationRecord = {
    relationId: requireString(row, 'relation_id'),
    filePath: requireString(row, 'file_path'),
    kind: requireString(row, 'kind') as TypeRelationRecord['kind'],
    resolved: requireNumber(row, 'resolved') === 1,
  }
  assignOptionalString(record, 'fromDeclarationId', row.from_declaration_id)
  assignOptionalString(record, 'toDeclarationId', row.to_declaration_id)
  assignOptionalString(record, 'targetSpecifier', row.target_specifier)
  assignOptionalString(record, 'targetSymbol', row.target_symbol)
  assignOptionalBoolean(record, 'typeOnly', row.type_only)
  assignOptionalBoolean(record, 'exportMapped', row.export_mapped)
  return record
}

function typeBoundaryFromRow(row: Record<string, unknown>): TypeBoundaryRecord {
  const record: TypeBoundaryRecord = {
    boundaryId: requireString(row, 'boundary_id'),
    filePath: requireString(row, 'file_path'),
    line: requireNumber(row, 'line'),
    column: requireNumber(row, 'column'),
    kind: requireString(row, 'kind') as TypeBoundaryRecord['kind'],
  }
  assignOptionalString(record, 'sourceType', row.source_type)
  assignOptionalString(record, 'targetType', row.target_type)
  assignOptionalString(record, 'validatorSymbol', row.validator_symbol)
  assignOptionalString(record, 'suppression', row.suppression)
  return record
}

function typeExposureFromRow(row: Record<string, unknown>): TypeExposureRecord {
  const record: TypeExposureRecord = {
    exposureId: requireString(row, 'exposure_id'),
    filePath: requireString(row, 'file_path'),
    exportKey: requireString(row, 'export_key'),
    exportName: requireString(row, 'export_name'),
    runtime: requireString(row, 'runtime') as TypeExposureRecord['runtime'],
    kind: requireString(row, 'kind') as TypeExposureRecord['kind'],
    reexport: requireNumber(row, 'reexport') === 1,
  }
  assignOptionalString(record, 'declarationId', row.declaration_id)
  assignOptionalString(record, 'packageName', row.package_name)
  assignOptionalString(record, 'localName', row.local_name)
  assignOptionalString(record, 'targetSpecifier', row.target_specifier)
  return record
}

/**
 * Rebuild a generation target from its rows. A row that does not match the
 * expected shape yields undefined, which callers treat as "no reusable record"
 * (regenerate and overwrite) instead of a store failure.
 */
function generationTargetFromRows(
  row: Record<string, unknown>,
  inputRows: readonly Record<string, unknown>[],
): GenerationTargetRecord | undefined {
  const { target_key, command, options_hash, generator_hash, output_kind, output_path, output_hash, output_content } = row
  if (
    typeof target_key !== 'string'
    || typeof command !== 'string'
    || typeof options_hash !== 'string'
    || typeof generator_hash !== 'string'
    || typeof output_hash !== 'string'
  ) return undefined

  let output: GenerationTargetOutputRecord
  if (output_kind === 'file' && typeof output_path === 'string') {
    output = { kind: 'file', filePath: output_path, contentHash: output_hash }
  } else if (output_kind === 'stdout' && typeof output_content === 'string') {
    output = { kind: 'stdout', contentHash: output_hash, content: output_content }
  } else {
    return undefined
  }

  const messages = parseStringArray(row.messages_json)
  if (!messages) return undefined

  const inputs: GenerationTargetInputRecord[] = []
  for (const inputRow of inputRows) {
    const input = generationTargetInputFromRow(inputRow)
    if (!input) return undefined
    inputs.push(input)
  }
  // Every generation reads at least its entry spec: a target without inputs
  // (for example rows left by an earlier record format) is not reusable.
  if (inputs.length === 0) return undefined

  const record: GenerationTargetRecord = {
    targetKey: target_key,
    command,
    optionsHash: options_hash,
    generatorHash: generator_hash,
    inputs,
    output,
    messages,
  }
  assignOptionalString(record, 'lastRun', row.last_run)
  return record
}

function generationTargetInputFromRow(row: Record<string, unknown>): GenerationTargetInputRecord | undefined {
  const { kind, path, value, verified } = row
  if (!isGenerationTargetInputKind(kind) || typeof path !== 'string') return undefined
  if (Number(verified) === 0) return typeof value === 'string' ? { kind, path, unverified: value } : undefined
  if (Number(verified) !== 1 || (value !== null && typeof value !== 'string')) return undefined
  return { kind, path, value }
}

function isGenerationTargetInputKind(value: unknown): value is GenerationTargetInputKind {
  return typeof value === 'string' && (GENERATION_TARGET_INPUT_KINDS as readonly string[]).includes(value)
}

function parseStringArray(value: unknown): string[] | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) && parsed.every(item => typeof item === 'string') ? parsed : undefined
  } catch {
    return undefined
  }
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

function assignOptionalBoolean<T extends object, K extends keyof T>(target: T, key: K, value: unknown): void {
  if (typeof value === 'number') {
    ;(target as Record<K, boolean>)[key] = value === 1
  } else if (typeof value === 'bigint') {
    ;(target as Record<K, boolean>)[key] = value === 1n
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
