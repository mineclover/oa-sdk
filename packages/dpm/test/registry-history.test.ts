import { describe, expect, it } from 'vitest'

import { readCommerceRegistrySnapshot } from './support/registry-fixtures.js'

describe('DPM relationship registry non-executable history', () => {
  it('loads rejected, deprecated, and superseded relationships as non-executable history', () => {
    const snapshot = readCommerceRegistrySnapshot()
    const history = snapshot.nonExecutableRelationships

    expect(history.find(relationship => relationship.status === 'rejected')).toMatchObject({
      name: 'rel_orders_status',
      executable: false,
      approval: {
        reason: 'Candidate was ambiguous.',
      },
    })
    expect(history.find(relationship => relationship.status === 'deprecated')).toMatchObject({
      name: 'rel_legacy_customer',
      supersededBy: 'rel_orders_customer',
      executable: false,
    })
    expect(history.find(relationship => relationship.status === 'superseded')).toMatchObject({
      name: 'rel_old_orders_customer',
      executable: false,
    })
  })
})
