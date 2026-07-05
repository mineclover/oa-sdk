import type { CatalogSnapshot } from '../catalog/types.js'
import type { DpmDiagnostic } from './diagnostic-types.js'
import { validateRelationshipCatalogColumnCountGate } from './relationship-catalog-column-count-gates.js'
import {
  createRelationshipCatalogGateContext,
  type RelationshipCatalogGateContext,
} from './relationship-catalog-context.js'
import { validateRelationshipCatalogColumnCompatibility } from './relationship-catalog-column-gates.js'
import { createRelationshipCatalogEndpointContext } from './relationship-catalog-endpoints.js'
import { validateRelationshipParentKeyGate } from './relationship-catalog-key-gates.js'
import { validateRelationshipCatalogTableGates } from './relationship-catalog-table-gates.js'
import type { ManifestRelationship } from './relationship-types.js'

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
  const relationship = createRelationshipCatalogEndpointContext(input.relationship)
  const tableGates = validateRelationshipCatalogTableGates({
    context: input.context,
    relationshipName: relationship.relationshipName,
    pointer: input.pointer,
    ...(relationship.parentTable ? { parentTable: relationship.parentTable } : {}),
    ...(relationship.childTable ? { childTable: relationship.childTable } : {}),
  })

  diagnostics.push(...tableGates.diagnostics)
  const columnCountGate = validateRelationshipCatalogColumnCountGate({
    relationshipName: relationship.relationshipName,
    pointer: input.pointer,
    parentColumns: relationship.parentColumns,
    childColumns: relationship.childColumns,
    ...(relationship.childTable ? { childTable: relationship.childTable } : {}),
  })
  diagnostics.push(...columnCountGate.diagnostics)

  if (columnCountGate.columnCountsMatch && tableGates.parentTableUsable && tableGates.childTableUsable) {
    diagnostics.push(...validateRelationshipCatalogColumnCompatibility({
      catalog: input.catalog,
      relationshipName: relationship.relationshipName,
      pointer: input.pointer,
      parentTable: relationship.parentTable ?? '',
      childTable: relationship.childTable ?? '',
      parentColumns: relationship.parentColumns,
      childColumns: relationship.childColumns,
    }))
  }

  if (tableGates.parentTableUsable && relationship.parentTable) {
    diagnostics.push(...validateRelationshipParentKeyGate({
      catalog: input.catalog,
      relationshipName: relationship.relationshipName,
      pointer: input.pointer,
      parentTable: relationship.parentTable,
      parentColumns: relationship.parentColumns,
    }))
  }

  return diagnostics
}
