import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it, vi } from 'vitest'

import {
  compileDpmPlan,
  createDpmDryRunReport,
  createDpmJobRepository,
  createDpmReportRepository,
  createPostgresCatalogSnapshot,
  getDpmGatewayOpenApiDocument,
  parseRegistrySnapshotYaml,
  type DpmCompileInput,
  type DpmJobRow,
  type DpmStoredValidationReport,
  type PostgresCatalogSnapshotInput,
} from '../src/index.js'

const fixturesRoot = new URL('./fixtures/', import.meta.url)

function readJsonFixture<T>(path: string): T {
  return JSON.parse(readFileSync(join(fixturesRoot.pathname, path), 'utf8')) as T
}

function readTextFixture(path: string): string {
  return readFileSync(join(fixturesRoot.pathname, path), 'utf8')
}

function compileGatewayComponentSchema(name: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  ajv.addSchema(getDpmGatewayOpenApiDocument(), 'dpm-gateway')
  return ajv.compile({ $ref: `dpm-gateway#/components/schemas/${name}` })
}

function createCompileInput(): DpmCompileInput {
  const catalog = createPostgresCatalogSnapshot(
    readJsonFixture<PostgresCatalogSnapshotInput>('catalog/postgres-commerce.json'),
  )
  const manifest = readJsonFixture<Record<string, any>>('valid/customer-orders.json')
  manifest.catalog.version_hash = catalog.freshness.versionHash

  return {
    manifest,
    catalog,
    registry: parseRegistrySnapshotYaml(readTextFixture('registry/commerce-registry.yaml')),
  }
}

describe('DPM job and validation report persistence', () => {
  it('persists compile job metadata, diagnostics, freshness, and report references without unsafe payloads', async () => {
    const compiled = compileDpmPlan(createCompileInput())
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

  it('stores dry-run report summaries without raw sensitive samples', async () => {
    const compiled = compileDpmPlan(createCompileInput())
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
    const input = createCompileInput()
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
