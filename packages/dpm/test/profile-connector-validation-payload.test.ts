import { describe, expect, it } from 'vitest'

import {
  normalizeDpmProfileConnectorResult,
  validateDpmProfileConnectorResult,
} from '../src/index.js'
import {
  allEvidenceCapabilities,
} from './support/profile-connector-fixtures.js'

describe('DPM profile connector validation — payload gates', () => {
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
})
