import { describe, it, expect } from 'vitest'
import { parseDocument } from '../parse.js'
import { groupByTag, getTag, describeApi } from '../query.js'
import type { OasDocument } from '../oas32-types.js'

function doc(overrides: Partial<OasDocument> = {}): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'T', version: '0' },
    paths: {},
    ...overrides,
  } as OasDocument
}

describe('Tags', () => {
  it('tags indexed by name in ParsedDocument', () => {
    const result = parseDocument(doc({
      tags: [
        { name: 'users' },
        { name: 'posts' },
      ],
    }))
    expect(result.tags.size).toBe(2)
    expect(result.tags.has('users')).toBe(true)
    expect(result.tags.has('posts')).toBe(true)
    expect(result.tags.get('users')!.name).toBe('users')
  })

  it('tag description preserved', () => {
    const result = parseDocument(doc({
      tags: [{ name: 'users', description: 'User management endpoints' }],
    }))
    expect(result.tags.get('users')!.description).toBe('User management endpoints')
  })

  it('tag summary (3.2 new) preserved', () => {
    const result = parseDocument(doc({
      tags: [{ name: 'users', summary: 'Users API' }],
    }))
    expect(result.tags.get('users')!.summary).toBe('Users API')
  })

  it('tag parent (3.2 new) preserved', () => {
    const result = parseDocument(doc({
      tags: [
        { name: 'admin' },
        { name: 'admin-users', parent: 'admin' },
      ],
    }))
    expect(result.tags.get('admin-users')!.parent).toBe('admin')
    expect(result.tags.get('admin')!.parent).toBeUndefined()
  })

  it('tag kind (3.2 new) preserved', () => {
    const result = parseDocument(doc({
      tags: [{ name: 'users', kind: 'resource' }],
    }))
    expect(result.tags.get('users')!.kind).toBe('resource')
  })

  it('operations grouped by tag correctly', () => {
    const parsed = parseDocument(doc({
      tags: [{ name: 'users' }, { name: 'posts' }],
      paths: {
        '/users': {
          get: { tags: ['users'], operationId: 'listUsers', responses: { '200': { description: 'OK' } } },
        },
        '/posts': {
          get: { tags: ['posts'], operationId: 'listPosts', responses: { '200': { description: 'OK' } } },
          post: { tags: ['posts'], operationId: 'createPost', responses: { '201': { description: 'Created' } } },
        },
      },
    }))
    const groups = groupByTag(parsed)
    expect(groups.get('users')).toHaveLength(1)
    expect(groups.get('users')![0]!.operationId).toBe('listUsers')
    expect(groups.get('posts')).toHaveLength(2)
    expect(groups.get('posts')!.map(o => o.operationId).sort()).toEqual(['createPost', 'listPosts'])
  })

  it('untagged operations grouped as "untagged"', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/health': {
          get: { operationId: 'healthCheck', responses: { '200': { description: 'OK' } } },
        },
      },
    }))
    const groups = groupByTag(parsed)
    expect(groups.has('untagged')).toBe(true)
    expect(groups.get('untagged')).toHaveLength(1)
    expect(groups.get('untagged')![0]!.operationId).toBe('healthCheck')
  })

  it('describeApi includes tag descriptions', () => {
    const parsed = parseDocument(doc({
      tags: [{ name: 'users', description: 'User management' }],
      paths: {
        '/users': {
          get: { tags: ['users'], operationId: 'listUsers', summary: 'List users', responses: { '200': { description: 'OK' } } },
        },
      },
    }))
    const output = describeApi(parsed)
    expect(output).toContain('[users]')
    expect(output).toContain('User management')
    expect(output).toContain('GET /users')
    expect(output).toContain('List users')
  })

  it('getTag returns undefined for non-existent tag', () => {
    const parsed = parseDocument(doc({
      tags: [{ name: 'users' }],
    }))
    expect(getTag(parsed, 'nonexistent')).toBeUndefined()
  })

  it('multiple tags per operation', () => {
    const parsed = parseDocument(doc({
      tags: [{ name: 'users' }, { name: 'admin' }],
      paths: {
        '/admin/users': {
          get: { tags: ['users', 'admin'], operationId: 'adminListUsers', responses: { '200': { description: 'OK' } } },
        },
      },
    }))
    const groups = groupByTag(parsed)
    expect(groups.get('users')).toHaveLength(1)
    expect(groups.get('admin')).toHaveLength(1)
    expect(groups.get('users')![0]!.operationId).toBe('adminListUsers')
    expect(groups.get('admin')![0]!.operationId).toBe('adminListUsers')
  })
})
