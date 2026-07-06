import { describe, expect, it } from 'vitest'

import {
  profileKafkaTopicFixture,
} from '../src/index.js'
import {
  readKafkaOrdersCreatedFixture,
} from './support/profile-kafka-fixtures.js'

describe('DPM Kafka topic profile graph', () => {
  it('flattens nested message fields into stable profile nodes and edges', () => {
    const fixture = readKafkaOrdersCreatedFixture()
    const profile = profileKafkaTopicFixture(fixture).profileArtifact
    if (!profile) throw new Error('expected Kafka profile artifact')

    const nodesById = new Map(profile.nodes.map(node => [node.id, node]))
    const edgePairs = profile.edges.map(edge => `${edge.fromNodeId}->${edge.toNodeId}`)

    expect(nodesById.get('node:field:orders.created.value.customer')?.kind).toBe('message_field')
    expect(nodesById.get('node:field:orders.created.value.customer.customer_no')).toMatchObject({
      kind: 'message_field',
      label: 'value.customer.customer_no',
      dataType: 'string',
      coordinate: {
        kind: 'kafka_topic_bundle',
        path: 'orders.created.value.customer.customer_no',
        pointer: '/value/customer/customer_no',
      },
    })
    expect(edgePairs).toContain('node:topic:orders.created->node:field:orders.created.value.customer')
    expect(edgePairs).toContain('node:field:orders.created.value.customer->node:field:orders.created.value.customer.customer_no')
  })

  it('emits partition, key, header, schema, and field metrics from fixture evidence', () => {
    const fixture = readKafkaOrdersCreatedFixture()
    const profile = profileKafkaTopicFixture(fixture).profileArtifact
    if (!profile) throw new Error('expected Kafka profile artifact')

    expect(profile.nodes.map(node => node.id)).toEqual(expect.arrayContaining([
      'node:partition:orders.created.0',
      'node:key:orders.created',
      'node:header:orders.created.correlation_id',
      'node:schema-subject:orders.created-value',
    ]))
    expect(profile.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'metric:orders.created.key_coverage',
        kind: 'key_coverage_ratio',
        value: 0.998,
      }),
      expect.objectContaining({
        id: 'metric:orders.created.schema_version_count',
        kind: 'schema_version_count',
        value: 2,
      }),
      expect.objectContaining({
        id: 'metric:orders.created.message_rate_estimate',
        kind: 'message_rate_estimate',
        value: 42.5,
      }),
      expect.objectContaining({
        id: 'metric:orders.created.value.customer.customer_no.presence',
        kind: 'presence_ratio',
        value: 0.997,
      }),
      expect.objectContaining({
        id: 'metric:orders.created.value.order.promo_code.null',
        kind: 'null_ratio',
        value: 0.88,
      }),
    ]))
  })

  it('keeps relationship hints as profile suggestions, not approved registry entries', () => {
    const fixture = readKafkaOrdersCreatedFixture()
    const profile = profileKafkaTopicFixture(fixture).profileArtifact
    if (!profile) throw new Error('expected Kafka profile artifact')
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
