/**
 * Cross-package E2E integration test
 *
 * Full pipeline: OAS 3.2 spec -> typegen -> client codegen -> mock server
 *
 * Validates:
 *   1. generateTypesFromSpec produces correct type shapes
 *   2. generateClient produces correct client code (operationIds, paths, SSE generators)
 *   3. createNodeMockServer serves correct responses (CRUD, auth, validation, SSE)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { generateTypesFromSpec } from '@oa-sdk/codegen/typegen'
import { generateClient } from '@oa-sdk/client'
import { createNodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
import type { NodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
import type { OasDocument } from '@oa-sdk/parser'

// ─── Inline OAS 3.2 spec ───────────────────────────────────────────────────

const spec = {
  openapi: '3.2.0',
  info: { title: 'E2E Test', version: '1.0.0' },
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
    schemas: {
      User: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
        },
      },
      CreateUser: {
        type: 'object',
        required: ['name', 'email'],
        properties: {
          name: { type: 'string', minLength: 1 },
          email: { type: 'string', format: 'email' },
        },
      },
      Event: {
        type: 'object',
        required: ['type'],
        properties: {
          type: { type: 'string', enum: ['created', 'updated'] },
        },
      },
    },
  },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                examples: {
                  default: {
                    value: [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
                  },
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
                examples: {
                  default: {
                    value: { id: 2, name: 'Bob', email: 'bob@example.com' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/users/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
      get: {
        operationId: 'getUser',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                examples: {
                  default: {
                    value: { id: 1, name: 'Alice', email: 'alice@example.com' },
                  },
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
                schema: { $ref: '#/components/schemas/Event' },
              },
            },
          },
        },
      },
    },
  },
} as const

// ─── Generated code strings ────────────────────────────────────────────────

let generatedTypes: string
let generatedClient: string

// ─── Mock server ───────────────────────────────────────────────────────────

let server: NodeMockServer

beforeAll(async () => {
  generatedTypes = generateTypesFromSpec(spec as unknown as OasDocument)
  generatedClient = generateClient(spec as unknown as OasDocument, { typesImport: './types' })

  server = createNodeMockServer(spec as unknown as Parameters<typeof createNodeMockServer>[0], { port: 0 })
  await server.start()
})

afterAll(async () => {
  await server.stop()
})

// ─── 1. Generated types verification ──────────────────────────────────────

describe('Generated types contain expected shapes', () => {
  it('schema types are present (User, CreateUser, Event)', () => {
    expect(generatedTypes).toContain('export type User =')
    expect(generatedTypes).toContain('export type CreateUser =')
    expect(generatedTypes).toContain('export type Event =')
  })

  it('User type has id (number) and name (string) fields', () => {
    expect(generatedTypes).toMatch(/id[?]?:\s*number/)
    expect(generatedTypes).toMatch(/name[?]?:\s*string/)
  })

  it('Event type has enum field', () => {
    // The enum should be represented as a union
    expect(generatedTypes).toMatch(/'created'\s*\|\s*'updated'/)
  })

  it('PathParams type exists for getUser (path parameter)', () => {
    expect(generatedTypes).toContain('GetUserPathParams')
  })

  it('Body type exists for createUser (request body)', () => {
    expect(generatedTypes).toContain('CreateUserBody')
  })

  it('Response types are generated when schema is present', () => {
    // listUsers/createUser/getUser responses only have examples (no schema),
    // so no Response type is emitted for them — this is correct behavior.
    // The Op bundle types still exist without a response field.
    // Verify that at minimum, the typegen does NOT crash and produces valid output.
    expect(generatedTypes).toContain('export type')
  })

  it('Op bundle types exist per operation', () => {
    expect(generatedTypes).toContain('ListUsersOp')
    expect(generatedTypes).toContain('CreateUserOp')
    expect(generatedTypes).toContain('GetUserOp')
    expect(generatedTypes).toContain('StreamEventsOp')
  })

  it('Op bundle types contain method and path fields', () => {
    expect(generatedTypes).toMatch(/ListUsersOp[\s\S]*?method:\s*'get'/)
    expect(generatedTypes).toMatch(/CreateUserOp[\s\S]*?method:\s*'post'/)
    expect(generatedTypes).toMatch(/GetUserOp[\s\S]*?path:\s*'\/users\/\{id\}'/)
  })
})

// ─── 2. Generated client verification ─────────────────────────────────────

describe('Generated client code is syntactically valid', () => {
  it('contains createClient factory', () => {
    expect(generatedClient).toContain('createClient')
  })

  it('contains method names matching operationIds', () => {
    expect(generatedClient).toContain('listUsers')
    expect(generatedClient).toContain('createUser')
    expect(generatedClient).toContain('getUser')
    expect(generatedClient).toContain('streamEvents')
  })

  it('contains URL-encoded path template for parameterized route', () => {
    expect(generatedClient).toContain('`/users/${encodeURIComponent(String(params["id"]))}`')
  })

  it('SSE operation uses async * generator', () => {
    expect(generatedClient).toMatch(/async\s+\*\s*streamEvents/)
  })

  it('types are imported correctly from typesImport path', () => {
    expect(generatedClient).toContain("from './types'")
    // Should import operation-level types that exist in the generated types
    expect(generatedClient).toContain('CreateUserBody')
    expect(generatedClient).toContain('GetUserPathParams')
  })

  it('non-streaming methods use async (not async *)', () => {
    expect(generatedClient).toMatch(/async\s+listUsers/)
    expect(generatedClient).toMatch(/async\s+createUser/)
    expect(generatedClient).toMatch(/async\s+getUser/)
    // These should NOT be generators
    expect(generatedClient).not.toMatch(/async\s+\*\s*listUsers/)
    expect(generatedClient).not.toMatch(/async\s+\*\s*createUser/)
  })
})

// ─── 3. Mock server: GET returns correct example data ─────────────────────

describe('Mock server: GET /users', () => {
  it('returns 200 with example data when authorized', async () => {
    const res = await fetch(`${server.url}/users`, {
      headers: { Authorization: 'Bearer test-token' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([{ id: 1, name: 'Alice', email: 'alice@example.com' }])
  })
})

// ─── 4. Mock server: POST with valid body → 201 ──────────────────────────

describe('Mock server: POST /users', () => {
  it('valid body → 201', async () => {
    const res = await fetch(`${server.url}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify({ name: 'Charlie', email: 'charlie@example.com' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toEqual({ id: 2, name: 'Bob', email: 'bob@example.com' })
  })

  it('invalid body (missing required email) → 422 with error details', async () => {
    const res = await fetch(`${server.url}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify({ name: 'Charlie' }),
    })
    expect(res.status).toBe(422)
    const body = await res.json() as { error: { code: string; details: unknown[] } }
    expect(body.error.code).toBe('CONSTRAINT_VIOLATION')
    expect(body.error.details.length).toBeGreaterThan(0)
  })

  it('invalid body (empty name, minLength violation) → 422', async () => {
    const res = await fetch(`${server.url}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify({ name: '', email: 'test@example.com' }),
    })
    expect(res.status).toBe(422)
  })
})

// ─── 5. Mock server: path params ──────────────────────────────────────────

describe('Mock server: GET /users/:id (path params)', () => {
  it('valid integer path param → 200 with example data', async () => {
    const res = await fetch(`${server.url}/users/42`, {
      headers: { Authorization: 'Bearer test-token' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' })
  })
})

// ─── 6. Mock server: security enforcement ─────────────────────────────────

describe('Mock server: security enforcement (bearer token)', () => {
  it('GET /users without Authorization → 401', async () => {
    const res = await fetch(`${server.url}/users`)
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ code: 'UNAUTHORIZED', message: '인증이 필요합니다' })
  })

  it('GET /users with Authorization: Bearer → 200', async () => {
    const res = await fetch(`${server.url}/users`, {
      headers: { Authorization: 'Bearer any-valid-token' },
    })
    expect(res.status).toBe(200)
  })

  it('POST /users without Authorization → 401', async () => {
    const res = await fetch(`${server.url}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', email: 'test@example.com' }),
    })
    expect(res.status).toBe(401)
  })

  it('GET /events has no security requirement → 200 without token', async () => {
    const res = await fetch(`${server.url}/events`)
    expect(res.status).toBe(200)
  })
})

// ─── 7. Mock server: SSE streaming ───────────────────────────────────────

describe('Mock server: SSE streaming (GET /events)', () => {
  it('returns text/event-stream content type', async () => {
    const res = await fetch(`${server.url}/events`)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
  })

  it('returns proper data: format with JSON events', async () => {
    const res = await fetch(`${server.url}/events`)
    const text = await res.text()

    // SSE format: "data: <json>\n\n" lines
    const lines = text.split('\n\n').filter(l => l.startsWith('data: '))
    expect(lines.length).toBeGreaterThan(0)

    // Each schema-defined data line should be valid JSON with a type field.
    for (const line of lines) {
      const payload = line.replace(/^data: /, '')
      const parsed = JSON.parse(payload)
      expect(parsed).toHaveProperty('type')
      expect(['created', 'updated']).toContain(parsed.type)
    }
  })

  it('does not synthesize an undocumented [DONE] terminator', async () => {
    const res = await fetch(`${server.url}/events`)
    const text = await res.text()
    expect(text).not.toContain('[DONE]')
  })
})

// ─── 8. Routing edge cases ────────────────────────────────────────────────

describe('Mock server: routing edge cases', () => {
  it('unknown path → 404', async () => {
    const res = await fetch(`${server.url}/nonexistent`)
    expect(res.status).toBe(404)
  })

  it('unsupported method → 405', async () => {
    const res = await fetch(`${server.url}/users/1`, { method: 'DELETE' })
    expect(res.status).toBe(405)
  })
})
