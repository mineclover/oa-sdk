import { DPM_RELATIONSHIP_STEP_CARDINALITIES } from '../compiler/plan.js'
import {
  REGISTRY_ORPHAN_POLICIES,
  REGISTRY_RELATIONSHIP_KINDS,
  REGISTRY_TRANSFORM_STRATEGIES,
} from '../registry/registry-taxonomy.js'
import {
  arrayOf,
  ref,
  requiredObjectSchema,
  stringSchema,
} from './openapi-schema.js'

export function createDpmGatewayPlanRelationshipSchemas() {
  return {
    DpmRelationshipStep: requiredObjectSchema({
      name: stringSchema(),
      registryIdentity: stringSchema(),
      registryStatus: { type: 'string', enum: ['approved'] },
      relationshipType: { type: 'string', enum: [...REGISTRY_RELATIONSHIP_KINDS] },
      cardinality: { type: 'string', enum: [...DPM_RELATIONSHIP_STEP_CARDINALITIES] },
      parent: ref('DpmRelationshipEndpoint'),
      child: ref('DpmRelationshipEndpoint'),
      namespace: stringSchema(),
      transformStrategy: { type: 'string', enum: [...REGISTRY_TRANSFORM_STRATEGIES] },
      orphanPolicy: { type: 'string', enum: [...REGISTRY_ORPHAN_POLICIES] },
    }),
    DpmRelationshipEndpoint: requiredObjectSchema({
      table: stringSchema(),
      columns: arrayOf(stringSchema()),
    }),
  } as const
}
