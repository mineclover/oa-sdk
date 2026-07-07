export const expectedGatewayRuntimeOperationIds = [
  'inspectDpmProfile',
  'analyzeDpmProfile',
  'listDpmProfileBaselineSummaries',
  'reviewDpmProfileProposal',
  'discoverDpmRelationships',
  'importDpmRelationshipCandidates',
  'approveDpmRelationshipCandidate',
  'validateDpmManifest',
  'compileDpmManifest',
  'dryRunDpmManifest',
] as const

export const expectedProfileProposalReviewStatuses = [
  'accepted',
  'rejected',
  'needs_changes',
] as const

export const excludedGatewayRuntimeOperationIds = [
  'exportDpmRegistrySnapshot',
  'executeDpmJob',
  'getDpmValidationReport',
] as const
