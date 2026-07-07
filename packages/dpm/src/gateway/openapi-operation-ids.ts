export const DPM_GATEWAY_OPERATION_IDS = [
  'profileDpmCatalog',
  'inspectDpmProfile',
  'analyzeDpmProfile',
  'listDpmProfileBaselineSummaries',
  'reviewDpmProfileProposal',
  'discoverDpmRelationships',
  'importDpmRelationshipCandidates',
  'approveDpmRelationshipCandidate',
  'exportDpmRegistrySnapshot',
  'listDpmRegistryRelationshipAuditEvents',
  'validateDpmManifest',
  'compileDpmManifest',
  'dryRunDpmManifest',
  'executeDpmJob',
  'getDpmValidationReport',
] as const

export type DpmGatewayOperationId = typeof DPM_GATEWAY_OPERATION_IDS[number]
