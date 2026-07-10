import type { DpmCanonicalKeyEncodingVersion } from '../model/canonical-key-encoding.js'

export type DpmPlanFreshness = {
  manifestCatalogVersionHash?: string
  catalogVersionHash: string
  registryVersion: string
  registryIdentity: string
  canonicalKeyEncodingVersion: DpmCanonicalKeyEncodingVersion
}
