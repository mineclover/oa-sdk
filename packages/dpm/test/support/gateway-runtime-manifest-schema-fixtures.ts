export const GATEWAY_RUNTIME_RESULT_SCHEMA_NAMES = [
  'DpmValidationResult',
  'DpmCompileResult',
  'DpmDryRunResult',
] as const

export const invalidCompiledPlanTaxonomyCases = [
  ['planVersion', '2.0'],
  ['staleReasons', ['unknown_stale_reason']],
] as const

export const invalidRelationshipStepTaxonomyCases = [
  ['relationshipType', 'unknown_relationship_type'],
  ['cardinality', 'unknown_cardinality'],
  ['transformStrategy', 'unknown_transform_strategy'],
  ['orphanPolicy', 'unknown_orphan_policy'],
] as const
