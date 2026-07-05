import { createRegistrySnapshot } from '../registry/snapshot.js'
import type {
  RegistryRelationshipInput,
  RegistrySnapshot,
} from '../registry/types.js'
import type {
  DpmRegistryRelationshipRow,
  DpmRegistryRowsToSnapshotInput,
} from './registry-repository-types.js'

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
