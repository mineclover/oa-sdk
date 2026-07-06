import { describe, expect, it } from 'vitest'

import {
  DPM_RELATIONSHIP_STEP_CARDINALITIES,
  REGISTRY_ORPHAN_POLICIES,
  REGISTRY_RELATIONSHIP_KINDS,
  REGISTRY_TRANSFORM_STRATEGIES,
} from '../src/index.js'
import { getDpmGatewaySchemaValue } from './support/gateway-taxonomy-fixtures.js'
import { formatSchemaPath } from './support/schema-path.js'

const relationshipStepTaxonomyProjectionCases = [
  ['DpmRelationshipStep', ['properties', 'relationshipType', 'enum'], REGISTRY_RELATIONSHIP_KINDS],
  ['DpmRelationshipStep', ['properties', 'cardinality', 'enum'], DPM_RELATIONSHIP_STEP_CARDINALITIES],
  ['DpmRelationshipStep', ['properties', 'transformStrategy', 'enum'], REGISTRY_TRANSFORM_STRATEGIES],
  ['DpmRelationshipStep', ['properties', 'orphanPolicy', 'enum'], REGISTRY_ORPHAN_POLICIES],
] as const

describe('DPM gateway relationship step taxonomy projection', () => {
  it('projects relationship step runtime taxonomies into the gateway schema', () => {
    for (const [schemaName, path, expected] of relationshipStepTaxonomyProjectionCases) {
      expect(getDpmGatewaySchemaValue(schemaName, path), `${schemaName}.${formatSchemaPath(path)}`).toEqual([
        ...expected,
      ])
    }
  })
})
