import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseDocument } from '../parse.js'
import type { DerefDiagnostic } from '../deref.js'
import type { OasDocument } from '../oas32-types.js'

function doc(overrides: Partial<OasDocument> = {}): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Test', version: '1.0.0' },
    paths: {},
    ...overrides,
  } as OasDocument
}

describe('parseDocument', () => {
  it('최소 문서 파싱', () => {
    const result = parseDocument(doc())
    expect(result.openapi).toBe('3.2.0')
    expect(result.info.title).toBe('Test')
    expect(result.operations).toHaveLength(0)
    expect(result.routes.size).toBe(0)
  })

  it('paths에서 오퍼레이션 추출', () => {
    const result = parseDocument(doc({
      paths: {
        '/users': {
          get: { operationId: 'listUsers', responses: { '200': { description: 'OK' } } },
          post: { operationId: 'createUser', responses: { '201': { description: 'Created' } } },
        },
      },
    }))
    expect(result.operations).toHaveLength(2)
    expect(result.operations.map(o => o.operationId).sort()).toEqual(['createUser', 'listUsers'])
  })

  it('RouteIndex에 올바르게 인덱싱', () => {
    const result = parseDocument(doc({
      paths: {
        '/users': { get: { responses: { '200': { description: 'OK' } } } },
        '/posts': { get: { responses: { '200': { description: 'OK' } } } },
      },
    }))
    expect(result.routes.size).toBe(2)
    expect(result.routes.get('/users')?.has('get')).toBe(true)
    expect(result.routes.get('/posts')?.has('get')).toBe(true)
  })

  it('tags 인덱싱', () => {
    const result = parseDocument(doc({
      tags: [
        { name: 'users', description: '사용자' },
        { name: 'posts', description: '게시글' },
      ],
    }))
    expect(result.tags.size).toBe(2)
    expect(result.tags.get('users')?.description).toBe('사용자')
  })

  it('servers 추출', () => {
    const result = parseDocument(doc({
      servers: [{ url: 'https://api.example.com' }],
    }))
    expect(result.servers).toHaveLength(1)
    expect(result.servers[0]!.url).toBe('https://api.example.com')
  })

  it('securitySchemes 추출', () => {
    const result = parseDocument(doc({
      components: {
        securitySchemes: {
          bearer: { type: 'http', scheme: 'bearer' },
        },
      },
    }))
    expect(result.securitySchemes['bearer']).toBeDefined()
    expect(result.securitySchemes['bearer']!.scheme).toBe('bearer')
  })

  it('global security 추출', () => {
    const result = parseDocument(doc({
      security: [{ bearer: [] }],
    }))
    expect(result.security).toHaveLength(1)
  })

  it('schemas 추출', () => {
    const result = parseDocument(doc({
      components: {
        schemas: {
          User: { type: 'object', properties: { id: { type: 'string' } } },
        },
      },
    }))
    expect(result.schemas['User']).toBeDefined()
    expect(result.schemas['User']!.type).toBe('object')
  })

  it('components.requestBodies 추출', () => {
    const result = parseDocument(doc({
      components: {
        requestBodies: {
          CreateUser: { content: { 'application/json': { schema: { type: 'object' } } } },
        },
      },
    }))
    expect(result.components.requestBodies['CreateUser']).toBeDefined()
  })

  it('오퍼레이션에 tags/deprecated/summary 전달', () => {
    const result = parseDocument(doc({
      paths: {
        '/users': {
          get: {
            tags: ['users'],
            summary: '사용자 목록',
            deprecated: true,
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    const op = result.operations[0]!
    expect(op.tags).toEqual(['users'])
    expect(op.summary).toBe('사용자 목록')
    expect(op.deprecated).toBe(true)
  })

  it('global security를 오퍼레이션에 상속', () => {
    const result = parseDocument(doc({
      security: [{ bearer: [] }],
      paths: {
        '/users': { get: { responses: { '200': { description: 'OK' } } } },
      },
    }))
    const op = result.operations[0]!
    expect(op.security).toEqual([{ bearer: [] }])
  })

  it('오퍼레이션 security가 global을 오버라이드', () => {
    const result = parseDocument(doc({
      security: [{ bearer: [] }],
      paths: {
        '/public': {
          get: { security: [], responses: { '200': { description: 'OK' } } },
        },
      },
    }))
    const op = result.operations[0]!
    expect(op.security).toEqual([])
  })

  it('path-level + operation-level 파라미터 병합', () => {
    const result = parseDocument(doc({
      paths: {
        '/users/{id}': {
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          get: {
            parameters: [{ name: 'fields', in: 'query', schema: { type: 'string' } }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    const op = result.operations[0]!
    expect(op.parameters).toHaveLength(2)
    expect(op.parameters.map(p => p.name).sort()).toEqual(['fields', 'id'])
  })

  it('local operation parameter/response $ref를 deref pass 없이 해소한다', () => {
    const result = parseDocument(doc({
      components: {
        parameters: {
          UserId: { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          Page: { name: 'page', in: 'query', schema: { type: 'integer' } },
        },
        responses: {
          UserList: {
            description: 'Users',
            content: {
              'application/json': {
                schema: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      paths: {
        '/users/{id}': {
          parameters: [{ $ref: '#/components/parameters/UserId' }],
          get: {
            parameters: [{ $ref: '#/components/parameters/Page' }],
            responses: { '200': { $ref: '#/components/responses/UserList' } },
          },
        },
      },
    }), [])

    const op = result.operations[0]!
    expect(op.parameters.map(p => p.name).sort()).toEqual(['id', 'page'])
    expect(op.responses['200']?.description).toBe('Users')
  })

  it('webhooks 별도 추출 (routes에 미포함)', () => {
    const result = parseDocument(doc({
      webhooks: {
        newUser: {
          post: { operationId: 'onNewUser', responses: { '200': { description: 'OK' } } },
        },
      },
    }))
    expect(result.webhooks).toHaveLength(1)
    expect(result.webhooks[0]!.operationId).toBe('onNewUser')
    // webhooks는 routes에 미포함
    expect(result.routes.size).toBe(0)
  })

  it('$ref 해결 (derefPass 기본 적용)', () => {
    const result = parseDocument(doc({
      components: {
        schemas: { User: { type: 'object', properties: { name: { type: 'string' } } } },
      },
      paths: {
        '/users': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/User' } },
                },
              },
            },
          },
        },
      },
    }))
    const response = result.operations[0]!.responses['200']!
    const content = response.content!['application/json'] as Record<string, unknown>
    const schema = content['schema'] as Record<string, unknown>
    // $ref가 해결되어 실제 스키마가 인라인됨
    expect(schema['type']).toBe('object')
    expect((schema['properties'] as Record<string, unknown>)['name']).toEqual({ type: 'string' })
  })

  it('basePath 옵션으로 외부 YAML $ref를 해소한다', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-parse-'))
    const mainFile = join(tmp, 'api.yaml')
    const sharedFile = join(tmp, 'shared.yaml')
    writeFileSync(sharedFile, [
      'components:',
      '  schemas:',
      '    User:',
      '      type: object',
      '      properties:',
      '        id:',
      '          type: string',
      '',
    ].join('\n'))

    try {
      const result = parseDocument(doc({
        paths: {
          '/users': {
            get: {
              responses: {
                '200': {
                  description: 'OK',
                  content: {
                    'application/json': { schema: { $ref: './shared.yaml#/components/schemas/User' } },
                  },
                },
              },
            },
          },
        },
      }), { basePath: mainFile })

      const response = result.operations[0]!.responses['200']!
      const content = response.content!['application/json'] as Record<string, unknown>
      const schema = content['schema'] as Record<string, unknown>
      expect(schema['type']).toBe('object')
      expect((schema['properties'] as Record<string, unknown>)['id']).toEqual({ type: 'string' })
      expect(result.resolution).toEqual({ status: 'complete', scope: 'all', diagnostics: [] })
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('cycleStrategy preserve-ref 옵션을 deref에 전달한다', () => {
    const diagnostics: DerefDiagnostic[] = []
    const result = parseDocument(doc({
      components: {
        schemas: {
          Node: {
            type: 'object',
            properties: {
              child: { $ref: '#/components/schemas/Node' },
            },
          },
        },
      },
    }), { cycleStrategy: 'preserve-ref', derefDiagnostics: diagnostics })

    expect((result.schemas['Node']?.properties?.['child'] as any).properties.child).toEqual({ $ref: '#/components/schemas/Node' })
    expect(diagnostics.some(d => d.code === 'ref-cycle')).toBe(true)
  })

  it('raw 원본 문서 보존', () => {
    const original = doc()
    const result = parseDocument(original)
    expect(result.raw).toBe(original)
  })
})
