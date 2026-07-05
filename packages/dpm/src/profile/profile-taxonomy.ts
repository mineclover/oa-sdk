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
