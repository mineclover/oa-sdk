import type { CatalogSnapshot } from '../catalog/types.js'
import type { RegistrySnapshot } from '../registry/registry-snapshot-types.js'

export type DpmCompiledPlanBuilderInput = {
  manifest: unknown
  catalog: CatalogSnapshot
  registry: RegistrySnapshot
}
