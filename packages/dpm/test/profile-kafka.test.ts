import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DPM_PROFILE_ARTIFACT_KIND,
  DPM_PROFILE_CONNECTOR_RESULT_KIND,
  profileKafkaTopicFixture,
  validateDpmProfileArtifactSchema,
  validateDpmProfileConnectorResult,
  type DpmKafkaTopicProfileFixture,
} from '../src/index.js'

const profileFixturesRoot = new URL('./fixtures/profile/', import.meta.url)

function readProfileFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(profileFixturesRoot.pathname, name), 'utf8')) as T
}

describe('DPM Kafka topic profile fixture adapter', () => {
  it('profiles Kafka fixture evidence without connecting to Kafka', () => {
    const fixture = readProfileFixture<DpmKafkaTopicProfileFixture>('kafka-orders-created.json')
    const result = profileKafkaTopicFixture(fixture)

    expect(result.kind).toBe(DPM_PROFILE_CONNECTOR_RESULT_KIND)
    expect(result.connectorId).toBe('dpm.kafka.fixture')
    expect(result.sourceKind).toBe('kafka_topic_bundle')
    expect(result.captureMode).toBe('fixture')
    expect(result.status).toBe('completed')
    expect(result.profileArtifact?.kind).toBe(DPM_PROFILE_ARTIFACT_KIND)
    expect(result.profileArtifact?.sources[0]).toMatchObject({
      id: 'source:kafka:orders.created',
      kind: 'kafka_topic_bundle',
      captureMode: 'fixture',
      refs: ['kafka://commerce/orders.created'],
    })
    expect(validateDpmConnector(result)).toBe(true)
    expect(validateDpmProfileArtifactSchema(result.profileArtifact).valid).toBe(true)
    expect(JSON.stringify(result)).not.toContain('rawSample')
  })

  it('flattens nested message fields into stable profile nodes and edges', () => {
    const fixture = readProfileFixture<DpmKafkaTopicProfileFixture>('kafka-orders-created.json')
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
    const fixture = readProfileFixture<DpmKafkaTopicProfileFixture>('kafka-orders-created.json')
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
    const fixture = readProfileFixture<DpmKafkaTopicProfileFixture>('kafka-orders-created.json')
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

  it('changes connector freshness when fixture field evidence changes', () => {
    const fixture = readProfileFixture<DpmKafkaTopicProfileFixture>('kafka-orders-created.json')
    const original = profileKafkaTopicFixture(fixture)
    const changed = profileKafkaTopicFixture({
      ...fixture,
      topic: {
        ...fixture.topic,
        value: {
          fields: fixture.topic.value.fields.map(field =>
            field.name === 'customer'
              ? {
                  ...field,
                  fields: field.fields?.map(child =>
                    child.name === 'customer_no'
                      ? { ...child, presenceRatio: 0.91 }
                      : child,
                  ),
                }
              : field,
          ),
        },
      },
    })

    expect(changed.profileArtifact?.freshness.versionHash).not.toBe(original.profileArtifact?.freshness.versionHash)
    expect(changed.freshness.runHash).not.toBe(original.freshness.runHash)
  })
})

function validateDpmConnector(result: ReturnType<typeof profileKafkaTopicFixture>): boolean {
  const validation = validateDpmProfileConnectorResult(result)
  expect(validation.diagnostics, JSON.stringify(validation.diagnostics, null, 2)).toEqual([])
  return validation.valid
}
