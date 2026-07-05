import type { CatalogSnapshot } from '../catalog/types.js'
import {
  createDpmDiagnostic,
  type DpmDiagnostic,
} from './diagnostics.js'
import type { ManifestRelationship } from './relationship-types.js'
import { sameColumns, toStringArray } from './relationship-utils.js'

export type RelationshipCatalogGateContext = {
  scopeTables: ReadonlySet<string>
  catalogTables: ReadonlySet<string>
}

export function createRelationshipCatalogGateContext(input: {
  catalog: CatalogSnapshot
  scopeTables: readonly string[]
}): RelationshipCatalogGateContext {
  return {
    scopeTables: new Set(input.scopeTables),
    catalogTables: new Set(input.catalog.tables.map(table => table.table)),
  }
}

export function validateRelationshipCatalogGates(input: {
  catalog: CatalogSnapshot
  context: RelationshipCatalogGateContext
  relationship: ManifestRelationship
  pointer: string
}): DpmDiagnostic[] {
  const diagnostics: DpmDiagnostic[] = []
  const name = input.relationship.name ?? ''
  const parent = input.relationship.parent
  const child = input.relationship.child
  const parentTable = parent?.table
  const childTable = child?.table
  const parentColumns = toStringArray(parent?.columns)
  const childColumns = toStringArray(child?.columns)
  const parentTableUsable = Boolean(
    parentTable &&
    input.context.scopeTables.has(parentTable) &&
    input.context.catalogTables.has(parentTable),
  )
  const childTableUsable = Boolean(
    childTable &&
    input.context.scopeTables.has(childTable) &&
    input.context.catalogTables.has(childTable),
  )

  if (!parentTable || !input.context.scopeTables.has(parentTable) || !input.context.catalogTables.has(parentTable)) {
    diagnostics.push(createDpmDiagnostic({
      severity: 'error',
      code: 'REL001',
      message: `Relationship ${name} parent table must be in manifest scope and catalog snapshot.`,
      sourcePointer: `${input.pointer}/parent/table`,
      catalogCoordinate: { table: parentTable ?? '' },
    }))
  }
  if (!childTable || !input.context.scopeTables.has(childTable) || !input.context.catalogTables.has(childTable)) {
    diagnostics.push(createDpmDiagnostic({
      severity: 'error',
      code: 'REL002',
      message: `Relationship ${name} child table must be in manifest scope and catalog snapshot.`,
      sourcePointer: `${input.pointer}/child/table`,
      catalogCoordinate: { table: childTable ?? '' },
    }))
  }
  if (parentColumns.length !== childColumns.length) {
    diagnostics.push(createDpmDiagnostic({
      severity: 'error',
      code: 'REL003',
      message: `Relationship ${name} parent and child columns must have the same length.`,
      sourcePointer: `${input.pointer}/child/columns`,
      catalogCoordinate: {
        table: childTable ?? '',
        columns: childColumns,
      },
    }))
  } else if (parentTableUsable && childTableUsable) {
    validateColumnCompatibility({
      catalog: input.catalog,
      relationshipName: name,
      pointer: input.pointer,
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
      sourcePointer: `${input.pointer}/parent/columns`,
      catalogCoordinate: {
        table: parentTable,
        columns: parentColumns,
      },
    }))
  }

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
