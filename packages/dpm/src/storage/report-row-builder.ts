import { copyValidationReportDiagnostics } from './report-row-diagnostics.js'
import {
  copyValidationReportCategory,
  copyValidationReportImpact,
} from './report-row-impact.js'
import { copyValidationReportFreshness } from './report-row-freshness.js'
import {
  DPM_VALIDATION_REPORT_KIND,
  type DpmStoredValidationReport,
  type DpmValidationReportSaveInput,
} from './report-repository-types.js'

export { copyValidationReportDiagnostics } from './report-row-diagnostics.js'

export function createDpmValidationReport(input: DpmValidationReportSaveInput): DpmStoredValidationReport {
  return {
    kind: DPM_VALIDATION_REPORT_KIND,
    jobId: input.jobId,
    status: input.status,
    validationReportRef: input.validationReportRef ?? `dpm-report:${input.jobId}`,
    diagnostics: copyValidationReportDiagnostics(input.diagnostics),
    ...(input.planIdentity ? { planIdentity: input.planIdentity } : {}),
    ...(input.freshness ? { freshness: copyValidationReportFreshness(input.freshness) } : {}),
    ...(input.impact ? { impact: copyValidationReportImpact(input.impact) } : {}),
    ...(input.categories ? { categories: input.categories.map(copyValidationReportCategory) } : {}),
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  }
}
