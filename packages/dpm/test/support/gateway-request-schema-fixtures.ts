export const GATEWAY_WRITE_REQUEST_SCHEMA_NAMES = [
  'DpmCatalogProfileRequest',
  'DpmProfileInspectionRequest',
  'DpmProfileAnalysisRequest',
  'DpmProfileBaselineSummaryListRequest',
  'DpmProfileProposalReviewRequest',
  'DpmRelationshipDiscoveryRequest',
  'DpmCandidateImportRequest',
  'DpmRelationshipApprovalRequest',
  'DpmManifestValidationRequest',
  'DpmManifestCompileRequest',
  'DpmManifestDryRunRequest',
  'DpmExecuteJobRequest',
] as const

export type GatewayWriteRequestSchemaName =
  typeof GATEWAY_WRITE_REQUEST_SCHEMA_NAMES[number]
