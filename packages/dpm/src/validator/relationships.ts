import type { CatalogSnapshot } from '../catalog/types.js'
import {
  createDpmDiagnostic,
  type DpmDiagnostic,
} from './diagnostics.js'
import {
  validateRelationshipRegistryApproval,
  validateRelationshipRegistryReference,
} from './relationship-registry.js'
import type {
  RelationshipValidationInput,
} from './relationship-types.js'
import { sameColumns, toStringArray } from './relationship-utils.js'

export type {
  ManifestRelationship,
  ManifestRelationshipEndpoint,
  RelationshipRegistryReference,
  RelationshipValidationInput,
} from './relationship-types.js'

export function validateManifestRelationships(input: RelationshipValidationInput): DpmDiagnostic[] {
  const diagnostics: DpmDiagnostic[] = []
  const scopeTables = new Set(input.scopeTables)
  const catalogTables = new Set(input.catalog.tables.map(table => table.table))
  diagnostics.push(...validateRelationshipRegistryReference({
    ...(input.registryReference ? { registryReference: input.registryReference } : {}),
    registry: input.registry,
  }))

  input.relationships.forEach((relationship, index) => {
    const pointer = `/relationships/${index}`
    const name = relationship.name ?? ''
    diagnostics.push(...validateRelationshipRegistryApproval({
      registry: input.registry,
      relationship,
      pointer,
    }))

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
