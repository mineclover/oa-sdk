import type { CatalogSnapshot } from '../catalog/types.js'
import type { RelationshipCatalogColumnGateInput } from './relationship-catalog-column-flow.js'
import type { RelationshipCatalogEndpointContext } from './relationship-catalog-endpoints.js'
import type { RelationshipCatalogParentKeyGateInput } from './relationship-catalog-parent-key-flow.js'
import type {
  RelationshipCatalogTableGateInput,
  RelationshipCatalogTableGateResult,
} from './relationship-catalog-table-gates.js'

export function createRelationshipCatalogTableGateInput(input: {
  context: RelationshipCatalogTableGateInput['context']
  relationship: RelationshipCatalogEndpointContext
  pointer: string
}): RelationshipCatalogTableGateInput {
  return {
    context: input.context,
    relationshipName: input.relationship.relationshipName,
    pointer: input.pointer,
    ...(input.relationship.parentTable ? { parentTable: input.relationship.parentTable } : {}),
    ...(input.relationship.childTable ? { childTable: input.relationship.childTable } : {}),
  }
}

export function createRelationshipCatalogColumnGateInput(input: {
  catalog: CatalogSnapshot
  relationship: RelationshipCatalogEndpointContext
  pointer: string
  tableGates: RelationshipCatalogTableGateResult
}): RelationshipCatalogColumnGateInput {
  return {
    catalog: input.catalog,
    relationshipName: input.relationship.relationshipName,
    pointer: input.pointer,
    ...(input.relationship.parentTable ? { parentTable: input.relationship.parentTable } : {}),
    ...(input.relationship.childTable ? { childTable: input.relationship.childTable } : {}),
    parentColumns: input.relationship.parentColumns,
    childColumns: input.relationship.childColumns,
    parentTableUsable: input.tableGates.parentTableUsable,
    childTableUsable: input.tableGates.childTableUsable,
  }
}

export function createRelationshipCatalogParentKeyGateInput(input: {
  catalog: CatalogSnapshot
  relationship: RelationshipCatalogEndpointContext
  pointer: string
  tableGates: RelationshipCatalogTableGateResult
}): RelationshipCatalogParentKeyGateInput {
  return {
    catalog: input.catalog,
    relationshipName: input.relationship.relationshipName,
    pointer: input.pointer,
    ...(input.relationship.parentTable ? { parentTable: input.relationship.parentTable } : {}),
    parentColumns: input.relationship.parentColumns,
    parentTableUsable: input.tableGates.parentTableUsable,
  }
}
