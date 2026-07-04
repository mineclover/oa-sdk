import type { CatalogSnapshot } from '../catalog/types.js'
import type { RegistrySnapshot } from '../registry/types.js'

export type DpmValidationPhase = 'validate' | 'compile' | 'dry_run' | 'runtime'

export type DpmValidationInput = {
  manifest: unknown
  catalog: CatalogSnapshot
  registry: RegistrySnapshot
  phase?: DpmValidationPhase
}
