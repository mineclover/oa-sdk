import type { DpmPlanFreshness } from '../compiler/plan.js'
import type { DpmDiagnostic } from '../validator/diagnostic-types.js'

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
