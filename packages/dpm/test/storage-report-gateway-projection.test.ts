import { describe, expect, it } from 'vitest'

import {
  createDpmReportRepository,
  type DpmStoredValidationReport,
} from '../src/index.js'
import {
  compileGatewayComponentSchema,
} from './support/gateway-schema.js'

describe('DPM validation report gateway projection', () => {
  it('retrieves the gateway-compatible job report shape from stored validation reports', async () => {
    const schema = compileGatewayComponentSchema('DpmJobReport')
    const storedReports = new Map<string, DpmStoredValidationReport>()
    const repository = createDpmReportRepository({
      upsertReport: async row => {
        storedReports.set(row.jobId, row)
      },
      getValidationReport: async request => storedReports.get(request.jobId),
    })
    await repository.saveReport({
      jobId: 'job_gateway_001',
      status: 'completed',
      validationReportRef: 'dpm-report:job_gateway_001',
      diagnostics: [],
      createdAt: '2026-07-01T00:00:04.000Z',
    })

    const jobReport = await repository.getJobReport({
      jobId: 'job_gateway_001',
    })

    expect(jobReport).toEqual({
      jobId: 'job_gateway_001',
      status: 'completed',
      validationReportRef: 'dpm-report:job_gateway_001',
      diagnostics: [],
    })
    expect(Object.keys(jobReport ?? {})).toEqual([
      'jobId',
      'status',
      'validationReportRef',
      'diagnostics',
    ])
    expect(schema(jobReport), JSON.stringify(schema.errors, null, 2)).toBe(true)
  })
})
