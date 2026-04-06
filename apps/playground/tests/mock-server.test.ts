/**
 * Mock Server 통합 테스트
 *
 * createNodeMockServer를 실제로 기동하여 HTTP 요청/응답 전체 흐름을 검증합니다.
 * 외부 빌드 결과물에 의존하지 않도록 인라인 스펙을 사용합니다.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createNodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
import type { NodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'

// 테스트용 인라인 OpenAPI 3.1 스펙
const spec = {
  openapi: '3.2.0',
  info: { title: 'Playground Test', version: '1.0.0' },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        tags: ['users'],
        responses: {
          '200': {
            description: 'List of users',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      name: { type: 'string' },
                    },
                    required: ['id', 'name'],
                  },
                },
                examples: {
                  default: {
                    value: [
                      { id: '123e4567-e89b-12d3-a456-426614174000', name: 'Alice' },
                    ],
                  },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createUser',
        tags: ['users'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', minLength: 1, maxLength: 50 },
                  email: { type: 'string', format: 'email' },
                },
                required: ['name', 'email'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    name: { type: 'string' },
                    email: { type: 'string' },
                  },
                },
                examples: {
                  default: {
                    value: {
                      id: '123e4567-e89b-12d3-a456-426614174000',
                      name: 'Alice',
                      email: 'alice@example.com',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        tags: ['users'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'A user',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    name: { type: 'string' },
                  },
                  required: ['id', 'name'],
                },
                examples: {
                  default: {
                    value: { id: '123e4567-e89b-12d3-a456-426614174000', name: 'Alice' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/items': {
      get: {
        operationId: 'listItems',
        tags: ['items'],
        parameters: [
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 100 },
          },
          {
            name: 'page',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1 },
          },
        ],
        responses: {
          '200': {
            description: 'Item list',
            content: {
              'application/json': {
                schema: { type: 'array', items: { type: 'object' } },
                examples: {
                  default: { value: [] },
                },
              },
            },
          },
        },
      },
    },
  },
} as const

let server: NodeMockServer

beforeAll(async () => {
  // port: 0 → OS가 빈 포트 자동 할당
  server = createNodeMockServer(spec as unknown as Parameters<typeof createNodeMockServer>[0], { port: 0 })
  await server.start()
})

afterAll(async () => {
  await server.stop()
})

describe('GET /users', () => {
  it('200 응답과 예시 데이터 반환', async () => {
    const res = await fetch(`${server.url}/users`)
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
    expect(body[0]).toMatchObject({ id: expect.any(String), name: expect.any(String) })
  })
})

describe('POST /users', () => {
  it('유효한 요청 → 201', async () => {
    const res = await fetch(`${server.url}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bob', email: 'bob@example.com' }),
    })
    expect(res.status).toBe(201)
  })

  it('required 필드 누락 → 422', async () => {
    const res = await fetch(`${server.url}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bob' }),
    })
    expect(res.status).toBe(422)
    const body = await res.json() as { error: { details: unknown[] } }
    expect(body.error.details.length).toBeGreaterThan(0)
  })

  it('name이 빈 문자열(minLength 위반) → 422', async () => {
    const res = await fetch(`${server.url}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', email: 'bob@example.com' }),
    })
    expect(res.status).toBe(422)
  })

  it('name이 50자 초과(maxLength 위반) → 422', async () => {
    const res = await fetch(`${server.url}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'a'.repeat(51), email: 'bob@example.com' }),
    })
    expect(res.status).toBe(422)
  })

  it('Content-Type 없이 body 전송 → 422 또는 처리', async () => {
    const res = await fetch(`${server.url}/users`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Bob', email: 'bob@example.com' }),
    })
    // Content-Type 미지정 시 body 파싱 불가 → required field 오류
    expect([400, 422]).toContain(res.status)
  })
})

describe('GET /users/:id', () => {
  it('유효한 UUID → 200', async () => {
    const res = await fetch(`${server.url}/users/123e4567-e89b-12d3-a456-426614174000`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ id: expect.any(String), name: expect.any(String) })
  })

  it('UUID 형식 아닌 경로 파라미터 → 422', async () => {
    const res = await fetch(`${server.url}/users/not-a-valid-uuid`)
    expect(res.status).toBe(422)
  })
})

describe('GET /items (쿼리 파라미터 검증)', () => {
  it('파라미터 없이 요청 → 200', async () => {
    const res = await fetch(`${server.url}/items`)
    expect(res.status).toBe(200)
  })

  it('유효한 limit/page → 200', async () => {
    const res = await fetch(`${server.url}/items?limit=10&page=1`)
    expect(res.status).toBe(200)
  })

  it('limit 범위 초과(> 100) → 422', async () => {
    const res = await fetch(`${server.url}/items?limit=101`)
    expect(res.status).toBe(422)
  })

  it('limit 범위 미만(< 1) → 422', async () => {
    const res = await fetch(`${server.url}/items?limit=0`)
    expect(res.status).toBe(422)
  })
})

describe('라우팅 에러 처리', () => {
  it('존재하지 않는 경로 → 404', async () => {
    const res = await fetch(`${server.url}/nonexistent`)
    expect(res.status).toBe(404)
  })

  it('허용되지 않는 HTTP 메서드 → 405', async () => {
    const res = await fetch(`${server.url}/users/123e4567-e89b-12d3-a456-426614174000`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(405)
  })
})
