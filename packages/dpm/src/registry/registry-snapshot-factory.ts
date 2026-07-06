import {
  isExecutableRegistryRelationship,
} from './registry-executable.js'
import {
  createRegistrySnapshotIdentity,
  REGISTRY_SNAPSHOT_KIND,
} from './registry-identity.js'
import { normalizeRegistryRelationship } from './registry-normalize.js'
import type {
  RegistrySnapshot,
  RegistrySnapshotInput,
} from './registry-snapshot-types.js'
import { createRegistrySnapshotSummary } from './registry-summary.js'

export function createRegistrySnapshot(input: RegistrySnapshotInput): RegistrySnapshot {
  const relationships = input.relationships
    .map(relationship => normalizeRegistryRelationship(input, relationship))
    .sort((left, right) => left.identity.localeCompare(right.identity))
  const approvedRelationships = relationships.filter(isExecutableRegistryRelationship)
  const nonExecutableRelationships = relationships.filter(relationship => !relationship.executable)

  return {
    kind: REGISTRY_SNAPSHOT_KIND,
    identity: createRegistrySnapshotIdentity(input.datasetId, input.registryVersion),
    datasetId: input.datasetId,
    registryVersion: input.registryVersion,
    ...(input.exportedAt ? { exportedAt: input.exportedAt } : {}),
    relationships,
    approvedRelationships,
    nonExecutableRelationships,
    summary: createRegistrySnapshotSummary({
      relationships,
      approvedRelationships,
      nonExecutableRelationships,
    }),
  }
}
