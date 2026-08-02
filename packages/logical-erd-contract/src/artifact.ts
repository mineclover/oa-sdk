import { createHash } from 'node:crypto'
import type {
  LogicalErdArtifact,
  LogicalErdArtifactInput,
  LogicalErdDiagnostic,
  LogicalErdEntity,
  LogicalErdField,
  LogicalErdProvenance,
  LogicalErdRelationship,
} from './types.js'
import { LOGICAL_ERD_ARTIFACT_KIND } from './types.js'

export function createLogicalErdArtifact(input: LogicalErdArtifactInput): LogicalErdArtifact {
  const normalized = normalizeLogicalErdArtifactInput(input)
  const diagnostics = validateLogicalErdArtifactInput(normalized)
  if (diagnostics.length > 0) {
    throw new Error(`Invalid logical ERD artifact:\n${diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join('\n')}`)
  }

  return {
    kind: LOGICAL_ERD_ARTIFACT_KIND,
    artifactId: createArtifactId(normalized),
    ...normalized,
  }
}

export function validateLogicalErdArtifact(artifact: LogicalErdArtifact): LogicalErdDiagnostic[] {
  if (artifact.kind !== LOGICAL_ERD_ARTIFACT_KIND) {
    return [{ code: 'ERD002', message: `Expected artifact kind ${LOGICAL_ERD_ARTIFACT_KIND}.` }]
  }
  const input = {
    source: artifact.source,
    datasets: artifact.datasets,
    entities: artifact.entities,
    relationships: artifact.relationships,
    provenance: artifact.provenance,
  }
  const diagnostics = validateLogicalErdArtifactInput(input)
  if (diagnostics.length > 0) return diagnostics
  const expectedArtifactId = createArtifactId(normalizeLogicalErdArtifactInput(input))
  if (artifact.artifactId !== expectedArtifactId) {
    return [{ code: 'ERD002', message: `Artifact id does not match its normalized content hash; expected ${expectedArtifactId}.` }]
  }
  return []
}

export function normalizeLogicalErdArtifactInput(input: LogicalErdArtifactInput): LogicalErdArtifactInput {
  return {
    source: {
      ...(input.source.package === undefined ? {} : { package: input.source.package }),
      files: input.source.files
        .map(file => ({ ...(file.hash === undefined ? {} : { hash: file.hash }), path: file.path }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    },
    datasets: [...input.datasets]
      .map(dataset => ({ ...dataset }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    entities: input.entities
      .map(normalizeEntity)
      .sort((left, right) => left.id.localeCompare(right.id)),
    relationships: input.relationships
      .map(relationship => ({ ...relationship, from: { ...relationship.from }, to: { ...relationship.to } }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    provenance: input.provenance
      .map(normalizeProvenance)
      .sort((left, right) => left.subject.localeCompare(right.subject)),
  }
}

function normalizeEntity(entity: LogicalErdEntity): LogicalErdEntity {
  return {
    ...entity,
    fields: entity.fields
      .map(normalizeField)
      .sort((left, right) => left.id.localeCompare(right.id)),
  }
}

function normalizeField(field: LogicalErdField): LogicalErdField {
  return {
    ...field,
    ...(field.primaryKeyPart === undefined ? {} : { primaryKeyPart: { ...field.primaryKeyPart } }),
    ...(field.foreignKey === undefined ? {} : { foreignKey: { ...field.foreignKey } }),
  }
}

function normalizeProvenance(provenance: LogicalErdProvenance): LogicalErdProvenance {
  return {
    ...provenance,
    span: { ...provenance.span },
    ...(provenance.decoratorSpan === undefined ? {} : { decoratorSpan: { ...provenance.decoratorSpan } }),
  }
}

function validateLogicalErdArtifactInput(input: LogicalErdArtifactInput): LogicalErdDiagnostic[] {
  const diagnostics: LogicalErdDiagnostic[] = []
  checkUniqueIds(diagnostics, 'dataset', input.datasets.map(dataset => dataset.id))
  checkUniqueIds(diagnostics, 'entity', input.entities.map(entity => entity.id))
  checkUniqueIds(diagnostics, 'field', input.entities.flatMap(entity => entity.fields.map(field => field.id)))
  checkUniqueIds(diagnostics, 'relationship', input.relationships.map(relationship => relationship.id))

  const datasets = new Set(input.datasets.map(dataset => dataset.id))
  const entities = new Map(input.entities.map(entity => [entity.id, entity]))
  const fields = new Map<string, LogicalErdField>()
  for (const entity of input.entities) {
    if (!datasets.has(entity.datasetId)) {
      diagnostics.push({ code: 'ERD003', subject: `entity:${entity.id}`, message: `Entity ${entity.id} refers to unknown dataset ${entity.datasetId}.` })
    }
    checkUniqueIds(diagnostics, `field in ${entity.id}`, entity.fields.map(field => field.id))
    for (const field of entity.fields) {
      fields.set(fieldKey(entity.id, field.id), field)
      if (field.foreignKey && !fields.has(fieldKey(field.foreignKey.entityId, field.foreignKey.fieldId))) {
        const targetEntity = entities.get(field.foreignKey.entityId)
        if (!targetEntity || !targetEntity.fields.some(candidate => candidate.id === field.foreignKey?.fieldId)) {
          diagnostics.push({ code: 'ERD003', subject: `field:${field.id}`, message: `Foreign-key field ${field.id} refers to an unknown endpoint ${field.foreignKey.entityId}.${field.foreignKey.fieldId}.` })
        }
      }
    }
    validatePrimaryKeyParts(diagnostics, entity)
  }

  for (const relationship of input.relationships) {
    if (!isCardinality(relationship.cardinality)) {
      diagnostics.push({ code: 'ERD004', subject: `relationship:${relationship.id}`, message: `Relationship ${relationship.id} has unsupported cardinality ${relationship.cardinality}.` })
    }
    for (const [role, endpoint] of [['from', relationship.from], ['to', relationship.to]] as const) {
      const entity = entities.get(endpoint.entityId)
      if (!entity || !entity.fields.some(field => field.id === endpoint.fieldId)) {
        diagnostics.push({ code: 'ERD003', subject: `relationship:${relationship.id}`, message: `Relationship ${relationship.id} ${role} endpoint ${endpoint.entityId}.${endpoint.fieldId} cannot be resolved.` })
      }
    }
  }
  return diagnostics
}

function checkUniqueIds(diagnostics: LogicalErdDiagnostic[], kind: string, ids: string[]): void {
  const seen = new Set<string>()
  for (const id of ids) {
    if (!id) diagnostics.push({ code: 'ERD002', message: `${kind} id must not be empty.` })
    else if (seen.has(id)) diagnostics.push({ code: 'ERD001', message: `Duplicate ${kind} id ${id}.` })
    else seen.add(id)
  }
}

function fieldKey(entityId: string, id: string): string {
  return `${entityId}\u0000${id}`
}

function isCardinality(value: string): boolean {
  return value === 'one-to-one' || value === 'one-to-many' || value === 'many-to-one'
}

function createArtifactId(normalized: LogicalErdArtifactInput): string {
  const contentHash = createHash('sha256').update(stableJson(normalized)).digest('hex')
  const scope = normalized.datasets.map(dataset => dataset.id).join('+') || 'unscoped'
  return `logical-erd:${scope}@sha256:${contentHash}`
}

function validatePrimaryKeyParts(diagnostics: LogicalErdDiagnostic[], entity: LogicalErdEntity): void {
  const groups = new Map<string, LogicalErdField[]>()
  for (const field of entity.fields) {
    const part = field.primaryKeyPart
    if (!part) continue
    if (!field.primaryKey) {
      diagnostics.push({ code: 'ERD005', subject: `field:${field.id}`, message: `Composite key part ${field.id} must also be a primary-key field.` })
      continue
    }
    if (!part.groupId || !Number.isSafeInteger(part.order) || part.order < 1) {
      diagnostics.push({ code: 'ERD005', subject: `field:${field.id}`, message: `Composite key part ${field.id} must use a non-empty group id and a positive integer order.` })
      continue
    }
    groups.set(part.groupId, [...(groups.get(part.groupId) ?? []), field])
  }
  for (const [groupId, fields] of groups) {
    if (fields.length < 2) {
      diagnostics.push({ code: 'ERD005', subject: `entity:${entity.id}`, message: `Composite primary-key group ${groupId} in ${entity.id} must contain at least two fields.` })
    }
    const orders = new Set<number>()
    for (const field of fields) {
      const order = field.primaryKeyPart!.order
      if (orders.has(order)) {
        diagnostics.push({ code: 'ERD005', subject: `entity:${entity.id}`, message: `Composite primary-key group ${groupId} in ${entity.id} repeats component order ${order}.` })
      }
      orders.add(order)
    }
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
