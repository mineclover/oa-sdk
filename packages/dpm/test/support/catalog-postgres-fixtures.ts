import {
  createPostgresCatalogSnapshot,
  normalizeCatalogSnapshot,
  type PostgresCatalogSnapshotInput,
} from '../../src/index.js'
import { readCatalogFixture } from './catalog-fixture-io.js'

export const POSTGRES_CATALOG_CAPTURED_AT = '2026-07-01T00:00:00.000Z' as const
export const POSTGRES_CATALOG_FIXTURE_NAME = 'postgres-commerce.json' as const

export const catalogFreshnessVersionHashPattern = /^sha256:[a-f0-9]{64}$/

export const expectedPostgresCatalogSource = {
  kind: 'postgresql',
  database: 'commerce',
  capturedAt: POSTGRES_CATALOG_CAPTURED_AT,
} as const

export const expectedPostgresCatalogTableNames = [
  'public.customers',
  'public.orders',
] as const

export const expectedPostgresCatalogColumnNames = [
  'public.customers.customer_no',
  'public.customers.tenant_id',
  'public.orders.order_id',
  'public.orders.customer_no',
  'public.orders.amount',
] as const

export const expectedPostgresCatalogForeignKey = {
  table: 'public.orders',
  referencedTable: 'public.customers',
  enforced: false,
} as const

export const expectedPostgresCatalogUniqueCandidate = {
  table: 'public.customers',
  reason: 'unique_index',
  confidence: 1,
} as const

export function readPostgresCatalogFixture(): PostgresCatalogSnapshotInput {
  return readCatalogFixture<PostgresCatalogSnapshotInput>(POSTGRES_CATALOG_FIXTURE_NAME)
}

export function createChangedPostgresCatalogSnapshot() {
  const fixture = readPostgresCatalogFixture()
  return createPostgresCatalogSnapshot({
    ...fixture,
    columns: fixture.columns?.map(column =>
      column.table === 'public.orders' && column.name === 'amount'
        ? { ...column, nullable: true }
        : column,
    ),
  })
}

export function createReorderedPostgresCatalogSnapshot() {
  const fixture = readPostgresCatalogFixture()
  return normalizeCatalogSnapshot({
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
}
