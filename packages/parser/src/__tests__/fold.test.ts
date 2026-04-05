import { describe, it, expect } from 'vitest'
import { foldSchema } from '../fold.js'
import type { SchemaAlgebra } from '../fold.js'

const labelAlgebra: SchemaAlgebra<string> = {
  string: () => 'string',
  integer: () => 'integer',
  number: () => 'number',
  boolean: () => 'boolean',
  null: () => 'null',
  object: (_schema, properties) => `object{${Object.entries(properties).map(([k, v]) => `${k}:${v}`).join(',')}}`,
  array: (_schema, items) => `array[${items ?? 'empty'}]`,
  allOf: (_schema, branches) => `allOf(${branches.join(',')})`,
  oneOf: (_schema, branches) => `oneOf(${branches.join(',')})`,
  anyOf: (_schema, branches) => `anyOf(${branches.join(',')})`,
  ref: (ref) => `ref(${ref})`,
  example: (value) => `example(${JSON.stringify(value)})`,
  default_: (value) => `default(${JSON.stringify(value)})`,
  fallback: (node) => `fallback(${JSON.stringify(node)})`,
}

describe('foldSchema', () => {
  describe('leaf types', () => {
    it('string', () => {
      expect(foldSchema({ type: 'string' }, labelAlgebra)).toBe('string')
    })

    it('integer', () => {
      expect(foldSchema({ type: 'integer' }, labelAlgebra)).toBe('integer')
    })

    it('number', () => {
      expect(foldSchema({ type: 'number' }, labelAlgebra)).toBe('number')
    })

    it('boolean', () => {
      expect(foldSchema({ type: 'boolean' }, labelAlgebra)).toBe('boolean')
    })

    it('null', () => {
      expect(foldSchema({ type: 'null' }, labelAlgebra)).toBe('null')
    })
  })

  it('object with properties (recursive fold)', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'integer' },
      },
    }
    expect(foldSchema(schema, labelAlgebra)).toBe('object{name:string,age:integer}')
  })

  it('array with items', () => {
    const schema = { type: 'array', items: { type: 'number' } }
    expect(foldSchema(schema, labelAlgebra)).toBe('array[number]')
  })

  describe('composition schemas', () => {
    it('allOf', () => {
      const schema = { allOf: [{ type: 'string' }, { type: 'integer' }] }
      expect(foldSchema(schema, labelAlgebra)).toBe('allOf(string,integer)')
    })

    it('oneOf', () => {
      const schema = { oneOf: [{ type: 'boolean' }, { type: 'null' }] }
      expect(foldSchema(schema, labelAlgebra)).toBe('oneOf(boolean,null)')
    })

    it('anyOf', () => {
      const schema = { anyOf: [{ type: 'string' }, { type: 'number' }] }
      expect(foldSchema(schema, labelAlgebra)).toBe('anyOf(string,number)')
    })
  })

  it('$ref → ref(refString)', () => {
    const schema = { $ref: '#/components/schemas/Foo' }
    expect(foldSchema(schema, labelAlgebra)).toBe('ref(#/components/schemas/Foo)')
  })

  it('example priority over type', () => {
    const schema = { type: 'string', example: 'hello' }
    expect(foldSchema(schema, labelAlgebra)).toBe('example("hello")')
  })

  it('default priority when no example', () => {
    const schema = { type: 'integer', default: 42 }
    expect(foldSchema(schema, labelAlgebra)).toBe('default(42)')
  })

  it('fallback for unknown nodes', () => {
    expect(foldSchema(null, labelAlgebra)).toBe('fallback(null)')
    expect(foldSchema([1, 2], labelAlgebra)).toBe('fallback([1,2])')
    expect(foldSchema({}, labelAlgebra)).toBe('fallback({})')
  })

  it('type array (first type used)', () => {
    const schema = { type: ['string', 'null'] }
    expect(foldSchema(schema, labelAlgebra)).toBe('string')
  })
})
