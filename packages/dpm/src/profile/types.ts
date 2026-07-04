export const DPM_PROFILE_ARTIFACT_KIND = 'dpm.profile.artifact.v1' as const

export const DPM_PROFILE_SOURCE_KINDS = [
  'postgresql_catalog',
  'openapi_projection',
  'kafka_topic_bundle',
  'query_log',
  'orm_metadata',
  'manual_import',
] as const

export const DPM_PROFILE_NODE_KINDS = [
  'dataset',
  'schema',
  'table',
  'column',
  'topic',
  'partition',
  'message_key',
  'message_header',
  'message_field',
  'schema_subject',
  'relationship_hint',
] as const

export const DPM_PROFILE_EDGE_KINDS = [
  'contains',
  'references',
  'derived_from',
  'observed_in',
  'same_shape_as',
  'candidate_relationship',
  'schema_version_of',
] as const

export const DPM_PROFILE_METRIC_KINDS = [
  'row_count_estimate',
  'presence_ratio',
  'null_ratio',
  'distinct_ratio',
  'uniqueness_ratio',
  'inclusion_ratio',
  'orphan_ratio',
  'message_rate_estimate',
  'key_coverage_ratio',
  'schema_version_count',
] as const

export const DPM_PROFILE_CAPTURE_MODES = [
  'fixture',
  'snapshot',
  'read_only',
  'manual',
] as const

export const DPM_PROFILE_DIAGNOSTIC_FAMILIES = ['PROF', 'CONN'] as const

export type DpmProfileSourceKind = typeof DPM_PROFILE_SOURCE_KINDS[number]
export type DpmProfileNodeKind = typeof DPM_PROFILE_NODE_KINDS[number]
export type DpmProfileEdgeKind = typeof DPM_PROFILE_EDGE_KINDS[number]
export type DpmProfileMetricKind = typeof DPM_PROFILE_METRIC_KINDS[number]
export type DpmProfileCaptureMode = typeof DPM_PROFILE_CAPTURE_MODES[number]
export type DpmProfileDiagnosticFamily = typeof DPM_PROFILE_DIAGNOSTIC_FAMILIES[number]

export type DpmProfileCoordinate = {
  kind: DpmProfileSourceKind
  path: string
  sourceId?: string
  pointer?: string
  externalId?: string
}

export type DpmProfileSourceDescriptor = {
  id: string
  kind: DpmProfileSourceKind
  connectorId: string
  connectorVersion: string
  refs: string[]
  captureMode: DpmProfileCaptureMode
  capturedAt?: string
  sourceVersionHash?: string
}

export type DpmProfileEvidenceSource = {
  coordinate: DpmProfileCoordinate
  connectorId?: string
  capturedAt?: string
  description?: string
}

export type DpmProfileNode = {
  id: string
  kind: DpmProfileNodeKind
  label: string
  coordinate: DpmProfileCoordinate
  dataType?: string
  shape?: Record<string, string | number | boolean | null>
}

export type DpmProfileEdge = {
  id: string
  kind: DpmProfileEdgeKind
  fromNodeId: string
  toNodeId: string
  evidenceIds: string[]
  confidence?: number
}

export type DpmProfileMetric = {
  id: string
  kind: DpmProfileMetricKind
  subjectId: string
  value: number | string
  unit?: string
  evidenceIds: string[]
}

export type DpmProfileDiagnostic = {
  severity: 'error' | 'warning' | 'info'
  code: `${DpmProfileDiagnosticFamily}${string}`
  message: string
  connectorId?: string
  coordinate?: DpmProfileCoordinate
  evidenceIds?: string[]
}

export type DpmProfileFreshness = {
  versionHash: string
  sourceVersionHashes?: Record<string, string>
}

export type DpmProfileArtifact = {
  kind: typeof DPM_PROFILE_ARTIFACT_KIND
  profileId: string
  datasetId: string
  profileVersion: string
  createdAt: string
  sources: DpmProfileSourceDescriptor[]
  evidenceSources: Record<string, DpmProfileEvidenceSource>
  nodes: DpmProfileNode[]
  edges: DpmProfileEdge[]
  metrics: DpmProfileMetric[]
  diagnostics: DpmProfileDiagnostic[]
  freshness: DpmProfileFreshness
}
