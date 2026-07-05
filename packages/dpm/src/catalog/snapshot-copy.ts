import { copySourceCoordinate } from './snapshot-source-copy.js'
import type {
  CatalogColumn,
  CatalogForeignKey,
  CatalogIndex,
  CatalogPrimaryKey,
  CatalogSchema,
  CatalogTable,
  CatalogUniqueCandidate,
} from './types.js'

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
