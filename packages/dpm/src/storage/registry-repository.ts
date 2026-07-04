import type { SchemaSourceCoordinate } from '@oa-sdk/openapi-projection-contract'

import { createRegistrySnapshot } from '../registry/snapshot.js'
import type {
  RegistryApprovalMetadata,
  RegistryEvidence,
  RegistryRelationshipInput,
  RegistryRelationshipKind,
  RegistryRelationshipStatus,
  RegistrySnapshot,
  RegistryTransformStrategy,
} from '../registry/types.js'

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

export function createDpmRegistryRepository(reader: DpmRegistryStorageReader): DpmRegistryRepository {
  return {
    async exportSnapshot(request) {
      const rows = await reader.listRelationshipRows({
        datasetId: request.datasetId,
        registryVersion: request.registryVersion,
      })

      return registryRowsToSnapshot({
        ...request,
        rows,
      })
    },
  }
}

export function registryRowsToSnapshot(input: DpmRegistryRowsToSnapshotInput): RegistrySnapshot {
  return createRegistrySnapshot({
    datasetId: input.datasetId,
    registryVersion: input.registryVersion,
    ...(input.exportedAt ? { exportedAt: input.exportedAt } : {}),
    relationships: input.rows.map(row => rowToRelationshipInput(input, row)),
  })
}

function rowToRelationshipInput(
  snapshot: Pick<DpmRegistryRowsToSnapshotInput, 'datasetId' | 'registryVersion'>,
  row: DpmRegistryRelationshipRow,
): RegistryRelationshipInput {
  assertRowMatchesSnapshot(snapshot, row)

  return {
    name: row.relationshipName,
    version: row.relationshipVersion,
    status: row.status,
    type: row.relationshipType,
    parent: {
      table: row.parentTable,
      columns: [...row.parentColumns],
    },
    child: {
      table: row.childTable,
      columns: [...row.childColumns],
    },
    namespace: row.namespace,
    transformStrategy: row.transformStrategy,
    orphanPolicy: row.orphanPolicy,
    condition: {
      contextColumns: [...row.contextColumns],
      ...(row.conditionSql ? { conditionSql: row.conditionSql } : {}),
      ...(row.temporalCondition ? { temporalCondition: row.temporalCondition } : {}),
    },
    ...(row.confidenceScore !== undefined ? { confidenceScore: row.confidenceScore } : {}),
    evidence: row.evidence.map(evidence => ({ ...evidence })),
    approval: { ...row.approval },
    ...(row.supersedes ? { supersedes: row.supersedes } : {}),
    ...(row.supersededBy ? { supersededBy: row.supersededBy } : {}),
    ...(row.source ? { source: row.source } : {}),
  }
}

function assertRowMatchesSnapshot(
  snapshot: Pick<DpmRegistryRowsToSnapshotInput, 'datasetId' | 'registryVersion'>,
  row: DpmRegistryRelationshipRow,
): void {
  if (row.datasetId === snapshot.datasetId && row.registryVersion === snapshot.registryVersion) return

  throw new Error(
    `Registry row ${row.datasetId}/${row.registryVersion}/${row.relationshipName}@${row.relationshipVersion} ` +
      `does not match requested snapshot ${snapshot.datasetId}@${snapshot.registryVersion}`,
  )
}
