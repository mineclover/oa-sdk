import type { CatalogSnapshot } from '../catalog/types.js'
import type { DpmDiagnostic } from './diagnostic-types.js'
import { validateRelationshipCatalogColumnGates } from './relationship-catalog-column-flow.js'
import {
  createRelationshipCatalogGateContext,
  type RelationshipCatalogGateContext,
} from './relationship-catalog-context.js'
import { createRelationshipCatalogEndpointContext } from './relationship-catalog-endpoints.js'
import {
  createRelationshipCatalogColumnGateInput,
  createRelationshipCatalogParentKeyGateInput,
  createRelationshipCatalogTableGateInput,
} from './relationship-catalog-gate-inputs.js'
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
  const tableGates = validateRelationshipCatalogTableGates(createRelationshipCatalogTableGateInput({
    context: input.context,
    relationship,
    pointer: input.pointer,
  }))

  diagnostics.push(...tableGates.diagnostics)
  const columnGateInput = createRelationshipCatalogColumnGateInput({
    catalog: input.catalog,
    relationship,
    pointer: input.pointer,
    tableGates,
  })
  diagnostics.push(...validateRelationshipCatalogColumnGates(columnGateInput))

  const parentKeyGateInput = createRelationshipCatalogParentKeyGateInput({
    catalog: input.catalog,
    relationship,
    pointer: input.pointer,
    tableGates,
  })
  diagnostics.push(...validateRelationshipCatalogParentKeyGate(parentKeyGateInput))

  return diagnostics
}
