import { describe, expect, it } from 'vitest'

import {
  DPM_RELATIONSHIP_STEP_CARDINALITIES,
  REGISTRY_ORPHAN_POLICIES,
  REGISTRY_RELATIONSHIP_KINDS,
  REGISTRY_TRANSFORM_STRATEGIES,
} from '../src/index.js'
import { getDpmGatewaySchema } from './support/gateway-taxonomy-fixtures.js'

describe('DPM gateway relationship step taxonomy projection', () => {
  it('projects relationship step runtime taxonomies into the gateway schema', () => {
    const relationshipStepSchema = getDpmGatewaySchema('DpmRelationshipStep')

    expect(relationshipStepSchema.properties.relationshipType.enum).toEqual([...REGISTRY_RELATIONSHIP_KINDS])
    expect(relationshipStepSchema.properties.cardinality.enum).toEqual([...DPM_RELATIONSHIP_STEP_CARDINALITIES])
    expect(relationshipStepSchema.properties.transformStrategy.enum).toEqual([...REGISTRY_TRANSFORM_STRATEGIES])
    expect(relationshipStepSchema.properties.orphanPolicy.enum).toEqual([...REGISTRY_ORPHAN_POLICIES])
  })
})
