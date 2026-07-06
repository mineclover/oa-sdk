import { describe, expect, it, vi } from 'vitest'

import {
  createDpmRegistryRepository,
} from '../src/index.js'
import {
  storageRegistryRows,
} from './support/storage-registry-row-fixtures.js'

describe('DPM registry storage repository', () => {
  it('creates a repository that requests rows by dataset and registry version', async () => {
    const listRelationshipRows = vi.fn(async () => storageRegistryRows)
    const repository = createDpmRegistryRepository({ listRelationshipRows })

    const snapshot = await repository.exportSnapshot({
      datasetId: 'commerce_ai',
      registryVersion: 'reg-2026-07-01',
      exportedAt: '2026-07-01T00:00:00.000Z',
    })

    expect(listRelationshipRows).toHaveBeenCalledWith({
      datasetId: 'commerce_ai',
      registryVersion: 'reg-2026-07-01',
    })
    expect(snapshot.summary).toMatchObject({
      total: 2,
      approved: 1,
      nonExecutable: 1,
    })
  })
})
