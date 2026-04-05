import { describe, it, expect } from 'vitest'
import { pgTable, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core'
import { extractTablesFromModule } from '../../drizzle/extractor.js'
import { convertTable, convertTables } from '../../drizzle/converter.js'
import { defaultNaming } from '../../drizzle/naming.js'

const usersTable = pgTable('users', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  bio: text('bio'),
  active: boolean('active').default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

describe('convertTable', () => {
  it('produces select schema with correct name', async () => {
    const extracted = extractTablesFromModule({ usersTable })[0]!
    const schemas = await convertTable(extracted, ['select'], defaultNaming)

    expect(schemas).toHaveLength(1)
    expect(schemas[0]!.name).toBe('User')
    expect(schemas[0]!.schemaType).toBe('select')
    expect(schemas[0]!.sourceTable).toBe('users')
  })

  it('select schema has type: object', async () => {
    const extracted = extractTablesFromModule({ usersTable })[0]!
    const schema = (await convertTable(extracted, ['select'], defaultNaming))[0]!

    expect(schema.schema.type).toBe('object')
    expect(schema.schema.properties).toBeDefined()
  })

  it('required fields from notNull columns appear in required array', async () => {
    const extracted = extractTablesFromModule({ usersTable })[0]!
    const schema = (await convertTable(extracted, ['select'], defaultNaming))[0]!

    const required: string[] = schema.schema.required ?? []
    expect(required).toContain('id')
    expect(required).toContain('name')
    expect(required).toContain('email')
  })

  it('produces insert schema with correct name', async () => {
    const extracted = extractTablesFromModule({ usersTable })[0]!
    const schemas = await convertTable(extracted, ['insert'], defaultNaming)

    expect(schemas[0]!.name).toBe('InsertUser')
    expect(schemas[0]!.schemaType).toBe('insert')
  })

  it('insert schema omits auto-defaulted columns from required', async () => {
    const extracted = extractTablesFromModule({ usersTable })[0]!
    const schema = (await convertTable(extracted, ['insert'], defaultNaming))[0]!

    const required: string[] = schema.schema.required ?? []
    // createdAt has defaultNow() so should not be required in insert
    expect(required).not.toContain('createdAt')
    expect(required).not.toContain('created_at')
  })

  it('produces update schema with correct name', async () => {
    const extracted = extractTablesFromModule({ usersTable })[0]!
    const schemas = await convertTable(extracted, ['update'], defaultNaming)

    expect(schemas[0]!.name).toBe('UpdateUser')
    expect(schemas[0]!.schemaType).toBe('update')
  })

  it('update schema has no required fields (all optional)', async () => {
    const extracted = extractTablesFromModule({ usersTable })[0]!
    const schema = (await convertTable(extracted, ['update'], defaultNaming))[0]!

    const required: string[] = schema.schema.required ?? []
    expect(required).toHaveLength(0)
  })

  it('produces all three schema types when requested', async () => {
    const extracted = extractTablesFromModule({ usersTable })[0]!
    const schemas = await convertTable(extracted, ['select', 'insert', 'update'], defaultNaming)

    expect(schemas).toHaveLength(3)
    const types = schemas.map(s => s.schemaType)
    expect(types).toContain('select')
    expect(types).toContain('insert')
    expect(types).toContain('update')
  })

  it('produces only requested schema types', async () => {
    const extracted = extractTablesFromModule({ usersTable })[0]!
    const schemas = await convertTable(extracted, ['select'], defaultNaming)

    expect(schemas).toHaveLength(1)
    expect(schemas[0]!.schemaType).toBe('select')
  })
})

describe('convertTable — complex column types', () => {
  const complexTable = pgTable('products', {
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    price: integer('price').notNull(),
    description: text('description'),
  })

  it('integer primaryKey → type: integer', async () => {
    const extracted = extractTablesFromModule({ complexTable })[0]!
    const schema = (await convertTable(extracted, ['select'], defaultNaming))[0]!

    const props = schema.schema.properties as Record<string, Record<string, unknown>>
    expect(props['id']!['type']).toBe('integer')
  })

  it('nullable text → anyOf [string, null]', async () => {
    const extracted = extractTablesFromModule({ complexTable })[0]!
    const schema = (await convertTable(extracted, ['select'], defaultNaming))[0]!

    const props = schema.schema.properties as Record<string, Record<string, unknown>>
    const desc = props['description']!
    expect(desc['anyOf']).toBeDefined()
    const anyOf = desc['anyOf'] as Array<Record<string, unknown>>
    expect(anyOf.some(s => s['type'] === 'null')).toBe(true)
  })

  it('빈 테이블 (컬럼 1개) → 정상 변환', async () => {
    const minTable = pgTable('minimal', {
      id: integer('id').primaryKey(),
    })
    const extracted = extractTablesFromModule({ minTable })[0]!
    const schema = (await convertTable(extracted, ['select'], defaultNaming))[0]!
    expect(schema.name).toBe('Minimal')
    expect(schema.schema.type).toBe('object')
  })
})

describe('convertTables', () => {
  const postsTable = pgTable('posts', {
    id: integer('id').primaryKey(),
    title: text('title').notNull(),
    userId: integer('user_id').notNull(),
  })

  it('converts multiple tables', async () => {
    const tables = extractTablesFromModule({ usersTable, postsTable })
    const schemas = await convertTables(tables, ['select'], defaultNaming)

    expect(schemas).toHaveLength(2)
    const names = schemas.map(s => s.name).sort()
    expect(names).toEqual(['Post', 'User'])
  })

  it('flattens multiple schema types for multiple tables', async () => {
    const tables = extractTablesFromModule({ usersTable, postsTable })
    const schemas = await convertTables(tables, ['select', 'insert'], defaultNaming)

    // 2 tables × 2 types = 4 schemas
    expect(schemas).toHaveLength(4)
  })
})
