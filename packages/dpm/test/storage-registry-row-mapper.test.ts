import { describe, expect, it } from 'vitest'

import {
  registryRowsToSnapshot,
} from '../src/index.js'
import {
  storageRegistryRows,
} from './support/storage-registry-fixtures.js'

describe('DPM registry storage row mapper', () => {
  it('exports storage rows to the existing registry snapshot contract', () => {
    const snapshot = registryRowsToSnapshot({
      datasetId: 'commerce_ai',
      registryVersion: 'reg-2026-07-01',
      exportedAt: '2026-07-01T00:00:00.000Z',
      rows: storageRegistryRows,
    })

    expect(snapshot.identity).toBe('commerce_ai@reg-2026-07-01')
    expect(snapshot.relationships.map(relationship => relationship.identity)).toEqual([
      'commerce_ai/rel_orders_customer@1',
      'commerce_ai/rel_orders_status@1',
    ])
    expect(snapshot.approvedRelationships.map(relationship => relationship.name)).toEqual(['rel_orders_customer'])
    expect(snapshot.nonExecutableRelationships.map(relationship => relationship.status)).toEqual(['rejected'])
    expect(snapshot.relationships[0]).toMatchObject({
      name: 'rel_orders_customer',
      status: 'approved',
      executable: true,
      namespace: 'customer',
      parent: {
        table: 'public.customers',
        columns: ['customer_no'],
      },
      child: {
        table: 'public.orders',
        columns: ['customer_no'],
      },
      condition: {
        contextColumns: ['tenant_id'],
      },
      approval: {
        owner: 'privacy-team',
        approvedBy: 'dpo@example.com',
      },
    })
  })

  it('refuses storage rows outside the requested dataset or registry version', () => {
    expect(() =>
      registryRowsToSnapshot({
        datasetId: 'commerce_ai',
        registryVersion: 'reg-2026-07-01',
        rows: [
          {
            ...storageRegistryRows[0],
            datasetId: 'other_dataset',
          },
        ],
      }),
    ).toThrow('Registry row other_dataset/reg-2026-07-01/rel_orders_customer@1 does not match requested snapshot commerce_ai@reg-2026-07-01')
  })
})
