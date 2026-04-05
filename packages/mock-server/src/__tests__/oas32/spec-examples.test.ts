/**
 * OAS 3.2.0 §4.8.19 Example Object — 스펙 해석 검증
 * 참조: docs/references/oas32/10-examples-links.md
 *
 * OAS 3.2 핵심 변경:
 * - dataValue: 파싱된 데이터 표현 (스키마 검증에 사용)
 * - serializedValue: 와이어 포맷 문자열 (bytes 수준 표현)
 * - value: deprecated (JSON 직렬화가 아닌 포맷의 경우)
 *
 * mock-server는 response body로 dataValue를 우선 사용하고
 * serializedValue는 body 선택에서 무시한다.
 */
import { describe, it, expect } from 'vitest'
import { pickResponse } from '../../core/response-picker.js'
import type { OasResponse } from '@oa-sdk/parser'

function res(mediaContent: NonNullable<OasResponse['content']>[string]): Record<string, OasResponse> {
  return { '200': { description: 'OK', content: { 'application/json': mediaContent } } }
}

// ─── dataValue (OAS 3.2) ─────────────────────────────────────────────────────

describe('dataValue (OAS 3.2 신규 — §4.8.19)', () => {
  it('dataValue가 있으면 body로 반환한다', () => {
    const r = pickResponse(res({ examples: { default: { dataValue: { id: 1, name: 'test' } } } }))
    expect(r?.body).toEqual({ id: 1, name: 'test' })
  })

  it('dataValue는 어떤 JSON 타입이든 반환한다: string', () => {
    expect(pickResponse(res({ examples: { d: { dataValue: 'hello' } } }))?.body).toBe('hello')
  })

  it('dataValue는 어떤 JSON 타입이든 반환한다: number', () => {
    expect(pickResponse(res({ examples: { d: { dataValue: 42 } } }))?.body).toBe(42)
  })

  it('dataValue는 어떤 JSON 타입이든 반환한다: boolean false', () => {
    expect(pickResponse(res({ examples: { d: { dataValue: false } } }))?.body).toBe(false)
  })

  it('dataValue는 어떤 JSON 타입이든 반환한다: null', () => {
    // null은 명시적 null이므로 반환되어야 함
    expect(pickResponse(res({ examples: { d: { dataValue: null } } }))?.body).toBeNull()
  })

  it('dataValue가 0이면 반환한다 (falsy 처리 방지)', () => {
    expect(pickResponse(res({ examples: { d: { dataValue: 0 } } }))?.body).toBe(0)
  })
})

// ─── serializedValue — body 선택에서 제외 ────────────────────────────────────

describe('serializedValue — body 선택 무시 (§4.8.19 — 와이어 포맷)', () => {
  it('serializedValue만 있고 dataValue/value 없으면 examples에서 body 못 꺼냄 → 다음 우선순위로', () => {
    const r = pickResponse(res({
      examples: { d: { serializedValue: '{"wire":"only"}' } },
      example: { fallback: true },
    }))
    // serializedValue는 무시 → example 폴백
    expect(r?.body).toEqual({ fallback: true })
  })

  it('dataValue + serializedValue 함께 있으면 dataValue만 반환', () => {
    const r = pickResponse(res({
      examples: {
        d: {
          dataValue: { parsed: true },
          serializedValue: '{"parsed":true}',
        },
      },
    }))
    expect(r?.body).toEqual({ parsed: true })
  })
})

// ─── OAS 3.1 value 호환 ───────────────────────────────────────────────────────

describe('value 폴백 (OAS 3.1 compat — §4.8.19)', () => {
  it('dataValue 없으면 value로 폴백한다', () => {
    const r = pickResponse(res({ examples: { d: { value: { from: 'oas31' } } } }))
    expect(r?.body).toEqual({ from: 'oas31' })
  })

  it('dataValue가 있으면 value보다 우선한다', () => {
    const r = pickResponse(res({
      examples: { d: { dataValue: 'newer', value: 'older' } },
    }))
    expect(r?.body).toBe('newer')
  })
})

// ─── example vs examples 상호 배타 ───────────────────────────────────────────

describe('examples > example 우선순위', () => {
  it('examples가 있으면 example을 무시한다', () => {
    const r = pickResponse(res({
      examples: { d: { dataValue: 'from-examples' } },
      example: 'should-be-ignored',
    }))
    expect(r?.body).toBe('from-examples')
  })

  it('examples가 없으면 example을 사용한다', () => {
    const r = pickResponse(res({ example: { from: 'example' } }))
    expect(r?.body).toEqual({ from: 'example' })
  })
})

// ─── 비JSON 미디어 타입 ───────────────────────────────────────────────────────

describe('비JSON 미디어 타입 (text/event-stream, text/plain 등)', () => {
  it('text/plain dataValue → body로 반환', () => {
    const r = pickResponse({
      '200': {
        description: 'OK',
        content: {
          'text/plain': {
            examples: { d: { dataValue: 'plain text response' } },
          },
        },
      },
    })
    expect(r?.body).toBe('plain text response')
    expect(r?.contentType).toBe('text/plain')
  })

  it('text/event-stream dataValue → SSE body로 반환', () => {
    const r = pickResponse({
      '200': {
        description: 'OK',
        content: {
          'text/event-stream': {
            examples: { item: { dataValue: { event: 'update', id: '1' } } },
          },
        },
      },
    })
    expect(r?.body).toEqual({ event: 'update', id: '1' })
    expect(r?.contentType).toBe('text/event-stream')
  })
})
