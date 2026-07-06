import { describe, expect, it } from 'vitest'

import {
  normalizeDpmProfileConnectorResult,
  validateDpmProfileConnectorResult,
} from '../src/index.js'
import { createFailedKafkaProfileConnectorResult } from './support/profile-connector-failed-result-fixtures.js'

describe('DPM profile connector validation — payload gates', () => {
  it('keeps connector failures as diagnostic payloads', () => {
    const result = createFailedKafkaProfileConnectorResult()
    const missingDiagnostic = normalizeDpmProfileConnectorResult({
      ...result,
      status: 'failed',
      diagnostics: [],
    })

    expect(result.profileArtifact).toBeUndefined()
    expect(validateDpmProfileConnectorResult(result).valid).toBe(true)
    expect(
      validateDpmProfileConnectorResult(missingDiagnostic).diagnostics.map(
        diagnostic => diagnostic.code,
      ),
    ).toContain('CONN105')
  })
})
