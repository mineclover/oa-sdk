import type { DpmDiagnostic } from '../validator/diagnostic-types.js'
import type { DpmValidationReportStatus } from './report-taxonomy-types.js'

export type DpmGatewayJobReport = {
  jobId: string
  status: DpmValidationReportStatus
  validationReportRef: string
  diagnostics: DpmDiagnostic[]
}
