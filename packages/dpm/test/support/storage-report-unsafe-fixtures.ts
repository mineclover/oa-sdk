import type {
  DpmJobSaveInput,
  DpmValidationReportSaveInput,
} from '../../src/index.js'

export const STORAGE_REPORT_UNSAFE_CUSTOMER_NO = 'C-001'
export const STORAGE_REPORT_UNSAFE_SOURCE_PASSWORD = 'source-secret'
export const STORAGE_REPORT_UNSAFE_TOKEN_LOOKUP_KEY = 'tok_001'
export const STORAGE_REPORT_UNSAFE_VAULT_MATERIAL = 'vault-secret'

export type StorageReportUnsafeJobInput = DpmJobSaveInput & {
  sourceDbPassword: string
  vaultMaterial: string
  tokenReverseLookup: Record<string, string>
  rawSamples: Record<string, unknown>
}

export type StorageReportUnsafeValidationReportInput = DpmValidationReportSaveInput & {
  rawSamples: Record<string, unknown>
  sourceCredentials: {
    password: string
  }
}
