import {
  compileDpmPlan,
  createDpmDryRunReport,
  type DpmCompiledPlan,
  type DpmDryRunReport,
} from '../../src/index.js'
import { createCompileInput } from './compiler-fixtures.js'

export const DPM_DRY_RUN_UNSAFE_SAMPLE_VALUE = 'C-001'

export const DPM_DRY_RUN_ESTIMATED_ROWS = {
  'public.customers': 2,
  'public.orders': 3,
} as const

export const DPM_DRY_RUN_SAMPLE_VALUES = {
  customer_no: DPM_DRY_RUN_UNSAFE_SAMPLE_VALUE,
} as const

export const DPM_DRY_RUN_EXPECTED_IMPACT = {
  namespaces: 1,
  relationships: 1,
  columns: 2,
  piiColumns: 2,
  estimatedRows: 5,
} as const

export const DPM_DRY_RUN_EXPECTED_CATEGORY_NAMES = [
  'namespace_bindings',
  'relationship_steps',
  'column_steps',
  'pii_columns',
  'estimated_rows',
] as const

export function createCompiledDryRunFixturePlan(): DpmCompiledPlan {
  const input = createCompileInput()
  const manifest = structuredClone(input.manifest) as Record<string, any>
  manifest.catalog.version_hash = input.catalog.freshness.versionHash

  const compiled = compileDpmPlan({
    ...input,
    manifest,
  })
  if (!compiled.ok) throw new Error('expected compile success')

  return compiled.plan
}

export function createDryRunReportForPlan(
  plan: DpmCompiledPlan,
): DpmDryRunReport {
  return createDpmDryRunReport({
    plan,
    estimatedRows: DPM_DRY_RUN_ESTIMATED_ROWS,
    sampleValues: DPM_DRY_RUN_SAMPLE_VALUES,
  })
}
