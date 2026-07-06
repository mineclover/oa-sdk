import { validateDpmManifest } from '../validator/manifest-validator.js'
import { createDpmCompiledPlan } from './plan-builder.js'
import type {
  DpmCompileInput,
  DpmCompileResult,
} from './compile-types.js'

export type {
  DpmCompileFailure,
  DpmCompileInput,
  DpmCompileResult,
  DpmCompileSuccess,
} from './compile-types.js'

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
