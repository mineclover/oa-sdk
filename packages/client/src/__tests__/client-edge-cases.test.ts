/**
 * client 엣지케이스 테스트 — 기존 generate-client.test.ts를 보강
 */
import { describe, it, expect } from 'vitest'
import { generateClient } from '../generate-client.js'
import type { OasDocument } from '@oa-sdk/parser'

function doc(overrides: Partial<OasDocument> = {}): OasDocument {
  return { openapi: '3.2.0', info: { title: 'T', version: '0' }, paths: {}, ...overrides } as OasDocument
}

describe('같은 경로에 여러 HTTP 메서드', () => {
  it('각 메서드별 클라이언트 함수 생성', () => {
    const code = generateClient(doc({
      paths: {
        '/items': {
          get:    { operationId: 'listItems', responses: { '200': { description: 'OK' } } },
          post:   { operationId: 'createItem', requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { '201': { description: 'C' } } },
          delete: { operationId: 'deleteItems', responses: { '204': { description: 'D' } } },
        },
        '/items/{id}': {
          get:   { operationId: 'getItem', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
          put:   { operationId: 'replaceItem', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { '200': { description: 'OK' } } },
          patch: { operationId: 'updateItem', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { '200': { description: 'OK' } } },
        },
      },
    }))
    expect(code).toContain('async listItems(')
    expect(code).toContain('async createItem(')
    expect(code).toContain('async deleteItems(')
    expect(code).toContain('async getItem(')
    expect(code).toContain('async replaceItem(')
    expect(code).toContain('async updateItem(')
  })

  it('HTTP 메서드가 올바르게 매핑', () => {
    const code = generateClient(doc({
      paths: {
        '/items': {
          get:    { operationId: 'listItems', responses: { '200': { description: 'OK' } } },
          post:   { operationId: 'createItem', requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { '201': { description: 'C' } } },
          put:    { operationId: 'replaceItems', requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { '200': { description: 'OK' } } },
          patch:  { operationId: 'updateItems', requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { '200': { description: 'OK' } } },
          delete: { operationId: 'clearItems', responses: { '204': { description: 'D' } } },
        },
      },
    }))
    expect(code).toContain("'GET', '/items'")
    expect(code).toContain("'POST', '/items'")
    expect(code).toContain("'PUT', '/items'")
    expect(code).toContain("'PATCH', '/items'")
    expect(code).toContain("'DELETE', '/items'")
  })
})

describe('path params + query params + body 동시', () => {
  it('함수 시그니처에 params, body, query 순서', () => {
    const code = generateClient(doc({
      paths: {
        '/users/{id}/posts': {
          post: {
            operationId: 'createUserPost',
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'draft', in: 'query', schema: { type: 'boolean' } },
            ],
            requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
            responses: { '201': { description: 'C' } },
          },
        },
      },
    }))
    expect(code).toContain('async createUserPost(params')
    expect(code).toContain('${encodeURIComponent(String(params["id"]))}')
  })
})

describe('operationId 없는 operation → skip', () => {
  it('operationId 없으면 클라이언트 함수 미생성', () => {
    const code = generateClient(doc({
      paths: {
        '/health': { get: { responses: { '200': { description: 'OK' } } } },
        '/users': { get: { operationId: 'listUsers', responses: { '200': { description: 'OK' } } } },
      },
    }))
    expect(code).not.toContain('health')
    expect(code).toContain('async listUsers(')
  })
})

describe('multiple path params', () => {
  it('여러 path param 모두 치환', () => {
    const code = generateClient(doc({
      paths: {
        '/orgs/{orgId}/teams/{teamId}/members': {
          get: {
            operationId: 'listTeamMembers',
            parameters: [
              { name: 'orgId', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'teamId', in: 'path', required: true, schema: { type: 'string' } },
            ],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    expect(code).toContain('${encodeURIComponent(String(params["orgId"]))}')
    expect(code).toContain('${encodeURIComponent(String(params["teamId"]))}')
  })
})

describe('빈 스펙', () => {
  it('paths 없음 → createClient만 생성', () => {
    const code = generateClient(doc())
    expect(code).toContain('createClient')
    expect(code).toContain('return {')
  })
})

describe('서버 URL', () => {
  it('서버 없음 → baseUrl 빈 문자열', () => {
    const code = generateClient(doc({ paths: {} }))
    expect(code).toContain("baseUrl ?? ''")
  })

  it('여러 서버 중 첫 번째 사용', () => {
    const code = generateClient(doc({
      servers: [
        { url: 'https://primary.api.com' },
        { url: 'https://secondary.api.com' },
      ],
      paths: {},
    }))
    expect(code).toContain("'https://primary.api.com'")
    expect(code).not.toContain("'https://secondary.api.com'")
  })
})

describe('타입 import', () => {
  it('typesImport + 다양한 operation → 모든 타입 import', () => {
    const code = generateClient(doc({
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }],
            responses: { '200': { description: 'OK' } },
          },
          post: {
            operationId: 'createUser',
            requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
            responses: { '201': { description: 'C' } },
          },
        },
        '/users/{id}': {
          delete: {
            operationId: 'deleteUser',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '204': { description: 'D' } },
          },
        },
      },
    }), { typesImport: './types' })
    expect(code).toContain('ListUsersQueryParams')
    expect(code).toContain('CreateUserBody')
    expect(code).toContain('DeleteUserPathParams')
  })
})
