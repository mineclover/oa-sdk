import type { DpmPlanFreshness } from '../compiler/plan.js'
import type { DpmDryRunCategory, DpmDryRunImpact } from '../dry-run/report.js'
import {
  createDpmDiagnostic,
  type DpmDiagnostic,
} from '../validator/diagnostics.js'

export const DPM_VALIDATION_REPORT_KIND = 'dpm.validation-report.v1' as const

export type DpmValidationReportStatus = 'completed' | 'failed'

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

export type DpmStoredValidationReport = {
  kind: typeof DPM_VALIDATION_REPORT_KIND
  jobId: string
  status: DpmValidationReportStatus
  validationReportRef: string
  diagnostics: DpmDiagnostic[]
  planIdentity?: string
  freshness?: DpmPlanFreshness
  impact?: DpmDryRunImpact
  categories?: DpmDryRunCategory[]
  createdAt?: string
}

export type DpmGatewayJobReport = {
  jobId: string
  status: DpmValidationReportStatus
  validationReportRef: string
  diagnostics: DpmDiagnostic[]
}

export type DpmValidationReportStorage = {
  upsertReport(row: DpmStoredValidationReport): Promise<void> | void
  getValidationReport(
    request: DpmValidationReportRequest,
  ): Promise<DpmStoredValidationReport | undefined> | DpmStoredValidationReport | undefined
}

export type DpmReportRepository = {
  saveReport(input: DpmValidationReportSaveInput): Promise<DpmStoredValidationReport>
  getJobReport(request: DpmValidationReportRequest): Promise<DpmGatewayJobReport | undefined>
}

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

export function createDpmValidationReport(input: DpmValidationReportSaveInput): DpmStoredValidationReport {
  return {
    kind: DPM_VALIDATION_REPORT_KIND,
    jobId: input.jobId,
    status: input.status,
    validationReportRef: input.validationReportRef ?? `dpm-report:${input.jobId}`,
    diagnostics: copyDiagnostics(input.diagnostics),
    ...(input.planIdentity ? { planIdentity: input.planIdentity } : {}),
    ...(input.freshness ? { freshness: copyFreshness(input.freshness) } : {}),
    ...(input.impact ? { impact: copyImpact(input.impact) } : {}),
    ...(input.categories ? { categories: input.categories.map(copyCategory) } : {}),
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  }
}

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
    diagnostics: copyDiagnostics(row.diagnostics),
  }
}

function copyDiagnostics(diagnostics: readonly DpmDiagnostic[]): DpmDiagnostic[] {
  return diagnostics.map(diagnostic => createDpmDiagnostic(diagnostic))
}

function copyFreshness(freshness: DpmPlanFreshness): DpmPlanFreshness {
  return {
    ...(freshness.manifestCatalogVersionHash ? {
      manifestCatalogVersionHash: freshness.manifestCatalogVersionHash,
    } : {}),
    catalogVersionHash: freshness.catalogVersionHash,
    registryVersion: freshness.registryVersion,
    registryIdentity: freshness.registryIdentity,
  }
}

function copyImpact(impact: DpmDryRunImpact): DpmDryRunImpact {
  return {
    namespaces: impact.namespaces,
    relationships: impact.relationships,
    columns: impact.columns,
    piiColumns: impact.piiColumns,
    estimatedRows: impact.estimatedRows,
  }
}

function copyCategory(category: DpmDryRunCategory): DpmDryRunCategory {
  return {
    name: category.name,
    count: category.count,
  }
}
