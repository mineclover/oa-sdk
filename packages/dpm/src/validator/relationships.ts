import type { CatalogSnapshot } from '../catalog/types.js'
import type { RegistryRelationship, RegistrySnapshot } from '../registry/types.js'
import {
  createDpmDiagnostic,
  type DpmDiagnostic,
  type DpmRegistryCoordinate,
} from './diagnostics.js'

export type ManifestRelationshipEndpoint = {
  table?: string
  columns?: unknown
}

export type ManifestRelationship = {
  name?: string
  status?: string
  type?: string
  parent?: ManifestRelationshipEndpoint
  child?: ManifestRelationshipEndpoint
  namespace?: string
  transform_strategy?: string
  transformStrategy?: string
  orphan_policy?: string
  orphanPolicy?: string
  condition_sql?: string
  temporal_condition?: string
  condition?: {
    conditionSql?: string
    temporalCondition?: string
  }
  canonical_key?: unknown
  canonicalKey?: unknown
}

export type RelationshipRegistryReference = {
  dataset_id?: string
  datasetId?: string
  registry_version?: string
  registryVersion?: string
}

export type RelationshipValidationInput = {
  relationships: readonly ManifestRelationship[]
  scopeTables: readonly string[]
  registryReference?: RelationshipRegistryReference
  catalog: CatalogSnapshot
  registry: RegistrySnapshot
}

export function validateManifestRelationships(input: RelationshipValidationInput): DpmDiagnostic[] {
  const diagnostics: DpmDiagnostic[] = []
  const scopeTables = new Set(input.scopeTables)
  const catalogTables = new Set(input.catalog.tables.map(table => table.table))
  const registryDatasetId = input.registryReference?.dataset_id ?? input.registryReference?.datasetId
  const registryVersion = input.registryReference?.registry_version ?? input.registryReference?.registryVersion

  if (registryDatasetId && registryDatasetId !== input.registry.datasetId) {
    diagnostics.push(createDpmDiagnostic({
      severity: 'error',
      code: 'REL011',
      message: `Manifest registry dataset ${registryDatasetId} does not match snapshot ${input.registry.datasetId}.`,
      sourcePointer: '/relationship_registry/dataset_id',
      registryCoordinate: {
        datasetId: input.registry.datasetId,
        registryVersion: input.registry.registryVersion,
      },
    }))
  }
  if (registryVersion && registryVersion !== input.registry.registryVersion) {
    diagnostics.push(createDpmDiagnostic({
      severity: 'error',
      code: 'REL011',
      message: `Manifest registry version ${registryVersion} does not match snapshot ${input.registry.registryVersion}.`,
      sourcePointer: '/relationship_registry/registry_version',
      registryCoordinate: {
        datasetId: input.registry.datasetId,
        registryVersion: input.registry.registryVersion,
      },
    }))
  }

  input.relationships.forEach((relationship, index) => {
    const pointer = `/relationships/${index}`
    const name = relationship.name ?? ''
    const registryMatches = input.registry.relationships.filter(entry => entry.name === name)
    const approvedMatches = input.registry.approvedRelationships.filter(entry => entry.name === name)

    if (registryMatches.length === 0) {
      diagnostics.push(createDpmDiagnostic({
        severity: 'error',
        code: 'REL010',
        message: `Relationship ${name} is missing from registry snapshot.`,
        sourcePointer: `${pointer}/name`,
        registryCoordinate: registryCoordinate(input.registry, name),
      }))
    } else if (approvedMatches.length === 0) {
      diagnostics.push(createDpmDiagnostic({
        severity: 'error',
        code: 'REL006',
        message: `Relationship ${name} is not approved in registry snapshot.`,
        sourcePointer: `${pointer}/name`,
        registryCoordinate: registryCoordinate(input.registry, name, registryMatches[0]),
      }))
    } else if (approvedMatches.length > 1) {
      diagnostics.push(createDpmDiagnostic({
        severity: 'error',
        code: 'REL012',
        message: `Relationship ${name} has multiple approved registry matches.`,
        sourcePointer: `${pointer}/name`,
        registryCoordinate: registryCoordinate(input.registry, name, approvedMatches[0]),
      }))
    } else {
      diagnostics.push(...validateApprovedRegistrySnapshot({
        registry: input.registry,
        relationship,
        approved: approvedMatches[0]!,
        pointer,
      }))
    }

    const parent = relationship.parent
    const child = relationship.child
    const parentTable = parent?.table
    const childTable = child?.table
    const parentColumns = toStringArray(parent?.columns)
    const childColumns = toStringArray(child?.columns)
    const parentTableUsable = Boolean(parentTable && scopeTables.has(parentTable) && catalogTables.has(parentTable))
    const childTableUsable = Boolean(childTable && scopeTables.has(childTable) && catalogTables.has(childTable))

    if (!parentTable || !scopeTables.has(parentTable) || !catalogTables.has(parentTable)) {
      diagnostics.push(createDpmDiagnostic({
        severity: 'error',
        code: 'REL001',
        message: `Relationship ${name} parent table must be in manifest scope and catalog snapshot.`,
        sourcePointer: `${pointer}/parent/table`,
        catalogCoordinate: { table: parentTable ?? '' },
      }))
    }
    if (!childTable || !scopeTables.has(childTable) || !catalogTables.has(childTable)) {
      diagnostics.push(createDpmDiagnostic({
        severity: 'error',
        code: 'REL002',
        message: `Relationship ${name} child table must be in manifest scope and catalog snapshot.`,
        sourcePointer: `${pointer}/child/table`,
        catalogCoordinate: { table: childTable ?? '' },
      }))
    }
    if (parentColumns.length !== childColumns.length) {
      diagnostics.push(createDpmDiagnostic({
        severity: 'error',
        code: 'REL003',
        message: `Relationship ${name} parent and child columns must have the same length.`,
        sourcePointer: `${pointer}/child/columns`,
        catalogCoordinate: {
          table: childTable ?? '',
          columns: childColumns,
        },
      }))
    } else if (parentTableUsable && childTableUsable) {
      validateColumnCompatibility({
        catalog: input.catalog,
        relationshipName: name,
        pointer,
        parentTable: parentTable ?? '',
        childTable: childTable ?? '',
        parentColumns,
        childColumns,
        diagnostics,
      })
    }

    if (parentTableUsable && parentTable && parentColumns.length > 0 && !hasUniqueParentKey(input.catalog, parentTable, parentColumns)) {
      diagnostics.push(createDpmDiagnostic({
        severity: 'error',
        code: 'REL005',
        message: `Relationship ${name} parent key must be a primary key, unique index, or unique candidate.`,
        sourcePointer: `${pointer}/parent/columns`,
        catalogCoordinate: {
          table: parentTable,
          columns: parentColumns,
        },
      }))
    }
    if (relationship.type === 'polymorphic' && !relationship.condition_sql && !relationship.condition?.conditionSql) {
      diagnostics.push(createDpmDiagnostic({
        severity: 'error',
        code: 'REL007',
        message: `Polymorphic relationship ${name} requires condition_sql.`,
        sourcePointer: `${pointer}/condition_sql`,
      }))
    }
    if (relationship.type === 'temporal' && !relationship.temporal_condition && !relationship.condition?.temporalCondition) {
      diagnostics.push(createDpmDiagnostic({
        severity: 'error',
        code: 'REL008',
        message: `Temporal relationship ${name} requires temporal_condition.`,
        sourcePointer: `${pointer}/temporal_condition`,
      }))
    }
    if (parentColumns.length > 1 && childColumns.length > 1 && !relationship.canonical_key && !relationship.canonicalKey) {
      diagnostics.push(createDpmDiagnostic({
        severity: 'error',
        code: 'REL009',
        message: `Composite relationship ${name} requires an explicit canonical key strategy.`,
        sourcePointer: `${pointer}/canonical_key`,
      }))
    }
  })

  return diagnostics
}

function validateApprovedRegistrySnapshot(input: {
  registry: RegistrySnapshot
  relationship: ManifestRelationship
  approved: RegistryRelationship
  pointer: string
}): DpmDiagnostic[] {
  const diagnostics: DpmDiagnostic[] = []
  const relationship = input.relationship
  const approved = input.approved

  addScalarMismatch({
    diagnostics,
    registry: input.registry,
    approved,
    relationshipName: relationship.name ?? '',
    actual: relationship.type,
    expected: approved.type,
    label: 'type',
    sourcePointer: `${input.pointer}/type`,
  })
  addEndpointMismatch({
    diagnostics,
    registry: input.registry,
    approved,
    relationshipName: relationship.name ?? '',
    actual: relationship.parent,
    expected: approved.parent,
    label: 'parent',
    sourcePointer: `${input.pointer}/parent`,
  })
  addEndpointMismatch({
    diagnostics,
    registry: input.registry,
    approved,
    relationshipName: relationship.name ?? '',
    actual: relationship.child,
    expected: approved.child,
    label: 'child',
    sourcePointer: `${input.pointer}/child`,
  })
  addScalarMismatch({
    diagnostics,
    registry: input.registry,
    approved,
    relationshipName: relationship.name ?? '',
    actual: relationship.namespace,
    expected: approved.namespace,
    label: 'namespace',
    sourcePointer: `${input.pointer}/namespace`,
  })
  addScalarMismatch({
    diagnostics,
    registry: input.registry,
    approved,
    relationshipName: relationship.name ?? '',
    actual: relationship.transform_strategy ?? relationship.transformStrategy,
    expected: approved.transformStrategy,
    label: 'transform_strategy',
    sourcePointer: `${input.pointer}/transform_strategy`,
  })
  addScalarMismatch({
    diagnostics,
    registry: input.registry,
    approved,
    relationshipName: relationship.name ?? '',
    actual: relationship.orphan_policy ?? relationship.orphanPolicy,
    expected: approved.orphanPolicy,
    label: 'orphan_policy',
    sourcePointer: `${input.pointer}/orphan_policy`,
  })

  return diagnostics
}

function addScalarMismatch(input: {
  diagnostics: DpmDiagnostic[]
  registry: RegistrySnapshot
  approved: RegistryRelationship
  relationshipName: string
  actual: string | undefined
  expected: string
  label: string
  sourcePointer: string
}): void {
  if (input.actual === input.expected) return
  input.diagnostics.push(createRegistryMismatchDiagnostic(input))
}

function addEndpointMismatch(input: {
  diagnostics: DpmDiagnostic[]
  registry: RegistrySnapshot
  approved: RegistryRelationship
  relationshipName: string
  actual: ManifestRelationshipEndpoint | undefined
  expected: RegistryRelationship['parent']
  label: string
  sourcePointer: string
}): void {
  const actualTable = input.actual?.table
  const actualColumns = toStringArray(input.actual?.columns)
  if (actualTable === input.expected.table && sameColumns(actualColumns, input.expected.columns)) return
  input.diagnostics.push(createRegistryMismatchDiagnostic(input))
}

function createRegistryMismatchDiagnostic(input: {
  registry: RegistrySnapshot
  approved: RegistryRelationship
  relationshipName: string
  label: string
  sourcePointer: string
}): DpmDiagnostic {
  return createDpmDiagnostic({
    severity: 'error',
    code: 'REL013',
    message: `Relationship ${input.relationshipName} ${input.label} must match the approved registry snapshot.`,
    sourcePointer: input.sourcePointer,
    registryCoordinate: registryCoordinate(input.registry, input.relationshipName, input.approved),
  })
}

function validateColumnCompatibility(input: {
  catalog: CatalogSnapshot
  relationshipName: string
  pointer: string
  parentTable: string
  childTable: string
  parentColumns: string[]
  childColumns: string[]
  diagnostics: DpmDiagnostic[]
}): void {
  input.parentColumns.forEach((parentColumn, index) => {
    const childColumn = input.childColumns[index]
    if (!childColumn) return
    const parent = input.catalog.columns.find(column => column.table === input.parentTable && column.name === parentColumn)
    const child = input.catalog.columns.find(column => column.table === input.childTable && column.name === childColumn)
    if (!parent || !child || parent.dataType !== child.dataType) {
      input.diagnostics.push(createDpmDiagnostic({
        severity: 'error',
        code: 'REL004',
        message: `Relationship ${input.relationshipName} columns must exist and be type-compatible.`,
        sourcePointer: `${input.pointer}/parent/columns/${index}`,
        catalogCoordinate: {
          table: input.parentTable,
          column: parentColumn,
        },
      }))
    }
  })
}

function hasUniqueParentKey(catalog: CatalogSnapshot, table: string, columns: readonly string[]): boolean {
  return (
    catalog.primaryKeys.some(candidate => candidate.table === table && sameColumns(candidate.columns, columns)) ||
    catalog.indexes.some(candidate => candidate.table === table && candidate.unique && sameColumns(candidate.columns, columns)) ||
    catalog.uniqueCandidates.some(candidate => candidate.table === table && sameColumns(candidate.columns, columns))
  )
}

function sameColumns(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((column, index) => column === right[index])
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function registryCoordinate(
  registry: RegistrySnapshot,
  relationshipName: string,
  relationship?: RegistryRelationship,
): DpmRegistryCoordinate {
  return {
    datasetId: registry.datasetId,
    registryVersion: registry.registryVersion,
    relationshipName,
    ...(relationship?.version ? { relationshipVersion: relationship.version } : {}),
    ...(relationship?.status ? { status: relationship.status } : {}),
  }
}
