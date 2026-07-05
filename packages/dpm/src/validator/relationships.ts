import {
  type DpmDiagnostic,
} from './diagnostics.js'
import {
  createRelationshipCatalogGateContext,
  validateRelationshipCatalogGates,
} from './relationship-catalog-gates.js'
import {
  validateRelationshipRegistryApproval,
  validateRelationshipRegistryReference,
} from './relationship-registry.js'
import { validateRelationshipShapeGates } from './relationship-shape-gates.js'
import type {
  RelationshipValidationInput,
} from './relationship-types.js'

export type {
  ManifestRelationship,
  ManifestRelationshipEndpoint,
  RelationshipRegistryReference,
  RelationshipValidationInput,
} from './relationship-types.js'

export function validateManifestRelationships(input: RelationshipValidationInput): DpmDiagnostic[] {
  const diagnostics: DpmDiagnostic[] = []
  const catalogContext = createRelationshipCatalogGateContext({
    catalog: input.catalog,
    scopeTables: input.scopeTables,
  })
  diagnostics.push(...validateRelationshipRegistryReference({
    ...(input.registryReference ? { registryReference: input.registryReference } : {}),
    registry: input.registry,
  }))

  input.relationships.forEach((relationship, index) => {
    const pointer = `/relationships/${index}`
    diagnostics.push(...validateRelationshipRegistryApproval({
      registry: input.registry,
      relationship,
      pointer,
    }))

    diagnostics.push(...validateRelationshipCatalogGates({
      catalog: input.catalog,
      context: catalogContext,
      relationship,
      pointer,
    }))
    diagnostics.push(...validateRelationshipShapeGates({
      relationship,
      pointer,
    }))
  })

  return diagnostics
}
