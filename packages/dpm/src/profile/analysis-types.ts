import type {
  DpmProfileArtifact,
} from './profile-artifact-types.js'
import type {
  DpmProfileMetricKind,
  DpmProfileNodeKind,
  DpmProfileSourceKind,
} from './profile-taxonomy.js'

export const DPM_PROFILE_ANALYSIS_REPORT_KIND = 'dpm.profile.analysis-report.v1' as const

export const DPM_PROFILE_RELATIONSHIP_HINT_STATUSES = ['review'] as const
export const DPM_PROFILE_KEY_CANDIDATE_KINDS = ['message_key', 'identifier_like_field'] as const
export const DPM_PROFILE_RISK_INDICATOR_KINDS = ['identifier_like_field', 'high_null_ratio', 'low_presence_ratio'] as const
export const DPM_PROFILE_DRIFT_SIGNAL_KINDS = [
  'profile_hash_changed',
  'node_added',
  'node_removed',
  'metric_value_changed',
  'source_version_hash_changed',
] as const

export type DpmProfileRelationshipHintStatus = typeof DPM_PROFILE_RELATIONSHIP_HINT_STATUSES[number]
export type DpmProfileKeyCandidateKind = typeof DPM_PROFILE_KEY_CANDIDATE_KINDS[number]
export type DpmProfileRiskIndicatorKind = typeof DPM_PROFILE_RISK_INDICATOR_KINDS[number]
export type DpmProfileDriftSignalKind = typeof DPM_PROFILE_DRIFT_SIGNAL_KINDS[number]

export type DpmProfileAnalysisInput = {
  profileArtifact: DpmProfileArtifact
  previousProfileArtifact?: DpmProfileArtifact
  reportId?: string
  analyzedAt?: string
}

export type DpmProfileAnalysisCoverage = {
  sourceKindCounts: Partial<Record<DpmProfileSourceKind, number>>
  nodeKindCounts: Partial<Record<DpmProfileNodeKind, number>>
  metricKindCounts: Partial<Record<DpmProfileMetricKind, number>>
  measuredNodeCount: number
  measuredNodeRatio: number
}

export type DpmProfileRelationshipHintProposal = {
  id: string
  status: DpmProfileRelationshipHintStatus
  fromNodeId: string
  hintNodeId: string
  targetRef?: string
  confidence: number
  evidenceIds: string[]
  explanation: string
}

export type DpmProfileKeyCandidate = {
  id: string
  kind: DpmProfileKeyCandidateKind
  nodeId: string
  confidence: number
  reason: string
  evidenceIds: string[]
}

export type DpmProfileRiskIndicator = {
  id: string
  kind: DpmProfileRiskIndicatorKind
  severity: 'warning' | 'info'
  nodeId?: string
  metricId?: string
  evidenceIds: string[]
  explanation: string
}

export type DpmProfileDriftSignal = {
  id: string
  kind: DpmProfileDriftSignalKind
  severity: 'warning' | 'info'
  nodeId?: string
  metricId?: string
  sourceId?: string
  previousValue?: string | number
  currentValue?: string | number
  explanation: string
}

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
