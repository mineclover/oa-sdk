import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { OpenApiProjectionResult } from '@oa-sdk/openapi-projection-contract'
import { describe, expect, it } from 'vitest'

import {
  catalogSnapshotFromOpenApiProjection,
  createPostgresCatalogSnapshot,
  normalizeCatalogSnapshot,
  type PostgresCatalogSnapshotInput,
} from '../src/index.js'

const fixturesRoot = new URL('./fixtures/catalog/', import.meta.url)

function readFixture<T>(name: string): T {
  const fixturePath = join(fixturesRoot.pathname, name)
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as T
}

describe('DPM catalog snapshots', () => {
  it('normalizes a PostgreSQL catalog fixture into deterministic internal ordering', () => {
    const fixture = readFixture<PostgresCatalogSnapshotInput>('postgres-commerce.json')
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

  it('changes the freshness hash when catalog structure changes', () => {
    const fixture = readFixture<PostgresCatalogSnapshotInput>('postgres-commerce.json')
    const original = createPostgresCatalogSnapshot(fixture)
    const changed = createPostgresCatalogSnapshot({
      ...fixture,
      columns: fixture.columns?.map(column =>
        column.table === 'public.orders' && column.name === 'amount'
          ? { ...column, nullable: true }
          : column,
      ),
    })

    expect(changed.freshness.versionHash).not.toBe(original.freshness.versionHash)
  })

  it('adapts an OpenAPI projection envelope as structural evidence only', () => {
    const projection = readFixture<OpenApiProjectionResult<Record<string, unknown>>>('projection-commerce.json')
    const snapshot = catalogSnapshotFromOpenApiProjection(projection, {
      projectionRef: 'projections/commerce-openapi.json',
    })

    expect(snapshot.source).toEqual({
      kind: 'openapi_projection',
      profile: 'component-bundle',
      projectionVersionHash: 'sha256:projection-commerce-v1',
      projectionRef: 'projections/commerce-openapi.json',
    })
    expect(snapshot.freshness.sourceVersionHash).toBe('sha256:projection-commerce-v1')
    expect(snapshot.tables.map(table => table.table)).toEqual(['public.customers'])
    expect(snapshot.projection?.typeTargets[0]?.name).toBe('Customer')
    expect('relationships' in snapshot).toBe(false)
    expect(snapshot.uniqueCandidates).toEqual([])
  })

  it('normalizes equivalent snapshots to the same freshness hash', () => {
    const fixture = readFixture<PostgresCatalogSnapshotInput>('postgres-commerce.json')
    const first = createPostgresCatalogSnapshot(fixture)
    const second = normalizeCatalogSnapshot({
      source: {
        kind: 'postgresql',
        database: fixture.database,
        capturedAt: fixture.capturedAt,
      },
      columns: [...(fixture.columns ?? [])].reverse(),
      tables: [...(fixture.tables ?? [])].reverse(),
      schemas: fixture.schemas,
      primaryKeys: fixture.primaryKeys,
      foreignKeys: fixture.foreignKeys,
      indexes: fixture.indexes,
      uniqueCandidates: fixture.uniqueCandidates,
      sources: fixture.sources,
    })

    expect(second.freshness.versionHash).toBe(first.freshness.versionHash)
  })
})
