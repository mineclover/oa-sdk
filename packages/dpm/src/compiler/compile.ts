import type { CatalogSnapshot } from '../catalog/types.js'
import type { DpmValidationResult } from '../validator/diagnostics.js'
import {
  validateDpmManifest,
  type DpmValidationPhase,
} from '../validator/manifest.js'
import type { RegistrySnapshot } from '../registry/registry-snapshot-types.js'
import { createDpmCompiledPlan } from './plan-builder.js'
import type { DpmCompiledPlan } from './plan.js'

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

export function compileDpmPlan(input: DpmCompileInput): DpmCompileResult {
  const validation = validateDpmManifest({
    manifest: input.manifest,
    catalog: input.catalog,
    registry: input.registry,
    phase: input.phase ?? 'compile',
  })
  if (validation.summary.errors > 0) {
    return {
      ok: false,
      diagnostics: validation.diagnostics,
      validation,
    }
  }

  return {
    ok: true,
    validation,
    plan: createDpmCompiledPlan(input),
  }
}
