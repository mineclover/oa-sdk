import { describe, expect, it } from 'vitest'

import {
  createPostgresCatalogSnapshot,
  normalizeCatalogSnapshot,
} from '../src/index.js'
import {
  createChangedPostgresCatalogSnapshot,
  createReorderedPostgresCatalogSnapshot,
} from './support/catalog-postgres-freshness-fixtures.js'
import { readPostgresCatalogFixture } from './support/catalog-postgres-input-fixtures.js'

describe('DPM catalog snapshot freshness', () => {
  it('changes the freshness hash when catalog structure changes', () => {
    const fixture = readPostgresCatalogFixture()
    const original = createPostgresCatalogSnapshot(fixture)
    const changed = createChangedPostgresCatalogSnapshot()

    expect(changed.freshness.versionHash).not.toBe(original.freshness.versionHash)
  })

  it('normalizes equivalent snapshots to the same freshness hash', () => {
    const fixture = readPostgresCatalogFixture()
    const first = createPostgresCatalogSnapshot(fixture)
    const second = createReorderedPostgresCatalogSnapshot()

    expect(second.freshness.versionHash).toBe(first.freshness.versionHash)
  })

  it('preserves explicit Cloudflare D1 read-only catalog provenance', () => {
    const snapshot = normalizeCatalogSnapshot({
      source: {
        kind: 'cloudflare_d1',
        database: 'erd-control-plane',
        databaseId: 'd1-example',
        accountId: 'account-example',
        capturedAt: '2026-07-29T00:00:00.000Z',
      },
      schemas: [{ name: 'main' }],
    })

    expect(snapshot.source).toEqual({
      kind: 'cloudflare_d1',
      database: 'erd-control-plane',
      databaseId: 'd1-example',
      accountId: 'account-example',
      capturedAt: '2026-07-29T00:00:00.000Z',
    })
  })
})
