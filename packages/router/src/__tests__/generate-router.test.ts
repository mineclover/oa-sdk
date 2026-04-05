import { describe, it, expect } from 'vitest'
import { generateRouter } from '../generate-router.js'
import type { OasDocument } from '@oa-sdk/parser'

function doc(overrides: Partial<OasDocument> = {}): OasDocument {
  return { openapi: '3.2.0', info: { title: 'T', version: '0' }, paths: {}, ...overrides } as OasDocument
}

describe('generateRouter — hono', () => {
  it('기본 GET 라우트', () => {
    const code = generateRouter(doc({
      paths: {
        '/users': { get: { operationId: 'listUsers', responses: { '200': { description: 'OK' } } } },
      },
    }))
    expect(code).toContain("import { Hono } from 'hono'")
    expect(code).toContain("app.get('/users'")
    expect(code).toContain('implement listUsers')
    expect(code).toContain('export default app')
  })

  it('POST + request body', () => {
    const code = generateRouter(doc({
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
            responses: { '201': { description: 'Created' } },
          },
        },
      },
    }))
    expect(code).toContain("app.post('/users'")
    expect(code).toContain('await c.req.json()')
    expect(code).toContain('201')
  })

  it('path params → :id', () => {
    const code = generateRouter(doc({
      paths: {
        '/users/{id}': {
          get: {
            operationId: 'getUser',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }), { typesImport: './types' })
    expect(code).toContain("'/users/:id'")
    expect(code).toContain('c.req.param()')
    expect(code).toContain('GetUserPathParams')
  })

  it('query params', () => {
    const code = generateRouter(doc({
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }), { typesImport: './types' })
    expect(code).toContain('c.req.query()')
    expect(code).toContain('ListUsersQueryParams')
  })

  it('204 No Content', () => {
    const code = generateRouter(doc({
      paths: {
        '/users/{id}': {
          delete: { operationId: 'deleteUser', responses: { '204': { description: 'Deleted' } } },
        },
      },
    }))
    expect(code).toContain('c.body(null, 204)')
  })

  it('summary → JSDoc', () => {
    const code = generateRouter(doc({
      paths: {
        '/health': {
          get: { operationId: 'getHealth', summary: '서버 상태 확인', responses: { '200': { description: 'OK' } } },
        },
      },
    }))
    expect(code).toContain('/** 서버 상태 확인 */')
  })

  it('typesImport → import 문', () => {
    const code = generateRouter(doc({
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }), { typesImport: './api-types' })
    expect(code).toContain("from './api-types'")
    expect(code).toContain('ListUsersResponse')
  })
})

describe('generateRouter — express', () => {
  it('express 타겟', () => {
    const code = generateRouter(doc({
      paths: {
        '/users': { get: { operationId: 'listUsers', responses: { '200': { description: 'OK' } } } },
      },
    }), { target: 'express' })
    expect(code).toContain("import { Router } from 'express'")
    expect(code).toContain("router.get('/users'")
    expect(code).toContain('export default router')
  })
})

describe('generateRouter — banner', () => {
  it('banner 비활성화', () => {
    const code = generateRouter(doc({ paths: {} }), { banner: false })
    expect(code).not.toContain('Auto-generated')
  })
})
