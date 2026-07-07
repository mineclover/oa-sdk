import { REGISTRY_ORPHAN_POLICIES } from '../registry/registry-orphan-policy-taxonomy.js'
import { REGISTRY_RELATIONSHIP_KINDS } from '../registry/registry-relationship-kind-taxonomy.js'
import { REGISTRY_RELATIONSHIP_STATUSES } from '../registry/registry-relationship-status-taxonomy.js'
import { REGISTRY_TRANSFORM_STRATEGIES } from '../registry/registry-transform-taxonomy.js'
import {
  arrayOf,
  countRecordSchema,
  integerSchema,
  ratioSchema,
  recordOf,
  ref,
  requiredObjectSchema,
  stringSchema,
} from './openapi-schema.js'

export function createDpmGatewayRelationshipRegistrySchemas() {
  return {
    DpmRegistrySnapshotResponse: requiredObjectSchema({
      kind: { type: 'string', enum: ['dpm.relationship.registry-snapshot.v1'] },
      identity: stringSchema(),
      datasetId: stringSchema(),
      registryVersion: stringSchema(),
      exportedAt: stringSchema(),
      relationships: arrayOf(ref('DpmRegistryRelationship')),
      approvedRelationships: arrayOf(ref('DpmRegistryRelationship')),
      nonExecutableRelationships: arrayOf(ref('DpmRegistryRelationship')),
      summary: requiredObjectSchema({
        total: integerSchema(),
        approved: integerSchema(),
        nonExecutable: integerSchema(),
        byStatus: countRecordSchema(REGISTRY_RELATIONSHIP_STATUSES),
      }),
    }, [
      'kind',
      'identity',
      'datasetId',
      'registryVersion',
      'relationships',
      'approvedRelationships',
      'nonExecutableRelationships',
      'summary',
    ]),
    DpmRegistryRelationship: requiredObjectSchema({
      name: stringSchema(),
      version: stringSchema(),
      status: { type: 'string', enum: [...REGISTRY_RELATIONSHIP_STATUSES] },
      type: { type: 'string', enum: [...REGISTRY_RELATIONSHIP_KINDS] },
      parent: ref('DpmRelationshipDiscoveryEndpoint'),
      child: ref('DpmRelationshipDiscoveryEndpoint'),
      namespace: stringSchema(),
      transformStrategy: { type: 'string', enum: [...REGISTRY_TRANSFORM_STRATEGIES] },
      orphanPolicy: { type: 'string', enum: [...REGISTRY_ORPHAN_POLICIES] },
      condition: ref('DpmRegistryRelationshipCondition'),
      confidenceScore: ratioSchema(),
      evidence: arrayOf(ref('DpmRegistryEvidence')),
      approval: ref('DpmRegistryApprovalMetadata'),
      supersedes: stringSchema(),
      supersededBy: stringSchema(),
      source: ref('DpmDiscoverySourceCoordinate'),
      identity: stringSchema(),
      executable: { type: 'boolean' },
    }, [
      'name',
      'version',
      'status',
      'type',
      'parent',
      'child',
      'namespace',
      'transformStrategy',
      'orphanPolicy',
      'condition',
      'evidence',
      'approval',
      'identity',
      'executable',
    ]),
    DpmRegistryRelationshipCondition: requiredObjectSchema({
      contextColumns: arrayOf(stringSchema()),
      conditionSql: stringSchema(),
      temporalCondition: stringSchema(),
    }, ['contextColumns']),
    DpmRegistryEvidence: requiredObjectSchema({
      kind: stringSchema(),
      message: stringSchema(),
      score: ratioSchema(),
      source: ref('DpmDiscoverySourceCoordinate'),
      metadata: recordOf({}),
    }, ['kind', 'message']),
    DpmRegistryApprovalMetadata: requiredObjectSchema({
      owner: stringSchema(),
      approvedBy: stringSchema(),
      approvedAt: stringSchema(),
      reviewedBy: stringSchema(),
      reviewedAt: stringSchema(),
      reason: stringSchema(),
    }, ['owner']),
  } as const
}
