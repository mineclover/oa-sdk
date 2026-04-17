import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
  validateOpenApiProjection,
  type OpenApiProjectionResult,
} from '@oa-sdk/openapi-projection-contract'

const pkgDir = resolve(__dirname, '../..')
const cliPath = resolve(pkgDir, 'dist/cli/index.js')
const tmpBase = resolve(pkgDir, '.tmp-cli-build-spec-test')

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpBase, `run-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

describe('oa-gen build-spec', () => {
  it('documents the build-spec command and scoped options in help', () => {
    const result = runCli(['--help'])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('oa-gen build-spec --target, -t <target>')
    expect(result.stdout).toContain('[build-spec] target config 파일 경로')
    expect(result.stdout).toContain('[build-spec] 빌드된 OpenAPI YAML 출력 파일 경로')
  })

  it('builds a target OpenAPI document and writes sidecar reports', () => {
    writeTarget('public-api.yaml', targetConfig(['/books']))
    writeFragment('path/public/book/BooksPath.yaml', {
      id: 'path:public/book/BooksPath',
      metadata: { path: '/books' },
      content: {
        get: {
          summary: 'List books',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: 'oa://schema/public/book/Book' },
                  },
                },
              },
            },
          },
        },
      },
    })
    writeFragment('schema/public/book/Book.yaml', {
      id: 'schema:public/book/Book',
      content: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
    })

    const outputPath = join(tmpDir, 'out', 'public-api.yaml')
    const diagnosticsPath = join(tmpDir, 'out', 'diagnostics.json')
    const collisionReportPath = join(tmpDir, 'out', 'collisions.json')
    const result = runCli([
      'build-spec',
      '--target',
      join(tmpDir, 'targets', 'public-api.yaml'),
      '--output',
      outputPath,
      '--diagnostics',
      diagnosticsPath,
      '--collision-report',
      collisionReportPath,
    ])

    expect(result.status).toBe(0)
    expect(result.stderr).toContain('build-spec: built "public-api"')
    expect(existsSync(outputPath)).toBe(true)

    const document = parseYaml(readFileSync(outputPath, 'utf8')) as {
      openapi?: string
      paths?: Record<string, unknown>
      components?: { schemas?: Record<string, unknown> }
    }
    expect(document.openapi).toBe('3.2.0')
    expect(document.paths?.['/books']).toBeDefined()
    expect(document.components?.schemas?.Book).toBeDefined()
    expect(JSON.stringify(document)).not.toContain('oa://')
    expect(validateOpenApiProjection({
      profile: 'full-api-document',
      projection: document,
      refs: [],
      diagnostics: [],
      sources: {},
      versionHash: 'sha256:cli-build-spec-output',
    } satisfies OpenApiProjectionResult<Record<string, unknown>>)).toEqual({
      valid: true,
      diagnostics: [],
    })

    const diagnostics = readJson(diagnosticsPath) as {
      valid?: boolean
      summary?: { errors?: number }
      diagnostics?: unknown[]
    }
    expect(diagnostics.valid).toBe(true)
    expect(diagnostics.summary?.errors).toBe(0)
    expect(diagnostics.diagnostics).toEqual([])

    const collisionReport = readJson(collisionReportPath) as Array<{
      canonicalId?: string
      outputName?: string
      severity?: string
    }>
    expect(collisionReport).toContainEqual(expect.objectContaining({
      canonicalId: 'schema:public/book/Book',
      outputName: 'Book',
      severity: 'info',
    }))
  })

  it('loads supplemental fragment refs for non-$ref dependency edges', () => {
    writeTarget('public-api.yaml', {
      name: 'public-api',
      scopes: ['shared', 'public'],
      domains: ['common', 'book'],
      servers: [{ url: 'https://api.example.test' }],
      includePaths: ['/books'],
      namingPolicy: {
        aliases: {
          'securityScheme:shared/common/BearerAuth': 'bearerAuth',
        },
      },
    })
    writeFragment('path/public/book/BooksPath.yaml', {
      id: 'path:public/book/BooksPath',
      metadata: { path: '/books' },
      refs: [
        {
          ref: 'oa://securityScheme/shared/common/BearerAuth',
          sourcePointer: '#/content/get/security/0/bearerAuth',
        },
      ],
      content: {
        get: {
          summary: 'List books',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': { description: 'OK' },
          },
        },
      },
    })
    writeFragment('securityScheme/shared/common/BearerAuth.yaml', {
      id: 'securityScheme:shared/common/BearerAuth',
      content: {
        type: 'http',
        scheme: 'bearer',
      },
    })

    const outputPath = join(tmpDir, 'out', 'public-api.yaml')
    const result = runCli([
      'build-spec',
      '--target',
      join(tmpDir, 'targets', 'public-api.yaml'),
      '--output',
      outputPath,
    ])

    expect(result.status).toBe(0)

    const document = parseYaml(readFileSync(outputPath, 'utf8')) as {
      paths?: Record<string, { get?: { security?: unknown } }>
      components?: { securitySchemes?: Record<string, unknown> }
    }
    expect(document.paths?.['/books']?.get?.security).toEqual([{ bearerAuth: [] }])
    expect(document.components?.securitySchemes).toEqual({
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
      },
    })
  })

  it('exits non-zero and reports duplicate canonical IDs', () => {
    writeTarget('public-api.yaml', targetConfig(['/books']))
    writeFragment('path/public/book/BooksPath.yaml', pathRefFixture('/books', 'oa://schema/public/book/Book'))
    writeFragment('schema/public/book/Book.yaml', bookFixture())
    writeFragment('schema/public/book/BookDuplicate.yaml', bookFixture())

    const outputPath = join(tmpDir, 'out', 'public-api.yaml')
    const diagnosticsPath = join(tmpDir, 'out', 'diagnostics.json')
    const result = runCli([
      'build-spec',
      '--target',
      join(tmpDir, 'targets', 'public-api.yaml'),
      '--output',
      outputPath,
      '--diagnostics',
      diagnosticsPath,
    ])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('definition-registry/duplicate-id')
    expect(existsSync(outputPath)).toBe(false)

    const diagnostics = readJson(diagnosticsPath) as { diagnostics?: Array<{ code?: string }> }
    expect(diagnostics.diagnostics?.some(diagnostic => diagnostic.code === 'definition-registry/duplicate-id'))
      .toBe(true)
  })

  it('exits non-zero and reports unresolved required refs', () => {
    writeTarget('public-api.yaml', targetConfig(['/books']))
    writeFragment('path/public/book/BooksPath.yaml', pathRefFixture('/books', 'oa://schema/public/book/Missing'))

    const diagnosticsPath = join(tmpDir, 'out', 'diagnostics.json')
    const result = runCli([
      'build-spec',
      '--target',
      join(tmpDir, 'targets', 'public-api.yaml'),
      '--diagnostics',
      diagnosticsPath,
    ])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('definition-registry/missing-ref')

    const diagnostics = readJson(diagnosticsPath) as { diagnostics?: Array<{ code?: string }> }
    expect(diagnostics.diagnostics?.some(diagnostic => diagnostic.code === 'definition-registry/missing-ref'))
      .toBe(true)
  })
})

function runCli(args: string[]): { stdout: string; stderr: string; status: number | null } {
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

function targetConfig(includePaths: string[]) {
  return {
    name: 'public-api',
    scopes: ['public'],
    domains: ['book'],
    servers: [{ url: 'https://api.example.test' }],
    includePaths,
    namingPolicy: { aliases: {} },
  }
}

function pathRefFixture(path: string, ref: string) {
  return {
    id: 'path:public/book/BooksPath',
    metadata: { path },
    content: {
      get: {
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { $ref: ref },
              },
            },
          },
        },
      },
    },
  }
}

function bookFixture() {
  return {
    id: 'schema:public/book/Book',
    content: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
    },
  }
}

function writeTarget(relativePath: string, value: unknown): void {
  writeYaml(join(tmpDir, 'targets', relativePath), value)
}

function writeFragment(relativePath: string, value: unknown): void {
  writeYaml(join(tmpDir, 'fragments', relativePath), value)
}

function writeYaml(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, stringifyYaml(value), 'utf8')
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}
