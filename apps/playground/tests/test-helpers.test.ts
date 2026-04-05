/**
 * 테스트 헬퍼 통합 테스트
 *
 * createTestClient + createCoverageTracker + describeApi 실전 사용.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createNodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
import { createTestClient, createCoverageTracker } from '@oa-sdk/mock-server'
import { parseDocument, describeApi, findOperation, findByTag } from '@oa-sdk/parser'
import type { NodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
import type { OasDocument } from '@oa-sdk/parser'

const spec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Helper Test', version: '1.0.0' },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        tags: ['users'],
        summary: '사용자 목록 조회',
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } },
          },
        },
      },
      post: {
        operationId: 'createUser',
        tags: ['users'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
        },
        responses: { '201': { description: 'Created', content: { 'application/json': { schema: { type: 'object' } } } } },
      },
    },
  },
} as OasDocument

const tracker = createCoverageTracker()
let server: NodeMockServer
let client: ReturnType<typeof createTestClient>

beforeAll(async () => {
  server = createNodeMockServer(spec, { port: 0 })
  await server.start()
  client = createTestClient(server)
})

afterAll(async () => { await server.stop() })

describe('createTestClient', () => {
  it('GET → TestResponse', async () => {
    const res = await client.get('/users')
    expect(res.status).toBe(200)
    expect(res.ok).toBe(true)
    expect(res.json).toBeDefined()
  })

  it('POST with body', async () => {
    const res = await client.post('/users', { name: 'Alice' })
    expect(res.status).toBe(201)
  })

  it('POST without required field → 422', async () => {
    const res = await client.post('/users', {})
    expect(res.status).toBe(422)
    expect(res.ok).toBe(false)
  })

  it('query params', async () => {
    const res = await client.get('/users', { query: { page: 1, limit: 10 } })
    expect(res.status).toBe(200)
  })

  it('404 for unknown path', async () => {
    const res = await client.get('/nonexistent')
    expect(res.status).toBe(404)
  })
})

describe('describeApi + query', () => {
  it('API 요약', () => {
    const doc = parseDocument(spec)
    const summary = describeApi(doc)
    expect(summary).toContain('Helper Test')
    expect(summary).toContain('[users]')
    expect(summary).toContain('GET /users')
    expect(summary).toContain('POST /users')
  })

  it('findOperation', () => {
    const doc = parseDocument(spec)
    const op = findOperation(doc, 'listUsers')
    expect(op?.summary).toBe('사용자 목록 조회')
  })

  it('findByTag', () => {
    const doc = parseDocument(spec)
    const ops = findByTag(doc, 'users')
    expect(ops).toHaveLength(2)
  })
})
