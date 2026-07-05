import type {
  DiscoveryCandidateRecommendation,
  DiscoveryConfidenceLevel,
} from './discovery-taxonomy.js'
import type { DiscoveryEvidence } from './discovery-evidence-types.js'
import type { RelationshipDiscoveryEndpoint } from './discovery-endpoint-types.js'

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
