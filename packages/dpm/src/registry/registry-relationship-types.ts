import type { SchemaSourceCoordinate } from '@oa-sdk/openapi-projection-contract'

import type {
  RegistryOrphanPolicy,
  RegistryRelationshipKind,
  RegistryRelationshipStatus,
  RegistryTransformStrategy,
} from './registry-taxonomy.js'

export type RegistryEndpoint = {
  table: string
  columns: string[]
}

export type RegistryConditionMetadata = {
  contextColumns: string[]
  conditionSql?: string
  temporalCondition?: string
}

export type RegistryEvidence = {
  kind: string
  message: string
  score?: number
  source?: SchemaSourceCoordinate
  metadata?: Record<string, unknown>
}

export type RegistryApprovalMetadata = {
  owner: string
  approvedBy?: string
  approvedAt?: string
  reviewedBy?: string
  reviewedAt?: string
  reason?: string
}

export type RegistryRelationshipInput = {
  name: string
  version: string
  status: RegistryRelationshipStatus
  type: RegistryRelationshipKind
  parent: RegistryEndpoint
  child: RegistryEndpoint
  namespace: string
  transformStrategy: RegistryTransformStrategy
  orphanPolicy: RegistryOrphanPolicy
  condition?: RegistryConditionMetadata
  confidenceScore?: number
  evidence?: RegistryEvidence[]
  approval: RegistryApprovalMetadata
  supersedes?: string
  supersededBy?: string
  source?: SchemaSourceCoordinate
}

export type RegistryRelationship = RegistryRelationshipInput & {
  identity: string
  executable: boolean
  evidence: RegistryEvidence[]
  condition: RegistryConditionMetadata
}
