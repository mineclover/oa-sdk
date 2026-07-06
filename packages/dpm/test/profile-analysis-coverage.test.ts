import { describe, expect, it } from 'vitest'

import {
  createDpmProfileAnalysisReport,
} from '../src/index.js'
import {
  createKafkaProfileArtifact,
} from './support/profile-analysis-fixtures.js'

describe('DPM profile analysis coverage', () => {
  it('reports coverage counts for graph nodes and measured metrics', () => {
    const report = createDpmProfileAnalysisReport({
      profileArtifact: createKafkaProfileArtifact(),
    })

    expect(report.coverage.nodeKindCounts.message_field).toBeGreaterThanOrEqual(5)
    expect(report.coverage.metricKindCounts.presence_ratio).toBeGreaterThanOrEqual(4)
    expect(report.coverage.measuredNodeRatio).toBeGreaterThan(0)
  })
})
