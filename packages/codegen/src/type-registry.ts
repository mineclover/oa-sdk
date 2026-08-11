export type TypeRegistryRuntime = 'node' | 'browser' | 'bun' | 'neutral'

export type TypeArtifactOrigin = 'handwritten' | 'generated' | 'external'

export type TypeArtifactRole = 'authority' | 'observation' | 'derived'

export type TypeArtifactRecord = {
  artifactId: string
  filePath: string
  packageName?: string
  logicalModule?: string
  runtime: TypeRegistryRuntime
  origin: TypeArtifactOrigin
  role: TypeArtifactRole
  contentHash: string
  compilerVersion?: string
  tsconfigHash?: string
  generatorId?: string
  generatorVersion?: string
  generatorInputHash?: string
}

export type TypeDeclarationKind =
  | 'type-alias'
  | 'interface'
  | 'enum'
  | 'class'
  | 'function'
  | 'namespace'

export type TypeDeclarationRecord = {
  declarationId: string
  artifactId: string
  filePath: string
  symbolName: string
  qualifiedName: string
  kind: TypeDeclarationKind
  exported: boolean
  genericArity: number
  line: number
  column: number
  endLine: number
  endColumn: number
  syntaxHash: string
  shapeHash: string
  semanticHash: string
  canonicalIr: string
}

export type TypeRelationKind =
  | 'type-ref'
  | 'extends'
  | 'implements'
  | 'alias'
  | 'import'
  | 'reexport'
  | 'generates'
  | 'projects'
  | 'entrypoint-member'

export type TypeRelationRecord = {
  relationId: string
  filePath: string
  fromDeclarationId?: string
  kind: TypeRelationKind
  toDeclarationId?: string
  targetSpecifier?: string
  targetSymbol?: string
  typeOnly?: boolean
  resolved: boolean
  exportMapped?: boolean
}

export type TypeBoundaryKind =
  | 'any'
  | 'unknown'
  | 'assertion'
  | 'double-assertion'
  | 'non-null'
  | 'deserialize'

export type TypeBoundaryRecord = {
  boundaryId: string
  filePath: string
  line: number
  column: number
  kind: TypeBoundaryKind
  sourceType?: string
  targetType?: string
  validatorSymbol?: string
  suppression?: string
}

export type TypeExposureKind = 'type' | 'value' | 'mixed'

export type TypeExposureRecord = {
  exposureId: string
  declarationId?: string
  filePath: string
  packageName?: string
  exportKey: string
  exportName: string
  localName?: string
  targetSpecifier?: string
  runtime: TypeRegistryRuntime
  kind: TypeExposureKind
  reexport: boolean
}

export type WorkspaceTypeFileIndexData = {
  artifacts?: readonly TypeArtifactRecord[]
  declarations?: readonly TypeDeclarationRecord[]
  relations?: readonly TypeRelationRecord[]
  boundaries?: readonly TypeBoundaryRecord[]
  exposures?: readonly TypeExposureRecord[]
}

export type TypeRegistrySnapshot = {
  artifacts: TypeArtifactRecord[]
  declarations: TypeDeclarationRecord[]
  relations: TypeRelationRecord[]
  boundaries: TypeBoundaryRecord[]
  exposures: TypeExposureRecord[]
}

export type TypeArtifactFilter = {
  filePath?: string
  packageName?: string
  runtime?: TypeRegistryRuntime
  origin?: TypeArtifactOrigin
  role?: TypeArtifactRole
}

export type TypeDeclarationFilter = {
  artifactId?: string
  filePath?: string
  symbolName?: string
  kind?: TypeDeclarationKind
  exported?: boolean
  shapeHash?: string
  semanticHash?: string
}

export type TypeRelationFilter = {
  filePath?: string
  fromDeclarationId?: string
  kind?: TypeRelationKind
  toDeclarationId?: string
  targetSpecifier?: string
}

export type TypeBoundaryFilter = {
  filePath?: string
  kind?: TypeBoundaryKind
}

export type TypeExposureFilter = {
  filePath?: string
  packageName?: string
  exportKey?: string
  exportName?: string
  runtime?: TypeRegistryRuntime
  kind?: TypeExposureKind
}

export interface TypeRegistry {
  replaceTypeFileIndex(filePath: string, data: WorkspaceTypeFileIndexData): void
  invalidateTypeFiles(filePaths: readonly string[]): void

  listTypeArtifacts(filter?: TypeArtifactFilter): TypeArtifactRecord[]
  listTypeDeclarations(filter?: TypeDeclarationFilter): TypeDeclarationRecord[]
  listTypeRelations(filter?: TypeRelationFilter): TypeRelationRecord[]
  listTypeBoundaries(filter?: TypeBoundaryFilter): TypeBoundaryRecord[]
  listTypeExposures(filter?: TypeExposureFilter): TypeExposureRecord[]

  clearTypes(): void
  snapshotTypes(): TypeRegistrySnapshot
}

export function createNoopTypeRegistry(): TypeRegistry {
  return new NoopTypeRegistry()
}

export function createMemoryTypeRegistry(seed: Partial<TypeRegistrySnapshot> = {}): TypeRegistry {
  return new MemoryTypeRegistry(seed)
}

class NoopTypeRegistry implements TypeRegistry {
  replaceTypeFileIndex(): void {}

  invalidateTypeFiles(): void {}

  listTypeArtifacts(): TypeArtifactRecord[] {
    return []
  }

  listTypeDeclarations(): TypeDeclarationRecord[] {
    return []
  }

  listTypeRelations(): TypeRelationRecord[] {
    return []
  }

  listTypeBoundaries(): TypeBoundaryRecord[] {
    return []
  }

  listTypeExposures(): TypeExposureRecord[] {
    return []
  }

  clearTypes(): void {}

  snapshotTypes(): TypeRegistrySnapshot {
    return emptyTypeRegistrySnapshot()
  }
}

class MemoryTypeRegistry implements TypeRegistry {
  private readonly artifacts = new Map<string, TypeArtifactRecord[]>()
  private readonly declarations = new Map<string, TypeDeclarationRecord[]>()
  private readonly relations = new Map<string, TypeRelationRecord[]>()
  private readonly boundaries = new Map<string, TypeBoundaryRecord[]>()
  private readonly exposures = new Map<string, TypeExposureRecord[]>()

  constructor(seed: Partial<TypeRegistrySnapshot>) {
    for (const artifact of seed.artifacts ?? []) appendByFile(this.artifacts, artifact.filePath, artifact)
    for (const declaration of seed.declarations ?? []) appendByFile(this.declarations, declaration.filePath, declaration)
    for (const relation of seed.relations ?? []) appendByFile(this.relations, relation.filePath, relation)
    for (const boundary of seed.boundaries ?? []) appendByFile(this.boundaries, boundary.filePath, boundary)
    for (const exposure of seed.exposures ?? []) appendByFile(this.exposures, exposure.filePath, exposure)
  }

  replaceTypeFileIndex(filePath: string, data: WorkspaceTypeFileIndexData): void {
    this.artifacts.set(filePath, cloneRecords(data.artifacts ?? []))
    this.declarations.set(filePath, cloneRecords(data.declarations ?? []))
    this.relations.set(filePath, cloneRecords(data.relations ?? []))
    this.boundaries.set(filePath, cloneRecords(data.boundaries ?? []))
    this.exposures.set(filePath, cloneRecords(data.exposures ?? []))
  }

  invalidateTypeFiles(filePaths: readonly string[]): void {
    for (const filePath of filePaths) {
      this.artifacts.delete(filePath)
      this.declarations.delete(filePath)
      this.relations.delete(filePath)
      this.boundaries.delete(filePath)
      this.exposures.delete(filePath)
    }
  }

  listTypeArtifacts(filter: TypeArtifactFilter = {}): TypeArtifactRecord[] {
    return sortedRecords(flattenMap(this.artifacts).filter(artifact =>
      matchesOptional(filter.filePath, artifact.filePath)
      && matchesOptional(filter.packageName, artifact.packageName)
      && matchesOptional(filter.runtime, artifact.runtime)
      && matchesOptional(filter.origin, artifact.origin)
      && matchesOptional(filter.role, artifact.role)
    ), artifact => artifact.artifactId)
  }

  listTypeDeclarations(filter: TypeDeclarationFilter = {}): TypeDeclarationRecord[] {
    return sortedRecords(flattenMap(this.declarations).filter(declaration =>
      matchesOptional(filter.artifactId, declaration.artifactId)
      && matchesOptional(filter.filePath, declaration.filePath)
      && matchesOptional(filter.symbolName, declaration.symbolName)
      && matchesOptional(filter.kind, declaration.kind)
      && matchesOptional(filter.exported, declaration.exported)
      && matchesOptional(filter.shapeHash, declaration.shapeHash)
      && matchesOptional(filter.semanticHash, declaration.semanticHash)
    ), declaration => declaration.declarationId)
  }

  listTypeRelations(filter: TypeRelationFilter = {}): TypeRelationRecord[] {
    return sortedRecords(flattenMap(this.relations).filter(relation =>
      matchesOptional(filter.filePath, relation.filePath)
      && matchesOptional(filter.fromDeclarationId, relation.fromDeclarationId)
      && matchesOptional(filter.kind, relation.kind)
      && matchesOptional(filter.toDeclarationId, relation.toDeclarationId)
      && matchesOptional(filter.targetSpecifier, relation.targetSpecifier)
    ), relation => relation.relationId)
  }

  listTypeBoundaries(filter: TypeBoundaryFilter = {}): TypeBoundaryRecord[] {
    return sortedRecords(flattenMap(this.boundaries).filter(boundary =>
      matchesOptional(filter.filePath, boundary.filePath)
      && matchesOptional(filter.kind, boundary.kind)
    ), boundary => boundary.boundaryId)
  }

  listTypeExposures(filter: TypeExposureFilter = {}): TypeExposureRecord[] {
    return sortedRecords(flattenMap(this.exposures).filter(exposure =>
      matchesOptional(filter.filePath, exposure.filePath)
      && matchesOptional(filter.packageName, exposure.packageName)
      && matchesOptional(filter.exportKey, exposure.exportKey)
      && matchesOptional(filter.exportName, exposure.exportName)
      && matchesOptional(filter.runtime, exposure.runtime)
      && matchesOptional(filter.kind, exposure.kind)
    ), exposure => exposure.exposureId)
  }

  clearTypes(): void {
    this.artifacts.clear()
    this.declarations.clear()
    this.relations.clear()
    this.boundaries.clear()
    this.exposures.clear()
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
}

export function emptyTypeRegistrySnapshot(): TypeRegistrySnapshot {
  return {
    artifacts: [],
    declarations: [],
    relations: [],
    boundaries: [],
    exposures: [],
  }
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

function sortedRecords<T extends object>(records: T[], key: (record: T) => string): T[] {
  return records.sort((left, right) => key(left).localeCompare(key(right)))
}

function matchesOptional<T>(expected: T | undefined, actual: T | undefined): boolean {
  return expected === undefined || expected === actual
}
