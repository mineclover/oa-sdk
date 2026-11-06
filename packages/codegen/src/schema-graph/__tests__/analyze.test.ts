import { describe, expect, it } from 'vitest'
import { analyzeSchemaGraph } from '../index.js'
import type { OasSchema } from '@oa-sdk/parser'

function analysis(schemas: Record<string, OasSchema>) {
  return analyzeSchemaGraph(schemas)
}

describe('analyzeSchemaGraph', () => {
  it('collects sorted component edges and ignores external references', () => {
    const result = analysis({
      Root: {
        type: 'object',
        properties: {
          z: { $ref: '#/components/schemas/Zed' },
          a: { $ref: '#/components/schemas/Alpha' },
          external: { $ref: '#/components/parameters/External' },
        },
      },
      Alpha: { type: 'string' },
      Zed: { type: 'number' },
    })
    expect(result.edges.Root).toEqual(['Alpha', 'Zed'])
  })

  it('finds mutual and self reference cycles', () => {
    const result = analysis({
      Self: { type: 'object', properties: { next: { $ref: '#/components/schemas/Self' } } },
      Left: { $ref: '#/components/schemas/Right' },
      Right: { $ref: '#/components/schemas/Left' },
    })
    expect(result.recursive).toEqual(['Left', 'Right', 'Self'])
  })

  it('orders dependencies before users independently of input order', () => {
    const first = analysis({ User: { $ref: '#/components/schemas/Base' }, Base: { type: 'object' } })
    const second = analysis({ Base: { type: 'object' }, User: { $ref: '#/components/schemas/Base' } })
    expect(first).toEqual(second)
    expect(first.order).toEqual(['Base', 'User'])
  })

  it('collects mapped and inferred discriminator variants', () => {
    const result = analysis({
      Event: {
        type: 'object',
        discriminator: {
          propertyName: 'kind',
          mapping: { mapped: '#/components/schemas/Mapped' },
        },
      },
      Mapped: {
        type: 'object',
        allOf: [{ $ref: '#/components/schemas/Event' }],
        properties: { kind: { type: 'string', enum: ['mapped'] } },
      },
      Inferred: {
        type: 'object',
        allOf: [{ $ref: '#/components/schemas/Event' }],
        properties: { kind: { type: 'string', const: 'inferred' } },
      },
    })
    expect(result.discriminatorFamilies).toEqual([{
      base: 'Event',
      propertyName: 'kind',
      variants: [
        { tag: 'inferred', schema: 'Inferred' },
        { tag: 'mapped', schema: 'Mapped' },
      ],
    }])
  })
})
