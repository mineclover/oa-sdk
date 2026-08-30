import { describe, it, expect } from 'vitest'
import { schemaToTs } from '../../typegen/schema-to-ts.js'
import type { OasSchema } from '@oa-sdk/parser'

describe('schemaToTs — primitives', () => {
  it('string', () => expect(schemaToTs({ type: 'string' })).toBe('string'))
  it('integer', () => expect(schemaToTs({ type: 'integer' })).toBe('number'))
  it('number', () => expect(schemaToTs({ type: 'number' })).toBe('number'))
  it('boolean', () => expect(schemaToTs({ type: 'boolean' })).toBe('boolean'))
  it('null', () => expect(schemaToTs({ type: 'null' })).toBe('null'))
})

describe('schemaToTs — nullable (type array)', () => {
  it('["string", "null"] → string | null', () => {
    expect(schemaToTs({ type: ['string', 'null'] })).toBe('string | null')
  })
  it('["integer", "null"] → number | null', () => {
    expect(schemaToTs({ type: ['integer', 'null'] })).toBe('number | null')
  })
})

describe('schemaToTs — enum / const', () => {
  it('string enum', () => {
    expect(schemaToTs({ enum: ['a', 'b', 'c'] })).toBe("'a' | 'b' | 'c'")
  })
  it('numeric enum', () => {
    expect(schemaToTs({ enum: [0, 1, 2] })).toBe('0 | 1 | 2')
  })

  it('boolean enum/const → boolean literal union', () => {
    expect(schemaToTs({ type: 'boolean', enum: [false] })).toBe('false')
    expect(schemaToTs({ type: 'boolean', const: false })).toBe('false')
  })
  it('const string', () => {
    expect(schemaToTs({ const: 'active' })).toBe("'active'")
  })
  it('const number', () => {
    expect(schemaToTs({ const: 42 })).toBe('42')
  })
  it('string type + enum', () => {
    expect(schemaToTs({ type: 'string', enum: ['admin', 'user'] })).toBe("'admin' | 'user'")
  })

  it('escapes control characters in string enum and const literals', () => {
    expect(schemaToTs({ type: 'string', enum: ['line\nbreak'] })).toBe("'line\\nbreak'")
    expect(schemaToTs({ type: 'string', const: 'tab\tvalue' })).toBe("'tab\\tvalue'")
  })

  it('integer enum → 리터럴 유니온', () => {
    expect(schemaToTs({ type: 'integer', enum: [0, 1, 2] })).toBe('0 | 1 | 2')
  })

  it('number enum → 리터럴 유니온', () => {
    expect(schemaToTs({ type: 'number', enum: [1.5, 2.5] })).toBe('1.5 | 2.5')
  })

  it('중첩된 integer enum → 리터럴 유니온', () => {
    const result = schemaToTs({
      type: 'object',
      properties: { status: { type: 'integer', enum: [0, 1, 2] } },
    })
    expect(result).toContain('status?: 0 | 1 | 2')
  })
})

describe('schemaToTs — object', () => {
  it('simple object', () => {
    const result = schemaToTs({
      type: 'object',
      properties: { id: { type: 'string' }, name: { type: 'string' } },
      required: ['id', 'name'],
    })
    expect(result).toContain('id: string')
    expect(result).toContain('name: string')
    expect(result).not.toContain('?')
  })

  it('optional fields (not in required)', () => {
    const result = schemaToTs({
      type: 'object',
      properties: { id: { type: 'string' }, bio: { type: 'string' } },
      required: ['id'],
    })
    expect(result).toContain('id: string')
    expect(result).toContain('bio?: string')
  })

  it('escapes control characters in property keys', () => {
    const result = schemaToTs({
      type: 'object',
      properties: { 'bad\nkey': { type: 'string' } },
    })
    expect(result).toContain("'bad\\nkey'?: string")
    expect(result).not.toContain("'bad\nkey'")
  })

  it('empty object → Record<string, unknown>', () => {
    expect(schemaToTs({ type: 'object' })).toBe('Record<string, unknown>')
  })

  it('nested object', () => {
    const result = schemaToTs({
      type: 'object',
      properties: {
        address: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
      required: ['address'],
    })
    expect(result).toContain('address: {')
    expect(result).toContain('city: string')
  })
})

describe('schemaToTs — array', () => {
  it('string[]', () => {
    expect(schemaToTs({ type: 'array', items: { type: 'string' } })).toBe('string[]')
  })

  it('number[]', () => {
    expect(schemaToTs({ type: 'array', items: { type: 'number' } })).toBe('number[]')
  })

  it('union array → parenthesized', () => {
    const result = schemaToTs({
      type: 'array',
      items: { oneOf: [{ type: 'string' }, { type: 'number' }] },
    })
    expect(result).toBe('(string | number)[]')
  })

  it('no items → unknown[]', () => {
    expect(schemaToTs({ type: 'array' })).toBe('unknown[]')
  })
})

describe('schemaToTs — composition', () => {
  it('allOf → intersection', () => {
    const result = schemaToTs({
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
      ],
    })
    expect(result).toContain('&')
    expect(result).toContain('a: string')
    expect(result).toContain('b: number')
  })

  it('oneOf → union', () => {
    const result = schemaToTs({
      oneOf: [{ type: 'string' }, { type: 'number' }],
    })
    expect(result).toBe('string | number')
  })

  it('anyOf → union', () => {
    const result = schemaToTs({
      anyOf: [{ type: 'string' }, { type: 'boolean' }],
    })
    expect(result).toBe('string | boolean')
  })
})

describe('schemaToTs — $ref', () => {
  it('#/components/schemas/User → User', () => {
    expect(schemaToTs({ $ref: '#/components/schemas/User' })).toBe('User')
  })
})

describe('schemaToTs — example/default는 타입에 영향 없음', () => {
  it('example이 있어도 type 기준 변환', () => {
    expect(schemaToTs({ type: 'string', example: 'hello' })).toBe('string')
  })

  it('default가 있어도 type 기준 변환', () => {
    expect(schemaToTs({ type: 'integer', default: 42 })).toBe('number')
  })

  it('object 내부 프로퍼티의 example도 무시', () => {
    const result = schemaToTs({
      type: 'object',
      properties: {
        code: { type: 'string', example: 'NOT_FOUND' },
        count: { type: 'integer', default: 0 },
      },
      required: ['code', 'count'],
    })
    expect(result).toContain('code: string')
    expect(result).toContain('count: number')
    expect(result).not.toContain('unknown')
  })

  it('prefixItems 내 example이 있어도 타입 정보로 변환', () => {
    const result = schemaToTs({
      type: 'array',
      prefixItems: [
        { type: 'string', example: 'hello' },
        { type: 'integer', example: 42 },
      ],
    })
    expect(result).toBe('[string, number]')
  })
})

describe('schemaToTs — special keys', () => {
  it('property with special chars → quoted', () => {
    const result = schemaToTs({
      type: 'object',
      properties: { 'content-type': { type: 'string' } },
      required: ['content-type'],
    })
    expect(result).toContain("'content-type': string")
  })
})

describe('schemaToTs — discriminated union (oneOf + discriminator)', () => {
  it('oneOf + discriminator → TypeScript union', () => {
    const schema: OasSchema = {
      oneOf: [
        { type: 'object', required: ['type', 'name'], properties: { type: { type: 'string', const: 'dog' }, name: { type: 'string' } } },
        { type: 'object', required: ['type', 'lives'], properties: { type: { type: 'string', const: 'cat' }, lives: { type: 'integer' } } },
      ],
      discriminator: { propertyName: 'type' },
    }
    const result = schemaToTs(schema)
    // Should produce union of the two object types
    expect(result).toContain("type: 'dog'")
    expect(result).toContain("type: 'cat'")
    expect(result).toContain('|')
  })

  it('oneOf + discriminator with three variants', () => {
    const schema: OasSchema = {
      oneOf: [
        { type: 'object', required: ['kind'], properties: { kind: { type: 'string', const: 'circle' }, radius: { type: 'number' } } },
        { type: 'object', required: ['kind'], properties: { kind: { type: 'string', const: 'square' }, side: { type: 'number' } } },
        { type: 'object', required: ['kind'], properties: { kind: { type: 'string', const: 'triangle' }, base: { type: 'number' }, height: { type: 'number' } } },
      ],
      discriminator: { propertyName: 'kind' },
    }
    const result = schemaToTs(schema)
    expect(result).toContain("kind: 'circle'")
    expect(result).toContain("kind: 'square'")
    expect(result).toContain("kind: 'triangle'")
    expect(result).toContain('|')
  })
})

describe('schemaToTs — if/then/else', () => {
  it('if/then/else → union 타입', () => {
    const result = schemaToTs({
      if: { properties: { kind: { const: 'text' } } },
      then: { type: 'object', properties: { content: { type: 'string' } } },
      else: { type: 'object', properties: { content: { type: 'integer' } } },
    })
    expect(result).toContain('|')  // union of then and else
  })

  it('then만 → 단일 타입', () => {
    const result = schemaToTs({
      if: { properties: { kind: { const: 'text' } } },
      then: { type: 'string' },
    })
    expect(result).toBe('string')
  })
})

describe('schemaToTs — additionalProperties', () => {
  it('additionalProperties: true (no fixed props) → Record<string, unknown>', () => {
    const result = schemaToTs({ type: 'object', additionalProperties: true })
    expect(result).toBe('Record<string, unknown>')
  })

  it('additionalProperties schema (no fixed props) → Record<string, T>', () => {
    const result = schemaToTs({ type: 'object', additionalProperties: { type: 'string' } })
    expect(result).toBe('Record<string, string>')
  })

  it('additionalProperties: { type: "number" } → Record<string, number>', () => {
    const result = schemaToTs({ type: 'object', additionalProperties: { type: 'number' } })
    expect(result).toBe('Record<string, number>')
  })

  it('properties + additionalProperties → mixed object with index signature', () => {
    const result = schemaToTs({
      type: 'object',
      properties: { id: { type: 'integer' } },
      additionalProperties: { type: 'string' },
    })
    expect(result).toContain('id')
    expect(result).toContain('[key: string]: string')
  })

  it('properties + additionalProperties: true → index signature unknown', () => {
    const result = schemaToTs({
      type: 'object',
      properties: { name: { type: 'string' } },
      additionalProperties: true,
    })
    expect(result).toContain('name')
    expect(result).toContain('[key: string]: unknown')
  })

  it('additionalProperties: false → no index signature', () => {
    const result = schemaToTs({
      type: 'object',
      properties: { id: { type: 'integer' } },
      additionalProperties: false,
    })
    expect(result).toContain('id')
    expect(result).not.toContain('[key: string]')
  })

  it('unevaluatedProperties schema (OAS 3.2 map) → Record<string, T>', () => {
    const result = schemaToTs({
      type: 'object',
      unevaluatedProperties: { type: 'string' },
    })
    expect(result).toBe('Record<string, string>')
  })

  it('properties + unevaluatedProperties → typed index signature', () => {
    const result = schemaToTs({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      unevaluatedProperties: { type: 'integer' },
    })
    expect(result).toContain('id: string')
    expect(result).toContain('[key: string]: number')
  })

  it('unevaluatedProperties: { not: {} } → sealed object without index signature', () => {
    const result = schemaToTs({
      type: 'object',
      properties: { id: { type: 'string' } },
      unevaluatedProperties: { not: {} },
    })
    expect(result).toContain('id?: string')
    expect(result).not.toContain('[key: string]')
  })
})

describe('schemaToTs — allOf 3개 이상 스키마 합성', () => {
  it('allOf 3개 이상 스키마 합성 → intersection', () => {
    const schema: OasSchema = {
      allOf: [
        { type: 'object', properties: { id: { type: 'integer' } } },
        { type: 'object', properties: { name: { type: 'string' } } },
        { type: 'object', properties: { email: { type: 'string' } } },
      ],
    }
    const result = schemaToTs(schema)
    expect(result).toContain('&')
    expect(result).toContain('id')
    expect(result).toContain('name')
    expect(result).toContain('email')
  })

  it('allOf with $ref and inline schema', () => {
    const schema: OasSchema = {
      allOf: [
        { $ref: '#/components/schemas/Base' },
        { type: 'object', properties: { extra: { type: 'string' } }, required: ['extra'] },
      ],
    }
    const result = schemaToTs(schema)
    expect(result).toContain('Base')
    expect(result).toContain('&')
    expect(result).toContain('extra: string')
  })
})
