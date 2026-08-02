import {
  createLogicalErdArtifact,
  type LogicalErdArtifact,
  type LogicalErdArtifactInput,
  type LogicalErdEntity,
  type LogicalErdField,
  type LogicalErdProvenance,
  type LogicalErdSourceSpan,
} from '@oa-sdk/logical-erd-contract'
import { getNamespaceFullName, getSourceLocation, getTypeName, type DiagnosticTarget, type Model, type ModelProperty, type Namespace, type Program } from '@typespec/compiler'
import { reportDiagnostic } from './lib.js'
import { datasets, entities, fields, foreignKeys, primaryKeyParts, primaryKeys, relationships, uniques } from './state.js'

export function emitLogicalErdArtifact(program: Program): LogicalErdArtifact | undefined {
  const input = collectLogicalErdArtifactInput(program)
  if (!input) return undefined
  try {
    return createLogicalErdArtifact(input)
  } catch (error) {
    reportDiagnostic(program, {
      code: 'invalid-artifact',
      target: program.getGlobalNamespaceType(),
      format: { message: error instanceof Error ? error.message : String(error) },
    })
    return undefined
  }
}

export function collectLogicalErdArtifactInput(program: Program): LogicalErdArtifactInput | undefined {
  const entityDeclarations = entities(program)
  if (entityDeclarations.size === 0 && relationships(program).size === 0) return undefined
  const datasetDeclarations = datasets(program)
  const fieldDeclarations = fields(program)
  const provenance: LogicalErdProvenance[] = []
  const logicalEntities: LogicalErdEntity[] = []

  for (const declaration of entityDeclarations.values()) {
    const dataset = findDataset(declaration.target.namespace, datasetDeclarations)
    if (!dataset) {
      reportDiagnostic(program, { code: 'missing-dataset', target: declaration.target, format: { name: declaration.id } })
      return undefined
    }
    const entity: LogicalErdEntity = {
      id: declaration.id,
      datasetId: dataset.id,
      locator: modelLocator(declaration.target),
      fields: [],
    }
    const entitySpan = sourceSpan(declaration.target)
    if (entitySpan) provenance.push(provenanceEntry(`entity:${declaration.id}`, entitySpan, declaration.decoratorTarget))

    for (const property of declaration.target.properties.values()) {
      const field = fieldDeclarations.get(property)
      if (!field) {
        reportDiagnostic(program, {
          code: 'missing-field',
          target: property,
          format: { kind: 'entity', name: `${declaration.id}.${property.name}` },
        })
        return undefined
      }
      const logicalField = toLogicalField(program, property, field.id)
      if (!logicalField) return undefined
      entity.fields.push(logicalField)
      const fieldSpan = sourceSpan(property)
      if (fieldSpan) provenance.push(provenanceEntry(`field:${field.id}`, fieldSpan, field.decoratorTarget))
    }
    logicalEntities.push(entity)
  }

  const logicalDatasets = [...datasetDeclarations.values()].map(declaration => {
    const span = sourceSpan(declaration.target)
    if (span) provenance.push(provenanceEntry(`dataset:${declaration.id}`, span, declaration.decoratorTarget))
    return { id: declaration.id, locator: getNamespaceFullName(declaration.target) }
  })
  const entityByModel = new Map([...entityDeclarations.entries()])
  const logicalRelationships = []
  for (const declaration of [...relationships(program).values()].flat()) {
    const from = resolveEndpoint(program, declaration.from, entityByModel, fieldDeclarations, 'relationship')
    const to = resolveEndpoint(program, declaration.to, entityByModel, fieldDeclarations, 'relationship')
    if (!from || !to) return undefined
    logicalRelationships.push({ id: declaration.id, from, to, cardinality: declaration.cardinality as 'one-to-one' | 'one-to-many' | 'many-to-one' })
    const span = sourceSpan(declaration.target)
    if (span) provenance.push(provenanceEntry(`relationship:${declaration.id}`, span, declaration.decoratorTarget))
  }

  return {
    source: { files: uniquePaths(provenance).map(path => ({ path })) },
    datasets: logicalDatasets,
    entities: logicalEntities,
    relationships: logicalRelationships,
    provenance,
  }
}

function toLogicalField(program: Program, property: ModelProperty, id: string): LogicalErdField | undefined {
  const foreignKey = foreignKeys(program).get(property)
  const target = foreignKey
    ? resolveEndpoint(program, foreignKey.targetField, entities(program), fields(program), 'foreign-key')
    : undefined
  if (foreignKey && !target) return undefined
  return {
    id,
    name: property.name,
    type: getTypeName(property.type),
    required: !property.optional,
    primaryKey: primaryKeys(program).has(property),
    ...(primaryKeyParts(program).get(property) === undefined ? {} : {
      primaryKeyPart: {
        groupId: primaryKeyParts(program).get(property)!.groupId,
        order: primaryKeyParts(program).get(property)!.order,
      },
    }),
    unique: uniques(program).has(property),
    ...(target === undefined ? {} : { foreignKey: target }),
  }
}

function resolveEndpoint(
  program: Program,
  property: ModelProperty,
  entityDeclarations: ReadonlyMap<Model, { id: string }>,
  fieldDeclarations: ReadonlyMap<ModelProperty, { id: string }>,
  kind: 'relationship' | 'foreign-key',
): { entityId: string; fieldId: string } | undefined {
  const entity = property.model ? entityDeclarations.get(property.model) : undefined
  const field = fieldDeclarations.get(property)
  if (!entity || !field) {
    reportDiagnostic(program, {
      code: 'missing-field',
      target: property,
      format: { kind, name: property.name },
    })
    return undefined
  }
  return { entityId: entity.id, fieldId: field.id }
}

function findDataset(
  namespace: Namespace | undefined,
  declarations: ReadonlyMap<Namespace, { id: string }>,
): { id: string } | undefined {
  for (let current = namespace; current; current = current.namespace) {
    const dataset = declarations.get(current)
    if (dataset) return dataset
  }
  return undefined
}

function modelLocator(model: Model): string {
  const namespace = model.namespace ? `${getNamespaceFullName(model.namespace)}.` : ''
  return `${namespace}${model.name}`
}

function sourceSpan(target: DiagnosticTarget): LogicalErdSourceSpan | undefined {
  const location = getSourceLocation(target, { locateId: true })
  if (!location || location.isSynthetic) return undefined
  const start = location.file.getLineAndCharacterOfPosition(location.pos)
  const end = location.file.getLineAndCharacterOfPosition(location.end)
  return {
    file: location.file.path,
    line: start.line + 1,
    column: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  }
}

function provenanceEntry(subject: LogicalErdProvenance['subject'], span: LogicalErdSourceSpan, decoratorTarget: DiagnosticTarget | undefined): LogicalErdProvenance {
  const decoratorSpan = decoratorTarget ? sourceSpan(decoratorTarget) : undefined
  return { subject, span, ...(decoratorSpan === undefined ? {} : { decoratorSpan }) }
}

function uniquePaths(provenance: readonly LogicalErdProvenance[]): string[] {
  return [...new Set(provenance.map(entry => entry.span.file))].sort((left, right) => left.localeCompare(right))
}
