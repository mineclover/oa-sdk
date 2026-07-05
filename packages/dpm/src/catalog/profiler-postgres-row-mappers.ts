import type {
  PostgresCatalogProfileRow,
} from './profiler-postgres-row-types.js'
import {
  createPostgresDbSource,
  postgresCatalogTableId,
  requirePostgresCatalogField,
} from './profiler-postgres-row-utils.js'
import type {
  PostgresIndexProfileRow,
  PostgresPrimaryKeyProfileRow,
} from './profiler-postgres-row-filters.js'
import type {
  CatalogColumn,
  CatalogForeignKey,
  CatalogIndex,
  CatalogPrimaryKey,
  CatalogSchema,
  CatalogTable,
} from './types.js'

export function rowToSchema(row: PostgresCatalogProfileRow): CatalogSchema {
  return {
    name: row.schema_name,
    ...(row.schema_owner ? { owner: row.schema_owner } : {}),
    source: createPostgresDbSource('schema', row.schema_name, `#/schemas/${row.schema_name}`),
  }
}

export function rowToTable(row: PostgresCatalogProfileRow): CatalogTable {
  const table = postgresCatalogTableId(row)
  return {
    schema: row.schema_name,
    name: requirePostgresCatalogField(row.table_name, row, 'table_name'),
    table,
    kind: requirePostgresCatalogField(row.table_kind, row, 'table_kind'),
    source: createPostgresDbSource('table', table, `#/tables/${table}`),
  }
}

export function rowToColumn(row: PostgresCatalogProfileRow): CatalogColumn {
  const table = postgresCatalogTableId(row)
  const columnName = requirePostgresCatalogField(row.column_name, row, 'column_name')
  return {
    table,
    name: columnName,
    dataType: requirePostgresCatalogField(row.data_type, row, 'data_type'),
    nullable: requirePostgresCatalogField(row.is_nullable, row, 'is_nullable'),
    ordinal: requirePostgresCatalogField(row.ordinal_position, row, 'ordinal_position'),
    ...(row.default_value !== undefined ? { defaultValue: row.default_value } : {}),
    source: createPostgresDbSource('column', `${table}.${columnName}`, `#/columns/${table}.${columnName}`),
  }
}

export function rowToPrimaryKey(row: PostgresPrimaryKeyProfileRow): CatalogPrimaryKey {
  const table = postgresCatalogTableId(row)
  return {
    table,
    name: row.constraint_name,
    columns: [...row.constraint_columns],
    source: createPostgresDbSource('constraint', `${table}.${row.constraint_name}`, `#/primaryKeys/${table}.${row.constraint_name}`),
  }
}

export function rowToForeignKey(row: PostgresCatalogProfileRow): CatalogForeignKey {
  const table = postgresCatalogTableId(row)
  const name = requirePostgresCatalogField(row.constraint_name, row, 'constraint_name')
  const referencedTable = `${requirePostgresCatalogField(row.referenced_schema_name, row, 'referenced_schema_name')}.${requirePostgresCatalogField(
    row.referenced_table_name,
    row,
    'referenced_table_name',
  )}`

  return {
    table,
    name,
    columns: [...requirePostgresCatalogField(row.constraint_columns, row, 'constraint_columns')],
    referencedTable,
    referencedColumns: [...requirePostgresCatalogField(row.referenced_columns, row, 'referenced_columns')],
    enforced: true,
    ...(row.on_delete ? { onDelete: row.on_delete } : {}),
    ...(row.on_update ? { onUpdate: row.on_update } : {}),
    source: createPostgresDbSource('constraint', `${table}.${name}`, `#/foreignKeys/${table}.${name}`),
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
    source: createPostgresDbSource('index', `${table}.${row.index_name}`, `#/indexes/${table}.${row.index_name}`),
  }
}
