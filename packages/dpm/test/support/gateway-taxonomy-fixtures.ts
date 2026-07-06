import {
  DISCOVERY_CANDIDATE_RECOMMENDATIONS,
  DPM_COMPILED_PLAN_VERSIONS,
  DPM_DIAGNOSTIC_CODES,
  DPM_PLAN_STALE_REASONS,
  DPM_PROFILE_CAPTURE_MODES,
  DPM_PROFILE_DRIFT_SIGNAL_KINDS,
  DPM_PROFILE_EDGE_KINDS,
  DPM_PROFILE_KEY_CANDIDATE_KINDS,
  DPM_PROFILE_METRIC_KINDS,
  DPM_PROFILE_NODE_KINDS,
  DPM_PROFILE_PROPOSAL_REVIEW_STATUSES,
  DPM_PROFILE_RELATIONSHIP_HINT_STATUSES,
  DPM_PROFILE_RISK_INDICATOR_KINDS,
  DPM_PROFILE_SOURCE_KINDS,
  DPM_RELATIONSHIP_STEP_CARDINALITIES,
  REGISTRY_ORPHAN_POLICIES,
  REGISTRY_RELATIONSHIP_KINDS,
  REGISTRY_RELATIONSHIP_STATUSES,
  REGISTRY_TRANSFORM_STRATEGIES,
  getDpmGatewayOpenApiDocument,
} from '../../src/index.js'
import {
  getSchemaPathValue,
  type SchemaPath,
} from './schema-path.js'

type GatewayTaxonomyProjectionCase = readonly [schemaName: string, path: SchemaPath, expected: readonly string[]]

export const diagnosticTaxonomyProjectionCases = [
  ['DpmDiagnostic', ['properties', 'code', 'enum'], DPM_DIAGNOSTIC_CODES],
] as const satisfies readonly GatewayTaxonomyProjectionCase[]

export const compiledPlanTaxonomyProjectionCases = [
  ['DpmCompiledPlan', ['properties', 'planVersion', 'enum'], DPM_COMPILED_PLAN_VERSIONS],
  ['DpmCompiledPlan', ['properties', 'staleReasons', 'items', 'enum'], DPM_PLAN_STALE_REASONS],
] as const satisfies readonly GatewayTaxonomyProjectionCase[]

export const profileTaxonomyProjectionCases = [
  ['DpmProfileCoordinate', ['properties', 'kind', 'enum'], DPM_PROFILE_SOURCE_KINDS],
  ['DpmProfileSourceDescriptor', ['properties', 'kind', 'enum'], DPM_PROFILE_SOURCE_KINDS],
  ['DpmProfileSourceDescriptor', ['properties', 'captureMode', 'enum'], DPM_PROFILE_CAPTURE_MODES],
  ['DpmProfileNode', ['properties', 'kind', 'enum'], DPM_PROFILE_NODE_KINDS],
  ['DpmProfileEdge', ['properties', 'kind', 'enum'], DPM_PROFILE_EDGE_KINDS],
  ['DpmProfileMetric', ['properties', 'kind', 'enum'], DPM_PROFILE_METRIC_KINDS],
  ['DpmProfileRelationshipHintProposal', ['properties', 'status', 'enum'], DPM_PROFILE_RELATIONSHIP_HINT_STATUSES],
  ['DpmProfileKeyCandidate', ['properties', 'kind', 'enum'], DPM_PROFILE_KEY_CANDIDATE_KINDS],
  ['DpmProfileDriftSignal', ['properties', 'kind', 'enum'], DPM_PROFILE_DRIFT_SIGNAL_KINDS],
  ['DpmProfileRiskIndicator', ['properties', 'kind', 'enum'], DPM_PROFILE_RISK_INDICATOR_KINDS],
  ['DpmProfileProposalReviewRequest', ['properties', 'status', 'enum'], DPM_PROFILE_PROPOSAL_REVIEW_STATUSES],
] as const satisfies readonly GatewayTaxonomyProjectionCase[]

export const relationshipStepTaxonomyProjectionCases = [
  ['DpmRelationshipStep', ['properties', 'relationshipType', 'enum'], REGISTRY_RELATIONSHIP_KINDS],
  ['DpmRelationshipStep', ['properties', 'cardinality', 'enum'], DPM_RELATIONSHIP_STEP_CARDINALITIES],
  ['DpmRelationshipStep', ['properties', 'transformStrategy', 'enum'], REGISTRY_TRANSFORM_STRATEGIES],
  ['DpmRelationshipStep', ['properties', 'orphanPolicy', 'enum'], REGISTRY_ORPHAN_POLICIES],
] as const satisfies readonly GatewayTaxonomyProjectionCase[]

export const workflowTaxonomyProjectionCases = [
  [
    'DpmRelationshipDiscoveryReport',
    ['properties', 'candidates', 'items', 'properties', 'recommendation', 'enum'],
    DISCOVERY_CANDIDATE_RECOMMENDATIONS,
  ],
  [
    'DpmRegistrySnapshotResponse',
    ['properties', 'relationships', 'items', 'properties', 'status', 'enum'],
    REGISTRY_RELATIONSHIP_STATUSES,
  ],
] as const satisfies readonly GatewayTaxonomyProjectionCase[]

export function getDpmGatewaySchema(name: string): Record<string, any> {
  const schema = getDpmGatewayOpenApiDocument().components?.schemas?.[name]
  if (!schema || typeof schema !== 'object') {
    throw new Error(`expected DPM gateway schema: ${name}`)
  }
  return schema as Record<string, any>
}

export function getDpmGatewaySchemaValue(name: string, path: SchemaPath): unknown {
  return getSchemaPathValue(getDpmGatewaySchema(name), path)
}
