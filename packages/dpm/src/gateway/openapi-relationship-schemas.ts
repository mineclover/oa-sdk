import { DISCOVERY_CANDIDATE_RECOMMENDATIONS } from '../discovery/types.js'
import {
  REGISTRY_RELATIONSHIP_STATUSES,
} from '../registry/types.js'
import {
  arrayOf,
  integerSchema,
  ref,
  requiredObjectSchema,
  stringSchema,
} from './openapi-schema.js'

export function createDpmGatewayRelationshipSchemas() {
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
    DpmCandidateImportRequest: requiredObjectSchema({
      datasetId: stringSchema(),
      candidates: arrayOf(requiredObjectSchema({
        name: stringSchema(),
        evidenceRef: stringSchema(),
      })),
    }),
    DpmCandidateImportResponse: requiredObjectSchema({
      imported: integerSchema(),
      rejected: integerSchema(),
    }),
    DpmRelationshipApprovalRequest: requiredObjectSchema({
      owner: stringSchema(),
      approvedBy: stringSchema(),
      reason: stringSchema(),
    }),
    DpmRelationshipApprovalResponse: requiredObjectSchema({
      relationshipName: stringSchema(),
      status: { type: 'string', enum: ['approved'] },
    }),
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
