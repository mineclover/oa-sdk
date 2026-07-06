import { describe, expect, it } from 'vitest'

import {
  registryRowsToSnapshot,
} from '../src/index.js'
import {
  expectedStorageRegistryApprovedRelationship,
  expectedStorageRegistryApprovedRelationshipNames,
  expectedStorageRegistryNonExecutableStatuses,
  expectedStorageRegistryRelationshipIdentities,
  expectedStorageRegistrySnapshotIdentity,
  STORAGE_REGISTRY_DATASET_ID,
  STORAGE_REGISTRY_EXPORTED_AT,
  STORAGE_REGISTRY_VERSION,
  storageRegistryRows,
} from './support/storage-registry-fixtures.js'

describe('DPM registry storage row mapper', () => {
  it('exports storage rows to the existing registry snapshot contract', () => {
    const snapshot = registryRowsToSnapshot({
      datasetId: STORAGE_REGISTRY_DATASET_ID,
      registryVersion: STORAGE_REGISTRY_VERSION,
      exportedAt: STORAGE_REGISTRY_EXPORTED_AT,
      rows: storageRegistryRows,
    })

    expect(snapshot.identity).toBe(expectedStorageRegistrySnapshotIdentity)
    expect(snapshot.relationships.map(relationship => relationship.identity)).toEqual([
      ...expectedStorageRegistryRelationshipIdentities,
    ])
    expect(snapshot.approvedRelationships.map(relationship => relationship.name))
      .toEqual([...expectedStorageRegistryApprovedRelationshipNames])
    expect(snapshot.nonExecutableRelationships.map(relationship => relationship.status))
      .toEqual([...expectedStorageRegistryNonExecutableStatuses])
    expect(snapshot.relationships[0]).toMatchObject(expectedStorageRegistryApprovedRelationship)
  })
})
