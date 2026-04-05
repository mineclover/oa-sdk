import { describe, it, expect } from 'vitest'
import { parseDocument, type OasDocument } from '@oa-sdk/parser'
import { generateTypes } from '../../typegen/generate-types.js'

function doc(overrides: Partial<OasDocument> = {}): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Test', version: '1.0.0' },
    paths: {},
    ...overrides,
  } as OasDocument
}

describe('generateTypes — schemas', () => {
  it('단일 스키마 → type alias', () => {
    const parsed = parseDocument(doc({
      components: {
        schemas: {
          User: {
            type: 'object',
            properties: { id: { type: 'string' }, name: { type: 'string' } },
            required: ['id', 'name'],
          },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).toContain('export type User =')
    expect(ts).toContain('id: string')
    expect(ts).toContain('name: string')
  })

  it('interface 스타일', () => {
    const parsed = parseDocument(doc({
      components: {
        schemas: {
          User: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
          },
        },
      },
    }))
    const ts = generateTypes(parsed, { style: 'interface' })
    expect(ts).toContain('export interface User {')
  })

  it('여러 스키마', () => {
    const parsed = parseDocument(doc({
      components: {
        schemas: {
          User: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
          Post: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).toContain('export type User =')
    expect(ts).toContain('export type Post =')
  })

  it('nullable 필드', () => {
    const parsed = parseDocument(doc({
      components: {
        schemas: {
          Item: {
            type: 'object',
            properties: { bio: { type: ['string', 'null'] } },
          },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).toContain('string | null')
  })

  it('enum 필드', () => {
    const parsed = parseDocument(doc({
      components: {
        schemas: {
          Status: { type: 'string', enum: ['active', 'inactive'] },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).toContain("'active' | 'inactive'")
  })
})

describe('generateTypes — operations', () => {
  it('경로 파라미터 타입', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/users/{id}': {
          get: {
            operationId: 'getUser',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).toContain('export type GetUserPathParams =')
    expect(ts).toContain('id: string')
  })

  it('쿼리 파라미터 타입', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            parameters: [
              { name: 'page', in: 'query', schema: { type: 'integer' } },
              { name: 'limit', in: 'query', schema: { type: 'integer' } },
            ],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).toContain('export type ListUsersQueryParams =')
    expect(ts).toContain('page?: number')
    expect(ts).toContain('limit?: number')
  })

  it('요청 바디 타입', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { name: { type: 'string' }, email: { type: 'string' } },
                    required: ['name', 'email'],
                  },
                },
              },
            },
            responses: { '201': { description: 'Created' } },
          },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).toContain('export type CreateUserBody =')
    expect(ts).toContain('name: string')
    expect(ts).toContain('email: string')
  })

  it('응답 타입 (2xx)', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).toContain('export type ListUsersResponse =')
    expect(ts).toContain('[]')
  })

  it('operationId 없으면 타입 생성 스킵', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/health': {
          get: { responses: { '200': { description: 'OK' } } },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).not.toContain('PathParams')
    expect(ts).not.toContain('Response')
  })

  it('banner 비활성화', () => {
    const parsed = parseDocument(doc({ components: { schemas: { X: { type: 'string' } } } }))
    const ts = generateTypes(parsed, { banner: false })
    expect(ts).not.toContain('Auto-generated')
  })
})
