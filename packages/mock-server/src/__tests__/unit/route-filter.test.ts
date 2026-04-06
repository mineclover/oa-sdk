/**
 * route-filter.ts — filterRouteIndex 단위 테스트
 */
import { describe, it, expect } from 'vitest'
import { filterRouteIndex, type RouteFilter } from '../../core/route-filter.js'
import type { RouteIndex, HttpMethod, OperationEntry } from '@oa-sdk/parser'

// ─── 테스트용 RouteIndex 빌더 ──────────────────────────────────────────────

function entry(overrides: Partial<OperationEntry> = {}): OperationEntry {
  return {
    openApiPath: '',
    method: 'get' as HttpMethod,
    tags: [],
    deprecated: false,
    parameters: [],
    responses: {},
    security: [],
    servers: [],
    callbacks: {},
    ...overrides,
  }
}

function buildIndex(routes: Record<string, Record<string, Partial<OperationEntry>>>): RouteIndex {
  const index: RouteIndex = new Map()
  for (const [path, methods] of Object.entries(routes)) {
    const methodMap = new Map<HttpMethod, OperationEntry>()
    for (const [method, overrides] of Object.entries(methods)) {
      methodMap.set(method as HttpMethod, entry({ openApiPath: path, method: method as HttpMethod, ...overrides }))
    }
    index.set(path, methodMap)
  }
  return index
}

const fullIndex = buildIndex({
  '/health': { get: { operationId: 'healthCheck' } },
  '/users': { get: { operationId: 'listUsers', tags: ['users'] }, post: { operationId: 'createUser', tags: ['users'] } },
  '/users/{id}': { get: { operationId: 'getUser', tags: ['users'] }, delete: { operationId: 'deleteUser', tags: ['users'] } },
  '/orgs': { get: { operationId: 'listOrgs', tags: ['orgs'] } },
  '/orgs/{orgId}': { get: { operationId: 'getOrg', tags: ['orgs'] } },
  '/orgs/{orgId}/projects': { get: { operationId: 'listProjects', tags: ['orgs', 'projects'] }, post: { operationId: 'createProject', tags: ['projects'] } },
  '/orgs/{orgId}/projects/{id}': { get: { operationId: 'getProject', tags: ['projects'] } },
  '/admin/settings': { get: { operationId: 'getSettings', tags: ['admin'] }, put: { operationId: 'updateSettings', tags: ['admin'], deprecated: true } },
})

// ─── 기본 동작 ─────────────────────────────────────────────────────────────

describe('filterRouteIndex — 기본 동작', () => {
  it('filter undefined → 원본 그대로', () => {
    const result = filterRouteIndex(fullIndex, undefined)
    expect(result).toBe(fullIndex)
  })

  it('빈 filter → 원본 그대로', () => {
    const result = filterRouteIndex(fullIndex, {})
    expect(result).toBe(fullIndex)
  })

  it('모든 조건이 빈 배열 → 원본 그대로', () => {
    const result = filterRouteIndex(fullIndex, { paths: [], operations: [], tags: [] })
    expect(result).toBe(fullIndex)
  })
})

// ─── paths prefix 필터 ─────────────────────────────────────────────────────

describe('filterRouteIndex — paths prefix', () => {
  it('/users → /users, /users/{id} 포함', () => {
    const result = filterRouteIndex(fullIndex, { paths: ['/users'] })
    const paths = [...result.keys()]
    expect(paths).toEqual(['/users', '/users/{id}'])
  })

  it('/orgs → /orgs 하위 전체 포함 (/orgs/{orgId}/projects/{id} 까지)', () => {
    const result = filterRouteIndex(fullIndex, { paths: ['/orgs'] })
    const paths = [...result.keys()]
    expect(paths).toEqual(['/orgs', '/orgs/{orgId}', '/orgs/{orgId}/projects', '/orgs/{orgId}/projects/{id}'])
  })

  it('정확한 경로만 — /health는 /heal로 안 잡힘', () => {
    const result = filterRouteIndex(fullIndex, { paths: ['/heal'] })
    expect(result.size).toBe(0)
  })

  it('정확히 일치하는 경로도 포함 — /health', () => {
    const result = filterRouteIndex(fullIndex, { paths: ['/health'] })
    expect([...result.keys()]).toEqual(['/health'])
  })

  it('여러 prefix OR', () => {
    const result = filterRouteIndex(fullIndex, { paths: ['/health', '/admin'] })
    expect([...result.keys()]).toEqual(['/health', '/admin/settings'])
  })
})

// ─── operations 필터 ────────────────────────────────────────────────────────

describe('filterRouteIndex — operations', () => {
  it('특정 operationId만 포함', () => {
    const result = filterRouteIndex(fullIndex, { operations: ['listUsers', 'getUser'] })
    const paths = [...result.keys()]
    expect(paths).toEqual(['/users', '/users/{id}'])
    // /users에서 post (createUser)는 제외
    expect(result.get('/users')!.has('post' as HttpMethod)).toBe(false)
    expect(result.get('/users')!.has('get' as HttpMethod)).toBe(true)
  })

  it('하나만 지정 → 해당 메서드만', () => {
    const result = filterRouteIndex(fullIndex, { operations: ['createUser'] })
    expect([...result.keys()]).toEqual(['/users'])
    expect(result.get('/users')!.has('post' as HttpMethod)).toBe(true)
    expect(result.get('/users')!.has('get' as HttpMethod)).toBe(false)
  })

  it('존재하지 않는 operationId → 빈 결과', () => {
    const result = filterRouteIndex(fullIndex, { operations: ['nonexistent'] })
    expect(result.size).toBe(0)
  })
})

// ─── tags 필터 ──────────────────────────────────────────────────────────────

describe('filterRouteIndex — tags', () => {
  it('users 태그 → /users 관련 전부', () => {
    const result = filterRouteIndex(fullIndex, { tags: ['users'] })
    const paths = [...result.keys()]
    expect(paths).toEqual(['/users', '/users/{id}'])
  })

  it('projects 태그 → 프로젝트 관련 (orgs/projects 중첩 포함)', () => {
    const result = filterRouteIndex(fullIndex, { tags: ['projects'] })
    const paths = [...result.keys()]
    expect(paths).toEqual(['/orgs/{orgId}/projects', '/orgs/{orgId}/projects/{id}'])
    // /orgs/{orgId}/projects에서 get (tags: ['orgs', 'projects'])도 포함
    expect(result.get('/orgs/{orgId}/projects')!.has('get' as HttpMethod)).toBe(true)
  })

  it('multi-tag operation은 어느 태그든 매칭', () => {
    const result = filterRouteIndex(fullIndex, { tags: ['orgs'] })
    // listOrgs, getOrg, listProjects (tags: ['orgs', 'projects']) 포함
    expect(result.has('/orgs/{orgId}/projects')).toBe(true)
    // listProjects만 포함, createProject (tags: ['projects'])는 미포함
    expect(result.get('/orgs/{orgId}/projects')!.has('get' as HttpMethod)).toBe(true)
    expect(result.get('/orgs/{orgId}/projects')!.has('post' as HttpMethod)).toBe(false)
  })
})

// ─── 커스텀 filter ──────────────────────────────────────────────────────────

describe('filterRouteIndex — custom filter', () => {
  it('deprecated 제외', () => {
    const result = filterRouteIndex(fullIndex, {
      filter: (_path, _method, e) => !e.deprecated,
    })
    // /admin/settings에서 put (deprecated: true) 제외, get은 유지
    expect(result.get('/admin/settings')!.has('get' as HttpMethod)).toBe(true)
    expect(result.get('/admin/settings')!.has('put' as HttpMethod)).toBe(false)
  })

  it('GET 메서드만', () => {
    const result = filterRouteIndex(fullIndex, {
      filter: (_path, method) => method === 'get',
    })
    for (const [, methodMap] of result) {
      for (const [method] of methodMap) {
        expect(method).toBe('get')
      }
    }
  })
})

// ─── OR 조합 ────────────────────────────────────────────────────────────────

describe('filterRouteIndex — OR 조합', () => {
  it('paths + operations → 합집합', () => {
    const result = filterRouteIndex(fullIndex, {
      paths: ['/health'],
      operations: ['listOrgs'],
    })
    const paths = [...result.keys()]
    expect(paths).toEqual(['/health', '/orgs'])
  })

  it('tags + operations → 합집합', () => {
    const result = filterRouteIndex(fullIndex, {
      tags: ['admin'],
      operations: ['healthCheck'],
    })
    const paths = [...result.keys()]
    expect(paths).toEqual(['/health', '/admin/settings'])
  })

  it('paths + tags + filter → 모두 OR', () => {
    const result = filterRouteIndex(fullIndex, {
      paths: ['/health'],
      tags: ['admin'],
      filter: (_p, _m, e) => e.operationId === 'createUser',
    })
    const paths = [...result.keys()]
    expect(paths).toEqual(['/health', '/users', '/admin/settings'])
    // /users에서 createUser만 포함
    expect(result.get('/users')!.size).toBe(1)
    expect(result.get('/users')!.has('post' as HttpMethod)).toBe(true)
  })
})
