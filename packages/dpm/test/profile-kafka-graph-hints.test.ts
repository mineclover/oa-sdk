import { describe, expect, it } from 'vitest'

import {
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
})
