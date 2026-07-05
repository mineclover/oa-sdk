import type {
  DpmProfileMetricKind,
  DpmProfileNodeKind,
  DpmProfileSourceKind,
} from './profile-taxonomy.js'
import type {
  DpmProfileDriftSignalKind,
  DpmProfileKeyCandidateKind,
  DpmProfileRelationshipHintStatus,
  DpmProfileRiskIndicatorKind,
} from './analysis-taxonomy.js'

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
