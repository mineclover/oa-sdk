export const expectedGatewayRuntimeOperationIds = [
  'inspectDpmProfile',
  'analyzeDpmProfile',
  'reviewDpmProfileProposal',
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
  'executeDpmJob',
  'getDpmValidationReport',
] as const
