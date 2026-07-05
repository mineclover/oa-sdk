import { DISCOVERY_CANDIDATE_RECOMMENDATIONS } from '../discovery/discovery-taxonomy.js'
import {
  arrayOf,
  ref,
  requiredObjectSchema,
  stringSchema,
} from './openapi-schema.js'

export function createDpmGatewayRelationshipDiscoverySchemas() {
  return {
    DpmRelationshipDiscoveryRequest: requiredObjectSchema({
      manifest: ref('DpmManifestPolicy'),
      catalogSnapshot: ref('DpmSnapshotRef'),
    }),
    DpmRelationshipDiscoveryReport: requiredObjectSchema({
      reportRef: stringSchema(),
      candidates: arrayOf(requiredObjectSchema({
        name: stringSchema(),
        recommendation: { type: 'string', enum: [...DISCOVERY_CANDIDATE_RECOMMENDATIONS] },
      })),
    }),
  } as const
}
