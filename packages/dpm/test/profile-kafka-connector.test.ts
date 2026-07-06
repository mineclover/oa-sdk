import { describe, expect, it } from 'vitest'

import {
  DPM_PROFILE_ARTIFACT_KIND,
  DPM_PROFILE_CONNECTOR_RESULT_KIND,
  profileKafkaTopicFixture,
  validateDpmProfileArtifactSchema,
  validateDpmProfileConnectorResult,
} from '../src/index.js'
import {
  readKafkaOrdersCreatedFixture,
} from './support/profile-kafka-fixtures.js'

describe('DPM Kafka topic profile connector', () => {
  it('profiles Kafka fixture evidence without connecting to Kafka', () => {
    const fixture = readKafkaOrdersCreatedFixture()
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

  it('changes connector freshness when fixture field evidence changes', () => {
    const fixture = readKafkaOrdersCreatedFixture()
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
