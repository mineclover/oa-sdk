import type { CatalogSnapshot } from '../catalog/types.js'
import {
  createDpmDiagnostic,
  type DpmDiagnostic,
} from './diagnostics.js'
import {
  createRelationshipCatalogGateContext,
  type RelationshipCatalogGateContext,
} from './relationship-catalog-context.js'
import { validateRelationshipCatalogColumnCompatibility } from './relationship-catalog-column-gates.js'
import { validateRelationshipParentKeyGate } from './relationship-catalog-key-gates.js'
import { validateRelationshipCatalogTableGates } from './relationship-catalog-table-gates.js'
import type { ManifestRelationship } from './relationship-types.js'
import { toStringArray } from './relationship-utils.js'

export {
  createRelationshipCatalogGateContext,
  type RelationshipCatalogGateContext,
} from './relationship-catalog-context.js'

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
  const tableGates = validateRelationshipCatalogTableGates({
    context: input.context,
    relationshipName: name,
    pointer: input.pointer,
    ...(parentTable ? { parentTable } : {}),
    ...(childTable ? { childTable } : {}),
  })

  diagnostics.push(...tableGates.diagnostics)
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
  } else if (tableGates.parentTableUsable && tableGates.childTableUsable) {
    diagnostics.push(...validateRelationshipCatalogColumnCompatibility({
      catalog: input.catalog,
      relationshipName: name,
      pointer: input.pointer,
      parentTable: parentTable ?? '',
      childTable: childTable ?? '',
      parentColumns,
      childColumns,
    }))
  }

  if (tableGates.parentTableUsable && parentTable) {
    diagnostics.push(...validateRelationshipParentKeyGate({
      catalog: input.catalog,
      relationshipName: name,
      pointer: input.pointer,
      parentTable,
      parentColumns,
    }))
  }

  return diagnostics
}
