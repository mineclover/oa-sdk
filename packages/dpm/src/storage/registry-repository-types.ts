import type { SchemaSourceCoordinate } from '@oa-sdk/openapi-projection-contract'

import type {
  RegistryApprovalMetadata,
  RegistryEvidence,
  RegistryRelationshipInput,
} from '../registry/registry-relationship-types.js'
import type {
  RegistryRelationshipKind,
  RegistryRelationshipStatus,
  RegistryTransformStrategy,
} from '../registry/registry-taxonomy.js'
import type { RegistrySnapshot } from '../registry/registry-snapshot-types.js'

export type DpmRegistrySnapshotExportRequest = {
  datasetId: string
  registryVersion: string
  exportedAt?: string
}

export type DpmRegistryRelationshipRowRequest = {
  datasetId: string
  registryVersion: string
}

export type DpmRegistryRelationshipRow = {
  datasetId: string
  registryVersion: string
  relationshipName: string
  relationshipVersion: string
  status: RegistryRelationshipStatus
  relationshipType: RegistryRelationshipKind
  parentTable: string
  parentColumns: string[]
  childTable: string
  childColumns: string[]
  namespace: string
  transformStrategy: RegistryTransformStrategy
  orphanPolicy: RegistryRelationshipInput['orphanPolicy']
  contextColumns: string[]
  conditionSql?: string
  temporalCondition?: string
  confidenceScore?: number
  evidence: RegistryEvidence[]
  approval: RegistryApprovalMetadata
  supersedes?: string
  supersededBy?: string
  source?: SchemaSourceCoordinate
  sourceFreshnessHash?: string
  createdAt?: string
  updatedAt?: string
}

export type DpmRegistryRowsToSnapshotInput = DpmRegistrySnapshotExportRequest & {
  rows: readonly DpmRegistryRelationshipRow[]
}

export type DpmRegistryStorageReader = {
  listRelationshipRows(
    request: DpmRegistryRelationshipRowRequest,
  ): Promise<readonly DpmRegistryRelationshipRow[]> | readonly DpmRegistryRelationshipRow[]
}

export type DpmRegistryRepository = {
  exportSnapshot(request: DpmRegistrySnapshotExportRequest): Promise<RegistrySnapshot>
}
