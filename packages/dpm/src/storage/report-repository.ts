import { validationReportToGatewayJobReport } from './report-gateway-projection.js'
import type {
  DpmReportRepository,
  DpmValidationReportStorage,
} from './report-repository-contract-types.js'
import { createDpmValidationReport } from './report-row-builder.js'

export {
  DPM_VALIDATION_REPORT_KIND,
} from './report-taxonomy-types.js'
export type {
  DpmValidationReportStatus,
} from './report-taxonomy-types.js'
export type { DpmGatewayJobReport } from './report-gateway-types.js'
export type {
  DpmReportRepository,
  DpmValidationReportStorage,
} from './report-repository-contract-types.js'
export type {
  DpmValidationReportRequest,
  DpmValidationReportSaveInput,
} from './report-request-types.js'
export type {
  DpmStoredValidationReport,
} from './report-row-types.js'
export { validationReportToGatewayJobReport } from './report-gateway-projection.js'
export { createDpmValidationReport } from './report-row-builder.js'

export function createDpmReportRepository(storage: DpmValidationReportStorage): DpmReportRepository {
  return {
    async saveReport(input) {
      const row = createDpmValidationReport(input)
      await storage.upsertReport(row)
      return row
    },
    async getJobReport(request) {
      const row = await storage.getValidationReport(request)
      return row ? validationReportToGatewayJobReport(request, row) : undefined
    },
  }
}
