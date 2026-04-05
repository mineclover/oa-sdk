/**
 * OAS 3.2.0 §4.8.16 Responses Object / §4.8.17 Response Object — 스펙 해석 검증
 * 참조: docs/references/oas32/09-responses.md
 *
 * 검증 항목:
 * - 상태 코드 우선순위: 정확한 3자리 > 범위 코드(nXX) > default
 * - 범위 코드: 1XX, 2XX, 3XX, 4XX, 5XX (대소문자 무관)
 * - default: 나머지 모든 상태 코드에 해당
 * - 2xx 중 가장 낮은 코드 우선
 */
import { describe, it, expect } from 'vitest'
import { pickResponse } from '../../core/response-picker.js'
import type { OasResponse } from '@oa-sdk/parser'

function r(body: unknown = null): OasResponse {
  return { description: 'Test', content: { 'application/json': { example: body } } }
}

// ─── 정확한 코드 우선순위 ─────────────────────────────��───────────────────────

describe('정확한 3자리 코드 우선순위 (§4.8.16)', () => {
  it('200 < 201 이므로 200 선택', () => {
    expect(pickResponse({ '200': r(200), '201': r(201) })?.status).toBe(200)
  })

  it('202 < 204 이므로 202 선택', () => {
    expect(pickResponse({ '204': r(), '202': r() })?.status).toBe(202)
  })

  it('2xx 없으면 가장 낮은 다른 코드 선택', () => {
    expect(pickResponse({ '500': r(), '400': r(), '404': r() })?.status).toBe(400)
  })

  it('정확한 코드는 같은 범위의 범위코드보다 우선한다', () => {
    const result = pickResponse({ '2XX': r('range'), '200': r('exact') })
    expect(result?.status).toBe(200)
    expect(result?.body).toBe('exact')
  })

  it('정확한 코드는 default보다 우선한다', () => {
    const result = pickResponse({ default: r('fallback'), '201': r('real') })
    expect(result?.status).toBe(201)
    expect(result?.body).toBe('real')
  })
})

// ─── 범위 코드 ───────────────────────────────────────────────────────────────��

describe('범위 코드 nXX (§4.8.16 — 1XX, 2XX, 3XX, 4XX, 5XX)', () => {
  it('2XX → 200 반환', () => {
    const result = pickResponse({ '2XX': r('ok') })
    expect(result?.status).toBe(200)
    expect(result?.body).toBe('ok')
  })

  it('4XX → 400 반환', () => {
    const result = pickResponse({ '4XX': r('err') })
    expect(result?.status).toBe(400)
    expect(result?.body).toBe('err')
  })

  it('5XX → 500 반환', () => {
    expect(pickResponse({ '5XX': r() })?.status).toBe(500)
  })

  it('1XX → 100 반환', () => {
    expect(pickResponse({ '1XX': r() })?.status).toBe(100)
  })

  it('소문자 2xx도 인식한다', () => {
    expect(pickResponse({ '2xx': r() })?.status).toBe(200)
  })

  it('2XX > 4XX 우선: 2XX 반환', () => {
    expect(pickResponse({ '4XX': r(), '2XX': r() })?.status).toBe(200)
  })

  it('범위코드만 있을 때 correct body 반환', () => {
    const result = pickResponse({
      '4XX': { description: 'Error', content: { 'application/json': { example: { code: 'ERR' } } } },
    })
    expect(result?.body).toEqual({ code: 'ERR' })
  })
})

// ─── default ─────────────────────────────────────────────────────────────────

describe('default 응답 (§4.8.16 — 나머지 모든 코드)', () => {
  it('default만 정의 → 200 + 해당 body', () => {
    const result = pickResponse({ default: r({ ok: true }) })
    expect(result?.status).toBe(200)
    expect(result?.body).toEqual({ ok: true })
  })

  it('범위코드 있으면 default 무시', () => {
    const result = pickResponse({ '2XX': r('range'), default: r('fallback') })
    expect(result?.body).toBe('range')
  })

  it('정확한 코드 있으면 default 무시', () => {
    const result = pickResponse({ '200': r('ok'), default: r('fallback') })
    expect(result?.body).toBe('ok')
  })
})

// ─── Response Object 필드 ─────────────────────────────────────────────────────

describe('Response Object (§4.8.17)', () => {
  it('content 없는 204 → body: null, contentType: application/json 기본값', () => {
    const result = pickResponse({ '204': { description: 'No Content' } })
    expect(result?.status).toBe(204)
    expect(result?.body).toBeNull()
    expect(result?.contentType).toBe('application/json')
  })

  it('responses 비어있으면 null', () => {
    expect(pickResponse({})).toBeNull()
  })

  it('첫 번째 content key가 contentType', () => {
    const result = pickResponse({
      '200': { description: 'OK', content: { 'text/plain': { example: 'hi' } } },
    })
    expect(result?.contentType).toBe('text/plain')
  })
})
