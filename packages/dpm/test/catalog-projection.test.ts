import type { OpenApiProjectionResult } from '@oa-sdk/openapi-projection-contract'
import { describe, expect, it } from 'vitest'

import { catalogSnapshotFromOpenApiProjection } from '../src/index.js'
import { readCatalogFixture } from './support/catalog-fixtures.js'

describe('DPM OpenAPI projection catalog adapter', () => {
  it('adapts an OpenAPI projection envelope as structural evidence only', () => {
    const projection = readCatalogFixture<OpenApiProjectionResult<Record<string, unknown>>>('projection-commerce.json')
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
})
