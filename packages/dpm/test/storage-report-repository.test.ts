import { describe, expect, it, vi } from 'vitest'

import {
  compileDpmPlan,
  createDpmDryRunReport,
  createDpmReportRepository,
  type DpmStoredValidationReport,
} from '../src/index.js'
import {
  createStorageReportCompileInput,
} from './support/storage-report-fixtures.js'

describe('DPM validation report repository', () => {
  it('stores dry-run report summaries without raw sensitive samples', async () => {
    const compiled = compileDpmPlan(createStorageReportCompileInput())
    if (!compiled.ok) throw new Error('expected compile success')
    const dryRun = createDpmDryRunReport({
      plan: compiled.plan,
      estimatedRows: {
        'public.customers': 2,
        'public.orders': 3,
      },
      sampleValues: {
        customer_no: 'C-001',
      },
    })
    const upsertReport = vi.fn(async (_row: DpmStoredValidationReport) => undefined)
    const repository = createDpmReportRepository({
      upsertReport,
      getValidationReport: async () => undefined,
    })

    const report = await repository.saveReport({
      jobId: 'job_dry_run_001',
      status: 'completed',
      validationReportRef: 'dpm-report:job_dry_run_001',
      diagnostics: compiled.validation.diagnostics,
      planIdentity: compiled.plan.identity,
      freshness: compiled.plan.freshness,
      impact: dryRun.impact,
      categories: dryRun.categories,
      createdAt: '2026-07-01T00:00:02.000Z',
      rawSamples: {
        customer_no: 'C-001',
      },
      sourceCredentials: {
        password: 'source-secret',
      },
    } as any)

    expect(upsertReport).toHaveBeenCalledWith(report)
    expect(report).toMatchObject({
      kind: 'dpm.validation-report.v1',
      jobId: 'job_dry_run_001',
      status: 'completed',
      validationReportRef: 'dpm-report:job_dry_run_001',
      planIdentity: compiled.plan.identity,
      freshness: compiled.plan.freshness,
      impact: dryRun.impact,
      categories: dryRun.categories,
      diagnostics: compiled.validation.diagnostics,
    })
    expect(JSON.stringify(report)).not.toContain('C-001')
    expect(JSON.stringify(report)).not.toContain('source-secret')
  })

  it('preserves deterministic diagnostics for failed validation reports', async () => {
    const input = createStorageReportCompileInput()
    const manifest = structuredClone(input.manifest) as Record<string, any>
    manifest.columns[0].transform = { type: 'keep' }
    const compiled = compileDpmPlan({
      ...input,
      manifest,
    })
    if (compiled.ok) throw new Error('expected compile failure')

    const repository = createDpmReportRepository({
      upsertReport: async () => undefined,
      getValidationReport: async () => undefined,
    })

    const report = await repository.saveReport({
      jobId: 'job_failed_001',
      status: 'failed',
      diagnostics: compiled.diagnostics,
      createdAt: '2026-07-01T00:00:03.000Z',
    })

    expect(report.validationReportRef).toBe('dpm-report:job_failed_001')
    expect(report.diagnostics).toEqual(compiled.diagnostics)
    expect(report.diagnostics.map(diagnostic => diagnostic.code)).toContain('SAF001')
  })
})
