import { describe, it, expect } from 'vitest'
import { pgTable, text, integer, boolean } from 'drizzle-orm/pg-core'
import { mysqlTable, varchar, int as mysqlInt } from 'drizzle-orm/mysql-core'
import { sqliteTable, text as sqliteText, integer as sqliteInteger } from 'drizzle-orm/sqlite-core'
import { extractTablesFromModule } from '../../drizzle/extractor.js'

const usersTable = pgTable('users', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  active: boolean('active').default(true),
})

const postsTable = pgTable('posts', {
  id: integer('id').primaryKey(),
  title: text('title').notNull(),
  userId: integer('user_id').notNull(),
})

const mysqlUsersTable = mysqlTable('users', {
  id: mysqlInt('id').primaryKey(),
  username: varchar('username', { length: 255 }).notNull(),
})

const sqliteOrdersTable = sqliteTable('orders', {
  id: sqliteInteger('id').primaryKey(),
  note: sqliteText('note'),
})

describe('extractTablesFromModule', () => {
  it('detects a single PgTable', () => {
    const tables = extractTablesFromModule({ usersTable })
    expect(tables).toHaveLength(1)
    expect(tables[0]!.sqlName).toBe('users')
    expect(tables[0]!.dialect).toBe('pg')
  })

  it('detects multiple PgTables', () => {
    const tables = extractTablesFromModule({ usersTable, postsTable })
    expect(tables).toHaveLength(2)
    const names = tables.map(t => t.sqlName).sort()
    expect(names).toEqual(['posts', 'users'])
    tables.forEach(t => expect(t.dialect).toBe('pg'))
  })

  it('detects MySqlTable with correct dialect', () => {
    const tables = extractTablesFromModule({ mysqlUsersTable })
    expect(tables).toHaveLength(1)
    expect(tables[0]!.sqlName).toBe('users')
    expect(tables[0]!.dialect).toBe('mysql')
  })

  it('detects SQLiteTable with correct dialect', () => {
    const tables = extractTablesFromModule({ sqliteOrdersTable })
    expect(tables).toHaveLength(1)
    expect(tables[0]!.sqlName).toBe('orders')
    expect(tables[0]!.dialect).toBe('sqlite')
  })

  it('skips non-table exports (primitives, plain objects)', () => {
    const tables = extractTablesFromModule({
      usersTable,
      someString: 'hello',
      someNumber: 42,
      plainObject: { foo: 'bar' },
      nullValue: null,
    })
    expect(tables).toHaveLength(1)
    expect(tables[0]!.sqlName).toBe('users')
  })

  it('returns empty array for module with no tables', () => {
    const tables = extractTablesFromModule({
      SOME_CONSTANT: 'value',
      helper: () => 42,
    })
    expect(tables).toHaveLength(0)
  })

  it('exposes the raw table object', () => {
    const tables = extractTablesFromModule({ usersTable })
    expect(tables[0]!.table).toBe(usersTable)
  })

  it('mixed dialect modules — 각 방언별 정확한 감지', () => {
    const tables = extractTablesFromModule({ usersTable, mysqlUsersTable, sqliteOrdersTable })
    expect(tables).toHaveLength(3)

    const dialects = tables.map(t => t.dialect).sort()
    expect(dialects).toEqual(['mysql', 'pg', 'sqlite'])
  })

  it('같은 sqlName의 다른 방언 테이블 공존', () => {
    // pg와 mysql 모두 'users' 이름
    const tables = extractTablesFromModule({ usersTable, mysqlUsersTable })
    expect(tables).toHaveLength(2)
    const pgTable = tables.find(t => t.dialect === 'pg')
    const mysqlTable = tables.find(t => t.dialect === 'mysql')
    expect(pgTable!.sqlName).toBe('users')
    expect(mysqlTable!.sqlName).toBe('users')
  })
})
