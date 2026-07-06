import { describe, expect, it } from 'vitest'

import { REGISTRY_SNAPSHOT_KIND } from '../src/index.js'
import {
  readCommerceRegistrySnapshot,
} from './support/registry-yaml-fixtures.js'
import {
  expectedCommerceRegistryIdentity,
  expectedCommerceRegistryRelationshipIdentities,
  expectedCommerceRegistrySummaryByStatus,
} from './support/registry-projection-fixtures.js'

describe('DPM relationship registry snapshot YAML', () => {
  it('loads YAML review artifacts into a versioned registry snapshot', () => {
    const snapshot = readCommerceRegistrySnapshot()

    expect(snapshot.kind).toBe(REGISTRY_SNAPSHOT_KIND)
    expect(snapshot.identity).toBe(expectedCommerceRegistryIdentity)
    expect(snapshot.relationships.map(relationship => relationship.identity)).toEqual([
      ...expectedCommerceRegistryRelationshipIdentities,
    ])
    expect(snapshot.summary.byStatus).toMatchObject(expectedCommerceRegistrySummaryByStatus)
  })
})
