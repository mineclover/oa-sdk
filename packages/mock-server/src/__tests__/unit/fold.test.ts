import { describe, it, expect } from 'vitest'
import { foldSchema, type SchemaAlgebra } from '@oa-sdk/parser'
import { generateAlgebra } from '../../core/generate.js'

// 테스트용 algebra: 스키마 구조를 문자열로 직렬화
const labelAlgebra: SchemaAlgebra<string> = {
  string: () => 'string',
  integer: () => 'integer',
  number: () => 'number',
  boolean: () => 'boolean',
  null: () => 'null',
  object: (_, props) => `object{${Object.entries(props).map(([k, v]) => `${k}:${v}`).join(',')}}`,
  array: (_, items) => `array[${items ?? 'any'}]`,
  allOf: (_, branches) => `allOf(${branches.join('|')})`,
  oneOf: (_, branches) => `oneOf(${branches.join('|')})`,
  anyOf: (_, branches) => `anyOf(${branches.join('|')})`,
  ref: (ref) => `$ref(${ref})`,
  example: (v) => `example(${JSON.stringify(v)})`,
  default_: (v) => `default(${JSON.stringify(v)})`,
  fallback: () => 'fallback',
}

describe('foldSchema — leaf types', () => {
  it('string', () => expect(foldSchema({ type: 'string' }, labelAlgebra)).toBe('string'))
  it('integer', () => expect(foldSchema({ type: 'integer' }, labelAlgebra)).toBe('integer'))
  it('number', () => expect(foldSchema({ type: 'number' }, labelAlgebra)).toBe('number'))
  it('boolean', () => expect(foldSchema({ type: 'boolean' }, labelAlgebra)).toBe('boolean'))
  it('null', () => expect(foldSchema({ type: 'null' }, labelAlgebra)).toBe('null'))
})

describe('foldSchema — object', () => {
  it('빈 properties', () => {
    expect(foldSchema({ type: 'object' }, labelAlgebra)).toBe('object{}')
  })

  it('properties 재귀 fold', () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'integer' } },
    }
    expect(foldSchema(schema, labelAlgebra)).toBe('object{name:string,age:integer}')
  })

  it('중첩 객체', () => {
    const schema = {
      type: 'object',
      properties: {
        address: { type: 'object', properties: { city: { type: 'string' } } },
      },
    }
    expect(foldSchema(schema, labelAlgebra)).toBe('object{address:object{city:string}}')
  })
})

describe('foldSchema — array', () => {
  it('items 있는 array', () => {
    expect(foldSchema({ type: 'array', items: { type: 'string' } }, labelAlgebra)).toBe('array[string]')
  })

  it('items 없는 array', () => {
    expect(foldSchema({ type: 'array' }, labelAlgebra)).toBe('array[any]')
  })

  it('중첩 array', () => {
    const schema = { type: 'array', items: { type: 'array', items: { type: 'number' } } }
    expect(foldSchema(schema, labelAlgebra)).toBe('array[array[number]]')
  })
})

describe('foldSchema — combinators', () => {
  it('allOf branches fold', () => {
    const schema = { allOf: [{ type: 'string' }, { type: 'number' }] }
    expect(foldSchema(schema, labelAlgebra)).toBe('allOf(string|number)')
  })

  it('oneOf branches fold', () => {
    const schema = { oneOf: [{ type: 'boolean' }, { type: 'null' }] }
    expect(foldSchema(schema, labelAlgebra)).toBe('oneOf(boolean|null)')
  })

  it('anyOf branches fold', () => {
    const schema = { anyOf: [{ type: 'string' }, { type: 'null' }] }
    expect(foldSchema(schema, labelAlgebra)).toBe('anyOf(string|null)')
  })

  it('빈 allOf는 fallback (length 0)', () => {
    // allOf?.length가 0이면 타입 분기로 이동
    expect(foldSchema({ allOf: [], type: 'string' }, labelAlgebra)).toBe('string')
  })
})

describe('foldSchema — $ref', () => {
  it('$ref algebra.ref 호출', () => {
    expect(foldSchema({ $ref: '#/components/schemas/User' }, labelAlgebra))
      .toBe('$ref(#/components/schemas/User)')
  })
})

describe('foldSchema — example / default 우선순위', () => {
  it('example이 있으면 algebra.example 반환', () => {
    expect(foldSchema({ type: 'string', example: 'hello' }, labelAlgebra))
      .toBe('example("hello")')
  })

  it('default가 있으면 algebra.default_ 반환', () => {
    expect(foldSchema({ type: 'string', default: 'world' }, labelAlgebra))
      .toBe('default("world")')
  })

  it('example이 default보다 우선', () => {
    expect(foldSchema({ type: 'string', example: 'e', default: 'd' }, labelAlgebra))
      .toBe('example("e")')
  })

  it('example 값이 숫자여도 동작', () => {
    expect(foldSchema({ type: 'integer', example: 42 }, labelAlgebra))
      .toBe('example(42)')
  })

  it('example이 null이면 우선 (null !== undefined)', () => {
    // null은 undefined가 아니므로 example() 호출됨
    expect(foldSchema({ type: 'string', example: null }, labelAlgebra))
      .toBe('example(null)')
  })
})

describe('foldSchema — fallback', () => {
  it('null 입력', () => expect(foldSchema(null, labelAlgebra)).toBe('fallback'))
  it('비객체 입력 (string)', () => expect(foldSchema('string', labelAlgebra)).toBe('fallback'))
  it('배열 입력', () => expect(foldSchema([], labelAlgebra)).toBe('fallback'))
  it('알 수 없는 type', () => expect(foldSchema({ type: 'unknown-type' }, labelAlgebra)).toBe('fallback'))
  it('type 없는 객체', () => expect(foldSchema({}, labelAlgebra)).toBe('fallback'))
})

describe('foldSchema — type 배열 (OAS 3.1+)', () => {
  it('type 배열의 첫 번째 타입 사용', () => {
    expect(foldSchema({ type: ['string', 'null'] }, labelAlgebra)).toBe('string')
  })

  it('["null", "string"] → null', () => {
    expect(foldSchema({ type: ['null', 'string'] }, labelAlgebra)).toBe('null')
  })
})

describe('foldSchema — 커스텀 algebra로 값 생성', () => {
  // 최솟값 생성 algebra: 각 타입의 최솟값 반환
  const minValueAlgebra: SchemaAlgebra<unknown> = {
    string: () => '',
    integer: (s) => (s.minimum as number | undefined) ?? 0,
    number: (s) => (s.minimum as number | undefined) ?? 0,
    boolean: () => false,
    null: () => null,
    object: (_, props) => props,
    array: (_, items) => (items !== null ? [items] : []),
    allOf: (_, branches) => branches[0] ?? null,
    oneOf: (_, branches) => branches[0] ?? null,
    anyOf: (_, branches) => branches[0] ?? null,
    ref: () => null,
    example: (v) => v,
    default_: (v) => v,
    fallback: () => null,
  }

  it('integer with minimum', () => {
    expect(foldSchema({ type: 'integer', minimum: 5 }, minValueAlgebra)).toBe(5)
  })

  it('object → 중첩 prop 생성', () => {
    expect(foldSchema(
      { type: 'object', properties: { ok: { type: 'boolean' } } },
      minValueAlgebra,
    )).toEqual({ ok: false })
  })

  it('example 우선', () => {
    expect(foldSchema({ type: 'string', example: 'alice' }, minValueAlgebra)).toBe('alice')
  })
})

describe('generateAlgebra — array reference independence', () => {
  it('minItems object array — 각 아이템이 독립적인 참조', () => {
    const schema = {
      type: 'array',
      minItems: 2,
      items: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
    }
    const result = foldSchema(schema, generateAlgebra) as any[]
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ id: 0 })
    expect(result[0]).not.toBe(result[1])  // different references
  })
})
