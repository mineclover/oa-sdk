import { foldSchema, type OasSchema } from '@oa-sdk/parser/browser'
import { describe, expect, it } from 'vitest'
import {
  createTypescriptAlgebra,
  schemaToTs,
  typescriptAlgebra,
} from '../../typegen/schema-to-ts.js'

describe('createTypescriptAlgebra — isolated options', () => {
  it('keeps ref overrides local to each algebra instance', () => {
    const ref = '#/components/schemas/User'
    const domainOverrides = { [ref]: 'DomainUser' }
    const domainAlgebra = createTypescriptAlgebra({ refNameOverrides: domainOverrides })
    const apiAlgebra = createTypescriptAlgebra({ refNameOverrides: { [ref]: 'ApiUser' } })
    domainOverrides[ref] = 'MutatedUser'

    expect(foldSchema({ $ref: ref }, domainAlgebra)).toBe('DomainUser')
    expect(foldSchema({ $ref: ref }, apiAlgebra)).toBe('ApiUser')
    expect(foldSchema({ $ref: ref }, typescriptAlgebra)).toBe('User')
  })

  it('does not leak schemaToTs options into the exported compatibility algebra', () => {
    const ref = '#/components/schemas/User'

    expect(schemaToTs({ $ref: ref }, { refNameOverrides: { [ref]: 'GeneratedUser' } }))
      .toBe('GeneratedUser')
    expect(foldSchema({ $ref: ref }, typescriptAlgebra)).toBe('User')
  })

  it('applies annotation options through recursive properties only on that instance', () => {
    const schema = {
      type: 'object',
      properties: {
        id: { type: 'string', annotations: { note: 'stable identity' } },
      },
    } as OasSchema

    expect(foldSchema(schema, createTypescriptAlgebra({ includeAnnotations: true })))
      .toContain('@note stable identity')
    expect(foldSchema(schema, createTypescriptAlgebra()))
      .not.toContain('@note stable identity')
  })
})

describe('schemaToTs — Stage 1 semantic projection', () => {
  it('projects type arrays recursively and deduplicates equivalent TS members', () => {
    expect(schemaToTs({
      type: 'object',
      required: ['value', 'values'],
      properties: {
        value: { type: ['string', 'null'] },
        values: { type: 'array', items: { type: ['string', 'number'] } },
      },
    })).toBe(`{
  value: string | null
  values: (string | number)[]
}`)

    expect(schemaToTs({ type: ['integer', 'number'] })).toBe('number')
    expect(schemaToTs({ type: ['string', 'null'], enum: ['ready', null, 1] }))
      .toBe("'ready' | null")
    expect(schemaToTs({
      type: 'array',
      prefixItems: [{ type: 'string' }],
      items: { type: ['number', 'null'] },
    })).toBe('[string, ...(number | null)[]]')
  })

  it('parenthesizes allOf branches so nested unions keep their precedence', () => {
    expect(schemaToTs({
      allOf: [
        { oneOf: [{ type: 'string' }, { type: 'number' }] },
        { type: 'string' },
      ],
    })).toBe('(string | number) & (string)')
  })

  it('intersects structural siblings with a composition result', () => {
    expect(schemaToTs({
      type: 'object',
      properties: { kind: { type: 'string' } },
      required: ['kind'],
      oneOf: [
        {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
        },
        {
          type: 'object',
          properties: { value: { type: 'number' } },
          required: ['value'],
        },
      ],
    })).toBe(`({
  kind: string
}) & ({
  value: string
} | {
  value: number
})`)
  })

  it('preserves required-only and items-only composition siblings', () => {
    expect(schemaToTs({
      allOf: [{ $ref: '#/components/schemas/Base' }],
      required: ['id'],
    })).toBe(`({
  id: unknown
}) & (Base)`)

    expect(schemaToTs({
      allOf: [{ type: 'array' }],
      items: { type: 'string' },
    })).toBe('(string[]) & (unknown[])')
  })

  it('widens typed index signatures with fixed property types and undefined', () => {
    expect(schemaToTs({
      type: 'object',
      properties: {
        id: { type: 'string' },
        count: { type: 'number' },
      },
      required: ['id'],
      additionalProperties: { type: 'boolean' },
    })).toBe(`{
  count?: number
  id: string
  [key: string]: boolean | number | string | undefined
}`)
  })
})
