import type {
  DpmProfileArtifact,
} from './profile-artifact-types.js'
import type {
  DpmProfileAnalysisCoverage,
  DpmProfileDriftSignal,
  DpmProfileKeyCandidate,
  DpmProfileRelationshipHintProposal,
  DpmProfileRiskIndicator,
} from './analysis-signal-types.js'

export const DPM_PROFILE_ANALYSIS_REPORT_KIND = 'dpm.profile.analysis-report.v1' as const

export type DpmProfileAnalysisSummary = {
  nodeCount: number
  edgeCount: number
  metricCount: number
  diagnosticCount: number
  relationshipHintCount: number
  keyCandidateCount: number
  riskIndicatorCount: number
  driftSignalCount: number
}

export type DpmProfileAnalysisFreshness = {
  reportHash: string
  profileVersionHash: string
  previousProfileVersionHash?: string
}

export type DpmProfileAnalysisReport = {
  kind: typeof DPM_PROFILE_ANALYSIS_REPORT_KIND
  reportId: string
  profileId: string
  datasetId: string
  profileVersion: string
  analyzedAt: string
  profileVersionHash: string
  coverage: DpmProfileAnalysisCoverage
  relationshipHints: DpmProfileRelationshipHintProposal[]
  keyCandidates: DpmProfileKeyCandidate[]
  driftSignals: DpmProfileDriftSignal[]
  riskIndicators: DpmProfileRiskIndicator[]
  diagnostics: DpmProfileArtifact['diagnostics']
  summary: DpmProfileAnalysisSummary
  freshness: DpmProfileAnalysisFreshness
}
