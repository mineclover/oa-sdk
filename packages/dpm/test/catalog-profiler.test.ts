import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  POSTGRES_CATALOG_PROFILE_SQL,
  postgresCatalogRowsToSnapshot,
  profilePostgresCatalog,
  type PostgresCatalogProfileRow,
} from '../src/index.js'

const fixturesRoot = new URL('./fixtures/catalog/', import.meta.url)

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixturesRoot.pathname, name), 'utf8')) as T
}

function readTextFixture(name: string): string {
  return readFileSync(join(fixturesRoot.pathname, name), 'utf8')
}

describe('DPM PostgreSQL catalog profiler', () => {
  it('defines a read-only PostgreSQL catalog profile query', () => {
    const sql = normalizeSql(POSTGRES_CATALOG_PROFILE_SQL)
    const fixtureSql = normalizeSql(readTextFixture('profiler-postgres.sql'))

    expect(sql).toBe(fixtureSql)
    expect(sql).toContain('pg_catalog.pg_namespace')
    expect(sql).toContain('pg_catalog.pg_class')
    expect(sql).toContain('pg_catalog.pg_attribute')
    expect(sql).toContain('pg_catalog.pg_constraint')
    expect(sql).toContain('pg_catalog.pg_index')
    expect(sql).toContain('pg_catalog.pg_get_expr')
    expect(sql).toContain('n.nspname = any($1::text[])')
    expect(sql).not.toMatch(/\b(insert|update|delete|drop|truncate|alter|create)\b/)
  })

  it('maps PostgreSQL catalog rows to the existing catalog snapshot contract', () => {
    const rows = readFixture<PostgresCatalogProfileRow[]>('profiler-postgres-rows.json')
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

  it('profiles through an explicit read-only query client and schema filter', async () => {
    const rows = readFixture<PostgresCatalogProfileRow[]>('profiler-postgres-rows.json')
    const query = vi.fn(async () => rows)

    const snapshot = await profilePostgresCatalog({
      database: 'commerce',
      capturedAt: '2026-07-01T00:00:00.000Z',
      schemas: ['public'],
      client: { query },
    })

    expect(query).toHaveBeenCalledWith(POSTGRES_CATALOG_PROFILE_SQL, [['public']])
    expect(snapshot.tables.map(table => table.table)).toEqual(['public.customers', 'public.orders'])
  })

  it('changes freshness when profiled structural rows change', () => {
    const rows = readFixture<PostgresCatalogProfileRow[]>('profiler-postgres-rows.json')
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

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase()
}
