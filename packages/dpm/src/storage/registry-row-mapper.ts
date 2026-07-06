import { createRegistrySnapshot } from '../registry/registry-snapshot-factory.js'
import type { RegistrySnapshot } from '../registry/registry-snapshot-types.js'
import type {
  DpmRegistryRowsToSnapshotInput,
} from './registry-repository-types.js'
import { dpmRegistryRowToRelationshipInput } from './registry-row-relationship.js'

export function registryRowsToSnapshot(input: DpmRegistryRowsToSnapshotInput): RegistrySnapshot {
  return createRegistrySnapshot({
    datasetId: input.datasetId,
    registryVersion: input.registryVersion,
    ...(input.exportedAt ? { exportedAt: input.exportedAt } : {}),
    relationships: input.rows.map(row => dpmRegistryRowToRelationshipInput(input, row)),
  })
}
