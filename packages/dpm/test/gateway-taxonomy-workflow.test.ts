import { describe, expect, it } from 'vitest'

import {
  DISCOVERY_CANDIDATE_RECOMMENDATIONS,
  REGISTRY_RELATIONSHIP_STATUSES,
} from '../src/index.js'
import { getDpmGatewaySchema } from './support/gateway-taxonomy-fixtures.js'

describe('DPM gateway workflow taxonomy projection', () => {
  it('projects workflow response runtime taxonomies into the gateway schema', () => {
    const discoverySchema = getDpmGatewaySchema('DpmRelationshipDiscoveryReport')
    const registrySchema = getDpmGatewaySchema('DpmRegistrySnapshotResponse')

    expect(discoverySchema.properties.candidates.items.properties.recommendation.enum).toEqual([
      ...DISCOVERY_CANDIDATE_RECOMMENDATIONS,
    ])
    expect(registrySchema.properties.relationships.items.properties.status.enum).toEqual([
      ...REGISTRY_RELATIONSHIP_STATUSES,
    ])
  })
})
