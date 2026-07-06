import {
  normalizeDpmProfileConnectorResult,
  type DpmProfileArtifact,
  type DpmProfileConnectorCapabilities,
  type DpmProfileConnectorEvidenceKind,
  type DpmProfileConnectorResult,
} from '../../src/index.js'
import { allEvidenceCapabilities } from './profile-connector-capabilities.js'

const COMPLETE_CONNECTOR_EVIDENCE_KINDS: DpmProfileConnectorEvidenceKind[] = [
  'source',
  'evidence_source',
  'node',
  'edge',
  'metric',
]

export function createPostgresProfileConnectorResult(
  profileArtifact: DpmProfileArtifact,
): DpmProfileConnectorResult {
  return normalizeDpmProfileConnectorResult({
    connectorId: 'dpm.postgres.catalog',
    connectorVersion: '0.1.0',
    sourceKind: 'postgresql_catalog',
    captureMode: 'read_only',
    status: 'completed',
    capabilities: allEvidenceCapabilities(
      'dpm.postgres.catalog',
      '0.1.0',
      'postgresql_catalog',
      'read_only',
    ),
    observedEvidenceKinds: COMPLETE_CONNECTOR_EVIDENCE_KINDS,
    diagnostics: [],
    profileArtifact,
  })
}

export function createKafkaProfileConnectorResult({
  profileArtifact,
  capabilities = allEvidenceCapabilities(
    'dpm.kafka.fixture',
    '0.1.0',
    'kafka_topic_bundle',
    'fixture',
  ),
  observedEvidenceKinds = COMPLETE_CONNECTOR_EVIDENCE_KINDS,
}: {
  profileArtifact: DpmProfileArtifact
  capabilities?: DpmProfileConnectorCapabilities
  observedEvidenceKinds?: DpmProfileConnectorEvidenceKind[]
}): DpmProfileConnectorResult {
  return normalizeDpmProfileConnectorResult({
    connectorId: 'dpm.kafka.fixture',
    connectorVersion: '0.1.0',
    sourceKind: 'kafka_topic_bundle',
    captureMode: 'fixture',
    status: 'completed',
    capabilities,
    observedEvidenceKinds,
    diagnostics: [],
    profileArtifact,
  })
}

export function createFailedKafkaProfileConnectorResult(): DpmProfileConnectorResult {
  return normalizeDpmProfileConnectorResult({
    connectorId: 'dpm.kafka.fixture',
    connectorVersion: '0.1.0',
    sourceKind: 'kafka_topic_bundle',
    captureMode: 'fixture',
    status: 'failed',
    capabilities: allEvidenceCapabilities(
      'dpm.kafka.fixture',
      '0.1.0',
      'kafka_topic_bundle',
      'fixture',
    ),
    observedEvidenceKinds: ['diagnostic'],
    diagnostics: [
      {
        severity: 'error',
        code: 'CONN500',
        message: 'Kafka topic fixture could not be loaded.',
        connectorId: 'dpm.kafka.fixture',
        coordinate: {
          kind: 'kafka_topic_bundle',
          path: 'orders.created',
        },
      },
    ],
  })
}
