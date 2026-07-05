import type {
  RegistryApprovalMetadata,
  RegistryConditionMetadata,
  RegistryEndpoint,
  RegistryEvidence,
  RegistryRelationshipInput,
  RegistryRelationshipStatus,
} from './types.js'
import { REGISTRY_RELATIONSHIP_STATUSES } from './types.js'
import { optionalNumber, optionalString, requireArray, requireRecord, requireString } from './registry-yaml-values.js'

export function toRegistryRelationshipInput(raw: unknown): RegistryRelationshipInput {
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
    transformStrategy: requireString(
      record.transformStrategy ?? record.transform_strategy,
      'relationship.transformStrategy',
    ) as RegistryRelationshipInput['transformStrategy'],
    orphanPolicy: requireString(
      record.orphanPolicy ?? record.orphan_policy,
      'relationship.orphanPolicy',
    ) as RegistryRelationshipInput['orphanPolicy'],
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
  if (!(REGISTRY_RELATIONSHIP_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`relationship.status must be one of ${REGISTRY_RELATIONSHIP_STATUSES.join(', ')}`)
  }
  return status
}
