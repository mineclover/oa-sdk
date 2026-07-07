import type {
  RegistryRelationshipInput,
} from '../registry/registry-relationship-types.js'
import { copyDiscoverySourceCoordinate } from '../discovery/discovery-source-copy.js'
import type {
  DpmRegistryRelationshipRow,
} from './registry-repository-types.js'
import {
  assertDpmRegistryRowMatchesSnapshot,
  type DpmRegistryRowSnapshotScope,
} from './registry-row-scope.js'

export function dpmRegistryRowToRelationshipInput(
  snapshot: DpmRegistryRowSnapshotScope,
  row: DpmRegistryRelationshipRow,
): RegistryRelationshipInput {
  assertDpmRegistryRowMatchesSnapshot(snapshot, row)

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
    ...(row.source ? { source: copyDiscoverySourceCoordinate(row.source) } : {}),
  }
}
