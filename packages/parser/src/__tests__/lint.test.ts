import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { lintDocument } from '../lint.js'

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
})
