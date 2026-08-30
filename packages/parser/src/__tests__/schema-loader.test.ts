import { describe, it, expect } from 'vitest'
import { loadSchema, matchRoute, HTTP_METHODS } from '../schema-loader.js'
import { toColonPath } from '@oa-sdk/core'
import type { OasDocument } from '../oas32-types.js'

function doc(overrides: Partial<OasDocument> = {}): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'T', version: '0' },
    paths: {},
    ...overrides,
  } as OasDocument
}

describe('loadSchema', () => {
  it('paths → RouteIndex', () => {
    const index = loadSchema(doc({
      paths: {
        '/users': { get: { responses: { '200': { description: 'OK' } } } },
      },
    }))
    expect(index.has('/users')).toBe(true)
    expect(index.get('/users')?.has('get')).toBe(true)
  })

  it('global security 상속', () => {
    const index = loadSchema(doc({
      security: [{ bearer: [] }],
      paths: {
        '/users': { get: { responses: { '200': { description: 'OK' } } } },
      },
    }))
    const entry = index.get('/users')?.get('get')
    expect(entry?.security).toEqual([{ bearer: [] }])
  })

  it('오퍼레이션 security가 global 오버라이드', () => {
    const index = loadSchema(doc({
      security: [{ bearer: [] }],
      paths: {
        '/public': {
          get: { security: [], responses: { '200': { description: 'OK' } } },
        },
      },
    }))
    const entry = index.get('/public')?.get('get')
    expect(entry?.security).toEqual([])
  })

  it('global servers 상속', () => {
    const index = loadSchema(doc({
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/users': { get: { responses: { '200': { description: 'OK' } } } },
      },
    }))
    const entry = index.get('/users')?.get('get')
    expect(entry?.servers).toHaveLength(1)
    expect(entry?.servers[0]?.url).toBe('https://api.example.com')
  })

  it('path-level servers가 global 오버라이드', () => {
    const index = loadSchema(doc({
      servers: [{ url: 'https://global.com' }],
      paths: {
        '/users': {
          servers: [{ url: 'https://path.com' }],
          get: { responses: { '200': { description: 'OK' } } },
        },
      },
    }))
    const entry = index.get('/users')?.get('get')
    expect(entry?.servers[0]?.url).toBe('https://path.com')
  })
})

describe('HTTP_METHODS', () => {
  it('trace와 query 포함', () => {
    expect(HTTP_METHODS).toContain('trace')
    expect(HTTP_METHODS).toContain('query')
  })
})

describe('matchRoute', () => {
  it('정확한 경로 매칭', () => {
    const index = loadSchema(doc({
      paths: {
        '/users': { get: { operationId: 'list', responses: { '200': { description: 'OK' } } } },
      },
    }))
    const result = matchRoute(index, 'get', '/users')
    expect(result.type).toBe('found')
    if (result.type === 'found') {
      expect(result.entry.operationId).toBe('list')
      expect(result.pathParams).toEqual({})
    }
  })

  it('path parameter 추출', () => {
    const index = loadSchema(doc({
      paths: {
        '/users/{id}': { get: { responses: { '200': { description: 'OK' } } } },
      },
    }))
    const result = matchRoute(index, 'get', '/users/123')
    expect(result.type).toBe('found')
    if (result.type === 'found') {
      expect(result.pathParams).toEqual({ id: '123' })
    }
  })

  it('정적 경로는 정의 순서와 무관하게 template 경로보다 우선한다', () => {
    const index = loadSchema(doc({
      paths: {
        '/users/{id}': { get: { operationId: 'getById', responses: { '200': { description: 'OK' } } } },
        '/users/me': { get: { operationId: 'getMe', responses: { '200': { description: 'OK' } } } },
      },
    }))

    const result = matchRoute(index, 'get', '/users/me')
    expect(result.type).toBe('found')
    if (result.type === 'found') expect(result.entry.operationId).toBe('getMe')
  })

  it('정적 경로의 지원 메서드는 앞선 template 경로의 405보다 우선한다', () => {
    const index = loadSchema(doc({
      paths: {
        '/users/{id}': { get: { operationId: 'getById', responses: { '200': { description: 'OK' } } } },
        '/users/me': { post: { operationId: 'updateMe', responses: { '200': { description: 'OK' } } } },
      },
    }))

    const result = matchRoute(index, 'post', '/users/me')
    expect(result.type).toBe('found')
    if (result.type === 'found') expect(result.entry.operationId).toBe('updateMe')
  })

  it('literal regex characters are not treated as route wildcards', () => {
    const index = loadSchema(doc({
      paths: {
        '/files.v1/{id}': { get: { operationId: 'getFile', responses: { '200': { description: 'OK' } } } },
      },
    }))

    expect(matchRoute(index, 'get', '/files.v1/42').type).toBe('found')
    expect(matchRoute(index, 'get', '/filesXv1/42').type).toBe('not_found')
  })

  it('메서드 불일치 → method_not_allowed', () => {
    const index = loadSchema(doc({
      paths: {
        '/users': { get: { responses: { '200': { description: 'OK' } } } },
      },
    }))
    const result = matchRoute(index, 'post', '/users')
    expect(result.type).toBe('method_not_allowed')
  })

  it('경로 불일치 → not_found', () => {
    const index = loadSchema(doc({ paths: {} }))
    const result = matchRoute(index, 'get', '/nonexistent')
    expect(result.type).toBe('not_found')
  })
})

describe('matchRoute cache', () => {
  it('matchRoute 캐시 — 반복 호출이 cold path보다 빨라진다', () => {
    // Build a RouteIndex with 50 routes
    const paths: Record<string, unknown> = {}
    for (let i = 0; i < 50; i++) {
      paths[`/api/v1/resource${i}/{id}`] = {
        get: { responses: { '200': { description: 'OK' } } },
      }
    }
    const index = loadSchema(doc({ paths } as any))

    const coldStart = performance.now()
    for (let i = 0; i < 50; i++) {
      matchRoute(index, 'get', `/api/v1/resource${i}/abc`)
    }
    const coldElapsed = performance.now() - coldStart

    const warmStart = performance.now()
    for (let i = 0; i < 50; i++) {
      matchRoute(index, 'get', `/api/v1/resource${i}/abc`)
    }
    const warmElapsed = performance.now() - warmStart

    expect(warmElapsed).toBeLessThan(coldElapsed)
  })
})

describe('toColonPath', () => {
  it('/users/{id} → /users/:id', () => {
    expect(toColonPath('/users/{id}')).toBe('/users/:id')
  })

  it('다중 파라미터', () => {
    expect(toColonPath('/users/{userId}/posts/{postId}')).toBe('/users/:userId/posts/:postId')
  })
})
