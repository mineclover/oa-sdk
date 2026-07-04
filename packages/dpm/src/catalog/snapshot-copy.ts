import type {
  SchemaDiagnostic,
  SchemaSourceCoordinate,
} from '@oa-sdk/openapi-projection-contract'

import type {
  CatalogColumn,
  CatalogDiagnostic,
  CatalogForeignKey,
  CatalogIndex,
  CatalogPrimaryKey,
  CatalogProjectionEvidence,
  CatalogSchema,
  CatalogSnapshotSource,
  CatalogTable,
  CatalogUniqueCandidate,
} from './types.js'

export function copySnapshotSource(source: CatalogSnapshotSource): CatalogSnapshotSource {
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

export function copySchema(schema: CatalogSchema): CatalogSchema {
  return {
    name: schema.name,
    ...(schema.owner ? { owner: schema.owner } : {}),
    ...(schema.source ? { source: copySourceCoordinate(schema.source) } : {}),
  }
}

export function copyTable(table: CatalogTable): CatalogTable {
  return {
    schema: table.schema,
    name: table.name,
    table: table.table,
    kind: table.kind,
    ...(table.source ? { source: copySourceCoordinate(table.source) } : {}),
  }
}

export function copyColumn(column: CatalogColumn): CatalogColumn {
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

export function copyPrimaryKey(primaryKey: CatalogPrimaryKey): CatalogPrimaryKey {
  return {
    table: primaryKey.table,
    name: primaryKey.name,
    columns: [...primaryKey.columns],
    ...(primaryKey.source ? { source: copySourceCoordinate(primaryKey.source) } : {}),
  }
}

export function copyForeignKey(foreignKey: CatalogForeignKey): CatalogForeignKey {
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

export function copyIndex(index: CatalogIndex): CatalogIndex {
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

export function copyUniqueCandidate(candidate: CatalogUniqueCandidate): CatalogUniqueCandidate {
  return {
    table: candidate.table,
    name: candidate.name,
    columns: [...candidate.columns],
    reason: candidate.reason,
    confidence: candidate.confidence,
    ...(candidate.source ? { source: copySourceCoordinate(candidate.source) } : {}),
  }
}

export function copyDiagnostic(diagnostic: CatalogDiagnostic | SchemaDiagnostic): CatalogDiagnostic {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.source ? { source: copySourceCoordinate(diagnostic.source) } : {}),
  }
}

export function copyProjectionEvidence(projection: CatalogProjectionEvidence): CatalogProjectionEvidence {
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

export function sortSourceMap(
  sources: Readonly<Record<string, SchemaSourceCoordinate>>,
): Record<string, SchemaSourceCoordinate> {
  const sorted: Record<string, SchemaSourceCoordinate> = {}
  for (const key of Object.keys(sources).sort()) {
    const source = sources[key]
    if (source) sorted[key] = copySourceCoordinate(source)
  }
  return sorted
}
