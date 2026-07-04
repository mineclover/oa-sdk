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

export const POSTGRES_CATALOG_PROFILE_SQL = `with
selected_namespaces as (
  select
    n.oid as schema_oid,
    n.nspname as schema_name,
    pg_catalog.pg_get_userbyid(n.nspowner) as schema_owner
  from pg_catalog.pg_namespace n
  where n.nspname = any($1::text[])
),
relations as (
  select
    c.oid as relation_oid,
    ns.schema_name,
    c.relname as table_name,
    case c.relkind
      when 'r' then 'table'
      when 'p' then 'table'
      when 'v' then 'view'
      when 'm' then 'materialized_view'
    end as table_kind
  from pg_catalog.pg_class c
  join selected_namespaces ns on ns.schema_oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm')
),
constraint_columns as (
  select
    con.oid as constraint_oid,
    array_agg(att.attname order by ord.ordinality) as columns
  from pg_catalog.pg_constraint con
  join pg_catalog.pg_attribute att on att.attrelid = con.conrelid
  join unnest(con.conkey) with ordinality as ord(attnum, ordinality) on ord.attnum = att.attnum
  group by con.oid
),
referenced_constraint_columns as (
  select
    con.oid as constraint_oid,
    array_agg(att.attname order by ord.ordinality) as columns
  from pg_catalog.pg_constraint con
  join pg_catalog.pg_attribute att on att.attrelid = con.confrelid
  join unnest(con.confkey) with ordinality as ord(attnum, ordinality) on ord.attnum = att.attnum
  group by con.oid
),
index_columns as (
  select
    i.indexrelid,
    array_agg(att.attname order by ord.ordinality) as columns
  from pg_catalog.pg_index i
  join pg_catalog.pg_attribute att on att.attrelid = i.indrelid
  join unnest(i.indkey) with ordinality as ord(attnum, ordinality) on ord.attnum = att.attnum
  where ord.attnum > 0
  group by i.indexrelid
)
select
  'schema' as record_kind,
  ns.schema_name,
  ns.schema_owner,
  null::text as table_name,
  null::text as table_kind,
  null::text as column_name,
  null::text as data_type,
  null::boolean as is_nullable,
  null::integer as ordinal_position,
  null::text as default_value,
  null::text as constraint_name,
  null::text[] as constraint_columns,
  null::text as referenced_schema_name,
  null::text as referenced_table_name,
  null::text[] as referenced_columns,
  null::text as on_delete,
  null::text as on_update,
  null::text as index_name,
  null::text[] as index_columns,
  null::boolean as index_unique,
  null::text as index_method,
  null::text as index_predicate,
  null::boolean as index_primary
from selected_namespaces ns
union all
select
  'table' as record_kind,
  r.schema_name,
  null::text as schema_owner,
  r.table_name,
  r.table_kind,
  null::text,
  null::text,
  null::boolean,
  null::integer,
  null::text,
  null::text,
  null::text[],
  null::text,
  null::text,
  null::text[],
  null::text,
  null::text,
  null::text,
  null::text[],
  null::boolean,
  null::text,
  null::text,
  null::boolean
from relations r
union all
select
  'column' as record_kind,
  r.schema_name,
  null::text,
  r.table_name,
  null::text,
  a.attname as column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
  a.attnotnull = false as is_nullable,
  a.attnum as ordinal_position,
  pg_catalog.pg_get_expr(def.adbin, def.adrelid) as default_value,
  null::text,
  null::text[],
  null::text,
  null::text,
  null::text[],
  null::text,
  null::text,
  null::text,
  null::text[],
  null::boolean,
  null::text,
  null::text,
  null::boolean
from relations r
join pg_catalog.pg_attribute a on a.attrelid = r.relation_oid
left join pg_catalog.pg_attrdef def on def.adrelid = a.attrelid and def.adnum = a.attnum
where a.attnum > 0 and not a.attisdropped
union all
select
  'primary_key' as record_kind,
  r.schema_name,
  null::text,
  r.table_name,
  null::text,
  null::text,
  null::text,
  null::boolean,
  null::integer,
  null::text,
  con.conname as constraint_name,
  cc.columns as constraint_columns,
  null::text,
  null::text,
  null::text[],
  null::text,
  null::text,
  null::text,
  null::text[],
  null::boolean,
  null::text,
  null::text,
  null::boolean
from pg_catalog.pg_constraint con
join relations r on r.relation_oid = con.conrelid
join constraint_columns cc on cc.constraint_oid = con.oid
where con.contype = 'p'
union all
select
  'foreign_key' as record_kind,
  r.schema_name,
  null::text,
  r.table_name,
  null::text,
  null::text,
  null::text,
  null::boolean,
  null::integer,
  null::text,
  con.conname as constraint_name,
  cc.columns as constraint_columns,
  ref.schema_name as referenced_schema_name,
  ref.table_name as referenced_table_name,
  rcc.columns as referenced_columns,
  lower(replace(con.confdeltype::text, 'a', 'no_action')) as on_delete,
  lower(replace(con.confupdtype::text, 'a', 'no_action')) as on_update,
  null::text,
  null::text[],
  null::boolean,
  null::text,
  null::text,
  null::boolean
from pg_catalog.pg_constraint con
join relations r on r.relation_oid = con.conrelid
join relations ref on ref.relation_oid = con.confrelid
join constraint_columns cc on cc.constraint_oid = con.oid
join referenced_constraint_columns rcc on rcc.constraint_oid = con.oid
where con.contype = 'f'
union all
select
  'index' as record_kind,
  r.schema_name,
  null::text,
  r.table_name,
  null::text,
  null::text,
  null::text,
  null::boolean,
  null::integer,
  null::text,
  null::text,
  null::text[],
  null::text,
  null::text,
  null::text[],
  null::text,
  null::text,
  ic.relname as index_name,
  idxc.columns as index_columns,
  i.indisunique as index_unique,
  am.amname as index_method,
  pg_catalog.pg_get_expr(i.indpred, i.indrelid) as index_predicate,
  i.indisprimary as index_primary
from pg_catalog.pg_index i
join relations r on r.relation_oid = i.indrelid
join pg_catalog.pg_class ic on ic.oid = i.indexrelid
join pg_catalog.pg_am am on am.oid = ic.relam
join index_columns idxc on idxc.indexrelid = i.indexrelid
where not i.indisprimary
order by record_kind, schema_name, table_name, column_name, constraint_name, index_name;
`

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

export type PostgresCatalogProfilerClient = {
  query<T>(sql: string, parameters: readonly unknown[]): Promise<readonly T[] | { rows: readonly T[] }>
}

export type PostgresCatalogProfilerInput = {
  database: string
  schemas: readonly string[]
  client: PostgresCatalogProfilerClient
  capturedAt?: string
}

export type PostgresCatalogRowsToSnapshotInput = {
  database: string
  rows: readonly PostgresCatalogProfileRow[]
  capturedAt?: string
}

export async function profilePostgresCatalog(input: PostgresCatalogProfilerInput): Promise<CatalogSnapshot> {
  const result = await input.client.query<PostgresCatalogProfileRow>(POSTGRES_CATALOG_PROFILE_SQL, [input.schemas])
  const rows = isRowsEnvelope(result) ? result.rows : result

  return postgresCatalogRowsToSnapshot({
    database: input.database,
    rows,
    ...(input.capturedAt ? { capturedAt: input.capturedAt } : {}),
  })
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

function isRowsEnvelope<T>(result: readonly T[] | { rows: readonly T[] }): result is { rows: readonly T[] } {
  return !Array.isArray(result)
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
