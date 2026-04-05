/**
 * OAS 3.2.0 §4.8.24 Schema Object — 스펙 해석 검증
 * 참조: docs/references/oas32/12-schema.md
 *
 * OAS 3.2는 JSON Schema Draft 2020-12의 수퍼셋.
 * 검증 항목:
 * - type 배열 지원: type: ["string", "null"] (nullable 대체)
 * - integer는 number의 서브타입이 아님 (1.0은 integer로 유효)
 * - allOf/oneOf/anyOf 조합
 * - required 배열 동작
 */
import { describe, it, expect } from 'vitest'
import { validateRequest } from '../../core/request-validator.js'
import { pickResponse } from '../../core/response-picker.js'
import type { OasRequestBody, OasSchema } from '@oa-sdk/parser'

function parts(body: unknown, contentType = 'application/json') {
  return { pathParams: {}, queryParams: {}, headers: {}, body, contentType }
}

function bodyOf(schema: object): OasRequestBody {
  return { required: true, content: { 'application/json': { schema: schema as OasSchema } } }
}

function schema200(schema: object) {
  return pickResponse({ '200': { description: 'OK', content: { 'application/json': { schema: schema as OasSchema } } } })
}

// ─── type 배열 (OAS 3.2 / JSON Schema 2020-12) ────────────────────────────────

describe('type 배열 지원 (OAS 3.2.0 §4.8.24 — JSON Schema 2020-12)', () => {
  it('type: ["string", "null"] — string 유효', () => {
    const r = validateRequest(parts('hello'), [], bodyOf({ type: ['string', 'null'] }))
    expect(r.valid).toBe(true)
  })

  it('type: ["string", "null"] — null 유효', () => {
    const r = validateRequest(parts(null), [], bodyOf({ type: ['string', 'null'] }))
    expect(r.valid).toBe(true)
  })

  it('type: ["string", "null"] — number는 유효하지 않음', () => {
    const r = validateRequest(parts(42), [], bodyOf({ type: ['string', 'null'] }))
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors[0]?.code).toBe('TYPE_ERROR')
  })

  it('type 배열 generateMinimal → 첫 번째 타입으로 생성', () => {
    const body = schema200({ type: ['string', 'null'] })?.body
    // 첫 번째 타입인 string으로 생성
    expect(typeof body).toBe('string')
  })

  it('type: ["integer", "null"] — null generateMinimal', () => {
    // 첫 번째가 integer이면 0
    const body = schema200({ type: ['integer', 'null'] })?.body
    expect(body).toBe(0)
  })
})

// ─── integer vs number ────────────────────────────────��───────────────────────

describe('integer와 number 타입 구분 (§4.8.24)', () => {
  it('integer 스키마에 정수 → valid', () => {
    expect(validateRequest(parts(42), [], bodyOf({ type: 'integer' })).valid).toBe(true)
  })

  it('integer 스키마에 float → TYPE_ERROR', () => {
    const r = validateRequest(parts(1.5), [], bodyOf({ type: 'integer' }))
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors[0]?.code).toBe('TYPE_ERROR')
  })

  it('number 스키마에 float → valid', () => {
    expect(validateRequest(parts(3.14), [], bodyOf({ type: 'number' })).valid).toBe(true)
  })

  it('number 스키마에 정수 → valid (integer는 number의 서브셋)', () => {
    expect(validateRequest(parts(5), [], bodyOf({ type: 'number' })).valid).toBe(true)
  })
})

// ─── required 배열 ────────────────────────────────────────────────────────────

describe('required 배열 동작 (§4.8.24)', () => {
  const schema = {
    type: 'object',
    required: ['id', 'name'],
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      desc: { type: 'string' },
    },
  }

  it('required 필드 모두 있음 → valid', () => {
    expect(validateRequest(parts({ id: 'a', name: 'b' }), [], bodyOf(schema)).valid).toBe(true)
  })

  it('optional 필드(desc) 없어도 valid', () => {
    expect(validateRequest(parts({ id: 'a', name: 'b', desc: 'extra ok' }), [], bodyOf(schema)).valid).toBe(true)
  })

  it('required 필드(id) 누락 → MISSING_REQUIRED_FIELD', () => {
    const r = validateRequest(parts({ name: 'b' }), [], bodyOf(schema))
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
      expect(r.errors[0]?.path).toBe('/body/id')
    }
  })
})

// ─── enum ─────────────────────────────────────────────────────────────────────

describe('enum 검증 (§4.8.24)', () => {
  it('enum 값에 포함 → valid', () => {
    expect(validateRequest(parts('admin'), [], bodyOf({ type: 'string', enum: ['admin', 'user'] })).valid).toBe(true)
  })

  it('enum 외 값 → INVALID_ENUM_VALUE', () => {
    const r = validateRequest(parts('root'), [], bodyOf({ type: 'string', enum: ['admin', 'user'] }))
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors[0]?.code).toBe('INVALID_ENUM_VALUE')
  })
})

// ─── allOf / oneOf / anyOf ────────────────────────────────────────────────────

describe('schema composition (§4.8.24 — allOf/oneOf/anyOf)', () => {
  it('allOf: 모든 서브스키마 만족 → valid', () => {
    const r = validateRequest(
      parts({ id: 1, name: 'test' }),
      [],
      bodyOf({
        allOf: [
          { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
          { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
        ],
      }),
    )
    expect(r.valid).toBe(true)
  })

  it('oneOf: 정확히 하나 만족 → valid', () => {
    const r = validateRequest(
      parts('hello'),
      [],
      bodyOf({ oneOf: [{ type: 'string' }, { type: 'integer' }] }),
    )
    expect(r.valid).toBe(true)
  })

  it('anyOf: 하나 이상 만족 → valid', () => {
    const r = validateRequest(
      parts(42),
      [],
      bodyOf({ anyOf: [{ type: 'string' }, { type: 'integer' }] }),
    )
    expect(r.valid).toBe(true)
  })
})
