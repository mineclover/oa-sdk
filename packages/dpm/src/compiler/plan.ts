import type { CatalogSnapshot } from '../catalog/types.js'
import type { RegistrySnapshot } from '../registry/types.js'

export const DPM_COMPILED_PLAN_KIND = 'dpm.compiled-plan.v1' as const

export type DpmCompiledPlanVersion = '1.0'
export type DpmPlanStaleReason = 'catalog_version_hash_changed' | 'registry_version_changed'

export type DpmPlanFreshness = {
  manifestCatalogVersionHash?: string
  catalogVersionHash: string
  registryVersion: string
  registryIdentity: string
}

export type DpmNamespaceBinding = {
  namespace: string
  entity: string
  relationships: string[]
  columns: string[]
  transform: string
}

export type DpmRelationshipStep = {
  name: string
  registryIdentity: string
  registryStatus: 'approved'
  relationshipType: string
  cardinality: string
  parent: {
    table: string
    columns: string[]
  }
  child: {
    table: string
    columns: string[]
  }
  namespace: string
  transformStrategy: string
  orphanPolicy: string
}

export type DpmColumnStep = {
  table: string
  column: string
  columnRef: string
  role: string
  pii: boolean
  transform: string
  relationship?: string
  namespace?: string
}

export type DpmCompiledPlan = {
  kind: typeof DPM_COMPILED_PLAN_KIND
  planVersion: DpmCompiledPlanVersion
  identity: string
  manifestId: string
  datasetId: string
  policyVersion: string
  manifestCatalogVersionHash?: string
  freshness: DpmPlanFreshness
  stale: boolean
  staleReasons: DpmPlanStaleReason[]
  namespaceBindings: DpmNamespaceBinding[]
  relationshipSteps: DpmRelationshipStep[]
  columnSteps: DpmColumnStep[]
}

export function createPlanFreshness(input: {
  manifestCatalogVersionHash?: string
  catalog: CatalogSnapshot
  registry: RegistrySnapshot
}): DpmPlanFreshness {
  return {
    ...(input.manifestCatalogVersionHash ? { manifestCatalogVersionHash: input.manifestCatalogVersionHash } : {}),
    catalogVersionHash: input.catalog.freshness.versionHash,
    registryVersion: input.registry.registryVersion,
    registryIdentity: input.registry.identity,
  }
}
