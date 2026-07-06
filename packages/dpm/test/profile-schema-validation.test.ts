import { describe, expect, it } from 'vitest'

import {
  normalizeDpmProfileArtifact,
  validateDpmProfileArtifactSchema,
  type DpmProfileArtifact,
} from '../src/index.js'
import { createKafkaProfileInput } from './support/profile-artifact-kafka-inputs.js'

describe('DPM profile artifact schema validation', () => {
  it('returns normalized schema issues for invalid profile artifacts', () => {
    const profile = normalizeDpmProfileArtifact(createKafkaProfileInput()) as DpmProfileArtifact
    const result = validateDpmProfileArtifactSchema({
      ...profile,
      metrics: [{ id: '', kind: 'presence_ratio', subjectId: 'node:key:orders.created', value: 1 }],
    })

    expect(result.valid).toBe(false)
    expect(result.issues.some(issue => issue.instancePath.includes('/metrics/0/id'))).toBe(true)
  })
})
