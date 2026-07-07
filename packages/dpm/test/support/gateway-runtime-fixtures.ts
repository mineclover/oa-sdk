export const expectedGatewayRuntimeOperationIds = [
  'inspectDpmProfile',
  'analyzeDpmProfile',
  'listDpmProfileBaselineSummaries',
  'reviewDpmProfileProposal',
  'discoverDpmRelationships',
  'importDpmRelationshipCandidates',
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
  'approveDpmRelationshipCandidate',
  'exportDpmRegistrySnapshot',
  'executeDpmJob',
  'getDpmValidationReport',
] as const
