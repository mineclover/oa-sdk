import { describe, expect, it, vi } from 'vitest'

import {
  createDpmRegistryRepository,
} from '../src/index.js'
import {
  STORAGE_REGISTRY_DATASET_ID,
  STORAGE_REGISTRY_EXPORTED_AT,
  STORAGE_REGISTRY_VERSION,
} from './support/storage-registry-snapshot-fixtures.js'
import {
  storageRegistryRows,
} from './support/storage-registry-row-fixtures.js'

describe('DPM registry storage repository', () => {
  it('creates a repository that requests rows by dataset and registry version', async () => {
    const listRelationshipRows = vi.fn(async () => storageRegistryRows)
    const repository = createDpmRegistryRepository({ listRelationshipRows })

    const snapshot = await repository.exportSnapshot({
      datasetId: STORAGE_REGISTRY_DATASET_ID,
      registryVersion: STORAGE_REGISTRY_VERSION,
      exportedAt: STORAGE_REGISTRY_EXPORTED_AT,
    })

    expect(listRelationshipRows).toHaveBeenCalledWith({
      datasetId: STORAGE_REGISTRY_DATASET_ID,
      registryVersion: STORAGE_REGISTRY_VERSION,
    })
    expect(snapshot.summary).toMatchObject({
      total: 2,
      approved: 1,
      nonExecutable: 1,
    })
  })
})
