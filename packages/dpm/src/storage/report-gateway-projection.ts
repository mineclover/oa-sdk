import {
  copyValidationReportDiagnostics,
} from './report-row-builder.js'
import type {
  DpmGatewayJobReport,
  DpmStoredValidationReport,
  DpmValidationReportRequest,
} from './report-repository-types.js'

export function validationReportToGatewayJobReport(
  request: DpmValidationReportRequest,
  row: DpmStoredValidationReport,
): DpmGatewayJobReport {
  if (row.jobId !== request.jobId) {
    throw new Error(`Validation report row ${row.jobId} does not match requested job ${request.jobId}`)
  }

  return {
    jobId: row.jobId,
    status: row.status,
    validationReportRef: row.validationReportRef,
    diagnostics: copyValidationReportDiagnostics(row.diagnostics),
  }
}
