import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PostgresCatalogProfileRow } from '../../src/index.js'

const fixturesRoot = new URL('../fixtures/catalog/', import.meta.url)

export function readProfilerPostgresRowsFixture(): PostgresCatalogProfileRow[] {
  return readJsonFixture<PostgresCatalogProfileRow[]>('profiler-postgres-rows.json')
}

export function readProfilerPostgresSqlFixture(): string {
  return readFileSync(join(fixturesRoot.pathname, 'profiler-postgres.sql'), 'utf8')
}

export function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase()
}

function readJsonFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixturesRoot.pathname, name), 'utf8')) as T
}
