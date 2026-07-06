import { describe, expect, it } from 'vitest'

import {
  createProfilerPostgresSnapshot,
} from './support/catalog-profiler-fixtures.js'

describe('DPM PostgreSQL catalog profiler source map', () => {
  it('maps database source coordinates into catalog source pointers', () => {
    const snapshot = createProfilerPostgresSnapshot()

    expect(snapshot.sources['table:public.orders']).toEqual({
      kind: 'db',
      entity: 'table',
      id: 'public.orders',
      pointer: '#/tables/public.orders',
    })
  })
})
