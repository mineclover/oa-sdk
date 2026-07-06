import { describe, expect, it } from 'vitest'

import {
  createDpmProfileAnalysisReport,
} from '../src/index.js'
import {
  createKafkaProfileArtifact,
  createKafkaProfileArtifactWithCustomerNoPresence,
} from './support/profile-analysis-fixtures.js'

describe('DPM profile analysis drift', () => {
  it('reports drift signals when profile evidence changes', () => {
    const previousProfileArtifact = createKafkaProfileArtifact()
    const profileArtifact = createKafkaProfileArtifactWithCustomerNoPresence(0.91)
    const report = createDpmProfileAnalysisReport({
      profileArtifact,
      previousProfileArtifact,
    })

    expect(report.driftSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'profile_hash_changed',
        severity: 'warning',
      }),
      expect.objectContaining({
        kind: 'metric_value_changed',
        metricId: 'metric:orders.created.value.customer.customer_no.presence',
        previousValue: 0.997,
        currentValue: 0.91,
      }),
    ]))
    expect(report.summary.driftSignalCount).toBeGreaterThan(0)
  })
})
