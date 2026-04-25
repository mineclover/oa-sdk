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

// Wire type: API 응답용 (entries는 ?include=entries 시만 포함)
export type SpecSnapshot = {
  schemaVersion: 'spec-lens.snapshot.v1'
  revision: SpecRevision
  fragmentsDir: string
  targetPath: string
  targetConfigDigest: string
  spec: Record<string, unknown> | null
  provenance: BuildSpecProvenanceMap
  composition: BuildSpecCompositionReport
  diagnostics: SpecSnapshotDiagnostic[]
  builtAt: number
  entries?: SpecFileEntry[]
}

// Storage type: SQLite 저장용 (entries는 snapshot_entries 테이블로 분리)
export type SpecSnapshotStored = Omit<SpecSnapshot, 'entries'> & {
  entryRefs: Array<{ relativePath: string; contentHash: string }>
  targetConfigDigest: string  // buildTargetConfigDigest(targetConfig) — 캐시 키 격리
}

export type SpecTimelineDiff = {
  schemaVersion: 'spec-lens.diff.v1'
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
