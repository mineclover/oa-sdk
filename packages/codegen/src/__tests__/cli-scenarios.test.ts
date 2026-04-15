/**
 * CLI 실사용 시나리오 테스트
 *
 * 실제 스펙 파일로 typegen → router → client 파이프라인,
 * lint/validate 커맨드, 에러 시나리오, 단축 플래그 검증.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync, spawnSync, type ExecSyncOptionsWithStringEncoding } from 'node:child_process'
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
let collisionSpecPath: string
let missingExternalSpecPath: string
let nestedExternalSpecPath: string
let externalSourceLocationSpecPath: string

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

function cliCapture(args: string): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [cliPath, ...args.split(' ')], {
    cwd: pkgDir,
    encoding: 'utf8',
    timeout: 15_000,
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  }
}

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true })
  specPath = join(tmpDir, 'api.yaml')
  invalidSpecPath = join(tmpDir, 'bad.yaml')
  externalSpecPath = join(tmpDir, 'external-api.yaml')
  sharedSpecPath = join(tmpDir, 'shared.yaml')
  collisionSpecPath = join(tmpDir, 'collision-api.yaml')
  missingExternalSpecPath = join(tmpDir, 'missing-external-api.yaml')
  nestedExternalSpecPath = join(tmpDir, 'nested-external-api.yaml')
  externalSourceLocationSpecPath = join(tmpDir, 'external-source-location-api.yaml')
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
  writeFileSync(join(tmpDir, 'shared-a.yaml'), yamlStringify({
    components: {
      schemas: {
        User: { type: 'object', required: ['a'], properties: { a: { type: 'string' } } },
      },
    },
  }), 'utf8')
  writeFileSync(join(tmpDir, 'shared-b.yaml'), yamlStringify({
    components: {
      schemas: {
        User: { type: 'object', required: ['b'], properties: { b: { type: 'number' } } },
      },
    },
  }), 'utf8')
  writeFileSync(collisionSpecPath, yamlStringify({
    openapi: '3.2.0',
    info: { title: 'Collision API', version: '1.0.0' },
    paths: {
      '/a': {
        get: {
          operationId: 'getA',
          responses: {
            '200': {
              description: 'A',
              content: { 'application/json': { schema: { $ref: './shared-a.yaml#/components/schemas/User' } } },
            },
          },
        },
      },
      '/b': {
        get: {
          operationId: 'getB',
          responses: {
            '200': {
              description: 'B',
              content: { 'application/json': { schema: { $ref: './shared-b.yaml#/components/schemas/User' } } },
            },
          },
        },
      },
    },
  }), 'utf8')
  writeFileSync(missingExternalSpecPath, yamlStringify({
    openapi: '3.2.0',
    info: { title: 'Missing External API', version: '1.0.0' },
    paths: {
      '/missing': {
        get: {
          operationId: 'getMissing',
          responses: {
            '200': {
              description: 'Missing',
              content: { 'application/json': { schema: { $ref: './missing.yaml#/components/schemas/User' } } },
            },
          },
        },
      },
    },
  }), 'utf8')
  writeFileSync(join(tmpDir, 'nested-user.yaml'), yamlStringify({
    components: {
      schemas: {
        User: {
          type: 'object',
          properties: { role: { $ref: '#/components/schemas/Role' } },
        },
        Role: { type: 'string', enum: ['admin', 'user'] },
      },
    },
  }), 'utf8')
  writeFileSync(nestedExternalSpecPath, yamlStringify({
    openapi: '3.2.0',
    info: { title: 'Nested External API', version: '1.0.0' },
    paths: {
      '/nested-users': {
        get: {
          operationId: 'getNestedUser',
          responses: {
            '200': {
              description: 'Nested',
              content: { 'application/json': { schema: { $ref: './nested-user.yaml#/components/schemas/User' } } },
            },
          },
        },
      },
    },
  }), 'utf8')
  writeFileSync(join(tmpDir, 'source-location-shared.yaml'), [
    'components:',
    '  schemas:',
    '    User:',
    '      type: object',
    '      properties:',
    '        role:',
    '          $ref: "./source-location-empty.yaml#/components/schemas/Missing"',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(join(tmpDir, 'source-location-empty.yaml'), [
    'components:',
    '  schemas: {}',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(externalSourceLocationSpecPath, [
    'openapi: 3.2.0',
    'info:',
    '  title: External Source Location API',
    '  version: 1.0.0',
    'paths:',
    '  /users:',
    '    get:',
    '      responses:',
    '        "200":',
    '          description: OK',
    '          content:',
    '            application/json:',
    '              schema:',
    '                $ref: "./source-location-shared.yaml#/components/schemas/User"',
    '',
  ].join('\n'), 'utf8')
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

  it('외부 schema 이름 충돌 시 파일명 기반 타입명과 경고를 생성', () => {
    const { stdout, stderr, status } = cliCapture(`typegen -s ${collisionSpecPath}`)
    expect(status).toBe(0)
    expect(stderr).toContain('외부 스키마 이름 충돌')
    expect(stdout).toContain('export type SharedAUser =')
    expect(stdout).toContain('export type SharedBUser =')
    expect(stdout).toContain('export type GetAResponse = SharedAUser')
    expect(stdout).toContain('export type GetBResponse = SharedBUser')
  })

  it('외부 schema 내부 internal $ref 타입도 생성', () => {
    const out = cli(`typegen -s ${nestedExternalSpecPath}`)
    expect(out).toContain('export type User =')
    expect(out).toContain('export type Role =')
    expect(out).toContain('role?: Role')
    expect(out).toContain('export type GetNestedUserResponse = User')
  })

  it('증분 typegen 출력이 full rebuild와 일치하고 외부 ref 변경을 반영한다', () => {
    const dir = join(tmpDir, 'incremental-typegen')
    mkdirSync(dir, { recursive: true })
    const apiPath = join(dir, 'api.yaml')
    const sharedPath = join(dir, 'shared.yaml')
    const cacheDir = join(dir, 'cache')

    writeFileSync(sharedPath, yamlStringify({
      components: {
        schemas: {
          ExternalUser: {
            type: 'object',
            properties: { id: { type: 'string' } },
          },
        },
      },
    }), 'utf8')
    writeFileSync(apiPath, yamlStringify({
      openapi: '3.2.0',
      info: { title: 'Incremental API', version: '1.0.0' },
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { schema: { $ref: './shared.yaml#/components/schemas/ExternalUser' } } },
              },
            },
          },
        },
      },
    }), 'utf8')

    const full = cli(`typegen -s ${apiPath}`)
    const incremental = cli(`typegen -s ${apiPath} --incremental --cache-dir ${cacheDir}`)
    expect(incremental).toBe(full)
    expect(existsSync(join(cacheDir, 'state.sqlite'))).toBe(true)

    writeFileSync(sharedPath, yamlStringify({
      components: {
        schemas: {
          ExternalUser: {
            type: 'object',
            properties: { id: { type: 'string' }, name: { type: 'string' } },
          },
        },
      },
    }), 'utf8')

    const updatedFull = cli(`typegen -s ${apiPath}`)
    const updatedIncremental = cli(`typegen -s ${apiPath} --incremental --cache-dir ${cacheDir}`)
    expect(updatedIncremental).toBe(updatedFull)
    expect(updatedIncremental).toContain('name?: string')
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

  it('외부 $ref 실패 시 source 파일과 pointer를 출력', () => {
    const { stdout, stderr } = cliFail(`lint -s ${missingExternalSpecPath}`)
    const combined = stdout + stderr
    expect(combined).toContain('missing.yaml#/components/schemas/User')
  })

  it('외부 YAML 문서의 nested diagnostic에 line/column 위치를 출력', () => {
    const { stdout, stderr } = cliFail(`lint -s ${externalSourceLocationSpecPath}`)
    const combined = stdout + stderr
    expect(combined).toContain('source-location-shared.yaml:7:11')
    expect(combined).toContain('source-location-empty.yaml#/components/schemas/Missing')
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

  it('외부 $ref 실패 시 validate도 source 파일과 pointer를 출력', () => {
    const { stdout, stderr } = cliFail(`validate -s ${missingExternalSpecPath}`)
    const combined = stdout + stderr
    expect(combined).toContain('missing.yaml#/components/schemas/User')
  })

  it('잘못된 스펙 → exit 1', () => {
    const { stdout, stderr } = cliFail(`validate -s ${invalidSpecPath}`)
    const combined = stdout + stderr
    expect(combined).toBeTruthy()
  })

  it('증분 validate 출력이 full rebuild와 일치한다', () => {
    const cacheDir = join(tmpDir, 'incremental-validate-cache')
    const full = cli(`validate -s ${externalSpecPath}`)
    const incremental = cli(`validate -s ${externalSpecPath} --incremental --cache-dir ${cacheDir}`)
    const repeated = cli(`validate -s ${externalSpecPath} --incremental --cache-dir ${cacheDir}`)

    expect(incremental).toBe(full)
    expect(repeated).toBe(full)
    expect(existsSync(join(cacheDir, 'state.sqlite'))).toBe(true)
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
