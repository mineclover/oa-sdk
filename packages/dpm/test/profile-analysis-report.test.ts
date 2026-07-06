import { describe, expect, it } from 'vitest'

import {
  DPM_PROFILE_ANALYSIS_REPORT_KIND,
  createDpmProfileAnalysisReport,
} from '../src/index.js'
import {
  createKafkaProfileArtifact,
} from './support/profile-analysis-fixtures.js'

describe('DPM profile analysis report', () => {
  it('creates deterministic analysis reports for identical profile artifacts', () => {
    const profile = createKafkaProfileArtifact()
    const first = createDpmProfileAnalysisReport({ profileArtifact: profile })
    const second = createDpmProfileAnalysisReport({ profileArtifact: profile })

    expect(first.kind).toBe(DPM_PROFILE_ANALYSIS_REPORT_KIND)
    expect(first.freshness.reportHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(second.freshness.reportHash).toBe(first.freshness.reportHash)
    expect(second.summary).toEqual(first.summary)
  })
})
