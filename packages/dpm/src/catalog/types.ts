import type {
  OpenApiProjectionProfile,
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

export { computeCatalogFreshnessHash } from './freshness.js'
export { normalizeCatalogSnapshot } from './snapshot.js'
