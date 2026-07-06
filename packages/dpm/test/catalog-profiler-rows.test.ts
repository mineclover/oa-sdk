import { describe, expect, it } from 'vitest'

import {
  createProfilerPostgresSnapshot,
} from './support/catalog-profiler-fixtures.js'

describe('DPM PostgreSQL catalog profiler rows', () => {
  it('maps PostgreSQL catalog rows to the catalog snapshot envelope', () => {
    const snapshot = createProfilerPostgresSnapshot({
      capturedAt: '2026-07-01T00:00:00.000Z',
    })

    expect(snapshot.kind).toBe('dpm.catalog.snapshot.v1')
    expect(snapshot.source).toEqual({
      kind: 'postgresql',
      database: 'commerce',
      capturedAt: '2026-07-01T00:00:00.000Z',
    })
    expect(snapshot.freshness.versionHash).toMatch(/^sha256:[a-f0-9]{64}$/)
  })
})
