import type { DpmPlanFreshness } from '../compiler/plan.js'
import {
  createDpmDiagnostic,
  type DpmDiagnostic,
} from '../validator/diagnostics.js'

export const DPM_JOB_KIND = 'dpm.job.v1' as const

export type DpmJobOperation = 'compile' | 'dry_run'
export type DpmJobStatus = 'accepted' | 'completed' | 'failed'

export type DpmJobRequest = {
  jobId: string
}

export type DpmJobSaveInput = {
  jobId: string
  operation: DpmJobOperation
  status: DpmJobStatus
  datasetId: string
  manifestId: string
  planIdentity?: string
  freshness?: DpmPlanFreshness
  diagnostics?: readonly DpmDiagnostic[]
  validationReportRef?: string
  createdAt?: string
  completedAt?: string
}

export type DpmJobRow = {
  kind: typeof DPM_JOB_KIND
  jobId: string
  operation: DpmJobOperation
  status: DpmJobStatus
  datasetId: string
  manifestId: string
  planIdentity?: string
  freshness?: DpmPlanFreshness
  diagnostics: DpmDiagnostic[]
  validationReportRef?: string
  createdAt?: string
  completedAt?: string
}

export type DpmJobStorage = {
  upsertJob(row: DpmJobRow): Promise<void> | void
  getJob(request: DpmJobRequest): Promise<DpmJobRow | undefined> | DpmJobRow | undefined
}

export type DpmJobRepository = {
  saveJob(input: DpmJobSaveInput): Promise<DpmJobRow>
  getJob(request: DpmJobRequest): Promise<DpmJobRow | undefined>
}

export function createDpmJobRepository(storage: DpmJobStorage): DpmJobRepository {
  return {
    async saveJob(input) {
      const row = createDpmJobRow(input)
      await storage.upsertJob(row)
      return row
    },
    async getJob(request) {
      const row = await storage.getJob(request)
      return row ? createDpmJobRow(row) : undefined
    },
  }
}

export function createDpmJobRow(input: DpmJobSaveInput): DpmJobRow {
  return {
    kind: DPM_JOB_KIND,
    jobId: input.jobId,
    operation: input.operation,
    status: input.status,
    datasetId: input.datasetId,
    manifestId: input.manifestId,
    ...(input.planIdentity ? { planIdentity: input.planIdentity } : {}),
    ...(input.freshness ? { freshness: copyFreshness(input.freshness) } : {}),
    diagnostics: copyDiagnostics(input.diagnostics ?? []),
    ...(input.validationReportRef ? { validationReportRef: input.validationReportRef } : {}),
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    ...(input.completedAt ? { completedAt: input.completedAt } : {}),
  }
}

function copyDiagnostics(diagnostics: readonly DpmDiagnostic[]): DpmDiagnostic[] {
  return diagnostics.map(diagnostic => createDpmDiagnostic(diagnostic))
}

function copyFreshness(freshness: DpmPlanFreshness): DpmPlanFreshness {
  return {
    ...(freshness.manifestCatalogVersionHash ? {
      manifestCatalogVersionHash: freshness.manifestCatalogVersionHash,
    } : {}),
    catalogVersionHash: freshness.catalogVersionHash,
    registryVersion: freshness.registryVersion,
    registryIdentity: freshness.registryIdentity,
  }
}
