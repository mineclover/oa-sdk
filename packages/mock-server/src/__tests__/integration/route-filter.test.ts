/**
 * 라우트 필터 통합 테스트 — 어댑터 레벨에서 include 옵션 동작 검증
 *
 * 전체 스펙에서 일부 라우트만 선택하여 핸들러/서버를 생성하고,
 * 포함된 라우트는 정상 응답, 제외된 라우트는 404/bypass인지 확인.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { setupServer, type SetupServer } from 'msw/node'
import { createMswHandlers } from '../../adapters/msw.js'
import { createNodeMockServer, type NodeMockServer } from '../../adapters/node-http.js'
import { createTestClient, type TestClient } from '../../testing.js'
import type { OasDocument } from '@oa-sdk/parser'

const spec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Filter Test', version: '0.0.0' },
  paths: {
    '/health': {
      get: {
        operationId: 'healthCheck',
        tags: ['system'],
        responses: { '200': { description: 'OK', content: { 'application/json': { example: { ok: true } } } } },
      },
    },
    '/users': {
      get: {
        operationId: 'listUsers',
        tags: ['users'],
        responses: { '200': { description: 'OK', content: { 'application/json': { example: [] } } } },
      },
      post: {
        operationId: 'createUser',
        tags: ['users'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } } },
        },
        responses: { '201': { description: 'Created', content: { 'application/json': { example: { id: 1 } } } } },
      },
    },
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        tags: ['users'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK', content: { 'application/json': { example: { id: 1, name: 'Alice' } } } } },
      },
    },
    '/orgs': {
      get: {
        operationId: 'listOrgs',
        tags: ['orgs'],
        responses: { '200': { description: 'OK', content: { 'application/json': { example: [] } } } },
      },
    },
    '/orgs/{orgId}/projects': {
      get: {
        operationId: 'listProjects',
        tags: ['orgs', 'projects'],
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK', content: { 'application/json': { example: [] } } } },
      },
    },
    '/admin/settings': {
      get: {
        operationId: 'getSettings',
        tags: ['admin'],
        responses: { '200': { description: 'OK', content: { 'application/json': { example: { theme: 'dark' } } } } },
      },
    },
  },
}

// ═══════════════════════════════════════════════════════════════════════════
// Node HTTP — include 필터
// ═══════════════════════════════════════════════════════════════════════════

describe('Node HTTP — path prefix 필터', () => {
  let server: NodeMockServer
  let client: TestClient

  beforeAll(async () => {
    server = createNodeMockServer(spec, { port: 0, include: { paths: ['/users'] } })
    await server.start()
    client = createTestClient(server)
  })

  afterAll(async () => { await server.stop() })

  it('/users → 200', async () => {
    const res = await client.get('/users')
    expect(res.status).toBe(200)
  })

  it('/users/{id} → 200 (prefix 매칭)', async () => {
    const res = await client.get('/users/1')
    expect(res.status).toBe(200)
  })

  it('/health → 404 (제외됨)', async () => {
    const res = await client.get('/health')
    expect(res.status).toBe(404)
  })

  it('/orgs → 404 (제외됨)', async () => {
    const res = await client.get('/orgs')
    expect(res.status).toBe(404)
  })

  it('/admin/settings → 404 (제외됨)', async () => {
    const res = await client.get('/admin/settings')
    expect(res.status).toBe(404)
  })
})

describe('Node HTTP — operationId 필터', () => {
  let server: NodeMockServer
  let client: TestClient

  beforeAll(async () => {
    server = createNodeMockServer(spec, { port: 0, include: { operations: ['healthCheck', 'listUsers'] } })
    await server.start()
    client = createTestClient(server)
  })

  afterAll(async () => { await server.stop() })

  it('healthCheck → 200', async () => {
    const res = await client.get('/health')
    expect(res.status).toBe(200)
  })

  it('listUsers → 200', async () => {
    const res = await client.get('/users')
    expect(res.status).toBe(200)
  })

  it('createUser → 405 (같은 경로지만 POST는 제외)', async () => {
    const res = await client.post('/users', { name: 'test' })
    expect(res.status).toBe(405)
  })

  it('getUser → 404 (제외됨)', async () => {
    const res = await client.get('/users/1')
    expect(res.status).toBe(404)
  })
})

describe('Node HTTP — tag 필터', () => {
  let server: NodeMockServer
  let client: TestClient

  beforeAll(async () => {
    server = createNodeMockServer(spec, { port: 0, include: { tags: ['orgs'] } })
    await server.start()
    client = createTestClient(server)
  })

  afterAll(async () => { await server.stop() })

  it('listOrgs (tags: [orgs]) → 200', async () => {
    const res = await client.get('/orgs')
    expect(res.status).toBe(200)
  })

  it('listProjects (tags: [orgs, projects]) → 200 (orgs 태그 매칭)', async () => {
    const res = await client.get('/orgs/abc/projects')
    expect(res.status).toBe(200)
  })

  it('/users → 404 (users 태그 제외)', async () => {
    const res = await client.get('/users')
    expect(res.status).toBe(404)
  })
})

describe('Node HTTP — OR 조합 (paths + operations)', () => {
  let server: NodeMockServer
  let client: TestClient

  beforeAll(async () => {
    server = createNodeMockServer(spec, {
      port: 0,
      include: { paths: ['/health'], operations: ['listOrgs'] },
    })
    await server.start()
    client = createTestClient(server)
  })

  afterAll(async () => { await server.stop() })

  it('/health → 200 (paths 매칭)', async () => {
    const res = await client.get('/health')
    expect(res.status).toBe(200)
  })

  it('/orgs → 200 (operations 매칭)', async () => {
    const res = await client.get('/orgs')
    expect(res.status).toBe(200)
  })

  it('/users → 404 (둘 다 미매칭)', async () => {
    const res = await client.get('/users')
    expect(res.status).toBe(404)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// MSW — include 필터
// ═══════════════════════════════════════════════════════════════════════════

describe('MSW — path prefix 필터', () => {
  const BASE = 'http://localhost'
  let mswServer: SetupServer

  beforeAll(() => {
    mswServer = setupServer(...createMswHandlers(spec, { include: { paths: ['/users'] } }))
    mswServer.listen({ onUnhandledRequest: 'bypass' })
  })

  afterEach(() => mswServer.resetHandlers())
  afterAll(() => mswServer.close())

  it('/users → 200 (포함)', async () => {
    const res = await fetch(`${BASE}/users`)
    expect(res.status).toBe(200)
  })

  it('/users/1 → 200 (prefix 매칭)', async () => {
    const res = await fetch(`${BASE}/users/1`)
    expect(res.status).toBe(200)
  })

  it('POST /users valid → 201 (포함)', async () => {
    const res = await fetch(`${BASE}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test' }),
    })
    expect(res.status).toBe(201)
  })
})

describe('MSW — operationId 필터', () => {
  const BASE = 'http://localhost'
  let mswServer: SetupServer

  beforeAll(() => {
    mswServer = setupServer(...createMswHandlers(spec, { include: { operations: ['getSettings'] } }))
    mswServer.listen({ onUnhandledRequest: 'bypass' })
  })

  afterEach(() => mswServer.resetHandlers())
  afterAll(() => mswServer.close())

  it('/admin/settings → 200 (포함)', async () => {
    const res = await fetch(`${BASE}/admin/settings`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ theme: 'dark' })
  })
})

describe('MSW — tag 필터', () => {
  const BASE = 'http://localhost'
  let mswServer: SetupServer

  beforeAll(() => {
    mswServer = setupServer(...createMswHandlers(spec, { include: { tags: ['users'] } }))
    mswServer.listen({ onUnhandledRequest: 'bypass' })
  })

  afterEach(() => mswServer.resetHandlers())
  afterAll(() => mswServer.close())

  it('/users → 200 (users 태그)', async () => {
    const res = await fetch(`${BASE}/users`)
    expect(res.status).toBe(200)
  })

  it('/users/1 → 200 (users 태그)', async () => {
    const res = await fetch(`${BASE}/users/1`)
    expect(res.status).toBe(200)
  })
})

describe('MSW — custom filter (deprecated 제외)', () => {
  const specWithDeprecated: OasDocument = {
    openapi: '3.2.0',
    info: { title: 'Deprecated Test', version: '0.0.0' },
    paths: {
      '/v1/data': {
        get: {
          operationId: 'getDataV1',
          deprecated: true,
          responses: { '200': { description: 'OK', content: { 'application/json': { example: { v: 1 } } } } },
        },
      },
      '/v2/data': {
        get: {
          operationId: 'getDataV2',
          responses: { '200': { description: 'OK', content: { 'application/json': { example: { v: 2 } } } } },
        },
      },
    },
  }

  const BASE = 'http://localhost'
  let mswServer: SetupServer

  beforeAll(() => {
    mswServer = setupServer(...createMswHandlers(specWithDeprecated, {
      include: { filter: (_p, _m, e) => !e.deprecated },
    }))
    mswServer.listen({ onUnhandledRequest: 'bypass' })
  })

  afterEach(() => mswServer.resetHandlers())
  afterAll(() => mswServer.close())

  it('/v2/data → 200 (non-deprecated)', async () => {
    const res = await fetch(`${BASE}/v2/data`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ v: 2 })
  })
})
