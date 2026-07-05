import type { DpmProfileAnalysisInput } from './analysis-input-types.js'
import type { DpmProfileAnalysisReport } from './analysis-report-types.js'
import {
  analyzeCoverage,
  analyzeKeyCandidates,
  analyzeRelationshipHints,
  analyzeRiskIndicators,
} from './analysis-compute.js'
import { analyzeDriftSignals } from './analysis-drift.js'

export type DpmProfileAnalysisReportSignals = Pick<
  DpmProfileAnalysisReport,
  'coverage' | 'relationshipHints' | 'keyCandidates' | 'driftSignals' | 'riskIndicators'
>

export function createDpmProfileAnalysisReportSignals(
  input: DpmProfileAnalysisInput,
): DpmProfileAnalysisReportSignals {
  return {
    coverage: analyzeCoverage(input.profileArtifact),
    relationshipHints: analyzeRelationshipHints(input.profileArtifact),
    keyCandidates: analyzeKeyCandidates(input.profileArtifact),
    driftSignals: analyzeDriftSignals(input.profileArtifact, input.previousProfileArtifact),
    riskIndicators: analyzeRiskIndicators(input.profileArtifact),
  }
}
