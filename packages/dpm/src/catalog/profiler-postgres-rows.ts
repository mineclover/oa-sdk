import { createPostgresCatalogSnapshot } from './postgres.js'
import type {
  PostgresCatalogRowsToSnapshotInput,
} from './profiler-postgres-row-types.js'
import {
  isColumnProfileRow,
  isForeignKeyProfileRow,
  isIndexProfileRow,
  isPrimaryKeyProfileRow,
  isSchemaProfileRow,
  isTableProfileRow,
} from './profiler-postgres-row-filters.js'
import {
  rowToColumn,
  rowToForeignKey,
  rowToIndex,
  rowToPrimaryKey,
  rowToSchema,
  rowToTable,
} from './profiler-postgres-row-mappers.js'
import { createPostgresCatalogSourceMap } from './profiler-postgres-sources.js'
import type {
  CatalogSnapshot,
} from './snapshot-types.js'
import {
  indexToUniqueCandidate,
  primaryKeyToUniqueCandidate,
} from './profiler-postgres-unique-candidates.js'

export type {
  PostgresCatalogProfileRecordKind,
  PostgresCatalogProfileRow,
  PostgresCatalogRowsToSnapshotInput,
} from './profiler-postgres-row-types.js'

export function postgresCatalogRowsToSnapshot(input: PostgresCatalogRowsToSnapshotInput): CatalogSnapshot {
  const primaryKeys = input.rows.filter(isPrimaryKeyProfileRow).map(rowToPrimaryKey)
  const indexes = input.rows.filter(isIndexProfileRow).map(rowToIndex)

  return createPostgresCatalogSnapshot({
    database: input.database,
    ...(input.capturedAt ? { capturedAt: input.capturedAt } : {}),
    schemas: input.rows.filter(isSchemaProfileRow).map(rowToSchema),
    tables: input.rows.filter(isTableProfileRow).map(rowToTable),
    columns: input.rows.filter(isColumnProfileRow).map(rowToColumn),
    primaryKeys,
    foreignKeys: input.rows.filter(isForeignKeyProfileRow).map(rowToForeignKey),
    indexes,
    uniqueCandidates: [
      ...primaryKeys.map(primaryKeyToUniqueCandidate),
      ...indexes.filter(index => index.unique).map(indexToUniqueCandidate),
    ],
    sources: createPostgresCatalogSourceMap(input.rows),
  })
}
