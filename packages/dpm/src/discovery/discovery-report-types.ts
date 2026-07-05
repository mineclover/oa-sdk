import type {
  DiscoveryEvidence,
  DiscoveryThresholds,
  ExcludedRelationshipCandidate,
  RelationshipCandidate,
  RelationshipCandidateInput,
} from './discovery-candidate-types.js'

export type RelationshipDiscoveryReportInput = {
  datasetId: string
  generatedAt?: string
  thresholds?: Partial<DiscoveryThresholds>
  candidates: RelationshipCandidateInput[]
  exclusions?: ExcludedRelationshipCandidate[]
  diagnostics?: DiscoveryEvidence[]
}

export type RelationshipDiscoveryReport = {
  kind: 'dpm.relationship.discovery-report.v1'
  datasetId: string
  generatedAt?: string
  autoApproveEnabled: false
  thresholds: DiscoveryThresholds
  candidates: RelationshipCandidate[]
  exclusions: ExcludedRelationshipCandidate[]
  diagnostics: DiscoveryEvidence[]
  summary: {
    candidateCount: number
    reviewCount: number
    rejectCount: number
    excludedCount: number
  }
}
