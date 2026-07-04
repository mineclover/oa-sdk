import type { DpmCompiledPlan } from '../compiler/plan.js'

export const DPM_DRY_RUN_REPORT_KIND = 'dpm.dry-run-report.v1' as const

export type DpmDryRunImpact = {
  namespaces: number
  relationships: number
  columns: number
  piiColumns: number
  estimatedRows: number
}

export type DpmDryRunCategory = {
  name: 'namespace_bindings' | 'relationship_steps' | 'column_steps' | 'pii_columns' | 'estimated_rows'
  count: number
}

export type DpmDryRunInput = {
  plan: DpmCompiledPlan
  estimatedRows?: Record<string, number>
  sampleValues?: Record<string, unknown>
}

export type DpmDryRunReport = {
  kind: typeof DPM_DRY_RUN_REPORT_KIND
  planIdentity: string
  manifestId: string
  stale: boolean
  impact: DpmDryRunImpact
  categories: DpmDryRunCategory[]
  rawValuesIncluded: false
}

export function createDpmDryRunReport(input: DpmDryRunInput): DpmDryRunReport {
  const estimatedRows = Object.values(input.estimatedRows ?? {}).reduce((sum, count) => sum + count, 0)
  const impact: DpmDryRunImpact = {
    namespaces: input.plan.namespaceBindings.length,
    relationships: input.plan.relationshipSteps.length,
    columns: input.plan.columnSteps.filter(step => step.relationship).length,
    piiColumns: input.plan.columnSteps.filter(step => step.pii).length,
    estimatedRows,
  }

  return {
    kind: DPM_DRY_RUN_REPORT_KIND,
    planIdentity: input.plan.identity,
    manifestId: input.plan.manifestId,
    stale: input.plan.stale,
    impact,
    categories: [
      { name: 'namespace_bindings', count: impact.namespaces },
      { name: 'relationship_steps', count: impact.relationships },
      { name: 'column_steps', count: impact.columns },
      { name: 'pii_columns', count: impact.piiColumns },
      { name: 'estimated_rows', count: impact.estimatedRows },
    ],
    rawValuesIncluded: false,
  }
}
