import type {
  BuildSpecCompositionReport,
  BuildSpecProvenanceDiffEntry,
  BuildSpecProvenanceMap,
  ContractDiffChange,
  OpenApiNormalizedDiffEntry,
} from '@oa-sdk/codegen/spec-lens'

export type SpecSourceKind = 'github' | 'gitlab' | 'local-git' | 'file'

export type SpecRevision = {
  id: string
  shortId: string
  timestamp: number
  message: string
  author?: string
  source: SpecSourceKind
  sourceRef?: string
  metadata?: Record<string, unknown>
}

export type SpecFileEntry = {
  relativePath: string
  content: string
  contentHash: string
}

export type SpecSnapshotDiagnostic = {
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
  pointer?: string
  sourcePath?: string
}

type SpecSnapshotBase = {
  schemaVersion: 'spec-lens.snapshot.v2'
  projectKey: string
  projectKind: 'definition-builder' | 'typespec-bundle'
  sourceRoot: string
  revision: SpecRevision
  spec: Record<string, unknown> | null
  provenance: BuildSpecProvenanceMap
  diagnostics: SpecSnapshotDiagnostic[]
  builtAt: number
  entries?: SpecFileEntry[]
}

export type DefinitionBuilderSpecSnapshot = SpecSnapshotBase & {
  projectKind: 'definition-builder'
  fragmentsDir: string
  targetPath: string
  targetConfigDigest: string
  composition: BuildSpecCompositionReport
}

export type TypeSpecBundleSpecSnapshot = SpecSnapshotBase & {
  projectKind: 'typespec-bundle'
  manifestPath: string
}

// Wire type: API response (entries appears only with ?include=entries).
export type SpecSnapshot = DefinitionBuilderSpecSnapshot | TypeSpecBundleSpecSnapshot

type StoredSnapshot<T extends SpecSnapshot> = Omit<T, 'entries'> & {
  entryRefs: Array<{ relativePath: string; contentHash: string }>
}

// Storage type: SQLite stores entries in snapshot_entries.
export type SpecSnapshotStored =
  | StoredSnapshot<DefinitionBuilderSpecSnapshot>
  | StoredSnapshot<TypeSpecBundleSpecSnapshot>

export type SpecTimelineDiff = {
  schemaVersion: 'spec-lens.diff.v2'
  projectKey: string
  baseRevision: SpecRevision
  headRevision: SpecRevision
  normalizedDiff: OpenApiNormalizedDiffEntry[]
  breakingDiff: ContractDiffChange[]
  provenanceDiff: BuildSpecProvenanceDiffEntry[]
  affectedFragments: string[]
  stats: {
    pathsAdded: number
    pathsRemoved: number
    pathsChanged: number
    schemasAdded: number
    schemasRemoved: number
    schemasChanged: number
    breakingChanges: number
  }
}

// Read Model: 타임라인 목록 화면용 (비정규화)
export type SpecTimelineEntry = {
  revision: SpecRevision
  affectedFiles: string[]
  snapshotCached: boolean
  diffStats: {
    pathsAdded: number
    pathsRemoved: number
    pathsChanged: number
    breakingChanges: number
  }
}

// Read Model: path provenance 화면용 (비정규화)
export type SpecPathEntry = {
  path: string
  methods: string[]
  canonicalId: string
  scope: string
  domain: string
  sourceFile: string
  contentHash: string
  lastChangedRevisionId: string
  lastChangedTimestamp: number
}

export type SpecGraphNode = {
  id: string
  kind: string
  scope: string
  domain: string
  localName: string
  sourcePath: string
  contentHash: string
}

export type SpecGraphEdge = {
  source: string
  target: string
  refPointer: string
}

export type SpecGraph = {
  nodes: SpecGraphNode[]
  edges: SpecGraphEdge[]
}
