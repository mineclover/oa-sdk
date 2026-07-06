export const expectedGatewayJobReport = {
  jobId: 'job_gateway_001',
  status: 'completed',
  validationReportRef: 'dpm-report:job_gateway_001',
  diagnostics: [],
} as const

export const expectedGatewayJobReportKeys = [
  'jobId',
  'status',
  'validationReportRef',
  'diagnostics',
] as const

export {
  createStorageReportCompileInput,
} from './storage-report-compile-fixtures.js'
export {
  createCompletedStorageJobInput,
} from './storage-report-job-persistence-fixtures.js'
export {
  createCompletedStorageValidationReportInput,
} from './storage-report-validation-persistence-fixtures.js'
export {
  createStorageReportDryRunReport,
} from './storage-report-dry-run-fixtures.js'
export {
  STORAGE_REPORT_UNSAFE_CUSTOMER_NO,
  STORAGE_REPORT_UNSAFE_PAYLOAD_FRAGMENTS,
  STORAGE_REPORT_UNSAFE_SOURCE_PASSWORD,
  STORAGE_REPORT_UNSAFE_TOKEN_LOOKUP_KEY,
  STORAGE_REPORT_UNSAFE_VAULT_MATERIAL,
} from './storage-report-unsafe-fixtures.js'
export {
  expectStorageReportPayloadExcludesUnsafeFragments,
} from './storage-report-assertions.js'
export type {
  StorageReportUnsafeJobInput,
  StorageReportUnsafeValidationReportInput,
} from './storage-report-unsafe-fixtures.js'
