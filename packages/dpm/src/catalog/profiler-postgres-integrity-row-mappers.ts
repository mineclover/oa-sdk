import type {
  PostgresCatalogProfileRow,
} from './profiler-postgres-row-types.js'
import type {
  PostgresIndexProfileRow,
  PostgresPrimaryKeyProfileRow,
} from './profiler-postgres-row-filters.js'
import {
  createPostgresDbSource,
  postgresCatalogTableId,
  requirePostgresCatalogField,
} from './profiler-postgres-row-utils.js'
import type {
  CatalogForeignKey,
  CatalogIndex,
  CatalogPrimaryKey,
} from './integrity-types.js'

export function rowToPrimaryKey(row: PostgresPrimaryKeyProfileRow): CatalogPrimaryKey {
  const table = postgresCatalogTableId(row)
  return {
    table,
    name: row.constraint_name,
    columns: [...row.constraint_columns],
    source: createPostgresDbSource(
      'constraint',
      `${table}.${row.constraint_name}`,
      `#/primaryKeys/${table}.${row.constraint_name}`,
    ),
  }
}

export function rowToForeignKey(row: PostgresCatalogProfileRow): CatalogForeignKey {
  const table = postgresCatalogTableId(row)
  const name = requirePostgresCatalogField(row.constraint_name, row, 'constraint_name')
  const referencedSchemaName = requirePostgresCatalogField(
    row.referenced_schema_name,
    row,
    'referenced_schema_name',
  )
  const referencedTableName = requirePostgresCatalogField(
    row.referenced_table_name,
    row,
    'referenced_table_name',
  )
  const referencedTable = `${referencedSchemaName}.${referencedTableName}`

  return {
    table,
    name,
    columns: [
      ...requirePostgresCatalogField(row.constraint_columns, row, 'constraint_columns'),
    ],
    referencedTable,
    referencedColumns: [
      ...requirePostgresCatalogField(row.referenced_columns, row, 'referenced_columns'),
    ],
    enforced: true,
    ...(row.on_delete ? { onDelete: row.on_delete } : {}),
    ...(row.on_update ? { onUpdate: row.on_update } : {}),
    source: createPostgresDbSource(
      'constraint',
      `${table}.${name}`,
      `#/foreignKeys/${table}.${name}`,
    ),
  }
}

export function rowToIndex(row: PostgresIndexProfileRow): CatalogIndex {
  const table = postgresCatalogTableId(row)
  return {
    table,
    name: row.index_name,
    columns: [...row.index_columns],
    unique: row.index_unique === true,
    ...(row.index_method ? { method: row.index_method } : {}),
    ...(row.index_predicate ? { predicate: row.index_predicate } : {}),
    source: createPostgresDbSource(
      'index',
      `${table}.${row.index_name}`,
      `#/indexes/${table}.${row.index_name}`,
    ),
  }
}
