import type { SchemaSourceCoordinate } from '@oa-sdk/openapi-projection-contract'

export const REGISTRY_RELATIONSHIP_STATUSES = [
  'candidate',
  'proposed',
  'approved',
  'rejected',
  'deprecated',
  'superseded',
] as const

export const REGISTRY_RELATIONSHIP_KINDS = [
  'one_to_one',
  'one_to_many',
  'many_to_one',
  'many_to_many_edge',
  'self_reference',
  'polymorphic',
  'temporal',
  'code_lookup',
] as const

export const REGISTRY_TRANSFORM_STRATEGIES = ['entity_token', 'relationship_token', 'keep_code'] as const

export type RegistryRelationshipStatus = typeof REGISTRY_RELATIONSHIP_STATUSES[number]
export type RegistryRelationshipKind = typeof REGISTRY_RELATIONSHIP_KINDS[number]
export type RegistryTransformStrategy = typeof REGISTRY_TRANSFORM_STRATEGIES[number]

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
  orphanPolicy: 'block' | 'warn' | 'tolerate' | 'tolerate_null' | 'create_placeholder_parent' | 'lookup_archive'
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

export type RegistrySnapshotInput = {
  datasetId: string
  registryVersion: string
  exportedAt?: string
  relationships: RegistryRelationshipInput[]
}

export type RegistrySnapshot = {
  kind: 'dpm.relationship.registry-snapshot.v1'
  identity: string
  datasetId: string
  registryVersion: string
  exportedAt?: string
  relationships: RegistryRelationship[]
  approvedRelationships: RegistryRelationship[]
  nonExecutableRelationships: RegistryRelationship[]
  summary: {
    total: number
    approved: number
    nonExecutable: number
    byStatus: Record<RegistryRelationshipStatus, number>
  }
}
