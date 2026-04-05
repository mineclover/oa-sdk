/**
 * core/generate.ts + core/stream.ts — GenerateFolder / StreamFolder 단위 테스트
 */
import { describe, it, expect } from 'vitest'
import { GenerateFolder, generator } from '../../core/generate.js'
import { StreamFolder, streamer, formatSseChunk, formatNdjsonLine, isStreamingContentType, SSE_DONE } from '../../core/stream.js'
import type { OasSchema as SchemaObject } from '@oa-sdk/parser'

// ─── GenerateFolder ───────────────────────────────────────────────────────────

describe('GenerateFolder — 기본 타입', () => {
  it('string → ""', () => expect(generator.fold({ type: 'string' })).toBe(''))
  it('integer → 0', () => expect(generator.fold({ type: 'integer' })).toBe(0))
  it('number → 0', () => expect(generator.fold({ type: 'number' })).toBe(0))
  it('boolean → false', () => expect(generator.fold({ type: 'boolean' })).toBe(false))
  it('null → null', () => expect(generator.fold({ type: 'null' })).toBeNull())
  it('minimum → minimum 값', () => expect(generator.fold({ type: 'integer', minimum: 5 })).toBe(5))
  it('enum → 첫 번째 값', () => expect(generator.fold({ type: 'string', enum: ['a', 'b'] })).toBe('a'))
})

describe('GenerateFolder — format', () => {
  it('uuid', () => expect(generator.fold({ type: 'string', format: 'uuid' })).toBe('00000000-0000-0000-0000-000000000000'))
  it('email', () => expect(generator.fold({ type: 'string', format: 'email' })).toBe('example@example.com'))
  it('date', () => expect(generator.fold({ type: 'string', format: 'date' })).toBe('1970-01-01'))
  it('uri', () => expect(generator.fold({ type: 'string', format: 'uri' })).toBe('https://example.com'))
})

describe('GenerateFolder — object', () => {
  it('required 필드만 생성', () => {
    const schema: SchemaObject = {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        optional: { type: 'string' },
      },
    }
    const result = generator.fold(schema) as Record<string, unknown>
    expect(result).toHaveProperty('id', '00000000-0000-0000-0000-000000000000')
    expect(result).not.toHaveProperty('optional')
  })

  it('중첩 object', () => {
    const schema: SchemaObject = {
      type: 'object',
      required: ['user'],
      properties: {
        user: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
        },
      },
    }
    const result = generator.fold(schema) as Record<string, Record<string, unknown>>
    expect(result.user!.name).toBe('')
  })
})

describe('GenerateFolder — array', () => {
  it('minItems 없으면 빈 배열', () => {
    expect(generator.fold({ type: 'array', items: { type: 'string' } })).toEqual([])
  })

  it('minItems:2 → 2개 생성', () => {
    const result = generator.fold({ type: 'array', minItems: 2, items: { type: 'integer' } }) as unknown[]
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(0)
  })
})

describe('GenerateFolder — 조합 스키마', () => {
  it('allOf 첫 번째 브랜치', () => {
    const result = generator.fold({
      allOf: [{ type: 'object', required: ['x'], properties: { x: { type: 'integer' } } }],
    }) as Record<string, unknown>
    expect(result.x).toBe(0)
  })

  it('oneOf 첫 번째 브랜치', () => {
    expect(typeof generator.fold({ oneOf: [{ type: 'string' }, { type: 'integer' }] })).toBe('string')
  })
})

describe('GenerateFolder — 방어 케이스', () => {
  it('$ref → null (방어선)', () => {
    expect(generator.fold({ $ref: '#/components/schemas/Foo' })).toBeNull()
  })

  it('example 우선 사용', () => {
    expect(generator.fold({ type: 'string', example: 'hello' })).toBe('hello')
  })

  it('default 우선 사용 (example 없을 때)', () => {
    expect(generator.fold({ type: 'integer', default: 42 })).toBe(42)
  })
})

describe('GenerateFolder — 클래스 기반 확장', () => {
  it('generateString 오버라이드', () => {
    class PrefixFolder extends GenerateFolder {
      protected override generateString(schema: SchemaObject): string {
        return 'PREFIX_' + super.generateString(schema)
      }
    }
    const f = new PrefixFolder()
    expect(f.fold({ type: 'string' })).toBe('PREFIX_')
    expect(f.fold({ type: 'string', format: 'email' })).toBe('PREFIX_example@example.com')
  })
})

// ─── StreamFolder ──────────────────────────────────────────────────────────────

describe('StreamFolder — 기본 생성', () => {
  it('기본 count=3 + terminator', async () => {
    const items: unknown[] = []
    for await (const item of streamer.generate({ type: 'string' })) {
      items.push(item)
    }
    expect(items).toHaveLength(4) // 3 values + [DONE]
    expect(items[3]).toBe(SSE_DONE)
  })

  it('count 옵션', async () => {
    const items: unknown[] = []
    for await (const item of streamer.generate({ type: 'integer' }, { count: 5, includeTerminator: false })) {
      items.push(item)
    }
    expect(items).toHaveLength(5)
    expect(items.every(v => v === 0)).toBe(true)
  })

  it('includeTerminator: false → [DONE] 없음', async () => {
    const items: unknown[] = []
    for await (const item of streamer.generate({ type: 'boolean' }, { count: 2, includeTerminator: false })) {
      items.push(item)
    }
    expect(items).not.toContain(SSE_DONE)
  })
})

describe('StreamFolder — itemSchema (OAS 3.2)', () => {
  it('itemSchema 있으면 이벤트 스키마로 사용', async () => {
    const schema = {
      type: 'object',
      itemSchema: {
        type: 'object',
        required: ['event'],
        properties: { event: { type: 'string', enum: ['update'] } },
      },
    } as SchemaObject

    const items: unknown[] = []
    for await (const item of streamer.generate(schema, { count: 2, includeTerminator: false })) {
      items.push(item)
    }
    expect(items).toHaveLength(2)
    expect((items[0] as Record<string, unknown>).event).toBe('update')
  })

  it('itemSchema 없으면 schema 자체를 이벤트 스키마로', async () => {
    const items: unknown[] = []
    for await (const item of streamer.generate({ type: 'integer', minimum: 10 }, { count: 1, includeTerminator: false })) {
      items.push(item)
    }
    expect(items[0]).toBe(10)
  })
})

describe('StreamFolder — 스키마 기반 object 이벤트', () => {
  it('object 스키마에서 각 이벤트가 required 필드 포함', async () => {
    const schema: SchemaObject = {
      type: 'object',
      required: ['id', 'ts'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        ts: { type: 'string', format: 'date-time' },
      },
    }
    const items: unknown[] = []
    for await (const item of streamer.generate(schema, { count: 3, includeTerminator: false })) {
      items.push(item)
    }
    for (const item of items) {
      const ev = item as Record<string, unknown>
      expect(ev).toHaveProperty('id')
      expect(ev).toHaveProperty('ts')
    }
  })
})

// ─── 포맷 헬퍼 ────────────────────────────────────────────────────────────────

describe('formatSseChunk', () => {
  it('객체 → data: <json>\\n\\n', () => {
    expect(formatSseChunk({ ok: true })).toBe('data: {"ok":true}\n\n')
  })

  it('[DONE] → data: [DONE]\\n\\n', () => {
    expect(formatSseChunk(SSE_DONE)).toBe('data: [DONE]\n\n')
  })

  it('null → data: null\\n\\n', () => {
    expect(formatSseChunk(null)).toBe('data: null\n\n')
  })
})

describe('formatNdjsonLine', () => {
  it('객체 → <json>\\n', () => {
    expect(formatNdjsonLine({ x: 1 })).toBe('{"x":1}\n')
  })

  it('null → null\\n', () => {
    expect(formatNdjsonLine(null)).toBe('null\n')
  })

  it('[DONE] 문자열 → 인코딩됨 (NDJSON은 텍스트 이벤트가 아님)', () => {
    expect(formatNdjsonLine(SSE_DONE)).toBe('"[DONE]"\n')
  })
})

describe('StreamFolder — NDJSON includeTerminator: false', () => {
  it('application/x-ndjson 시뮬레이션 — [DONE] 없음', async () => {
    const items: unknown[] = []
    for await (const item of streamer.generate({ type: 'integer' }, { count: 3, includeTerminator: false })) {
      items.push(item)
    }
    expect(items).toHaveLength(3)
    expect(items.every(v => v === 0)).toBe(true)
    expect(items).not.toContain(SSE_DONE)
  })
})

describe('isStreamingContentType', () => {
  it('text/event-stream → true', () => expect(isStreamingContentType('text/event-stream')).toBe(true))
  it('application/x-ndjson → true', () => expect(isStreamingContentType('application/x-ndjson')).toBe(true))
  it('application/jsonl → true', () => expect(isStreamingContentType('application/jsonl')).toBe(true))
  it('application/json → false', () => expect(isStreamingContentType('application/json')).toBe(false))
  it('text/plain → false', () => expect(isStreamingContentType('text/plain')).toBe(false))
})

// ─── GenerateFolder — OAS 3.2 type 배열 ──────────────────────────────────────

describe('GenerateFolder — OAS 3.2 type 배열 (§4.8.24)', () => {
  it('["string", "null"] → string 생성 (첫 번째 타입)', () => {
    expect(typeof generator.fold({ type: ['string', 'null'] })).toBe('string')
  })

  it('["integer", "null"] → 0 생성 (첫 번째 타입)', () => {
    expect(generator.fold({ type: ['integer', 'null'] })).toBe(0)
  })

  it('["boolean", "string"] → false 생성 (첫 번째 타입)', () => {
    expect(generator.fold({ type: ['boolean', 'string'] })).toBe(false)
  })

  it('["null", "string"] → null 생성 (첫 번째 타입)', () => {
    expect(generator.fold({ type: ['null', 'string'] })).toBeNull()
  })
})

// ─── GenerateFolder — 엣지 케이스 ────────────────────────────────────────────

describe('GenerateFolder — 엣지 케이스', () => {
  it('type 미지정 → null', () => {
    expect(generator.fold({})).toBeNull()
  })

  it('null 입력 → null', () => {
    expect(generator.fold(null)).toBeNull()
  })

  it('배열 입력 → null (스키마가 아님)', () => {
    expect(generator.fold([])).toBeNull()
  })

  it('primitive 입력 → null', () => {
    expect(generator.fold('not-a-schema')).toBeNull()
  })

  it('items 없고 minItems > 0 → null 항목 배열', () => {
    const result = generator.fold({ type: 'array', minItems: 2 }) as unknown[]
    expect(result).toHaveLength(2)
    expect(result.every(v => v === null)).toBe(true)
  })
})

// ─── StreamFolder — 엣지 케이스 ──────────────────────────────────────────────

describe('StreamFolder — 엣지 케이스', () => {
  it('count: 0 + includeTerminator: true → [DONE]만 반환', async () => {
    const items: unknown[] = []
    for await (const item of streamer.generate({ type: 'string' }, { count: 0 })) {
      items.push(item)
    }
    expect(items).toEqual([SSE_DONE])
  })

  it('count: 0 + includeTerminator: false → 빈 스트림', async () => {
    const items: unknown[] = []
    for await (const item of streamer.generate({ type: 'string' }, { count: 0, includeTerminator: false })) {
      items.push(item)
    }
    expect(items).toHaveLength(0)
  })

  it('type 미지정 스키마 → null 이벤트 생성', async () => {
    const items: unknown[] = []
    for await (const item of streamer.generate({} as any, { count: 2, includeTerminator: false })) {
      items.push(item)
    }
    expect(items).toHaveLength(2)
    expect(items.every(v => v === null)).toBe(true)
  })

  it('각 이벤트가 독립적으로 생성됨 (공유 상태 없음)', async () => {
    const items: unknown[] = []
    for await (const item of streamer.generate(
      { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } },
      { count: 3, includeTerminator: false },
    )) {
      items.push(item)
    }
    // 세 이벤트가 모두 같은 구조를 가지지만 별도 객체여야 함
    expect(items[0]).not.toBe(items[1])
    expect(items[0]).toEqual(items[1])
  })
})
