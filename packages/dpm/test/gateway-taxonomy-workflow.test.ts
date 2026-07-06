import { describe, expect, it } from 'vitest'

import {
  DISCOVERY_CANDIDATE_RECOMMENDATIONS,
  REGISTRY_RELATIONSHIP_STATUSES,
} from '../src/index.js'
import { getDpmGatewaySchemaValue } from './support/gateway-taxonomy-fixtures.js'
import { formatSchemaPath } from './support/schema-path.js'

const workflowTaxonomyProjectionCases = [
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
] as const

describe('DPM gateway workflow taxonomy projection', () => {
  it('projects workflow response runtime taxonomies into the gateway schema', () => {
    for (const [schemaName, path, expected] of workflowTaxonomyProjectionCases) {
      expect(getDpmGatewaySchemaValue(schemaName, path), `${schemaName}.${formatSchemaPath(path)}`).toEqual([
        ...expected,
      ])
    }
  })
})
