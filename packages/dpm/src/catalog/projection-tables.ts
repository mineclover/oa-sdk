import type {
  OpenApiProjectionResult,
  SchemaSourceCoordinate,
} from '@oa-sdk/openapi-projection-contract'

import type {
  CatalogSchema,
  CatalogTable,
} from './structure-types.js'

export function collectProjectionTables(
  projection: OpenApiProjectionResult<Record<string, unknown>>,
): CatalogTable[] {
  const byTable = new Map<string, CatalogTable>()

  for (const source of Object.values(projection.sources)) {
    addTableFromSource(source, byTable)
  }

  for (const target of projection.typeTargets ?? []) {
    if (target.source) addTableFromSource(target.source, byTable)
  }

  return [...byTable.values()]
}

export function collectProjectionSchemas(tables: readonly CatalogTable[]): CatalogSchema[] {
  const names = new Map<string, CatalogSchema>()
  for (const table of tables) {
    if (!names.has(table.schema)) {
      names.set(table.schema, {
        name: table.schema,
      })
    }
  }
  return [...names.values()]
}

function addTableFromSource(
  source: SchemaSourceCoordinate,
  byTable: Map<string, CatalogTable>,
): void {
  if (source.kind !== 'db') return
  if (source.entity !== 'table') return

  const tableId = source.id.includes('.') ? source.id : `public.${source.id}`
  const [schema, name] = splitTableId(tableId)
  if (byTable.has(tableId)) return

  byTable.set(tableId, {
    schema,
    name,
    table: tableId,
    kind: 'table',
    source,
  })
}

function splitTableId(tableId: string): [schema: string, name: string] {
  const separator = tableId.indexOf('.')
  if (separator === -1) return ['public', tableId]
  return [tableId.slice(0, separator), tableId.slice(separator + 1)]
}
