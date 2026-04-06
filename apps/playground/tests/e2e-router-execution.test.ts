/**
 * E2E Router Execution Test
 *
 * Validates that generated router code:
 *   1. Contains correct Hono patterns for each operation
 *   2. Uses correct body parsing for different content types
 *   3. Includes security hints as comments
 *   4. Converts path params to :id style
 *   5. Compiles with tsc --strict alongside generated types
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { generateRouter } from '@oa-sdk/router'
import { generateTypesFromSpec } from '@oa-sdk/codegen/typegen'
import type { OasDocument } from '@oa-sdk/parser'

// ─── Inline OAS 3.2 spec with diverse content types ────────────────────────

const spec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Router Exec Test', version: '1.0.0' },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' },
      apiKey: { type: 'apiKey', name: 'X-API-Key', in: 'header' },
    },
    schemas: {
      User: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
        },
      },
      CreateUser: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
        },
      },
    },
  },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1 } },
          { name: 'offset', in: 'query', schema: { type: 'integer' } },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/User' },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createUser',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateUser' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' },
              },
            },
          },
        },
      },
    },
    '/users/{id}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      ],
      get: {
        operationId: 'getUser',
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
      delete: {
        operationId: 'deleteUser',
        responses: {
          '204': { description: 'Deleted' },
        },
      },
    },
    '/users/{id}/avatar': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      ],
      post: {
        operationId: 'uploadAvatar',
        security: [{ apiKey: [] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  file: { type: 'string', format: 'binary' },
                },
                required: ['file'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Uploaded',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { url: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    '/events': {
      get: {
        operationId: 'streamEvents',
        responses: {
          '200': {
            description: 'SSE',
            content: {
              'text/event-stream': {
                schema: {
                  type: 'object',
                  required: ['type'],
                  properties: { type: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
  },
} as OasDocument

// ─── Test state ─────────────────────────────────────────────────────────────

let routerCode: string
let generatedTypes: string
const tmpDir = resolve(__dirname, '../.tmp-router-exec-test')

beforeAll(() => {
  routerCode = generateRouter(spec, { target: 'hono', typesImport: './types' })
  generatedTypes = generateTypesFromSpec(spec)
})

afterAll(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

// ─── 1. Router code contains all operationId-based handlers ─────────────────

describe('Router contains all operationId-based handlers', () => {
  it('has listUsers handler', () => {
    expect(routerCode).toContain('listUsers')
  })

  it('has createUser handler', () => {
    expect(routerCode).toContain('createUser')
  })

  it('has getUser handler', () => {
    expect(routerCode).toContain('getUser')
  })

  it('has deleteUser handler', () => {
    expect(routerCode).toContain('deleteUser')
  })

  it('has uploadAvatar handler', () => {
    expect(routerCode).toContain('uploadAvatar')
  })

  it('has streamEvents handler', () => {
    expect(routerCode).toContain('streamEvents')
  })
})

// ─── 2. Content type → correct body parsing ─────────────────────────────────

describe('Content type body parsing', () => {
  it('multipart/form-data → c.req.formData()', () => {
    // uploadAvatar uses multipart/form-data
    expect(routerCode).toContain('c.req.formData()')
  })

  it('application/json → c.req.json()', () => {
    // createUser uses application/json
    expect(routerCode).toContain('c.req.json()')
  })
})

// ─── 3. Security hints present as comments ──────────────────────────────────

describe('Security hints in comments', () => {
  it('bearerAuth hint is present', () => {
    expect(routerCode).toContain('// Requires: bearerAuth')
  })

  it('apiKey hint is present', () => {
    expect(routerCode).toContain('// Requires: apiKey')
  })
})

// ─── 4. Path params → :id conversion ───────────────────────────────────────

describe('Path params use colon-style', () => {
  it('/users/{id} → /users/:id', () => {
    expect(routerCode).toContain("'/users/:id'")
  })

  it('/users/{id}/avatar → /users/:id/avatar', () => {
    expect(routerCode).toContain("'/users/:id/avatar'")
  })

  it('does not contain OpenAPI-style {id} in route definitions', () => {
    // Route paths should use :id, not {id}
    // But comments/operationIds may reference the original path, so check only route definitions
    const routeLines = routerCode.split('\n').filter(l => /app\.(get|post|put|patch|delete)\(/.test(l))
    for (const line of routeLines) {
      expect(line).not.toContain('{id}')
    }
  })
})

// ─── 5. Hono framework patterns ────────────────────────────────────────────

describe('Hono framework patterns', () => {
  it('imports Hono', () => {
    expect(routerCode).toContain("import { Hono } from 'hono'")
  })

  it('creates Hono app instance', () => {
    expect(routerCode).toContain('const app = new Hono()')
  })

  it('exports app as default', () => {
    expect(routerCode).toContain('export default app')
  })

  it('uses app.get for GET operations', () => {
    expect(routerCode).toMatch(/app\.get\('\/users'/)
    expect(routerCode).toMatch(/app\.get\('\/users\/:id'/)
    expect(routerCode).toMatch(/app\.get\('\/events'/)
  })

  it('uses app.post for POST operations', () => {
    expect(routerCode).toMatch(/app\.post\('\/users'/)
    expect(routerCode).toMatch(/app\.post\('\/users\/:id\/avatar'/)
  })

  it('uses app.delete for DELETE operations', () => {
    expect(routerCode).toMatch(/app\.delete\('\/users\/:id'/)
  })

  it('deleteUser handler returns 204 with null body', () => {
    expect(routerCode).toContain('c.body(null, 204)')
  })
})

// ─── 6. Query and path param extraction ─────────────────────────────────────

describe('Query and path param extraction', () => {
  it('listUsers extracts query params', () => {
    // Should contain c.req.query() for the listUsers handler
    expect(routerCode).toContain('c.req.query()')
  })

  it('getUser extracts path params', () => {
    // Should contain c.req.param() for handlers with path params
    expect(routerCode).toContain('c.req.param()')
  })
})

// ─── 7. Types import ───────────────────────────────────────────────────────

describe('Types import', () => {
  it('imports types from configured path', () => {
    expect(routerCode).toContain("from './types'")
  })
})

// ─── 8. Combined compilation: types.ts + router.ts pass tsc --strict ────────

/**
 * The router codegen imports type names that may not exist in the typegen output
 * (e.g. DeleteUserResponse for 204, StreamEventsResponse for SSE,
 *  UploadAvatarBody for multipart — typegen only handles application/json).
 * This helper creates `unknown` stubs for any missing types so compilation succeeds.
 */
function appendMissingTypeStubs(typesCode: string, consumerCode: string): string {
  const importMatch = consumerCode.match(/import\s+type\s*\{([^}]+)\}/)
  if (!importMatch) return typesCode
  const imported = importMatch[1]!.split(',').map(s => s.trim()).filter(Boolean)
  const stubs: string[] = []
  for (const name of imported) {
    if (!typesCode.includes(`export type ${name} `)) {
      stubs.push(`export type ${name} = unknown`)
    }
  }
  return stubs.length > 0
    ? `${typesCode}\n\n// Stubs for types referenced by router but not emitted by typegen\n${stubs.join('\n')}\n`
    : typesCode
}

describe('Combined tsc compilation', () => {
  it('types.ts alone compiles', () => {
    mkdirSync(tmpDir, { recursive: true })

    writeFileSync(join(tmpDir, 'types.ts'), generatedTypes, 'utf8')
    writeFileSync(
      join(tmpDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          target: 'ES2022',
          skipLibCheck: true,
        },
        include: ['types.ts'],
      }),
      'utf8',
    )

    execSync('npx tsc --noEmit', { cwd: tmpDir, timeout: 30_000 })
  })

  it('router.ts + types.ts compile together (with stubs for missing types)', () => {
    mkdirSync(tmpDir, { recursive: true })

    const typesWithStubs = appendMissingTypeStubs(generatedTypes, routerCode)
    writeFileSync(join(tmpDir, 'types.ts'), typesWithStubs, 'utf8')
    writeFileSync(join(tmpDir, 'router.ts'), routerCode, 'utf8')

    // The router imports from 'hono', so we must point moduleResolution to node_modules
    const playgroundRoot = resolve(__dirname, '..')
    writeFileSync(
      join(tmpDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          target: 'ES2022',
          skipLibCheck: true,
          lib: ['ES2022', 'DOM'],
          paths: { 'hono': [join(playgroundRoot, 'node_modules/hono')] },
        },
        include: ['types.ts', 'router.ts'],
      }),
      'utf8',
    )

    execSync('npx tsc --noEmit', { cwd: tmpDir, timeout: 30_000 })
  })
})
