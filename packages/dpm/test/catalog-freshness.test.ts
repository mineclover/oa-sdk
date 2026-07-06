import { describe, expect, it } from 'vitest'

import {
  createPostgresCatalogSnapshot,
  normalizeCatalogSnapshot,
  type PostgresCatalogSnapshotInput,
} from '../src/index.js'
import { readCatalogFixture } from './support/catalog-fixtures.js'

describe('DPM catalog snapshot freshness', () => {
  it('changes the freshness hash when catalog structure changes', () => {
    const fixture = readCatalogFixture<PostgresCatalogSnapshotInput>('postgres-commerce.json')
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

  it('normalizes equivalent snapshots to the same freshness hash', () => {
    const fixture = readCatalogFixture<PostgresCatalogSnapshotInput>('postgres-commerce.json')
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
