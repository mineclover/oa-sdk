import type { DpmPlanFreshness } from '../compiler/plan.js'
import type { DpmDryRunCategory, DpmDryRunImpact } from '../dry-run/report.js'
import {
  createDpmDiagnostic,
  type DpmDiagnostic,
} from '../validator/diagnostics.js'
import {
  DPM_VALIDATION_REPORT_KIND,
  type DpmStoredValidationReport,
  type DpmValidationReportSaveInput,
} from './report-repository-types.js'

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

export function copyValidationReportDiagnostics(diagnostics: readonly DpmDiagnostic[]): DpmDiagnostic[] {
  return diagnostics.map(diagnostic => createDpmDiagnostic(diagnostic))
}

function copyDiagnostics(diagnostics: readonly DpmDiagnostic[]): DpmDiagnostic[] {
  return copyValidationReportDiagnostics(diagnostics)
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
