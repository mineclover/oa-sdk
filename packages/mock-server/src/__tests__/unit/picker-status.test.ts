/**
 * response-picker.ts — 상태 코드 선택 단위 테스트
 * OAS 3.2.0 §4.8.16 Responses Object: 정확한 코드 > 범위 코드 > default
 */
import { describe, it, expect } from 'vitest'
import { pickResponse } from '../../core/response-picker.js'
import type { OasResponse } from '@oa-sdk/parser'

function r(example: unknown = null): OasResponse {
  return { description: 'Test', content: { 'application/json': { example } } }
}

// ─── 정확한 3자리 코드 ────────────────────────────────────────────────────────

describe('정확한 3자리 상태 코드 (OAS 3.2.0 §4.8.16)', () => {
  it('2xx 중 가장 낮은 코드를 선택한다', () => {
    expect(pickResponse({ '201': r(1), '200': r(2), '400': r(3) })?.status).toBe(200)
  })

  it('200이 없으면 다음 2xx (201)', () => {
    expect(pickResponse({ '201': r(), '400': r() })?.status).toBe(201)
  })

  it('2xx가 없으면 정의된 코드 중 가장 낮은 것', () => {
    expect(pickResponse({ '400': r(), '404': r(), '500': r() })?.status).toBe(400)
  })

  it('단일 코드 → 그 코드 반환', () => {
    expect(pickResponse({ '204': { description: 'No Content' } })?.status).toBe(204)
  })
})

// ─── 범위 코드 ────────────────────────────────────────────────────────────────

describe('범위 코드 (OAS 3.2.0 §4.8.16 — 1XX, 2XX, 3XX, 4XX, 5XX)', () => {
  it('2XX → status: 200', () => {
    expect(pickResponse({ '2XX': r() })?.status).toBe(200)
  })

  it('4XX → status: 400', () => {
    expect(pickResponse({ '4XX': r() })?.status).toBe(400)
  })

  it('5XX → status: 500', () => {
    expect(pickResponse({ '5XX': r() })?.status).toBe(500)
  })

  it('소문자 2xx도 인식한다', () => {
    expect(pickResponse({ '2xx': r() })?.status).toBe(200)
  })

  it('정확한 코드 > 범위 코드 우선순위', () => {
    // 정확한 201이 있으면 2XX보다 우선
    expect(pickResponse({ '2XX': r('range'), '201': r('exact') })?.status).toBe(201)
    expect(pickResponse({ '2XX': r('range'), '201': r('exact') })?.body).toBe('exact')
  })

  it('2XX 없으면 4XX 범위 코드 선택', () => {
    expect(pickResponse({ '4XX': r(), '5XX': r() })?.status).toBe(400)
  })
})

// ─── default ─────────────────────────────────────────────────────────────────

describe('default 응답 (OAS 3.2.0 §4.8.16 — 가장 낮은 우선순위)', () => {
  it('default만 있으면 200 반환', () => {
    expect(pickResponse({ default: r() })?.status).toBe(200)
  })

  it('정확한 코드 있으면 default를 무시한다', () => {
    const result = pickResponse({ '200': r('exact'), default: r('fallback') })
    expect(result?.body).toBe('exact')
  })

  it('범위 코드 있으면 default를 무시한다', () => {
    const result = pickResponse({ '2XX': r('range'), default: r('fallback') })
    expect(result?.status).toBe(200)
    expect(result?.body).toBe('range')
  })
})

// ─── 빈/null 케이스 ───────────────────────────────────────────────────────────

describe('엣지 케이스', () => {
  it('responses가 비어 있으면 null', () => {
    expect(pickResponse({})).toBeNull()
  })

  it('content 없는 204 → body null', () => {
    const result = pickResponse({ '204': { description: 'No Content' } })
    expect(result?.status).toBe(204)
    expect(result?.body).toBeNull()
  })
})
