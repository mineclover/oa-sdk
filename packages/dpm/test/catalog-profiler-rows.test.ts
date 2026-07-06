import { describe, expect, it } from 'vitest'

import {
  postgresCatalogRowsToSnapshot,
} from '../src/index.js'
import {
  readProfilerPostgresRowsFixture,
} from './support/catalog-profiler-fixtures.js'

describe('DPM PostgreSQL catalog profiler rows', () => {
  it('maps PostgreSQL catalog rows to the existing catalog snapshot contract', () => {
    const rows = readProfilerPostgresRowsFixture()
    const snapshot = postgresCatalogRowsToSnapshot({
      database: 'commerce',
      capturedAt: '2026-07-01T00:00:00.000Z',
      rows,
    })

    expect(snapshot.kind).toBe('dpm.catalog.snapshot.v1')
    expect(snapshot.source).toEqual({
      kind: 'postgresql',
      database: 'commerce',
      capturedAt: '2026-07-01T00:00:00.000Z',
    })
    expect(snapshot.tables.map(table => table.table)).toEqual(['public.customers', 'public.orders'])
    expect(snapshot.columns.map(column => `${column.table}.${column.name}:${column.dataType}:${column.nullable}`)).toEqual([
      'public.customers.customer_no:text:false',
      'public.customers.tenant_id:text:false',
      'public.orders.order_id:bigint:false',
      'public.orders.customer_no:text:false',
      'public.orders.amount:numeric:false',
    ])
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
    expect(snapshot.sources['table:public.orders']).toEqual({
      kind: 'db',
      entity: 'table',
      id: 'public.orders',
      pointer: '#/tables/public.orders',
    })
    expect(snapshot.freshness.versionHash).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('changes freshness when profiled structural rows change', () => {
    const rows = readProfilerPostgresRowsFixture()
    const original = postgresCatalogRowsToSnapshot({ database: 'commerce', rows })
    const changed = postgresCatalogRowsToSnapshot({
      database: 'commerce',
      rows: rows.map(row =>
        row.record_kind === 'column' && row.table_name === 'orders' && row.column_name === 'amount'
          ? { ...row, is_nullable: true }
          : row,
      ),
    })

    expect(changed.freshness.versionHash).not.toBe(original.freshness.versionHash)
  })
})
