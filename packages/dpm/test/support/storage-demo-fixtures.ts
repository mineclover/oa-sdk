import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createDpmJobRepository,
  createDpmRegistryRepository,
  createDpmReportRepository,
  postgresCatalogRowsToSnapshot,
  type DpmDiagnostic,
  type DpmGatewayJobReport,
  type DpmJobRepository,
  type DpmJobRow,
  type DpmRegistryRelationshipRow,
  type DpmRegistryRepository,
  type DpmReportRepository,
  type DpmStoredValidationReport,
  type DpmValidationSummary,
  type PostgresCatalogProfileRow,
} from '../../src/index.js'

export const storageDemoRoot = fileURLToPath(new URL('../../examples/customer-orders-storage/', import.meta.url))
export const storageDemoPackageRoot = fileURLToPath(new URL('../..', import.meta.url))
export const storageDemoCommandTimeoutMs = 90_000
export const storageDemoDatabase = 'commerce' as const
export const storageDemoCapturedAt = '2026-07-01T00:00:00.000Z' as const
export const storageDemoCompletedAt = '2026-07-01T00:00:01.000Z' as const
export const storageDemoSchemas = ['public'] as const
export const storageDemoJobId = 'job_storage_demo_001' as const
export const storageDemoValidationReportRef = 'dpm-report:job_storage_demo_001' as const
export const storageDemoUnsafeCustomerNoSample = 'C-001' as const

export const expectedStorageDemoValidationSummary = {
  errors: 0,
  warnings: 0,
  infos: 0,
} as const satisfies DpmValidationSummary

export const expectedStorageDemoDryRunImpact = {
  namespaces: 1,
  relationships: 1,
  columns: 2,
  piiColumns: 2,
  estimatedRows: 7000,
} as const

export type StorageDemoPipelineFixtures = {
  manifest: Record<string, any>
  catalogRows: PostgresCatalogProfileRow[]
  registryRows: DpmRegistryRelationshipRow[]
  estimatedRows: Record<string, number>
}

export type StorageDemoPersistenceRepositories = {
  jobRows: Map<string, DpmJobRow>
  reportRows: Map<string, DpmStoredValidationReport>
  jobRepository: DpmJobRepository
  reportRepository: DpmReportRepository
}

export function readStorageDemoJsonFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(storageDemoRoot, name), 'utf8')) as T
}

export function readStorageDemoPipelineFixtures(): StorageDemoPipelineFixtures {
  return {
    manifest: readStorageDemoJsonFixture<Record<string, any>>('manifest.json'),
    catalogRows: readStorageDemoJsonFixture<PostgresCatalogProfileRow[]>('catalog-profile-rows.json'),
    registryRows: readStorageDemoJsonFixture<DpmRegistryRelationshipRow[]>(
      'relationship-registry-rows.json',
    ),
    estimatedRows: readStorageDemoJsonFixture<Record<string, number>>('estimated-rows.json'),
  }
}

export function createStorageDemoFixtureCatalog(catalogRows: PostgresCatalogProfileRow[]) {
  return postgresCatalogRowsToSnapshot({
    database: storageDemoDatabase,
    capturedAt: storageDemoCapturedAt,
    rows: catalogRows,
  })
}

export function createStorageDemoRegistryRepository(
  registryRows: DpmRegistryRelationshipRow[],
): DpmRegistryRepository {
  return createDpmRegistryRepository({
    listRelationshipRows: async request =>
      registryRows.filter(row =>
        row.datasetId === request.datasetId && row.registryVersion === request.registryVersion,
      ),
  })
}

export function createStorageDemoPersistenceRepositories(): StorageDemoPersistenceRepositories {
  const jobRows = new Map<string, DpmJobRow>()
  const reportRows = new Map<string, DpmStoredValidationReport>()

  return {
    jobRows,
    reportRows,
    jobRepository: createDpmJobRepository({
      upsertJob: async row => {
        jobRows.set(row.jobId, row)
      },
      getJob: async request => jobRows.get(request.jobId),
    }),
    reportRepository: createDpmReportRepository({
      upsertReport: async row => {
        reportRows.set(row.jobId, row)
      },
      getValidationReport: async request => reportRows.get(request.jobId),
    }),
  }
}

export function createExpectedStorageDemoJobReport(
  diagnostics: readonly DpmDiagnostic[],
): DpmGatewayJobReport {
  return {
    jobId: storageDemoJobId,
    status: 'completed',
    validationReportRef: storageDemoValidationReportRef,
    diagnostics: [...diagnostics],
  }
}
