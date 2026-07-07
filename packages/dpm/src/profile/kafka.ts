import { normalizeDpmProfileArtifact } from './artifact.js'
import { DPM_PROFILE_CONNECTOR_EVIDENCE_KINDS } from './connector-evidence-taxonomy.js'
import { normalizeDpmProfileConnectorResult } from './connector-result.js'
import type { DpmProfileConnectorResult } from './connector-types.js'
import type {
  DpmKafkaTopicProfileFixture,
} from './kafka-fixture-profile-types.js'
import {
  DPM_KAFKA_TOPIC_PROFILE_CAPTURE_MODES,
  type DpmKafkaTopicProfileInput,
} from './kafka-topic-profile-input-types.js'
import { createKafkaTopicProfileArtifactInput } from './kafka-topic-profile.js'

export const DPM_KAFKA_TOPIC_PROFILE_CONNECTOR_ID = 'dpm.kafka.topic-profile' as const
export const DPM_KAFKA_TOPIC_PROFILE_CONNECTOR_VERSION = '0.1.0' as const
export const DPM_KAFKA_TOPIC_FIXTURE_CONNECTOR_ID = 'dpm.kafka.fixture' as const

export function profileKafkaTopic(input: DpmKafkaTopicProfileInput): DpmProfileConnectorResult {
  const connectorId = input.connectorId ?? DPM_KAFKA_TOPIC_PROFILE_CONNECTOR_ID
  const connectorVersion = input.connectorVersion ?? DPM_KAFKA_TOPIC_PROFILE_CONNECTOR_VERSION
  const captureMode = input.captureMode ?? 'snapshot'
  const profileArtifactInput = createKafkaTopicProfileArtifactInput({
    input,
    connectorId,
    connectorVersion,
    captureMode,
  })
  const profileArtifact = normalizeDpmProfileArtifact(profileArtifactInput)

  return normalizeDpmProfileConnectorResult({
    connectorId,
    connectorVersion,
    sourceKind: 'kafka_topic_bundle',
    captureMode,
    status: 'completed',
    capabilities: {
      connectorId,
      connectorVersion,
      sourceKinds: ['kafka_topic_bundle'],
      captureModes: [...DPM_KAFKA_TOPIC_PROFILE_CAPTURE_MODES],
      supportedEvidenceKinds: [...DPM_PROFILE_CONNECTOR_EVIDENCE_KINDS],
      skippedEvidenceKinds: [],
    },
    observedEvidenceKinds: [
      'source',
      'evidence_source',
      'node',
      'edge',
      'metric',
      ...(profileArtifact.diagnostics.length > 0 ? ['diagnostic' as const] : []),
    ],
    diagnostics: [],
    profileArtifact,
  })
}

export function profileKafkaTopicFixture(input: DpmKafkaTopicProfileFixture): DpmProfileConnectorResult {
  return profileKafkaTopic({
    ...input,
    connectorId: input.connectorId ?? DPM_KAFKA_TOPIC_FIXTURE_CONNECTOR_ID,
    connectorVersion: input.connectorVersion ?? DPM_KAFKA_TOPIC_PROFILE_CONNECTOR_VERSION,
    captureMode: 'fixture',
  })
}
