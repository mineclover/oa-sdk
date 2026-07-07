export const GATEWAY_WORKFLOW_RESPONSE_SCHEMA_NAMES = [
  'DpmCatalogProfileResponse',
  'DpmProfileInspectionResponse',
  'DpmProfileAnalysisResponse',
  'DpmProfileBaselineSummaryListResponse',
  'DpmProfileProposalReviewResponse',
  'DpmRelationshipDiscoveryReport',
  'DpmCandidateImportResponse',
  'DpmRelationshipApprovalResponse',
  'DpmRegistrySnapshotResponse',
  'DpmRegistryAuditEventListResponse',
  'DpmExecuteJobResponse',
  'DpmJobReport',
] as const

export type GatewayWorkflowResponseSchemaName =
  typeof GATEWAY_WORKFLOW_RESPONSE_SCHEMA_NAMES[number]
