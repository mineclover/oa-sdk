import { describe, it, expect } from 'vitest'
import { parseDocument } from '../parse.js'
import { findOperation, findByTag, findByPath, getSchema, groupByTag, describeApi } from '../query.js'
import type { OasDocument } from '../oas32-types.js'

const spec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Test API', version: '1.0.0', description: '테스트' },
  servers: [{ url: 'https://api.example.com' }],
  tags: [
    { name: 'users', description: '사용자 관리' },
    { name: 'posts', description: '게시글' },
  ],
  components: {
    schemas: {
      User: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      Post: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
    },
  },
  paths: {
    '/users': {
      get: { operationId: 'listUsers', tags: ['users'], summary: '사용자 목록', responses: { '200': { description: 'OK' } } },
      post: { operationId: 'createUser', tags: ['users'], summary: '사용자 생성', responses: { '201': { description: 'Created' } } },
    },
    '/users/{id}': {
      get: { operationId: 'getUser', tags: ['users'], deprecated: true, responses: { '200': { description: 'OK' } } },
    },
    '/posts': {
      get: { operationId: 'listPosts', tags: ['posts'], responses: { '200': { description: 'OK' } } },
    },
  },
} as OasDocument

const doc = parseDocument(spec)

describe('findOperation', () => {
  it('operationId로 검색', () => {
    const op = findOperation(doc, 'listUsers')
    expect(op?.operationId).toBe('listUsers')
    expect(op?.method).toBe('get')
  })

  it('없는 operationId → undefined', () => {
    expect(findOperation(doc, 'nonexistent')).toBeUndefined()
  })
})

describe('findByTag', () => {
  it('users 태그 → 3개', () => {
    const ops = findByTag(doc, 'users')
    expect(ops).toHaveLength(3)
  })

  it('posts 태그 → 1개', () => {
    expect(findByTag(doc, 'posts')).toHaveLength(1)
  })
})

describe('findByPath', () => {
  it('경로만', () => {
    expect(findByPath(doc, '/users')).toHaveLength(2)
  })

  it('경로 + 메서드', () => {
    const ops = findByPath(doc, '/users', 'post')
    expect(ops).toHaveLength(1)
    expect(ops[0]!.operationId).toBe('createUser')
  })
})

describe('getSchema', () => {
  it('User 스키마', () => {
    const schema = getSchema(doc, 'User')
    expect(schema?.type).toBe('object')
  })

  it('없는 스키마 → undefined', () => {
    expect(getSchema(doc, 'Nonexistent')).toBeUndefined()
  })
})

describe('groupByTag', () => {
  it('태그별 그룹핑', () => {
    const groups = groupByTag(doc)
    expect(groups.get('users')).toHaveLength(3)
    expect(groups.get('posts')).toHaveLength(1)
  })
})

describe('describeApi', () => {
  it('API 요약 생성', () => {
    const summary = describeApi(doc)
    expect(summary).toContain('Test API v1.0.0')
    expect(summary).toContain('[users]')
    expect(summary).toContain('[posts]')
    expect(summary).toContain('GET /users')
    expect(summary).toContain('(deprecated)')
    expect(summary).toContain('스키마: 2개')
    expect(summary).toContain('오퍼레이션: 4개')
  })
})
