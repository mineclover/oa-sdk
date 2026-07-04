import { describe, expect, it } from 'vitest'

import {
  normalizeDpmProfileArtifact,
  normalizeDpmProfileConnectorResult,
  validateDpmProfileConnectorResult,
} from '../src/index.js'
import {
  allEvidenceCapabilities,
  createKafkaProfileArtifactInput,
} from './support/profile-connector-fixtures.js'

describe('DPM profile connector validation', () => {
  it('keeps connector failures as diagnostic payloads', () => {
    const result = normalizeDpmProfileConnectorResult({
      connectorId: 'dpm.kafka.fixture',
      connectorVersion: '0.1.0',
      sourceKind: 'kafka_topic_bundle',
      captureMode: 'fixture',
      status: 'failed',
      capabilities: allEvidenceCapabilities('dpm.kafka.fixture', '0.1.0', 'kafka_topic_bundle', 'fixture'),
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
    const missingDiagnostic = normalizeDpmProfileConnectorResult({
      ...result,
      status: 'failed',
      diagnostics: [],
    })

    expect(result.profileArtifact).toBeUndefined()
    expect(validateDpmProfileConnectorResult(result).valid).toBe(true)
    expect(validateDpmProfileConnectorResult(missingDiagnostic).diagnostics.map(diagnostic => diagnostic.code)).toContain('CONN105')
  })

  it('rejects observed evidence kinds outside connector capabilities', () => {
    const profileArtifact = normalizeDpmProfileArtifact(createKafkaProfileArtifactInput())
    const result = normalizeDpmProfileConnectorResult({
      connectorId: 'dpm.kafka.fixture',
      connectorVersion: '0.1.0',
      sourceKind: 'kafka_topic_bundle',
      captureMode: 'fixture',
      status: 'completed',
      capabilities: {
        connectorId: 'dpm.kafka.fixture',
        connectorVersion: '0.1.0',
        sourceKinds: ['kafka_topic_bundle'],
        captureModes: ['fixture'],
        supportedEvidenceKinds: ['source', 'node'],
        skippedEvidenceKinds: ['metric'],
      },
      observedEvidenceKinds: ['source', 'node', 'metric'],
      diagnostics: [],
      profileArtifact,
    })
    const validation = validateDpmProfileConnectorResult(result)

    expect(validation.valid).toBe(false)
    expect(validation.diagnostics.map(diagnostic => diagnostic.code)).toContain('CONN104')
  })
})
