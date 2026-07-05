export const DPM_GATEWAY_RUNTIME_OPERATION_IDS = [
  'inspectDpmProfile',
  'analyzeDpmProfile',
  'reviewDpmProfileProposal',
  'validateDpmManifest',
  'compileDpmManifest',
  'dryRunDpmManifest',
] as const

export type DpmGatewayRuntimeOperationId = typeof DPM_GATEWAY_RUNTIME_OPERATION_IDS[number]
