import { describe, expect, it } from 'vitest'
import { STORAGE_CATALOG_EXTENSION, STORAGE_REF_EXTENSION } from './storage.js'

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

/**
 * Pure, read-only static verification function that compares TypeSpec storageRef mappings
 * against Atlas physical schema evidence without touching the live database.
 */
export function verifyAtlasSchemaDrift(
  evidence: AtlasSchemaInspectOutput,
  mappings: StorageMapping[],
): { passed: boolean; issues: DriftIssue[] } {
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

      // Basic dialect-tolerant type compatibility checking
      const physicalType = col.type.toLowerCase()
      const expectedType = colRef.expectedType.toLowerCase()

      const isStringCompat =
        expectedType === 'string' &&
        (physicalType.includes('char') ||
          physicalType.includes('text') ||
          physicalType.includes('varchar') ||
          physicalType.includes('uuid'))
      const isNumberCompat =
        (expectedType === 'number' || expectedType === 'integer') &&
        (physicalType.includes('int') ||
          physicalType.includes('numeric') ||
          physicalType.includes('decimal') ||
          physicalType.includes('float') ||
          physicalType.includes('real'))
      const isBooleanCompat =
        expectedType === 'boolean' &&
        (physicalType.includes('bool') || physicalType === 'tinyint(1)')

      if (!isStringCompat && !isNumberCompat && !isBooleanCompat) {
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
    passed: issues.filter(i => i.severity === 'error').length === 0,
    issues,
  }
}

describe('Atlas DB Schema Drift Static Verification', () => {
  it('exposes the standard storage extension keys', () => {
    expect(STORAGE_REF_EXTENSION).toBe('x-oa-sdk-storage-ref')
    expect(STORAGE_CATALOG_EXTENSION).toBe('x-oa-sdk-storage-catalog')
  })

  it('passes verification when Atlas schema matches TypeSpec storage mappings', () => {
    const mockAtlasEvidence: AtlasSchemaInspectOutput = {
      tables: [
        {
          name: 'users',
          columns: [
            { name: 'user_id', type: 'varchar(64)', null: false },
            { name: 'email_address', type: 'varchar(255)', null: false },
            { name: 'created_at', type: 'timestamp', null: false },
          ],
        },
      ],
    }

    const mappings: StorageMapping[] = [
      {
        entityName: 'UserEntity',
        tableName: 'users',
        columns: {
          id: { columnName: 'user_id', expectedType: 'string' },
          email: { columnName: 'email_address', expectedType: 'string' },
        },
      },
    ]

    const result = verifyAtlasSchemaDrift(mockAtlasEvidence, mappings)
    expect(result.passed).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('detects missing table in Atlas evidence', () => {
    const mockAtlasEvidence: AtlasSchemaInspectOutput = {
      tables: [],
    }

    const mappings: StorageMapping[] = [
      {
        entityName: 'OrderEntity',
        tableName: 'orders',
        columns: {
          id: { columnName: 'order_id', expectedType: 'string' },
        },
      },
    ]

    const result = verifyAtlasSchemaDrift(mockAtlasEvidence, mappings)
    expect(result.passed).toBe(false)
    expect(result.issues[0]?.category).toBe('missing-table')
    expect(result.issues[0]?.message).toContain('references physical table "orders"')
  })

  it('detects missing column in Atlas evidence', () => {
    const mockAtlasEvidence: AtlasSchemaInspectOutput = {
      tables: [
        {
          name: 'members',
          columns: [{ name: 'member_id', type: 'text', null: false }],
        },
      ],
    }

    const mappings: StorageMapping[] = [
      {
        entityName: 'MemberEntity',
        tableName: 'members',
        columns: {
          id: { columnName: 'member_id', expectedType: 'string' },
          phone: { columnName: 'phone_number', expectedType: 'string' },
        },
      },
    ]

    const result = verifyAtlasSchemaDrift(mockAtlasEvidence, mappings)
    expect(result.passed).toBe(false)
    expect(result.issues[0]?.category).toBe('missing-column')
    expect(result.issues[0]?.message).toContain('phone_number')
  })

  it('detects type mismatch between logical model and physical column', () => {
    const mockAtlasEvidence: AtlasSchemaInspectOutput = {
      tables: [
        {
          name: 'products',
          columns: [
            { name: 'product_id', type: 'uuid', null: false },
            { name: 'price', type: 'varchar(32)', null: false }, // String instead of numeric
          ],
        },
      ],
    }

    const mappings: StorageMapping[] = [
      {
        entityName: 'ProductEntity',
        tableName: 'products',
        columns: {
          id: { columnName: 'product_id', expectedType: 'string' },
          price: { columnName: 'price', expectedType: 'number' },
        },
      },
    ]

    const result = verifyAtlasSchemaDrift(mockAtlasEvidence, mappings)
    // Warning does not cause fatal error, but surfaces diagnostic
    expect(result.passed).toBe(true)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]?.category).toBe('type-mismatch')
    expect(result.issues[0]?.message).toContain('expects type "number", but physical column "price" has type "varchar(32)"')
  })
})
