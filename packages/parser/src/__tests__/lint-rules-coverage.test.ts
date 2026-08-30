/**
 * lint 규칙 전체 커버리지 — 기존 lint.test.ts 보강
 */
import { describe, it, expect } from 'vitest'
import { lintDocument } from '../lint.js'

function doc(overrides: Record<string, unknown> = {}) {
  return { openapi: '3.2.0', info: { title: 'T', version: '0' }, paths: {}, ...overrides }
}

describe('structure 규칙 보강', () => {
  it('유효하지 않은 openapi 버전', () => {
    const results = lintDocument({ openapi: '2.0.0', info: { title: 'T', version: '0' } })
    expect(results.some(r => r.rule === 'structure/openapi-version' && r.message.includes('지원하지 않는'))).toBe(true)
  })

  it('info.title 누락', () => {
    const results = lintDocument({ openapi: '3.2.0', info: { version: '0' } })
    expect(results.some(r => r.rule === 'structure/info-title')).toBe(true)
  })

  it('info.version 누락', () => {
    const results = lintDocument({ openapi: '3.2.0', info: { title: 'T' } })
    expect(results.some(r => r.rule === 'structure/info-version')).toBe(true)
  })

  it('null/배열 input → 에러', () => {
    const results = lintDocument(null as any)
    expect(results.some(r => r.rule === 'structure/valid-document')).toBe(true)
  })
})

describe('operations 규칙 보강', () => {
  it('operationId 고유하면 에러 없음', () => {
    const results = lintDocument(doc({
      paths: {
        '/a': { get: { operationId: 'aOp', responses: { '200': {} } } },
        '/b': { get: { operationId: 'bOp', responses: { '200': {} } } },
      },
    }), { categories: ['operations'] })
    expect(results.filter(r => r.severity === 'error')).toHaveLength(0)
  })
})

describe('parameters 규칙 보강', () => {
  it('path param required: true면 에러 없음', () => {
    const results = lintDocument(doc({
      paths: {
        '/users/{id}': {
          get: {
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': {} },
          },
        },
      },
    }), { categories: ['parameters'] })
    expect(results.filter(r => r.severity === 'error')).toHaveLength(0)
  })

  it('query param은 required 없어도 됨', () => {
    const results = lintDocument(doc({
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }],
            responses: { '200': {} },
          },
        },
      },
    }), { categories: ['parameters'] })
    expect(results.filter(r => r.severity === 'error')).toHaveLength(0)
  })
})

describe('security 규칙 보강', () => {
  it('operation-level security에 정의 안 된 scheme → 에러', () => {
    const results = lintDocument(doc({
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
      paths: {
        '/admin': {
          get: {
            operationId: 'admin',
            security: [{ nonexistent: [] }],
            responses: { '200': {} },
          },
        },
      },
    }))
    expect(results.some(r => r.rule === 'security/scheme-defined')).toBe(true)
  })
})

describe('components/unused 규칙', () => {
  it('미사용 스키마 → 경고', () => {
    const results = lintDocument(doc({
      components: {
        schemas: {
          UsedSchema: { type: 'string' },
          UnusedSchema: { type: 'string' },
        },
      },
      paths: {
        '/a': {
          get: {
            operationId: 'a',
            responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/UsedSchema' } } } } },
          },
        },
      },
    }))
    const unused = results.filter(r => r.rule.startsWith('components/unused'))
    expect(unused.length).toBeGreaterThan(0)
    expect(unused.some(r => r.message.includes('UnusedSchema'))).toBe(true)
    expect(unused.some(r => r.message.includes('UsedSchema'))).toBe(false)
  })

  it('모든 스키마가 사용되면 경고 없음', () => {
    const results = lintDocument(doc({
      components: { schemas: { User: { type: 'object' } } },
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } },
          },
        },
      },
    }), { categories: ['components'] })
    expect(results.filter(r => r.rule.startsWith('components/unused'))).toHaveLength(0)
  })

  it('itemSchema가 target을 참조하는 순수 SSE 별칭은 경고하지 않는다', () => {
    const results = lintDocument(doc({
      components: {
        schemas: {
          HealthEvent: { type: 'object' },
          // Native TypeSpec SSE output: the alias is not used by the operation,
          // but its target is used by the OpenAPI 3.2 streaming media type.
          HealthEvents: { $ref: '#/components/schemas/HealthEvent' },
        },
      },
      paths: {
        '/health/stream': {
          get: {
            operationId: 'streamHealthEvents',
            responses: {
              '200': {
                content: {
                  'text/event-stream': {
                    itemSchema: {
                      type: 'object',
                      oneOf: [{
                        properties: {
                          data: {
                            contentMediaType: 'application/json',
                            contentSchema: { $ref: '#/components/schemas/HealthEvent' },
                          },
                        },
                      }],
                    },
                  },
                },
              },
            },
          },
        },
      },
    }), { categories: ['components'] })

    expect(results.some(result => result.path === '/components/schemas/HealthEvents')).toBe(false)
    expect(results.some(result => result.path === '/components/schemas/HealthEvent')).toBe(false)
  })

  it('target이 별도로 참조되지 않는 별칭과 독립 미사용 스키마는 계속 경고한다', () => {
    const results = lintDocument(doc({
      components: {
        schemas: {
          UnusedAlias: { $ref: '#/components/schemas/AliasTarget' },
          AliasTarget: { type: 'object' },
          UnusedSchema: { type: 'string' },
        },
      },
    }), { categories: ['components'] })

    const unusedPaths = results
      .filter(result => result.rule === 'components/unused-schema')
      .map(result => result.path)
    expect(unusedPaths).toContain('/components/schemas/UnusedAlias')
    expect(unusedPaths).toContain('/components/schemas/UnusedSchema')
  })
})
