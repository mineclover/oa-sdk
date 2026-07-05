import type { DpmPlanFreshness } from '../compiler/plan.js'
import type { DpmDryRunCategory, DpmDryRunImpact } from '../dry-run/report.js'
import type { DpmDiagnostic } from '../validator/diagnostics.js'

export const DPM_VALIDATION_REPORT_KIND = 'dpm.validation-report.v1' as const

export type DpmValidationReportStatus = 'completed' | 'failed'

export type DpmValidationReportRequest = {
  jobId: string
}

export type DpmValidationReportSaveInput = {
  jobId: string
  status: DpmValidationReportStatus
  validationReportRef?: string
  diagnostics: readonly DpmDiagnostic[]
  planIdentity?: string
  freshness?: DpmPlanFreshness
  impact?: DpmDryRunImpact
  categories?: readonly DpmDryRunCategory[]
  createdAt?: string
}

export type DpmStoredValidationReport = {
  kind: typeof DPM_VALIDATION_REPORT_KIND
  jobId: string
  status: DpmValidationReportStatus
  validationReportRef: string
  diagnostics: DpmDiagnostic[]
  planIdentity?: string
  freshness?: DpmPlanFreshness
  impact?: DpmDryRunImpact
  categories?: DpmDryRunCategory[]
  createdAt?: string
}

export type DpmGatewayJobReport = {
  jobId: string
  status: DpmValidationReportStatus
  validationReportRef: string
  diagnostics: DpmDiagnostic[]
}

export type DpmValidationReportStorage = {
  upsertReport(row: DpmStoredValidationReport): Promise<void> | void
  getValidationReport(
    request: DpmValidationReportRequest,
  ): Promise<DpmStoredValidationReport | undefined> | DpmStoredValidationReport | undefined
}

export type DpmReportRepository = {
  saveReport(input: DpmValidationReportSaveInput): Promise<DpmStoredValidationReport>
  getJobReport(request: DpmValidationReportRequest): Promise<DpmGatewayJobReport | undefined>
}
