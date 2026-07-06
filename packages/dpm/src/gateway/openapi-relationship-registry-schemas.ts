import { REGISTRY_RELATIONSHIP_STATUSES } from '../registry/registry-relationship-status-taxonomy.js'
import {
  arrayOf,
  requiredObjectSchema,
  stringSchema,
} from './openapi-schema.js'

export function createDpmGatewayRelationshipRegistrySchemas() {
  return {
    DpmRegistrySnapshotResponse: requiredObjectSchema({
      datasetId: stringSchema(),
      registryVersion: stringSchema(),
      relationships: arrayOf(requiredObjectSchema({
        name: stringSchema(),
        status: { type: 'string', enum: [...REGISTRY_RELATIONSHIP_STATUSES] },
      })),
    }),
  } as const
}
