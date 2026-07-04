import { createHash } from 'node:crypto'

import type {
  OpenApiProjectionProfile,
  SchemaDiagnostic,
  SchemaRefEdge,
  SchemaSourceCoordinate,
  SchemaTypeTarget,
} from '@oa-sdk/openapi-projection-contract'

export type CatalogSnapshotSource =
  | {
      kind: 'postgresql'
      database: string
      capturedAt?: string
    }
  | {
      kind: 'openapi_projection'
      profile: OpenApiProjectionProfile
      projectionVersionHash: string
      projectionRef?: string
    }

export type CatalogSchema = {
  name: string
  owner?: string
  source?: SchemaSourceCoordinate
}

export type CatalogTable = {
  schema: string
  name: string
  table: string
  kind: 'table' | 'view' | 'materialized_view'
  source?: SchemaSourceCoordinate
}

export type CatalogColumn = {
  table: string
  name: string
  dataType: string
  nullable: boolean
  ordinal: number
  defaultValue?: string
  source?: SchemaSourceCoordinate
}

export type CatalogPrimaryKey = {
  table: string
  name: string
  columns: string[]
  source?: SchemaSourceCoordinate
}

export type CatalogForeignKey = {
  table: string
  name: string
  columns: string[]
  referencedTable: string
  referencedColumns: string[]
  enforced: boolean
  onDelete?: string
  onUpdate?: string
  source?: SchemaSourceCoordinate
}

export type CatalogIndex = {
  table: string
  name: string
  columns: string[]
  unique: boolean
  method?: string
  predicate?: string
  source?: SchemaSourceCoordinate
}

export type CatalogUniqueCandidate = {
  table: string
  name: string
  columns: string[]
  reason: 'primary_key' | 'unique_index' | 'unique_constraint' | 'profiled_unique'
  confidence: number
  source?: SchemaSourceCoordinate
}

export type CatalogDiagnostic = {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  source?: SchemaSourceCoordinate
}

export type CatalogProjectionEvidence = {
  profile: OpenApiProjectionProfile
  versionHash: string
  refs: SchemaRefEdge[]
  typeTargets: SchemaTypeTarget[]
}

export type CatalogFreshness = {
  versionHash: string
  sourceVersionHash?: string
}

export type CatalogSnapshot = {
  kind: 'dpm.catalog.snapshot.v1'
  source: CatalogSnapshotSource
  schemas: CatalogSchema[]
  tables: CatalogTable[]
  columns: CatalogColumn[]
  primaryKeys: CatalogPrimaryKey[]
  foreignKeys: CatalogForeignKey[]
  indexes: CatalogIndex[]
  uniqueCandidates: CatalogUniqueCandidate[]
  sources: Record<string, SchemaSourceCoordinate>
  diagnostics: CatalogDiagnostic[]
  projection?: CatalogProjectionEvidence
  freshness: CatalogFreshness
}

export type CatalogSnapshotInput = {
  source: CatalogSnapshotSource
  schemas?: readonly CatalogSchema[]
  tables?: readonly CatalogTable[]
  columns?: readonly CatalogColumn[]
  primaryKeys?: readonly CatalogPrimaryKey[]
  foreignKeys?: readonly CatalogForeignKey[]
  indexes?: readonly CatalogIndex[]
  uniqueCandidates?: readonly CatalogUniqueCandidate[]
  sources?: Readonly<Record<string, SchemaSourceCoordinate>>
  diagnostics?: readonly CatalogDiagnostic[]
  projection?: CatalogProjectionEvidence
  sourceVersionHash?: string
}

export type PostgresCatalogSnapshotInput = Omit<CatalogSnapshotInput, 'source'> & {
  database: string
  capturedAt?: string
}

export function normalizeCatalogSnapshot(input: CatalogSnapshotInput): CatalogSnapshot {
  const structural = {
    kind: 'dpm.catalog.snapshot.v1' as const,
    source: copySnapshotSource(input.source),
    schemas: [...(input.schemas ?? [])].map(copySchema).sort(bySchema),
    tables: [...(input.tables ?? [])].map(copyTable).sort(byTable),
    columns: [...(input.columns ?? [])].map(copyColumn).sort(byColumn),
    primaryKeys: [...(input.primaryKeys ?? [])].map(copyPrimaryKey).sort(byTableName),
    foreignKeys: [...(input.foreignKeys ?? [])].map(copyForeignKey).sort(byTableName),
    indexes: [...(input.indexes ?? [])].map(copyIndex).sort(byTableName),
    uniqueCandidates: [...(input.uniqueCandidates ?? [])].map(copyUniqueCandidate).sort(byTableName),
    sources: sortSourceMap(input.sources ?? {}),
    diagnostics: [...(input.diagnostics ?? [])].map(copyDiagnostic).sort(byDiagnostic),
    ...(input.projection ? { projection: copyProjectionEvidence(input.projection) } : {}),
  }

  return {
    ...structural,
    freshness: {
      versionHash: computeCatalogFreshnessHash(structural),
      ...(input.sourceVersionHash ? { sourceVersionHash: input.sourceVersionHash } : {}),
    },
  }
}

export function computeCatalogFreshnessHash(
  input: Omit<CatalogSnapshot, 'freshness'> | Omit<CatalogSnapshotInput, 'sourceVersionHash'>,
): string {
  return `sha256:${createHash('sha256').update(stableStringify(input)).digest('hex')}`
}

function copySnapshotSource(source: CatalogSnapshotSource): CatalogSnapshotSource {
  if (source.kind === 'postgresql') {
    return {
      kind: 'postgresql',
      database: source.database,
      ...(source.capturedAt ? { capturedAt: source.capturedAt } : {}),
    }
  }

  return {
    kind: 'openapi_projection',
    profile: source.profile,
    projectionVersionHash: source.projectionVersionHash,
    ...(source.projectionRef ? { projectionRef: source.projectionRef } : {}),
  }
}

function copySchema(schema: CatalogSchema): CatalogSchema {
  return {
    name: schema.name,
    ...(schema.owner ? { owner: schema.owner } : {}),
    ...(schema.source ? { source: copySourceCoordinate(schema.source) } : {}),
  }
}

function copyTable(table: CatalogTable): CatalogTable {
  return {
    schema: table.schema,
    name: table.name,
    table: table.table,
    kind: table.kind,
    ...(table.source ? { source: copySourceCoordinate(table.source) } : {}),
  }
}

function copyColumn(column: CatalogColumn): CatalogColumn {
  return {
    table: column.table,
    name: column.name,
    dataType: column.dataType,
    nullable: column.nullable,
    ordinal: column.ordinal,
    ...(column.defaultValue !== undefined ? { defaultValue: column.defaultValue } : {}),
    ...(column.source ? { source: copySourceCoordinate(column.source) } : {}),
  }
}

function copyPrimaryKey(primaryKey: CatalogPrimaryKey): CatalogPrimaryKey {
  return {
    table: primaryKey.table,
    name: primaryKey.name,
    columns: [...primaryKey.columns],
    ...(primaryKey.source ? { source: copySourceCoordinate(primaryKey.source) } : {}),
  }
}

function copyForeignKey(foreignKey: CatalogForeignKey): CatalogForeignKey {
  return {
    table: foreignKey.table,
    name: foreignKey.name,
    columns: [...foreignKey.columns],
    referencedTable: foreignKey.referencedTable,
    referencedColumns: [...foreignKey.referencedColumns],
    enforced: foreignKey.enforced,
    ...(foreignKey.onDelete ? { onDelete: foreignKey.onDelete } : {}),
    ...(foreignKey.onUpdate ? { onUpdate: foreignKey.onUpdate } : {}),
    ...(foreignKey.source ? { source: copySourceCoordinate(foreignKey.source) } : {}),
  }
}

function copyIndex(index: CatalogIndex): CatalogIndex {
  return {
    table: index.table,
    name: index.name,
    columns: [...index.columns],
    unique: index.unique,
    ...(index.method ? { method: index.method } : {}),
    ...(index.predicate ? { predicate: index.predicate } : {}),
    ...(index.source ? { source: copySourceCoordinate(index.source) } : {}),
  }
}

function copyUniqueCandidate(candidate: CatalogUniqueCandidate): CatalogUniqueCandidate {
  return {
    table: candidate.table,
    name: candidate.name,
    columns: [...candidate.columns],
    reason: candidate.reason,
    confidence: candidate.confidence,
    ...(candidate.source ? { source: copySourceCoordinate(candidate.source) } : {}),
  }
}

function copyDiagnostic(diagnostic: CatalogDiagnostic | SchemaDiagnostic): CatalogDiagnostic {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.source ? { source: copySourceCoordinate(diagnostic.source) } : {}),
  }
}

function copyProjectionEvidence(projection: CatalogProjectionEvidence): CatalogProjectionEvidence {
  return {
    profile: projection.profile,
    versionHash: projection.versionHash,
    refs: projection.refs.map(ref => ({
      from: ref.from,
      ...(ref.to ? { to: ref.to } : {}),
      ref: ref.ref,
      kind: ref.kind,
      source: copySourceCoordinate(ref.source),
    })),
    typeTargets: projection.typeTargets.map(target => ({
      id: target.id,
      name: target.name,
      kind: target.kind,
      ...(target.source ? { source: copySourceCoordinate(target.source) } : {}),
    })),
  }
}

export function copySourceCoordinate(source: SchemaSourceCoordinate): SchemaSourceCoordinate {
  if (source.kind === 'file') {
    return {
      kind: 'file',
      filePath: source.filePath,
      pointer: source.pointer,
      ...(source.line !== undefined ? { line: source.line } : {}),
      ...(source.column !== undefined ? { column: source.column } : {}),
    }
  }

  return {
    kind: 'db',
    entity: source.entity,
    id: source.id,
    pointer: source.pointer,
  }
}

function sortSourceMap(
  sources: Readonly<Record<string, SchemaSourceCoordinate>>,
): Record<string, SchemaSourceCoordinate> {
  const sorted: Record<string, SchemaSourceCoordinate> = {}
  for (const key of Object.keys(sources).sort()) {
    const source = sources[key]
    if (source) sorted[key] = copySourceCoordinate(source)
  }
  return sorted
}

function bySchema(left: CatalogSchema, right: CatalogSchema): number {
  return left.name.localeCompare(right.name)
}

function byTable(left: CatalogTable, right: CatalogTable): number {
  return left.table.localeCompare(right.table)
}

function byColumn(left: CatalogColumn, right: CatalogColumn): number {
  return `${left.table}.${left.ordinal}.${left.name}`.localeCompare(`${right.table}.${right.ordinal}.${right.name}`)
}

function byTableName<T extends { table: string; name: string }>(left: T, right: T): number {
  return `${left.table}.${left.name}`.localeCompare(`${right.table}.${right.name}`)
}

function byDiagnostic(left: CatalogDiagnostic, right: CatalogDiagnostic): number {
  return `${left.severity}.${left.code}.${left.message}`.localeCompare(`${right.severity}.${right.code}.${right.message}`)
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!value || typeof value !== 'object') return value

  const record = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort()) {
    const next = record[key]
    if (next !== undefined) sorted[key] = sortValue(next)
  }
  return sorted
}
