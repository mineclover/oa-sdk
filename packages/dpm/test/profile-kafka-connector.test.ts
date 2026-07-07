import { describe, expect, it } from 'vitest'

import {
  DPM_KAFKA_TOPIC_PROFILE_CAPTURE_MODES,
  DPM_KAFKA_TOPIC_PROFILE_CONNECTOR_ID,
  DPM_PROFILE_ARTIFACT_KIND,
  DPM_PROFILE_CONNECTOR_RESULT_KIND,
  profileKafkaTopic,
  profileKafkaTopicFixture,
  validateDpmProfileArtifactSchema,
  validateDpmProfileConnectorResult,
} from '../src/index.js'
import {
  readKafkaOrdersCreatedFixture,
} from './support/profile-kafka-fixtures.js'

describe('DPM Kafka topic profile connector', () => {
  it('profiles captured Kafka topic bundles through the product connector contract', () => {
    const fixture = readKafkaOrdersCreatedFixture()
    const result = profileKafkaTopic({
      ...fixture,
      connectorId: undefined,
      connectorVersion: undefined,
    })

    expect(result.kind).toBe(DPM_PROFILE_CONNECTOR_RESULT_KIND)
    expect(result.connectorId).toBe(DPM_KAFKA_TOPIC_PROFILE_CONNECTOR_ID)
    expect(result.sourceKind).toBe('kafka_topic_bundle')
    expect(result.captureMode).toBe('snapshot')
    expect(result.capabilities.captureModes).toEqual([...DPM_KAFKA_TOPIC_PROFILE_CAPTURE_MODES].sort())
    expect(result.profileArtifact?.kind).toBe(DPM_PROFILE_ARTIFACT_KIND)
    expect(result.profileArtifact?.sources[0]).toMatchObject({
      id: 'source:kafka:orders.created',
      connectorId: DPM_KAFKA_TOPIC_PROFILE_CONNECTOR_ID,
      kind: 'kafka_topic_bundle',
      captureMode: 'snapshot',
      refs: ['kafka://commerce/orders.created'],
    })
    expect(validateDpmConnector(result)).toBe(true)
    expect(validateDpmProfileArtifactSchema(result.profileArtifact).valid).toBe(true)
    expect(JSON.stringify(result)).not.toContain('rawSample')
  })

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
})

function validateDpmConnector(result: ReturnType<typeof profileKafkaTopicFixture>): boolean {
  const validation = validateDpmProfileConnectorResult(result)
  expect(validation.diagnostics, JSON.stringify(validation.diagnostics, null, 2)).toEqual([])
  return validation.valid
}
