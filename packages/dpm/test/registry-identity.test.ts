import { describe, expect, it } from 'vitest'

import {
  createRegistrySnapshot,
  type RegistrySnapshotInput,
} from '../src/index.js'
import { readCommerceRegistrySnapshot } from './support/registry-fixtures.js'

describe('DPM relationship registry identity', () => {
  it('keeps snapshot identity stable for equivalent relationship ordering', () => {
    const snapshot = readCommerceRegistrySnapshot()
    const input: RegistrySnapshotInput = {
      datasetId: snapshot.datasetId,
      registryVersion: snapshot.registryVersion,
      exportedAt: snapshot.exportedAt,
      relationships: [...snapshot.relationships].reverse(),
    }
    const reordered = createRegistrySnapshot(input)

    expect(reordered.identity).toBe(snapshot.identity)
    expect(reordered.relationships.map(relationship => relationship.identity)).toEqual(
      snapshot.relationships.map(relationship => relationship.identity),
    )
  })
})
