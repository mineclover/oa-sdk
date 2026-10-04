/**
 * 타입 시맨틱 검증 — 생성된 타입이 스펙 의미대로 동작하는지 tsc로 검증
 *
 * 방법: 생성 타입 + 사용 코드(.ts) → tsc strict
 *   - 올바른 할당: 컴파일 성공
 *   - 잘못된 할당: @ts-expect-error로 컴파일 에러 확인
 *
 * @ts-expect-error가 없는데 에러가 나면 → 타입 생성 버그
 * @ts-expect-error가 있는데 에러가 안 나면 → 타입이 너무 느슨함
 */
import { describe, it, expect, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { stringify as yamlStringify } from 'yaml'

const pkgDir = resolve(__dirname, '../../..')
const cliPath = resolve(pkgDir, 'dist/cli/index.js')
const tmpDir = join(pkgDir, '.tmp-type-semantics')

function cli(args: string): string {
  return execSync(`node ${cliPath} ${args}`, { cwd: pkgDir, encoding: 'utf8', timeout: 10_000 })
}

const tscBin = resolve(pkgDir, 'node_modules/.bin/tsc')

function compileTsc(dir: string): { ok: boolean; output: string } {
  try {
    execSync(`${tscBin} --noEmit`, { cwd: dir, encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'] })
    return { ok: true, output: '' }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string }
    return { ok: false, output: (e.stdout ?? '') + (e.stderr ?? '') }
  }
}

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true,
    noEmit: true,
    module: 'ESNext',
    moduleResolution: 'bundler',
    target: 'ES2022',
    // tmpDir는 패키지 안에 있어 상위 node_modules/@types(node, react 등)가 자동 포함된다.
    // 생성 타입은 앰비언트 전역에 의존하지 않으므로 제외한다(compile-check.test.ts와 동일).
    types: [],
  },
  include: ['*.ts'],
})

// ── 테스트용 스펙 ──────────────────────────────────────────

const SPEC = {
  openapi: '3.2.0',
  info: { title: 'Semantics Test', version: '1.0.0' },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'OK', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/User' } } } } },
          '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
        },
      },
      post: {
        operationId: 'createUser',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateUserBody' } } } },
        responses: { '201': { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } },
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: 'object',
        required: ['id', 'name', 'role'],
        properties: {
          id:    { type: 'string' },
          name:  { type: 'string' },
          email: { type: 'string' },
          role:  { type: 'string', enum: ['admin', 'user', 'guest'] },
          bio:   { type: ['string', 'null'] },
          tags:  { type: 'array', items: { type: 'string' } },
        },
      },
      CreateUserBody: {
        type: 'object',
        required: ['name', 'role'],
        properties: {
          name: { type: 'string' },
          role: { type: 'string', enum: ['admin', 'user', 'guest'] },
        },
      },
      ApiError: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code:    { type: 'integer' },
          message: { type: 'string' },
        },
      },
      Status: { type: 'string', enum: ['active', 'inactive'] },
      NullableName: { type: ['string', 'null'] },
      Coord: {
        type: 'array',
        prefixItems: [{ type: 'number' }, { type: 'number' }],
      },
      Shape: {
        oneOf: [
          { type: 'object', required: ['kind', 'r'], properties: { kind: { type: 'string', const: 'circle' }, r: { type: 'number' } } },
          { type: 'object', required: ['kind', 's'], properties: { kind: { type: 'string', const: 'rect' }, s: { type: 'number' } } },
        ],
        discriminator: { propertyName: 'kind' },
      },
      WithBase: {
        allOf: [
          { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
          { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
        ],
      },
      StringMap: { type: 'object', additionalProperties: { type: 'string' } },
    },
  },
}

let specPath: string
let generatedTypes: string

afterAll(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

function setupTest(): void {
  mkdirSync(tmpDir, { recursive: true })
  if (generatedTypes) return
  specPath = join(tmpDir, 'spec.yaml')
  writeFileSync(specPath, yamlStringify(SPEC), 'utf8')
  generatedTypes = cli(`typegen -s ${specPath}`)
  writeFileSync(join(tmpDir, 'tsconfig.json'), TSCONFIG, 'utf8')
}

function runTypeTest(name: string, usageCode: string): { ok: boolean; output: string } {
  setupTest()
  const content = `${generatedTypes}\n\n// ── ${name} ──\n${usageCode}\n`
  writeFileSync(join(tmpDir, `${name}.ts`), content, 'utf8')
  // tsconfig에서 이 파일만 포함하도록 덮어쓰기
  writeFileSync(join(tmpDir, 'tsconfig.json'), JSON.stringify({
    ...JSON.parse(TSCONFIG),
    include: [`${name}.ts`],
  }), 'utf8')
  return compileTsc(tmpDir)
}

// ── 올바른 할당 (컴파일 성공해야 함) ────────────────────────

describe('올바른 할당 — 컴파일 성공', () => {
  it('required + optional 필드 전부 제공', () => {
    const r = runTypeTest('valid-full', `
      const u: User = { id: '1', name: 'Alice', role: 'admin', email: 'a@b.com', bio: 'hi', tags: ['ts'] }
    `)
    expect(r.output).toBe('')
    expect(r.ok).toBe(true)
  })

  it('required만 제공 (optional 생략)', () => {
    const r = runTypeTest('valid-required-only', `
      const u: User = { id: '1', name: 'Alice', role: 'admin' }
    `)
    expect(r.ok).toBe(true)
  })

  it('nullable 필드에 null 할당', () => {
    const r = runTypeTest('valid-nullable', `
      const u: User = { id: '1', name: 'Alice', role: 'user', bio: null }
    `)
    expect(r.ok).toBe(true)
  })

  it('enum 유효값', () => {
    const r = runTypeTest('valid-enum', `
      const s: Status = 'active'
      const r: User['role'] = 'guest'
    `)
    expect(r.ok).toBe(true)
  })

  it('nullable 타입에 string과 null 모두 가능', () => {
    const r = runTypeTest('valid-nullable-both', `
      const a: NullableName = 'hello'
      const b: NullableName = null
    `)
    expect(r.ok).toBe(true)
  })

  it('배열 타입', () => {
    const r = runTypeTest('valid-array', `
      const u: User = { id: '1', name: 'A', role: 'user', tags: ['a', 'b'] }
      const list: ListUsersResponse = [u]
    `)
    expect(r.ok).toBe(true)
  })

  it('튜플 타입', () => {
    const r = runTypeTest('valid-tuple', `
      const c: Coord = [1.5, 2.5]
    `)
    expect(r.ok).toBe(true)
  })

  it('allOf intersection — 양쪽 필드 모두 제공', () => {
    const r = runTypeTest('valid-allof', `
      const w: WithBase = { id: '1', name: 'X' }
    `)
    expect(r.ok).toBe(true)
  })

  it('Record<string, string> 할당', () => {
    const r = runTypeTest('valid-record', `
      const m: StringMap = { foo: 'bar', baz: 'qux' }
    `)
    expect(r.ok).toBe(true)
  })

  it('Op 번들 타입 구조', () => {
    const r = runTypeTest('valid-op', `
      const op: ListUsersOp = {
        method: 'get' as const,
        path: '/users' as const,
        query: { limit: 10 },
        response: [{ id: '1', name: 'A', role: 'admin' }],
      }
    `)
    expect(r.ok).toBe(true)
  })

  it('에러 타입', () => {
    const r = runTypeTest('valid-error', `
      const e: ApiError = { code: 404, message: 'Not found' }
    `)
    expect(r.ok).toBe(true)
  })
})

// ── 잘못된 할당 (@ts-expect-error 필수) ─────────────────────

describe('잘못된 할당 — @ts-expect-error 검증', () => {
  it('required 필드 누락 → 에러', () => {
    const r = runTypeTest('err-missing-required', `
      // @ts-expect-error required 필드 'role' 누락
      const u: User = { id: '1', name: 'Alice' }
    `)
    expect(r.ok).toBe(true) // expect-error가 에러를 잡으므로 전체는 통과
  })

  it('wrong type → 에러', () => {
    const r = runTypeTest('err-wrong-type', `
      // @ts-expect-error id는 string인데 number 할당
      const u: User = { id: 123, name: 'Alice', role: 'admin' }
    `)
    expect(r.ok).toBe(true)
  })

  it('non-nullable에 null → 에러', () => {
    const r = runTypeTest('err-non-nullable', `
      // @ts-expect-error name은 nullable이 아닌데 null
      const u: User = { id: '1', name: null, role: 'admin' }
    `)
    expect(r.ok).toBe(true)
  })

  it('invalid enum 값 → 에러', () => {
    const r = runTypeTest('err-invalid-enum', `
      // @ts-expect-error 'superadmin'은 유효하지 않은 enum 값
      const s: Status = 'superadmin'
    `)
    expect(r.ok).toBe(true)
  })

  it('튜플 길이 초과 → 에러', () => {
    const r = runTypeTest('err-tuple-length', `
      // @ts-expect-error Coord는 [number, number]인데 3개 요소
      const c: Coord = [1, 2, 3]
    `)
    expect(r.ok).toBe(true)
  })

  it('Record<string, string>에 number 값 → 에러', () => {
    const r = runTypeTest('err-record-value', `
      // @ts-expect-error string 값만 허용인데 number
      const m: StringMap = { key: 123 }
    `)
    expect(r.ok).toBe(true)
  })

  it('배열에 잘못된 타입 → 에러', () => {
    const r = runTypeTest('err-array-type', `
      // @ts-expect-error string[] 타입에 number
      const tags: User['tags'] = [1, 2, 3]
    `)
    expect(r.ok).toBe(true)
  })

  it('에러 타입 required 누락 → 에러', () => {
    const r = runTypeTest('err-error-missing', `
      // @ts-expect-error message 필드 누락
      const e: ApiError = { code: 404 }
    `)
    expect(r.ok).toBe(true)
  })
})
