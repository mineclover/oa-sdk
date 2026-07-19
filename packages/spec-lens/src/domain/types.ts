import type {
  DefinitionBuilderSpecSnapshot as WireDefinitionBuilderSpecSnapshot,
  DefinitionBuilderSpecTimelineDiff as WireDefinitionBuilderSpecTimelineDiff,
  SpecFileEntry,
  SpecGraph,
  SpecGraphEdge,
  SpecGraphNode,
  SpecLensTypeSpecCompileEvidence,
  SpecPathEntry,
  SpecPathsResult,
  SpecProvenanceDiffEntry,
  SpecProvenanceEntry,
  SpecProvenanceMap,
  SpecRevision,
  SpecSnapshot,
  SpecSnapshotDiagnostic,
  SpecSourceKind,
  SpecTimelineDiff,
  SpecTimelineEntry,
  TypeSpecBundleSpecSnapshot as WireTypeSpecBundleSpecSnapshot,
  TypeSpecBundleSpecTimelineDiff as WireTypeSpecBundleSpecTimelineDiff,
} from '@oa-sdk/spec-lens-contract'

// HTTP wire types are owned by @oa-sdk/spec-lens-contract. Domain code imports
// and re-exports them so storage and application ports cannot silently drift
// from the browser/API boundary.
export type {
  SpecFileEntry,
  SpecGraph,
  SpecGraphEdge,
  SpecGraphNode,
  SpecPathEntry,
  SpecPathsResult,
  SpecProvenanceDiffEntry,
  SpecProvenanceEntry,
  SpecProvenanceMap,
  SpecRevision,
  SpecSnapshot,
  SpecSnapshotDiagnostic,
  SpecSourceKind,
  SpecTimelineDiff,
  SpecTimelineEntry,
}

export type DefinitionBuilderProvenance = WireDefinitionBuilderSpecSnapshot['provenance']
export type TypeSpecBundleProvenance = WireTypeSpecBundleSpecSnapshot['provenance']
export type SpecProvenance = DefinitionBuilderProvenance | TypeSpecBundleProvenance

export type DefinitionBuilderSpecSnapshot = WireDefinitionBuilderSpecSnapshot
export type TypeSpecBundleSpecSnapshot = WireTypeSpecBundleSpecSnapshot
export type DefinitionBuilderSpecTimelineDiff = WireDefinitionBuilderSpecTimelineDiff
export type TypeSpecBundleSpecTimelineDiff = WireTypeSpecBundleSpecTimelineDiff

export type SpecSnapshotStored =
  | StoredSnapshot<DefinitionBuilderSpecSnapshot>
  | StoredSnapshot<TypeSpecBundleSpecSnapshot>

// Storage type: SQLite stores entries in snapshot_entries.
type StoredSnapshot<T extends SpecSnapshot> = Omit<T, 'entries'> & {
  entryRefs: Array<{ relativePath: string; contentHash: string }>
}

// Kept as a named domain alias for callers that need the compiler evidence
// shape without importing codegen's CLI-oriented package.
export type { SpecLensTypeSpecCompileEvidence }
