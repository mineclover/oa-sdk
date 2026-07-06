import { describe, expect, it } from 'vitest'

import { REGISTRY_SNAPSHOT_KIND } from '../src/index.js'
import { readCommerceRegistrySnapshot } from './support/registry-fixtures.js'

describe('DPM relationship registry snapshot YAML', () => {
  it('loads YAML review artifacts into a versioned registry snapshot', () => {
    const snapshot = readCommerceRegistrySnapshot()

    expect(snapshot.kind).toBe(REGISTRY_SNAPSHOT_KIND)
    expect(snapshot.identity).toBe('commerce_ai@reg-2026-07-01')
    expect(snapshot.relationships.map(relationship => relationship.identity)).toEqual([
      'commerce_ai/rel_legacy_customer@2',
      'commerce_ai/rel_old_orders_customer@1',
      'commerce_ai/rel_orders_customer@1',
      'commerce_ai/rel_orders_status@1',
      'commerce_ai/rel_tickets_customer@1',
    ])
    expect(snapshot.summary.byStatus).toMatchObject({
      approved: 1,
      rejected: 1,
      deprecated: 1,
      superseded: 1,
      proposed: 1,
    })
  })
})
