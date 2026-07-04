import type { CatalogSnapshot } from '../catalog/types.js'
import type {
  RegistryOrphanPolicy,
  RegistryRelationshipKind,
  RegistrySnapshot,
  RegistryTransformStrategy,
} from '../registry/types.js'

export const DPM_COMPILED_PLAN_KIND = 'dpm.compiled-plan.v1' as const
export const DPM_COMPILED_PLAN_VERSIONS = ['1.0'] as const
export const DPM_PLAN_STALE_REASONS = [
  'catalog_version_hash_changed',
  'registry_version_changed',
] as const
export const DPM_RELATIONSHIP_STEP_CARDINALITIES = [
  'one_to_one',
  'one_to_many',
  'many_to_one',
  'many_to_many',
  'self_reference',
  'polymorphic',
  'temporal',
  'code_lookup',
] as const

export type DpmCompiledPlanVersion = typeof DPM_COMPILED_PLAN_VERSIONS[number]
export type DpmPlanStaleReason = typeof DPM_PLAN_STALE_REASONS[number]
export type DpmRelationshipStepCardinality = typeof DPM_RELATIONSHIP_STEP_CARDINALITIES[number]

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
  relationshipType: RegistryRelationshipKind
  cardinality: DpmRelationshipStepCardinality
  parent: {
    table: string
    columns: string[]
  }
  child: {
    table: string
    columns: string[]
  }
  namespace: string
  transformStrategy: RegistryTransformStrategy
  orphanPolicy: RegistryOrphanPolicy
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
