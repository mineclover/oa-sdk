export const SPEC_LENS_SNAPSHOT_SCHEMA_VERSION = 'spec-lens.snapshot.v2' as const
export const SPEC_LENS_DIFF_SCHEMA_VERSION = 'spec-lens.diff.v2' as const
export const SPEC_LENS_COMPOSITION_REPORT_SCHEMA_VERSION = 'oa-gen.composition-report.v1' as const
export const SPEC_LENS_TYPESPEC_COMPILE_EVIDENCE_SCHEMA_VERSION =
  'oa-sdk.spec-lens.typespec-compile.v1' as const
export const SPEC_LENS_TYPESPEC_TOOLCHAIN_EVIDENCE_SCHEMA_VERSION =
  'oa-sdk.spec-lens.typespec-toolchain.v1' as const
export const SPEC_LENS_TYPESPEC_SOURCE_READ_BUDGET_SCHEMA_VERSION =
  'oa-sdk.spec-lens.source-read-budget.v1' as const
export const SPEC_LENS_TYPESPEC_MANIFEST_SCHEMA_VERSION = 'oa-sdk.typespec-bundle.v1' as const
export const SPEC_LENS_TYPESPEC_RESTORE_CONTRACT_VERSION =
  'oa-sdk.codegen.typespec-restore.v1' as const
export const SPEC_LENS_TYPESPEC_ISOLATION_POLICY_VERSION =
  'oa-sdk.spec-lens.typespec-isolation.v2' as const

export const SPEC_LENS_PROJECT_KINDS = ['definition-builder', 'typespec-bundle'] as const
export const SPEC_LENS_SOURCE_KINDS = ['github', 'gitlab', 'local-git', 'file'] as const

export type SpecLensProjectKind = typeof SPEC_LENS_PROJECT_KINDS[number]
export type SpecSourceKind = typeof SPEC_LENS_SOURCE_KINDS[number]
export type SpecDefinitionKind =
  | 'schema'
  | 'response'
  | 'parameter'
  | 'requestBody'
  | 'header'
  | 'link'
  | 'callback'
  | 'path'
  | 'operation'
  | 'server'
  | 'tag'
  | 'securityScheme'
export type SpecCanonicalDefinitionId = `${SpecDefinitionKind}:${string}/${string}/${string}`

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

export type SpecCompositionOutputPath = {
  canonicalId: SpecCanonicalDefinitionId
  openApiPath?: string
  direct: boolean
  sourcePath: string
  sourcePointer: string
}

export type SpecCompositionOutputComponent = {
  canonicalId: SpecCanonicalDefinitionId
  kind: string
  section: string
  outputName: string
  outputPointer: string
  direct: boolean
  sourcePath: string
  sourcePointer: string
}

export type SpecCompositionAlias = {
  id: SpecCanonicalDefinitionId
  kind: string
  scope: string
  domain: string
  localName: string
  outputName: string
  reason: 'preserve-if-unique' | 'domain-prefix' | 'explicit-alias'
}

export type SpecCompositionCollision = {
  canonicalId: SpecCanonicalDefinitionId
  targetName: string
  kind: string
  scope: string
  domain: string
  localName: string
  outputName: string
  reason: SpecCompositionAlias['reason'] | 'output-name-collision'
  severity: 'info' | 'warning' | 'error'
}

export type SpecCompositionSourceRef = {
  sourceId: SpecCanonicalDefinitionId
  ref: string
  sourcePath: string
  sourcePointer: string
  targetId?: SpecCanonicalDefinitionId
}

export type SpecCompositionReport = {
  schemaVersion: typeof SPEC_LENS_COMPOSITION_REPORT_SCHEMA_VERSION
  target: {
    name: string
    targetPath: string
    fragmentsDir: string
    scopes: string[]
    domains: string[]
    includePaths: string[]
    includeDefinitions: string[]
  }
  summary: {
    registryNodeCount: number
    selectedNodeCount: number
    directPathCount: number
    directDefinitionCount: number
    transitiveComponentCount: number
    omittedNodeCount: number
    sourceRefCount: number
    outputAliasCount: number
    renamedOutputAliasCount: number
    collisionReportCount: number
  }
  selected: {
    directPathIds: string[]
    directDefinitionIds: string[]
    transitiveComponentIds: string[]
    selectedNodeIds: string[]
  }
  output: {
    paths: SpecCompositionOutputPath[]
    components: SpecCompositionOutputComponent[]
    aliases: SpecCompositionAlias[]
    renamedAliases: SpecCompositionAlias[]
    collisionReport: SpecCompositionCollision[]
  }
  omitted: {
    total: number
    byScope: Record<string, number>
    byDomain: Record<string, number>
    byKind: Record<string, number>
  }
  sourceRefs: SpecCompositionSourceRef[]
}

export type SpecProvenanceEntry = {
  canonicalId: SpecCanonicalDefinitionId
  kind: string
  sourcePath: string
  sourcePointer: string
  contentHash: string
}

export type SpecProvenanceMap = Record<string, SpecProvenanceEntry>

export type SpecProvenanceDiffEntry = {
  kind: 'added' | 'removed' | 'changed'
  pointer: string
  message: string
  base?: SpecProvenanceEntry
  head?: SpecProvenanceEntry
}

export type SpecLensTypeSpecSourceReadBudget = {
  schemaVersion: typeof SPEC_LENS_TYPESPEC_SOURCE_READ_BUDGET_SCHEMA_VERSION
  maxFiles: number
  maxFileBytes: number
  maxTotalBytes: number
  maxConcurrency: number
}

export type SpecLensTypeSpecToolchainEvidence = {
  schemaVersion: typeof SPEC_LENS_TYPESPEC_TOOLCHAIN_EVIDENCE_SCHEMA_VERSION
  fingerprint: string
  packages: {
    '@oa-sdk/typespec-decorators': string
    '@typespec/compiler': string
    '@typespec/http': string
    '@typespec/openapi': string
    '@typespec/openapi3': string
  }
  trustedLibraryDigests: {
    '@oa-sdk/typespec-decorators': string
  }
  restoreContract: typeof SPEC_LENS_TYPESPEC_RESTORE_CONTRACT_VERSION
  isolationPolicy: typeof SPEC_LENS_TYPESPEC_ISOLATION_POLICY_VERSION
  resourcePolicy: {
    compileTimeoutMs: number
    compileMaxOutputBytes: number
    compileMaxOldSpaceSizeMb: number
    sourceReadBudget: SpecLensTypeSpecSourceReadBudget
    maxArtifactBytes: number
  }
}

export type SpecLensTypeSpecCompileEvidence = {
  schemaVersion: typeof SPEC_LENS_TYPESPEC_COMPILE_EVIDENCE_SCHEMA_VERSION
  manifestSchemaVersion: typeof SPEC_LENS_TYPESPEC_MANIFEST_SCHEMA_VERSION
  entrypoint: string
  sourceFiles: string[]
  compatibilitySource: 'sidecar' | 'typespec-extensions'
  toolchain: SpecLensTypeSpecToolchainEvidence
  compiler: {
    configSource: 'generated-allowlist'
    emitter: '@typespec/openapi3'
    openapiVersion: '3.2.0'
    packageImports: string[]
    resources: {
      timeoutMs: number
      maxOutputBytes: number
      maxOldSpaceSizeMb: number
      sourceReadBudget: SpecLensTypeSpecSourceReadBudget
      maxArtifactBytes: number
      isolationPolicy: typeof SPEC_LENS_TYPESPEC_ISOLATION_POLICY_VERSION
    }
  }
  validation: {
    emitted: { valid: boolean; summary: string }
    restored: { valid: boolean; summary: string }
    expected?: { valid: boolean; summary: string }
  }
  gates: {
    compatibilitySidecar: 'pass' | 'fail'
    restoredValidation: 'pass' | 'fail'
    expectedDiff?: 'pass' | 'fail'
  }
}

/** A non-source repository input observed while rebuilding a TypeSpec revision. */
export type SpecLensObservedInputEvidence = {
  path: string
  class: 'evidence-only'
  availability: 'available' | 'missing' | 'unreadable'
  contentHash?: string
  reason?: string
}

export type SpecSnapshotBase = {
  schemaVersion: typeof SPEC_LENS_SNAPSHOT_SCHEMA_VERSION
  projectKey: string
  projectKind: SpecLensProjectKind
  sourceRoot: string
  revision: SpecRevision
  spec: Record<string, unknown> | null
  diagnostics: SpecSnapshotDiagnostic[]
  builtAt: number
  entries?: SpecFileEntry[]
}

export type DefinitionBuilderSpecSnapshot = SpecSnapshotBase & {
  projectKind: 'definition-builder'
  fragmentsDir: string
  targetPath: string
  targetConfigDigest: string
  provenance: {
    status: 'available'
    kind: 'definition-builder'
    entries: SpecProvenanceMap
  }
  composition: SpecCompositionReport
}

export type TypeSpecBundleSpecSnapshot = SpecSnapshotBase & {
  projectKind: 'typespec-bundle'
  manifestPath: string
  provenance: {
    status: 'unavailable'
    kind: 'typespec-source-files'
    reason: 'output-pointer-mapping-unavailable'
    sourceFiles: Array<{ relativePath: string; contentHash: string }>
    observedInputs: SpecLensObservedInputEvidence[]
    compile: SpecLensTypeSpecCompileEvidence
  }
}

export type SpecSnapshot = DefinitionBuilderSpecSnapshot | TypeSpecBundleSpecSnapshot

export type SpecDiffEntry = {
  category: string
  kind: 'added' | 'removed' | 'changed'
  pointer: string
  message: string
}

export type SpecBreakingChange = {
  code: string
  endpoint: string
  detail: string
  severity: 'breaking' | 'non-breaking'
}

export type DiffEntry = SpecDiffEntry
export type BreakingChange = SpecBreakingChange
export type ProvenanceEntry = SpecProvenanceEntry
export type ProvenanceDiffEntry = SpecProvenanceDiffEntry

export type SpecTimelineDiffBase = {
  schemaVersion: typeof SPEC_LENS_DIFF_SCHEMA_VERSION
  projectKey: string
  baseRevision: SpecRevision
  headRevision: SpecRevision
  normalizedDiff: SpecDiffEntry[]
  breakingDiff: SpecBreakingChange[]
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

export type DefinitionBuilderSpecTimelineDiff = SpecTimelineDiffBase & {
  projectKind: 'definition-builder'
  provenanceDiff: {
    status: 'available'
    kind: 'definition-builder'
    entries: SpecProvenanceDiffEntry[]
  }
}

export type TypeSpecBundleSpecTimelineDiff = SpecTimelineDiffBase & {
  projectKind: 'typespec-bundle'
  provenanceDiff: {
    status: 'unavailable'
    kind: 'typespec-source-files'
    reason: 'output-pointer-mapping-unavailable'
    affectedSourceFiles: string[]
  }
}

export type SpecTimelineDiff = DefinitionBuilderSpecTimelineDiff | TypeSpecBundleSpecTimelineDiff

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

export type SpecPathsResult =
  | { status: 'available'; projectKind: 'definition-builder'; entries: SpecPathEntry[] }
  | { status: 'unavailable'; projectKind: 'typespec-bundle'; reason: 'output-pointer-mapping-unavailable' }

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

export type RefreshResult = {
  newRevisions: number
  builtSnapshots: number
  errors: Array<{ revisionId: string; message: string }>
}

export type ClearCacheResult = {
  deletedSnapshots: number
  deletedDiffs: number
  deletedTimeline: number
  deletedPaths: number
  deletedEntries: number
  deletedBlobs: number
}

type SpecServerConfigBase = {
  projectKey: string
  toolchainFingerprint: string
  projectKind: SpecLensProjectKind
  projectSourceRoot: string
  observation: {
    adapterKind: SpecSourceKind
    repository: string
    ref: string
  }
  sourceKind: SpecSourceKind
  branch?: string
}

export type DefinitionBuilderServerConfig = SpecServerConfigBase & {
  projectKind: 'definition-builder'
  targetName: string
  targetPath: string
  fragmentsDir: string
}

export type TypeSpecBundleServerConfig = SpecServerConfigBase & {
  projectKind: 'typespec-bundle'
  manifestPath: string
}

export type SpecServerConfig = DefinitionBuilderServerConfig | TypeSpecBundleServerConfig

export type SpecLensApiResponseMap = {
  config: SpecServerConfig
  timeline: SpecTimelineEntry[]
  snapshot: SpecSnapshot
  diff: SpecTimelineDiff
  paths: SpecPathsResult
  graph: SpecGraph
  refresh: RefreshResult
  clearCache: ClearCacheResult
}

export type SpecLensApiError = {
  error: string
}

export function isSpecLensProjectKind(value: unknown): value is SpecLensProjectKind {
  return typeof value === 'string' && (SPEC_LENS_PROJECT_KINDS as readonly string[]).includes(value)
}

export function isSpecSourceKind(value: unknown): value is SpecSourceKind {
  return typeof value === 'string' && (SPEC_LENS_SOURCE_KINDS as readonly string[]).includes(value)
}

export function isSpecLensResponse<K extends keyof SpecLensApiResponseMap>(
  kind: K,
  value: unknown,
): value is SpecLensApiResponseMap[K] {
  if (kind === 'timeline') return Array.isArray(value) && value.every(isTimelineEntry)
  if (!isRecord(value)) return false
  switch (kind) {
    case 'config':
      return isServerConfig(value)
    case 'snapshot':
      return isSnapshot(value)
    case 'diff':
      return isTimelineDiff(value)
    case 'paths':
      return isPathsResult(value)
    case 'graph':
      return isGraph(value)
    case 'refresh':
      return isRefreshResult(value)
    case 'clearCache':
      return isClearCacheResult(value)
  }
  return false
}

function isTimelineEntry(value: unknown): value is SpecTimelineEntry {
  if (!isRecord(value) || !isRecord(value.revision) || !isRecord(value.diffStats)) return false
  const diffStats = value.diffStats
  return isSpecRevision(value.revision)
    && isStringArray(value.affectedFiles)
    && typeof value.snapshotCached === 'boolean'
    && ['pathsAdded', 'pathsRemoved', 'pathsChanged', 'breakingChanges']
      .every(key => isFiniteNumber(diffStats[key]))
}

function isServerConfig(value: Record<string, unknown>): value is SpecServerConfig {
  if (!isString(value.projectKey)
    || !isString(value.toolchainFingerprint)
    || !isString(value.projectSourceRoot)
    || !isSpecSourceKind(value.sourceKind)
    || !isObservation(value.observation)
    || (value.branch !== undefined && !isString(value.branch))) {
    return false
  }

  if (value.projectKind === 'definition-builder') {
    return isString(value.targetName) && isString(value.targetPath) && isString(value.fragmentsDir)
  }
  if (value.projectKind === 'typespec-bundle') return isString(value.manifestPath)
  return false
}

function isObservation(value: unknown): boolean {
  if (!isRecord(value)) return false
  return isSpecSourceKind(value.adapterKind)
    && isString(value.repository)
    && isString(value.ref)
}

function isSnapshot(value: Record<string, unknown>): value is SpecSnapshot {
  if (value.schemaVersion !== SPEC_LENS_SNAPSHOT_SCHEMA_VERSION
    || !isString(value.projectKey)
    || !isSpecLensProjectKind(value.projectKind)
    || !isString(value.sourceRoot)
    || !isSpecRevision(value.revision)
    || !(value.spec === null || isRecord(value.spec))
    || !isSnapshotDiagnosticArray(value.diagnostics)
    || !isFiniteNumber(value.builtAt)
    || (value.entries !== undefined && !isFileEntryArray(value.entries))) {
    return false
  }

  if (value.projectKind === 'definition-builder') {
    return isString(value.fragmentsDir)
      && isString(value.targetPath)
      && isString(value.targetConfigDigest)
      && isDefinitionBuilderProvenance(value.provenance)
      && isCompositionReport(value.composition)
  }

  return isString(value.manifestPath) && isTypeSpecBundleProvenance(value.provenance)
}

function isDefinitionBuilderProvenance(value: unknown): boolean {
  if (!isRecord(value)) return false
  return value.status === 'available'
    && value.kind === 'definition-builder'
    && isProvenanceMap(value.entries)
}

function isTypeSpecBundleProvenance(value: unknown): boolean {
  if (!isRecord(value)) return false
  return value.status === 'unavailable'
    && value.kind === 'typespec-source-files'
    && value.reason === 'output-pointer-mapping-unavailable'
    && isSourceFileReferenceArray(value.sourceFiles)
    && isObservedInputEvidenceArray(value.observedInputs)
    && isCompileEvidence(value.compile)
}

function isObservedInputEvidenceArray(value: unknown): value is SpecLensObservedInputEvidence[] {
  if (!Array.isArray(value)) return false
  let previousPath = ''
  for (const entry of value) {
    if (!isRecord(entry)
      || !isString(entry.path)
      || entry.class !== 'evidence-only'
      || (entry.availability !== 'available' && entry.availability !== 'missing' && entry.availability !== 'unreadable')
      || (entry.contentHash !== undefined && !isString(entry.contentHash))
      || (entry.reason !== undefined && !isString(entry.reason))
      || entry.path <= previousPath
      || (entry.availability === 'available' && entry.contentHash === undefined)
      || (entry.availability !== 'available' && entry.contentHash !== undefined)) {
      return false
    }
    previousPath = entry.path
  }
  return true
}

function isTimelineDiff(value: Record<string, unknown>): value is SpecTimelineDiff {
  if (value.schemaVersion !== SPEC_LENS_DIFF_SCHEMA_VERSION
    || !isString(value.projectKey)
    || !isSpecLensProjectKind(value.projectKind)
    || !isSpecRevision(value.baseRevision)
    || !isSpecRevision(value.headRevision)
    || !isDiffEntryArray(value.normalizedDiff)
    || !isBreakingChangeArray(value.breakingDiff)
    || !isStringArray(value.affectedFragments)
    || !isDiffStats(value.stats)) {
    return false
  }

  if (value.projectKind === 'definition-builder') {
    return isRecord(value.provenanceDiff)
      && value.provenanceDiff.status === 'available'
      && value.provenanceDiff.kind === 'definition-builder'
      && isProvenanceDiffEntryArray(value.provenanceDiff.entries)
  }

  return isRecord(value.provenanceDiff)
    && value.provenanceDiff.status === 'unavailable'
    && value.provenanceDiff.kind === 'typespec-source-files'
    && value.provenanceDiff.reason === 'output-pointer-mapping-unavailable'
    && isStringArray(value.provenanceDiff.affectedSourceFiles)
}

function isPathsResult(value: Record<string, unknown>): value is SpecPathsResult {
  if (value.status === 'available') {
    return value.projectKind === 'definition-builder'
      && isPathEntryArray(value.entries)
  }
  return value.status === 'unavailable'
    && value.projectKind === 'typespec-bundle'
    && value.reason === 'output-pointer-mapping-unavailable'
}

function isGraph(value: Record<string, unknown>): value is SpecGraph {
  return Array.isArray(value.nodes)
    && value.nodes.every(isGraphNode)
    && Array.isArray(value.edges)
    && value.edges.every(isGraphEdge)
}

function isGraphNode(value: unknown): boolean {
  if (!isRecord(value)) return false
  return isString(value.id)
    && isString(value.kind)
    && isString(value.scope)
    && isString(value.domain)
    && isString(value.localName)
    && isString(value.sourcePath)
    && isString(value.contentHash)
}

function isGraphEdge(value: unknown): boolean {
  if (!isRecord(value)) return false
  return isString(value.source) && isString(value.target) && isString(value.refPointer)
}

function isRefreshResult(value: Record<string, unknown>): value is RefreshResult {
  return isFiniteNumber(value.newRevisions)
    && isFiniteNumber(value.builtSnapshots)
    && Array.isArray(value.errors)
    && value.errors.every(error => isRecord(error)
      && isString(error.revisionId)
      && isString(error.message))
}

function isClearCacheResult(value: Record<string, unknown>): value is ClearCacheResult {
  return [
    'deletedSnapshots',
    'deletedDiffs',
    'deletedTimeline',
    'deletedPaths',
    'deletedEntries',
    'deletedBlobs',
  ].every(key => isFiniteNumber(value[key]))
}

function isSpecRevision(value: unknown): value is SpecRevision {
  if (!isRecord(value)) return false
  return isString(value.id)
    && isString(value.shortId)
    && isFiniteNumber(value.timestamp)
    && isString(value.message)
    && isSpecSourceKind(value.source)
    && (value.author === undefined || isString(value.author))
    && (value.sourceRef === undefined || isString(value.sourceRef))
    && (value.metadata === undefined || isRecord(value.metadata))
}

function isSnapshotDiagnosticArray(value: unknown): value is SpecSnapshotDiagnostic[] {
  return Array.isArray(value) && value.every(item => {
    if (!isRecord(item)) return false
    return isString(item.code)
      && (item.severity === 'error' || item.severity === 'warning' || item.severity === 'info')
      && isString(item.message)
      && (item.pointer === undefined || isString(item.pointer))
      && (item.sourcePath === undefined || isString(item.sourcePath))
  })
}

function isFileEntryArray(value: unknown): value is SpecFileEntry[] {
  return Array.isArray(value) && value.every(item => isRecord(item)
    && isString(item.relativePath)
    && isString(item.content)
    && isString(item.contentHash))
}

function isSourceFileReferenceArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(item => isRecord(item)
    && isString(item.relativePath)
    && isString(item.contentHash))
}

function isProvenanceMap(value: unknown): value is SpecProvenanceMap {
  return isRecord(value) && Object.values(value).every(isProvenanceEntry)
}

function isProvenanceEntry(value: unknown): value is SpecProvenanceEntry {
  return isRecord(value)
    && isCanonicalDefinitionId(value.canonicalId)
    && isString(value.kind)
    && isString(value.sourcePath)
    && isString(value.sourcePointer)
    && isString(value.contentHash)
}

function isProvenanceDiffEntryArray(value: unknown): value is SpecProvenanceDiffEntry[] {
  return Array.isArray(value) && value.every(item => {
    if (!isRecord(item)) return false
    return (item.kind === 'added' || item.kind === 'removed' || item.kind === 'changed')
      && isString(item.pointer)
      && isString(item.message)
      && (item.base === undefined || isProvenanceEntry(item.base))
      && (item.head === undefined || isProvenanceEntry(item.head))
  })
}

function isDiffEntryArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(item => isRecord(item)
    && isString(item.category)
    && (item.kind === 'added' || item.kind === 'removed' || item.kind === 'changed')
    && isString(item.pointer)
    && isString(item.message))
}

function isBreakingChangeArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(item => isRecord(item)
    && isString(item.code)
    && isString(item.endpoint)
    && isString(item.detail)
    && (item.severity === 'breaking' || item.severity === 'non-breaking'))
}

function isDiffStats(value: unknown): boolean {
  if (!isRecord(value)) return false
  return [
    'pathsAdded',
    'pathsRemoved',
    'pathsChanged',
    'schemasAdded',
    'schemasRemoved',
    'schemasChanged',
    'breakingChanges',
  ].every(key => isFiniteNumber(value[key]))
}

function isPathEntryArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(item => isRecord(item)
    && isString(item.path)
    && isStringArray(item.methods)
    && isString(item.canonicalId)
    && isString(item.scope)
    && isString(item.domain)
    && isString(item.sourceFile)
    && isString(item.contentHash)
    && isString(item.lastChangedRevisionId)
    && isFiniteNumber(item.lastChangedTimestamp))
}

function isCompositionReport(value: unknown): value is SpecCompositionReport {
  if (!isRecord(value)
    || value.schemaVersion !== SPEC_LENS_COMPOSITION_REPORT_SCHEMA_VERSION
    || !isRecord(value.target)
    || !isRecord(value.summary)
    || !isRecord(value.selected)
    || !isRecord(value.output)
    || !isRecord(value.omitted)) {
    return false
  }

  const target = value.target
  const summary = value.summary
  const selected = value.selected
  const output = value.output
  const omitted = value.omitted
  return isString(target.name)
    && isString(target.targetPath)
    && isString(target.fragmentsDir)
    && isStringArray(target.scopes)
    && isStringArray(target.domains)
    && isStringArray(target.includePaths)
    && isStringArray(target.includeDefinitions)
    && [
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
    ].every(key => isFiniteNumber(summary[key]))
    && isStringArray(selected.directPathIds)
    && isStringArray(selected.directDefinitionIds)
    && isStringArray(selected.transitiveComponentIds)
    && isStringArray(selected.selectedNodeIds)
    && Array.isArray(output.paths)
    && output.paths.every(isCompositionOutputPath)
    && Array.isArray(output.components)
    && output.components.every(isCompositionOutputComponent)
    && Array.isArray(output.aliases)
    && output.aliases.every(isCompositionAlias)
    && Array.isArray(output.renamedAliases)
    && output.renamedAliases.every(isCompositionAlias)
    && Array.isArray(output.collisionReport)
    && output.collisionReport.every(isCompositionCollision)
    && isFiniteNumber(omitted.total)
    && isNumberRecord(omitted.byScope)
    && isNumberRecord(omitted.byDomain)
    && isNumberRecord(omitted.byKind)
    && Array.isArray(value.sourceRefs)
    && value.sourceRefs.every(isCompositionSourceRef)
}

function isCompositionOutputPath(value: unknown): boolean {
  return isRecord(value)
    && isCanonicalDefinitionId(value.canonicalId)
    && (value.openApiPath === undefined || isString(value.openApiPath))
    && typeof value.direct === 'boolean'
    && isString(value.sourcePath)
    && isString(value.sourcePointer)
}

function isCompositionOutputComponent(value: unknown): boolean {
  return isRecord(value)
    && isCanonicalDefinitionId(value.canonicalId)
    && isString(value.kind)
    && isString(value.section)
    && isString(value.outputName)
    && isString(value.outputPointer)
    && typeof value.direct === 'boolean'
    && isString(value.sourcePath)
    && isString(value.sourcePointer)
}

function isCompositionAlias(value: unknown): boolean {
  return isRecord(value)
    && isCanonicalDefinitionId(value.id)
    && isString(value.kind)
    && isString(value.scope)
    && isString(value.domain)
    && isString(value.localName)
    && isString(value.outputName)
    && (value.reason === 'preserve-if-unique'
      || value.reason === 'domain-prefix'
      || value.reason === 'explicit-alias')
}

function isCompositionCollision(value: unknown): boolean {
  return isRecord(value)
    && isCanonicalDefinitionId(value.canonicalId)
    && isString(value.targetName)
    && isString(value.kind)
    && isString(value.scope)
    && isString(value.domain)
    && isString(value.localName)
    && isString(value.outputName)
    && (value.reason === 'preserve-if-unique'
      || value.reason === 'domain-prefix'
      || value.reason === 'explicit-alias'
      || value.reason === 'output-name-collision')
    && (value.severity === 'info' || value.severity === 'warning' || value.severity === 'error')
}

function isCompositionSourceRef(value: unknown): boolean {
  return isRecord(value)
    && isCanonicalDefinitionId(value.sourceId)
    && isString(value.ref)
    && isString(value.sourcePath)
    && isString(value.sourcePointer)
    && (value.targetId === undefined || isCanonicalDefinitionId(value.targetId))
}

function isCanonicalDefinitionId(value: unknown): value is SpecCanonicalDefinitionId {
  if (!isString(value)) return false
  const separator = value.indexOf(':')
  if (separator <= 0) return false
  const kind = value.slice(0, separator)
  const rest = value.slice(separator + 1)
  return [
    'schema',
    'response',
    'parameter',
    'requestBody',
    'header',
    'link',
    'callback',
    'path',
    'operation',
    'server',
    'tag',
    'securityScheme',
  ].includes(kind)
    && rest.split('/').length === 3
    && rest.split('/').every(segment => segment.length > 0)
}

function isCompileEvidence(value: unknown): value is SpecLensTypeSpecCompileEvidence {
  if (!isRecord(value)
    || value.schemaVersion !== SPEC_LENS_TYPESPEC_COMPILE_EVIDENCE_SCHEMA_VERSION
    || value.manifestSchemaVersion !== SPEC_LENS_TYPESPEC_MANIFEST_SCHEMA_VERSION
    || !isString(value.entrypoint)
    || !isStringArray(value.sourceFiles)
    || (value.compatibilitySource !== 'sidecar' && value.compatibilitySource !== 'typespec-extensions')
    || !isToolchainEvidence(value.toolchain)
    || !isRecord(value.compiler)
    || !isRecord(value.validation)
    || !isRecord(value.gates)) {
    return false
  }

  const compiler = value.compiler
  const validation = value.validation
  const gates = value.gates
  return compiler.configSource === 'generated-allowlist'
    && compiler.emitter === '@typespec/openapi3'
    && compiler.openapiVersion === '3.2.0'
    && isStringArray(compiler.packageImports)
    && isCompilerResources(compiler.resources)
    && isValidationResult(validation.emitted)
    && isValidationResult(validation.restored)
    && (validation.expected === undefined || isValidationResult(validation.expected))
    && (gates.compatibilitySidecar === 'pass' || gates.compatibilitySidecar === 'fail')
    && (gates.restoredValidation === 'pass' || gates.restoredValidation === 'fail')
    && (gates.expectedDiff === undefined || gates.expectedDiff === 'pass' || gates.expectedDiff === 'fail')
}

function isToolchainEvidence(value: unknown): value is SpecLensTypeSpecToolchainEvidence {
  if (!isRecord(value)
    || value.schemaVersion !== SPEC_LENS_TYPESPEC_TOOLCHAIN_EVIDENCE_SCHEMA_VERSION
    || !isString(value.fingerprint)
    || !isRecord(value.packages)
    || !isString(value.packages['@oa-sdk/typespec-decorators'])
    || !isString(value.packages['@typespec/compiler'])
    || !isString(value.packages['@typespec/http'])
    || !isString(value.packages['@typespec/openapi'])
    || !isString(value.packages['@typespec/openapi3'])
    || !isRecord(value.trustedLibraryDigests)
    || !isString(value.trustedLibraryDigests['@oa-sdk/typespec-decorators'])
    || value.restoreContract !== SPEC_LENS_TYPESPEC_RESTORE_CONTRACT_VERSION
    || value.isolationPolicy !== SPEC_LENS_TYPESPEC_ISOLATION_POLICY_VERSION
    || !isRecord(value.resourcePolicy)) {
    return false
  }
  return isFiniteNumber(value.resourcePolicy.compileTimeoutMs)
    && isFiniteNumber(value.resourcePolicy.compileMaxOutputBytes)
    && isFiniteNumber(value.resourcePolicy.compileMaxOldSpaceSizeMb)
    && isSourceReadBudget(value.resourcePolicy.sourceReadBudget)
    && isFiniteNumber(value.resourcePolicy.maxArtifactBytes)
}

function isCompilerResources(value: unknown): boolean {
  if (!isRecord(value)) return false
  return isFiniteNumber(value.timeoutMs)
    && isFiniteNumber(value.maxOutputBytes)
    && isFiniteNumber(value.maxOldSpaceSizeMb)
    && isSourceReadBudget(value.sourceReadBudget)
    && isFiniteNumber(value.maxArtifactBytes)
    && value.isolationPolicy === SPEC_LENS_TYPESPEC_ISOLATION_POLICY_VERSION
}

function isSourceReadBudget(value: unknown): value is SpecLensTypeSpecSourceReadBudget {
  if (!isRecord(value)) return false
  return value.schemaVersion === SPEC_LENS_TYPESPEC_SOURCE_READ_BUDGET_SCHEMA_VERSION
    && isFiniteNumber(value.maxFiles)
    && isFiniteNumber(value.maxFileBytes)
    && isFiniteNumber(value.maxTotalBytes)
    && isFiniteNumber(value.maxConcurrency)
}

function isValidationResult(value: unknown): boolean {
  return isRecord(value) && typeof value.valid === 'boolean' && isString(value.summary)
}

function isNumberRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(isFiniteNumber)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
