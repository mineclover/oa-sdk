import type {
  LogicalErdArtifact,
  LogicalErdDiff,
  LogicalErdDiffChange,
  LogicalErdDiffSeverity,
  LogicalErdEntity,
  LogicalErdField,
  LogicalErdRelationship,
} from './types.js'
import { LOGICAL_ERD_DIFF_KIND } from './types.js'

export function diffLogicalErdArtifacts(base: LogicalErdArtifact, next: LogicalErdArtifact): LogicalErdDiff {
  const changes: LogicalErdDiffChange[] = []
  diffNamed('dataset', base.datasets, next.datasets, changes, datasetChange)
  diffNamed('entity', base.entities, next.entities, changes, entityChange)
  diffFields(base.entities, next.entities, changes)
  diffNamed('relationship', base.relationships, next.relationships, changes, relationshipChange)
  changes.sort((left, right) => `${left.subject}:${left.id}`.localeCompare(`${right.subject}:${right.id}`))
  return {
    kind: LOGICAL_ERD_DIFF_KIND,
    baseArtifactId: base.artifactId,
    nextArtifactId: next.artifactId,
    changes,
    summary: summarize(changes),
  }
}

function diffNamed<T extends { id: string }>(
  subject: 'dataset' | 'entity' | 'relationship',
  base: readonly T[],
  next: readonly T[],
  changes: LogicalErdDiffChange[],
  classify: (base: T, next: T) => LogicalErdDiffChange | undefined,
): void {
  const baseById = new Map(base.map(value => [value.id, value]))
  const nextById = new Map(next.map(value => [value.id, value]))
  for (const id of new Set([...baseById.keys(), ...nextById.keys()])) {
    const before = baseById.get(id)
    const after = nextById.get(id)
    if (!before) changes.push({ subject, id, kind: 'added', severity: 'additive', details: `${subject} added.` })
    else if (!after) changes.push({ subject, id, kind: 'removed', severity: 'breaking', details: `${subject} removed.` })
    else {
      const change = classify(before, after)
      if (change) changes.push(change)
    }
  }
}

function datasetChange(base: { id: string; locator: string }, next: { id: string; locator: string }): LogicalErdDiffChange | undefined {
  if (base.locator === next.locator) return undefined
  return { subject: 'dataset', id: base.id, kind: 'renamed', severity: 'non-breaking', details: 'Dataset locator changed while the stable id stayed the same.' }
}

function entityChange(base: LogicalErdEntity, next: LogicalErdEntity): LogicalErdDiffChange | undefined {
  if (base.datasetId !== next.datasetId) {
    return { subject: 'entity', id: base.id, kind: 'changed', severity: 'potentially-breaking', details: 'Entity dataset changed.' }
  }
  if (base.locator !== next.locator) {
    return { subject: 'entity', id: base.id, kind: 'renamed', severity: 'non-breaking', details: 'Entity locator changed while the stable id stayed the same.' }
  }
  return undefined
}

function relationshipChange(base: LogicalErdRelationship, next: LogicalErdRelationship): LogicalErdDiffChange | undefined {
  if (base.cardinality !== next.cardinality || !sameEndpoint(base.from, next.from) || !sameEndpoint(base.to, next.to)) {
    return { subject: 'relationship', id: base.id, kind: 'changed', severity: 'potentially-breaking', details: 'Relationship endpoint or cardinality changed.' }
  }
  return undefined
}

function diffFields(baseEntities: readonly LogicalErdEntity[], nextEntities: readonly LogicalErdEntity[], changes: LogicalErdDiffChange[]): void {
  const baseFields = fieldsById(baseEntities)
  const nextFields = fieldsById(nextEntities)
  for (const id of new Set([...baseFields.keys(), ...nextFields.keys()])) {
    const before = baseFields.get(id)
    const after = nextFields.get(id)
    if (!before) {
      changes.push({ subject: 'field', id, kind: 'added', severity: after?.field.required ? 'potentially-breaking' : 'additive', details: after?.field.required ? 'Required field added.' : 'Optional field added.' })
    } else if (!after) {
      changes.push({ subject: 'field', id, kind: 'removed', severity: 'breaking', details: 'Field removed.' })
    } else if (before.entityId !== after.entityId || before.field.type !== after.field.type || before.field.required !== after.field.required || before.field.primaryKey !== after.field.primaryKey || before.field.unique !== after.field.unique || !samePrimaryKeyPart(before.field, after.field) || !sameForeignKey(before.field, after.field)) {
      changes.push({ subject: 'field', id, kind: 'changed', severity: 'potentially-breaking', details: 'Field semantics changed.' })
    } else if (before.field.name !== after.field.name) {
      changes.push({ subject: 'field', id, kind: 'renamed', severity: 'non-breaking', details: 'Field locator changed while the stable id stayed the same.' })
    }
  }
}

function fieldsById(entities: readonly LogicalErdEntity[]): Map<string, { entityId: string; field: LogicalErdField }> {
  return new Map(entities.flatMap(entity => entity.fields.map(field => [field.id, { entityId: entity.id, field }] as const)))
}

function sameEndpoint(left: { entityId: string; fieldId: string }, right: { entityId: string; fieldId: string }): boolean {
  return left.entityId === right.entityId && left.fieldId === right.fieldId
}

function sameForeignKey(left: LogicalErdField, right: LogicalErdField): boolean {
  if (!left.foreignKey || !right.foreignKey) return left.foreignKey === right.foreignKey
  return sameEndpoint(left.foreignKey, right.foreignKey)
}

function samePrimaryKeyPart(left: LogicalErdField, right: LogicalErdField): boolean {
  return left.primaryKeyPart?.groupId === right.primaryKeyPart?.groupId
    && left.primaryKeyPart?.order === right.primaryKeyPart?.order
}

function summarize(changes: readonly LogicalErdDiffChange[]): Record<LogicalErdDiffSeverity, number> {
  const summary: Record<LogicalErdDiffSeverity, number> = {
    additive: 0,
    'non-breaking': 0,
    'potentially-breaking': 0,
    breaking: 0,
  }
  for (const change of changes) summary[change.severity] += 1
  return summary
}
