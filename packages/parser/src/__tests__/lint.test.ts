import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as parseYaml } from 'yaml'
import { lintDocument } from '../lint.js'
import { createSourceLocationIndex } from '../source-location.js'

function doc(overrides: Record<string, unknown> = {}) {
  return { openapi: '3.2.0', info: { title: 'T', version: '0' }, paths: {}, ...overrides }
}

describe('lint — structure', () => {
  it('유효한 최소 문서 → 에러 없음', () => {
    const results = lintDocument(doc(), { categories: ['structure'] })
    expect(results.filter(r => r.severity === 'error')).toHaveLength(0)
  })

  it('openapi 누락', () => {
    const results = lintDocument({ info: { title: 'T', version: '0' } })
    expect(results.some(r => r.rule === 'structure/openapi-version')).toBe(true)
  })

  it('info 누락', () => {
    const results = lintDocument({ openapi: '3.2.0' })
    expect(results.some(r => r.rule === 'structure/info-required')).toBe(true)
  })

  it('paths와 webhooks 모두 없으면 경고', () => {
    const results = lintDocument({ openapi: '3.2.0', info: { title: 'T', version: '0' } })
    expect(results.some(r => r.rule === 'structure/paths-or-webhooks')).toBe(true)
  })
})

describe('lint — operations', () => {
  it('중복 operationId', () => {
    const results = lintDocument(doc({
      paths: {
        '/a': { get: { operationId: 'dup', responses: { '200': {} } } },
        '/b': { get: { operationId: 'dup', responses: { '200': {} } } },
      },
    }))
    expect(results.filter(r => r.rule === 'operations/unique-operationId')).toHaveLength(1)
  })

  it('responses 비어있으면 경고', () => {
    const results = lintDocument(doc({
      paths: { '/a': { get: { operationId: 'a' } } },
    }))
    expect(results.some(r => r.rule === 'operations/responses-required')).toBe(true)
  })
})

describe('lint — parameters', () => {
  it('path param은 required 필수', () => {
    const results = lintDocument(doc({
      paths: {
        '/users/{id}': {
          get: {
            parameters: [{ name: 'id', in: 'path', schema: { type: 'string' } }],
            responses: { '200': {} },
          },
        },
      },
    }))
    expect(results.some(r => r.rule === 'parameters/path-required')).toBe(true)
  })

  it('유효하지 않은 in 값', () => {
    const results = lintDocument(doc({
      paths: {
        '/a': {
          get: {
            parameters: [{ name: 'x', in: 'invalid' as any, schema: { type: 'string' } }],
            responses: { '200': {} },
          },
        },
      },
    }))
    expect(results.some(r => r.rule === 'parameters/valid-in')).toBe(true)
  })

  it('OAS 3.2 querystring parameter는 content로 유효하게 선언할 수 있다', () => {
    const results = lintDocument(doc({
      paths: {
        '/search': {
          get: {
            parameters: [{
              name: 'query',
              in: 'querystring',
              content: {
                'application/x-www-form-urlencoded': {
                  schema: { type: 'object', properties: { q: { type: 'string' } } },
                },
              },
            }],
            responses: { '200': {} },
          },
        },
      },
    }), { categories: ['parameters'] })

    expect(results.filter(result => result.severity === 'error')).toEqual([])
  })

  it('querystring parameter는 content가 필요하고 query parameter와 공존할 수 없다', () => {
    const results = lintDocument(doc({
      paths: {
        '/search': {
          get: {
            parameters: [
              { name: 'whole-query', in: 'querystring' },
              { name: 'page', in: 'query', schema: { type: 'integer' } },
            ],
            responses: { '200': {} },
          },
        },
      },
    }), { categories: ['parameters'] })

    expect(results.map(result => result.rule)).toEqual(expect.arrayContaining([
      'parameters/querystring-content-required',
      'parameters/querystring-exclusive',
    ]))
  })

  it('querystring parameter는 schema/style fields 대신 content만 사용한다', () => {
    const results = lintDocument(doc({
      paths: {
        '/search': {
          get: {
            parameters: [{
              name: 'whole-query',
              in: 'querystring',
              schema: { type: 'object' },
              style: 'form',
              content: { 'application/json': { schema: { type: 'object' } } },
            }],
            responses: { '200': {} },
          },
        },
      },
    }), { categories: ['parameters'] })

    expect(results.some(result => result.rule === 'parameters/querystring-content-only')).toBe(true)
  })

  it('querystring parameter content에는 media type을 하나만 선언할 수 있다', () => {
    const results = lintDocument(doc({
      paths: {
        '/search': {
          get: {
            parameters: [{
              name: 'whole-query',
              in: 'querystring',
              content: {
                'application/json': { schema: { type: 'object' } },
                'text/plain': { schema: { type: 'string' } },
              },
            }],
            responses: { '200': {} },
          },
        },
      },
    }), { categories: ['parameters'] })

    expect(results.some(result => result.rule === 'parameters/querystring-single-content')).toBe(true)
  })

  it('webhook querystring semantics도 paths와 동일하게 검증한다', () => {
    const results = lintDocument(doc({
      webhooks: {
        event: {
          post: {
            parameters: [
              { name: 'whole', in: 'querystring', schema: { type: 'string' } },
              { name: 'q', in: 'query', schema: { type: 'string' } },
            ],
            responses: { '200': {} },
          },
        },
      },
    }), { categories: ['parameters'] })

    expect(results.map(result => result.rule)).toEqual(expect.arrayContaining([
      'parameters/querystring-content-required',
      'parameters/querystring-content-only',
      'parameters/querystring-exclusive',
    ]))
  })

  it('local component parameter refs participate in querystring invariants', () => {
    const results = lintDocument(doc({
      components: {
        parameters: {
          WholeQuery: { name: 'whole', in: 'querystring', schema: { type: 'string' } },
        },
      },
      paths: {
        '/search': {
          get: {
            parameters: [
              { $ref: '#/components/parameters/WholeQuery' },
              { name: 'q', in: 'query', schema: { type: 'string' } },
            ],
            responses: { '200': {} },
          },
        },
      },
    }), { categories: ['parameters'] })

    expect(results.map(result => result.rule)).toEqual(expect.arrayContaining([
      'parameters/querystring-content-required',
      'parameters/querystring-content-only',
      'parameters/querystring-exclusive',
    ]))
  })

  it('operation parameter override does not create a false duplicate querystring error', () => {
    const wholeQuery = { name: 'whole', in: 'querystring', content: { 'text/plain': {} } }
    const results = lintDocument(doc({
      paths: {
        '/search': {
          parameters: [wholeQuery],
          get: {
            parameters: [{ ...wholeQuery, required: true }],
            responses: { '200': {} },
          },
        },
      },
    }), { categories: ['parameters'] })

    expect(results.some(result => result.rule === 'parameters/querystring-unique')).toBe(false)
  })

  it('additionalOperations also validates querystring exclusivity', () => {
    const results = lintDocument(doc({
      paths: {
        '/brew': {
          additionalOperations: {
            BREW: {
              parameters: [
                { name: 'whole', in: 'querystring', content: { 'text/plain': {} } },
                { name: 'q', in: 'query', schema: { type: 'string' } },
              ],
              responses: { '200': {} },
            },
          },
        },
      },
    }), { categories: ['parameters'] })

    expect(results.some(result => result.rule === 'parameters/querystring-exclusive')).toBe(true)
  })

  it('경로의 {param}이 정의되지 않으면 경고', () => {
    const results = lintDocument(doc({
      paths: {
        '/users/{id}': {
          get: { responses: { '200': {} } },
        },
      },
    }))
    expect(results.some(r => r.rule === 'parameters/path-defined')).toBe(true)
  })
})

describe('lint — refs', () => {
  it('존재하지 않는 $ref', () => {
    const results = lintDocument(doc({
      paths: {
        '/a': { get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Nonexistent' } } } } } } },
      },
    }))
    expect(results.some(r => r.rule === 'refs/valid-ref')).toBe(true)
  })

  it('유효한 $ref → 에러 없음', () => {
    const results = lintDocument(doc({
      components: { schemas: { User: { type: 'object' } } },
      paths: {
        '/a': { get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } } } },
      },
    }), { categories: ['refs'] })
    expect(results.filter(r => r.severity === 'error')).toHaveLength(0)
  })

  it('외부 $ref diagnostic에 source 정보를 포함', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-lint-'))
    const basePath = join(tmp, 'api.yaml')
    try {
      const results = lintDocument(doc({
        paths: {
          '/a': { get: { responses: { '200': { content: { 'application/json': { schema: { $ref: './missing.yaml#/components/schemas/User' } } } } } } },
        },
      }), { categories: ['refs'], basePath })

      const refError = results.find(r => r.rule === 'refs/valid-ref')
      expect(refError?.source?.sourceFilePath).toBe(basePath)
      expect(refError?.source?.sourcePointer).toBe('#/paths/~1a/get/responses/200/content/application~1json/schema/$ref')
      expect(refError?.source?.filePath?.endsWith('missing.yaml')).toBe(true)
      expect(refError?.source?.pointer).toBe('#/components/schemas/User')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('lint — security', () => {
  it('정의되지 않은 securityScheme 참조', () => {
    const results = lintDocument(doc({
      security: [{ nonexistent: [] }],
    }))
    expect(results.some(r => r.rule === 'security/scheme-defined')).toBe(true)
  })

  it('기존 rule/message를 유지하면서 source line/column을 추가한다', () => {
    const basePath = join(tmpdir(), 'oa-sdk-lint-location.yaml')
    const raw = [
      'openapi: 3.2.0',
      'info:',
      '  title: T',
      '  version: "0"',
      'paths: {}',
      'security:',
      '  - missing: []',
      '',
    ].join('\n')
    const index = createSourceLocationIndex(raw, { filePath: basePath })
    const results = lintDocument(parseYaml(raw), {
      categories: ['security'],
      basePath,
      lookupSourceLocation: (filePath, pointer) => filePath === basePath ? index.lookup(pointer) : undefined,
    })
    const diagnostic = results.find(r => r.rule === 'security/scheme-defined')

    expect(diagnostic).toMatchObject({
      path: '/security',
      severity: 'error',
      rule: 'security/scheme-defined',
      message: 'securitySchemes에 "missing"이 정의되지 않았습니다',
      source: {
        sourceFilePath: basePath,
        sourcePointer: '#/security',
        line: 6,
        column: 1,
      },
    })
  })

  it('유효한 security 참조', () => {
    const results = lintDocument(doc({
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
      security: [{ bearer: [] }],
    }), { categories: ['security'] })
    expect(results.filter(r => r.severity === 'error')).toHaveLength(0)
  })
})

describe('lint — style', () => {
  it('operationId 없으면 info', () => {
    const results = lintDocument(doc({
      paths: { '/a': { get: { responses: { '200': {} } } } },
    }))
    expect(results.some(r => r.rule === 'style/operationId')).toBe(true)
  })

  it('description/summary 없으면 info', () => {
    const results = lintDocument(doc({
      paths: { '/a': { get: { operationId: 'a', responses: { '200': {} } } } },
    }))
    expect(results.some(r => r.rule === 'style/description')).toBe(true)
  })

  it('path key를 JSON Pointer escape하여 source line/column을 찾는다', () => {
    const basePath = join(tmpdir(), 'oa-sdk-lint-path-location.yaml')
    const raw = [
      'openapi: 3.2.0',
      'info:',
      '  title: T',
      '  version: "0"',
      'paths:',
      '  /bad:',
      '    get:',
      '      responses:',
      '        "200":',
      '          description: OK',
      '',
    ].join('\n')
    const index = createSourceLocationIndex(raw, { filePath: basePath })
    const results = lintDocument(parseYaml(raw), {
      categories: ['style'],
      basePath,
      lookupSourceLocation: (filePath, pointer) => filePath === basePath ? index.lookup(pointer) : undefined,
    })
    const diagnostic = results.find(r => r.rule === 'style/operationId')

    expect(diagnostic).toMatchObject({
      path: '/paths/~1bad/get',
      source: {
        sourceFilePath: basePath,
        sourcePointer: '#/paths/~1bad/get',
        line: 7,
        column: 5,
      },
    })
  })
})
