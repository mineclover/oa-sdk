import {
  DISCOVERY_RELATIONSHIP_CANDIDATE_TYPES,
} from '../discovery/discovery-taxonomy.js'
import {
  REGISTRY_ORPHAN_POLICIES,
} from '../registry/registry-orphan-policy-taxonomy.js'
import {
  REGISTRY_TRANSFORM_STRATEGIES,
} from '../registry/registry-transform-taxonomy.js'
import {
  arrayOf,
  ratioSchema,
  recordOf,
  ref,
  requiredObjectSchema,
  stringSchema,
} from './openapi-schema.js'

export function createDpmProfileRelationshipHintApprovalGatewaySchemas() {
  return {
    DpmProfileRelationshipHintApprovalRequest: {
      ...requiredObjectSchema({
        profileArtifact: ref('DpmProfileArtifact'),
        relationshipHint: ref('DpmProfileRelationshipHintProposal'),
        childTable: stringSchema(),
        childTableBySourceId: recordOf(stringSchema()),
        childTableByPathPrefix: recordOf(stringSchema()),
        type: { type: 'string', enum: [...DISCOVERY_RELATIONSHIP_CANDIDATE_TYPES] },
        candidateId: stringSchema(),
        confidenceScore: ratioSchema(),
        warnings: arrayOf(stringSchema()),
        registryVersion: stringSchema(),
        version: stringSchema(),
        namespace: stringSchema(),
        transformStrategy: { type: 'string', enum: [...REGISTRY_TRANSFORM_STRATEGIES] },
        orphanPolicy: { type: 'string', enum: [...REGISTRY_ORPHAN_POLICIES] },
        owner: stringSchema(),
        approvedBy: stringSchema(),
        reason: stringSchema(),
        approvedAt: stringSchema(),
        generatedAt: stringSchema(),
        exportedAt: stringSchema(),
        createdAt: stringSchema(),
        updatedAt: stringSchema(),
        sourceFreshnessHash: stringSchema(),
        thresholds: ref('DpmDiscoveryThresholds'),
      }, [
        'profileArtifact',
        'relationshipHint',
        'registryVersion',
        'version',
        'namespace',
        'transformStrategy',
        'orphanPolicy',
        'owner',
        'approvedBy',
        'reason',
      ]),
      anyOf: [
        { required: ['childTable'] },
        { required: ['childTableBySourceId'] },
        { required: ['childTableByPathPrefix'] },
      ],
    },
    DpmProfileRelationshipHintApprovalResponse: requiredObjectSchema({
      relationshipName: stringSchema(),
      status: { type: 'string', enum: ['approved'] },
      candidateInput: ref('DpmRelationshipCandidateInput'),
      reviewCandidate: ref('DpmRelationshipCandidate'),
      candidateImport: ref('DpmCandidateImportResponse'),
      relationship: ref('DpmApprovedRegistryRelationship'),
      savedRelationship: ref('DpmRegistryRelationshipStorageRow'),
      registrySnapshot: ref('DpmRegistrySnapshotResponse'),
    }),
    DpmProfileRelationshipHintApprovalBlockingResponse: requiredObjectSchema({
      relationshipName: stringSchema(),
      status: { type: 'string', enum: ['blocked'] },
      diagnostics: arrayOf(ref('DpmProfileDiagnostic')),
    }, ['relationshipName', 'status', 'diagnostics']),
  } as const
}
