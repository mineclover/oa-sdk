import { describe, expect, it } from 'vitest'

import { compileGatewayComponentSchema } from './support/gateway-schema.js'

describe('DPM gateway job response schemas', () => {
  it('rejects job report statuses outside the persisted validation report lifecycle', () => {
    const schema = compileGatewayComponentSchema('DpmJobReport')

    expect(schema({
      jobId: 'job_001',
      status: 'accepted',
      validationReportRef: 'dpm-report:job_001',
      diagnostics: [],
    }), 'DpmJobReport unexpectedly accepted a pre-report job status').toBe(false)
    expect(schema({
      jobId: 'job_001',
      status: 'failed',
      validationReportRef: 'dpm-report:job_001',
      diagnostics: [],
    }), JSON.stringify(schema.errors, null, 2)).toBe(true)
  })
})
