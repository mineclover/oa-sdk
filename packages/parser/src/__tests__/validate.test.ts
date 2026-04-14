import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validateDocument } from '../validate.js'

describe('validateDocument', () => {
  it('유효한 최소 문서', () => {
    const result = validateDocument({
      openapi: '3.2.0',
      info: { title: 'T', version: '0' },
      paths: {},
    })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('openapi 누락 → 에러', () => {
    const result = validateDocument({ info: { title: 'T', version: '0' } })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.rule.includes('version') || e.rule.includes('openapi'))).toBe(true)
  })

  it('info.version 누락 → 에러', () => {
    const result = validateDocument({ openapi: '3.2.0', info: { title: 'T' } })
    expect(result.valid).toBe(false)
  })

  it('paths와 webhooks 모두 없으면 경고', () => {
    const result = validateDocument({ openapi: '3.2.0', info: { title: 'T', version: '0' } })
    expect(result.valid).toBe(true) // 경고지 에러 아님
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('3.1 버전 → info 레벨 안내', () => {
    const result = validateDocument({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {},
    })
    expect(result.valid).toBe(true)
    expect(result.infos.some(i => i.rule === 'parse/version-32')).toBe(true)
  })

  it('2.x 버전 → 에러', () => {
    const result = validateDocument({ openapi: '2.0', info: { title: 'T', version: '0' } })
    expect(result.valid).toBe(false)
  })

  it('JSON 문자열 입력', () => {
    const json = JSON.stringify({ openapi: '3.2.0', info: { title: 'T', version: '0' }, paths: {} })
    const result = validateDocument(json)
    expect(result.valid).toBe(true)
  })

  it('잘못된 JSON 문자열 → 에러', () => {
    const result = validateDocument('{invalid json}')
    expect(result.valid).toBe(false)
  })

  it('summary 포함', () => {
    const result = validateDocument({
      openapi: '3.2.0',
      info: { title: 'T', version: '0' },
      paths: {},
    })
    expect(result.summary).toContain('Valid')
  })

  it('린터 규칙 통합 — 중복 operationId', () => {
    const result = validateDocument({
      openapi: '3.2.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/a': { get: { operationId: 'dup', responses: { '200': {} } } },
        '/b': { get: { operationId: 'dup', responses: { '200': {} } } },
      },
    })
    expect(result.errors.some(e => e.rule.includes('unique-operationId'))).toBe(true)
  })

  it('린터 규칙 통합 — 잘못된 $ref', () => {
    const result = validateDocument({
      openapi: '3.2.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/a': { get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Missing' } } } } } } },
      },
    })
    expect(result.errors.some(e => e.rule === 'refs/valid-ref')).toBe(true)
  })

  it('스키마 메타 검증 — 유효하지 않은 type 값은 에러', () => {
    const result = validateDocument({
      openapi: '3.2.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/a': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'strng' },
                },
              },
            },
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.rule === 'schema/meta-valid' && e.path.endsWith('/schema/type'))).toBe(true)
  })

  it('스키마 메타 검증 — 잘못된 constraint 타입은 에러', () => {
    const result = validateDocument({
      openapi: '3.2.0',
      info: { title: 'T', version: '0' },
      paths: {},
      components: {
        schemas: {
          Age: { type: 'integer', minimum: 'zero' },
        },
      },
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.rule === 'schema/meta-valid' && e.path === '/components/schemas/Age/minimum')).toBe(true)
  })

  it('외부 $ref 파일 읽기 실패를 refs/valid-ref 에러로 보고한다', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-validate-'))
    const basePath = join(tmp, 'api.yaml')

    try {
      const result = validateDocument({
        openapi: '3.2.0',
        info: { title: 'T', version: '0' },
        paths: {
          '/a': {
            get: {
              responses: {
                '200': {
                  description: 'OK',
                  content: {
                    'application/json': { schema: { $ref: './missing.yaml#/components/schemas/User' } },
                  },
                },
              },
            },
          },
        },
      }, { basePath })

      expect(result.valid).toBe(false)
      expect(result.errors.some(e =>
        e.rule === 'refs/valid-ref' &&
        e.message.includes('missing.yaml') &&
        e.source?.filePath?.endsWith('missing.yaml') &&
        e.source?.pointer === '#/components/schemas/User',
      )).toBe(true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
