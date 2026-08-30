import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createNodeMockServer, type NodeMockServer } from '../../adapters/node-http.js'
import type { OasDocument } from '@oa-sdk/parser'
import { createWebhookSpec } from '../fixtures/specs.js'

// ─── $ref 사용 스펙 (deref 검증용) ───────────────────────────────────────────

const refSpec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Ref Test', version: '0.0.0' },
  components: {
    schemas: {
      User: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
        },
      },
      CreateUserRequest: {
        type: 'object',
        required: ['email', 'name'],
        properties: {
          email: { type: 'string', format: 'email' },
          name: { type: 'string', minLength: 1 },
        },
      },
    },
  },
  paths: {
    '/ref-users': {
      post: {
        operationId: 'refCreateUser',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateUserRequest' },
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
  },
}

describe('$ref 인라인 전개 — 통합 테스트', () => {
  let server: NodeMockServer

  beforeAll(async () => {
    server = createNodeMockServer(refSpec, { port: 0 })
    await server.start()
  })

  afterAll(async () => { await server.stop() })

  it('$ref 스키마 requestBody 검증 — valid', async () => {
    const res = await fetch(`${server.url}/ref-users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', name: 'Alice' }),
    })
    expect(res.status).toBe(201)
  })

  it('$ref 스키마 requestBody 검증 — missing required → 422', async () => {
    const res = await fetch(`${server.url}/ref-users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com' }), // name 누락
    })
    expect(res.status).toBe(422)
    const body = await res.json() as Record<string, any>
    expect(body.error.details[0].code).toBe('MISSING_REQUIRED_FIELD')
    expect(body.error.details[0].path).toBe('/body/name')
  })

  it('$ref 스키마 requestBody 검증 — format mismatch → 422', async () => {
    const res = await fetch(`${server.url}/ref-users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-email', name: 'Alice' }),
    })
    expect(res.status).toBe(422)
    const body = await res.json() as Record<string, any>
    expect(body.error.details[0].code).toBe('FORMAT_MISMATCH')
  })

  it('$ref response schema → generateMinimal로 uuid/string 생성', async () => {
    const res = await fetch(`${server.url}/ref-users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', name: 'Alice' }),
    })
    const body = await res.json() as Record<string, any>
    // User schema required: ['id', 'name'] → generateMinimal이 id, name 생성
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('name')
    expect(body.id).toBe('00000000-0000-0000-0000-000000000000')
  })
})

const deepObjectSpec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Deep Object Query Test', version: '0.0.0' },
  paths: {
    '/search': {
      get: {
        operationId: 'searchByFilter',
        parameters: [{
          name: 'filter',
          in: 'query',
          required: true,
          style: 'deepObject',
          explode: true,
          schema: {
            type: 'object',
            required: ['name', 'tags'],
            properties: {
              name: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: false,
          },
        }],
        responses: { '204': { description: 'No Content' } },
      },
    },
  },
}

describe('createNodeMockServer — deepObject query parameter', () => {
  let server: NodeMockServer

  beforeAll(async () => {
    server = createNodeMockServer(deepObjectSpec, { port: 0 })
    await server.start()
  })

  afterAll(async () => { await server.stop() })

  it('deepObject와 반복 값을 object parameter로 검증하고 관련 없는 query key를 무시한다', async () => {
    const response = await fetch(
      `${server.url}/search?filter%5Bname%5D=alice&filter%5Btags%5D=alpha&filter%5Btags%5D=beta&unrelated=preserved`,
    )
    expect(response.status).toBe(204)
  })
})

const querystringSpec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Querystring Test', version: '0.0.0' },
  paths: {
    '/querystring-search': {
      get: {
        operationId: 'querystringSearch',
        parameters: [{
          name: 'query',
          in: 'querystring',
          required: true,
          content: {
            'application/x-www-form-urlencoded': {
              schema: {
                type: 'object',
                required: ['q', 'tags'],
                properties: {
                  q: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        }],
        responses: { '204': { description: 'No Content' } },
      },
    },
  },
}

describe('createNodeMockServer — querystring parameter', () => {
  let server: NodeMockServer

  beforeAll(async () => {
    server = createNodeMockServer(querystringSpec, { port: 0 })
    await server.start()
  })

  afterAll(async () => { await server.stop() })

  it('raw serialized form query string을 content schema에 맞게 검증한다', async () => {
    const response = await fetch(`${server.url}/querystring-search?q=alice&tags=alpha&tags=beta`)
    expect(response.status).toBe(204)
  })
})

// ─── 기존 인라인 스펙 ─────────────────────────────────────────────────────────

const spec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Test', version: '0.0.0' },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                examples: { default: { dataValue: { items: [], total: 0 } } },
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
              schema: {
                type: 'object',
                required: ['email', 'name'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  name: { type: 'string', minLength: 1 },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created',
            content: {
              'application/json': {
                examples: {
                  default: { dataValue: { id: 'abc', email: 'new@example.com', name: 'New' } },
                },
              },
            },
          },
        },
      },
    },
    '/users/{id}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      get: {
        operationId: 'getUserById',
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                examples: {
                  default: {
                    dataValue: { id: '123e4567-e89b-12d3-a456-426614174000', name: 'Test' },
                  },
                },
              },
            },
          },
        },
      },
      delete: {
        operationId: 'deleteUser',
        responses: { '204': { description: 'No Content' } },
      },
    },
    '/no-content': {
      get: {
        operationId: 'noContent',
        responses: { '204': { description: 'No Content' } },
      },
    },
    '/default-only': {
      get: {
        operationId: 'defaultOnly',
        responses: {
          default: {
            description: 'Default',
            content: { 'application/json': { example: { fallback: true } } },
          },
        },
      },
    },
    '/form': {
      post: {
        operationId: 'submitForm',
        requestBody: {
          required: true,
          content: {
            'application/x-www-form-urlencoded': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', minLength: 1 },
                  age: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { example: { ok: true } } },
          },
        },
      },
    },
    '/echo-text': {
      post: {
        operationId: 'echoText',
        requestBody: {
          required: true,
          content: { 'text/plain': { schema: { type: 'string' } } },
        },
        responses: {
          '200': {
            description: 'OK',
            content: { 'text/plain': { example: 'pong' } },
          },
        },
      },
    },
    '/events': {
      get: {
        operationId: 'streamEvents',
        responses: {
          '200': {
            description: 'SSE stream',
            content: {
              'text/event-stream': {
                schema: {
                  type: 'object',
                  required: ['id', 'type'],
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    type: { type: 'string', enum: ['update'] },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/ndjson': {
      get: {
        operationId: 'streamNdjson',
        responses: {
          '200': {
            description: 'NDJSON stream',
            content: {
              'application/x-ndjson': {
                schema: {
                  type: 'object',
                  required: ['val'],
                  properties: { val: { type: 'integer', minimum: 1 } },
                },
              },
            },
          },
        },
      },
    },
    '/events-example': {
      get: {
        operationId: 'streamEventsExample',
        responses: {
          '200': {
            description: 'SSE stream (example)',
            content: {
              'text/event-stream': {
                examples: {
                  item: { dataValue: { id: 'fixed-id', type: 'ping' } },
                },
              },
            },
          },
        },
      },
    },
  },
}

describe('createNodeMockServer — 통합 테스트', () => {
  let server: NodeMockServer

  beforeAll(async () => {
    server = createNodeMockServer(spec, { port: 0 })
    await server.start()
  })

  afterAll(async () => {
    await server.stop()
  })

  // ─── 정상 응답 ─────────────────────────────────────────────────────────────

  it('GET /users → 200 + OAS 3.2 dataValue 응답', async () => {
    const res = await fetch(`${server.url}/users`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = await res.json()
    expect(body).toEqual({ items: [], total: 0 })
  })

  it('POST /users valid body → 201 + dataValue 응답', async () => {
    const res = await fetch(`${server.url}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.com', name: 'New User' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('email')
  })

  it('GET /users/{id} → 200 + path param 추출', async () => {
    const res = await fetch(`${server.url}/users/123e4567-e89b-12d3-a456-426614174000`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('id')
  })

  it('DELETE /users/{id} → 204 (본문 없음)', async () => {
    const res = await fetch(`${server.url}/users/123e4567-e89b-12d3-a456-426614174000`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(204)
  })

  it('GET /no-content → 204', async () => {
    const res = await fetch(`${server.url}/no-content`)
    expect(res.status).toBe(204)
  })

  it('GET /default-only → 200 (default 응답)', async () => {
    const res = await fetch(`${server.url}/default-only`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ fallback: true })
  })

  // ─── 검증 실패 ─────────────────────────────────────────────────────────────

  it('POST /users missing required field → 422 + MISSING_REQUIRED_FIELD', async () => {
    const res = await fetch(`${server.url}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'only@example.com' }), // name 누락
    })
    expect(res.status).toBe(422)
    const body = await res.json() as Record<string, any>
    expect(body.error.details[0].code).toBe('MISSING_REQUIRED_FIELD')
    expect(body.error.details[0].path).toBe('/body/name')
  })

  it('POST /users invalid email format → 422 + FORMAT_MISMATCH', async () => {
    const res = await fetch(`${server.url}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', name: 'Test' }),
    })
    expect(res.status).toBe(422)
    const body = await res.json() as Record<string, any>
    const emailErr = body.error.details.find((e: { path: string }) => e.path === '/body/email')
    expect(emailErr?.code).toBe('FORMAT_MISMATCH')
  })

  it('POST /users no body → 422 + MISSING_REQUIRED_FIELD only (no PROTOCOL_MISMATCH)', async () => {
    const res = await fetch(`${server.url}/users`, {
      method: 'POST',
    })
    expect(res.status).toBe(422)
    const body = await res.json() as Record<string, any>
    const codes = body.error.details.map((e: { code: string }) => e.code)
    expect(codes).toContain('MISSING_REQUIRED_FIELD')
    expect(codes).not.toContain('PROTOCOL_MISMATCH')
  })

  it('GET /users?page=0 → 422 + CONSTRAINT_VIOLATION', async () => {
    const res = await fetch(`${server.url}/users?page=0`)
    expect(res.status).toBe(422)
    const body = await res.json() as Record<string, any>
    expect(body.error.details[0].code).toBe('CONSTRAINT_VIOLATION')
  })

  it('POST /users wrong content-type → 422 + PROTOCOL_MISMATCH', async () => {
    const res = await fetch(`${server.url}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not json',
    })
    expect(res.status).toBe(422)
    const body = await res.json() as Record<string, any>
    expect(body.error.details.some((e: any) => e.code === 'PROTOCOL_MISMATCH')).toBe(true)
  })

  // ─── HTTP 메서드 관련 ──────────────────────────────────────────────────────

  it('PATCH /users/{id} (미정의 메서드) → 405 + Allow 헤더', async () => {
    const res = await fetch(`${server.url}/users/123e4567-e89b-12d3-a456-426614174000`, {
      method: 'PATCH',
    })
    expect(res.status).toBe(405)
    const allow = res.headers.get('Allow') ?? ''
    expect(allow.toUpperCase()).toContain('GET')
    expect(allow.toUpperCase()).toContain('DELETE')
  })

  it('GET /unknown → 404', async () => {
    const res = await fetch(`${server.url}/unknown`)
    expect(res.status).toBe(404)
    const body = await res.json() as Record<string, any>
    expect(body.error.code).toBe('NOT_FOUND')
  })

  // ─── 라이프사이클 ──────────────────────────────────────────────────────────

  it('port: 0 → 실제 바인딩된 포트로 url이 설정된다', () => {
    const url = new URL(server.url)
    const port = parseInt(url.port, 10)
    expect(port).toBeGreaterThan(0)
    expect(port).toBeLessThanOrEqual(65535)
  })

  // ─── Content-Type 별 body 파싱 ────────────────────────────────────────────

  it('POST /form application/x-www-form-urlencoded → valid', async () => {
    const res = await fetch(`${server.url}/form`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: 'Alice', age: '30' }),
    })
    expect(res.status).toBe(200)
  })

  it('POST /form urlencoded required 필드 누락 → 422', async () => {
    const res = await fetch(`${server.url}/form`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ age: '30' }), // name 누락
    })
    expect(res.status).toBe(422)
    const body = await res.json() as Record<string, any>
    expect(body.error.details[0].code).toBe('MISSING_REQUIRED_FIELD')
    expect(body.error.details[0].path).toBe('/body/name')
  })

  it('POST /echo-text text/plain body → 200', async () => {
    const res = await fetch(`${server.url}/echo-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'hello world',
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
  })

  // ─── SSE 스트리밍 ──────────────────────────────────────────────────────────

  it('GET /events (schema only) → text/event-stream, SSE 형식', async () => {
    const res = await fetch(`${server.url}/events`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const text = await res.text()
    // data: <json>\n\n 형식 확인
    expect(text).toMatch(/^data: /)
    expect(text).toContain('\n\n')
    // 이벤트 파싱
    const lines = text.split('\n\n').filter(Boolean)
    const events = lines.map(line => JSON.parse(line.replace(/^data: /, '')))
    // Schema-defined events only; HTTP close terminates the stream.
    expect(events).toHaveLength(3)
    // 스키마 기반 생성 확인
    const ev = events[0] as Record<string, unknown>
    expect(ev).toHaveProperty('id')
    expect(ev).toHaveProperty('type', 'update')
  })

  it('GET /events-example (dataValue) → SSE에 example body 반환', async () => {
    const res = await fetch(`${server.url}/events-example`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await res.text()
    // example body는 단일 이벤트만 전송 ([DONE] 없음)
    const events = text.split('\n\n').filter(Boolean)
    expect(events).toHaveLength(1)
    const data = JSON.parse(events[0]!.replace('data: ', ''))
    expect(data).toEqual({ id: 'fixed-id', type: 'ping' })
  })

  it('GET /ndjson → application/x-ndjson, bare JSON lines (data: prefix 없음)', async () => {
    const res = await fetch(`${server.url}/ndjson`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/x-ndjson')

    const text = await res.text()
    expect(text).not.toContain('data: ')
    expect(text).not.toContain('[DONE]')

    const lines = text.split('\n').filter(Boolean)
    expect(lines).toHaveLength(3) // includeTerminator: false → 3 events only
    for (const line of lines) {
      const obj = JSON.parse(line) as Record<string, unknown>
      expect(typeof obj.val).toBe('number')
      expect(obj.val as number).toBeGreaterThanOrEqual(1) // minimum: 1 제약 확인
    }
  })

  // ─── 라이프사이클 ──────────────────────────────────────────────────────────

  it('start/stop 라이프사이클이 정상 동작한다', async () => {
    const s = createNodeMockServer(spec, { port: 0 })
    await s.start()
    const res = await fetch(`${s.url}/users`)
    expect(res.ok).toBe(true)
    await s.stop()
    await expect(fetch(`${s.url}/users`)).rejects.toThrow()
  })
})

// ─── 웹훅 통합 테스트 ────────────────────────────────────────────────────────

const webhookSpec = createWebhookSpec()

describe('createNodeMockServer — webhooks', () => {
  let webhookServer: NodeMockServer

  beforeAll(async () => {
    webhookServer = createNodeMockServer(webhookSpec, { port: 0 })
    await webhookServer.start()
  })

  afterAll(async () => { await webhookServer.stop() })

  it('GET /orders still works with webhook spec', async () => {
    const res = await fetch(`${webhookServer.url}/orders`)
    expect(res.status).toBe(200)
  })

  it('POST /webhooks/orderCreated — valid webhook payload → 200', async () => {
    const res = await fetch(`${webhookServer.url}/webhooks/orderCreated`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: 'ord-123' }),
    })
    expect(res.status).toBe(200)
  })

  it('POST /webhooks/orderCreated — missing required field → 422', async () => {
    const res = await fetch(`${webhookServer.url}/webhooks/orderCreated`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(422)
    const body = await res.json() as Record<string, any>
    expect(body.error.details[0].code).toBe('MISSING_REQUIRED_FIELD')
    expect(body.error.details[0].path).toBe('/body/orderId')
  })

  it('GET /webhooks/orderCreated — method not allowed → 405', async () => {
    const res = await fetch(`${webhookServer.url}/webhooks/orderCreated`)
    expect(res.status).toBe(405)
  })
})
