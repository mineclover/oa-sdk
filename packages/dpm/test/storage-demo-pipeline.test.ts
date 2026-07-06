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
import { readStorageDemoJsonFixture } from './support/storage-demo-fixtures.js'
import {
  expectedStorageRegistryApprovedRelationshipNames,
} from './support/storage-registry-fixtures.js'
import { expectStorageReportPayloadExcludesUnsafeFragments } from './support/storage-report-fixtures.js'

describe('DPM storage-backed customer orders demo pipeline', () => {
  it('profiles catalog rows, exports registry rows, runs validate/compile/dry-run, and retrieves reports without raw values', async () => {
    const manifest = readStorageDemoJsonFixture<Record<string, any>>('manifest.json')
    const catalogRows = readStorageDemoJsonFixture<PostgresCatalogProfileRow[]>('catalog-profile-rows.json')
    const registryRows = readStorageDemoJsonFixture<DpmRegistryRelationshipRow[]>('relationship-registry-rows.json')
    const estimatedRows = readStorageDemoJsonFixture<Record<string, number>>('estimated-rows.json')
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
    expect(registry.approvedRelationships.map(relationship => relationship.name)).toEqual([
      ...expectedStorageRegistryApprovedRelationshipNames,
    ])
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
    expectStorageReportPayloadExcludesUnsafeFragments({ job, report, jobReport })
  })
})
