/**
 * response-picker.ts — 스트리밍 응답 분기 단위 테스트
 * pickResponse의 isStreamingContentType 경로 검증
 */
import { describe, it, expect } from 'vitest'
import { pickResponse } from '../../core/response-picker.js'
import type { OasResponse } from '@oa-sdk/parser'

function r200(content: NonNullable<OasResponse['content']>): Record<string, OasResponse> {
  return { '200': { description: 'OK', content } }
}

// ─── text/event-stream — stream 필드 ─────────────────────────────────────────

describe('pickResponse — text/event-stream + schema → stream 필드 설정', () => {
  it('schema만 있으면 stream: SchemaObject, body: null', () => {
    const schema = { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } }
    const result = pickResponse(r200({ 'text/event-stream': { schema } as any }))

    expect(result?.stream).toEqual(schema)
    expect(result?.body).toBeNull()
    expect(result?.contentType).toBe('text/event-stream')
  })

  it('schema 없으면 stream: undefined, body: null', () => {
    const result = pickResponse(r200({ 'text/event-stream': {} as any }))
    expect(result?.stream).toBeUndefined()
    expect(result?.body).toBeNull()
  })

  it('dataValue example 있으면 body로, stream 없음', () => {
    const result = pickResponse(r200({
      'text/event-stream': {
        examples: { item: { dataValue: { event: 'ping' } } },
      } as any,
    }))
    expect(result?.body).toEqual({ event: 'ping' })
    expect(result?.stream).toBeUndefined()
  })

  it('value(OAS 3.1) example 있으면 body로, stream 없음', () => {
    const result = pickResponse(r200({
      'text/event-stream': {
        examples: { item: { value: { legacy: true } } },
      } as any,
    }))
    expect(result?.body).toEqual({ legacy: true })
    expect(result?.stream).toBeUndefined()
  })

  it('example(인라인) 있으면 body로, stream 없음', () => {
    const result = pickResponse(r200({
      'text/event-stream': { example: { inline: 'ok' } } as any,
    }))
    expect(result?.body).toEqual({ inline: 'ok' })
    expect(result?.stream).toBeUndefined()
  })

  it('example + schema 함께 있으면 example 우선 — stream 없음', () => {
    const result = pickResponse(r200({
      'text/event-stream': {
        example: { from: 'example' },
        schema: { type: 'object' },
      } as any,
    }))
    expect(result?.body).toEqual({ from: 'example' })
    expect(result?.stream).toBeUndefined()
  })
})

// ─── resolveExampleOnly — schema.example 무시 ────────────────────────────────

describe('pickResponse — resolveExampleOnly는 schema.example/default 무시', () => {
  it('text/event-stream + schema.example만 → body: null, stream: schema', () => {
    const schema = { type: 'string', example: 'from-schema' }
    const result = pickResponse(r200({ 'text/event-stream': { schema } as any }))
    // resolveExampleOnly는 schema.example을 보지 않음
    // → stream: schema, body: null
    expect(result?.body).toBeNull()
    expect(result?.stream).toEqual(schema)
  })

  it('text/event-stream + schema.default만 → body: null, stream: schema', () => {
    const schema = { type: 'integer', default: 42 }
    const result = pickResponse(r200({ 'text/event-stream': { schema } as any }))
    expect(result?.body).toBeNull()
    expect(result?.stream).toEqual(schema)
  })
})

// ─── 다른 스트리밍 content-type ───────────────────────────────────────────────

describe('pickResponse — application/x-ndjson 스트리밍 처리', () => {
  it('application/x-ndjson + schema → stream 필드', () => {
    const schema = { type: 'object' }
    const result = pickResponse(r200({ 'application/x-ndjson': { schema } as any }))
    expect(result?.stream).toEqual(schema)
    expect(result?.contentType).toBe('application/x-ndjson')
  })

  it('application/jsonl + schema → stream 필드', () => {
    const schema = { type: 'string' }
    const result = pickResponse(r200({ 'application/jsonl': { schema } as any }))
    expect(result?.stream).toEqual(schema)
  })
})

// ─── 비스트리밍 타입 — 영향 없음 ──────────────────────────────────────────────

describe('pickResponse — 비스트리밍 타입 stream 필드 없음', () => {
  it('application/json + schema → stream 없음, body 생성', () => {
    const result = pickResponse(r200({
      'application/json': {
        schema: { type: 'object', required: ['x'], properties: { x: { type: 'integer' } } },
      },
    }))
    expect(result?.stream).toBeUndefined()
    expect(result?.body).toEqual({ x: 0 })
  })

  it('text/plain + example → stream 없음', () => {
    const result = pickResponse(r200({
      'text/plain': { example: 'hello' },
    }))
    expect(result?.stream).toBeUndefined()
    expect(result?.body).toBe('hello')
  })
})

// ─── falsy dataValue (0, false, null) — 스트리밍 타입 ────────────────────────

describe('pickResponse — falsy dataValue 스트리밍', () => {
  it('dataValue: 0 → body: 0 (stream 없음)', () => {
    const result = pickResponse(r200({
      'text/event-stream': {
        examples: { d: { dataValue: 0 } },
      } as any,
    }))
    expect(result?.body).toBe(0)
    expect(result?.stream).toBeUndefined()
  })

  it('dataValue: false → body: false (stream 없음)', () => {
    const result = pickResponse(r200({
      'text/event-stream': {
        examples: { d: { dataValue: false } },
      } as any,
    }))
    expect(result?.body).toBe(false)
    expect(result?.stream).toBeUndefined()
  })

  it('dataValue: null → body: null, stream: undefined (null은 "없음"으로 처리)', () => {
    const result = pickResponse(r200({
      'text/event-stream': {
        examples: { d: { dataValue: null } },
      } as any,
    }))
    // first?.dataValue ?? first?.value → null ?? undefined → undefined
    // body !== undefined 실패 → example 없음으로 처리 → schema도 없음 → stream: undefined
    expect(result?.body).toBeNull()
    expect(result?.stream).toBeUndefined()
  })
})
