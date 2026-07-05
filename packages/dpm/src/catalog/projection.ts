import type {
  OpenApiProjectionResult,
  SchemaDiagnostic,
  SchemaSourceCoordinate,
} from '@oa-sdk/openapi-projection-contract'

import type { CatalogDiagnostic } from './diagnostic-types.js'
import type {
  CatalogSchema,
  CatalogTable,
} from './structure-types.js'
import { normalizeCatalogSnapshot } from './snapshot.js'

export type CatalogSnapshotFromProjectionOptions = {
  projectionRef?: string
}

export function catalogSnapshotFromOpenApiProjection(
  projection: OpenApiProjectionResult<Record<string, unknown>>,
  options: CatalogSnapshotFromProjectionOptions = {},
) {
  const tables = collectProjectionTables(projection)
  const schemas = collectSchemas(tables)

  return normalizeCatalogSnapshot({
    source: {
      kind: 'openapi_projection',
      profile: projection.profile,
      projectionVersionHash: projection.versionHash,
      ...(options.projectionRef ? { projectionRef: options.projectionRef } : {}),
    },
    schemas,
    tables,
    sources: projection.sources,
    diagnostics: projection.diagnostics.map(toCatalogDiagnostic),
    projection: {
      profile: projection.profile,
      versionHash: projection.versionHash,
      refs: projection.refs,
      typeTargets: projection.typeTargets ?? [],
    },
    sourceVersionHash: projection.versionHash,
  })
}

function collectProjectionTables(
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

function collectSchemas(tables: readonly CatalogTable[]): CatalogSchema[] {
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

function splitTableId(tableId: string): [schema: string, name: string] {
  const separator = tableId.indexOf('.')
  if (separator === -1) return ['public', tableId]
  return [tableId.slice(0, separator), tableId.slice(separator + 1)]
}

function toCatalogDiagnostic(diagnostic: SchemaDiagnostic): CatalogDiagnostic {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.source ? { source: diagnostic.source } : {}),
  }
}
