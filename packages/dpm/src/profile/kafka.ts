import { normalizeDpmProfileArtifact } from './artifact.js'
import { DPM_PROFILE_CONNECTOR_EVIDENCE_KINDS } from './connector-evidence-taxonomy.js'
import { normalizeDpmProfileConnectorResult } from './connector-result.js'
import type { DpmProfileConnectorResult } from './connector-types.js'
import type {
  DpmKafkaTopicProfileFixture,
} from './kafka-fixture-profile-types.js'
import { createKafkaTopicProfileArtifactInput } from './kafka-topic-profile.js'

export function profileKafkaTopicFixture(input: DpmKafkaTopicProfileFixture): DpmProfileConnectorResult {
  const connectorId = input.connectorId ?? 'dpm.kafka.fixture'
  const connectorVersion = input.connectorVersion ?? '0.1.0'
  const profileArtifactInput = createKafkaTopicProfileArtifactInput({
    input,
    connectorId,
    connectorVersion,
  })
  const profileArtifact = normalizeDpmProfileArtifact(profileArtifactInput)

  return normalizeDpmProfileConnectorResult({
    connectorId,
    connectorVersion,
    sourceKind: 'kafka_topic_bundle',
    captureMode: 'fixture',
    status: 'completed',
    capabilities: {
      connectorId,
      connectorVersion,
      sourceKinds: ['kafka_topic_bundle'],
      captureModes: ['fixture'],
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
