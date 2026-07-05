import type { SchemaSourceCoordinate } from '@oa-sdk/openapi-projection-contract'

import type {
  DiscoveryCandidateRecommendation,
  DiscoveryConfidenceLevel,
  DiscoveryEvidenceKind,
} from './discovery-taxonomy.js'

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
