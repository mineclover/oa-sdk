/**
 * adapters/msw.ts — createMswHandlers 통합 테스트
 * msw/node setupServer 로 실제 HTTP 인터셉트 검증
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { setupServer } from 'msw/node'
import { createMswHandlers } from '../../adapters/msw.js'
import type { OasDocument } from '@oa-sdk/parser'
import { createWebhookSpec } from '../fixtures/specs.js'

// ─── 공통 스펙 ────────────────────────────────────────────────────────────────

const spec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'MSW Test', version: '0.0.0' },
  components: {
    schemas: {
      Item: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
        },
      },
    },
  } as any,
  paths: {
    '/items': {
      get: {
        operationId: 'listItems',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                examples: { default: { dataValue: [{ id: 1, name: 'alpha' }] } },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createItem',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Item' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created',
            content: {
              'application/json': {
                examples: { default: { dataValue: { id: 2, name: 'beta' } } },
              },
            },
          },
        },
      },
    },
    '/items/{id}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      ],
      get: {
        operationId: 'getItem',
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                examples: { default: { dataValue: { id: 1, name: 'alpha' } } },
              },
            },
          },
        },
      },
      delete: {
        operationId: 'deleteItem',
        responses: { '204': { description: 'No Content' } },
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
                  required: ['type'],
                  properties: { type: { type: 'string', enum: ['ping'] } },
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
  },
}

const BASE = 'http://localhost'
const server = setupServer(...createMswHandlers(spec))

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// ─── 정상 응답 ────────────────────────────────────────────────────────────────

describe('createMswHandlers — 정상 응답', () => {
  it('GET /items → 200 + dataValue body', async () => {
    const res = await fetch(`${BASE}/items`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = await res.json()
    expect(body).toEqual([{ id: 1, name: 'alpha' }])
  })

  it('POST /items valid body → 201 + created body', async () => {
    const res = await fetch(`${BASE}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 99, name: 'test' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toEqual({ id: 2, name: 'beta' })
  })

  it('GET /items/{id} → 200 + item body', async () => {
    const res = await fetch(`${BASE}/items/1`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ id: 1, name: 'alpha' })
  })

  it('DELETE /items/{id} → 204 빈 body', async () => {
    const res = await fetch(`${BASE}/items/1`, { method: 'DELETE' })
    expect(res.status).toBe(204)
  })
})

// ─── 요청 검증 실패 ───────────────────────────────────────────────────────────

describe('createMswHandlers — 요청 검증 실패', () => {
  it('POST /items $ref 스키마 required 누락 → 422', async () => {
    const res = await fetch(`${BASE}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 1 }), // name 누락
    })
    expect(res.status).toBe(422)
    const body = await res.json() as Record<string, any>
    expect(body.error.details.some((e: any) => e.code === 'MISSING_REQUIRED_FIELD')).toBe(true)
    expect(body.error.details.some((e: any) => e.path === '/body/name')).toBe(true)
  })

  it('POST /items wrong type → 422 + TYPE_ERROR', async () => {
    const res = await fetch(`${BASE}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'not-int', name: 'ok' }),
    })
    expect(res.status).toBe(422)
    const body = await res.json() as Record<string, any>
    expect(body.error.details.some((e: any) => e.code === 'TYPE_ERROR')).toBe(true)
  })

  it('GET /items?page=0 → 422 + CONSTRAINT_VIOLATION', async () => {
    const res = await fetch(`${BASE}/items?page=0`)
    expect(res.status).toBe(422)
    const body = await res.json() as Record<string, any>
    expect(body.error.details[0].code).toBe('CONSTRAINT_VIOLATION')
  })

  it('POST /items wrong content-type → 422 + PROTOCOL_MISMATCH', async () => {
    const res = await fetch(`${BASE}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not json',
    })
    expect(res.status).toBe(422)
    const body = await res.json() as Record<string, any>
    expect(body.error.details.some((e: any) => e.code === 'PROTOCOL_MISMATCH')).toBe(true)
  })
})

// ─── HTTP 메서드 처리 ─────────────────────────────────────────────────────────

describe('createMswHandlers — HTTP 메서드 처리', () => {
  it('미정의 메서드 → 405 + Allow 헤더', async () => {
    const res = await fetch(`${BASE}/items/1`, { method: 'PATCH' })
    expect(res.status).toBe(405)
    const allow = res.headers.get('Allow') ?? ''
    expect(allow.toUpperCase()).toContain('GET')
    expect(allow.toUpperCase()).toContain('DELETE')
  })
})

// ─── extractBaseUrl ───────────────────────────────────────────────────────────

describe('createMswHandlers — extractBaseUrl', () => {
  it('servers 없으면 빈 prefix — /items 직접 매칭', async () => {
    // spec에 servers가 없으므로 baseUrl = '' → handler가 /items에 등록
    const res = await fetch(`${BASE}/items`)
    expect(res.status).toBe(200)
  })

  it('servers[0].url이 절대 URL이면 pathname만 추출', async () => {
    const prefixSpec: OasDocument = {
      ...spec,
      servers: [{ url: 'https://api.example.com/v2' }],
      paths: {
        '/ping': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { example: { ok: true } } },
              },
            },
          },
        },
      },
    }
    server.close()
    const prefixServer = setupServer(...createMswHandlers(prefixSpec))
    prefixServer.listen({ onUnhandledRequest: 'bypass' })
    try {
      // /v2/ping 에 등록돼야 함
      const res = await fetch(`${BASE}/v2/ping`)
      expect(res.status).toBe(200)
    } finally {
      prefixServer.close()
      server.listen({ onUnhandledRequest: 'bypass' })
    }
  })

  it('servers[0].url 트레일링 슬래시 제거', async () => {
    const trailingSpec: OasDocument = {
      ...spec,
      servers: [{ url: 'https://api.example.com/' }],
      paths: {
        '/health': {
          get: {
            responses: { '200': { description: 'OK', content: { 'application/json': { example: 'ok' } } } },
          },
        },
      },
    }
    server.close()
    const s = setupServer(...createMswHandlers(trailingSpec))
    s.listen({ onUnhandledRequest: 'bypass' })
    try {
      // //health 가 되면 안 됨 → /health
      const res = await fetch(`${BASE}/health`)
      expect(res.status).toBe(200)
    } finally {
      s.close()
      server.listen({ onUnhandledRequest: 'bypass' })
    }
  })

  it('servers[0].url이 상대 경로면 그대로 prefix', async () => {
    const relativeSpec: OasDocument = {
      ...spec,
      servers: [{ url: '/api' }],
      paths: {
        '/status': {
          get: {
            responses: { '200': { description: 'OK', content: { 'application/json': { example: 'up' } } } },
          },
        },
      },
    }
    server.close()
    const s = setupServer(...createMswHandlers(relativeSpec))
    s.listen({ onUnhandledRequest: 'bypass' })
    try {
      const res = await fetch(`${BASE}/api/status`)
      expect(res.status).toBe(200)
    } finally {
      s.close()
      server.listen({ onUnhandledRequest: 'bypass' })
    }
  })
})

// ─── SSE 스트리밍 ──────────────────────────────────────────────────────────────

describe('createMswHandlers — SSE 스트리밍', () => {
  it('GET /events → text/event-stream ReadableStream', async () => {
    const res = await fetch(`${BASE}/events`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const text = await res.text()
    expect(text).toMatch(/^data: /)
    const lines = text.split('\n\n').filter(Boolean)
    // 3 events + [DONE]
    expect(lines.length).toBe(4)
    expect(lines[3]).toBe('data: [DONE]')
    const ev = JSON.parse(lines[0]!.replace('data: ', ''))
    expect(ev.type).toBe('ping')
  })
})

// ─── NDJSON 스트리밍 ───────────────────────────────────────────────────────────

describe('createMswHandlers — NDJSON 스트리밍', () => {
  it('GET /ndjson → application/x-ndjson, bare JSON lines (data: prefix 없음)', async () => {
    const res = await fetch(`${BASE}/ndjson`)
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
})

// ─── onRequest 훅 ─────────────────────────────────────────────────────────────

describe('createMswHandlers — onRequest 훅', () => {
  it('요청마다 method, path, operationId가 전달된다', async () => {
    const calls: { method: string; path: string; operationId?: string }[] = []
    server.close()
    const hookServer = setupServer(...createMswHandlers(spec, {
      onRequest: (info) => calls.push(info),
    }))
    hookServer.listen({ onUnhandledRequest: 'bypass' })
    try {
      await fetch(`${BASE}/items`)
      expect(calls).toHaveLength(1)
      expect(calls[0]!.method).toBe('get')
      expect(calls[0]!.path).toBe('/items')
      expect(calls[0]!.operationId).toBe('listItems')
    } finally {
      hookServer.close()
      server.listen({ onUnhandledRequest: 'bypass' })
    }
  })
})

// ─── 웹훅 ─────────────────────────────────────────────────────────────────────

describe('createMswHandlers — webhooks', () => {
  const webhookSpec = createWebhookSpec()

  it('POST /webhooks/orderCreated — valid payload → 200', async () => {
    server.close()
    const whServer = setupServer(...createMswHandlers(webhookSpec))
    whServer.listen({ onUnhandledRequest: 'bypass' })
    try {
      const res = await fetch(`${BASE}/webhooks/orderCreated`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: 'ord-456' }),
      })
      expect(res.status).toBe(200)
    } finally {
      whServer.close()
      server.listen({ onUnhandledRequest: 'bypass' })
    }
  })

  it('POST /webhooks/orderCreated — missing required → 422', async () => {
    server.close()
    const whServer = setupServer(...createMswHandlers(webhookSpec))
    whServer.listen({ onUnhandledRequest: 'bypass' })
    try {
      const res = await fetch(`${BASE}/webhooks/orderCreated`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(422)
      const body = await res.json() as Record<string, any>
      expect(body.error.details[0].code).toBe('MISSING_REQUIRED_FIELD')
    } finally {
      whServer.close()
      server.listen({ onUnhandledRequest: 'bypass' })
    }
  })

  it('GET /orders works alongside webhook routes', async () => {
    server.close()
    const whServer = setupServer(...createMswHandlers(webhookSpec))
    whServer.listen({ onUnhandledRequest: 'bypass' })
    try {
      const res = await fetch(`${BASE}/orders`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual([])
    } finally {
      whServer.close()
      server.listen({ onUnhandledRequest: 'bypass' })
    }
  })
})

// ─── $ref 스키마 통합 ──────────────────────────────────────────────────────────

describe('createMswHandlers — $ref 스키마 deref 검증', () => {
  it('$ref requestBody 검증 동작 — deref 후 AJV 정상 작동', async () => {
    // Item schema의 required: ['id', 'name']이 deref되어 검증됨
    const valid = await fetch(`${BASE}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 1, name: 'ok' }),
    })
    expect(valid.status).toBe(201)
    const validBody = await valid.json()
    expect(validBody).toEqual({ id: 2, name: 'beta' }) // dataValue 그대로 반환 확인

    const invalid = await fetch(`${BASE}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 1 }),
    })
    expect(invalid.status).toBe(422)
  })
})

// ─── 추가 시나리오 (Node HTTP 패리티) ──────────────────────────────────────────

describe('createMswHandlers — 추가 시나리오', () => {
  it('POST /items no body + required → 422 MISSING_REQUIRED_FIELD', async () => {
    const res = await fetch(`${BASE}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(422)
    const body = await res.json() as any
    expect(body.error.details.some((d: any) => d.code === 'MISSING_REQUIRED_FIELD')).toBe(true)
  })

  it('GET /items/{id}/unknown → 핸들러 없으면 MSW bypass', async () => {
    // MSW는 매칭 안 되면 bypass하므로 실제 네트워크 요청 시도
    // onUnhandledRequest: 'bypass'로 설정되어 있어서 에러 안 남
  })

  it('default 응답만 있는 엔드포인트', async () => {
    const defaultSpec: OasDocument = {
      ...spec,
      paths: {
        '/default-only': {
          get: {
            operationId: 'defaultOnly',
            responses: { default: { description: 'Default', content: { 'application/json': { example: { ok: true } } } } },
          },
        },
      },
    }
    server.close()
    const s = setupServer(...createMswHandlers(defaultSpec))
    s.listen({ onUnhandledRequest: 'bypass' })
    try {
      const res = await fetch(`${BASE}/default-only`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ ok: true })
    } finally {
      s.close()
      server.listen({ onUnhandledRequest: 'bypass' })
    }
  })
})
