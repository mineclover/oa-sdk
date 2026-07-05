import {
  DPM_PROFILE_ANALYSIS_REPORT_KIND,
  type DpmProfileAnalysisReport,
} from './analysis-report-types.js'
import { computeDpmProfileAnalysisReportHash as computeReportHash } from './analysis-report-freshness.js'
import {
  createDpmProfileAnalysisSummary,
  sortDpmProfileAnalysisDiagnostics,
} from './analysis-summary.js'
import type { DpmProfileAnalysisInput } from './analysis-input-types.js'
import {
  analyzeCoverage,
  analyzeKeyCandidates,
  analyzeRelationshipHints,
  analyzeRiskIndicators,
} from './analysis-compute.js'
import { analyzeDriftSignals } from './analysis-drift.js'

export function createDpmProfileAnalysisReport(input: DpmProfileAnalysisInput): DpmProfileAnalysisReport {
  const coverage = analyzeCoverage(input.profileArtifact)
  const relationshipHints = analyzeRelationshipHints(input.profileArtifact)
  const keyCandidates = analyzeKeyCandidates(input.profileArtifact)
  const riskIndicators = analyzeRiskIndicators(input.profileArtifact)
  const driftSignals = analyzeDriftSignals(input.profileArtifact, input.previousProfileArtifact)
  const diagnostics = sortDpmProfileAnalysisDiagnostics(input.profileArtifact.diagnostics)
  const structural: Omit<DpmProfileAnalysisReport, 'freshness'> = {
    kind: DPM_PROFILE_ANALYSIS_REPORT_KIND,
    reportId: input.reportId ?? `profile-analysis:${input.profileArtifact.profileId}:${input.profileArtifact.freshness.versionHash}`,
    profileId: input.profileArtifact.profileId,
    datasetId: input.profileArtifact.datasetId,
    profileVersion: input.profileArtifact.profileVersion,
    analyzedAt: input.analyzedAt ?? input.profileArtifact.createdAt,
    profileVersionHash: input.profileArtifact.freshness.versionHash,
    coverage,
    relationshipHints,
    keyCandidates,
    driftSignals,
    riskIndicators,
    diagnostics,
    summary: createDpmProfileAnalysisSummary({
      profileArtifact: input.profileArtifact,
      diagnostics,
      relationshipHints,
      keyCandidates,
      riskIndicators,
      driftSignals,
    }),
  }

  return {
    ...structural,
    freshness: {
      reportHash: computeReportHash(structural),
      profileVersionHash: input.profileArtifact.freshness.versionHash,
      ...(input.previousProfileArtifact ? { previousProfileVersionHash: input.previousProfileArtifact.freshness.versionHash } : {}),
    },
  }
}
