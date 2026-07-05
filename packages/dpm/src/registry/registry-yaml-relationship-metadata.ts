import type {
  RegistryApprovalMetadata,
  RegistryConditionMetadata,
  RegistryEvidence,
} from './registry-relationship-types.js'
import {
  optionalNumber,
  optionalString,
  requireArray,
  requireRecord,
  requireString,
} from './registry-yaml-values.js'

export function toRegistryYamlCondition(raw: unknown): RegistryConditionMetadata | undefined {
  if (raw === undefined || raw === null) return undefined
  const record = requireRecord(raw, 'relationship.condition')
  const conditionSql = optionalString(record.conditionSql ?? record.condition_sql, 'condition.conditionSql')
  const temporalCondition = optionalString(
    record.temporalCondition ?? record.temporal_condition,
    'condition.temporalCondition',
  )

  return {
    contextColumns: requireArray(record.contextColumns ?? record.context_columns ?? [], 'condition.contextColumns')
      .map((column, index) => requireString(column, `condition.contextColumns[${index}]`)),
    ...(conditionSql ? { conditionSql } : {}),
    ...(temporalCondition ? { temporalCondition } : {}),
  }
}

export function toRegistryYamlEvidence(raw: unknown): RegistryEvidence {
  const record = requireRecord(raw, 'relationship.evidence')
  const score = optionalNumber(record.score, 'evidence.score')
  const metadata =
    record.metadata && typeof record.metadata === 'object'
      ? { metadata: record.metadata as Record<string, unknown> }
      : {}

  return {
    kind: requireString(record.kind, 'evidence.kind'),
    message: requireString(record.message, 'evidence.message'),
    ...(score !== undefined ? { score } : {}),
    ...metadata,
  }
}

export function toRegistryYamlApproval(raw: unknown): RegistryApprovalMetadata {
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
