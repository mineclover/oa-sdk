import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { buildSpec } from '../cli/lib/build-spec.js'
import {
  diffOpenApiDocuments,
  type OpenApiNormalizedDiffEntry,
} from '../cli/lib/openapi-normalized-diff.js'

const pkgDir = resolve(__dirname, '../..')
const repoRoot = resolve(pkgDir, '../..')
const schemasSrcDir = join(repoRoot, 'packages/schemas/src')
const tmpBase = resolve(pkgDir, '.tmp-builder-parity-artifact-test')

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpBase, `run-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

describe('builder parity artifact workflow', () => {
  it('generates a local parity artifact and sidecar reports without replacing .merged.yaml', () => {
    const outputPath = join(tmpDir, '.builder', 'local-parity-api.yaml')
    const diagnosticsPath = join(tmpDir, '.builder', 'local-parity-api.diagnostics.json')
    const collisionReportPath = join(tmpDir, '.builder', 'local-parity-api.collisions.json')

    const result = buildSpec({
      targetPath: join(schemasSrcDir, 'targets/local-parity-api.yaml'),
      fragmentsDir: join(schemasSrcDir, 'fragments'),
      outputPath,
      diagnosticsPath,
      collisionReportPath,
    })

    expect(result.valid).toBe(true)
    expect(resolve(outputPath)).not.toBe(resolve(schemasSrcDir, '.merged.yaml'))
    expect(existsSync(outputPath)).toBe(true)
    expect(existsSync(diagnosticsPath)).toBe(true)
    expect(existsSync(collisionReportPath)).toBe(true)

    const document = parseYaml(readFileSync(outputPath, 'utf8')) as {
      paths?: Record<string, unknown>
      components?: {
        schemas?: Record<string, unknown>
        securitySchemes?: Record<string, unknown>
      }
    }
    expect(Object.keys(document.paths ?? {}).sort()).toEqual([
      '/health',
      '/health/stream',
      '/users',
      '/users/{id}',
    ])
    expect(document.components?.schemas?.User).toBeDefined()
    expect(document.components?.securitySchemes?.bearerAuth).toBeDefined()

    const diagnostics = readJson(diagnosticsPath) as {
      valid?: boolean
      summary?: { errors?: number }
    }
    expect(diagnostics.valid).toBe(true)
    expect(diagnostics.summary?.errors).toBe(0)

    const collisionReport = readJson(collisionReportPath) as Array<{
      canonicalId?: string
      outputName?: string
      severity?: string
    }>
    expect(collisionReport).toContainEqual(expect.objectContaining({
      canonicalId: 'securityScheme:shared/common/BearerAuth',
      outputName: 'bearerAuth',
      severity: 'warning',
    }))
  })

  it('normalizes expected ordering differences and reports intentional parity drift', () => {
    const baseSpec = parityFixture()
    const reorderedSpec = parityFixture({
      reverseServers: true,
      reverseSecurity: true,
      reverseRequired: true,
      reverseParameters: true,
    })

    expect(diffOpenApiDocuments(baseSpec, reorderedSpec)).toEqual([])

    const changedSpec = parityFixture()
    changedSpec.servers = [{ url: 'https://api.changed.example.test' }]
    changedSpec.paths = {
      '/books': {
        get: {
          responses: { 200: { description: 'OK' } },
        },
      },
    }
    changedSpec.components = {
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'number' },
          },
        },
      },
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'basic',
        },
      },
    }

    const diff = diffOpenApiDocuments(baseSpec, changedSpec)
    expect(categories(diff)).toEqual(expect.arrayContaining([
      'server',
      'path',
      'component',
      'security',
    ]))
    expect(diff).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'server', pointer: '#/servers' }),
      expect.objectContaining({ category: 'path', kind: 'removed', pointer: '#/paths/~1users' }),
      expect.objectContaining({ category: 'path', kind: 'added', pointer: '#/paths/~1books' }),
      expect.objectContaining({ category: 'component', pointer: '#/components/schemas/User' }),
      expect.objectContaining({ category: 'security', pointer: '#/components/securitySchemes/bearerAuth' }),
      expect.objectContaining({ category: 'security', pointer: '#/paths/~1users/get/security' }),
    ]))
  })
})

function parityFixture(options: {
  reverseServers?: boolean
  reverseSecurity?: boolean
  reverseRequired?: boolean
  reverseParameters?: boolean
} = {}): Record<string, unknown> {
  const servers = [
    { url: 'https://api-a.example.test' },
    { url: 'https://api-b.example.test' },
  ]
  const security = [
    { bearerAuth: [] },
    { oauth2: ['users:read', 'users:write'] },
  ]
  const required = ['id', 'email']
  const parameters = [
    { name: 'page', in: 'query', schema: { type: 'integer' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } },
  ]

  return {
    openapi: '3.2.0',
    info: {
      title: 'Parity fixture',
      version: '0.0.0',
    },
    servers: options.reverseServers ? [...servers].reverse() : servers,
    paths: {
      '/users': {
        get: {
          parameters: options.reverseParameters ? [...parameters].reverse() : parameters,
          security: options.reverseSecurity ? [...security].reverse() : security,
          responses: { 200: { description: 'OK' } },
        },
      },
    },
    components: {
      schemas: {
        User: {
          type: 'object',
          required: options.reverseRequired ? [...required].reverse() : required,
          properties: {
            email: { type: 'string' },
            id: { type: 'string' },
          },
        },
      },
      securitySchemes: {
        bearerAuth: {
          scheme: 'bearer',
          type: 'http',
        },
      },
    },
  }
}

function categories(diff: readonly OpenApiNormalizedDiffEntry[]): string[] {
  return [...new Set(diff.map(entry => entry.category))].sort()
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8')) as unknown
}
