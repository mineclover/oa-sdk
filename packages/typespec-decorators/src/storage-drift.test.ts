import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as governance from './governance.js'
import { STORAGE_CATALOG_EXTENSION, STORAGE_REF_EXTENSION } from './storage.js'
import {
  AtlasSchemaInspectOutputSchema,
  verifyAtlasSchemaDrift,
  type AtlasSchemaInspectOutput,
  type StorageMapping,
} from './storage-drift.js'

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

  it('resolves schema-qualified tables from Atlas schemas[] evidence', () => {
    const evidence = AtlasSchemaInspectOutputSchema.parse({
      schemas: [
        {
          name: 'public',
          tables: [{ name: 'users', columns: [{ name: 'user_id', type: 'uuid', null: false }] }],
        },
      ],
    })
    const mappings: StorageMapping[] = [
      { entityName: 'UserEntity', tableName: 'public.users', columns: { id: { columnName: 'user_id', expectedType: 'string' } } },
      { entityName: 'UserByBareName', tableName: 'USERS', columns: { id: { columnName: 'USER_ID', expectedType: 'string' } } },
    ]

    expect(verifyAtlasSchemaDrift(evidence, mappings)).toEqual({ passed: true, issues: [] })
  })
})

describe('AtlasSchemaInspectOutputSchema', () => {
  it('keeps the members the verifier reads and drops other Atlas fields', () => {
    const parsed = AtlasSchemaInspectOutputSchema.parse(JSON.parse(JSON.stringify({
      tables: [
        {
          name: 'users',
          columns: [{ name: 'user_id', type: 'varchar(64)', null: false, charset: 'utf8' }],
          primary_key: { parts: [{ column: 'user_id' }] },
        },
      ],
      realm: 'local',
    })))

    expect(parsed).toEqual({
      tables: [{ name: 'users', columns: [{ name: 'user_id', type: 'varchar(64)', null: false }] }],
    })
  })

  it('rejects evidence whose shape the verifier cannot read, naming the bad field', () => {
    expect(() => AtlasSchemaInspectOutputSchema.parse([])).toThrow(TypeError)
    expect(() => AtlasSchemaInspectOutputSchema.parse({ tables: {} })).toThrow('tables must be an array')
    expect(() => AtlasSchemaInspectOutputSchema.parse({ tables: [{ name: 'users' }] })).toThrow(
      'tables[0].columns must be an array',
    )
    expect(() =>
      AtlasSchemaInspectOutputSchema.parse({ tables: [{ name: 'users', columns: [{ name: 'id', type: 3 }] }] }),
    ).toThrow('tables[0].columns[0].type must be a non-empty string')
    expect(() =>
      AtlasSchemaInspectOutputSchema.parse({ schemas: [{ name: 'public', tables: [{ columns: [] }] }] }),
    ).toThrow('schemas[0].tables[0].name must be a non-empty string')
  })
})

describe('documented entry point of the Atlas drift check', () => {
  const packageDirectory = resolve(import.meta.dirname, '..')

  it('is exported from the `./governance` subpath source', () => {
    expect(governance.verifyAtlasSchemaDrift).toBe(verifyAtlasSchemaDrift)
    expect(governance.AtlasSchemaInspectOutputSchema).toBe(AtlasSchemaInspectOutputSchema)
  })

  it('resolves `@oa-sdk/typespec-decorators/governance` through the package export map, as the guide imports it', () => {
    // Runs Node in the package scope, so the specifier goes through package.json `exports`
    // to the built `dist/governance.js` exactly as a consumer's CI script would.
    const script = [
      "import { AtlasSchemaInspectOutputSchema, verifyAtlasSchemaDrift } from '@oa-sdk/typespec-decorators/governance'",
      "const evidence = AtlasSchemaInspectOutputSchema.parse({ schemas: [{ name: 'main', tables: [{ name: 'users', columns: [{ name: 'user_id', type: 'varchar(64)' }] }] }] })",
      "const mappings = [{ entityName: 'UserEntity', tableName: 'users', columns: { id: { columnName: 'user_id', expectedType: 'string' }, email: { columnName: 'email_address', expectedType: 'string' } } }]",
      'console.log(JSON.stringify(verifyAtlasSchemaDrift(evidence, mappings)))',
    ].join('\n')
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: packageDirectory,
      encoding: 'utf8',
    })
    const report: unknown = JSON.parse(output)
    expect(report).toMatchObject({
      passed: false,
      issues: [{ severity: 'error', category: 'missing-column', entity: 'UserEntity', property: 'email' }],
    })
  })
})
