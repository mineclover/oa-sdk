import type { SchemaSourceCoordinate } from '@oa-sdk/openapi-projection-contract'

export type ExcludedRelationshipCandidate = {
  id: string
  reason: 'excluded_column_pattern' | 'type_mismatch' | 'metric_like_column' | 'insufficient_evidence'
  message: string
  source?: SchemaSourceCoordinate
}
