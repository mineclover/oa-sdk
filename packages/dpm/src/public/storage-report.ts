export type {
  DpmGatewayJobReport,
  DpmReportRepository,
  DpmStoredValidationReport,
  DpmValidationReportRequest,
  DpmValidationReportSaveInput,
  DpmValidationReportStatus,
  DpmValidationReportStorage,
} from '../storage/report-repository.js'
export {
  DPM_VALIDATION_REPORT_KIND,
  createDpmReportRepository,
  createDpmValidationReport,
  validationReportToGatewayJobReport,
} from '../storage/report-repository.js'
