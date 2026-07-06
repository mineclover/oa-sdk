import type { DpmCompiledPlan, DpmDryRunReport } from '../../src/index.js'
import { createDryRunReportForPlan } from './dry-run-fixtures.js'

export function createStorageReportDryRunReport(
  plan: DpmCompiledPlan,
): DpmDryRunReport {
  return createDryRunReportForPlan(plan)
}
