import { describe, expect, it } from 'vitest'

import {
  createPostgresCatalogSnapshot,
  type PostgresCatalogSnapshotInput,
} from '../src/index.js'
import { readCatalogFixture } from './support/catalog-fixtures.js'

describe('DPM PostgreSQL catalog snapshot', () => {
  it('normalizes a PostgreSQL catalog fixture into deterministic internal ordering', () => {
    const fixture = readCatalogFixture<PostgresCatalogSnapshotInput>('postgres-commerce.json')
    const snapshot = createPostgresCatalogSnapshot(fixture)

    expect(snapshot.kind).toBe('dpm.catalog.snapshot.v1')
    expect(snapshot.source).toEqual({
      kind: 'postgresql',
      database: 'commerce',
      capturedAt: '2026-07-01T00:00:00.000Z',
    })
    expect(snapshot.tables.map(table => table.table)).toEqual(['public.customers', 'public.orders'])
    expect(snapshot.columns.map(column => `${column.table}.${column.name}`)).toEqual([
      'public.customers.customer_no',
      'public.customers.tenant_id',
      'public.orders.order_id',
      'public.orders.customer_no',
      'public.orders.amount',
    ])
    expect(snapshot.primaryKeys).toHaveLength(2)
    expect(snapshot.foreignKeys[0]).toMatchObject({
      table: 'public.orders',
      referencedTable: 'public.customers',
      enforced: false,
    })
    expect(snapshot.indexes.some(index => index.unique)).toBe(true)
    expect(snapshot.uniqueCandidates[0]).toMatchObject({
      table: 'public.customers',
      reason: 'unique_index',
      confidence: 1,
    })
    expect(snapshot.freshness.versionHash).toMatch(/^sha256:[a-f0-9]{64}$/)
  })
})
