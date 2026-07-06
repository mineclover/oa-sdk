import {
  createDpmDryRunReport,
  type DpmCompiledPlan,
  type DpmDryRunReport,
} from '../../src/index.js'
import {
  STORAGE_REPORT_UNSAFE_CUSTOMER_NO,
} from './storage-report-unsafe-fixtures.js'

export function createStorageReportDryRunReport(
  plan: DpmCompiledPlan,
): DpmDryRunReport {
  return createDpmDryRunReport({
    plan,
    estimatedRows: {
      'public.customers': 2,
      'public.orders': 3,
    },
    sampleValues: {
      customer_no: STORAGE_REPORT_UNSAFE_CUSTOMER_NO,
    },
  })
}
