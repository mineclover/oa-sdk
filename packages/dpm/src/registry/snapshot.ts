import { registrySnapshotInputFromYaml } from './registry-yaml.js'
import type {
  RegistryApprovalMetadata,
  RegistryEndpoint,
  RegistryEvidence,
  RegistryRelationship,
  RegistryRelationshipInput,
  RegistryRelationshipStatus,
  RegistrySnapshot,
  RegistrySnapshotInput,
} from './types.js'
import { REGISTRY_RELATIONSHIP_STATUSES } from './types.js'

export const REGISTRY_SNAPSHOT_KIND = 'dpm.relationship.registry-snapshot.v1' as const

export function createRegistrySnapshot(input: RegistrySnapshotInput): RegistrySnapshot {
  const relationships = input.relationships
    .map(relationship => normalizeRelationship(input, relationship))
    .sort((left, right) => left.identity.localeCompare(right.identity))
  const approvedRelationships = relationships.filter(isExecutableRegistryRelationship)
  const nonExecutableRelationships = relationships.filter(relationship => !relationship.executable)

  return {
    kind: REGISTRY_SNAPSHOT_KIND,
    identity: createSnapshotIdentity(input.datasetId, input.registryVersion),
    datasetId: input.datasetId,
    registryVersion: input.registryVersion,
    ...(input.exportedAt ? { exportedAt: input.exportedAt } : {}),
    relationships,
    approvedRelationships,
    nonExecutableRelationships,
    summary: {
      total: relationships.length,
      approved: approvedRelationships.length,
      nonExecutable: nonExecutableRelationships.length,
      byStatus: countByStatus(relationships),
    },
  }
}

export function parseRegistrySnapshotYaml(yamlText: string): RegistrySnapshot {
  return createRegistrySnapshot(registrySnapshotInputFromYaml(yamlText))
}

export function selectApprovedRelationships(snapshot: RegistrySnapshot): RegistryRelationship[] {
  return snapshot.relationships.filter(isExecutableRegistryRelationship)
}

export function isExecutableRegistryRelationship(relationship: Pick<RegistryRelationship, 'status'>): boolean {
  return relationship.status === 'approved'
}

function normalizeRelationship(
  snapshot: Pick<RegistrySnapshotInput, 'datasetId' | 'registryVersion'>,
  relationship: RegistryRelationshipInput,
): RegistryRelationship {
  const condition = relationship.condition ?? { contextColumns: [] }

  return {
    ...relationship,
    identity: createRelationshipIdentity(snapshot.datasetId, relationship.name, relationship.version),
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

function createSnapshotIdentity(datasetId: string, registryVersion: string): string {
  return `${datasetId}@${registryVersion}`
}

function createRelationshipIdentity(datasetId: string, relationshipName: string, version: string): string {
  return `${datasetId}/${relationshipName}@${version}`
}

function countByStatus(relationships: readonly RegistryRelationship[]): Record<RegistryRelationshipStatus, number> {
  const counts = Object.fromEntries(REGISTRY_RELATIONSHIP_STATUSES.map(status => [status, 0])) as Record<RegistryRelationshipStatus, number>
  for (const relationship of relationships) {
    counts[relationship.status] += 1
  }
  return counts
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
