import {
  createDpmDryRunReport,
  createPostgresCatalogSnapshot,
  parseRegistrySnapshotYaml,
  type DpmCompiledPlan,
  type DpmCompileInput,
  type DpmCompileSuccess,
  type DpmDryRunReport,
  type DpmJobSaveInput,
  type DpmValidationReportSaveInput,
  type PostgresCatalogSnapshotInput,
} from '../../src/index.js'
import {
  readDpmJsonFixture,
  readDpmTextFixture,
} from './fixture-io.js'

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

export function createStorageReportCompileInput(): DpmCompileInput {
  const catalog = createPostgresCatalogSnapshot(
    readDpmJsonFixture<PostgresCatalogSnapshotInput>('catalog/postgres-commerce.json'),
  )
  const manifest = readDpmJsonFixture<Record<string, any>>('valid/customer-orders.json')
  manifest.catalog.version_hash = catalog.freshness.versionHash

  return {
    manifest,
    catalog,
    registry: parseRegistrySnapshotYaml(readDpmTextFixture('registry/commerce-registry.yaml')),
  }
}

export function createCompletedStorageJobInput(
  compiled: DpmCompileSuccess,
): StorageReportUnsafeJobInput {
  return {
    jobId: 'job_compile_001',
    operation: 'compile',
    status: 'completed',
    datasetId: compiled.plan.datasetId,
    manifestId: compiled.plan.manifestId,
    planIdentity: compiled.plan.identity,
    freshness: compiled.plan.freshness,
    diagnostics: compiled.validation.diagnostics,
    validationReportRef: 'dpm-report:job_compile_001',
    createdAt: '2026-07-01T00:00:00.000Z',
    completedAt: '2026-07-01T00:00:01.000Z',
    sourceDbPassword: STORAGE_REPORT_UNSAFE_SOURCE_PASSWORD,
    vaultMaterial: STORAGE_REPORT_UNSAFE_VAULT_MATERIAL,
    tokenReverseLookup: {
      [STORAGE_REPORT_UNSAFE_TOKEN_LOOKUP_KEY]: STORAGE_REPORT_UNSAFE_CUSTOMER_NO,
    },
    rawSamples: {
      customer_no: STORAGE_REPORT_UNSAFE_CUSTOMER_NO,
    },
  }
}

export function createStorageReportDryRunReport(plan: DpmCompiledPlan): DpmDryRunReport {
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

export function createCompletedStorageValidationReportInput({
  compiled,
  dryRun,
}: {
  compiled: DpmCompileSuccess
  dryRun: DpmDryRunReport
}): StorageReportUnsafeValidationReportInput {
  return {
    jobId: 'job_dry_run_001',
    status: 'completed',
    validationReportRef: 'dpm-report:job_dry_run_001',
    diagnostics: compiled.validation.diagnostics,
    planIdentity: compiled.plan.identity,
    freshness: compiled.plan.freshness,
    impact: dryRun.impact,
    categories: dryRun.categories,
    createdAt: '2026-07-01T00:00:02.000Z',
    rawSamples: {
      customer_no: STORAGE_REPORT_UNSAFE_CUSTOMER_NO,
    },
    sourceCredentials: {
      password: STORAGE_REPORT_UNSAFE_SOURCE_PASSWORD,
    },
  }
}
