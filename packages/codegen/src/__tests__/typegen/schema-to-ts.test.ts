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
  it('const string', () => {
    expect(schemaToTs({ const: 'active' })).toBe("'active'")
  })
  it('const number', () => {
    expect(schemaToTs({ const: 42 })).toBe('42')
  })
  it('string type + enum', () => {
    expect(schemaToTs({ type: 'string', enum: ['admin', 'user'] })).toBe("'admin' | 'user'")
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
