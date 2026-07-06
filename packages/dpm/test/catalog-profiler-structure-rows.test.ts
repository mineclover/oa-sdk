import { describe, expect, it } from 'vitest'

import {
  createProfilerPostgresSnapshot,
  expectedProfilerPostgresColumnSummaries,
  expectedProfilerPostgresTableNames,
} from './support/catalog-profiler-fixtures.js'

describe('DPM PostgreSQL catalog profiler structure rows', () => {
  it('maps schema, table, and column rows to catalog snapshot structure', () => {
    const snapshot = createProfilerPostgresSnapshot()

    expect(snapshot.tables.map(table => table.table)).toEqual([...expectedProfilerPostgresTableNames])
    expect(snapshot.columns.map(column => `${column.table}.${column.name}:${column.dataType}:${column.nullable}`)).toEqual([
      ...expectedProfilerPostgresColumnSummaries,
    ])
  })
})
