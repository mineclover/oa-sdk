import { describe, expect, it } from 'vitest'

import {
  DPM_PROFILE_ARTIFACT_KIND,
  normalizeDpmProfileArtifact,
  validateDpmProfileArtifactSchema,
} from '../src/index.js'
import {
  createDbProfileInput,
  createKafkaProfileInput,
} from './support/profile-artifact-fixtures.js'

describe('DPM profile artifact normalization', () => {
  it('normalizes DB and Kafka evidence into the same profile artifact contract', () => {
    const dbProfile = normalizeDpmProfileArtifact(createDbProfileInput())
    const kafkaProfile = normalizeDpmProfileArtifact(createKafkaProfileInput())

    for (const profile of [dbProfile, kafkaProfile]) {
      expect(profile.kind).toBe(DPM_PROFILE_ARTIFACT_KIND)
      expect(profile.freshness.versionHash).toMatch(/^sha256:[a-f0-9]{64}$/)
      expect(validateDpmProfileArtifactSchema(profile).valid).toBe(true)
    }
  })

  it('changes freshness when normalized profile evidence changes', () => {
    const original = normalizeDpmProfileArtifact(createKafkaProfileInput())
    const changed = normalizeDpmProfileArtifact({
      ...createKafkaProfileInput(),
      metrics: [
        {
          id: 'metric:orders.created.key_coverage',
          kind: 'key_coverage_ratio',
          subjectId: 'node:key:orders.created',
          value: 0.95,
          unit: 'ratio',
          evidenceIds: ['evidence:kafka:orders.created.customer_no'],
        },
      ],
    })

    expect(changed.freshness.versionHash).not.toBe(original.freshness.versionHash)
  })

  it('normalizes equivalent profile artifacts to the same freshness hash', () => {
    const first = normalizeDpmProfileArtifact(createDbProfileInput())
    const input = createDbProfileInput()
    const second = normalizeDpmProfileArtifact({
      ...input,
      nodes: [...input.nodes].reverse(),
      edges: [...input.edges].reverse(),
      metrics: [...input.metrics].reverse(),
      diagnostics: [...input.diagnostics].reverse(),
      evidenceSources: Object.fromEntries(Object.entries(input.evidenceSources).reverse()),
    })

    expect(second.freshness.versionHash).toBe(first.freshness.versionHash)
    expect(second.nodes.map(node => node.id)).toEqual(first.nodes.map(node => node.id))
  })
})
