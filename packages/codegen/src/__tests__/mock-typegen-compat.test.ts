/**
 * mock-server 응답 ↔ typegen 타입 구조 호환성 검증
 *
 * 실제 스펙 → mock-server로 최소 응답 생성 → typegen 타입에 대입 → tsc 검증.
 * mock-server가 생성하는 데이터가 typegen 타입 계약을 충족하는지 확인.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { parseDocument, derefSpec, foldSchema, type OasDocument, type OasSchema } from '@oa-sdk/parser'

const pkgDir = resolve(__dirname, '../..')
const tscBin = resolve(pkgDir, 'node_modules/.bin/tsc')
const tmpDir = join(pkgDir, '.tmp-mock-compat')

afterAll(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

// ── 테스트 스펙 ─────────────────────────────────────────────

const spec = {
  openapi: '3.2.0',
  info: { title: 'Mock Compat', version: '1.0.0' },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/User' } } } },
          },
        },
      },
      post: {
        operationId: 'createUser',
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/NewUser' } } } },
        responses: {
          '201': { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
          '400': { description: 'Bad', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
        },
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: 'object',
        required: ['id', 'name', 'role'],
        properties: {
          id:    { type: 'string', format: 'uuid' },
          name:  { type: 'string' },
          email: { type: 'string', format: 'email' },
          role:  { type: 'string', enum: ['admin', 'user'] },
          score: { type: 'integer' },
        },
      },
      NewUser: {
        type: 'object',
        required: ['name', 'role'],
        properties: {
          name: { type: 'string' },
          role: { type: 'string', enum: ['admin', 'user'] },
        },
      },
      ApiError: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code:    { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
  },
} as unknown as OasDocument

describe('mock-server 응답 ↔ typegen 타입 호환', () => {
  it('generateAlgebra가 생성하는 값이 typegen 타입에 대입 가능', async () => {
    mkdirSync(tmpDir, { recursive: true })

    // 1. typegen으로 TS 타입 생성
    const { generateTypesFromSpec } = await import('../typegen/generate-types.js')
    const tsTypes = generateTypesFromSpec(spec, { banner: false })

    // 2. mock-server의 generateAlgebra로 각 스키마의 최소값 생성
    const { generateAlgebra } = await import('@oa-sdk/mock-server')
    const derefed = derefSpec(spec)
    const schemas = (derefed.components?.schemas ?? {}) as Record<string, OasSchema>

    const mockValues: Record<string, unknown> = {}
    for (const [name, schema] of Object.entries(schemas)) {
      mockValues[name] = foldSchema(schema, generateAlgebra)
    }

    // 3. mock 값을 TS 리터럴로 직렬화
    function toLiteral(val: unknown): string {
      if (val === null) return 'null'
      if (val === undefined) return 'undefined'
      if (typeof val === 'string') return JSON.stringify(val)
      if (typeof val === 'number' || typeof val === 'boolean') return String(val)
      if (Array.isArray(val)) return `[${val.map(toLiteral).join(', ')}]`
      if (typeof val === 'object') {
        const entries = Object.entries(val as Record<string, unknown>)
          .map(([k, v]) => `${JSON.stringify(k)}: ${toLiteral(v)}`)
        return `{ ${entries.join(', ')} }`
      }
      return 'undefined'
    }

    // 4. 사용 코드 — mock 값이 타입에 대입되는지
    const usage = Object.entries(mockValues)
      .map(([name, val]) => `const mock${name}: ${name} = ${toLiteral(val)}`)
      .join('\n')

    const content = `${tsTypes}\n\n// mock-server generateAlgebra 출력값\n${usage}\n`

    writeFileSync(join(tmpDir, 'compat.ts'), content, 'utf8')
    writeFileSync(join(tmpDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        strict: true, noEmit: true, module: 'ESNext',
        moduleResolution: 'bundler', target: 'ES2022',
      },
      include: ['compat.ts'],
    }), 'utf8')

    try {
      execSync(`${tscBin} --noEmit`, { cwd: tmpDir, encoding: 'utf8', timeout: 15_000, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string }
      const output = (e.stdout ?? '') + (e.stderr ?? '')
      expect.fail(`mock-server 응답이 typegen 타입과 불일치:\n${output}\n\n생성된 코드:\n${content}`)
    }
  }, 20_000)

  it('mock-server 최소값이 required 필드만 포함', async () => {
    const { generateAlgebra } = await import('@oa-sdk/mock-server')
    const derefed = derefSpec(spec)
    const userSchema = (derefed.components?.schemas as Record<string, OasSchema>)['User']!

    const mockUser = foldSchema(userSchema, generateAlgebra) as Record<string, unknown>

    // required 필드는 존재
    expect(mockUser).toHaveProperty('id')
    expect(mockUser).toHaveProperty('name')
    expect(mockUser).toHaveProperty('role')

    // optional 필드는 미포함
    expect(mockUser).not.toHaveProperty('email')
    expect(mockUser).not.toHaveProperty('score')
  })

  it('mock-server enum 값이 유효한 enum 값', async () => {
    const { generateAlgebra } = await import('@oa-sdk/mock-server')
    const derefed = derefSpec(spec)
    const userSchema = (derefed.components?.schemas as Record<string, OasSchema>)['User']!

    const mockUser = foldSchema(userSchema, generateAlgebra) as Record<string, unknown>
    expect(['admin', 'user']).toContain(mockUser.role)
  })

  it('mock-server format 값이 올바른 형식', async () => {
    const { generateAlgebra } = await import('@oa-sdk/mock-server')
    const derefed = derefSpec(spec)
    const userSchema = (derefed.components?.schemas as Record<string, OasSchema>)['User']!

    // required에 포함된 id(uuid)
    const mockUser = foldSchema(userSchema, generateAlgebra) as Record<string, unknown>
    expect(mockUser.id).toMatch(/^[0-9a-f-]{36}$/)
  })
})
