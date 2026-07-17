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
import { createSQLiteWorkspaceIndex } from '../sqlite-workspace-index.js'
import {
  createBehaviorIdentityKey,
  createBehaviorRecord,
  createBehaviorRecorderFromOptions,
} from '../cli/lib/behavior-recorder.js'

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
let schemaMetaLocationSpecPath: string

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
  return cliCaptureArgs(args.split(' '))
}

function cliCaptureArgs(args: string[]): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
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

function readJsonl(filePath: string): unknown[] {
  return readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line))
}

function cleanReviewSpec(): Record<string, unknown> {
  return {
    openapi: '3.2.0',
    info: { title: 'Review API', version: '1.0.0' },
    paths: {
      '/ping': {
        get: {
          operationId: 'getPing',
          summary: 'Get ping status',
          responses: { '204': { description: 'No content' } },
        },
      },
    },
  }
}

function metadataRegistryFixture(trackingId: string, stableKey: string): Record<string, unknown> {
  return {
    schemaVersion: 'oa-gen.metadata-registry.v1',
    targetName: 'public-api',
    summary: {
      entryCount: 1,
      explicitTrackingIdCount: 0,
      generatedTrackingIdCount: 1,
      invalidTrackingIdCount: 0,
      duplicateTrackingIdCount: 0,
      duplicateStableKeyCount: 0,
      duplicateOutputPointerCount: 0,
    },
    duplicates: {
      trackingIds: [],
      stableKeys: [],
      outputPointers: [],
    },
    entries: {
      '#/paths/~1ping': {
        pointer: '#/paths/~1ping',
        canonicalId: 'path:public/health/PingPath',
        kind: 'path',
        sourcePath: 'fragments/path/public/health/PingPath.yaml',
        sourcePointer: '#/content',
        contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        trackingId,
        trackingIdSource: 'generated',
        identityKey: 'definition:path:public/health/PingPath',
        identitySource: 'canonical',
        stableKey,
        metadata: { path: '/ping' },
        openApiPath: '/ping',
      },
    },
  }
}

function responseSchemaReviewSpec(type: 'string' | 'integer'): Record<string, unknown> {
  return {
    openapi: '3.2.0',
    info: { title: 'Review API', version: '1.0.0' },
    paths: {
      '/users': {
        get: {
          operationId: 'listUsers',
          summary: 'List users',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { id: { type } } },
                },
              },
            },
          },
        },
      },
    },
  }
}

function writeTargetFixture(dir: string): { targetPath: string; artifactPath: string } {
  const targetPath = join(dir, 'targets', 'public-api.yaml')
  const fragmentPath = join(dir, 'fragments', 'path', 'public', 'health', 'HealthPath.yaml')
  const artifactPath = join(dir, 'artifacts', 'public-api.yaml')
  mkdirSync(join(dir, 'targets'), { recursive: true })
  mkdirSync(join(dir, 'fragments', 'path', 'public', 'health'), { recursive: true })
  mkdirSync(join(dir, 'artifacts'), { recursive: true })
  writeFileSync(targetPath, yamlStringify({
    name: 'public-api',
    scopes: ['public'],
    domains: ['health'],
    servers: [{ url: 'https://api.example.test' }],
    includePaths: ['/health'],
    namingPolicy: { aliases: {} },
  }), 'utf8')
  writeFileSync(fragmentPath, yamlStringify({
    id: 'path:public/health/HealthPath',
    metadata: { path: '/health' },
    content: {
      get: {
        operationId: 'getHealth',
        summary: 'Get health',
        responses: { '204': { description: 'No content' } },
      },
    },
  }), 'utf8')
  writeFileSync(artifactPath, yamlStringify({
    openapi: '3.2.0',
    info: { title: 'public-api', version: '0.0.0' },
    servers: [{ url: 'https://api.example.test' }],
    paths: {
      '/health': {
        get: {
          operationId: 'getHealth',
          summary: 'Get health',
          responses: { '204': { description: 'No content' } },
        },
      },
    },
  }), 'utf8')
  return { targetPath, artifactPath }
}

function referencedResponseSchemaReviewSpec(type: 'string' | 'integer'): Record<string, unknown> {
  return {
    openapi: '3.2.0',
    info: { title: 'Review API', version: '1.0.0' },
    paths: {
      '/users': {
        get: {
          operationId: 'listUsers',
          summary: 'List users',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/User' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        User: {
          type: 'object',
          properties: { id: { type } },
        },
      },
    },
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
  schemaMetaLocationSpecPath = join(tmpDir, 'schema-meta-location-api.yaml')
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
  writeFileSync(schemaMetaLocationSpecPath, [
    'openapi: 3.2.0',
    'info:',
    '  title: Schema Meta Location API',
    '  version: 1.0.0',
    'paths: {}',
    'components:',
    '  schemas:',
    '    Age:',
    '      type: integer',
    '      minimum: zero',
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
    const index = createSQLiteWorkspaceIndex({ cacheDir })
    try {
      expect(index.listTypeAliases()).toEqual([
        expect.objectContaining({
          sourceFile: apiPath,
          sourcePointer: '#/paths/~1users/get/responses/200/content/application~1json/schema/$ref',
          refText: './shared.yaml#/components/schemas/ExternalUser',
          aliasName: 'ExternalUser',
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ])
    } finally {
      index.close()
    }

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

  it('스키마 메타 검증 실패 시 local YAML line/column을 출력한다', () => {
    const { stdout, stderr } = cliFail(`validate -s ${schemaMetaLocationSpecPath}`)
    const combined = stdout + stderr
    expect(combined).toContain('schema-meta-location-api.yaml:10:7')
    expect(combined).toContain('[schema/meta-valid]')
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

  it('증분 SQLite index를 열 수 없으면 fallback 경고를 출력한다', () => {
    const cacheDir = join(tmpDir, 'incremental-cache-blocked')
    writeFileSync(cacheDir, 'not a directory', 'utf8')

    const { stdout, stderr, status } = cliCapture(`validate -s ${externalSpecPath} --incremental --cache-dir ${cacheDir}`)

    expect(status).toBe(0)
    expect(stdout).toContain('Valid')
    expect(stderr).toContain('SQLite workspace index unavailable')
    expect(stderr).toContain('falling back to full rebuild')
  })
})

// ── reference-check ────────────────────────────────────────

describe('reference-check', () => {
  it('reports oa-sdk as authoritative and keeps Apitomy divergence informational', () => {
    const out = cli(`reference-check -s ${specPath} --format json`)
    const report = JSON.parse(out) as {
      schemaVersion?: string
      authoritative?: string
      reference?: string
      status?: string
      primary?: { valid?: boolean }
      metadata?: {
        providerPackage?: string
        providerVersion?: string
        inputHash?: string
        capabilities?: string[]
      }
      differences?: Array<{ kind?: string }>
      serialization?: { checked?: boolean; equal?: boolean }
    }

    expect(report.schemaVersion).toBe('oa-gen.apitomy-reference.v1')
    expect(report.authoritative).toBe('oa-sdk')
    expect(report.reference).toBe('apitomy')
    expect(report.primary?.valid).toBe(true)
    expect(['match', 'divergent']).toContain(report.status)
    expect(report.metadata?.providerPackage).toBe('@apitomy/data-models')
    expect(report.metadata?.providerVersion).toBe('3.1.3')
    expect(report.metadata?.inputHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(report.metadata?.capabilities).toEqual(expect.arrayContaining(['read', 'write', 'validate']))
    expect(report.serialization).toEqual({ checked: true, equal: true })
    expect(report.differences).toEqual(expect.any(Array))
  })
})

// ── inventory ───────────────────────────────────────────────

describe('inventory', () => {
  it('OpenAPI surface inventory를 JSON으로 출력한다', () => {
    const out = cli(`inventory --spec ${specPath} --format json`)
    const payload = JSON.parse(out) as {
      schemaVersion?: string
      totals?: { paths?: number; operations?: number; components?: number }
      tagGroups?: Array<{ name?: string; operationCount?: number }>
      unusedComponents?: unknown[]
    }

    expect(payload.schemaVersion).toBe('oa-gen.inventory.v1')
    expect(payload.totals).toEqual({
      paths: 2,
      operations: 3,
      components: 2,
      unusedComponentCandidates: 0,
    })
    expect(payload.tagGroups).toEqual([
      { name: '(untagged)', pathCount: 2, operationCount: 3, paths: ['/users', '/users/{id}'] },
    ])
    expect(payload.unusedComponents).toEqual([])
  })

  it('OpenAPI surface inventory를 markdown으로 출력한다', () => {
    const out = cli(`inventory --spec ${specPath}`)

    expect(out).toContain('## OpenAPI Inventory')
    expect(out).toContain('- Paths: 2')
    expect(out).toContain('| (untagged) | 3 | /users, /users/{id} |')
  })
})

// ── diff / artifact ─────────────────────────────────────────

describe('diff and check-artifact', () => {
  it('diff --fail-on-breaking이 breaking change에서 non-zero 종료한다', () => {
    const basePath = join(tmpDir, 'diff-base.yaml')
    const headPath = join(tmpDir, 'diff-head.yaml')
    writeFileSync(basePath, yamlStringify(responseSchemaReviewSpec('string')), 'utf8')
    writeFileSync(headPath, yamlStringify(responseSchemaReviewSpec('integer')), 'utf8')

    const { stdout, status } = cliCapture(`diff --base ${basePath} --head ${headPath} --fail-on-breaking`)

    expect(status).toBe(1)
    expect(stdout).toContain('#### Breaking Changes')
    expect(stdout).toContain('response-schema-changed')
  })

  it('diff가 같은 $ref 뒤의 component schema 변경도 breaking으로 잡는다', () => {
    const basePath = join(tmpDir, 'diff-ref-base.yaml')
    const headPath = join(tmpDir, 'diff-ref-head.yaml')
    writeFileSync(basePath, yamlStringify(referencedResponseSchemaReviewSpec('string')), 'utf8')
    writeFileSync(headPath, yamlStringify(referencedResponseSchemaReviewSpec('integer')), 'utf8')

    const { stdout, status } = cliCapture(`diff --base ${basePath} --head ${headPath} --fail-on-breaking`)

    expect(status).toBe(1)
    expect(stdout).toContain('response-schema-changed')
  })

  it('check-artifact가 stale artifact를 JSON으로 보고한다', () => {
    const headPath = join(tmpDir, 'artifact-head.yaml')
    const artifactPath = join(tmpDir, 'artifact-stale.yaml')
    writeFileSync(headPath, yamlStringify(responseSchemaReviewSpec('integer')), 'utf8')
    writeFileSync(artifactPath, yamlStringify(responseSchemaReviewSpec('string')), 'utf8')

    const { stdout, status } = cliCapture(
      `check-artifact --head ${headPath} --artifact ${artifactPath} --format json`,
    )
    const payload = JSON.parse(stdout) as {
      fresh?: boolean
      differences?: unknown[]
    }

    expect(status).toBe(1)
    expect(payload.fresh).toBe(false)
    expect(payload.differences?.length).toBeGreaterThan(0)
  })

  it('check-artifact --target이 Definition Builder target output을 artifact와 비교한다', () => {
    const dir = join(tmpDir, 'target-artifact')
    const { targetPath, artifactPath } = writeTargetFixture(dir)

    const { stdout, status } = cliCapture(
      `check-artifact --head ${artifactPath} --target ${targetPath} --artifact ${artifactPath} --format json`,
    )
    const payload = JSON.parse(stdout) as { fresh?: boolean }

    expect(status).toBe(0)
    expect(payload.fresh).toBe(true)
  })

  it('drift가 runtime OpenAPI와 managed OpenAPI 차이를 보고한다', () => {
    const managedPath = join(tmpDir, 'drift-managed.yaml')
    const runtimePath = join(tmpDir, 'drift-runtime.yaml')
    writeFileSync(managedPath, yamlStringify(cleanReviewSpec()), 'utf8')
    writeFileSync(runtimePath, yamlStringify({
      ...cleanReviewSpec(),
      paths: {
        '/runtime-only': {
          get: {
            operationId: 'runtimeOnly',
            summary: 'Runtime-only route',
            responses: { '204': { description: 'No content' } },
          },
        },
      },
    }), 'utf8')

    const { stdout, status } = cliCapture(
      `drift --runtime-openapi ${runtimePath} --managed-openapi ${managedPath} --format json`,
    )
    const payload = JSON.parse(stdout) as {
      drift?: boolean
      issues?: unknown[]
    }

    expect(status).toBe(1)
    expect(payload.drift).toBe(true)
    expect(payload.issues?.length).toBeGreaterThan(0)
  })

  it('drift가 runtime OpenAPI URL을 fetch한다', () => {
    const managedPath = join(tmpDir, 'drift-url-managed.yaml')
    writeFileSync(managedPath, yamlStringify(cleanReviewSpec()), 'utf8')
    const runtimeUrl = `data:application/json,${encodeURIComponent(JSON.stringify(cleanReviewSpec()))}`
    const { stdout, status } = cliCaptureArgs([
      'drift',
      '--runtime-openapi-url',
      runtimeUrl,
      '--runtime-header',
      'Authorization: Bearer test-token',
      '--managed-openapi',
      managedPath,
      '--format',
      'json',
    ])
    const payload = JSON.parse(stdout) as {
      drift?: boolean
      runtimeFetch?: {
        url?: string
        requestHeaders?: string[]
        status?: number
      }
    }

    expect(status).toBe(0)
    expect(payload.drift).toBe(false)
    expect(payload.runtimeFetch).toEqual(expect.objectContaining({
      url: runtimeUrl,
      requestHeaders: ['authorization'],
      status: 200,
    }))
  })

  it('behavior logging이 활성화되면 drift success behavior를 JSONL로 남긴다', () => {
    const managedPath = join(tmpDir, 'drift-behavior-managed.yaml')
    const runtimePath = join(tmpDir, 'drift-behavior-runtime.yaml')
    const behaviorLogPath = join(tmpDir, 'drift.behavior.jsonl')
    writeFileSync(managedPath, yamlStringify(cleanReviewSpec()), 'utf8')
    writeFileSync(runtimePath, yamlStringify(cleanReviewSpec()), 'utf8')

    const { stdout, status } = cliCapture(
      `drift --runtime-openapi ${runtimePath} --managed-openapi ${managedPath} --behavior-log ${behaviorLogPath} --format json`,
    )
    const payload = JSON.parse(stdout) as { drift?: boolean }
    const records = readJsonl(behaviorLogPath) as Array<{
      behaviorType?: string
      status?: string
      components?: {
        decision?: { primarySignal?: string }
        result?: { drift?: boolean; issueCount?: number }
      }
    }>

    expect(status).toBe(0)
    expect(payload.drift).toBe(false)
    expect(records).toHaveLength(1)
    expect(records[0]).toEqual(expect.objectContaining({
      behaviorType: 'sync_runtime_openapi',
      status: 'succeeded',
      components: expect.objectContaining({
        decision: expect.objectContaining({
          primarySignal: 'no-drift',
        }),
        result: expect.objectContaining({
          drift: false,
          issueCount: 0,
        }),
      }),
    }))
  })

  it('drift URL parse failure를 drift-check-failed로 보고한다', () => {
    const managedPath = join(tmpDir, 'drift-url-failure-managed.yaml')
    writeFileSync(managedPath, yamlStringify(cleanReviewSpec()), 'utf8')
    const runtimeUrl = 'data:application/json,%7Bbad'
    const { stdout, status } = cliCapture(
      `drift --runtime-openapi-url ${runtimeUrl} --managed-openapi ${managedPath} --format json`,
    )
    const payload = JSON.parse(stdout) as {
      status?: string
      failure?: { code?: string; message?: string }
      runtimeFetch?: {
        status?: number
      }
    }

    expect(status).toBe(1)
    expect(payload.status).toBe('drift-check-failed')
    expect(payload.failure?.code).toBe('drift-check-failed')
    expect(payload.failure?.message).toContain('could not be parsed')
    expect(payload.runtimeFetch).toEqual(expect.objectContaining({
      status: 200,
    }))
  })

  it('behavior logging이 활성화되면 drift failure behavior를 JSONL로 남긴다', () => {
    const managedPath = join(tmpDir, 'drift-behavior-failure-managed.yaml')
    const behaviorLogPath = join(tmpDir, 'drift-failure.behavior.jsonl')
    writeFileSync(managedPath, yamlStringify(cleanReviewSpec()), 'utf8')
    const runtimeUrl = 'data:application/json,%7Bbad'

    const { status } = cliCapture(
      `drift --runtime-openapi-url ${runtimeUrl} --managed-openapi ${managedPath} --behavior-log ${behaviorLogPath} --format json`,
    )
    const records = readJsonl(behaviorLogPath) as Array<{
      behaviorType?: string
      status?: string
      components?: {
        decision?: { primarySignal?: string }
        result?: { status?: string; failureCode?: string }
      }
    }>

    expect(status).toBe(1)
    expect(records).toHaveLength(1)
    expect(records[0]).toEqual(expect.objectContaining({
      behaviorType: 'sync_runtime_openapi',
      status: 'failed',
      components: expect.objectContaining({
        decision: expect.objectContaining({
          primarySignal: 'fetch-failure',
        }),
        result: expect.objectContaining({
          status: 'drift-check-failed',
          failureCode: 'drift-check-failed',
        }),
      }),
    }))
  })
})

// ── review ─────────────────────────────────────────────────

describe('review', () => {
  it('깨끗한 head와 최신 artifact에 APPROVE JSON 리포트를 출력한다', () => {
    const basePath = join(tmpDir, 'review-clean-base.yaml')
    const headPath = join(tmpDir, 'review-clean-head.yaml')
    const artifactPath = join(tmpDir, 'review-clean-artifact.yaml')
    const spec = cleanReviewSpec()
    writeFileSync(basePath, yamlStringify(spec), 'utf8')
    writeFileSync(headPath, yamlStringify(spec), 'utf8')
    writeFileSync(artifactPath, yamlStringify(spec), 'utf8')

    const out = cli(`review --base ${basePath} --head ${headPath} --artifact ${artifactPath} --format json`)
    const report = JSON.parse(out) as {
      recommendation?: string
      summary?: { artifactFresh?: boolean; breakingChanges?: number }
      validation?: { issues?: unknown[] }
    }

    expect(report.recommendation).toBe('APPROVE')
    expect(report.summary?.artifactFresh).toBe(true)
    expect(report.summary?.breakingChanges).toBe(0)
    expect(report.validation?.issues).toEqual([])
  })

  it('behavior logging이 활성화되면 review success behavior를 JSONL로 남긴다', () => {
    const basePath = join(tmpDir, 'review-behavior-base.yaml')
    const headPath = join(tmpDir, 'review-behavior-head.yaml')
    const artifactPath = join(tmpDir, 'review-behavior-artifact.yaml')
    const behaviorLogPath = join(tmpDir, 'review.behavior.jsonl')
    const spec = cleanReviewSpec()
    writeFileSync(basePath, yamlStringify(spec), 'utf8')
    writeFileSync(headPath, yamlStringify(spec), 'utf8')
    writeFileSync(artifactPath, yamlStringify(spec), 'utf8')

    const out = cli([
      `review --base ${basePath}`,
      `--head ${headPath}`,
      `--artifact ${artifactPath}`,
      `--behavior-log ${behaviorLogPath}`,
      '--format json',
    ].join(' '))
    const report = JSON.parse(out) as { recommendation?: string }
    const records = readJsonl(behaviorLogPath) as Array<{
      behaviorType?: string
      status?: string
      components?: {
        decision?: { primarySignal?: string }
        result?: {
          recommendation?: string
          reasonCount?: number
          reasons?: string[]
          artifactChecked?: boolean
          artifactFresh?: boolean | null
          provenanceChecked?: boolean
          metadataRegistryChecked?: boolean
        }
      }
    }>

    expect(report.recommendation).toBe('APPROVE')
    expect(records).toHaveLength(1)
    expect(records[0]).toEqual(expect.objectContaining({
      behaviorType: 'review_openapi_change',
      status: 'succeeded',
      components: expect.objectContaining({
        decision: expect.objectContaining({
          primarySignal: 'approve',
        }),
        result: expect.objectContaining({
          recommendation: 'APPROVE',
          reasonCount: 0,
          reasons: [],
          artifactChecked: true,
          artifactFresh: true,
          provenanceChecked: false,
          metadataRegistryChecked: false,
        }),
      }),
    }))
  })

  it('artifact가 없으면 incomplete check로 COMMENT를 출력한다', () => {
    const basePath = join(tmpDir, 'review-comment-base.yaml')
    const headPath = join(tmpDir, 'review-comment-head.yaml')
    const spec = cleanReviewSpec()
    writeFileSync(basePath, yamlStringify(spec), 'utf8')
    writeFileSync(headPath, yamlStringify(spec), 'utf8')

    const out = cli(`review --base ${basePath} --head ${headPath} --format json`)
    const report = JSON.parse(out) as {
      recommendation?: string
      summary?: { checksIncomplete?: boolean }
      artifact?: { checked?: boolean }
    }

    expect(report.recommendation).toBe('COMMENT')
    expect(report.summary?.checksIncomplete).toBe(true)
    expect(report.artifact?.checked).toBe(false)
  })

  it('provenance sidecar 변경을 review JSON에 포함한다', () => {
    const basePath = join(tmpDir, 'review-provenance-base.yaml')
    const headPath = join(tmpDir, 'review-provenance-head.yaml')
    const artifactPath = join(tmpDir, 'review-provenance-artifact.yaml')
    const baseProvenancePath = join(tmpDir, 'review-base.provenance.json')
    const headProvenancePath = join(tmpDir, 'review-head.provenance.json')
    const spec = cleanReviewSpec()
    writeFileSync(basePath, yamlStringify(spec), 'utf8')
    writeFileSync(headPath, yamlStringify(spec), 'utf8')
    writeFileSync(artifactPath, yamlStringify(spec), 'utf8')
    writeFileSync(baseProvenancePath, JSON.stringify({
      '#/paths/~1ping': {
        canonicalId: 'path:public/health/PingPath',
        kind: 'path',
        sourcePath: 'fragments/path/public/health/PingPath.yaml',
        sourcePointer: '#/content',
        contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    }), 'utf8')
    writeFileSync(headProvenancePath, JSON.stringify({
      '#/paths/~1ping': {
        canonicalId: 'path:public/health/PingPath',
        kind: 'path',
        sourcePath: 'fragments/path/public/health/PingPath.yaml',
        sourcePointer: '#/content',
        contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
    }), 'utf8')

    const out = cli([
      `review --base ${basePath}`,
      `--head ${headPath}`,
      `--artifact ${artifactPath}`,
      `--base-provenance ${baseProvenancePath}`,
      `--head-provenance ${headProvenancePath}`,
      '--format json',
    ].join(' '))
    const report = JSON.parse(out) as {
      recommendation?: string
      summary?: { provenanceChanges?: number }
      provenance?: {
        checked?: boolean
        changed?: boolean
        differences?: Array<{ kind?: string; pointer?: string }>
      }
    }

    expect(report.recommendation).toBe('COMMENT')
    expect(report.summary?.provenanceChanges).toBe(1)
    expect(report.provenance?.checked).toBe(true)
    expect(report.provenance?.changed).toBe(true)
    expect(report.provenance?.differences).toEqual([
      expect.objectContaining({ kind: 'changed', pointer: '#/paths/~1ping' }),
    ])
  })

  it('metadata registry sidecar 변경을 review JSON에 포함한다', () => {
    const basePath = join(tmpDir, 'review-metadata-base.yaml')
    const headPath = join(tmpDir, 'review-metadata-head.yaml')
    const artifactPath = join(tmpDir, 'review-metadata-artifact.yaml')
    const baseMetadataPath = join(tmpDir, 'review-base.metadata.json')
    const headMetadataPath = join(tmpDir, 'review-head.metadata.json')
    const spec = cleanReviewSpec()
    writeFileSync(basePath, yamlStringify(spec), 'utf8')
    writeFileSync(headPath, yamlStringify(spec), 'utf8')
    writeFileSync(artifactPath, yamlStringify(spec), 'utf8')
    writeFileSync(baseMetadataPath, JSON.stringify(metadataRegistryFixture('trk_meta_v1', 'oa-meta:v1:meta1')), 'utf8')
    writeFileSync(headMetadataPath, JSON.stringify(metadataRegistryFixture('trk_meta_v2', 'oa-meta:v1:meta2')), 'utf8')

    const out = cli([
      `review --base ${basePath}`,
      `--head ${headPath}`,
      `--artifact ${artifactPath}`,
      `--base-metadata-registry ${baseMetadataPath}`,
      `--head-metadata-registry ${headMetadataPath}`,
      '--format json',
    ].join(' '))
    const report = JSON.parse(out) as {
      recommendation?: string
      summary?: { metadataRegistryChanges?: number }
      metadataRegistry?: {
        checked?: boolean
        changed?: boolean
        differences?: Array<{ kind?: string; pointer?: string }>
      }
    }

    expect(report.recommendation).toBe('COMMENT')
    expect(report.summary?.metadataRegistryChanges).toBe(1)
    expect(report.metadataRegistry?.checked).toBe(true)
    expect(report.metadataRegistry?.changed).toBe(true)
    expect(report.metadataRegistry?.differences).toEqual([
      expect.objectContaining({ kind: 'changed', pointer: '#/paths/~1ping' }),
    ])
  })

  it('breaking change와 stale artifact를 REQUEST_CHANGES로 보고하고 non-zero 종료한다', () => {
    const basePath = join(tmpDir, 'review-breaking-base.yaml')
    const headPath = join(tmpDir, 'review-breaking-head.yaml')
    const artifactPath = join(tmpDir, 'review-breaking-artifact.yaml')
    writeFileSync(basePath, yamlStringify(responseSchemaReviewSpec('string')), 'utf8')
    writeFileSync(headPath, yamlStringify(responseSchemaReviewSpec('integer')), 'utf8')
    writeFileSync(artifactPath, yamlStringify(responseSchemaReviewSpec('string')), 'utf8')

    const { stdout, status } = cliCapture(
      `review --base ${basePath} --head ${headPath} --artifact ${artifactPath}`,
    )

    expect(status).toBe(1)
    expect(stdout).toContain('Recommendation: **REQUEST_CHANGES**')
    expect(stdout).toContain('response-schema-changed')
    expect(stdout).toContain('**stale**')
  })

  it('behavior logging이 활성화되면 review request-changes behavior를 JSONL로 남긴다', () => {
    const basePath = join(tmpDir, 'review-failed-base.yaml')
    const headPath = join(tmpDir, 'review-failed-head.yaml')
    const artifactPath = join(tmpDir, 'review-failed-artifact.yaml')
    const behaviorLogPath = join(tmpDir, 'review-failed.behavior.jsonl')
    writeFileSync(basePath, yamlStringify(responseSchemaReviewSpec('string')), 'utf8')
    writeFileSync(headPath, yamlStringify(responseSchemaReviewSpec('integer')), 'utf8')
    writeFileSync(artifactPath, yamlStringify(responseSchemaReviewSpec('string')), 'utf8')

    const { status } = cliCapture([
      `review --base ${basePath}`,
      `--head ${headPath}`,
      `--artifact ${artifactPath}`,
      `--behavior-log ${behaviorLogPath}`,
      '--format json',
    ].join(' '))
    const records = readJsonl(behaviorLogPath) as Array<{
      behaviorType?: string
      status?: string
      components?: {
        decision?: { primarySignal?: string }
        result?: {
          recommendation?: string
          reasonCount?: number
          reasons?: string[]
          artifactChecked?: boolean
          artifactFresh?: boolean | null
          provenanceChecked?: boolean
          metadataRegistryChecked?: boolean
          breakingChanges?: number
        }
      }
    }>

    expect(status).toBe(1)
    expect(records).toHaveLength(1)
    expect(records[0]).toEqual(expect.objectContaining({
      behaviorType: 'review_openapi_change',
      status: 'failed',
      components: expect.objectContaining({
        decision: expect.objectContaining({
          primarySignal: 'request-changes',
        }),
        result: expect.objectContaining({
          recommendation: 'REQUEST_CHANGES',
          reasonCount: expect.any(Number),
          reasons: expect.arrayContaining([
            expect.stringContaining('breaking change'),
          ]),
          artifactChecked: true,
          artifactFresh: false,
          provenanceChecked: false,
          metadataRegistryChecked: false,
          breakingChanges: 1,
        }),
      }),
    }))
  })

  it('review --target이 Definition Builder target output을 artifact freshness에 사용한다', () => {
    const dir = join(tmpDir, 'target-review')
    const { targetPath, artifactPath } = writeTargetFixture(dir)

    const out = cli(
      `review --base ${artifactPath} --head ${artifactPath} --target ${targetPath} --artifact ${artifactPath} --format json`,
    )
    const payload = JSON.parse(out) as {
      artifact?: { fresh?: boolean }
      summary?: { artifactFresh?: boolean }
    }

    expect(payload.artifact?.fresh).toBe(true)
    expect(payload.summary?.artifactFresh).toBe(true)
  })
})

// ── behavior-query ────────────────────────────────────────

describe('behavior-query', () => {
  it('latest-by-type를 JSON으로 조회한다', () => {
    const dbPath = join(tmpDir, 'behavior-query.sqlite')
    const recorder = createBehaviorRecorderFromOptions({ sqlitePath: dbPath })
    recorder.record(createBehaviorRecord({
      behaviorType: 'build_openapi_target',
      identityKey: createBehaviorIdentityKey({
        behaviorType: 'build_openapi_target',
        parts: { targetType: 'definition-target', targetKey: 'public-api' },
      }),
      status: 'received',
      components: {
        actor: { actorType: 'system', actorId: 'oa-gen' },
        target: { targetType: 'definition-target', targetKey: 'public-api', targetPath: 'targets/public-api.yaml' },
        context: { source: 'cli', command: 'build-spec' },
        result: { valid: false, fragmentCount: 0, selectedNodeCount: 0, errors: 0, warnings: 0, infos: 0, errorCodes: [] },
      },
    }))
    recorder.record(createBehaviorRecord({
      behaviorType: 'build_openapi_target',
      identityKey: createBehaviorIdentityKey({
        behaviorType: 'build_openapi_target',
        parts: { targetType: 'definition-target', targetKey: 'public-api' },
      }),
      status: 'validated',
      components: {
        actor: { actorType: 'system', actorId: 'oa-gen' },
        target: { targetType: 'definition-target', targetKey: 'public-api', targetPath: 'targets/public-api.yaml' },
        context: { source: 'cli', command: 'build-spec' },
        result: { valid: false, fragmentCount: 0, selectedNodeCount: 0, errors: 0, warnings: 0, infos: 0, errorCodes: [] },
      },
    }))
    recorder.close?.()

    const out = cli(
      `behavior-query --behavior-db ${dbPath} --mode latest-by-type --behavior-type build_openapi_target --format json`,
    )
    const payload = JSON.parse(out) as {
      schemaVersion?: string
      count?: number
      entries?: Array<{ behaviorType?: string; status?: string; targetKey?: string }>
    }

    expect(payload.schemaVersion).toBe('oa-gen.behavior-query.v1')
    expect(payload.count).toBe(1)
    expect(payload.entries).toEqual([
      expect.objectContaining({
        behaviorType: 'build_openapi_target',
        status: 'validated',
        targetKey: 'public-api',
      }),
    ])
  })

  it('latest-failure-by-type를 JSON으로 조회한다', () => {
    const dbPath = join(tmpDir, 'behavior-query-latest-failure.sqlite')
    const recorder = createBehaviorRecorderFromOptions({ sqlitePath: dbPath })
    recorder.record(createBehaviorRecord({
      behaviorType: 'review_openapi_change',
      identityKey: createBehaviorIdentityKey({
        behaviorType: 'review_openapi_change',
        parts: { targetType: 'openapi-review', targetKey: 'base.yaml|head.yaml' },
      }),
      status: 'failed',
      components: {
        actor: { actorType: 'system', actorId: 'oa-gen' },
        target: { targetType: 'openapi-review', targetKey: 'base.yaml|head.yaml', basePath: 'base.yaml', headPath: 'head.yaml' },
        context: { source: 'cli', command: 'review' },
        decision: { primarySignal: 'request-changes', decisionReason: 'review found blocking changes that require follow-up' },
        result: {
          recommendation: 'REQUEST_CHANGES',
          reasonCount: 1,
          reasons: ['review found blocking changes that require follow-up'],
          breakingChanges: 1,
          nonBreakingChanges: 0,
          validationErrors: 0,
          validationWarnings: 0,
          validationInfos: 0,
          artifactChecked: false,
          provenanceChecked: false,
          metadataRegistryChecked: false,
          artifactFresh: false,
          provenanceChanges: null,
          metadataRegistryChanges: null,
          checksIncomplete: false,
        },
      },
    }))
    recorder.close?.()

    const out = cli(
      `behavior-query --behavior-db ${dbPath} --mode latest-failure-by-type --behavior-type review_openapi_change --format json`,
    )
    const payload = JSON.parse(out) as {
      count?: number
      entries?: Array<{ behaviorType?: string; status?: string; decisionSignal?: string }>
    }

    expect(payload.count).toBe(1)
    expect(payload.entries).toEqual([
      expect.objectContaining({
        behaviorType: 'review_openapi_change',
        status: 'failed',
        decisionSignal: 'request-changes',
      }),
    ])
  })

  it('latest-by-decision-signal을 JSON으로 조회한다', () => {
    const dbPath = join(tmpDir, 'behavior-query-latest-decision.sqlite')
    const recorder = createBehaviorRecorderFromOptions({ sqlitePath: dbPath })
    recorder.record(createBehaviorRecord({
      behaviorType: 'review_openapi_change',
      identityKey: createBehaviorIdentityKey({
        behaviorType: 'review_openapi_change',
        parts: { targetType: 'openapi-review', targetKey: 'base.yaml|head.yaml' },
      }),
      status: 'failed',
      components: {
        actor: { actorType: 'system', actorId: 'oa-gen' },
        target: { targetType: 'openapi-review', targetKey: 'base.yaml|head.yaml', basePath: 'base.yaml', headPath: 'head.yaml' },
        context: { source: 'cli', command: 'review' },
        decision: { primarySignal: 'request-changes', decisionReason: 'review found blocking changes that require follow-up' },
        result: {
          recommendation: 'REQUEST_CHANGES',
          reasonCount: 1,
          reasons: ['review found blocking changes that require follow-up'],
          breakingChanges: 1,
          nonBreakingChanges: 0,
          validationErrors: 0,
          validationWarnings: 0,
          validationInfos: 0,
          artifactChecked: false,
          provenanceChecked: false,
          metadataRegistryChecked: false,
          artifactFresh: false,
          provenanceChanges: null,
          metadataRegistryChanges: null,
          checksIncomplete: false,
        },
      },
    }))
    recorder.close?.()

    const out = cli(
      `behavior-query --behavior-db ${dbPath} --mode latest-by-decision-signal --decision-signal request-changes --format json`,
    )
    const payload = JSON.parse(out) as {
      count?: number
      entries?: Array<{ behaviorType?: string; decisionSignal?: string; recommendation?: string }>
    }

    expect(payload.count).toBe(1)
    expect(payload.entries).toEqual([
      expect.objectContaining({
        behaviorType: 'review_openapi_change',
        decisionSignal: 'request-changes',
        recommendation: 'REQUEST_CHANGES',
      }),
    ])
  })

  it('summary-by-decision-signal을 JSON으로 조회한다', () => {
    const dbPath = join(tmpDir, 'behavior-query-summary-decision.sqlite')
    const recorder = createBehaviorRecorderFromOptions({ sqlitePath: dbPath })
    recorder.record(createBehaviorRecord({
      behaviorType: 'review_openapi_change',
      identityKey: createBehaviorIdentityKey({
        behaviorType: 'review_openapi_change',
        parts: { targetType: 'openapi-review', targetKey: 'base-a|head-a' },
      }),
      status: 'failed',
      components: {
        actor: { actorType: 'system', actorId: 'oa-gen' },
        target: { targetType: 'openapi-review', targetKey: 'base-a|head-a', basePath: 'base-a', headPath: 'head-a' },
        context: { source: 'cli', command: 'review' },
        decision: { primarySignal: 'request-changes', decisionReason: 'review found blocking changes that require follow-up' },
        result: {
          recommendation: 'REQUEST_CHANGES',
          reasonCount: 1,
          reasons: ['review found blocking changes that require follow-up'],
          breakingChanges: 1,
          nonBreakingChanges: 0,
          validationErrors: 0,
          validationWarnings: 0,
          validationInfos: 0,
          artifactChecked: false,
          provenanceChecked: false,
          metadataRegistryChecked: false,
          artifactFresh: false,
          provenanceChanges: null,
          metadataRegistryChanges: null,
          checksIncomplete: false,
        },
      },
    }))
    recorder.record(createBehaviorRecord({
      behaviorType: 'review_openapi_change',
      identityKey: createBehaviorIdentityKey({
        behaviorType: 'review_openapi_change',
        parts: { targetType: 'openapi-review', targetKey: 'base-b|head-b' },
      }),
      status: 'succeeded',
      components: {
        actor: { actorType: 'system', actorId: 'oa-gen' },
        target: { targetType: 'openapi-review', targetKey: 'base-b|head-b', basePath: 'base-b', headPath: 'head-b' },
        context: { source: 'cli', command: 'review' },
        decision: { primarySignal: 'approve', decisionReason: 'review found no blocking issues and all required checks are satisfied' },
        result: {
          recommendation: 'APPROVE',
          reasonCount: 0,
          reasons: [],
          breakingChanges: 0,
          nonBreakingChanges: 0,
          validationErrors: 0,
          validationWarnings: 0,
          validationInfos: 0,
          artifactChecked: false,
          provenanceChecked: false,
          metadataRegistryChecked: false,
          artifactFresh: true,
          provenanceChanges: null,
          metadataRegistryChanges: null,
          checksIncomplete: false,
        },
      },
    }))
    recorder.record(createBehaviorRecord({
      behaviorType: 'review_openapi_change',
      identityKey: createBehaviorIdentityKey({
        behaviorType: 'review_openapi_change',
        parts: { targetType: 'openapi-review', targetKey: 'base-c|head-c' },
      }),
      status: 'failed',
      components: {
        actor: { actorType: 'system', actorId: 'oa-gen' },
        target: { targetType: 'openapi-review', targetKey: 'base-c|head-c', basePath: 'base-c', headPath: 'head-c' },
        context: { source: 'cli', command: 'review' },
        decision: { primarySignal: 'request-changes', decisionReason: 'review found blocking changes that require follow-up' },
        result: {
          recommendation: 'REQUEST_CHANGES',
          reasonCount: 1,
          reasons: ['review found blocking changes that require follow-up'],
          breakingChanges: 1,
          nonBreakingChanges: 0,
          validationErrors: 0,
          validationWarnings: 0,
          validationInfos: 0,
          artifactChecked: false,
          provenanceChecked: false,
          metadataRegistryChecked: false,
          artifactFresh: false,
          provenanceChanges: null,
          metadataRegistryChanges: null,
          checksIncomplete: false,
        },
      },
    }))
    recorder.close?.()

    const out = cli(
      `behavior-query --behavior-db ${dbPath} --mode summary-by-decision-signal --behavior-type review_openapi_change --format json`,
    )
    const payload = JSON.parse(out) as {
      count?: number
      entries?: Array<unknown>
      aggregations?: Array<{ key?: string; count?: number }>
    }

    expect(payload.count).toBe(3)
    expect(payload.entries).toEqual([])
    expect(payload.aggregations).toEqual([
      { key: 'approve', count: 1, dimensions: { decisionSignal: 'approve' } },
      { key: 'request-changes', count: 2, dimensions: { decisionSignal: 'request-changes' } },
    ])
  })

  it('summary-by-behavior-status를 JSON으로 조회한다', () => {
    const dbPath = join(tmpDir, 'behavior-query-summary-status.sqlite')
    const recorder = createBehaviorRecorderFromOptions({ sqlitePath: dbPath })
    recorder.record(createBehaviorRecord({
      behaviorType: 'build_openapi_target',
      identityKey: createBehaviorIdentityKey({
        behaviorType: 'build_openapi_target',
        parts: { targetType: 'definition-target', targetKey: 'public-api' },
      }),
      status: 'failed',
      components: {
        actor: { actorType: 'system', actorId: 'oa-gen' },
        target: { targetType: 'definition-target', targetKey: 'public-api', targetPath: 'targets/public-api.yaml' },
        context: { source: 'cli', command: 'build-spec' },
        decision: { primarySignal: 'build-invalid', decisionReason: 'builder diagnostics contain one or more errors' },
        result: {
          valid: false,
          fragmentCount: 1,
          selectedNodeCount: 1,
          errors: 1,
          warnings: 0,
          infos: 0,
          errorCodes: ['definition-registry/missing-ref'],
        },
      },
    }))
    recorder.record(createBehaviorRecord({
      behaviorType: 'review_openapi_change',
      identityKey: createBehaviorIdentityKey({
        behaviorType: 'review_openapi_change',
        parts: { targetType: 'openapi-review', targetKey: 'base-b|head-b' },
      }),
      status: 'succeeded',
      components: {
        actor: { actorType: 'system', actorId: 'oa-gen' },
        target: { targetType: 'openapi-review', targetKey: 'base-b|head-b', basePath: 'base-b', headPath: 'head-b' },
        context: { source: 'cli', command: 'review' },
        decision: { primarySignal: 'approve', decisionReason: 'review found no blocking issues and all required checks are satisfied' },
        result: {
          recommendation: 'APPROVE',
          reasonCount: 0,
          reasons: [],
          breakingChanges: 0,
          nonBreakingChanges: 0,
          validationErrors: 0,
          validationWarnings: 0,
          validationInfos: 0,
          artifactChecked: false,
          provenanceChecked: false,
          metadataRegistryChecked: false,
          artifactFresh: true,
          provenanceChanges: null,
          metadataRegistryChanges: null,
          checksIncomplete: false,
        },
      },
    }))
    recorder.record(createBehaviorRecord({
      behaviorType: 'review_openapi_change',
      identityKey: createBehaviorIdentityKey({
        behaviorType: 'review_openapi_change',
        parts: { targetType: 'openapi-review', targetKey: 'base-c|head-c' },
      }),
      status: 'failed',
      components: {
        actor: { actorType: 'system', actorId: 'oa-gen' },
        target: { targetType: 'openapi-review', targetKey: 'base-c|head-c', basePath: 'base-c', headPath: 'head-c' },
        context: { source: 'cli', command: 'review' },
        decision: { primarySignal: 'request-changes', decisionReason: 'review found blocking changes that require follow-up' },
        result: {
          recommendation: 'REQUEST_CHANGES',
          reasonCount: 1,
          reasons: ['review found blocking changes that require follow-up'],
          breakingChanges: 1,
          nonBreakingChanges: 0,
          validationErrors: 0,
          validationWarnings: 0,
          validationInfos: 0,
          artifactChecked: false,
          provenanceChecked: false,
          metadataRegistryChecked: false,
          artifactFresh: false,
          provenanceChanges: null,
          metadataRegistryChanges: null,
          checksIncomplete: false,
        },
      },
    }))
    recorder.close?.()

    const out = cli(
      `behavior-query --behavior-db ${dbPath} --mode summary-by-behavior-status --format json`,
    )
    const payload = JSON.parse(out) as {
      count?: number
      entries?: Array<unknown>
      aggregations?: Array<{ key?: string; count?: number; dimensions?: { behaviorType?: string; status?: string } }>
    }

    expect(payload.count).toBe(3)
    expect(payload.entries).toEqual([])
    expect(payload.aggregations).toEqual([
      { key: 'build_openapi_target|failed', count: 1, dimensions: { behaviorType: 'build_openapi_target', status: 'failed' } },
      { key: 'review_openapi_change|failed', count: 1, dimensions: { behaviorType: 'review_openapi_change', status: 'failed' } },
      { key: 'review_openapi_change|succeeded', count: 1, dimensions: { behaviorType: 'review_openapi_change', status: 'succeeded' } },
    ])
  })

  it('summary-by-behavior-decision-signal을 JSON으로 조회한다', () => {
    const dbPath = join(tmpDir, 'behavior-query-summary-behavior-decision.sqlite')
    const recorder = createBehaviorRecorderFromOptions({ sqlitePath: dbPath })
    recorder.record(createBehaviorRecord({
      behaviorType: 'build_openapi_target',
      identityKey: createBehaviorIdentityKey({
        behaviorType: 'build_openapi_target',
        parts: { targetType: 'definition-target', targetKey: 'public-api' },
      }),
      status: 'failed',
      components: {
        actor: { actorType: 'system', actorId: 'oa-gen' },
        target: { targetType: 'definition-target', targetKey: 'public-api', targetPath: 'targets/public-api.yaml' },
        context: { source: 'cli', command: 'build-spec' },
        decision: { primarySignal: 'build-invalid', decisionReason: 'builder diagnostics contain one or more errors' },
        result: {
          valid: false,
          fragmentCount: 1,
          selectedNodeCount: 1,
          errors: 1,
          warnings: 0,
          infos: 0,
          errorCodes: ['definition-registry/missing-ref'],
        },
      },
    }))
    recorder.record(createBehaviorRecord({
      behaviorType: 'review_openapi_change',
      identityKey: createBehaviorIdentityKey({
        behaviorType: 'review_openapi_change',
        parts: { targetType: 'openapi-review', targetKey: 'base-b|head-b' },
      }),
      status: 'succeeded',
      components: {
        actor: { actorType: 'system', actorId: 'oa-gen' },
        target: { targetType: 'openapi-review', targetKey: 'base-b|head-b', basePath: 'base-b', headPath: 'head-b' },
        context: { source: 'cli', command: 'review' },
        decision: { primarySignal: 'approve', decisionReason: 'review found no blocking issues and all required checks are satisfied' },
        result: {
          recommendation: 'APPROVE',
          reasonCount: 0,
          reasons: [],
          breakingChanges: 0,
          nonBreakingChanges: 0,
          validationErrors: 0,
          validationWarnings: 0,
          validationInfos: 0,
          artifactChecked: false,
          provenanceChecked: false,
          metadataRegistryChecked: false,
          artifactFresh: true,
          provenanceChanges: null,
          metadataRegistryChanges: null,
          checksIncomplete: false,
        },
      },
    }))
    recorder.record(createBehaviorRecord({
      behaviorType: 'review_openapi_change',
      identityKey: createBehaviorIdentityKey({
        behaviorType: 'review_openapi_change',
        parts: { targetType: 'openapi-review', targetKey: 'base-c|head-c' },
      }),
      status: 'failed',
      components: {
        actor: { actorType: 'system', actorId: 'oa-gen' },
        target: { targetType: 'openapi-review', targetKey: 'base-c|head-c', basePath: 'base-c', headPath: 'head-c' },
        context: { source: 'cli', command: 'review' },
        decision: { primarySignal: 'request-changes', decisionReason: 'review found blocking changes that require follow-up' },
        result: {
          recommendation: 'REQUEST_CHANGES',
          reasonCount: 1,
          reasons: ['review found blocking changes that require follow-up'],
          breakingChanges: 1,
          nonBreakingChanges: 0,
          validationErrors: 0,
          validationWarnings: 0,
          validationInfos: 0,
          artifactChecked: false,
          provenanceChecked: false,
          metadataRegistryChecked: false,
          artifactFresh: false,
          provenanceChanges: null,
          metadataRegistryChanges: null,
          checksIncomplete: false,
        },
      },
    }))
    recorder.close?.()

    const out = cli(
      `behavior-query --behavior-db ${dbPath} --mode summary-by-behavior-decision-signal --format json`,
    )
    const payload = JSON.parse(out) as {
      count?: number
      entries?: Array<unknown>
      aggregations?: Array<{ key?: string; count?: number; dimensions?: { behaviorType?: string; decisionSignal?: string } }>
    }

    expect(payload.count).toBe(3)
    expect(payload.entries).toEqual([])
    expect(payload.aggregations).toEqual([
      { key: 'build_openapi_target|build-invalid', count: 1, dimensions: { behaviorType: 'build_openapi_target', decisionSignal: 'build-invalid' } },
      { key: 'review_openapi_change|approve', count: 1, dimensions: { behaviorType: 'review_openapi_change', decisionSignal: 'approve' } },
      { key: 'review_openapi_change|request-changes', count: 1, dimensions: { behaviorType: 'review_openapi_change', decisionSignal: 'request-changes' } },
    ])
  })

  it('summary-by-target-type를 markdown으로 조회한다', () => {
    const dbPath = join(tmpDir, 'behavior-query-summary-target-type.sqlite')
    const recorder = createBehaviorRecorderFromOptions({ sqlitePath: dbPath })
    recorder.record(createBehaviorRecord({
      behaviorType: 'build_openapi_target',
      identityKey: createBehaviorIdentityKey({
        behaviorType: 'build_openapi_target',
        parts: { targetType: 'definition-target', targetKey: 'public-api' },
      }),
      status: 'succeeded',
      components: {
        actor: { actorType: 'system', actorId: 'oa-gen' },
        target: { targetType: 'definition-target', targetKey: 'public-api', targetPath: 'targets/public-api.yaml' },
        context: { source: 'cli', command: 'build-spec' },
        decision: { primarySignal: 'build-valid', decisionReason: 'builder diagnostics contain no errors' },
        result: {
          valid: true,
          fragmentCount: 1,
          selectedNodeCount: 1,
          errors: 0,
          warnings: 0,
          infos: 0,
          errorCodes: [],
        },
      },
    }))
    recorder.record(createBehaviorRecord({
      behaviorType: 'review_openapi_change',
      identityKey: createBehaviorIdentityKey({
        behaviorType: 'review_openapi_change',
        parts: { targetType: 'openapi-review', targetKey: 'base-a|head-a' },
      }),
      status: 'failed',
      components: {
        actor: { actorType: 'system', actorId: 'oa-gen' },
        target: { targetType: 'openapi-review', targetKey: 'base-a|head-a', basePath: 'base-a', headPath: 'head-a' },
        context: { source: 'cli', command: 'review' },
        decision: { primarySignal: 'request-changes', decisionReason: 'review found blocking changes that require follow-up' },
        result: {
          recommendation: 'REQUEST_CHANGES',
          reasonCount: 1,
          reasons: ['review found blocking changes that require follow-up'],
          breakingChanges: 1,
          nonBreakingChanges: 0,
          validationErrors: 0,
          validationWarnings: 0,
          validationInfos: 0,
          artifactChecked: false,
          provenanceChecked: false,
          metadataRegistryChecked: false,
          artifactFresh: false,
          provenanceChanges: null,
          metadataRegistryChanges: null,
          checksIncomplete: false,
        },
      },
    }))
    recorder.record(createBehaviorRecord({
      behaviorType: 'review_openapi_change',
      identityKey: createBehaviorIdentityKey({
        behaviorType: 'review_openapi_change',
        parts: { targetType: 'openapi-review', targetKey: 'base-b|head-b' },
      }),
      status: 'succeeded',
      components: {
        actor: { actorType: 'system', actorId: 'oa-gen' },
        target: { targetType: 'openapi-review', targetKey: 'base-b|head-b', basePath: 'base-b', headPath: 'head-b' },
        context: { source: 'cli', command: 'review' },
        decision: { primarySignal: 'approve', decisionReason: 'review found no blocking issues and all required checks are satisfied' },
        result: {
          recommendation: 'APPROVE',
          reasonCount: 0,
          reasons: [],
          breakingChanges: 0,
          nonBreakingChanges: 0,
          validationErrors: 0,
          validationWarnings: 0,
          validationInfos: 0,
          artifactChecked: false,
          provenanceChecked: false,
          metadataRegistryChecked: false,
          artifactFresh: true,
          provenanceChanges: null,
          metadataRegistryChanges: null,
          checksIncomplete: false,
        },
      },
    }))
    recorder.close?.()

    const out = cli(
      `behavior-query --behavior-db ${dbPath} --mode summary-by-target-type`,
    )

    expect(out).toContain('# Behavior Query')
    expect(out).toContain('summary-by-target-type')
    expect(out).toContain('| Group | Count | Dimensions |')
    expect(out).toContain('`definition-target`')
    expect(out).toContain('`openapi-review`')
    expect(out).toContain('`targetType=definition-target`')
    expect(out).toContain('`targetType=openapi-review`')
  })

  it('recent-failures를 markdown으로 조회한다', () => {
    const dbPath = join(tmpDir, 'behavior-query-failures.sqlite')
    const recorder = createBehaviorRecorderFromOptions({ sqlitePath: dbPath })
    recorder.record(createBehaviorRecord({
      behaviorType: 'review_openapi_change',
      identityKey: createBehaviorIdentityKey({
        behaviorType: 'review_openapi_change',
        parts: { targetType: 'openapi-review', targetKey: 'base.yaml|head.yaml' },
      }),
      status: 'failed',
      components: {
        actor: { actorType: 'system', actorId: 'oa-gen' },
        target: { targetType: 'openapi-review', targetKey: 'base.yaml|head.yaml', basePath: 'base.yaml', headPath: 'head.yaml' },
        context: { source: 'cli', command: 'review' },
        decision: { primarySignal: 'request-changes', decisionReason: 'review found blocking changes that require follow-up' },
        result: {
          recommendation: 'REQUEST_CHANGES',
          reasonCount: 1,
          reasons: ['review found blocking changes that require follow-up'],
          breakingChanges: 1,
          nonBreakingChanges: 0,
          validationErrors: 0,
          validationWarnings: 0,
          validationInfos: 0,
          artifactChecked: false,
          provenanceChecked: false,
          metadataRegistryChecked: false,
          artifactFresh: false,
          provenanceChanges: null,
          metadataRegistryChanges: null,
          checksIncomplete: false,
        },
      },
    }))
    recorder.close?.()

    const out = cli(
      `behavior-query --behavior-db ${dbPath} --mode recent-failures --behavior-type review_openapi_change --decision-signal request-changes --status failed --limit 5`,
    )

    expect(out).toContain('# Behavior Query')
    expect(out).toContain('recent-failures')
    expect(out).toContain('Filter behaviorType')
    expect(out).toContain('Filter decisionSignal')
    expect(out).toContain('Filter status')
    expect(out).toContain('review_openapi_change')
    expect(out).toContain('REQUEST_CHANGES')
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
