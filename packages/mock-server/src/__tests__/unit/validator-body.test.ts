/**
 * request-validator.ts — Content-Type & request body 검증 단위 테스트
 * OAS 3.2.0 §4.8.13 Request Body Object / Media Type Object
 */
import { describe, it, expect } from 'vitest'
import { validateRequest } from '../../core/request-validator.js'
import type { OasRequestBody } from '@oa-sdk/parser'

const userBody: OasRequestBody = {
  required: true,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['email', 'name', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          name: { type: 'string', minLength: 1, maxLength: 100 },
          password: { type: 'string', minLength: 8 },
        },
      },
    },
  },
}

function parts(overrides = {}) {
  return { pathParams: {}, queryParams: {}, headers: {}, body: undefined, contentType: undefined, ...overrides }
}

// ─── Content-Type ─────────────────────────────────────────────────────────────

describe('Content-Type 검증 (OAS 3.2.0 §4.8.13 Media Type Object)', () => {
  it('requestBody 없으면 Content-Type 미검사', () => {
    expect(validateRequest(parts(), [], undefined).valid).toBe(true)
  })

  it('contentType 없고 required body → MISSING_REQUIRED_FIELD만 (이중 에러 없음)', () => {
    const r = validateRequest(parts(), [], userBody)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors).toHaveLength(1)
      expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
      const hasCT = r.errors.some(e => e.code === 'PROTOCOL_MISMATCH')
      expect(hasCT).toBe(false)
    }
  })

  it('contentType 불일치 → PROTOCOL_MISMATCH', () => {
    const r = validateRequest(
      parts({ body: { email: 'a@b.com', name: 'T', password: 'pass1234' }, contentType: 'text/plain' }),
      [], userBody,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) {
      const e = r.errors.find(e => e.code === 'PROTOCOL_MISMATCH')
      expect(e).toBeDefined()
      expect(e?.path).toBe('/headers/content-type')
    }
  })

  it('charset 포함된 Content-Type도 정상 처리', () => {
    const r = validateRequest(
      parts({ body: { email: 'a@b.com', name: 'T', password: 'pass1234' }, contentType: 'application/json; charset=utf-8' }),
      [], userBody,
    )
    const hasCT = !r.valid && r.errors.some(e => e.code === 'PROTOCOL_MISMATCH')
    expect(hasCT).toBe(false)
  })
})

// ─── request body schema validation ──────────────────────────────────────────

describe('request body 스키마 검증', () => {
  it('유효한 body → valid', () => {
    const r = validateRequest(
      parts({ body: { email: 'user@example.com', name: 'Test', password: 'password123' }, contentType: 'application/json' }),
      [], userBody,
    )
    expect(r.valid).toBe(true)
  })

  it('required 필드 누락 → MISSING_REQUIRED_FIELD (모든 누락 필드 포함)', () => {
    const r = validateRequest(
      parts({ body: { email: 'user@example.com' }, contentType: 'application/json' }),
      [], userBody,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) {
      const paths = r.errors.map(e => e.path)
      expect(paths).toContain('/body/name')
      expect(paths).toContain('/body/password')
      expect(r.errors.every(e => e.code === 'MISSING_REQUIRED_FIELD')).toBe(true)
    }
  })

  it('FORMAT_MISMATCH: path=/body/email', () => {
    const r = validateRequest(
      parts({ body: { email: 'not-email', name: 'T', password: 'pass1234' }, contentType: 'application/json' }),
      [], userBody,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) {
      const e = r.errors.find(e => e.path === '/body/email')
      expect(e?.code).toBe('FORMAT_MISMATCH')
    }
  })

  it('CONSTRAINT_VIOLATION: minLength, constraint.limit 포함', () => {
    const r = validateRequest(
      parts({ body: { email: 'u@e.com', name: 'T', password: 'short' }, contentType: 'application/json' }),
      [], userBody,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) {
      const e = r.errors.find(e => e.path === '/body/password')
      expect(e?.code).toBe('CONSTRAINT_VIOLATION')
      expect(e?.constraint).toMatchObject({ limit: 8 })
    }
  })

  it('TYPE_ERROR: received에 타입명 문자열', () => {
    const r = validateRequest(
      parts({ body: { email: 999, name: 'T', password: 'pass1234' }, contentType: 'application/json' }),
      [], userBody,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) {
      const e = r.errors.find(e => e.path === '/body/email')
      expect(e?.code).toBe('TYPE_ERROR')
      expect(e?.received).toBe('number')
    }
  })

  it('allErrors: 여러 필드 오류를 한 번에 반환', () => {
    const r = validateRequest(
      parts({ body: { email: 'bad', name: '', password: 'x' }, contentType: 'application/json' }),
      [], userBody,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.length).toBeGreaterThan(1)
  })

  it('optional requestBody, body 없음 → valid (required: false)', () => {
    const optBody: OasRequestBody = {
      required: false,
      content: { 'application/json': { schema: { type: 'object' } } },
    }
    expect(validateRequest(parts(), [], optBody).valid).toBe(true)
  })
})

// ─── $ref 스키마 ──────────────────────────────────────────────────────────────

describe('미해석 $ref 스키마 — 크래시 없이 통과', () => {
  it('body schema가 $ref이면 검증 건너뜀 (valid)', () => {
    const refBody: OasRequestBody = {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
    }
    // ajv.compile 시 throw → catch → 검증 skip → valid: true
    expect(
      validateRequest(parts({ body: { anything: true }, contentType: 'application/json' }), [], refBody).valid,
    ).toBe(true)
  })

  it('param schema가 $ref이면 검증 건너뜀 (valid)', () => {
    const refParam = { name: 'id', in: 'path' as const, required: true, schema: { $ref: '#/components/schemas/Id' } }
    expect(
      validateRequest(parts({ pathParams: { id: 'anything' } }), [refParam], undefined).valid,
    ).toBe(true)
  })
})
