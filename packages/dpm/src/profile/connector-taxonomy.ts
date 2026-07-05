export const DPM_PROFILE_CONNECTOR_RESULT_KIND = 'dpm.profile.connector-result.v1' as const

export const DPM_PROFILE_CONNECTOR_STATUSES = [
  'completed',
  'completed_with_warnings',
  'failed',
] as const

export const DPM_PROFILE_CONNECTOR_EVIDENCE_KINDS = [
  'source',
  'evidence_source',
  'node',
  'edge',
  'metric',
  'diagnostic',
] as const

export type DpmProfileConnectorStatus = typeof DPM_PROFILE_CONNECTOR_STATUSES[number]
export type DpmProfileConnectorEvidenceKind = typeof DPM_PROFILE_CONNECTOR_EVIDENCE_KINDS[number]
