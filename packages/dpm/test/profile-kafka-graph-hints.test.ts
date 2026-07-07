import { describe, expect, it } from 'vitest'

import {
  createDpmProfileAnalysisReport,
  profileKafkaTopicFixture,
  validateDpmProfileArtifactSchema,
} from '../src/index.js'
import {
  readKafkaOrdersCreatedFixture,
  readKafkaOrdersCreatedProfileArtifact,
} from './support/profile-kafka-fixtures.js'

describe('DPM Kafka topic profile graph hints', () => {
  it('keeps relationship hints as profile suggestions, not approved registry entries', () => {
    const profile = readKafkaOrdersCreatedProfileArtifact()
    const serialized = JSON.stringify(profile)

    expect(profile.nodes).toContainEqual(expect.objectContaining({
      id: 'node:relationship-hint:hint:orders-created-customer',
      kind: 'relationship_hint',
    }))
    expect(profile.edges).toContainEqual(expect.objectContaining({
      id: 'edge:relationship-hint:hint:orders-created-customer',
      kind: 'candidate_relationship',
      fromNodeId: 'node:field:orders.created.value.customer.customer_no',
      toNodeId: 'node:relationship-hint:hint:orders-created-customer',
      confidence: 0.93,
    }))
    expect(serialized).not.toContain('"status":"approved"')
    expect(serialized).not.toContain('registryVersion')
  })

  it('turns unresolved relationship hint source paths into diagnostics instead of dangling proposals', () => {
    const fixture = readKafkaOrdersCreatedFixture()
    const result = profileKafkaTopicFixture({
      ...fixture,
      topic: {
        ...fixture.topic,
        relationshipHints: [
          ...(fixture.topic.relationshipHints ?? []),
          {
            id: 'hint:orders-created-missing-field',
            label: 'orders.created missing field resembles public.customers.customer_no',
            fromPath: 'value.customer.missing_field',
            toRef: 'catalog://commerce/public.customers.customer_no',
            confidence: 0.73,
          },
        ],
      },
    })
    const profile = result.profileArtifact
    if (!profile) throw new Error('expected Kafka profile artifact')

    expect(result.observedEvidenceKinds).toContain('diagnostic')
    expect(validateDpmProfileArtifactSchema(profile).valid).toBe(true)
    expect(profile.nodes).toContainEqual(expect.objectContaining({
      id: 'node:relationship-hint:hint:orders-created-missing-field',
      kind: 'relationship_hint',
    }))
    expect(profile.edges).not.toContainEqual(expect.objectContaining({
      id: 'edge:relationship-hint:hint:orders-created-missing-field',
      kind: 'candidate_relationship',
      fromNodeId: 'node:field:orders.created.value.customer.missing_field',
    }))
    expect(profile.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'warning',
      code: 'PROF301',
      connectorId: 'dpm.kafka.fixture',
      coordinate: expect.objectContaining({
        path: 'orders.created.relationshipHints.hint:orders-created-missing-field',
        pointer: '/relationshipHints/hint:orders-created-missing-field',
      }),
      evidenceIds: ['evidence:kafka:orders.created.relationship_hint.hint:orders-created-missing-field'],
    }))

    const report = createDpmProfileAnalysisReport({ profileArtifact: profile })
    expect(report.relationshipHints).not.toContainEqual(expect.objectContaining({
      id: 'proposal:edge:relationship-hint:hint:orders-created-missing-field',
    }))
  })
})
