import {
  createDpmJobRepository,
  createDpmRegistryRepository,
  createDpmReportRepository,
  postgresCatalogRowsToSnapshot,
  type DpmJobRepository,
  type DpmJobRow,
  type DpmRegistryRelationshipRow,
  type DpmRegistryRepository,
  type DpmReportRepository,
  type DpmStoredValidationReport,
  type PostgresCatalogProfileRow,
} from '../../src/index.js'
import {
  storageDemoCapturedAt,
  storageDemoDatabase,
} from './storage-demo-constant-fixtures.js'

export type StorageDemoPersistenceRepositories = {
  jobRows: Map<string, DpmJobRow>
  reportRows: Map<string, DpmStoredValidationReport>
  jobRepository: DpmJobRepository
  reportRepository: DpmReportRepository
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
