import type { DpmPlanFreshness } from '../compiler/plan.js'
import type { DpmDryRunCategory, DpmDryRunImpact } from '../dry-run/report.js'
import type { DpmDiagnostic } from '../validator/diagnostic-types.js'
import type { DpmValidationReportStatus } from './report-taxonomy-types.js'

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
