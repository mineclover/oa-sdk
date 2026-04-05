/**
 * Drizzle → Zod → OAS 3.2 → YAML 풀 파이프라인 E2E 테스트
 *
 * extractTablesFromModule() 기반으로 테스트한다.
 * (extractTablesFromPath()는 dynamic import를 사용하여 .ts 런타임 로드 불가)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as parseYaml } from 'yaml'
import { pgTable, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core'
import { extractTablesFromModule } from '../../drizzle/extractor.js'
import { convertTables } from '../../drizzle/converter.js'
import { defaultNaming } from '../../drizzle/naming.js'
import { mergeIntoSpec } from '../../spec-merge.js'
import { stringify as stringifyYaml } from 'yaml'

// ── 테스트용 Drizzle 테이블 ──

const usersTable = pgTable('users', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  bio: text('bio'),
  active: boolean('active').default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

const postsTable = pgTable('posts', {
  id: integer('id').primaryKey(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  userId: integer('user_id').notNull(),
  publishedAt: timestamp('published_at'),
})

// ── E2E 테스트 ──

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpdir(), `oa-sdk-e2e-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

describe('Drizzle → OAS E2E pipeline', () => {
  it('단일 테이블 → components.yaml 생성', async () => {
    const tables = extractTablesFromModule({ usersTable })
    const schemas = await convertTables(tables, ['select', 'insert', 'update'], defaultNaming)

    // YAML 파일로 출력
    const outputPath = join(tmpDir, 'components.yaml')
    const spec = {
      components: {
        schemas: Object.fromEntries(schemas.map(s => [s.name, s.schema])),
      },
    }
    writeFileSync(outputPath, stringifyYaml(spec, { lineWidth: 0 }), 'utf8')

    // YAML 파싱 후 구조 검증
    const parsed = parseYaml(readFileSync(outputPath, 'utf8')) as Record<string, unknown>
    const components = parsed['components'] as Record<string, unknown>
    const schemaMap = components['schemas'] as Record<string, Record<string, unknown>>

    expect(Object.keys(schemaMap)).toEqual(
      expect.arrayContaining(['User', 'InsertUser', 'UpdateUser']),
    )
    expect(Object.keys(schemaMap)).toHaveLength(3)

    // select schema 구조 검증
    const user = schemaMap['User']!
    expect(user['type']).toBe('object')
    const props = user['properties'] as Record<string, Record<string, unknown>>
    expect(props['id']).toBeDefined()
    expect(props['name']).toBeDefined()
    expect(props['email']).toBeDefined()
    const required = user['required'] as string[]
    expect(required).toContain('id')
    expect(required).toContain('name')
    expect(required).toContain('email')

    // update schema: 모든 필드 optional
    const updateUser = schemaMap['UpdateUser']!
    expect(updateUser['required']).toBeUndefined()
  })

  it('복수 테이블 → 모든 스키마 포함', async () => {
    const tables = extractTablesFromModule({ usersTable, postsTable })
    const schemas = await convertTables(tables, ['select'], defaultNaming)

    const names = schemas.map(s => s.name).sort()
    expect(names).toEqual(['Post', 'User'])

    // Post 스키마 검증
    const postSchema = schemas.find(s => s.name === 'Post')!
    expect(postSchema.schema.type).toBe('object')
    const postProps = postSchema.schema.properties as Record<string, Record<string, unknown>>
    expect(postProps['title']).toBeDefined()
    expect(postProps['body']).toBeDefined()
  })

  it('mergeIntoSpec — 빈 spec.yaml에 병합', async () => {
    const tables = extractTablesFromModule({ usersTable })
    const schemas = await convertTables(tables, ['select'], defaultNaming)
    const warnings: string[] = []
    const specPath = join(tmpDir, 'spec.yaml')

    mergeIntoSpec(
      schemas.map(s => ({ name: s.name, schema: s.schema as Record<string, unknown> })),
      specPath,
      warnings,
    )

    expect(existsSync(specPath)).toBe(true)
    const parsed = parseYaml(readFileSync(specPath, 'utf8')) as Record<string, unknown>
    const components = parsed['components'] as Record<string, unknown>
    const schemaMap = components['schemas'] as Record<string, unknown>
    expect(schemaMap['User']).toBeDefined()
    expect(warnings).toHaveLength(0)
  })

  it('mergeIntoSpec — 기존 spec.yaml에 스키마 추가', async () => {
    const specPath = join(tmpDir, 'spec.yaml')

    // 기존 spec 작성
    const existingSpec = {
      openapi: '3.2.0',
      info: { title: 'Test', version: '1.0.0' },
      components: {
        schemas: {
          Error: { type: 'object', properties: { message: { type: 'string' } } },
        },
      },
    }
    writeFileSync(specPath, stringifyYaml(existingSpec), 'utf8')

    // 새 스키마 병합
    const tables = extractTablesFromModule({ usersTable })
    const schemas = await convertTables(tables, ['select'], defaultNaming)
    const warnings: string[] = []

    mergeIntoSpec(
      schemas.map(s => ({ name: s.name, schema: s.schema as Record<string, unknown> })),
      specPath,
      warnings,
    )

    const parsed = parseYaml(readFileSync(specPath, 'utf8')) as Record<string, unknown>
    const components = parsed['components'] as Record<string, unknown>
    const schemaMap = components['schemas'] as Record<string, unknown>

    // 기존 + 새 스키마 모두 존재
    expect(schemaMap['Error']).toBeDefined()
    expect(schemaMap['User']).toBeDefined()
    expect(warnings).toHaveLength(0)
  })

  it('mergeIntoSpec — 중복 키 경고', async () => {
    const specPath = join(tmpDir, 'spec.yaml')

    // User 스키마가 이미 있는 spec
    const existingSpec = {
      components: {
        schemas: {
          User: { type: 'object', properties: { legacy: { type: 'string' } } },
        },
      },
    }
    writeFileSync(specPath, stringifyYaml(existingSpec), 'utf8')

    const tables = extractTablesFromModule({ usersTable })
    const schemas = await convertTables(tables, ['select'], defaultNaming)
    const warnings: string[] = []

    mergeIntoSpec(
      schemas.map(s => ({ name: s.name, schema: s.schema as Record<string, unknown> })),
      specPath,
      warnings,
    )

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('User')
    expect(warnings[0]).toContain('덮어씁니다')

    // 덮어쓴 후 새 스키마로 교체
    const parsed = parseYaml(readFileSync(specPath, 'utf8')) as Record<string, unknown>
    const components = parsed['components'] as Record<string, unknown>
    const schemaMap = components['schemas'] as Record<string, Record<string, unknown>>
    const user = schemaMap['User']!
    expect(user['properties']).not.toHaveProperty('legacy')
    expect(user['required']).toBeDefined() // 새 스키마의 required 존재
  })

  it('커스텀 naming 적용', async () => {
    const tables = extractTablesFromModule({ usersTable })
    const customNaming = {
      select: (name: string) => `${name.toUpperCase()}Response`,
      insert: (name: string) => `Create${name.charAt(0).toUpperCase() + name.slice(1)}Request`,
      update: (name: string) => `Patch${name.charAt(0).toUpperCase() + name.slice(1)}Request`,
    }
    const schemas = await convertTables(tables, ['select', 'insert', 'update'], customNaming)

    const names = schemas.map(s => s.name).sort()
    expect(names).toEqual(['CreateUsersRequest', 'PatchUsersRequest', 'USERSResponse'])
  })

  it('select 타입만 생성', async () => {
    const tables = extractTablesFromModule({ usersTable })
    const schemas = await convertTables(tables, ['select'], defaultNaming)

    expect(schemas).toHaveLength(1)
    expect(schemas[0]!.name).toBe('User')
    expect(schemas[0]!.schemaType).toBe('select')
  })

  it('nullable 컬럼 → anyOf nullable 변환', async () => {
    const tables = extractTablesFromModule({ usersTable })
    const schemas = await convertTables(tables, ['select'], defaultNaming)

    const user = schemas[0]!.schema
    const props = user.properties as Record<string, Record<string, unknown>>
    // bio는 nullable → anyOf: [inner, { type: 'null' }]
    const bio = props['bio']!
    expect(bio['anyOf']).toBeDefined()
    const anyOf = bio['anyOf'] as Array<Record<string, unknown>>
    expect(anyOf).toHaveLength(2)
    expect(anyOf.some(s => s['type'] === 'null')).toBe(true)
    expect(anyOf.some(s => s['type'] === 'string')).toBe(true)
  })

  it('insert 스키마에서 default 컬럼은 required에서 제외', async () => {
    const tables = extractTablesFromModule({ usersTable })
    const schemas = await convertTables(tables, ['insert'], defaultNaming)

    const insertUser = schemas[0]!.schema
    const required = (insertUser.required ?? []) as string[]

    // active는 .default(true), createdAt은 .defaultNow()
    expect(required).not.toContain('active')
    expect(required).not.toContain('createdAt')
    expect(required).not.toContain('created_at')

    // name, email은 notNull이고 default 없음 → required
    expect(required).toContain('name')
    expect(required).toContain('email')
  })

  it('YAML 라운드트립 — 파싱 후 재직렬화 안정', async () => {
    const tables = extractTablesFromModule({ usersTable })
    const schemas = await convertTables(tables, ['select', 'insert', 'update'], defaultNaming)

    const spec = {
      components: {
        schemas: Object.fromEntries(schemas.map(s => [s.name, s.schema])),
      },
    }
    const yaml1 = stringifyYaml(spec, { lineWidth: 0 })
    const parsed = parseYaml(yaml1) as Record<string, unknown>
    const yaml2 = stringifyYaml(parsed, { lineWidth: 0 })

    expect(yaml1).toBe(yaml2)
  })
})
