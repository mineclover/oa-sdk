import { describe, expect, it } from 'vitest'

import { selectApprovedRelationships } from '../src/index.js'
import { readCommerceRegistrySnapshot } from './support/registry-fixtures.js'

describe('DPM relationship registry executable selection', () => {
  it('selects only approved relationships for compilation', () => {
    const snapshot = readCommerceRegistrySnapshot()
    const approved = selectApprovedRelationships(snapshot)

    expect(approved.map(relationship => relationship.name)).toEqual(['rel_orders_customer'])
    expect(approved.every(relationship => relationship.executable)).toBe(true)
    expect(snapshot.nonExecutableRelationships.map(relationship => relationship.status).sort()).toEqual([
      'deprecated',
      'proposed',
      'rejected',
      'superseded',
    ])
  })
})
