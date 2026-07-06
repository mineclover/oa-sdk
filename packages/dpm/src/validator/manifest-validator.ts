import type {
  DpmDiagnostic,
  DpmValidationResult,
} from './diagnostic-types.js'
import {
  sortDpmDiagnostics,
  summarizeDpmDiagnostics,
} from './diagnostic-summary.js'
import { createDpmManifestValidationContext } from './manifest-context.js'
import { validateManifestSyntax } from './manifest-syntax.js'
import { validateManifestRelationships } from './relationship-validator.js'
import { validateSafetyRules } from './safety-validator.js'
import type { DpmValidationInput } from './validation-types.js'

export function validateDpmManifest(input: DpmValidationInput): DpmValidationResult {
  const context = createDpmManifestValidationContext(input.manifest)
  const diagnostics: DpmDiagnostic[] = [
    ...validateManifestSyntax(input.manifest),
    ...validateManifestRelationships({
      relationships: context.relationships,
      scopeTables: context.scopeTables,
      ...(context.registryReference ? { registryReference: context.registryReference } : {}),
      catalog: input.catalog,
      registry: input.registry,
    }),
    ...validateSafetyRules({
      manifest: context.manifest,
      registry: input.registry,
      phase: input.phase ?? 'validate',
    }),
  ]
  const sorted = sortDpmDiagnostics(diagnostics)
  const summary = summarizeDpmDiagnostics(sorted)

  return {
    valid: summary.errors === 0,
    diagnostics: sorted,
    summary,
  }
}
