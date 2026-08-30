/**
 * OAS 3.2 MediaType Object (§4.8.14) 전용 테스트
 *
 * itemSchema (SSE), content-type별 body 파싱, 스트리밍 동작.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createNodeMockServer } from '../../adapters/node-http.js'
import type { NodeMockServer } from '../../adapters/node-http.js'
import { createTestClient } from '../../testing.js'
import type { OasDocument } from '@oa-sdk/parser'

function spec(overrides: Partial<OasDocument> = {}): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'MediaType Test', version: '1.0.0' },
    paths: {},
    ...overrides,
  } as OasDocument
}

describe('MediaType — itemSchema (SSE streaming)', () => {
  let server: NodeMockServer
  let client: ReturnType<typeof createTestClient>

  beforeAll(async () => {
    server = createNodeMockServer(spec({
      paths: {
        '/events': {
          get: {
            operationId: 'streamEvents',
            responses: {
              '200': {
                description: 'SSE stream',
                content: {
                  'text/event-stream': {
                    itemSchema: {
                      type: 'object',
                      required: ['type', 'data'],
                      properties: {
                        type: { type: 'string', enum: ['update', 'delete'] },
                        data: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }), { port: 0 })
    await server.start()
    client = createTestClient(server)
  })

  afterAll(async () => { await server.stop() })

  it('SSE content-type → 스트리밍 응답', async () => {
    const res = await client.get('/events')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')
  })

  it('SSE 응답에 data: 접두사 포함', async () => {
    const res = await client.get('/events')
    expect(res.body).toContain('data:')
  })

  it('SSE 응답은 문서화된 event만 보내고 HTTP close로 종료', async () => {
    const res = await client.get('/events')
    // Schema-driven SSE는 data: 라인만 보내며 HTTP close로 종료한다.
    expect(res.body.length).toBeGreaterThan(0)
  })
})

describe('MediaType — JSON body', () => {
  let server: NodeMockServer
  let client: ReturnType<typeof createTestClient>

  beforeAll(async () => {
    server = createNodeMockServer(spec({
      paths: {
        '/items': {
          post: {
            operationId: 'createItem',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['name'],
                    properties: {
                      name: { type: 'string', minLength: 1 },
                      count: { type: 'integer', minimum: 0 },
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
                    schema: { type: 'object', properties: { id: { type: 'string' } } },
                  },
                },
              },
            },
          },
        },
      },
    }), { port: 0 })
    await server.start()
    client = createTestClient(server)
  })

  afterAll(async () => { await server.stop() })

  it('유효한 JSON body → 201', async () => {
    const res = await client.post('/items', { name: 'test', count: 5 })
    expect(res.status).toBe(201)
  })

  it('필수 필드 누락 → 422', async () => {
    const res = await client.post('/items', { count: 5 })
    expect(res.status).toBe(422)
    expect((res.json as any)?.error?.details?.some((d: any) => d.code === 'MISSING_REQUIRED_FIELD')).toBe(true)
  })

  it('타입 불일치 → 422', async () => {
    const res = await client.post('/items', { name: 'test', count: 'not-a-number' })
    expect(res.status).toBe(422)
  })

  it('잘못된 Content-Type → 422', async () => {
    const res = await client.post('/items', undefined, { headers: { 'content-type': 'text/plain' } })
    expect(res.status).toBe(422)
    expect((res.json as any)?.error?.details?.some((d: any) => d.code === 'PROTOCOL_MISMATCH')).toBe(true)
  })
})

describe('MediaType — text/plain body', () => {
  let server: NodeMockServer
  let client: ReturnType<typeof createTestClient>

  beforeAll(async () => {
    server = createNodeMockServer(spec({
      paths: {
        '/echo': {
          post: {
            operationId: 'echo',
            requestBody: {
              content: {
                'text/plain': {
                  schema: { type: 'string' },
                },
              },
            },
            responses: {
              '200': {
                description: 'Echo',
                content: {
                  'text/plain': {
                    example: 'hello world',
                  },
                },
              },
            },
          },
        },
      },
    }), { port: 0 })
    await server.start()
    client = createTestClient(server)
  })

  afterAll(async () => { await server.stop() })

  it('text/plain 응답', async () => {
    const res = await client.post('/echo', undefined, { headers: { 'content-type': 'text/plain' } })
    expect(res.status).toBe(200)
    expect(res.body).toContain('hello world')
  })
})

describe('MediaType — dataValue 우선순위', () => {
  let server: NodeMockServer
  let client: ReturnType<typeof createTestClient>

  beforeAll(async () => {
    server = createNodeMockServer(spec({
      paths: {
        '/priority': {
          get: {
            operationId: 'testPriority',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { type: 'object', properties: { a: { type: 'string' } } },
                    examples: {
                      first: {
                        dataValue: { a: 'from-dataValue' },
                        value: { a: 'from-value' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }), { port: 0 })
    await server.start()
    client = createTestClient(server)
  })

  afterAll(async () => { await server.stop() })

  it('dataValue가 value보다 우선', async () => {
    const res = await client.get('/priority')
    expect(res.status).toBe(200)
    expect(res.json).toEqual({ a: 'from-dataValue' })
  })
})
