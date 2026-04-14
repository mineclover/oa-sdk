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

describe('generateTypes — Op 번들 타입', () => {
  it('Op 번들 타입 — GET with path params', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/users/{id}': {
          get: {
            operationId: 'getUser',
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            ],
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { id: { type: 'string' }, name: { type: 'string' } },
                      required: ['id', 'name'],
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
    expect(ts).toContain('export type GetUserOp =')
    expect(ts).toContain("method: 'get'")
    expect(ts).toContain("path: '/users/{id}'")
    expect(ts).toContain('params: GetUserPathParams')
    expect(ts).toContain('response: GetUserResponse')
  })

  it('Op 번들 타입 — POST with body', () => {
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
    expect(ts).toContain('export type CreateUserOp =')
    expect(ts).toContain("method: 'post'")
    expect(ts).toContain("path: '/users'")
    expect(ts).toContain('body: CreateUserBody')
    // no path params or query params in this op
    expect(ts).not.toContain('params: CreateUserPathParams')
    expect(ts).not.toContain('query: CreateUserQueryParams')
  })

  it('Op 번들 타입 — no body no params', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/health': {
          get: {
            operationId: 'healthCheck',
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).toContain('export type HealthCheckOp =')
    expect(ts).toContain("method: 'get'")
    expect(ts).toContain("path: '/health'")
    // no body, no params, no response content
    expect(ts).not.toContain('body: HealthCheckBody')
    expect(ts).not.toContain('params: HealthCheckPathParams')
    expect(ts).not.toContain('response: HealthCheckResponse')
  })
})

describe('generateTypes — Error response types', () => {
  it('4xx 에러 응답 스키마 → Error 타입 생성', () => {
    const spec = {
      openapi: '3.2.0', info: { title: 'Test', version: '0.0.0' },
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } } } },
            responses: {
              '201': { description: 'Created', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' } } } } } },
              '422': { description: 'Validation Error', content: { 'application/json': { schema: { type: 'object', required: ['error'], properties: { error: { type: 'string' }, details: { type: 'array', items: { type: 'string' } } } } } } },
            },
          },
        },
      },
    }
    const output = generateTypes(parseDocument(spec as any))
    expect(output).toContain('export type CreateUserError')
    expect(output).toContain('error: string')
  })

  it('Error 타입이 Op 번들에 포함', () => {
    const spec = {
      openapi: '3.2.0', info: { title: 'Test', version: '0.0.0' },
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } } },
            responses: {
              '201': { description: 'Created' },
              '400': { description: 'Bad Request', content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' } } } } } },
            },
          },
        },
      },
    }
    const output = generateTypes(parseDocument(spec as any))
    expect(output).toContain('error?: CreateUserError')
  })

  it('에러 응답 없으면 Error 타입 미생성', () => {
    const spec = {
      openapi: '3.2.0', info: { title: 'Test', version: '0.0.0' },
      paths: {
        '/health': {
          get: {
            operationId: 'healthCheck',
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }
    const output = generateTypes(parseDocument(spec as any))
    expect(output).not.toContain('Error')
  })
})

describe('generateTypes — Response headers', () => {
  it('응답 헤더가 있으면 ResponseHeaders 타입 생성', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: {
              '200': {
                description: 'OK',
                headers: {
                  'X-Rate-Limit': { schema: { type: 'integer' } },
                  'X-Rate-Remaining': { schema: { type: 'integer' }, required: true },
                },
                content: {
                  'application/json': {
                    schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } },
                  },
                },
              },
            },
          },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).toContain('export type ListUsersResponseHeaders =')
    expect(ts).toContain("'X-Rate-Limit'")
    expect(ts).toContain("'X-Rate-Remaining'")
    // ResponseHeaders should also appear in the Op bundle
    expect(ts).toContain('responseHeaders: ListUsersResponseHeaders')
  })
})

describe('generateTypes — schema/operation 이름 충돌 방지', () => {
  it('스키마 이름이 Op Body 이름과 충돌하면 중복 생성 안 함', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CreateUserBody' },
                },
              },
            },
            responses: { '201': { description: 'Created' } },
          },
        },
      },
      components: {
        schemas: {
          CreateUserBody: {
            type: 'object',
            required: ['name'],
            properties: { name: { type: 'string' } },
          },
        },
      },
    }))
    const ts = generateTypes(parsed)
    // CreateUserBody는 schema에서 1번만 정의
    const matches = ts.match(/export type CreateUserBody/g)
    expect(matches).toHaveLength(1)
    // 자기참조 없음
    expect(ts).not.toContain('export type CreateUserBody = CreateUserBody')
  })

  it('스키마 이름이 Op Response 이름과 충돌하면 중복 생성 안 함', () => {
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
                    schema: { $ref: '#/components/schemas/ListUsersResponse' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          ListUsersResponse: {
            type: 'array',
            items: { type: 'object', properties: { id: { type: 'string' } } },
          },
        },
      },
    }))
    const ts = generateTypes(parsed)
    const matches = ts.match(/export type ListUsersResponse/g)
    expect(matches).toHaveLength(1)
  })

  it('충돌 없는 경우 정상 생성', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { name: { type: 'string' } } },
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
    expect(ts).toContain('export type CreateUserOp =')
  })
})
