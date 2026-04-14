/**
 * CLI 실사용 시나리오 테스트
 *
 * 실제 스펙 파일로 typegen → router → client 파이프라인,
 * lint/validate 커맨드, 에러 시나리오, 단축 플래그 검증.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync, type ExecSyncOptionsWithStringEncoding } from 'node:child_process'
import { stringify as yamlStringify } from 'yaml'

const pkgDir = resolve(__dirname, '../..')
const cliPath = resolve(pkgDir, 'dist/cli/index.js')
const tmpDir = resolve(pkgDir, '.tmp-cli-scenario')

// ── 테스트용 스펙 ──────────────────────────────────────────

const VALID_SPEC = {
  openapi: '3.2.0',
  info: { title: 'Test API', version: '1.0.0' },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        summary: 'List all users',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/User' } } } } } },
      },
      post: {
        operationId: 'createUser',
        summary: 'Create a user',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateUserBody' } } } },
        responses: { '201': { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } },
      },
    },
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } },
      },
    },
  },
  components: {
    schemas: {
      User: { type: 'object', required: ['id', 'name'], properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string', format: 'email' } } },
      CreateUserBody: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, email: { type: 'string' } } },
    },
  },
}

// openapi 필드 누락 → 구조 에러
const INVALID_SPEC = {
  info: { title: 'Bad', version: '0' },
  paths: {
    '/test': {
      get: {
        responses: { '200': { description: 'OK' } },
      },
    },
  },
}

let specPath: string
let invalidSpecPath: string
let externalSpecPath: string
let sharedSpecPath: string

const execOpts: ExecSyncOptionsWithStringEncoding = { cwd: pkgDir, encoding: 'utf8', timeout: 15_000 }

function cli(args: string): string {
  return execSync(`node ${cliPath} ${args}`, execOpts)
}

function cliFail(args: string): { stdout: string; stderr: string } {
  try {
    const stdout = execSync(`node ${cliPath} ${args}`, execOpts)
    throw new Error(`expected to fail but got: ${stdout.slice(0, 100)}`)
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true })
  specPath = join(tmpDir, 'api.yaml')
  invalidSpecPath = join(tmpDir, 'bad.yaml')
  externalSpecPath = join(tmpDir, 'external-api.yaml')
  sharedSpecPath = join(tmpDir, 'shared.yaml')
  writeFileSync(specPath, yamlStringify(VALID_SPEC), 'utf8')
  writeFileSync(invalidSpecPath, yamlStringify(INVALID_SPEC), 'utf8')
  writeFileSync(sharedSpecPath, yamlStringify({
    components: {
      schemas: {
        ExternalUser: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
      },
    },
  }), 'utf8')
  writeFileSync(externalSpecPath, yamlStringify({
    openapi: '3.2.0',
    info: { title: 'External Ref API', version: '1.0.0' },
    paths: {
      '/external-users': {
        get: {
          operationId: 'listExternalUsers',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { $ref: './shared.yaml#/components/schemas/ExternalUser' },
                },
              },
            },
          },
        },
      },
    },
  }), 'utf8')
})

afterAll(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

// ── typegen ─────────────────────────────────────────────────

describe('typegen', () => {
  it('stdout에 타입 출력', () => {
    const out = cli(`typegen -s ${specPath}`)
    expect(out).toContain('export type User')
    expect(out).toContain('export type CreateUserBody')
  })

  it('--output으로 파일 생성', () => {
    const outFile = join(tmpDir, 'types.ts')
    cli(`typegen --spec ${specPath} --output ${outFile}`)
    expect(existsSync(outFile)).toBe(true)
    const content = readFileSync(outFile, 'utf8')
    expect(content).toContain('export type User')
  })

  it('--style interface', () => {
    const out = cli(`typegen -s ${specPath} --style interface`)
    expect(out).toContain('export interface User')
  })

  it('생성된 타입에 Op 번들 타입 포함', () => {
    const out = cli(`typegen -s ${specPath}`)
    expect(out).toContain('ListUsersOp')
    expect(out).toContain('CreateUserOp')
    expect(out).toContain('GetUserOp')
  })

  it('외부 YAML $ref schema 타입을 생성', () => {
    const out = cli(`typegen -s ${externalSpecPath}`)
    expect(out).toContain('export type ExternalUser =')
    expect(out).toContain('export type ListExternalUsersResponse = ExternalUser')
  })
})

// ── router ──────────────────────────────────────────────────

describe('router', () => {
  it('Hono 라우터 생성 (기본)', () => {
    const out = cli(`router -s ${specPath} --types-import './types'`)
    expect(out).toContain("import { Hono } from 'hono'")
    expect(out).toContain("app.get('/users'")
    expect(out).toContain("app.post('/users'")
    expect(out).toContain("app.get('/users/:id'")
  })

  it('Express 라우터 생성', () => {
    const out = cli(`router -s ${specPath} --target express --types-import './types'`)
    expect(out).toContain("import { Router } from 'express'")
    expect(out).toContain("router.get('/users'")
  })

  it('--output으로 파일 생성', () => {
    const outFile = join(tmpDir, 'router.ts')
    cli(`router --spec ${specPath} -o ${outFile} --types-import './types'`)
    expect(existsSync(outFile)).toBe(true)
  })
})

// ── client ──────────────────────────────────────────────────

describe('client', () => {
  it('fetch 클라이언트 생성', () => {
    const out = cli(`client -s ${specPath} --types-import './types'`)
    expect(out).toContain('createClient')
    expect(out).toContain('listUsers')
    expect(out).toContain('createUser')
    expect(out).toContain('getUser')
  })

  it('--output으로 파일 생성', () => {
    const outFile = join(tmpDir, 'client.ts')
    cli(`client --spec ${specPath} -o ${outFile} --types-import './types'`)
    const content = readFileSync(outFile, 'utf8')
    expect(content).toContain('createClient')
  })
})

// ── lint ─────────────────────────────────────────────────────

describe('lint', () => {
  it('유효한 스펙 → 0 errors', () => {
    const out = cli(`lint -s ${specPath}`)
    expect(out).toContain('0 errors')
  })

  it('외부 YAML $ref 스펙 → 0 errors', () => {
    const out = cli(`lint -s ${externalSpecPath}`)
    expect(out).toContain('0 errors')
  })

  it('구조 에러 스펙 → lint 에러 + exit 1', () => {
    const { stdout, stderr } = cliFail(`lint -s ${invalidSpecPath}`)
    // lint 결과는 stdout으로, 에러 메시지는 stderr로 출력될 수 있음
    const combined = stdout + stderr
    expect(combined).toContain('error')
  })
})

// ── validate ────────────────────────────────────────────────

describe('validate', () => {
  it('유효한 스펙 → Valid', () => {
    const out = cli(`validate -s ${specPath}`)
    expect(out).toContain('Valid')
    expect(out).toContain('3.1 호환')
  })

  it('외부 YAML $ref 스펙 → Valid', () => {
    const out = cli(`validate -s ${externalSpecPath}`)
    expect(out).toContain('Valid')
  })

  it('잘못된 스펙 → exit 1', () => {
    const { stdout, stderr } = cliFail(`validate -s ${invalidSpecPath}`)
    const combined = stdout + stderr
    expect(combined).toBeTruthy()
  })
})

// ── 에러 시나리오 ───────────────────────────────────────────

describe('에러 처리', () => {
  it('존재하지 않는 스펙 파일 → 에러', () => {
    const { stderr } = cliFail(`typegen -s /tmp/no-such-file.yaml`)
    expect(stderr).toContain('스펙 파일 읽기 실패')
  })

  it('필수 옵션 누락 → 에러', () => {
    const { stderr } = cliFail('typegen')
    expect(stderr).toContain('--spec')
  })

  it('알 수 없는 커맨드 → 에러 + help 안내', () => {
    const { stderr } = cliFail('nonexistent')
    expect(stderr).toContain('알 수 없는 커맨드')
    expect(stderr).toContain('--help')
  })

  it('generate에 --config도 --drizzle-schema도 없으면 에러', () => {
    const { stderr } = cliFail('generate')
    expect(stderr).toContain('--config')
  })
})

// ── 파이프라인 시나리오 ─────────────────────────────────────

describe('typegen → router → client 파이프라인', () => {
  it('동일 스펙으로 세 파일 생성 후 import 경로 정합', () => {
    const outDir = join(tmpDir, 'pipeline')
    mkdirSync(outDir, { recursive: true })

    cli(`typegen -s ${specPath} -o ${join(outDir, 'types.ts')}`)
    cli(`router -s ${specPath} -o ${join(outDir, 'router.ts')} --types-import './types'`)
    cli(`client -s ${specPath} -o ${join(outDir, 'client.ts')} --types-import './types'`)

    const types = readFileSync(join(outDir, 'types.ts'), 'utf8')
    const router = readFileSync(join(outDir, 'router.ts'), 'utf8')
    const client = readFileSync(join(outDir, 'client.ts'), 'utf8')

    // types에서 정의한 타입을 router/client가 import
    expect(types).toContain('export type User')
    expect(router).toContain("from './types'")
    expect(client).toContain("from './types'")

    // router가 참조하는 타입이 types에 존재하는지 확인
    const importMatch = router.match(/import type \{([^}]+)\}/)
    const importList = importMatch?.[1]
    if (importList) {
      const imported = importList.split(',').map(s => s.trim())
      for (const name of imported) {
        expect(types).toContain(`export type ${name}`)
      }
    }
  })

  it('외부 YAML $ref 스펙으로 세 파일 생성', () => {
    const outDir = join(tmpDir, 'external-pipeline')
    mkdirSync(outDir, { recursive: true })

    cli(`typegen -s ${externalSpecPath} -o ${join(outDir, 'types.ts')}`)
    cli(`router -s ${externalSpecPath} -o ${join(outDir, 'router.ts')} --types-import './types'`)
    cli(`client -s ${externalSpecPath} -o ${join(outDir, 'client.ts')} --types-import './types'`)

    const types = readFileSync(join(outDir, 'types.ts'), 'utf8')
    const router = readFileSync(join(outDir, 'router.ts'), 'utf8')
    const client = readFileSync(join(outDir, 'client.ts'), 'utf8')

    expect(types).toContain('export type ExternalUser')
    expect(router).toContain('listExternalUsers')
    expect(client).toContain('listExternalUsers')
  })
})
