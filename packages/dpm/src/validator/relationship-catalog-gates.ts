import type { CatalogSnapshot } from '../catalog/types.js'
import type { DpmDiagnostic } from './diagnostic-types.js'
import { validateRelationshipCatalogColumnGates } from './relationship-catalog-column-flow.js'
import {
  createRelationshipCatalogGateContext,
  type RelationshipCatalogGateContext,
} from './relationship-catalog-context.js'
import { createRelationshipCatalogEndpointContext } from './relationship-catalog-endpoints.js'
import { validateRelationshipCatalogParentKeyGate } from './relationship-catalog-parent-key-flow.js'
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
  diagnostics.push(...validateRelationshipCatalogColumnGates({
    catalog: input.catalog,
    relationshipName: relationship.relationshipName,
    pointer: input.pointer,
    ...(relationship.parentTable ? { parentTable: relationship.parentTable } : {}),
    ...(relationship.childTable ? { childTable: relationship.childTable } : {}),
    parentColumns: relationship.parentColumns,
    childColumns: relationship.childColumns,
    parentTableUsable: tableGates.parentTableUsable,
    childTableUsable: tableGates.childTableUsable,
  }))
  diagnostics.push(...validateRelationshipCatalogParentKeyGate({
    catalog: input.catalog,
    relationshipName: relationship.relationshipName,
    pointer: input.pointer,
    ...(relationship.parentTable ? { parentTable: relationship.parentTable } : {}),
    parentColumns: relationship.parentColumns,
    parentTableUsable: tableGates.parentTableUsable,
  }))

  return diagnostics
}
