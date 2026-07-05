import type { CatalogSnapshot } from '../catalog/types.js'
import type { RegistrySnapshot } from '../registry/registry-snapshot-types.js'
import type { DpmValidationResult } from '../validator/diagnostic-types.js'
import type { DpmValidationPhase } from '../validator/validation-types.js'
import type { DpmCompiledPlan } from './plan-compiled-types.js'

export type DpmCompileInput = {
  manifest: unknown
  catalog: CatalogSnapshot
  registry: RegistrySnapshot
  phase?: DpmValidationPhase
}

export type DpmCompileSuccess = {
  ok: true
  plan: DpmCompiledPlan
  validation: DpmValidationResult
}

export type DpmCompileFailure = {
  ok: false
  diagnostics: DpmValidationResult['diagnostics']
  validation: DpmValidationResult
}

export type DpmCompileResult = DpmCompileSuccess | DpmCompileFailure
