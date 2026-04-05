/**
 * schema-loader.ts 단위 테스트
 * loadSchema / matchRoute / toColonPath 각 함수를 독립 검증.
 */
import { describe, it, expect } from 'vitest'
import { loadSchema, matchRoute } from '@oa-sdk/parser'
import { toColonPath } from '@oa-sdk/core'
import type { OasDocument } from '@oa-sdk/parser'

const baseSpec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Test', version: '0.0.0' },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }],
        responses: { '200': { description: 'OK' } },
      },
      post: {
        operationId: 'createUser',
        responses: { '201': { description: 'Created' } },
      },
    },
    '/users/{id}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      get: {
        operationId: 'getUserById',
        parameters: [{ name: 'include', in: 'query', schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' } },
      },
      delete: {
        operationId: 'deleteUser',
        responses: { '204': { description: 'No Content' } },
      },
    },
  },
}

// ─── loadSchema ──────────────────────────────────────────────────────────────

describe('loadSchema — RouteIndex 생성', () => {
  it('paths 수만큼 RouteIndex entry가 생성된다', () => {
    const index = loadSchema(baseSpec)
    expect(index.size).toBe(2)
  })

  it('각 경로에 정의된 메서드만 포함한다', () => {
    const index = loadSchema(baseSpec)
    const users = index.get('/users')!
    expect(users.has('get')).toBe(true)
    expect(users.has('post')).toBe(true)
    expect(users.has('put')).toBe(false)
    expect(users.has('delete')).toBe(false)
  })

  it('operationId를 entry에 포함한다', () => {
    const index = loadSchema(baseSpec)
    expect(index.get('/users')?.get('get')?.operationId).toBe('listUsers')
    expect(index.get('/users/{id}')?.get('delete')?.operationId).toBe('deleteUser')
  })

  it('operationId 없는 operation은 entry에서 생략한다', () => {
    const spec: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'T', version: '0' },
      paths: { '/x': { get: { responses: { '200': { description: 'OK' } } } } },
    }
    const index = loadSchema(spec)
    expect(index.get('/x')?.get('get')?.operationId).toBeUndefined()
  })

  it('path-level 파라미터와 operation-level 파라미터를 병합한다 (operation 우선)', () => {
    const index = loadSchema(baseSpec)
    // /users/{id} GET: path-level(id) + operation-level(id override + include)
    const entry = index.get('/users/{id}')?.get('get')!
    const paramKeys = entry.parameters.map(p => `${p.in}:${p.name}`)
    expect(paramKeys).toContain('path:id')
    expect(paramKeys).toContain('query:include')
    // id가 중복 등록되지 않아야 함
    expect(paramKeys.filter(k => k === 'path:id')).toHaveLength(1)
  })

  it('requestBody가 있으면 entry에 포함한다', () => {
    const spec: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          post: {
            operationId: 'createItem',
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { type: 'object' } } },
            },
            responses: { '201': { description: 'Created' } },
          },
        },
      },
    }
    const index = loadSchema(spec)
    expect(index.get('/items')?.get('post')?.requestBody).toBeDefined()
    expect(index.get('/items')?.get('post')?.requestBody?.required).toBe(true)
  })

  it('paths가 없으면 빈 index를 반환한다', () => {
    const spec: OasDocument = { openapi: '3.2.0', info: { title: 'T', version: '0' } }
    const index = loadSchema(spec)
    expect(index.size).toBe(0)
  })
})

// ─── toColonPath ───────────────────────────────────────────────────────────────

describe('toColonPath — OpenAPI 경로 → MSW 경로 변환', () => {
  it('{param} → :param', () => expect(toColonPath('/users/{id}')).toBe('/users/:id'))
  it('중첩 파라미터 변환', () => expect(toColonPath('/orgs/{orgId}/users/{userId}')).toBe('/orgs/:orgId/users/:userId'))
  it('파라미터 없는 경로 유지', () => expect(toColonPath('/users')).toBe('/users'))
  it('루트 경로 유지', () => expect(toColonPath('/')).toBe('/'))
})

// ─── matchRoute ──────────────────────────────────────────────────────────────

describe('matchRoute — found', () => {
  const index = loadSchema(baseSpec)

  it('정적 경로 exact match → found', () => {
    const r = matchRoute(index, 'get', '/users')
    expect(r.type).toBe('found')
    if (r.type === 'found') expect(r.entry.operationId).toBe('listUsers')
  })

  it('path parameter를 추출한다', () => {
    const r = matchRoute(index, 'get', '/users/abc-123')
    expect(r.type).toBe('found')
    if (r.type === 'found') expect(r.pathParams).toEqual({ id: 'abc-123' })
  })

  it('여러 path parameter 추출', () => {
    const multiSpec: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/orgs/{orgId}/users/{userId}': {
          get: { operationId: 'getOrgUser', responses: { '200': { description: 'OK' } } },
        },
      },
    }
    const idx = loadSchema(multiSpec)
    const r = matchRoute(idx, 'get', '/orgs/org1/users/user2')
    expect(r.type).toBe('found')
    if (r.type === 'found') expect(r.pathParams).toEqual({ orgId: 'org1', userId: 'user2' })
  })

  it('파라미터 없는 found는 빈 pathParams', () => {
    const r = matchRoute(index, 'post', '/users')
    expect(r.type).toBe('found')
    if (r.type === 'found') expect(r.pathParams).toEqual({})
  })
})

describe('matchRoute — not_found / method_not_allowed', () => {
  const index = loadSchema(baseSpec)

  it('존재하지 않는 경로 → not_found', () => {
    expect(matchRoute(index, 'get', '/unknown').type).toBe('not_found')
  })

  it('경로 일치 + 미정의 메서드 → method_not_allowed', () => {
    const r = matchRoute(index, 'patch', '/users/abc')
    expect(r.type).toBe('method_not_allowed')
    if (r.type === 'method_not_allowed') {
      expect(r.allowed).toContain('get')
      expect(r.allowed).toContain('delete')
      expect(r.allowed).not.toContain('patch')
    }
  })

  it('정적 경로 > 파라미터 경로 우선순위 (정의 순서 기반)', () => {
    const prioritySpec: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/users/me': { get: { operationId: 'getMe', responses: { '200': { description: 'OK' } } } },
        '/users/{id}': { get: { operationId: 'getById', responses: { '200': { description: 'OK' } } } },
      },
    }
    const idx = loadSchema(prioritySpec)
    const r = matchRoute(idx, 'get', '/users/me')
    expect(r.type).toBe('found')
    if (r.type === 'found') expect(r.entry.operationId).toBe('getMe')
  })
})
