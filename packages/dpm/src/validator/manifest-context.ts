import type {
  ManifestRelationship,
  RelationshipRegistryReference,
} from './relationship-types.js'
import {
  asArray,
  asRecord,
} from './value-utils.js'

export type DpmManifestValidationContext = {
  manifest: Record<string, unknown>
  relationships: ManifestRelationship[]
  scopeTables: string[]
  registryReference?: RelationshipRegistryReference
}

export function createDpmManifestValidationContext(manifestInput: unknown): DpmManifestValidationContext {
  const manifest = asRecord(manifestInput)
  const registryReference = manifest.relationship_registry as RelationshipRegistryReference | undefined

  return {
    manifest,
    relationships: asArray(manifest.relationships) as ManifestRelationship[],
    scopeTables: getScopeTables(manifest),
    ...(registryReference ? { registryReference } : {}),
  }
}

function getScopeTables(manifest: Record<string, unknown>): string[] {
  return asArray(asRecord(manifest.scope).include_tables).filter((table): table is string => typeof table === 'string')
}
