/**
 * response-picker.ts — 본문 선택 우선순위 단위 테스트
 * OAS 3.2.0 §4.8.19 Example Object: dataValue > value > example > schema.example > schema.default > minimal
 */
import { describe, it, expect } from 'vitest'
import { pickResponse } from '../../core/response-picker.js'
import type { OasResponse } from '@oa-sdk/parser'

function res200(content: OasResponse['content']): Record<string, OasResponse> {
  return { '200': { description: 'OK', ...(content !== undefined && { content }) } }
}

// ─── examples 우선순위 ────────────────────────────────────────────────────────

describe('examples map (OAS 3.2.0 §4.8.13 — examples 우선순위 최상위)', () => {
  it('dataValue를 반환한다 (OAS 3.2 방식)', () => {
    const r = pickResponse(res200({
      'application/json': {
        examples: { default: { dataValue: { id: 1 }, serializedValue: '{"id":1}' } },
        example: 'should-be-ignored',
      },
    }))
    expect(r?.body).toEqual({ id: 1 })
  })

  it('dataValue 없으면 value로 폴백 (OAS 3.1 compat)', () => {
    const r = pickResponse(res200({
      'application/json': {
        examples: { default: { value: { legacy: true } } },
      },
    }))
    expect(r?.body).toEqual({ legacy: true })
  })

  it('여러 examples 중 첫 번째만 사용', () => {
    const r = pickResponse(res200({
      'application/json': {
        examples: {
          first: { dataValue: { order: 1 } },
          second: { dataValue: { order: 2 } },
        },
      },
    }))
    expect((r?.body as Record<string, number>).order).toBe(1)
  })

  it('dataValue가 0(falsy)이어도 반환한다', () => {
    expect(pickResponse(res200({ 'application/json': { examples: { d: { dataValue: 0 } } } }))?.body).toBe(0)
  })

  it('dataValue가 false이어도 반환한다', () => {
    expect(pickResponse(res200({ 'application/json': { examples: { d: { dataValue: false } } } }))?.body).toBe(false)
  })

  it('dataValue가 null이어도 반환한다', () => {
    expect(pickResponse(res200({ 'application/json': { examples: { d: { dataValue: null } } } }))?.body).toBeNull()
  })

  it('serializedValue는 body 선택에서 무시된다 (와이어 포맷)', () => {
    const r = pickResponse(res200({
      'application/json': {
        examples: {
          d: { serializedValue: '{"wire":"format"}' },
        },
      },
    }))
    // dataValue도 value도 없으므로 examples에서 꺼낼 body 없음 → 다음 우선순위로
    expect(r?.body).not.toBe('{"wire":"format"}')
  })
})

// ─── example / schema.example / schema.default ───────────────────────────────

describe('폴백 우선순위: example → schema.example → schema.default', () => {
  it('mediaType.example 반환', () => {
    const r = pickResponse(res200({ 'application/json': { example: { inline: true } } }))
    expect(r?.body).toEqual({ inline: true })
  })

  it('schema.example 반환', () => {
    const r = pickResponse(res200({
      'application/json': { schema: { type: 'object', example: { from: 'schema' } } },
    }))
    expect(r?.body).toEqual({ from: 'schema' })
  })

  it('schema.default 반환', () => {
    const r = pickResponse(res200({
      'application/json': { schema: { type: 'string', default: 'fallback' } },
    }))
    expect(r?.body).toBe('fallback')
  })

  it('우선순위: examples > example > schema.example > schema.default', () => {
    const r = pickResponse(res200({
      'application/json': {
        examples: { d: { dataValue: 'from-examples' } },
        example: 'from-example',
        schema: { type: 'string', example: 'from-schema-ex', default: 'from-default' },
      },
    }))
    expect(r?.body).toBe('from-examples')
  })
})

// ─── contentType ──────────────────────────────────────────────────────────────

describe('contentType 선택', () => {
  it('첫 번째 content key를 contentType으로 반환', () => {
    expect(pickResponse(res200({ 'text/plain': { example: 'hi' } }))?.contentType).toBe('text/plain')
  })

  it('content 없으면 application/json 기본값', () => {
    expect(pickResponse({ '204': { description: 'No Content' } })?.contentType).toBe('application/json')
  })

  it('text/event-stream → SSE contentType 그대로 반환', () => {
    const r = pickResponse(res200({
      'text/event-stream': {
        examples: { d: { dataValue: { event: 'update' } } },
      },
    }))
    expect(r?.contentType).toBe('text/event-stream')
    expect(r?.body).toEqual({ event: 'update' })
  })
})

// ─── dataValue: null + schema default 조합 ──────────────────────────────────

describe('dataValue: null은 schema default보다 우선', () => {
  it('dataValue: null이면 schema default 무시', () => {
    const responses = {
      '200': {
        description: 'OK',
        content: {
          'application/json': {
            examples: { d: { dataValue: null } },
            schema: { type: 'string', default: 'fallback' },
          },
        },
      },
    }
    const picked = pickResponse(responses as any)
    expect(picked?.body).toBe(null)
  })
})

describe('response links metadata', () => {
  it('operation link 메타데이터를 body 변경 없이 노출한다', () => {
    const picked = pickResponse({
      '201': {
        description: 'Created',
        links: {
          getOrder: {
            operationId: 'getOrder',
            parameters: {
              orderId: '$response.body#/id',
              tenantId: '$request.path.tenantId',
            },
            requestBody: '$request.body#/sku',
          },
        },
        content: {
          'application/json': {
            example: { id: 'ord_123', status: 'created' },
          },
        },
      },
    })

    expect(picked?.body).toEqual({ id: 'ord_123', status: 'created' })
    expect(picked?.links).toEqual({
      getOrder: {
        operationId: 'getOrder',
        parameters: {
          orderId: '$response.body#/id',
          tenantId: '$request.path.tenantId',
        },
        requestBody: '$request.body#/sku',
      },
    })
  })
})
