/**
 * annotations 컨벤션 테스트 — $comment 무시, annotations 옵션 제어
 */
import { describe, it, expect } from 'vitest'
import { schemaToTs } from '../../typegen/schema-to-ts.js'
import { generateTypesFromSpec } from '../../typegen/generate-types.js'
import type { OasDocument } from '@oa-sdk/parser'

describe('$comment — 항상 무시', () => {
  it('최상위 $comment', () => {
    const result = schemaToTs({ type: 'string', $comment: '내부 메모' } as any)
    expect(result).toBe('string')
    expect(result).not.toContain('내부 메모')
  })

  it('프로퍼티 $comment', () => {
    const result = schemaToTs({
      type: 'object',
      properties: { id: { type: 'string', $comment: 'PK' } as any },
      required: ['id'],
    })
    expect(result).toContain('id: string')
    expect(result).not.toContain('PK')
  })
})

describe('annotations — 기본 무시', () => {
  it('annotations 있어도 기본 출력에 미포함', () => {
    const result = schemaToTs({
      type: 'object',
      properties: {
        email: {
          type: 'string',
          annotations: { note: 'OAuth 불가', owner: 'identity' },
        } as any,
      },
    })
    expect(result).not.toContain('OAuth')
    expect(result).not.toContain('identity')
    expect(result).not.toContain('@note')
  })
})

describe('annotations — includeAnnotations: true', () => {
  it('note → @note JSDoc', () => {
    const result = schemaToTs({
      type: 'object',
      properties: {
        field: { type: 'string', annotations: { note: '중요 메모' } } as any,
      },
    }, { includeAnnotations: true })
    expect(result).toContain('@note 중요 메모')
  })

  it('see (string) → @see JSDoc', () => {
    const result = schemaToTs({
      type: 'object',
      properties: {
        field: { type: 'string', annotations: { see: 'https://docs.example.com' } } as any,
      },
    }, { includeAnnotations: true })
    expect(result).toContain('@see https://docs.example.com')
  })

  it('see (string[]) → 여러 @see', () => {
    const result = schemaToTs({
      type: 'object',
      properties: {
        field: { type: 'string', annotations: { see: ['#/a', '#/b'] } } as any,
      },
    }, { includeAnnotations: true })
    expect(result).toContain('@see #/a')
    expect(result).toContain('@see #/b')
  })

  it('todo/owner/since → JSDoc에 미포함 (개발 프로세스용)', () => {
    const result = schemaToTs({
      type: 'object',
      properties: {
        field: {
          type: 'string',
          annotations: { todo: 'fix this', owner: 'team-a', since: '2024-01' },
        } as any,
      },
    }, { includeAnnotations: true })
    expect(result).not.toContain('todo')
    expect(result).not.toContain('team-a')
    expect(result).not.toContain('2024-01')
  })

  it('description + annotations 복합', () => {
    const result = schemaToTs({
      type: 'object',
      properties: {
        email: {
          type: 'string',
          format: 'email',
          description: '이메일 주소',
          annotations: { note: 'OAuth 변경 불가', see: 'https://wiki/email' },
        } as any,
      },
    }, { includeAnnotations: true })
    expect(result).toContain('이메일 주소')
    expect(result).toContain('@format email')
    expect(result).toContain('@note OAuth 변경 불가')
    expect(result).toContain('@see https://wiki/email')
  })
})

describe('generateTypesFromSpec — includeAnnotations 옵션 전달', () => {
  const spec = {
    openapi: '3.2.0',
    info: { title: 'T', version: '1' },
    components: {
      schemas: {
        User: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', annotations: { note: 'PK 자동 생성' } },
          },
        },
      },
    },
  } as unknown as OasDocument

  it('기본 → annotations 미포함', () => {
    const ts = generateTypesFromSpec(spec)
    expect(ts).not.toContain('@note')
  })

  it('includeAnnotations: true → annotations 포함', () => {
    const ts = generateTypesFromSpec(spec, { includeAnnotations: true })
    expect(ts).toContain('@note PK 자동 생성')
  })
})
