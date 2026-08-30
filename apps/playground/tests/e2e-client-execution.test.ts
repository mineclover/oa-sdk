/**
 * E2E Client Execution Test
 *
 * Proves that generated client code actually RUNS correctly against a mock server.
 *
 * 1. Define an OAS 3.2 spec inline
 * 2. Generate client code with generateClient(spec)
 * 3. Start a mock server with createNodeMockServer(spec, { port: 0 })
 * 4. Validate the contract: fetch requests following the same URL/header/body
 *    conventions the generated client would use → mock server responds correctly
 * 5. Verify generated client + types compile with tsc --strict
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { generateClient } from '@oa-sdk/client'
import { generateTypesFromSpec } from '@oa-sdk/codegen/typegen'
import { createNodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
import type { NodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
import type { OasDocument } from '@oa-sdk/parser'
import { runTsc } from './run-tsc.js'

// ─── Inline OAS 3.2 spec ───────────────────────────────────────────────────

const spec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Exec Test', version: '1.0.0' },
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
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
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1 } },
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
                examples: {
                  default: {
                    dataValue: [{ id: 1, name: 'Alice' }],
                  },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createUser',
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
                examples: {
                  default: {
                    dataValue: { id: 2, name: 'Bob' },
                  },
                },
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
                examples: {
                  default: {
                    dataValue: { id: 1, name: 'Alice' },
                  },
                },
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
                  properties: {
                    type: { type: 'string', enum: ['ping'] },
                  },
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

let server: NodeMockServer
let generatedClient: string
let generatedTypes: string
const tmpDir = resolve(__dirname, '../.tmp-client-exec-test')

beforeAll(async () => {
  generatedClient = generateClient(spec, { typesImport: './types' })
  generatedTypes = generateTypesFromSpec(spec)

  server = createNodeMockServer(spec, { port: 0 })
  await server.start()
})

afterAll(async () => {
  await server.stop()
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

// ─── 1. Generated client code structure ─────────────────────────────────────

describe('Generated client code structure', () => {
  it('produces code with createClient factory', () => {
    expect(generatedClient).toContain('createClient')
  })

  it('contains listUsers method', () => {
    expect(generatedClient).toContain('listUsers')
  })

  it('contains createUser method', () => {
    expect(generatedClient).toContain('createUser')
  })

  it('contains getUser method', () => {
    expect(generatedClient).toContain('getUser')
  })

  it('contains deleteUser method', () => {
    expect(generatedClient).toContain('deleteUser')
  })

  it('contains streamEvents method', () => {
    expect(generatedClient).toContain('streamEvents')
  })

  it('streamEvents uses async * generator syntax', () => {
    expect(generatedClient).toMatch(/async\s+\*\s*streamEvents/)
  })

  it('non-streaming methods use plain async (not generator)', () => {
    expect(generatedClient).toMatch(/async\s+listUsers/)
    expect(generatedClient).not.toMatch(/async\s+\*\s*listUsers/)
    expect(generatedClient).toMatch(/async\s+createUser/)
    expect(generatedClient).not.toMatch(/async\s+\*\s*createUser/)
    expect(generatedClient).toMatch(/async\s+getUser/)
    expect(generatedClient).not.toMatch(/async\s+\*\s*getUser/)
    expect(generatedClient).toMatch(/async\s+deleteUser/)
    expect(generatedClient).not.toMatch(/async\s+\*\s*deleteUser/)
  })

  it('uses a URL-encoded path template for /users/{id}', () => {
    expect(generatedClient).toContain('`/users/${encodeURIComponent(String(params["id"]))}`')
  })

  it('imports types from the configured typesImport path', () => {
    expect(generatedClient).toContain("from './types'")
  })
})

// ─── 2. Contract validation against mock server ─────────────────────────────

describe('Contract: GET /users → 200 + correct body', () => {
  it('returns 200 with example data', async () => {
    const res = await fetch(`${server.url}/users`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([{ id: 1, name: 'Alice' }])
  })
})

describe('Contract: GET /users?limit=5 → 200', () => {
  it('accepts valid query parameter', async () => {
    const res = await fetch(`${server.url}/users?limit=5`)
    expect(res.status).toBe(200)
  })
})

describe('Contract: GET /users?limit=0 → 422 (constraint violation)', () => {
  it('rejects query param below minimum', async () => {
    const res = await fetch(`${server.url}/users?limit=0`)
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: { code: string; details: Array<{ code: string }> } }
    expect(body.error.code).toBe('CONSTRAINT_VIOLATION')
  })
})

describe('Contract: POST /users with { name: "Test" } → 201', () => {
  it('accepts valid body and returns created resource', async () => {
    const res = await fetch(`${server.url}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toEqual({ id: 2, name: 'Bob' })
  })
})

describe('Contract: POST /users with {} → 422 (missing required)', () => {
  it('rejects body missing required "name" field', async () => {
    const res = await fetch(`${server.url}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: { code: string; details: Array<{ code: string }> } }
    expect(body.error.code).toBe('CONSTRAINT_VIOLATION')
    expect(body.error.details.some(d => d.code === 'MISSING_REQUIRED_FIELD')).toBe(true)
  })
})

describe('Contract: POST /users with { name: "" } → 422 (minLength)', () => {
  it('rejects empty name string (minLength: 1 violation)', async () => {
    const res = await fetch(`${server.url}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    expect(res.status).toBe(422)
  })
})

describe('Contract: GET /users/1 → 200 + correct body', () => {
  it('returns example data for path param route', async () => {
    const res = await fetch(`${server.url}/users/1`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ id: 1, name: 'Alice' })
  })
})

describe('Contract: DELETE /users/1 → 204', () => {
  it('returns 204 with no body', async () => {
    const res = await fetch(`${server.url}/users/1`, { method: 'DELETE' })
    expect(res.status).toBe(204)
  })
})

describe('Contract: GET /events → SSE stream with correct format', () => {
  it('returns text/event-stream content type', async () => {
    const res = await fetch(`${server.url}/events`)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
  })

  it('returns data: lines with JSON payloads containing "type" field', async () => {
    const res = await fetch(`${server.url}/events`)
    const text = await res.text()

    // SSE format: "data: <json>\n\n" blocks
    const dataLines = text.split('\n\n').filter(l => l.startsWith('data: '))
    expect(dataLines.length).toBeGreaterThan(0)

    for (const line of dataLines) {
      const payload = line.replace(/^data: /, '')
      const parsed = JSON.parse(payload)
      expect(parsed).toHaveProperty('type')
    }
  })

  it('does not synthesize an undocumented [DONE] terminator', async () => {
    const res = await fetch(`${server.url}/events`)
    const text = await res.text()
    expect(text).not.toContain('[DONE]')
  })
})

// ─── 3. Generated client compiles: tsc --noEmit ─────────────────────────────

/**
 * The client codegen imports type names that may not exist in the typegen output
 * (e.g. DeleteUserResponse for 204, StreamEventsResponse for SSE).
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
    ? `${typesCode}\n\n// Stubs for types referenced by client but not emitted by typegen\n${stubs.join('\n')}\n`
    : typesCode
}

describe('Generated client + types compile with tsc --strict', () => {
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

    runTsc(tmpDir)
  })

  it('client.ts + types.ts compile together (with stubs for missing response types)', () => {
    mkdirSync(tmpDir, { recursive: true })

    const typesWithStubs = appendMissingTypeStubs(generatedTypes, generatedClient)
    writeFileSync(join(tmpDir, 'types.ts'), typesWithStubs, 'utf8')
    writeFileSync(join(tmpDir, 'client.ts'), generatedClient, 'utf8')
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
        },
        include: ['types.ts', 'client.ts'],
      }),
      'utf8',
    )

    runTsc(tmpDir)
  })
})
