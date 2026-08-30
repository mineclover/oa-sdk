/**
 * 프레임워크 통합 테스트 — 실제 테스트 시나리오에서 mock server 사용 검증
 *
 * 시나리오: 인증 + CRUD + 중첩 리소스 + 스트리밍을 포함한 REST API를
 * 두 어댑터(MSW, Node HTTP) 모두에서 테스트.
 *
 * 목적:
 *   1. createTestClient + createCoverageTracker가 실제 테스트 워크플로우에서 동작하는지
 *   2. 인증이 필요한 엔드포인트에서 401/422 에러가 정확히 발생하는지
 *   3. 중첩 path param (/orgs/{orgId}/projects/{projectId}) 라우팅이 정확한지
 *   4. MSW와 Node HTTP 어댑터 간 동작 패리티가 유지되는지
 *   5. Coverage tracker로 테스트 커버리지 추적이 작동하는지
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { setupServer, type SetupServer } from 'msw/node'
import { createMswHandlers, type MswHandlerOptions } from '../../adapters/msw.js'
import { createNodeMockServer, type NodeMockServer } from '../../adapters/node-http.js'
import { createTestClient, createCoverageTracker, type TestClient } from '../../testing.js'
import type { OasDocument } from '@oa-sdk/parser'

// ─── 공통 스펙: SaaS-style API ──────────────────────────────────────────────

const apiSpec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'SaaS API', version: '1.0.0' },
  servers: [{ url: 'http://localhost' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' },
      apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    },
    schemas: {
      Org: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', minLength: 1, maxLength: 100 },
          plan: { type: 'string', enum: ['free', 'pro', 'enterprise'] },
        },
      },
      Project: {
        type: 'object',
        required: ['id', 'name', 'orgId'],
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          orgId: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['active', 'archived'] },
        },
      },
      CreateProject: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string' },
        },
      },
      PaginatedProjects: {
        type: 'object',
        required: ['items', 'total', 'page'],
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/Project' } },
          total: { type: 'integer' },
          page: { type: 'integer' },
        },
      },
      EventPayload: {
        type: 'object',
        required: ['event', 'data'],
        properties: {
          event: { type: 'string', enum: ['created', 'updated', 'deleted'] },
          data: { type: 'object' },
        },
      },
    },
  },
  paths: {
    // ─── 인증 불필요: health check ─────────────────────────────────────
    '/health': {
      get: {
        operationId: 'healthCheck',
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                examples: { default: { dataValue: { status: 'ok', uptime: 12345 } } },
              },
            },
          },
        },
      },
    },

    // ─── 인증 필요: Org CRUD ───────────────────────────────────────────
    '/orgs': {
      get: {
        operationId: 'listOrgs',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                examples: {
                  default: {
                    dataValue: [
                      { id: '11111111-1111-1111-1111-111111111111', name: 'Acme Corp', plan: 'pro' },
                    ],
                  },
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['code', 'message'],
                  properties: {
                    code: { const: 'UNAUTHORIZED' },
                    message: { type: 'string' },
                  },
                  unevaluatedProperties: false,
                },
                example: { code: 'UNAUTHORIZED', message: 'Authentication required' },
              },
            },
          },
        },
      },
    },
    '/orgs/{orgId}': {
      parameters: [
        { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      get: {
        operationId: 'getOrg',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                examples: {
                  default: {
                    dataValue: { id: '11111111-1111-1111-1111-111111111111', name: 'Acme Corp', plan: 'pro' },
                  },
                },
              },
            },
          },
        },
      },
    },

    // ─── 중첩 리소스: Org > Project ──────────────────────────────────────
    '/orgs/{orgId}/projects': {
      parameters: [
        { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      get: {
        operationId: 'listProjects',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'archived'] } },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                examples: {
                  default: {
                    dataValue: {
                      items: [{ id: 1, name: 'Alpha', orgId: '11111111-1111-1111-1111-111111111111', status: 'active' }],
                      total: 1,
                      page: 1,
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createProject',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateProject' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created',
            headers: {
              Location: { schema: { type: 'string' }, example: '/orgs/11111111/projects/42' },
            },
            content: {
              'application/json': {
                examples: {
                  default: {
                    dataValue: { id: 42, name: 'New Project', orgId: '11111111-1111-1111-1111-111111111111', status: 'active' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/orgs/{orgId}/projects/{projectId}': {
      parameters: [
        { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'projectId', in: 'path', required: true, schema: { type: 'integer' } },
      ],
      get: {
        operationId: 'getProject',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                examples: {
                  default: {
                    dataValue: { id: 1, name: 'Alpha', orgId: '11111111-1111-1111-1111-111111111111', status: 'active' },
                  },
                },
              },
            },
          },
        },
      },
      delete: {
        operationId: 'deleteProject',
        security: [{ bearerAuth: [] }],
        responses: { '204': { description: 'Deleted' } },
      },
    },

    // ─── OR 시큐리티: apiKey OR bearer ──────────────────────────────────
    '/orgs/{orgId}/webhooks': {
      parameters: [
        { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      get: {
        operationId: 'listWebhooks',
        security: [{ bearerAuth: [] }, { apiKey: [] }],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                examples: { default: { dataValue: [] } },
              },
            },
          },
        },
      },
    },

    // ─── SSE 스트리밍 ─────────────────────────────────────────────────────
    '/orgs/{orgId}/events': {
      parameters: [
        { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      get: {
        operationId: 'streamOrgEvents',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'SSE events',
            content: {
              'text/event-stream': {
                schema: { $ref: '#/components/schemas/EventPayload' },
              },
            },
          },
        },
      },
    },
  },
}

const AUTH = { authorization: 'Bearer test-token' }
const APIKEY = { 'X-API-Key': 'my-key' }
const UUID = '11111111-1111-1111-1111-111111111111'

// ═══════════════════════════════════════════════════════════════════════════
// Node HTTP 어댑터 — createTestClient + createCoverageTracker 통합
// ═══════════════════════════════════════════════════════════════════════════

describe('Framework Integration — Node HTTP', () => {
  let server: NodeMockServer
  let client: TestClient
  const tracker = createCoverageTracker()

  beforeAll(async () => {
    server = createNodeMockServer(apiSpec, { port: 0 })
    await server.start()
    client = createTestClient(server)
  })

  afterAll(async () => {
    await server.stop()
  })

  // ─── Health Check (인증 불필요) ─────────────────────────────────────────

  it('GET /health — 인증 없이 접근 가능', async () => {
    const res = await client.get('/health')
    expect(res.status).toBe(200)
    expect(res.json).toEqual({ status: 'ok', uptime: 12345 })
  })

  // ─── 인증 검증 ─────────────────────────────────────────────────────────

  it('GET /orgs — bearer 토큰 없으면 문서화된 401 Error', async () => {
    const res = await client.get('/orgs')
    expect(res.status).toBe(401)
    expect(res.json).toEqual({ code: 'UNAUTHORIZED', message: 'Authentication required' })
  })

  it('GET /orgs — bearer 토큰 있으면 200', async () => {
    const res = await client.get('/orgs', { headers: AUTH })
    expect(res.status).toBe(200)
    const body = res.json as any[]
    expect(body[0].name).toBe('Acme Corp')
  })

  // ─── 쿼리 파라미터 검증 ─────────────────────────────────────────────────

  it('GET /orgs?limit=0 — minimum 위반 → 422', async () => {
    const res = await client.get('/orgs', { headers: AUTH, query: { limit: 0 } })
    expect(res.status).toBe(422)
    const body = res.json as any
    expect(body.error.details[0].code).toBe('CONSTRAINT_VIOLATION')
  })

  it('GET /orgs?limit=50 — valid → 200', async () => {
    const res = await client.get('/orgs', { headers: AUTH, query: { limit: 50 } })
    expect(res.status).toBe(200)
  })

  // ─── 중첩 리소스 라우팅 ─────────────────────────────────────────────────

  it('GET /orgs/{orgId} — path param 정상 추출', async () => {
    const res = await client.get(`/orgs/${UUID}`, { headers: AUTH })
    expect(res.status).toBe(200)
    const body = res.json as any
    expect(body.id).toBe(UUID)
  })

  it('GET /orgs/{orgId}/projects — 중첩 리소스 접근', async () => {
    const res = await client.get(`/orgs/${UUID}/projects`, { headers: AUTH })
    expect(res.status).toBe(200)
    const body = res.json as any
    expect(body.items).toHaveLength(1)
    expect(body.total).toBe(1)
    expect(body.page).toBe(1)
  })

  it('GET /orgs/{orgId}/projects?status=unknown — enum 위반 → 422', async () => {
    const res = await client.get(`/orgs/${UUID}/projects?status=unknown`, { headers: AUTH })
    expect(res.status).toBe(422)
    const body = res.json as any
    expect(body.error.details[0].code).toBe('INVALID_ENUM_VALUE')
  })

  it('GET /orgs/{orgId}/projects?status=active — valid enum → 200', async () => {
    const res = await client.get(`/orgs/${UUID}/projects?status=active`, { headers: AUTH })
    expect(res.status).toBe(200)
  })

  it('GET /orgs/{orgId}/projects/{projectId} — 2단계 path param', async () => {
    const res = await client.get(`/orgs/${UUID}/projects/1`, { headers: AUTH })
    expect(res.status).toBe(200)
    const body = res.json as any
    expect(body.id).toBe(1)
    expect(body.name).toBe('Alpha')
  })

  // ─── POST + $ref requestBody 검증 ───────────────────────────────────

  it('POST /orgs/{orgId}/projects — valid body → 201 + Location 헤더', async () => {
    const res = await client.post(
      `/orgs/${UUID}/projects`,
      { name: 'New Project' },
      { headers: AUTH },
    )
    expect(res.status).toBe(201)
    expect(res.headers['location']).toBe('/orgs/11111111/projects/42')
    const body = res.json as any
    expect(body.id).toBe(42)
  })

  it('POST /orgs/{orgId}/projects — name 누락 → 422 MISSING_REQUIRED_FIELD', async () => {
    const res = await client.post(
      `/orgs/${UUID}/projects`,
      { description: 'no name' },
      { headers: AUTH },
    )
    expect(res.status).toBe(422)
    const body = res.json as any
    expect(body.error.details[0].code).toBe('MISSING_REQUIRED_FIELD')
    expect(body.error.details[0].path).toBe('/body/name')
  })

  it('POST /orgs/{orgId}/projects — name 빈 문자열 → 422 CONSTRAINT_VIOLATION (minLength)', async () => {
    const res = await client.post(
      `/orgs/${UUID}/projects`,
      { name: '' },
      { headers: AUTH },
    )
    expect(res.status).toBe(422)
    const body = res.json as any
    expect(body.error.details[0].code).toBe('CONSTRAINT_VIOLATION')
  })

  it('POST /orgs/{orgId}/projects — name 200자 초과 → 422 CONSTRAINT_VIOLATION (maxLength)', async () => {
    const res = await client.post(
      `/orgs/${UUID}/projects`,
      { name: 'x'.repeat(201) },
      { headers: AUTH },
    )
    expect(res.status).toBe(422)
    const body = res.json as any
    expect(body.error.details[0].code).toBe('CONSTRAINT_VIOLATION')
  })

  // ─── DELETE ──────────────────────────────────────────────────────────

  it('DELETE /orgs/{orgId}/projects/{projectId} → 204', async () => {
    const res = await client.delete(`/orgs/${UUID}/projects/1`, { headers: AUTH })
    expect(res.status).toBe(204)
  })

  // ─── OR 시큐리티 ───────────────────────────────────────────────────────

  it('GET /orgs/{orgId}/webhooks — bearer 토큰으로 접근 → 200', async () => {
    const res = await client.get(`/orgs/${UUID}/webhooks`, { headers: AUTH })
    expect(res.status).toBe(200)
  })

  it('GET /orgs/{orgId}/webhooks — API Key로 접근 → 200', async () => {
    const res = await client.get(`/orgs/${UUID}/webhooks`, { headers: APIKEY })
    expect(res.status).toBe(200)
  })

  it('GET /orgs/{orgId}/webhooks — 인증 없음 → 401', async () => {
    const res = await client.get(`/orgs/${UUID}/webhooks`)
    expect(res.status).toBe(401)
  })

  // ─── 404 / 405 ─────────────────────────────────────────────────────────

  it('GET /nonexistent → 404', async () => {
    const res = await client.get('/nonexistent')
    expect(res.status).toBe(404)
    const body = res.json as any
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('PUT /health → 405 + Allow 헤더', async () => {
    const res = await client.put('/health', {})
    expect(res.status).toBe(405)
    expect(res.headers['allow']?.toUpperCase()).toContain('GET')
  })

  // ─── SSE 스트리밍 ──────────────────────────────────────────────────────

  it('GET /orgs/{orgId}/events — SSE 스트림 (인증 + 중첩 path)', async () => {
    const res = await fetch(`${server.url}/orgs/${UUID}/events`, { headers: AUTH })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const text = await res.text()
    const lines = text.split('\n\n').filter(Boolean)
    // Three schema events; closing the response terminates native SSE.
    expect(lines).toHaveLength(3)
    expect(text).not.toContain('[DONE]')
    const ev = JSON.parse(lines[0]!.replace('data: ', ''))
    expect(ev.event).toBe('created') // enum 첫 번째 값
    expect(ev).toHaveProperty('data')
  })

  it('GET /orgs/{orgId}/events — 인증 없으면 401', async () => {
    const res = await fetch(`${server.url}/orgs/${UUID}/events`)
    expect(res.status).toBe(401)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// MSW 어댑터 — 동일 스펙, 동일 시나리오로 패리티 검증
// ═══════════════════════════════════════════════════════════════════════════

describe('Framework Integration — MSW', () => {
  const BASE = 'http://localhost'
  let mswServer: SetupServer

  beforeAll(() => {
    mswServer = setupServer(...createMswHandlers(apiSpec))
    mswServer.listen({ onUnhandledRequest: 'bypass' })
  })

  afterEach(() => mswServer.resetHandlers())
  afterAll(() => mswServer.close())

  it('GET /health — 200', async () => {
    const res = await fetch(`${BASE}/health`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ status: 'ok', uptime: 12345 })
  })

  it('GET /orgs — 인증 없음 → 401', async () => {
    const res = await fetch(`${BASE}/orgs`)
    expect(res.status).toBe(401)
  })

  it('GET /orgs — 인증 있음 → 200', async () => {
    const res = await fetch(`${BASE}/orgs`, { headers: AUTH })
    expect(res.status).toBe(200)
  })

  it('중첩 리소스: GET /orgs/{orgId}/projects → 200', async () => {
    const res = await fetch(`${BASE}/orgs/${UUID}/projects`, { headers: AUTH })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.items).toHaveLength(1)
  })

  it('POST /orgs/{orgId}/projects — $ref body 검증 + 201', async () => {
    const res = await fetch(`${BASE}/orgs/${UUID}/projects`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'MSW Project' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.id).toBe(42)
    expect(res.headers.get('location')).toBe('/orgs/11111111/projects/42')
  })

  it('POST /orgs/{orgId}/projects — invalid → 422', async () => {
    const res = await fetch(`${BASE}/orgs/${UUID}/projects`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(422)
  })

  it('2단계 path param: GET /orgs/{orgId}/projects/{projectId} → 200', async () => {
    const res = await fetch(`${BASE}/orgs/${UUID}/projects/1`, { headers: AUTH })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.id).toBe(1)
  })

  it('OR 시큐리티: API Key → 200', async () => {
    const res = await fetch(`${BASE}/orgs/${UUID}/webhooks`, { headers: APIKEY })
    expect(res.status).toBe(200)
  })

  it('SSE 스트리밍: 인증 + 중첩 path → text/event-stream', async () => {
    const res = await fetch(`${BASE}/orgs/${UUID}/events`, { headers: AUTH })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await res.text()
    expect(text).toContain('data: ')
    expect(text).not.toContain('[DONE]')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Coverage Tracker — 실제 서버 연동 검증
// ═══════════════════════════════════════════════════════════════════════════

describe('Framework Integration — Coverage Tracker with MSW', () => {
  const tracker = createCoverageTracker()
  const BASE = 'http://localhost'
  let mswServer: SetupServer

  const ALL_OPS = [
    'healthCheck', 'listOrgs', 'getOrg',
    'listProjects', 'createProject', 'getProject', 'deleteProject',
    'listWebhooks', 'streamOrgEvents',
  ]

  beforeAll(() => {
    mswServer = setupServer(...createMswHandlers(apiSpec, { onRequest: tracker.onRequest }))
    mswServer.listen({ onUnhandledRequest: 'bypass' })
  })

  afterAll(() => mswServer.close())

  it('초기 상태: coverage 0', () => {
    expect(tracker.coverage(ALL_OPS)).toBe(0)
    expect(tracker.uncalled(ALL_OPS)).toEqual(ALL_OPS)
  })

  it('몇 개 호출 후 coverage 업데이트', async () => {
    await fetch(`${BASE}/health`)
    await fetch(`${BASE}/orgs`, { headers: AUTH })
    await fetch(`${BASE}/orgs/${UUID}`, { headers: AUTH })

    expect(tracker.called.has('healthCheck')).toBe(true)
    expect(tracker.called.has('listOrgs')).toBe(true)
    expect(tracker.called.has('getOrg')).toBe(true)
    expect(tracker.coverage(ALL_OPS)).toBeCloseTo(3 / 9)
  })

  it('나머지 전부 호출 → coverage 100%', async () => {
    await fetch(`${BASE}/orgs/${UUID}/projects`, { headers: AUTH })
    await fetch(`${BASE}/orgs/${UUID}/projects`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test' }),
    })
    await fetch(`${BASE}/orgs/${UUID}/projects/1`, { headers: AUTH })
    await fetch(`${BASE}/orgs/${UUID}/projects/1`, { method: 'DELETE', headers: AUTH })
    await fetch(`${BASE}/orgs/${UUID}/webhooks`, { headers: AUTH })
    await fetch(`${BASE}/orgs/${UUID}/events`, { headers: AUTH })

    expect(tracker.coverage(ALL_OPS)).toBe(1)
    expect(tracker.uncalled(ALL_OPS)).toEqual([])
  })

  it('reset 후 다시 0', () => {
    tracker.reset()
    expect(tracker.coverage(ALL_OPS)).toBe(0)
  })
})
