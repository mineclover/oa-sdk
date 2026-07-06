import { describe, expect, it } from 'vitest'

import {
  normalizeDpmProfileArtifact,
  type DpmProfileArtifactInput,
} from '../src/index.js'
import { createDbProfileInput } from './support/profile-artifact-db-inputs.js'
import { createKafkaProfileInput } from './support/profile-artifact-kafka-inputs.js'

type ProfileArtifactFreshnessChangeCase = {
  label: string
  createOriginalInput: () => DpmProfileArtifactInput
  createChangedInput: () => DpmProfileArtifactInput
}

const profileArtifactFreshnessChangeCases = [
  {
    label: 'PostgreSQL catalog metric value',
    createOriginalInput: createDbProfileInput,
    createChangedInput: () => ({
      ...createDbProfileInput(),
      metrics: [
        {
          id: 'metric:orders.customer_no.presence',
          kind: 'presence_ratio',
          subjectId: 'node:column:orders.customer_no',
          value: 0.99,
          unit: 'ratio',
          evidenceIds: ['evidence:postgres:orders.customer_no'],
        },
      ],
    }),
  },
  {
    label: 'Kafka topic metric value',
    createOriginalInput: createKafkaProfileInput,
    createChangedInput: () => ({
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
    }),
  },
] as const satisfies readonly ProfileArtifactFreshnessChangeCase[]

describe('DPM profile artifact freshness', () => {
  it('changes freshness when normalized profile evidence changes', () => {
    for (const {
      label,
      createOriginalInput,
      createChangedInput,
    } of profileArtifactFreshnessChangeCases) {
      const original = normalizeDpmProfileArtifact(createOriginalInput())
      const changed = normalizeDpmProfileArtifact(createChangedInput())

      expect(changed.freshness.versionHash, label).not.toBe(original.freshness.versionHash)
    }
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
