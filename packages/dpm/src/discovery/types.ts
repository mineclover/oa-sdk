import type { SchemaSourceCoordinate } from '@oa-sdk/openapi-projection-contract'

export type DiscoveryEvidenceKind =
  | 'column_name_similarity'
  | 'type_compatibility'
  | 'unique_candidate'
  | 'inclusion_dependency'
  | 'query_log'
  | 'orm_metadata'
  | 'bi_query_metadata'
  | 'service_code_hint'

export type DiscoveryEvidence = {
  kind: DiscoveryEvidenceKind
  score?: number
  message: string
  source?: SchemaSourceCoordinate
  metadata?: Record<string, unknown>
}

export type DiscoveryThresholds = {
  reviewMin: number
  rejectBelow: number
  highConfidenceMin: number
  maxOrphanRatioBlocking: number
}

export type DiscoveryConfidenceLevel = 'high' | 'review' | 'low'
export type DiscoveryCandidateRecommendation = 'review' | 'reject'

export type RelationshipDiscoveryEndpoint = {
  table: string
  columns: string[]
}

export type RelationshipCandidateInput = {
  id: string
  relationshipName: string
  type:
    | 'one_to_one'
    | 'one_to_many'
    | 'many_to_one'
    | 'many_to_many_edge'
    | 'self_reference'
    | 'polymorphic'
    | 'temporal'
    | 'code_lookup'
  parent: RelationshipDiscoveryEndpoint
  child: RelationshipDiscoveryEndpoint
  confidenceScore: number
  evidence: DiscoveryEvidence[]
  warnings?: string[]
}

export type RelationshipCandidate = {
  id: string
  relationshipName: string
  type: RelationshipCandidateInput['type']
  parent: RelationshipDiscoveryEndpoint
  child: RelationshipDiscoveryEndpoint
  confidence: {
    score: number
    level: DiscoveryConfidenceLevel
  }
  evidence: DiscoveryEvidence[]
  warnings: string[]
  recommendation: DiscoveryCandidateRecommendation
  executable: false
}

export type ExcludedRelationshipCandidate = {
  id: string
  reason: 'excluded_column_pattern' | 'type_mismatch' | 'metric_like_column' | 'insufficient_evidence'
  message: string
  source?: SchemaSourceCoordinate
}

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
