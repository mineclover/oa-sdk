import {
  copyEndpoint,
  type ModelEndpoint,
} from './endpoint.js'
import type {
  LogicalRelationship,
  LogicalRelationshipCondition,
  LogicalRelationshipInput,
  RelationshipCanonicalKeyStrategy,
  TemporalRelationshipInput,
} from './relationship-types.js'

export function createLogicalRelationship(input: LogicalRelationshipInput): LogicalRelationship {
  requireNonEmpty(input.name, 'relationship.name')
  requireNonEmpty(input.namespace, 'relationship.namespace')
  const parent = copyEndpoint(input.parent, 'relationship.parent')
  const child = copyEndpoint(input.child, 'relationship.child')
  const condition = normalizeCondition(input.condition)

  if (input.type === 'polymorphic' && !condition.conditionSql) {
    throw new Error('polymorphic relationships require conditionSql')
  }
  if (input.type === 'temporal' && !input.temporal?.validTimeColumn && !input.temporal?.validTimeAbsentReason) {
    throw new Error('temporal relationships require validTimeColumn or validTimeAbsentReason')
  }
  if ((parent.columns.length > 1 || child.columns.length > 1) && !input.canonicalKey) {
    throw new Error('composite relationships require canonicalKey')
  }

  return {
    name: input.name,
    type: input.type,
    cardinality: input.cardinality,
    parent,
    child,
    namespace: input.namespace,
    transformStrategy: input.transformStrategy,
    orphanPolicy: input.orphanPolicy,
    condition,
    ...(input.temporal ? { temporal: copyTemporal(input.temporal) } : {}),
    canonicalKey: normalizeCanonicalKey(input.canonicalKey, child),
    identity: `relationship:${input.namespace}/${input.name}`,
  }
}

function normalizeCondition(
  condition: LogicalRelationshipCondition | undefined,
): LogicalRelationship['condition'] {
  return {
    contextColumns: [...(condition?.contextColumns ?? [])],
    ...(condition?.conditionSql ? { conditionSql: condition.conditionSql } : {}),
    ...(condition?.temporalCondition ? { temporalCondition: condition.temporalCondition } : {}),
    ...(condition?.metadata ? { metadata: JSON.parse(JSON.stringify(condition.metadata)) as Record<string, unknown> } : {}),
  }
}

function normalizeCanonicalKey(
  strategy: RelationshipCanonicalKeyStrategy | undefined,
  child: ModelEndpoint,
): LogicalRelationship['canonicalKey'] {
  const components = strategy?.components ?? child.columns
  if (components.length === 0) {
    throw new Error('relationship.canonicalKey.components must contain at least one column')
  }
  const separator = strategy?.separator ?? ':'
  requireNonEmpty(separator, 'relationship.canonicalKey.separator')

  return {
    components: [...components],
    separator,
    ...(strategy?.tenant ? { tenant: { columns: [...strategy.tenant.columns] } } : {}),
  }
}

function copyTemporal(temporal: TemporalRelationshipInput): TemporalRelationshipInput {
  return {
    ...(temporal.validTimeColumn ? { validTimeColumn: temporal.validTimeColumn } : {}),
    ...(temporal.validTimeAbsentReason ? { validTimeAbsentReason: temporal.validTimeAbsentReason } : {}),
  }
}

function requireNonEmpty(value: string, label: string): string {
  if (value.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}
