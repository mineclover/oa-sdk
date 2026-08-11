import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSQLiteWorkspaceIndex, type SQLiteWorkspaceIndexOptions } from './sqlite-workspace-index.js'
import {
  createMemoryTypeRegistry,
  createNoopTypeRegistry,
  type TypeArtifactFilter,
  type TypeArtifactRecord,
  type TypeBoundaryFilter,
  type TypeBoundaryRecord,
  type TypeDeclarationFilter,
  type TypeDeclarationRecord,
  type TypeExposureFilter,
  type TypeExposureRecord,
  type TypeRegistry,
  type TypeRegistrySnapshot,
  type TypeRelationFilter,
  type TypeRelationRecord,
  type WorkspaceTypeFileIndexData,
} from './type-registry.js'

export type WorkspaceIndexMode = 'noop' | 'memory' | 'sqlite'

export type WorkspaceFileRecord = {
  filePath: string
  realPath?: string
  contentHash: string
  size: number
  mtimeMs: number
  parserVersion?: string
  lastSeenRun?: string
}

export type WorkspaceSourceLocationRecord = {
  filePath: string
  pointer: string
  line: number
  column: number
}

export type WorkspaceComponentRecord = {
  filePath: string
  section: string
  name: string
  pointer: string
  contentHash: string
  owner?: string
  line?: number
  column?: number
}

export type WorkspaceRefKind = 'internal' | 'external' | 'unsupported'

export type WorkspaceRefRecord = {
  fromFile: string
  fromPointer: string
  refText: string
  kind: WorkspaceRefKind
  resolved: boolean
  toFile?: string
  toPointer?: string
  diagnosticCode?: string
}

export type WorkspaceDiagnosticSeverity = 'error' | 'warning' | 'info'

export type WorkspaceDiagnosticRecord = {
  producer: string
  severity: WorkspaceDiagnosticSeverity
  code: string
  message: string
  filePath?: string
  pointer?: string
  line?: number
  column?: number
}

export type WorkspaceTypeAliasRecord = {
  sourceFile: string
  sourcePointer: string
  refText: string
  aliasName: string
  contentHash: string
  renamedFrom?: string
}

export type WorkspaceFileIndexData = {
  components?: readonly WorkspaceComponentRecord[]
  refs?: readonly WorkspaceRefRecord[]
  sourceLocations?: readonly WorkspaceSourceLocationRecord[]
  diagnostics?: readonly WorkspaceDiagnosticRecord[]
  typeAliases?: readonly WorkspaceTypeAliasRecord[]
}

export type WorkspaceIndexSnapshot = {
  files: WorkspaceFileRecord[]
  components: WorkspaceComponentRecord[]
  refs: WorkspaceRefRecord[]
  sourceLocations: WorkspaceSourceLocationRecord[]
  diagnostics: WorkspaceDiagnosticRecord[]
  typeAliases: WorkspaceTypeAliasRecord[]
}

export type WorkspaceIndexDiff = {
  changed: WorkspaceFileRecord[]
  unchanged: WorkspaceFileRecord[]
  deleted: WorkspaceFileRecord[]
}

export type WorkspaceFileScanOptions = {
  baseDir?: string
  entrySpecs?: readonly string[]
  domainSpecs?: readonly string[]
  profileSpecs?: readonly string[]
  externalRefFiles?: readonly string[]
  parserVersion?: string
  runId?: string
}

export type WorkspaceFileChangeSet = {
  newFiles: WorkspaceFileRecord[]
  modified: WorkspaceFileRecord[]
  changed: WorkspaceFileRecord[]
  unchanged: WorkspaceFileRecord[]
  deleted: WorkspaceFileRecord[]
}

export type WorkspaceDirtyDetectionResult = WorkspaceFileChangeSet & {
  dependentFilePaths: string[]
  dirtyFilePaths: string[]
  dirtyFiles: WorkspaceFileRecord[]
  invalidatedFilePaths: string[]
}

export type WorkspaceComponentFilter = {
  filePath?: string
  section?: string
  name?: string
}

export type WorkspaceRefFilter = {
  fromFile?: string
  toFile?: string
}

export type WorkspaceDiagnosticFilter = {
  filePath?: string
  producer?: string
  severity?: WorkspaceDiagnosticSeverity
}

export type WorkspaceTypeAliasFilter = {
  sourceFile?: string
  aliasName?: string
}

export type WorkspaceIndexCompatibilityMetadata = Record<string, string | number | boolean | null>

export type WorkspaceIndexOptions = {
  mode?: WorkspaceIndexMode
  seed?: Partial<WorkspaceIndexSnapshot>
  typeSeed?: Partial<TypeRegistrySnapshot>
} & SQLiteWorkspaceIndexOptions

export interface WorkspaceIndex extends TypeRegistry {
  readonly mode: WorkspaceIndexMode

  getFile(filePath: string): WorkspaceFileRecord | undefined
  listFiles(): WorkspaceFileRecord[]
  upsertFile(file: WorkspaceFileRecord): void
  deleteFile(filePath: string): void
  detectChanges(files: readonly WorkspaceFileRecord[]): WorkspaceIndexDiff

  replaceFileIndex(filePath: string, data: WorkspaceFileIndexData): void
  invalidateFiles(filePaths: readonly string[]): void

  listComponents(filter?: WorkspaceComponentFilter): WorkspaceComponentRecord[]
  listRefs(filter?: WorkspaceRefFilter): WorkspaceRefRecord[]
  listSourceLocations(filePath?: string): WorkspaceSourceLocationRecord[]
  listDiagnostics(filter?: WorkspaceDiagnosticFilter): WorkspaceDiagnosticRecord[]
  listTypeAliases(filter?: WorkspaceTypeAliasFilter): WorkspaceTypeAliasRecord[]

  clear(): void
  snapshot(): WorkspaceIndexSnapshot
}

export function createWorkspaceIndex(options: WorkspaceIndexOptions = {}): WorkspaceIndex {
  if (options.mode === 'memory') return createMemoryWorkspaceIndex(options.seed, options.typeSeed)
  if (options.mode === 'sqlite') return createSQLiteWorkspaceIndex(options)
  return createNoopWorkspaceIndex()
}

export function createNoopWorkspaceIndex(): WorkspaceIndex {
  return new NoopWorkspaceIndex()
}

export function createMemoryWorkspaceIndex(
  seed: Partial<WorkspaceIndexSnapshot> = {},
  typeSeed: Partial<TypeRegistrySnapshot> = {},
): WorkspaceIndex {
  return new MemoryWorkspaceIndex(seed, typeSeed)
}

export function scanWorkspaceFiles(options: WorkspaceFileScanOptions): WorkspaceFileRecord[] {
  const baseDir = options.baseDir ?? process.cwd()
  const seen = new Set<string>()
  const files: WorkspaceFileRecord[] = []

  for (const filePath of [
    ...(options.entrySpecs ?? []),
    ...(options.domainSpecs ?? []),
    ...(options.profileSpecs ?? []),
    ...(options.externalRefFiles ?? []),
  ]) {
    const resolvedPath = resolve(baseDir, filePath)
    if (seen.has(resolvedPath) || !existsSync(resolvedPath)) continue
    seen.add(resolvedPath)

    const stat = statSync(resolvedPath)
    if (!stat.isFile()) continue

    const content = readFileSync(resolvedPath)
    files.push({
      filePath: resolvedPath,
      realPath: realpathSync.native(resolvedPath),
      contentHash: createHash('sha256').update(content).digest('hex'),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ...(options.parserVersion ? { parserVersion: options.parserVersion } : {}),
      ...(options.runId ? { lastSeenRun: options.runId } : {}),
    })
  }

  return files.sort((a, b) => a.filePath.localeCompare(b.filePath))
}

export function detectWorkspaceFileChanges(
  index: WorkspaceIndex,
  files: readonly WorkspaceFileRecord[],
): WorkspaceFileChangeSet {
  const newFiles: WorkspaceFileRecord[] = []
  const modified: WorkspaceFileRecord[] = []
  const unchanged: WorkspaceFileRecord[] = []
  const incoming = new Set<string>()

  for (const file of files) {
    incoming.add(file.filePath)
    const previous = index.getFile(file.filePath)
    if (!previous) {
      newFiles.push({ ...file })
    } else if (isSameFileRecord(previous, file)) {
      unchanged.push({ ...file })
    } else {
      modified.push({ ...file })
    }
  }

  const deleted = index.listFiles().filter(file => !incoming.has(file.filePath))
  return {
    newFiles,
    modified,
    changed: [...newFiles, ...modified],
    unchanged,
    deleted,
  }
}

export function detectWorkspaceDirtyFiles(
  index: WorkspaceIndex,
  files: readonly WorkspaceFileRecord[],
): WorkspaceDirtyDetectionResult {
  const changes = detectWorkspaceFileChanges(index, files)
  const scannedByPath = new Map(files.map(file => [file.filePath, file]))
  const primaryDirtyPaths = new Set([
    ...changes.changed.map(file => file.filePath),
    ...changes.deleted.map(file => file.filePath),
  ])
  const dependentFilePaths = collectDependentSourceFilePaths(index, primaryDirtyPaths)
  const dirtyFilePaths = sortedUnique([
    ...primaryDirtyPaths,
    ...dependentFilePaths,
  ])
  const dirtyFiles = dirtyFilePaths
    .map(filePath => scannedByPath.get(filePath))
    .filter((file): file is WorkspaceFileRecord => file !== undefined)
    .map(file => ({ ...file }))

  return {
    ...changes,
    dependentFilePaths,
    dirtyFilePaths,
    dirtyFiles,
    invalidatedFilePaths: dirtyFilePaths,
  }
}

export function invalidateWorkspaceDirtyFiles(index: WorkspaceIndex, dirty: WorkspaceDirtyDetectionResult): void {
  index.invalidateFiles(dirty.invalidatedFilePaths)
}

export function listWorkspaceExternalRefFiles(index: WorkspaceIndex): string[] {
  return sortedUnique(index.listRefs()
    .filter(ref => ref.kind === 'external' && ref.toFile !== undefined)
    .map(ref => ref.toFile!))
}

class NoopWorkspaceIndex implements WorkspaceIndex {
  readonly mode = 'noop'
  private readonly typeRegistry = createNoopTypeRegistry()

  getFile(): undefined {
    return undefined
  }

  listFiles(): WorkspaceFileRecord[] {
    return []
  }

  upsertFile(): void {}

  deleteFile(): void {}

  detectChanges(files: readonly WorkspaceFileRecord[]): WorkspaceIndexDiff {
    return { changed: cloneRecords(files), unchanged: [], deleted: [] }
  }

  replaceFileIndex(): void {}

  invalidateFiles(): void {}

  listComponents(): WorkspaceComponentRecord[] {
    return []
  }

  listRefs(): WorkspaceRefRecord[] {
    return []
  }

  listSourceLocations(): WorkspaceSourceLocationRecord[] {
    return []
  }

  listDiagnostics(): WorkspaceDiagnosticRecord[] {
    return []
  }

  listTypeAliases(): WorkspaceTypeAliasRecord[] {
    return []
  }

  replaceTypeFileIndex(filePath: string, data: WorkspaceTypeFileIndexData): void {
    this.typeRegistry.replaceTypeFileIndex(filePath, data)
  }

  invalidateTypeFiles(filePaths: readonly string[]): void {
    this.typeRegistry.invalidateTypeFiles(filePaths)
  }

  listTypeArtifacts(filter?: TypeArtifactFilter): TypeArtifactRecord[] {
    return this.typeRegistry.listTypeArtifacts(filter)
  }

  listTypeDeclarations(filter?: TypeDeclarationFilter): TypeDeclarationRecord[] {
    return this.typeRegistry.listTypeDeclarations(filter)
  }

  listTypeRelations(filter?: TypeRelationFilter): TypeRelationRecord[] {
    return this.typeRegistry.listTypeRelations(filter)
  }

  listTypeBoundaries(filter?: TypeBoundaryFilter): TypeBoundaryRecord[] {
    return this.typeRegistry.listTypeBoundaries(filter)
  }

  listTypeExposures(filter?: TypeExposureFilter): TypeExposureRecord[] {
    return this.typeRegistry.listTypeExposures(filter)
  }

  clearTypes(): void {
    this.typeRegistry.clearTypes()
  }

  snapshotTypes(): TypeRegistrySnapshot {
    return this.typeRegistry.snapshotTypes()
  }

  clear(): void {}

  snapshot(): WorkspaceIndexSnapshot {
    return emptySnapshot()
  }
}

class MemoryWorkspaceIndex implements WorkspaceIndex {
  readonly mode = 'memory'

  private readonly files = new Map<string, WorkspaceFileRecord>()
  private readonly components = new Map<string, WorkspaceComponentRecord[]>()
  private readonly refs = new Map<string, WorkspaceRefRecord[]>()
  private readonly sourceLocations = new Map<string, WorkspaceSourceLocationRecord[]>()
  private readonly diagnostics = new Map<string, WorkspaceDiagnosticRecord[]>()
  private readonly typeAliases = new Map<string, WorkspaceTypeAliasRecord[]>()
  private readonly typeRegistry: TypeRegistry

  constructor(seed: Partial<WorkspaceIndexSnapshot>, typeSeed: Partial<TypeRegistrySnapshot>) {
    this.typeRegistry = createMemoryTypeRegistry(typeSeed)
    for (const file of seed.files ?? []) this.upsertFile(file)
    for (const component of seed.components ?? []) {
      appendByFile(this.components, component.filePath, component)
    }
    for (const ref of seed.refs ?? []) {
      appendByFile(this.refs, ref.fromFile, ref)
    }
    for (const location of seed.sourceLocations ?? []) {
      appendByFile(this.sourceLocations, location.filePath, location)
    }
    for (const diagnostic of seed.diagnostics ?? []) {
      appendByFile(this.diagnostics, diagnostic.filePath ?? '', diagnostic)
    }
    for (const alias of seed.typeAliases ?? []) {
      appendByFile(this.typeAliases, alias.sourceFile, alias)
    }
  }

  getFile(filePath: string): WorkspaceFileRecord | undefined {
    const file = this.files.get(filePath)
    return file ? { ...file } : undefined
  }

  listFiles(): WorkspaceFileRecord[] {
    return cloneRecords(this.files.values())
  }

  upsertFile(file: WorkspaceFileRecord): void {
    this.files.set(file.filePath, { ...file })
  }

  deleteFile(filePath: string): void {
    this.invalidateFiles([filePath])
  }

  detectChanges(files: readonly WorkspaceFileRecord[]): WorkspaceIndexDiff {
    const changed: WorkspaceFileRecord[] = []
    const unchanged: WorkspaceFileRecord[] = []
    const incoming = new Set<string>()

    for (const file of files) {
      incoming.add(file.filePath)
      const previous = this.files.get(file.filePath)
      if (previous && isSameFileRecord(previous, file)) {
        unchanged.push({ ...file })
      } else {
        changed.push({ ...file })
      }
    }

    const deleted = this.listFiles().filter(file => !incoming.has(file.filePath))
    return { changed, unchanged, deleted }
  }

  replaceFileIndex(filePath: string, data: WorkspaceFileIndexData): void {
    this.components.set(filePath, cloneRecords(data.components ?? []))
    this.refs.set(filePath, cloneRecords(data.refs ?? []))
    this.sourceLocations.set(filePath, cloneRecords(data.sourceLocations ?? []))
    this.diagnostics.set(filePath, cloneRecords(data.diagnostics ?? []))
    this.typeAliases.set(filePath, cloneRecords(data.typeAliases ?? []))
  }

  invalidateFiles(filePaths: readonly string[]): void {
    for (const filePath of filePaths) {
      this.files.delete(filePath)
      this.components.delete(filePath)
      this.refs.delete(filePath)
      this.sourceLocations.delete(filePath)
      this.diagnostics.delete(filePath)
      this.typeAliases.delete(filePath)
    }
    this.invalidateTypeFiles(filePaths)
  }

  listComponents(filter: WorkspaceComponentFilter = {}): WorkspaceComponentRecord[] {
    return flattenMap(this.components).filter(component =>
      matchesOptional(filter.filePath, component.filePath)
      && matchesOptional(filter.section, component.section)
      && matchesOptional(filter.name, component.name)
    )
  }

  listRefs(filter: WorkspaceRefFilter = {}): WorkspaceRefRecord[] {
    return flattenMap(this.refs).filter(ref =>
      matchesOptional(filter.fromFile, ref.fromFile)
      && matchesOptional(filter.toFile, ref.toFile)
    )
  }

  listSourceLocations(filePath?: string): WorkspaceSourceLocationRecord[] {
    const locations = filePath === undefined
      ? flattenMap(this.sourceLocations)
      : cloneRecords(this.sourceLocations.get(filePath) ?? [])
    return locations
  }

  listDiagnostics(filter: WorkspaceDiagnosticFilter = {}): WorkspaceDiagnosticRecord[] {
    return flattenMap(this.diagnostics).filter(diagnostic =>
      matchesOptional(filter.filePath, diagnostic.filePath)
      && matchesOptional(filter.producer, diagnostic.producer)
      && matchesOptional(filter.severity, diagnostic.severity)
    )
  }

  listTypeAliases(filter: WorkspaceTypeAliasFilter = {}): WorkspaceTypeAliasRecord[] {
    return flattenMap(this.typeAliases).filter(alias =>
      matchesOptional(filter.sourceFile, alias.sourceFile)
      && matchesOptional(filter.aliasName, alias.aliasName)
    )
  }

  replaceTypeFileIndex(filePath: string, data: WorkspaceTypeFileIndexData): void {
    this.typeRegistry.replaceTypeFileIndex(filePath, data)
  }

  invalidateTypeFiles(filePaths: readonly string[]): void {
    this.typeRegistry.invalidateTypeFiles(filePaths)
  }

  listTypeArtifacts(filter?: TypeArtifactFilter): TypeArtifactRecord[] {
    return this.typeRegistry.listTypeArtifacts(filter)
  }

  listTypeDeclarations(filter?: TypeDeclarationFilter): TypeDeclarationRecord[] {
    return this.typeRegistry.listTypeDeclarations(filter)
  }

  listTypeRelations(filter?: TypeRelationFilter): TypeRelationRecord[] {
    return this.typeRegistry.listTypeRelations(filter)
  }

  listTypeBoundaries(filter?: TypeBoundaryFilter): TypeBoundaryRecord[] {
    return this.typeRegistry.listTypeBoundaries(filter)
  }

  listTypeExposures(filter?: TypeExposureFilter): TypeExposureRecord[] {
    return this.typeRegistry.listTypeExposures(filter)
  }

  clearTypes(): void {
    this.typeRegistry.clearTypes()
  }

  snapshotTypes(): TypeRegistrySnapshot {
    return this.typeRegistry.snapshotTypes()
  }

  clear(): void {
    this.files.clear()
    this.components.clear()
    this.refs.clear()
    this.sourceLocations.clear()
    this.diagnostics.clear()
    this.typeAliases.clear()
    this.clearTypes()
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
}

function isSameFileRecord(previous: WorkspaceFileRecord, current: WorkspaceFileRecord): boolean {
  return previous.contentHash === current.contentHash
    && previous.size === current.size
    && previous.mtimeMs === current.mtimeMs
    && previous.parserVersion === current.parserVersion
    && (previous.realPath ?? previous.filePath) === (current.realPath ?? current.filePath)
}

function collectDependentSourceFilePaths(index: WorkspaceIndex, dirtyTargets: ReadonlySet<string>): string[] {
  const originalTargets = new Set(dirtyTargets)
  const visitedTargets = new Set(dirtyTargets)
  const queue = [...dirtyTargets]
  const dependents = new Set<string>()

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const target = queue[cursor]!
    for (const ref of index.listRefs({ toFile: target })) {
      const source = ref.fromFile
      if (!originalTargets.has(source)) dependents.add(source)
      if (!visitedTargets.has(source)) {
        visitedTargets.add(source)
        queue.push(source)
      }
    }
  }

  return sortedUnique(dependents)
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}

function matchesOptional<T>(expected: T | undefined, actual: T | undefined): boolean {
  return expected === undefined || expected === actual
}

function appendByFile<T extends object>(map: Map<string, T[]>, filePath: string, record: T): void {
  const records = map.get(filePath) ?? []
  records.push({ ...record })
  map.set(filePath, records)
}

function flattenMap<T extends object>(map: Map<string, T[]>): T[] {
  return [...map.values()].flatMap(records => cloneRecords(records))
}

function cloneRecords<T extends object>(records: Iterable<T>): T[] {
  return [...records].map(record => ({ ...record }))
}

function emptySnapshot(): WorkspaceIndexSnapshot {
  return {
    files: [],
    components: [],
    refs: [],
    sourceLocations: [],
    diagnostics: [],
    typeAliases: [],
  }
}
