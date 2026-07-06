import type { PostgresCatalogProfileRow } from '../../src/index.js'
import {
  postgresCatalogRowsToSnapshot,
} from '../../src/index.js'
import {
  readDpmJsonFixture,
  readDpmTextFixture,
} from './fixture-io.js'

export function readProfilerPostgresRowsFixture(): PostgresCatalogProfileRow[] {
  return readDpmJsonFixture<PostgresCatalogProfileRow[]>('catalog/profiler-postgres-rows.json')
}

export function createProfilerPostgresSnapshot(input: { capturedAt?: string } = {}) {
  return postgresCatalogRowsToSnapshot({
    database: 'commerce',
    capturedAt: input.capturedAt,
    rows: readProfilerPostgresRowsFixture(),
  })
}

export function readProfilerPostgresSqlFixture(): string {
  return readDpmTextFixture('catalog/profiler-postgres.sql')
}

export function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase()
}
