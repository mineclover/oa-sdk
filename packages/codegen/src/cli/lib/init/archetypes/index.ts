import { MvpArchetypeProfile } from './mvp.js'
import { MicroserviceArchetypeProfile } from './microservice.js'
import { EnterpriseArchetypeProfile } from './enterprise.js'
import type { ArchetypeProfile, LifecycleArchetypeId } from './types.js'
import type { DetectedSchemaItem } from '../types.js'

export * from './types.js'
export { MvpArchetypeProfile, MicroserviceArchetypeProfile, EnterpriseArchetypeProfile }

export const ARCHETYPE_PROFILES: ArchetypeProfile[] = [
  new MvpArchetypeProfile(),
  new MicroserviceArchetypeProfile(),
  new EnterpriseArchetypeProfile(),
]

const ARCHETYPE_MAP = new Map<LifecycleArchetypeId, ArchetypeProfile>(
  ARCHETYPE_PROFILES.map((p) => [p.id, p]),
)

/**
 * Resolves an ArchetypeProfile by its identifier.
 * Throws a descriptive error if the archetype identifier is unknown.
 */
export function getArchetypeProfile(id: string): ArchetypeProfile {
  const normalized = id.toLowerCase().trim() as LifecycleArchetypeId
  const profile = ARCHETYPE_MAP.get(normalized)
  if (!profile) {
    const valid = Array.from(ARCHETYPE_MAP.keys()).join(', ')
    throw new Error(`Unknown lifecycle archetype: "${id}". Allowed values: ${valid}`)
  }
  return profile
}

/**
 * Heuristically detects the most suitable lifecycle archetype for a repository.
 */
export async function detectArchetypeProfile(
  cwd: string,
  detectedSchema?: DetectedSchemaItem,
): Promise<{ profile: ArchetypeProfile; confidence: number; matchedMarkers: string[] }> {
  let highestProfile: ArchetypeProfile = ARCHETYPE_PROFILES[0]!
  let highestConfidence = -1
  let bestMarkers: string[] = []

  for (const profile of ARCHETYPE_PROFILES) {
    const res = await profile.detect(cwd, detectedSchema)
    if (res.confidence > highestConfidence) {
      highestConfidence = res.confidence
      highestProfile = profile
      bestMarkers = res.matchedMarkers
    }
  }

  return {
    profile: highestProfile,
    confidence: highestConfidence,
    matchedMarkers: bestMarkers,
  }
}
