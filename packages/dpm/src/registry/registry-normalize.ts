import {
  createRegistryRelationshipIdentity,
} from './registry-identity.js'
import type {
  RegistryApprovalMetadata,
  RegistryEndpoint,
  RegistryEvidence,
  RegistryRelationship,
  RegistryRelationshipInput,
} from './registry-relationship-types.js'
import type { RegistrySnapshotInput } from './registry-snapshot-types.js'

export function normalizeRegistryRelationship(
  snapshot: Pick<RegistrySnapshotInput, 'datasetId' | 'registryVersion'>,
  relationship: RegistryRelationshipInput,
): RegistryRelationship {
  const condition = relationship.condition ?? { contextColumns: [] }

  return {
    ...relationship,
    identity: createRegistryRelationshipIdentity(snapshot.datasetId, relationship.name, relationship.version),
    executable: relationship.status === 'approved',
    parent: copyEndpoint(relationship.parent),
    child: copyEndpoint(relationship.child),
    condition: {
      contextColumns: [...condition.contextColumns],
      ...(condition.conditionSql ? { conditionSql: condition.conditionSql } : {}),
      ...(condition.temporalCondition ? { temporalCondition: condition.temporalCondition } : {}),
    },
    evidence: [...(relationship.evidence ?? [])].map(copyEvidence).sort(byEvidence),
    approval: copyApproval(relationship.approval),
  }
}

function copyEndpoint(endpoint: RegistryEndpoint): RegistryEndpoint {
  return {
    table: endpoint.table,
    columns: [...endpoint.columns],
  }
}

function copyEvidence(evidence: RegistryEvidence): RegistryEvidence {
  return {
    kind: evidence.kind,
    message: evidence.message,
    ...(evidence.score !== undefined ? { score: evidence.score } : {}),
    ...(evidence.source ? { source: evidence.source } : {}),
    ...(evidence.metadata ? { metadata: JSON.parse(JSON.stringify(evidence.metadata)) as Record<string, unknown> } : {}),
  }
}

function copyApproval(approval: RegistryApprovalMetadata): RegistryApprovalMetadata {
  return {
    owner: approval.owner,
    ...(approval.approvedBy ? { approvedBy: approval.approvedBy } : {}),
    ...(approval.approvedAt ? { approvedAt: approval.approvedAt } : {}),
    ...(approval.reviewedBy ? { reviewedBy: approval.reviewedBy } : {}),
    ...(approval.reviewedAt ? { reviewedAt: approval.reviewedAt } : {}),
    ...(approval.reason ? { reason: approval.reason } : {}),
  }
}

function byEvidence(left: RegistryEvidence, right: RegistryEvidence): number {
  return `${left.kind}.${left.message}`.localeCompare(`${right.kind}.${right.message}`)
}
