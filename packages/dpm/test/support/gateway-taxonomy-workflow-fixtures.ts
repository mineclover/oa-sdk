import {
  DISCOVERY_CANDIDATE_RECOMMENDATIONS,
  REGISTRY_RELATIONSHIP_STATUSES,
} from '../../src/index.js'
import type { GatewayTaxonomyProjectionCase } from './gateway-schema-lookup.js'

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
