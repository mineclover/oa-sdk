import { describe, expect, it } from 'vitest'

import {
  createProfilerPostgresSnapshot,
} from './support/catalog-profiler-fixtures.js'

describe('DPM PostgreSQL catalog profiler integrity rows', () => {
  it('maps primary keys, foreign keys, indexes, and unique candidates', () => {
    const snapshot = createProfilerPostgresSnapshot()

    expect(snapshot.primaryKeys.map(primaryKey => `${primaryKey.table}.${primaryKey.name}`)).toEqual([
      'public.customers.customers_pkey',
      'public.orders.orders_pkey',
    ])
    expect(snapshot.foreignKeys[0]).toMatchObject({
      table: 'public.orders',
      name: 'orders_customer_no_fkey',
      columns: ['customer_no'],
      referencedTable: 'public.customers',
      referencedColumns: ['customer_no'],
      enforced: true,
      onDelete: 'no_action',
      onUpdate: 'no_action',
    })
    expect(snapshot.indexes.map(index => `${index.table}.${index.name}:${index.method}:${index.unique}`)).toEqual([
      'public.customers.customers_customer_no_idx:btree:true',
      'public.orders.orders_customer_no_idx:btree:false',
    ])
    expect(snapshot.uniqueCandidates.map(candidate => `${candidate.table}.${candidate.name}:${candidate.reason}`)).toEqual([
      'public.customers.customers_customer_no_idx_unique_candidate:unique_index',
      'public.customers.customers_pkey_unique_candidate:primary_key',
      'public.orders.orders_pkey_unique_candidate:primary_key',
    ])
  })
})
