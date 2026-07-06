import { describe, expect, it, vi } from 'vitest'

import {
  POSTGRES_CATALOG_PROFILE_SQL,
  compileDpmPlan,
  createDpmDryRunReport,
  profilePostgresCatalog,
  validateDpmManifest,
} from '../src/index.js'
import {
  createExpectedStorageDemoJobReport,
  createStorageDemoFixtureCatalog,
  createStorageDemoPersistenceRepositories,
  createStorageDemoRegistryRepository,
  expectedStorageDemoDryRunImpact,
  expectedStorageDemoValidationSummary,
  readStorageDemoPipelineFixtures,
  storageDemoCapturedAt,
  storageDemoCompletedAt,
  storageDemoDatabase,
  storageDemoJobId,
  storageDemoSchemas,
  storageDemoUnsafeCustomerNoSample,
  storageDemoValidationReportRef,
} from './support/storage-demo-fixtures.js'
import {
  expectedStorageRegistryApprovedRelationshipNames,
} from './support/storage-registry-fixtures.js'
import { expectStorageReportPayloadExcludesUnsafeFragments } from './support/storage-report-fixtures.js'

describe('DPM storage-backed customer orders demo pipeline', () => {
  it('profiles catalog rows, exports registry rows, runs validate/compile/dry-run, and retrieves reports without raw values', async () => {
    const { manifest, catalogRows, registryRows, estimatedRows } = readStorageDemoPipelineFixtures()
    const catalogQuery = vi.fn(async () => catalogRows)
    const { jobRows, reportRows, jobRepository, reportRepository } =
      createStorageDemoPersistenceRepositories()

    const catalog = await profilePostgresCatalog({
      database: storageDemoDatabase,
      capturedAt: storageDemoCapturedAt,
      schemas: [...storageDemoSchemas],
      client: { query: catalogQuery },
    })
    const fixtureCatalog = createStorageDemoFixtureCatalog(catalogRows)
    manifest.catalog.version_hash = catalog.freshness.versionHash

    const registry = await createStorageDemoRegistryRepository(registryRows).exportSnapshot({
      datasetId: manifest.relationship_registry.dataset_id,
      registryVersion: manifest.relationship_registry.registry_version,
      exportedAt: storageDemoCapturedAt,
    })

    const validation = validateDpmManifest({ manifest, catalog, registry })
    const compiled = compileDpmPlan({ manifest, catalog, registry })
    if (!compiled.ok) throw new Error('expected storage demo compile success')
    const dryRun = createDpmDryRunReport({
      plan: compiled.plan,
      estimatedRows,
      sampleValues: {
        customer_no: storageDemoUnsafeCustomerNoSample,
      },
    })
    const job = await jobRepository.saveJob({
      jobId: storageDemoJobId,
      operation: 'dry_run',
      status: 'completed',
      datasetId: compiled.plan.datasetId,
      manifestId: compiled.plan.manifestId,
      planIdentity: compiled.plan.identity,
      freshness: compiled.plan.freshness,
      diagnostics: validation.diagnostics,
      validationReportRef: storageDemoValidationReportRef,
      createdAt: storageDemoCapturedAt,
      completedAt: storageDemoCompletedAt,
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
      createdAt: storageDemoCompletedAt,
      rawSamples: {
        customer_no: storageDemoUnsafeCustomerNoSample,
      },
    } as any)
    const jobReport = await reportRepository.getJobReport({ jobId: job.jobId })

    expect(catalogQuery).toHaveBeenCalledWith(POSTGRES_CATALOG_PROFILE_SQL, [[...storageDemoSchemas]])
    expect(catalog).toEqual(fixtureCatalog)
    expect(validation.summary).toEqual(expectedStorageDemoValidationSummary)
    expect(registry.approvedRelationships.map(relationship => relationship.name)).toEqual([
      ...expectedStorageRegistryApprovedRelationshipNames,
    ])
    expect(compiled.plan.stale).toBe(false)
    expect(dryRun.impact).toEqual(expectedStorageDemoDryRunImpact)
    expect(jobRows.get(job.jobId)?.planIdentity).toBe(compiled.plan.identity)
    expect(reportRows.get(job.jobId)?.impact).toEqual(dryRun.impact)
    expect(jobReport).toEqual(createExpectedStorageDemoJobReport(report.diagnostics))
    expectStorageReportPayloadExcludesUnsafeFragments({ job, report, jobReport })
  })
})
