import type {
  DpmDiagnostic,
  DpmValidationResult,
} from './diagnostic-types.js'
import {
  sortDpmDiagnostics,
  summarizeDpmDiagnostics,
} from './diagnostic-summary.js'
import { validateManifestSyntax } from './manifest-syntax.js'
import {
  validateManifestRelationships,
  type ManifestRelationship,
  type RelationshipRegistryReference,
} from './relationships.js'
import { validateSafetyRules } from './safety.js'
import {
  asArray,
  asRecord,
} from './value-utils.js'
import type { DpmValidationInput } from './validation-types.js'

export type {
  DpmValidationInput,
  DpmValidationPhase,
} from './validation-types.js'

export function validateDpmManifest(input: DpmValidationInput): DpmValidationResult {
  const manifest = asRecord(input.manifest)
  const registryReference = manifest.relationship_registry as RelationshipRegistryReference | undefined
  const diagnostics: DpmDiagnostic[] = [
    ...validateManifestSyntax(input.manifest),
    ...validateManifestRelationships({
      relationships: asArray(manifest.relationships) as ManifestRelationship[],
      scopeTables: getScopeTables(manifest),
      ...(registryReference ? { registryReference } : {}),
      catalog: input.catalog,
      registry: input.registry,
    }),
    ...validateSafetyRules({
      manifest,
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

function getScopeTables(manifest: Record<string, unknown>): string[] {
  return asArray(asRecord(manifest.scope).include_tables).filter((table): table is string => typeof table === 'string')
}
