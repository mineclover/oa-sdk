import { parse } from 'yaml'

import type {
  RegistryApprovalMetadata,
  RegistryConditionMetadata,
  RegistryEndpoint,
  RegistryEvidence,
  RegistryRelationship,
  RegistryRelationshipInput,
  RegistryRelationshipStatus,
  RegistrySnapshot,
  RegistrySnapshotInput,
} from './types.js'

export const REGISTRY_SNAPSHOT_KIND = 'dpm.relationship.registry-snapshot.v1' as const

const REGISTRY_STATUSES: readonly RegistryRelationshipStatus[] = [
  'candidate',
  'proposed',
  'approved',
  'rejected',
  'deprecated',
  'superseded',
] as const

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
  const raw = parse(yamlText) as unknown
  return createRegistrySnapshot(toRegistrySnapshotInput(raw))
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
  const counts = Object.fromEntries(REGISTRY_STATUSES.map(status => [status, 0])) as Record<RegistryRelationshipStatus, number>
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

function toRegistrySnapshotInput(raw: unknown): RegistrySnapshotInput {
  const record = requireRecord(raw, 'registry snapshot')
  const datasetId = requireString(record.datasetId ?? record.dataset_id, 'datasetId')
  const registryVersion = requireString(record.registryVersion ?? record.registry_version, 'registryVersion')
  const relationships = requireArray(record.relationships, 'relationships').map(toRelationshipInput)
  const exportedAt = optionalString(record.exportedAt ?? record.exported_at, 'exportedAt')

  return {
    datasetId,
    registryVersion,
    ...(exportedAt ? { exportedAt } : {}),
    relationships,
  }
}

function toRelationshipInput(raw: unknown): RegistryRelationshipInput {
  const record = requireRecord(raw, 'relationship')
  const condition = toCondition(record.condition)
  const confidenceScore = optionalNumber(record.confidenceScore ?? record.confidence_score, 'confidenceScore')
  const supersedes = optionalString(record.supersedes, 'supersedes')
  const supersededBy = optionalString(record.supersededBy ?? record.superseded_by, 'supersededBy')

  return {
    name: requireString(record.name, 'relationship.name'),
    version: requireString(record.version, 'relationship.version'),
    status: toStatus(record.status),
    type: requireString(record.type, 'relationship.type') as RegistryRelationshipInput['type'],
    parent: toEndpoint(record.parent, 'relationship.parent'),
    child: toEndpoint(record.child, 'relationship.child'),
    namespace: requireString(record.namespace, 'relationship.namespace'),
    transformStrategy: requireString(record.transformStrategy ?? record.transform_strategy, 'relationship.transformStrategy') as RegistryRelationshipInput['transformStrategy'],
    orphanPolicy: requireString(record.orphanPolicy ?? record.orphan_policy, 'relationship.orphanPolicy') as RegistryRelationshipInput['orphanPolicy'],
    ...(condition ? { condition } : {}),
    ...(confidenceScore !== undefined ? { confidenceScore } : {}),
    evidence: requireArray(record.evidence ?? [], 'relationship.evidence').map(toEvidence),
    approval: toApproval(record.approval),
    ...(supersedes ? { supersedes } : {}),
    ...(supersededBy ? { supersededBy } : {}),
  }
}

function toEndpoint(raw: unknown, label: string): RegistryEndpoint {
  const record = requireRecord(raw, label)
  return {
    table: requireString(record.table, `${label}.table`),
    columns: requireArray(record.columns, `${label}.columns`).map((column, index) =>
      requireString(column, `${label}.columns[${index}]`),
    ),
  }
}

function toCondition(raw: unknown): RegistryConditionMetadata | undefined {
  if (raw === undefined || raw === null) return undefined
  const record = requireRecord(raw, 'relationship.condition')
  const conditionSql = optionalString(record.conditionSql ?? record.condition_sql, 'condition.conditionSql')
  const temporalCondition = optionalString(record.temporalCondition ?? record.temporal_condition, 'condition.temporalCondition')

  return {
    contextColumns: requireArray(record.contextColumns ?? record.context_columns ?? [], 'condition.contextColumns')
      .map((column, index) => requireString(column, `condition.contextColumns[${index}]`)),
    ...(conditionSql ? { conditionSql } : {}),
    ...(temporalCondition ? { temporalCondition } : {}),
  }
}

function toEvidence(raw: unknown): RegistryEvidence {
  const record = requireRecord(raw, 'relationship.evidence')
  const score = optionalNumber(record.score, 'evidence.score')
  return {
    kind: requireString(record.kind, 'evidence.kind'),
    message: requireString(record.message, 'evidence.message'),
    ...(score !== undefined ? { score } : {}),
    ...(record.metadata && typeof record.metadata === 'object' ? { metadata: record.metadata as Record<string, unknown> } : {}),
  }
}

function toApproval(raw: unknown): RegistryApprovalMetadata {
  const record = requireRecord(raw, 'relationship.approval')
  const approvedBy = optionalString(record.approvedBy ?? record.approved_by, 'approval.approvedBy')
  const approvedAt = optionalString(record.approvedAt ?? record.approved_at, 'approval.approvedAt')
  const reviewedBy = optionalString(record.reviewedBy ?? record.reviewed_by, 'approval.reviewedBy')
  const reviewedAt = optionalString(record.reviewedAt ?? record.reviewed_at, 'approval.reviewedAt')
  const reason = optionalString(record.reason, 'approval.reason')

  return {
    owner: requireString(record.owner, 'approval.owner'),
    ...(approvedBy ? { approvedBy } : {}),
    ...(approvedAt ? { approvedAt } : {}),
    ...(reviewedBy ? { reviewedBy } : {}),
    ...(reviewedAt ? { reviewedAt } : {}),
    ...(reason ? { reason } : {}),
  }
}

function toStatus(value: unknown): RegistryRelationshipStatus {
  const status = requireString(value, 'relationship.status') as RegistryRelationshipStatus
  if (!(REGISTRY_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`relationship.status must be one of ${REGISTRY_STATUSES.join(', ')}`)
  }
  return status
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined
  return requireString(value, label)
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`)
  }
  return value
}
