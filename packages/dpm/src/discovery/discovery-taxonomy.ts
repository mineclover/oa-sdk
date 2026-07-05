export type DiscoveryEvidenceKind =
  | 'column_name_similarity'
  | 'type_compatibility'
  | 'unique_candidate'
  | 'inclusion_dependency'
  | 'query_log'
  | 'orm_metadata'
  | 'bi_query_metadata'
  | 'service_code_hint'

export const DISCOVERY_CONFIDENCE_LEVELS = ['high', 'review', 'low'] as const
export const DISCOVERY_CANDIDATE_RECOMMENDATIONS = ['review', 'reject'] as const

export type DiscoveryConfidenceLevel = typeof DISCOVERY_CONFIDENCE_LEVELS[number]
export type DiscoveryCandidateRecommendation = typeof DISCOVERY_CANDIDATE_RECOMMENDATIONS[number]
