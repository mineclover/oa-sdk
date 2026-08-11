import { describe, expect, it } from 'vitest'
import { foldSchema, type SchemaAlgebra } from '../fold.js'

const legacyAlgebra: SchemaAlgebra<string> = {
  string: () => 'string',
  integer: () => 'integer',
  number: () => 'number',
  boolean: () => 'boolean',
  null: () => 'null',
  object: (_schema, properties) => `{${Object.entries(properties).map(([key, value]) => `${key}:${value}`).join(',')}}`,
  array: (_schema, items) => `${items ?? 'unknown'}[]`,
  allOf: (_schema, branches) => branches.join('&'),
  oneOf: (_schema, branches) => branches.join('|'),
  anyOf: (_schema, branches) => branches.join('|'),
  ref: ref => ref,
  example: value => String(value),
  default_: value => String(value),
  fallback: () => 'unknown',
}

const unionAlgebra: SchemaAlgebra<string> = {
  ...legacyAlgebra,
  typeUnion: (_schema, branches) => `union(${branches.join(',')})`,
}

describe('foldSchema — optional typeUnion hook', () => {
  it('keeps the legacy first-member behavior when the hook is absent', () => {
    expect(foldSchema({ type: ['string', 'null'] }, legacyAlgebra)).toBe('string')
  })

  it('folds every type member when the algebra implements the hook', () => {
    expect(foldSchema({ type: ['string', 'integer', 'null'] }, unionAlgebra))
      .toBe('union(string,integer,null)')
  })

  it('uses the hook recursively inside object properties and array items', () => {
    expect(foldSchema({
      type: 'object',
      properties: {
        value: { type: ['boolean', 'null'] },
        values: { type: 'array', items: { type: ['string', 'number'] } },
      },
    }, unionAlgebra)).toBe('{value:union(boolean,null),values:union(string,number)[]}')
  })
})
