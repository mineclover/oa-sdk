import type { CatalogSnapshot } from '../catalog/types.js'
import type { RegistrySnapshot } from '../registry/registry-snapshot-types.js'
import type { DpmPlanFreshness } from './plan.js'

export function createPlanFreshness(input: {
  manifestCatalogVersionHash?: string
  catalog: CatalogSnapshot
  registry: RegistrySnapshot
}): DpmPlanFreshness {
  return {
    ...(input.manifestCatalogVersionHash
      ? { manifestCatalogVersionHash: input.manifestCatalogVersionHash }
      : {}),
    catalogVersionHash: input.catalog.freshness.versionHash,
    registryVersion: input.registry.registryVersion,
    registryIdentity: input.registry.identity,
  }
}
