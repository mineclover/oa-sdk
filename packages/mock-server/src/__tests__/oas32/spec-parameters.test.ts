/**
 * OAS 3.2.0 §4.8.12 Parameter Object — 스펙 해석 검증
 * 참조: docs/references/oas32/07-parameters.md
 *
 * 검증 항목:
 * - in 값: path, query, header, cookie
 * - path param은 반드시 required: true (스펙 강제)
 * - header param 이름은 대소문자 무관 (스펙: case insensitive)
 * - optional param 누락은 유효
 */
import { describe, it, expect } from 'vitest'
import { validateRequest } from '../../core/request-validator.js'
import type { OasParameter } from '@oa-sdk/parser'

function parts(overrides = {}) {
  return { pathParams: {}, queryParams: {}, headers: {}, body: undefined, contentType: undefined, ...overrides }
}

// ─── in: path ─────────────────────────────────────────────────────────────────

describe('in: path (OAS 3.2.0 §4.8.12 — 반드시 required: true)', () => {
  const pathParam: OasParameter = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }

  it('유효한 uuid path param → valid', () => {
    const r = validateRequest(parts({ pathParams: { id: '123e4567-e89b-12d3-a456-426614174000' } }), [pathParam], undefined)
    expect(r.valid).toBe(true)
  })

  it('required path param 누락 → MISSING_REQUIRED_FIELD', () => {
    const r = validateRequest(parts(), [pathParam], undefined)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
      expect(r.errors[0]?.path).toBe('/path/id')
    }
  })

  it('정수형 path param coerce', () => {
    const intParam: OasParameter = { name: 'page', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }
    expect(validateRequest(parts({ pathParams: { page: '5' } }), [intParam], undefined).valid).toBe(true)
  })

  it('format 불일치 → FORMAT_MISMATCH', () => {
    const r = validateRequest(parts({ pathParams: { id: 'not-a-uuid' } }), [pathParam], undefined)
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors[0]?.code).toBe('FORMAT_MISMATCH')
  })
})

// ─── in: query ────────────────────────────────────────────────────────────────

describe('in: query (OAS 3.2.0 §4.8.12)', () => {
  const requiredQ: OasParameter = { name: 'filter', in: 'query', required: true, schema: { type: 'string' } }
  const optionalQ: OasParameter = { name: 'sort', in: 'query', schema: { type: 'string' } }

  it('required query param 누락 → MISSING_REQUIRED_FIELD', () => {
    const r = validateRequest(parts(), [requiredQ], undefined)
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
  })

  it('optional query param 누락 → valid', () => {
    expect(validateRequest(parts(), [optionalQ], undefined).valid).toBe(true)
  })

  it('쿼리 값이 있으면 스키마 검증', () => {
    const enumQ: OasParameter = { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'inactive'] } }
    expect(validateRequest(parts({ queryParams: { status: 'active' } }), [enumQ], undefined).valid).toBe(true)
    expect(validateRequest(parts({ queryParams: { status: 'unknown' } }), [enumQ], undefined).valid).toBe(false)
  })
})

// ─── in: header ───────────────────────────────────────────────────────────────

describe('in: header — 대소문자 무관 (OAS 3.2.0 §4.8.12 — "name is case insensitive")', () => {
  const apiKeyParam: OasParameter = { name: 'X-API-Key', in: 'header', required: true, schema: { type: 'string' } }

  it('원래 케이스로 전달해도 매칭된다', () => {
    // 실제로는 HTTP 헤더가 소문자로 정규화되므로 테스트도 소문자로
    expect(validateRequest(parts({ headers: { 'x-api-key': 'val' } }), [apiKeyParam], undefined).valid).toBe(true)
  })

  it('required header 누락 → MISSING_REQUIRED_FIELD', () => {
    const r = validateRequest(parts(), [apiKeyParam], undefined)
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
  })

  it('optional header 누락 → valid', () => {
    const opt: OasParameter = { name: 'X-Trace-Id', in: 'header', schema: { type: 'string', format: 'uuid' } }
    expect(validateRequest(parts(), [opt], undefined).valid).toBe(true)
  })

  it('header 값 스키마 검증', () => {
    const uuidHeader: OasParameter = { name: 'X-Request-Id', in: 'header', required: true, schema: { type: 'string', format: 'uuid' } }
    expect(validateRequest(parts({ headers: { 'x-request-id': 'not-uuid' } }), [uuidHeader], undefined).valid).toBe(false)
    expect(validateRequest(parts({ headers: { 'x-request-id': '123e4567-e89b-12d3-a456-426614174000' } }), [uuidHeader], undefined).valid).toBe(true)
  })
})

// ─── in: cookie ───────────────────────────────────────────────────────────────

describe('in: cookie (OAS 3.2.0 §4.8.12 — Cookie 헤더 파싱)', () => {
  const sessionParam: OasParameter = { name: 'session', in: 'cookie', required: true, schema: { type: 'string' } }

  it('Cookie 헤더에서 값 추출', () => {
    expect(validateRequest(parts({ headers: { cookie: 'session=abc123; other=val' } }), [sessionParam], undefined).valid).toBe(true)
  })

  it('세미콜론 구분자로 복수 쿠키 파싱', () => {
    const p1: OasParameter = { name: 'a', in: 'cookie', required: true, schema: { type: 'string' } }
    const p2: OasParameter = { name: 'b', in: 'cookie', required: true, schema: { type: 'string' } }
    expect(validateRequest(parts({ headers: { cookie: 'a=1; b=2' } }), [p1, p2], undefined).valid).toBe(true)
  })

  it('쿠키 값에 = 포함 → 올바르게 파싱', () => {
    const tokenParam: OasParameter = { name: 'token', in: 'cookie', required: true, schema: { type: 'string' } }
    expect(validateRequest(parts({ headers: { cookie: 'token=a=b=c' } }), [tokenParam], undefined).valid).toBe(true)
  })

  it('required cookie 미전송 → MISSING_REQUIRED_FIELD', () => {
    const r = validateRequest(parts(), [sessionParam], undefined)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
      expect(r.errors[0]?.path).toBe('/cookie/session')
    }
  })
})
