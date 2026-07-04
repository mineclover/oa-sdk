import type { SchemaSourceCoordinate } from '@oa-sdk/openapi-projection-contract'

import { createPostgresCatalogSnapshot } from './postgres.js'
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

export type PostgresCatalogProfileRecordKind =
  | 'schema'
  | 'table'
  | 'column'
  | 'primary_key'
  | 'foreign_key'
  | 'index'

export type PostgresCatalogProfileRow = {
  record_kind: PostgresCatalogProfileRecordKind
  schema_name: string
  schema_owner?: string
  table_name?: string
  table_kind?: CatalogTable['kind']
  column_name?: string
  data_type?: string
  is_nullable?: boolean
  ordinal_position?: number
  default_value?: string
  constraint_name?: string
  constraint_columns?: string[]
  referenced_schema_name?: string
  referenced_table_name?: string
  referenced_columns?: string[]
  on_delete?: string
  on_update?: string
  index_name?: string
  index_columns?: string[]
  index_unique?: boolean
  index_method?: string
  index_predicate?: string
  index_primary?: boolean
}

export type PostgresCatalogRowsToSnapshotInput = {
  database: string
  rows: readonly PostgresCatalogProfileRow[]
  capturedAt?: string
}

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
    sources: createSourceMap(input.rows),
  })
}

function rowToSchema(row: PostgresCatalogProfileRow): CatalogSchema {
  return {
    name: row.schema_name,
    ...(row.schema_owner ? { owner: row.schema_owner } : {}),
    source: dbSource('schema', row.schema_name, `#/schemas/${row.schema_name}`),
  }
}

function rowToTable(row: PostgresCatalogProfileRow): CatalogTable {
  const table = tableId(row)
  return {
    schema: row.schema_name,
    name: requireField(row.table_name, row, 'table_name'),
    table,
    kind: requireField(row.table_kind, row, 'table_kind'),
    source: dbSource('table', table, `#/tables/${table}`),
  }
}

function rowToColumn(row: PostgresCatalogProfileRow): CatalogColumn {
  const table = tableId(row)
  const columnName = requireField(row.column_name, row, 'column_name')
  return {
    table,
    name: columnName,
    dataType: requireField(row.data_type, row, 'data_type'),
    nullable: requireField(row.is_nullable, row, 'is_nullable'),
    ordinal: requireField(row.ordinal_position, row, 'ordinal_position'),
    ...(row.default_value !== undefined ? { defaultValue: row.default_value } : {}),
    source: dbSource('column', `${table}.${columnName}`, `#/columns/${table}.${columnName}`),
  }
}

function rowToPrimaryKey(
  row: PostgresCatalogProfileRow & Required<Pick<PostgresCatalogProfileRow, 'table_name' | 'constraint_name' | 'constraint_columns'>>,
): CatalogPrimaryKey {
  const table = tableId(row)
  return {
    table,
    name: row.constraint_name,
    columns: [...row.constraint_columns],
    source: dbSource('constraint', `${table}.${row.constraint_name}`, `#/primaryKeys/${table}.${row.constraint_name}`),
  }
}

function rowToForeignKey(row: PostgresCatalogProfileRow): CatalogForeignKey {
  const table = tableId(row)
  const name = requireField(row.constraint_name, row, 'constraint_name')
  const referencedTable = `${requireField(row.referenced_schema_name, row, 'referenced_schema_name')}.${requireField(
    row.referenced_table_name,
    row,
    'referenced_table_name',
  )}`

  return {
    table,
    name,
    columns: [...requireField(row.constraint_columns, row, 'constraint_columns')],
    referencedTable,
    referencedColumns: [...requireField(row.referenced_columns, row, 'referenced_columns')],
    enforced: true,
    ...(row.on_delete ? { onDelete: row.on_delete } : {}),
    ...(row.on_update ? { onUpdate: row.on_update } : {}),
    source: dbSource('constraint', `${table}.${name}`, `#/foreignKeys/${table}.${name}`),
  }
}

function rowToIndex(
  row: PostgresCatalogProfileRow & Required<Pick<PostgresCatalogProfileRow, 'table_name' | 'index_name' | 'index_columns'>>,
): CatalogIndex {
  const table = tableId(row)
  return {
    table,
    name: row.index_name,
    columns: [...row.index_columns],
    unique: row.index_unique === true,
    ...(row.index_method ? { method: row.index_method } : {}),
    ...(row.index_predicate ? { predicate: row.index_predicate } : {}),
    source: dbSource('index', `${table}.${row.index_name}`, `#/indexes/${table}.${row.index_name}`),
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

function createSourceMap(rows: readonly PostgresCatalogProfileRow[]) {
  const sources: Record<string, SchemaSourceCoordinate> = {}

  for (const row of rows) {
    if (row.record_kind === 'schema') {
      sources[`schema:${row.schema_name}`] = dbSource('schema', row.schema_name, `#/schemas/${row.schema_name}`)
    }
    if (row.table_name) {
      const table = tableId(row)
      sources[`table:${table}`] = dbSource('table', table, `#/tables/${table}`)
    }
    if (row.record_kind === 'column' && row.column_name) {
      const column = `${tableId(row)}.${row.column_name}`
      sources[`column:${column}`] = dbSource('column', column, `#/columns/${column}`)
    }
  }

  return sources
}

function tableId(row: PostgresCatalogProfileRow): string {
  return `${row.schema_name}.${requireField(row.table_name, row, 'table_name')}`
}

function dbSource(entity: string, id: string, pointer: string) {
  return {
    kind: 'db' as const,
    entity,
    id,
    pointer,
  }
}

function requireField<T>(value: T | undefined, row: PostgresCatalogProfileRow, field: string): T {
  if (value === undefined) {
    throw new Error(`PostgreSQL catalog ${row.record_kind} row for schema ${row.schema_name} is missing ${field}`)
  }
  return value
}
