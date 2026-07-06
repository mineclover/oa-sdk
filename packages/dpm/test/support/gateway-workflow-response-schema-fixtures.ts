export const GATEWAY_WORKFLOW_RESPONSE_SCHEMA_NAMES = [
  'DpmCatalogProfileResponse',
  'DpmProfileInspectionResponse',
  'DpmProfileAnalysisResponse',
  'DpmProfileProposalReviewResponse',
  'DpmRelationshipDiscoveryReport',
  'DpmCandidateImportResponse',
  'DpmRelationshipApprovalResponse',
  'DpmRegistrySnapshotResponse',
  'DpmExecuteJobResponse',
  'DpmJobReport',
] as const

export type GatewayWorkflowResponseSchemaName =
  typeof GATEWAY_WORKFLOW_RESPONSE_SCHEMA_NAMES[number]
