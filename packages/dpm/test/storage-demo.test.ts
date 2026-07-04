import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import {
  POSTGRES_CATALOG_PROFILE_SQL,
  compileDpmPlan,
  createDpmDryRunReport,
  createDpmJobRepository,
  createDpmReportRepository,
  createDpmRegistryRepository,
  postgresCatalogRowsToSnapshot,
  profilePostgresCatalog,
  validateDpmManifest,
  type DpmJobRow,
  type DpmRegistryRelationshipRow,
  type DpmStoredValidationReport,
  type PostgresCatalogProfileRow,
} from '../src/index.js'

const demoRoot = new URL('../examples/customer-orders-storage/', import.meta.url)
const packageRoot = fileURLToPath(new URL('..', import.meta.url))

function readJsonFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(demoRoot.pathname, name), 'utf8')) as T
}

describe('DPM storage-backed customer orders demo', () => {
  it('ships a reproducible fixture-backed storage demo surface', () => {
    expect(existsSync(join(demoRoot.pathname, 'README.md'))).toBe(true)
    expect(existsSync(join(demoRoot.pathname, 'run-demo.mjs'))).toBe(true)
    expect(existsSync(join(demoRoot.pathname, 'manifest.json'))).toBe(true)
    expect(existsSync(join(demoRoot.pathname, 'catalog-profile-rows.json'))).toBe(true)
    expect(existsSync(join(demoRoot.pathname, 'relationship-registry-rows.json'))).toBe(true)
    expect(existsSync(join(demoRoot.pathname, 'estimated-rows.json'))).toBe(true)
  })

  it('runs the documented storage demo command after a single catalog profiling pass', () => {
    const source = readFileSync(join(demoRoot.pathname, 'run-demo.mjs'), 'utf8')
    const profileCalls = source.match(/\bprofilePostgresCatalog\s*\(/g) ?? []

    expect(profileCalls).toHaveLength(1)

    const result = spawnSync('corepack', ['pnpm', 'run', 'demo:storage'], {
      cwd: packageRoot,
      encoding: 'utf8',
    })
    const marker = '{\n  "demo": "dpm.customer-orders-storage"'
    const outputStart = result.stdout.indexOf(marker)
    const output = outputStart >= 0 ? JSON.parse(result.stdout.slice(outputStart)) : undefined

    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(output?.sourceDbMutation).toBe('none')
    expect(output?.persistedRawValues).toBe(false)
    expect(output?.steps.every((step: Record<string, unknown>) => step.status === 'pass')).toBe(true)
  })

  it('profiles catalog rows, exports registry rows, runs validate/compile/dry-run, and retrieves reports without raw values', async () => {
    const manifest = readJsonFixture<Record<string, any>>('manifest.json')
    const catalogRows = readJsonFixture<PostgresCatalogProfileRow[]>('catalog-profile-rows.json')
    const registryRows = readJsonFixture<DpmRegistryRelationshipRow[]>('relationship-registry-rows.json')
    const estimatedRows = readJsonFixture<Record<string, number>>('estimated-rows.json')
    const catalogQuery = vi.fn(async () => catalogRows)
    const jobRows = new Map<string, DpmJobRow>()
    const reportRows = new Map<string, DpmStoredValidationReport>()

    const catalog = await profilePostgresCatalog({
      database: 'commerce',
      capturedAt: '2026-07-01T00:00:00.000Z',
      schemas: ['public'],
      client: { query: catalogQuery },
    })
    const fixtureCatalog = postgresCatalogRowsToSnapshot({
      database: 'commerce',
      capturedAt: '2026-07-01T00:00:00.000Z',
      rows: catalogRows,
    })
    manifest.catalog.version_hash = catalog.freshness.versionHash

    const registry = await createDpmRegistryRepository({
      listRelationshipRows: async request =>
        registryRows.filter(row =>
          row.datasetId === request.datasetId && row.registryVersion === request.registryVersion,
        ),
    }).exportSnapshot({
      datasetId: manifest.relationship_registry.dataset_id,
      registryVersion: manifest.relationship_registry.registry_version,
      exportedAt: '2026-07-01T00:00:00.000Z',
    })
    const jobRepository = createDpmJobRepository({
      upsertJob: async row => {
        jobRows.set(row.jobId, row)
      },
      getJob: async request => jobRows.get(request.jobId),
    })
    const reportRepository = createDpmReportRepository({
      upsertReport: async row => {
        reportRows.set(row.jobId, row)
      },
      getValidationReport: async request => reportRows.get(request.jobId),
    })

    const validation = validateDpmManifest({ manifest, catalog, registry })
    const compiled = compileDpmPlan({ manifest, catalog, registry })
    if (!compiled.ok) throw new Error('expected storage demo compile success')
    const dryRun = createDpmDryRunReport({
      plan: compiled.plan,
      estimatedRows,
      sampleValues: {
        customer_no: 'C-001',
      },
    })
    const job = await jobRepository.saveJob({
      jobId: 'job_storage_demo_001',
      operation: 'dry_run',
      status: 'completed',
      datasetId: compiled.plan.datasetId,
      manifestId: compiled.plan.manifestId,
      planIdentity: compiled.plan.identity,
      freshness: compiled.plan.freshness,
      diagnostics: validation.diagnostics,
      validationReportRef: 'dpm-report:job_storage_demo_001',
      createdAt: '2026-07-01T00:00:00.000Z',
      completedAt: '2026-07-01T00:00:01.000Z',
    })
    const report = await reportRepository.saveReport({
      jobId: job.jobId,
      status: 'completed',
      validationReportRef: job.validationReportRef,
      diagnostics: validation.diagnostics,
      planIdentity: compiled.plan.identity,
      freshness: compiled.plan.freshness,
      impact: dryRun.impact,
      categories: dryRun.categories,
      createdAt: '2026-07-01T00:00:01.000Z',
      rawSamples: {
        customer_no: 'C-001',
      },
    } as any)
    const jobReport = await reportRepository.getJobReport({ jobId: job.jobId })

    expect(catalogQuery).toHaveBeenCalledWith(POSTGRES_CATALOG_PROFILE_SQL, [['public']])
    expect(catalog).toEqual(fixtureCatalog)
    expect(validation.summary).toEqual({ errors: 0, warnings: 0, infos: 0 })
    expect(registry.approvedRelationships.map(relationship => relationship.name)).toEqual(['rel_orders_customer'])
    expect(compiled.plan.stale).toBe(false)
    expect(dryRun.impact).toEqual({
      namespaces: 1,
      relationships: 1,
      columns: 2,
      piiColumns: 2,
      estimatedRows: 7000,
    })
    expect(jobRows.get(job.jobId)?.planIdentity).toBe(compiled.plan.identity)
    expect(reportRows.get(job.jobId)?.impact).toEqual(dryRun.impact)
    expect(jobReport).toEqual({
      jobId: 'job_storage_demo_001',
      status: 'completed',
      validationReportRef: 'dpm-report:job_storage_demo_001',
      diagnostics: report.diagnostics,
    })
    expect(JSON.stringify({ job, report, jobReport })).not.toContain('C-001')
    expect(JSON.stringify({ job, report, jobReport })).not.toContain('source-secret')
  })
})
