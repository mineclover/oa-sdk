/**
 * parseDocument 엣지케이스 테스트
 */
import { describe, it, expect } from 'vitest'
import { parseDocument } from '../parse.js'
import type { OasDocument } from '../oas32-types.js'

function doc(overrides: Partial<OasDocument> = {}): OasDocument {
  return { openapi: '3.2.0', info: { title: 'T', version: '0' }, paths: {}, ...overrides } as OasDocument
}

describe('빈 / 최소 스펙', () => {
  it('paths 비어있음 → operations 빈 배열', () => {
    const parsed = parseDocument(doc())
    expect(parsed.operations).toHaveLength(0)
    expect(parsed.schemas).toEqual({})
  })

  it('paths undefined → operations 빈 배열', () => {
    const { paths: _, ...specWithoutPaths } = doc()
    const parsed = parseDocument(specWithoutPaths as OasDocument)
    expect(parsed.operations).toHaveLength(0)
  })

  it('info 보존', () => {
    const parsed = parseDocument(doc({ info: { title: 'My API', version: '2.0.0', description: '설명' } }))
    expect(parsed.info.title).toBe('My API')
    expect(parsed.info.version).toBe('2.0.0')
    expect(parsed.info.description).toBe('설명')
  })
})

describe('global security 상속', () => {
  it('global security → operation에 상속', () => {
    const parsed = parseDocument(doc({
      security: [{ bearerAuth: [] }],
      paths: {
        '/users': { get: { operationId: 'listUsers', responses: { '200': { description: 'OK' } } } },
      },
    }))
    expect(parsed.operations[0]!.security).toEqual([{ bearerAuth: [] }])
  })

  it('operation security가 global 오버라이드', () => {
    const parsed = parseDocument(doc({
      security: [{ bearerAuth: [] }],
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            security: [{ apiKey: [] }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    expect(parsed.operations[0]!.security).toEqual([{ apiKey: [] }])
  })

  it('operation security: [] → 인증 불필요', () => {
    const parsed = parseDocument(doc({
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
    expect(parsed.operations[0]!.security).toEqual([])
  })
})

describe('global servers 상속', () => {
  it('servers → parsed에 보존', () => {
    const parsed = parseDocument(doc({
      servers: [{ url: 'https://api.example.com' }, { url: 'https://staging.api.com' }],
    }))
    expect(parsed.servers).toHaveLength(2)
    expect(parsed.servers[0]!.url).toBe('https://api.example.com')
  })

  it('servers 없으면 빈 배열', () => {
    const parsed = parseDocument(doc())
    expect(parsed.servers).toEqual([])
  })
})

describe('tags 인덱싱', () => {
  it('tags 정의 → Map으로 인덱싱', () => {
    const parsed = parseDocument(doc({
      tags: [
        { name: 'users', description: '사용자 관리' },
        { name: 'posts', description: '게시글' },
      ],
    }))
    expect(parsed.tags.size).toBe(2)
    expect(parsed.tags.get('users')?.description).toBe('사용자 관리')
  })

  it('tags 없으면 빈 Map', () => {
    const parsed = parseDocument(doc())
    expect(parsed.tags.size).toBe(0)
  })
})

describe('schemas 추출', () => {
  it('components/schemas → schemas 맵', () => {
    const parsed = parseDocument(doc({
      components: {
        schemas: {
          User: { type: 'object', properties: { id: { type: 'string' } } },
          Post: { type: 'object', properties: { title: { type: 'string' } } },
        },
      },
    }))
    expect(Object.keys(parsed.schemas)).toEqual(['User', 'Post'])
  })

  it('components 없으면 빈 schemas', () => {
    const parsed = parseDocument(doc())
    expect(parsed.schemas).toEqual({})
  })
})

describe('parameters 병합', () => {
  it('pathItem-level + operation-level parameters 병합', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/users/{id}': {
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          get: {
            operationId: 'getUser',
            parameters: [{ name: 'fields', in: 'query', schema: { type: 'string' } }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    const op = parsed.operations[0]!
    expect(op.parameters).toHaveLength(2)
    expect(op.parameters.map(p => p.name)).toContain('id')
    expect(op.parameters.map(p => p.name)).toContain('fields')
  })
})

describe('webhooks 추출', () => {
  it('webhooks → webhooks 배열', () => {
    const parsed = parseDocument(doc({
      webhooks: {
        orderCreated: {
          post: {
            operationId: 'onOrderCreated',
            requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    expect(parsed.webhooks).toHaveLength(1)
    expect(parsed.webhooks[0]!.operationId).toBe('onOrderCreated')
  })

  it('webhooks 없으면 빈 배열', () => {
    const parsed = parseDocument(doc())
    expect(parsed.webhooks).toEqual([])
  })
})

describe('deprecated 플래그', () => {
  it('deprecated operation → 플래그 보존', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/old': {
          get: { operationId: 'oldEndpoint', deprecated: true, responses: { '200': { description: 'OK' } } },
        },
      },
    }))
    expect(parsed.operations[0]!.deprecated).toBe(true)
  })
})

describe('다중 response 코드', () => {
  it('여러 status code → responses 맵으로 보존', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
            responses: {
              '201': { description: 'Created' },
              '400': { description: 'Bad Request' },
              '409': { description: 'Conflict' },
            },
          },
        },
      },
    }))
    const op = parsed.operations[0]!
    expect(Object.keys(op.responses)).toEqual(expect.arrayContaining(['201', '400', '409']))
  })
})
