/**
 * response-picker.ts — generateMinimal 단위 테스트
 * OAS 3.2.0 §4.8.24 Schema Object 기반 최솟값 생성
 */
import { describe, it, expect } from 'vitest'
import { pickResponse } from '../../core/response-picker.js'
import type { OasSchema } from '@oa-sdk/parser'

function schema200(schema: object) {
  return pickResponse({ '200': { description: 'OK', content: { 'application/json': { schema: schema as OasSchema } } } })
}

// ─── string ───────────────────────────────────────────────────────────────────

describe('generateMinimal — string', () => {
  it('빈 string 스키마 → 빈 문자열', () => {
    expect(schema200({ type: 'string' })?.body).toBe('')
  })

  it('minLength → 최소 길이 만족', () => {
    const body = schema200({ type: 'string', minLength: 5 })?.body
    expect(typeof body).toBe('string')
    expect((body as string).length).toBeGreaterThanOrEqual(5)
  })

  it('enum → 첫 번째 값', () => {
    expect(schema200({ type: 'string', enum: ['admin', 'user'] })?.body).toBe('admin')
  })

  it('format: uuid → 00000000-0000-0000-0000-000000000000', () => {
    expect(schema200({ type: 'string', format: 'uuid' })?.body).toBe('00000000-0000-0000-0000-000000000000')
  })

  it('format: email → example@example.com', () => {
    expect(schema200({ type: 'string', format: 'email' })?.body).toBe('example@example.com')
  })

  it('format: date-time → ISO 8601 문자열', () => {
    const body = schema200({ type: 'string', format: 'date-time' })?.body as string
    expect(() => new Date(body)).not.toThrow()
    expect(body).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('format: date → YYYY-MM-DD', () => {
    expect(schema200({ type: 'string', format: 'date' })?.body).toBe('1970-01-01')
  })

  it('format: uri → https://example.com', () => {
    expect(schema200({ type: 'string', format: 'uri' })?.body).toBe('https://example.com')
  })

  it('format: ipv4 → 0.0.0.0', () => {
    expect(schema200({ type: 'string', format: 'ipv4' })?.body).toBe('0.0.0.0')
  })
})

// ─── number / integer ─────────────────────────────────────────────────────────

describe('generateMinimal — number / integer', () => {
  it('integer → 0', () => expect(schema200({ type: 'integer' })?.body).toBe(0))
  it('number → 0', () => expect(schema200({ type: 'number' })?.body).toBe(0))
  it('minimum 있으면 minimum 반환', () => expect(schema200({ type: 'integer', minimum: 5 })?.body).toBe(5))
  it('minimum 있는 number → minimum', () => expect(schema200({ type: 'number', minimum: 1.5 })?.body).toBe(1.5))
})

// ─── boolean ─────────────────────────────────────────────────────────────────

describe('generateMinimal — boolean', () => {
  it('boolean → false', () => expect(schema200({ type: 'boolean' })?.body).toBe(false))
})

// ─── null ────────────────────────────────────────────────────────────────────

describe('generateMinimal — null', () => {
  it('null → null', () => expect(schema200({ type: 'null' })?.body).toBeNull())
})

// ─── const ───────────────────────────────────────────────────────────────────

describe('generateMinimal — const', () => {
  it('string const는 example과 일반 string 생성을 우선한다', () => {
    expect(schema200({ type: 'string', const: '3.2.0', example: 'ignored' })?.body).toBe('3.2.0')
  })

  it('type이 생략된 number const를 그대로 생성한다', () => {
    expect(schema200({ const: 42 })?.body).toBe(42)
  })

  it('type이 생략된 boolean const를 그대로 생성한다', () => {
    expect(schema200({ const: true })?.body).toBe(true)
  })

  it('type이 생략된 null const를 누락하지 않는다', () => {
    expect(schema200({ const: null, example: 'ignored' })?.body).toBeNull()
  })
})

// ─── object ───────────────────────────────────────────────────────────────────

describe('generateMinimal — object', () => {
  it('required 필드만 채운다', () => {
    const body = schema200({
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        optional: { type: 'boolean' },
      },
    })?.body as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('name')
    expect(body).not.toHaveProperty('optional')
  })

  it('required 없으면 빈 객체', () => {
    expect(schema200({ type: 'object', properties: { a: { type: 'string' } } })?.body).toEqual({})
  })

  it('중첩 required object', () => {
    const body = schema200({
      type: 'object',
      required: ['user'],
      properties: {
        user: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    })?.body as Record<string, Record<string, string>>
    expect(body.user).toHaveProperty('id')
    expect(body.user?.id).toBe('00000000-0000-0000-0000-000000000000')
  })
})

// ─── array ────────────────────────────────────────────────────────────────────

describe('generateMinimal — array', () => {
  it('minItems 없으면 빈 배열', () => {
    expect(schema200({ type: 'array', items: { type: 'string' } })?.body).toEqual([])
  })

  it('minItems:2 → 2개 생성', () => {
    const body = schema200({ type: 'array', minItems: 2, items: { type: 'integer' } })?.body
    expect(Array.isArray(body)).toBe(true)
    expect((body as unknown[]).length).toBe(2)
  })

  it('items schema로 각 항목 생성', () => {
    const body = schema200({
      type: 'array',
      minItems: 1,
      items: { type: 'string', format: 'uuid' },
    })?.body as string[]
    expect(body[0]).toBe('00000000-0000-0000-0000-000000000000')
  })
})

// ─── composition ─────────────────────────────────────────────────────────────

describe('generateMinimal — allOf / oneOf / anyOf', () => {
  it('allOf 첫 번째 브랜치 사용', () => {
    const body = schema200({
      allOf: [{ type: 'object', required: ['x'], properties: { x: { type: 'integer' } } }],
    })?.body as Record<string, number>
    expect(typeof body.x).toBe('number')
  })

  it('oneOf 첫 번째 브랜치 사용', () => {
    const body = schema200({
      oneOf: [{ type: 'string' }, { type: 'integer' }],
    })?.body
    expect(typeof body).toBe('string')
  })

  it('anyOf 첫 번째 브랜치 사용', () => {
    const body = schema200({
      anyOf: [{ type: 'boolean' }, { type: 'string' }],
    })?.body
    expect(typeof body).toBe('boolean')
  })
})

// ─── $ref ────────────────────────────────────────────────────────────────────

describe('generateMinimal — $ref', () => {
  it('$ref → null (미해석)', () => {
    const body = schema200({ $ref: '#/components/schemas/User' })?.body
    expect(body).toBeNull()
  })
})
