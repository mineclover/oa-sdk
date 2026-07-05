import type { DpmProfileAnalysisReport } from './analysis-report-types.js'
import { computeDpmProfileAnalysisReportHash as computeReportHash } from './analysis-report-freshness.js'
import type { DpmProfileAnalysisInput } from './analysis-input-types.js'
import { createDpmProfileAnalysisReportSignals } from './analysis-report-signals.js'
import { createDpmProfileAnalysisStructuralReport } from './analysis-report-structural.js'

export function createDpmProfileAnalysisReport(input: DpmProfileAnalysisInput): DpmProfileAnalysisReport {
  const signals = createDpmProfileAnalysisReportSignals(input)
  const structural = createDpmProfileAnalysisStructuralReport(input, signals)

  return {
    ...structural,
    freshness: {
      reportHash: computeReportHash(structural),
      profileVersionHash: input.profileArtifact.freshness.versionHash,
      ...(input.previousProfileArtifact ? { previousProfileVersionHash: input.previousProfileArtifact.freshness.versionHash } : {}),
    },
  }
}
