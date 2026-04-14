/**
 * router 엣지케이스 테스트 — 기존 generate-router.test.ts를 보강
 */
import { describe, it, expect } from 'vitest'
import { generateRouter } from '../generate-router.js'
import type { OasDocument } from '@oa-sdk/parser'

function doc(overrides: Partial<OasDocument> = {}): OasDocument {
  return { openapi: '3.2.0', info: { title: 'T', version: '0' }, paths: {}, ...overrides } as OasDocument
}

describe('같은 경로에 여러 HTTP 메서드', () => {
  const spec = doc({
    paths: {
      '/items': {
        get:    { operationId: 'listItems', responses: { '200': { description: 'OK' } } },
        post:   { operationId: 'createItem', requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { '201': { description: 'C' } } },
        delete: { operationId: 'deleteAllItems', responses: { '204': { description: 'D' } } },
      },
      '/items/{id}': {
        get:   { operationId: 'getItem', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
        put:   { operationId: 'replaceItem', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { '200': { description: 'OK' } } },
        patch: { operationId: 'updateItem', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { '200': { description: 'OK' } } },
      },
    },
  })

  it('hono: 모든 메서드 생성', () => {
    const code = generateRouter(spec)
    expect(code).toContain("app.get('/items'")
    expect(code).toContain("app.post('/items'")
    expect(code).toContain("app.delete('/items'")
    expect(code).toContain("app.get('/items/:id'")
    expect(code).toContain("app.put('/items/:id'")
    expect(code).toContain("app.patch('/items/:id'")
  })

  it('express: 모든 메서드 생성', () => {
    const code = generateRouter(spec, { target: 'express' })
    expect(code).toContain("router.get('/items'")
    expect(code).toContain("router.post('/items'")
    expect(code).toContain("router.delete('/items'")
    expect(code).toContain("router.put('/items/:id'")
    expect(code).toContain("router.patch('/items/:id'")
  })
})

describe('path params + query params 동시', () => {
  it('둘 다 파싱', () => {
    const code = generateRouter(doc({
      paths: {
        '/users/{id}/posts': {
          get: {
            operationId: 'getUserPosts',
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'page', in: 'query', schema: { type: 'integer' } },
              { name: 'limit', in: 'query', schema: { type: 'integer' } },
            ],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }), { typesImport: './types' })
    expect(code).toContain("'/users/:id/posts'")
    expect(code).toContain('GetUserPostsPathParams')
    expect(code).toContain('GetUserPostsQueryParams')
  })
})

describe('operationId 없는 operation', () => {
  it('skip됨', () => {
    const code = generateRouter(doc({
      paths: {
        '/health': {
          get: { responses: { '200': { description: 'OK' } } },
        },
        '/users': {
          get: { operationId: 'listUsers', responses: { '200': { description: 'OK' } } },
        },
      },
    }))
    expect(code).not.toContain("app.get('/health'")
    expect(code).toContain("app.get('/users'")
  })
})

describe('security: empty security (public override)', () => {
  it('global security 있지만 operation에서 security: [] → 힌트 없음', () => {
    const code = generateRouter(doc({
      security: [{ bearerAuth: [] }],
      paths: {
        '/public': {
          get: {
            operationId: 'publicEndpoint',
            security: [],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    expect(code).not.toContain('Requires:')
  })
})

describe('빈 스펙', () => {
  it('paths 없음 → 기본 구조만', () => {
    const code = generateRouter(doc())
    expect(code).toContain("import { Hono } from 'hono'")
    expect(code).toContain('export default app')
  })
})

describe('deep nested path', () => {
  it('/a/{b}/c/{d}/e → 올바른 변환', () => {
    const code = generateRouter(doc({
      paths: {
        '/a/{b}/c/{d}/e': {
          get: {
            operationId: 'deepNested',
            parameters: [
              { name: 'b', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'd', in: 'path', required: true, schema: { type: 'string' } },
            ],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    expect(code).toContain("'/a/:b/c/:d/e'")
  })
})
