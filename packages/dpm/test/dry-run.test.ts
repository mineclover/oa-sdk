import { describe, expect, it } from 'vitest'

import {
  DPM_DRY_RUN_EXPECTED_CATEGORY_NAMES,
  DPM_DRY_RUN_EXPECTED_IMPACT,
  DPM_DRY_RUN_UNSAFE_SAMPLE_VALUE,
  createCompiledDryRunFixturePlan,
  createDryRunReportForPlan,
} from './support/dry-run-fixtures.js'

describe('DPM dry-run report', () => {
  it('reports impact counts and categories without preserving raw sensitive values', () => {
    const report = createDryRunReportForPlan(createCompiledDryRunFixturePlan())

    expect(report.kind).toBe('dpm.dry-run-report.v1')
    expect(report.impact).toEqual(DPM_DRY_RUN_EXPECTED_IMPACT)
    expect(report.categories.map(category => category.name))
      .toEqual(DPM_DRY_RUN_EXPECTED_CATEGORY_NAMES)
    expect(JSON.stringify(report)).not.toContain(DPM_DRY_RUN_UNSAFE_SAMPLE_VALUE)
  })
})
