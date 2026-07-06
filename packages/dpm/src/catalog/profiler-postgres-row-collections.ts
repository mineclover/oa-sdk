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
import type { PostgresCatalogProfileRow } from './profiler-postgres-row-types.js'
import { createPostgresCatalogSourceMap } from './profiler-postgres-sources.js'
import {
  indexToUniqueCandidate,
  primaryKeyToUniqueCandidate,
} from './profiler-postgres-unique-candidates.js'
import type { PostgresCatalogSnapshotInput } from './snapshot-input-types.js'

export type PostgresCatalogRowCollections = Pick<
  PostgresCatalogSnapshotInput,
  | 'schemas'
  | 'tables'
  | 'columns'
  | 'primaryKeys'
  | 'foreignKeys'
  | 'indexes'
  | 'uniqueCandidates'
  | 'sources'
>

export function collectPostgresCatalogRows(
  rows: readonly PostgresCatalogProfileRow[],
): PostgresCatalogRowCollections {
  const primaryKeys = rows.filter(isPrimaryKeyProfileRow).map(rowToPrimaryKey)
  const indexes = rows.filter(isIndexProfileRow).map(rowToIndex)

  return {
    schemas: rows.filter(isSchemaProfileRow).map(rowToSchema),
    tables: rows.filter(isTableProfileRow).map(rowToTable),
    columns: rows.filter(isColumnProfileRow).map(rowToColumn),
    primaryKeys,
    foreignKeys: rows.filter(isForeignKeyProfileRow).map(rowToForeignKey),
    indexes,
    uniqueCandidates: [
      ...primaryKeys.map(primaryKeyToUniqueCandidate),
      ...indexes.filter(index => index.unique).map(indexToUniqueCandidate),
    ],
    sources: createPostgresCatalogSourceMap(rows),
  }
}
