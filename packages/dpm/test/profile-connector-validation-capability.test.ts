import { describe, expect, it } from 'vitest'

import {
  normalizeDpmProfileArtifact,
  normalizeDpmProfileConnectorResult,
  validateDpmProfileConnectorResult,
} from '../src/index.js'
import { createKafkaProfileArtifactInput } from './support/profile-connector-kafka-artifact-inputs.js'

describe('DPM profile connector validation — capability gates', () => {
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
