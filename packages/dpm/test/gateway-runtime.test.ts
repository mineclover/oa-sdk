import { describe, expect, it } from 'vitest'

import {
  DPM_GATEWAY_RUNTIME_OPERATION_IDS,
  DPM_PROFILE_PROPOSAL_REVIEW_STATUSES,
} from '../src/index.js'

describe('DPM gateway runtime adapter', () => {
  it('exposes only local profile and manifest runtime operations', () => {
    expect(DPM_GATEWAY_RUNTIME_OPERATION_IDS).toEqual([
      'inspectDpmProfile',
      'analyzeDpmProfile',
      'reviewDpmProfileProposal',
      'validateDpmManifest',
      'compileDpmManifest',
      'dryRunDpmManifest',
    ])
    expect(DPM_PROFILE_PROPOSAL_REVIEW_STATUSES).toEqual(['accepted', 'rejected', 'needs_changes'])
    expect(DPM_GATEWAY_RUNTIME_OPERATION_IDS).not.toContain('executeDpmJob')
    expect(DPM_GATEWAY_RUNTIME_OPERATION_IDS).not.toContain('getDpmValidationReport')
  })
})
