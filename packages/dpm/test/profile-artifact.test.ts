import { describe, expect, it } from 'vitest'

import {
  DPM_PROFILE_ARTIFACT_KIND,
  normalizeDpmProfileArtifact,
  type DpmProfileArtifactInput,
  validateDpmProfileArtifactSchema,
} from '../src/index.js'
import { createDbProfileInput } from './support/profile-artifact-db-inputs.js'
import { createKafkaProfileInput } from './support/profile-artifact-kafka-inputs.js'

type ProfileArtifactSourceCase = {
  label: string
  createInput: () => DpmProfileArtifactInput
}

const profileArtifactSourceCases = [
  {
    label: 'PostgreSQL catalog',
    createInput: createDbProfileInput,
  },
  {
    label: 'Kafka topic bundle',
    createInput: createKafkaProfileInput,
  },
] as const satisfies readonly ProfileArtifactSourceCase[]

const profileArtifactVersionHashPattern = /^sha256:[a-f0-9]{64}$/

describe('DPM profile artifact normalization', () => {
  it('normalizes DB and Kafka evidence into the same profile artifact contract', () => {
    for (const { label, createInput } of profileArtifactSourceCases) {
      const profile = normalizeDpmProfileArtifact(createInput())
      expect(profile.kind).toBe(DPM_PROFILE_ARTIFACT_KIND)
      expect(profile.freshness.versionHash, `${label} freshness hash`)
        .toMatch(profileArtifactVersionHashPattern)
      expect(validateDpmProfileArtifactSchema(profile).valid, `${label} schema validity`).toBe(true)
    }
  })
})
