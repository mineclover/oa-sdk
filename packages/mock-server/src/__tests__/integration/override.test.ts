import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createNodeMockServer, type NodeMockServer } from '../../adapters/node-http.js'
import type { OasDocument } from '@oa-sdk/parser'

const spec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Override Test', version: '0.0.0' },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
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
    },
    '/health': {
      get: {
        operationId: 'healthCheck',
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                examples: { default: { dataValue: { status: 'ok' } } },
              },
            },
          },
        },
      },
    },
  },
}

describe('NodeMockServer override API', () => {
  let server: NodeMockServer

  beforeAll(async () => {
    server = createNodeMockServer(spec, { port: 0 })
    await server.start()
  })

  afterAll(async () => {
    await server.stop()
  })

  afterEach(() => {
    server.clearOverrides()
  })

  it('override -> 해당 operation만 오버라이드 응답 반환', async () => {
    server.override('listUsers', { status: 200, body: { items: [{ id: '1' }], total: 1 } })

    const res = await fetch(`${server.url}/users`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ items: [{ id: '1' }], total: 1 })
  })

  it('다른 operation은 영향 없음', async () => {
    server.override('listUsers', { status: 200, body: { overridden: true } })

    // listUsers는 오버라이드
    const res1 = await fetch(`${server.url}/users`)
    expect(res1.status).toBe(200)
    const body1 = await res1.json()
    expect(body1).toEqual({ overridden: true })

    // healthCheck는 원래 spec 기반 응답
    const res2 = await fetch(`${server.url}/health`)
    expect(res2.status).toBe(200)
    const body2 = await res2.json()
    expect(body2).toEqual({ status: 'ok' })
  })

  it('clearOverride -> 원래 spec 기반 응답으로 복귀', async () => {
    server.override('listUsers', { status: 503, body: { error: 'Down' } })

    const res1 = await fetch(`${server.url}/users`)
    expect(res1.status).toBe(503)

    server.clearOverride('listUsers')

    const res2 = await fetch(`${server.url}/users`)
    expect(res2.status).toBe(200)
    const body2 = await res2.json()
    expect(body2).toEqual({ items: [], total: 0 })
  })

  it('clearOverrides -> 모든 오버라이드 제거', async () => {
    server.override('listUsers', { status: 503, body: { error: 'Down' } })
    server.override('healthCheck', { status: 503, body: { error: 'Down' } })

    const res1 = await fetch(`${server.url}/users`)
    expect(res1.status).toBe(503)
    const res2 = await fetch(`${server.url}/health`)
    expect(res2.status).toBe(503)

    server.clearOverrides()

    const res3 = await fetch(`${server.url}/users`)
    expect(res3.status).toBe(200)
    const body3 = await res3.json()
    expect(body3).toEqual({ items: [], total: 0 })

    const res4 = await fetch(`${server.url}/health`)
    expect(res4.status).toBe(200)
    const body4 = await res4.json()
    expect(body4).toEqual({ status: 'ok' })
  })

  it('404 에러 시나리오 오버라이드', async () => {
    server.override('getUserById', { status: 404, body: { error: 'Not Found' } })

    const res = await fetch(`${server.url}/users/123e4567-e89b-12d3-a456-426614174000`)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ error: 'Not Found' })
  })

  it('500 에러 시나리오 오버라이드', async () => {
    server.override('listUsers', { status: 500, body: { error: 'Internal Server Error' } })

    const res = await fetch(`${server.url}/users`)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: 'Internal Server Error' })
  })

  it('커스텀 헤더 오버라이드', async () => {
    server.override('listUsers', {
      status: 200,
      body: { items: [] },
      headers: { 'X-Custom-Header': 'test-value', 'X-Request-Id': 'abc-123' },
    })

    const res = await fetch(`${server.url}/users`)
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Custom-Header')).toBe('test-value')
    expect(res.headers.get('X-Request-Id')).toBe('abc-123')
    const body = await res.json()
    expect(body).toEqual({ items: [] })
  })
})
