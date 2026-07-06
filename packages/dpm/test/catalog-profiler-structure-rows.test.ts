import { describe, expect, it } from 'vitest'

import {
  createProfilerPostgresSnapshot,
} from './support/catalog-profiler-fixtures.js'

describe('DPM PostgreSQL catalog profiler structure rows', () => {
  it('maps schema, table, and column rows to catalog snapshot structure', () => {
    const snapshot = createProfilerPostgresSnapshot()

    expect(snapshot.tables.map(table => table.table)).toEqual(['public.customers', 'public.orders'])
    expect(snapshot.columns.map(column => `${column.table}.${column.name}:${column.dataType}:${column.nullable}`)).toEqual([
      'public.customers.customer_no:text:false',
      'public.customers.tenant_id:text:false',
      'public.orders.order_id:bigint:false',
      'public.orders.customer_no:text:false',
      'public.orders.amount:numeric:false',
    ])
  })
})
