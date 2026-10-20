/**
 * @fileoverview Atlas schema drift verification for `@storageRef` mappings.
 *
 * `verifyAtlasSchemaDrift` compares caller-supplied storage mappings (logical entity,
 * physical table and column names, expected logical type) against the read-only JSON
 * snapshot `atlas schema inspect --format '{{ json . }}'` prints. It never connects to a
 * database and never produces DDL. The mappings are written by the caller, typically from
 * the same `@storageRef("table")` / `@storageRef("table.column")` targets the TypeSpec
 * models declare; nothing in this module reads TypeSpec sources or OpenAPI output.
 *
 * Evidence read from disk should pass through `AtlasSchemaInspectOutputSchema.parse`
 * before it reaches the verifier, so a malformed snapshot fails with a TypeError that
 * names the bad field instead of crashing inside the comparison.
 */

/**
 * Standard Atlas Schema Inspect JSON format (produced by `atlas schema inspect --format '{{ json . }}'`).
 */
export interface AtlasSchemaInspectOutput {
  schemas?: Array<{
    name: string
    tables?: AtlasTable[]
  }>
  tables?: AtlasTable[]
}

export interface AtlasTable {
  name: string
  columns: AtlasColumn[]
  primary_key?: { columns: string[] }
  indexes?: Array<{ name: string; columns: string[] }>
}

export interface AtlasColumn {
  name: string
  type: string
  null?: boolean
}

export interface StorageMapping {
  entityName: string
  tableName: string
  columns: Record<string, { columnName: string; expectedType: string }>
}

export interface DriftIssue {
  severity: 'error' | 'warning'
  category: 'missing-table' | 'missing-column' | 'type-mismatch'
  message: string
  entity: string
  property?: string
}

export interface AtlasDriftReport {
  /** False when any issue has severity `error` (missing table or column). */
  passed: boolean
  issues: DriftIssue[]
}

/** A named runtime validator: `parse` returns the validated value or throws a TypeError. */
export interface StorageDriftSchema<T> {
  parse(value: unknown): T
}

/**
 * Validates an Atlas inspect snapshot. Only the members the verifier reads are checked
 * (`tables`/`schemas[].tables`, table `name` and `columns`, column `name`, `type` and the
 * optional `null`); other Atlas fields are ignored and dropped.
 */
export const AtlasSchemaInspectOutputSchema: StorageDriftSchema<AtlasSchemaInspectOutput> = {
  parse(value: unknown): AtlasSchemaInspectOutput {
    if (!isRecord(value)) throw new TypeError('Atlas schema evidence must be a JSON object')
    const output: AtlasSchemaInspectOutput = {}
    if (value.tables !== undefined) output.tables = parseTables(value.tables, 'tables')
    if (value.schemas !== undefined) {
      if (!Array.isArray(value.schemas)) throw new TypeError('Atlas schema evidence: schemas must be an array')
      output.schemas = value.schemas.map((schema: unknown, index) => {
        const at = `schemas[${index}]`
        if (!isRecord(schema)) throw new TypeError(`Atlas schema evidence: ${at} must be an object`)
        const name = requireString(schema.name, `${at}.name`)
        return schema.tables === undefined
          ? { name }
          : { name, tables: parseTables(schema.tables, `${at}.tables`) }
      })
    }
    return output
  },
}

/**
 * Pure, read-only static verification function that compares TypeSpec storageRef mappings
 * against Atlas physical schema evidence without touching the live database.
 *
 * - A mapping whose table is absent is a `missing-table` error.
 * - A mapped column absent from its table is a `missing-column` error.
 * - A column whose physical type is not compatible with `expectedType` (`string`, `number`,
 *   `integer` or `boolean`, dialect-tolerant) is a `type-mismatch` warning; warnings do not
 *   fail `passed`.
 *
 * Table and column names compare case-insensitively; a table also matches as
 * `<schema>.<table>` when it comes from `schemas[]`.
 */
export function verifyAtlasSchemaDrift(
  evidence: AtlasSchemaInspectOutput,
  mappings: readonly StorageMapping[],
): AtlasDriftReport {
  const issues: DriftIssue[] = []

  // Flatten tables from Atlas schemas or root tables array
  const tableMap = new Map<string, AtlasTable>()
  if (Array.isArray(evidence.tables)) {
    for (const table of evidence.tables) {
      tableMap.set(table.name.toLowerCase(), table)
    }
  }
  if (Array.isArray(evidence.schemas)) {
    for (const schema of evidence.schemas) {
      for (const table of schema.tables ?? []) {
        tableMap.set(table.name.toLowerCase(), table)
        // Also support qualified schema.table name
        tableMap.set(`${schema.name.toLowerCase()}.${table.name.toLowerCase()}`, table)
      }
    }
  }

  for (const mapping of mappings) {
    const table = tableMap.get(mapping.tableName.toLowerCase())
    if (!table) {
      issues.push({
        severity: 'error',
        category: 'missing-table',
        message: `Entity "${mapping.entityName}" references physical table "${mapping.tableName}", but it was not found in Atlas schema evidence.`,
        entity: mapping.entityName,
      })
      continue
    }

    const columnMap = new Map<string, AtlasColumn>()
    for (const col of table.columns) {
      columnMap.set(col.name.toLowerCase(), col)
    }

    for (const [propName, colRef] of Object.entries(mapping.columns)) {
      const col = columnMap.get(colRef.columnName.toLowerCase())
      if (!col) {
        issues.push({
          severity: 'error',
          category: 'missing-column',
          message: `Property "${mapping.entityName}.${propName}" references physical column "${colRef.columnName}" on table "${mapping.tableName}", but the column is missing in Atlas evidence.`,
          entity: mapping.entityName,
          property: propName,
        })
        continue
      }

      if (!isPhysicalTypeCompatible(colRef.expectedType, col.type)) {
        issues.push({
          severity: 'warning',
          category: 'type-mismatch',
          message: `Property "${mapping.entityName}.${propName}" expects type "${colRef.expectedType}", but physical column "${colRef.columnName}" has type "${col.type}".`,
          entity: mapping.entityName,
          property: propName,
        })
      }
    }
  }

  return {
    passed: issues.every(issue => issue.severity !== 'error'),
    issues,
  }
}

/** Basic dialect-tolerant compatibility between a logical type and a physical column type. */
function isPhysicalTypeCompatible(expected: string, physical: string): boolean {
  const physicalType = physical.toLowerCase()
  switch (expected.toLowerCase()) {
    case 'string':
      return ['char', 'text', 'uuid'].some(token => physicalType.includes(token))
    case 'number':
    case 'integer':
      return ['int', 'numeric', 'decimal', 'float', 'real'].some(token => physicalType.includes(token))
    case 'boolean':
      return physicalType.includes('bool') || physicalType === 'tinyint(1)'
    default:
      return false
  }
}

function parseTables(value: unknown, at: string): AtlasTable[] {
  if (!Array.isArray(value)) throw new TypeError(`Atlas schema evidence: ${at} must be an array`)
  return value.map((table: unknown, index) => {
    const tableAt = `${at}[${index}]`
    if (!isRecord(table)) throw new TypeError(`Atlas schema evidence: ${tableAt} must be an object`)
    const name = requireString(table.name, `${tableAt}.name`)
    if (!Array.isArray(table.columns)) {
      throw new TypeError(`Atlas schema evidence: ${tableAt}.columns must be an array`)
    }
    const columns = table.columns.map((column: unknown, columnIndex): AtlasColumn => {
      const columnAt = `${tableAt}.columns[${columnIndex}]`
      if (!isRecord(column)) throw new TypeError(`Atlas schema evidence: ${columnAt} must be an object`)
      const parsed: AtlasColumn = {
        name: requireString(column.name, `${columnAt}.name`),
        type: requireString(column.type, `${columnAt}.type`),
      }
      if (column.null !== undefined) {
        if (typeof column.null !== 'boolean') {
          throw new TypeError(`Atlas schema evidence: ${columnAt}.null must be a boolean`)
        }
        parsed.null = column.null
      }
      return parsed
    })
    return { name, columns }
  })
}

function requireString(value: unknown, at: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Atlas schema evidence: ${at} must be a non-empty string`)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
