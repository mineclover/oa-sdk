import { createPostgresCatalogSnapshot } from './postgres.js'
import type {
  PostgresCatalogProfileRow,
  PostgresCatalogRowsToSnapshotInput,
} from './profiler-postgres-row-types.js'
import {
  createPostgresDbSource,
  postgresCatalogTableId,
  requirePostgresCatalogField,
} from './profiler-postgres-row-utils.js'
import { createPostgresCatalogSourceMap } from './profiler-postgres-sources.js'
import type {
  CatalogColumn,
  CatalogForeignKey,
  CatalogIndex,
  CatalogPrimaryKey,
  CatalogSchema,
  CatalogSnapshot,
  CatalogTable,
  CatalogUniqueCandidate,
} from './types.js'

export type {
  PostgresCatalogProfileRecordKind,
  PostgresCatalogProfileRow,
  PostgresCatalogRowsToSnapshotInput,
} from './profiler-postgres-row-types.js'

export function postgresCatalogRowsToSnapshot(input: PostgresCatalogRowsToSnapshotInput): CatalogSnapshot {
  const primaryKeys = input.rows
    .filter((row): row is PostgresCatalogProfileRow & Required<Pick<PostgresCatalogProfileRow, 'table_name' | 'constraint_name' | 'constraint_columns'>> =>
      row.record_kind === 'primary_key',
    )
    .map(rowToPrimaryKey)
  const indexes = input.rows
    .filter((row): row is PostgresCatalogProfileRow & Required<Pick<PostgresCatalogProfileRow, 'table_name' | 'index_name' | 'index_columns'>> =>
      row.record_kind === 'index',
    )
    .map(rowToIndex)

  return createPostgresCatalogSnapshot({
    database: input.database,
    ...(input.capturedAt ? { capturedAt: input.capturedAt } : {}),
    schemas: input.rows.filter(row => row.record_kind === 'schema').map(rowToSchema),
    tables: input.rows.filter(row => row.record_kind === 'table').map(rowToTable),
    columns: input.rows.filter(row => row.record_kind === 'column').map(rowToColumn),
    primaryKeys,
    foreignKeys: input.rows.filter(row => row.record_kind === 'foreign_key').map(rowToForeignKey),
    indexes,
    uniqueCandidates: [
      ...primaryKeys.map(primaryKeyToUniqueCandidate),
      ...indexes.filter(index => index.unique).map(indexToUniqueCandidate),
    ],
    sources: createPostgresCatalogSourceMap(input.rows),
  })
}

function rowToSchema(row: PostgresCatalogProfileRow): CatalogSchema {
  return {
    name: row.schema_name,
    ...(row.schema_owner ? { owner: row.schema_owner } : {}),
    source: createPostgresDbSource('schema', row.schema_name, `#/schemas/${row.schema_name}`),
  }
}

function rowToTable(row: PostgresCatalogProfileRow): CatalogTable {
  const table = postgresCatalogTableId(row)
  return {
    schema: row.schema_name,
    name: requirePostgresCatalogField(row.table_name, row, 'table_name'),
    table,
    kind: requirePostgresCatalogField(row.table_kind, row, 'table_kind'),
    source: createPostgresDbSource('table', table, `#/tables/${table}`),
  }
}

function rowToColumn(row: PostgresCatalogProfileRow): CatalogColumn {
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

function rowToPrimaryKey(
  row: PostgresCatalogProfileRow & Required<Pick<PostgresCatalogProfileRow, 'table_name' | 'constraint_name' | 'constraint_columns'>>,
): CatalogPrimaryKey {
  const table = postgresCatalogTableId(row)
  return {
    table,
    name: row.constraint_name,
    columns: [...row.constraint_columns],
    source: createPostgresDbSource('constraint', `${table}.${row.constraint_name}`, `#/primaryKeys/${table}.${row.constraint_name}`),
  }
}

function rowToForeignKey(row: PostgresCatalogProfileRow): CatalogForeignKey {
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

function rowToIndex(
  row: PostgresCatalogProfileRow & Required<Pick<PostgresCatalogProfileRow, 'table_name' | 'index_name' | 'index_columns'>>,
): CatalogIndex {
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

function primaryKeyToUniqueCandidate(primaryKey: CatalogPrimaryKey): CatalogUniqueCandidate {
  return {
    table: primaryKey.table,
    name: `${primaryKey.name}_unique_candidate`,
    columns: [...primaryKey.columns],
    reason: 'primary_key',
    confidence: 1,
    ...(primaryKey.source ? { source: primaryKey.source } : {}),
  }
}

function indexToUniqueCandidate(index: CatalogIndex): CatalogUniqueCandidate {
  return {
    table: index.table,
    name: `${index.name}_unique_candidate`,
    columns: [...index.columns],
    reason: 'unique_index',
    confidence: 1,
    ...(index.source ? { source: index.source } : {}),
  }
}
