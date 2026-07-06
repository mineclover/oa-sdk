import { describe, expect, it, vi } from 'vitest'

import {
  compileDpmPlan,
  createDpmJobRepository,
  type DpmJobRow,
} from '../src/index.js'
import {
  createStorageReportCompileInput,
} from './support/storage-report-fixtures.js'

describe('DPM job repository', () => {
  it('persists compile job metadata, diagnostics, freshness, and report references without unsafe payloads', async () => {
    const compiled = compileDpmPlan(createStorageReportCompileInput())
    if (!compiled.ok) throw new Error('expected compile success')

    const upsertJob = vi.fn(async (_row: DpmJobRow) => undefined)
    const repository = createDpmJobRepository({
      upsertJob,
      getJob: async () => undefined,
    })

    const row = await repository.saveJob({
      jobId: 'job_compile_001',
      operation: 'compile',
      status: 'completed',
      datasetId: compiled.plan.datasetId,
      manifestId: compiled.plan.manifestId,
      planIdentity: compiled.plan.identity,
      freshness: compiled.plan.freshness,
      diagnostics: compiled.validation.diagnostics,
      validationReportRef: 'dpm-report:job_compile_001',
      createdAt: '2026-07-01T00:00:00.000Z',
      completedAt: '2026-07-01T00:00:01.000Z',
      sourceDbPassword: 'source-secret',
      vaultMaterial: 'vault-secret',
      tokenReverseLookup: { tok_001: 'C-001' },
      rawSamples: { customer_no: 'C-001' },
    } as any)

    expect(upsertJob).toHaveBeenCalledWith(row)
    expect(row).toMatchObject({
      kind: 'dpm.job.v1',
      jobId: 'job_compile_001',
      operation: 'compile',
      status: 'completed',
      datasetId: 'commerce_ai',
      manifestId: compiled.plan.manifestId,
      planIdentity: compiled.plan.identity,
      validationReportRef: 'dpm-report:job_compile_001',
      freshness: compiled.plan.freshness,
      diagnostics: compiled.validation.diagnostics,
    })
    expect(JSON.stringify(row)).not.toContain('source-secret')
    expect(JSON.stringify(row)).not.toContain('vault-secret')
    expect(JSON.stringify(row)).not.toContain('tok_001')
    expect(JSON.stringify(row)).not.toContain('C-001')
  })
})
