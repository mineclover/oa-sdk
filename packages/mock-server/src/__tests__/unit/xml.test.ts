import { describe, expect, it } from 'vitest'
import type { OasSchema } from '@oa-sdk/parser'
import { parseXmlBody, serializeXmlBody } from '../../core/xml.js'
import { serializeResponseBody } from '../../core/body-serialization.js'

describe('minimal XML support', () => {
  const petSchema: OasSchema = {
    type: 'object',
    xml: { name: 'pet' },
    required: ['id', 'active', 'name', 'tags'],
    properties: {
      id: { type: 'integer' },
      active: { type: 'boolean' },
      name: { type: 'string', xml: { name: 'petName' } },
      tags: { type: 'array', items: { type: 'string' } },
    },
  }

  it('parses element-only objects, repeated array elements, and primitive text values', () => {
    const parsed = parseXmlBody(
      '<pet><id>42</id><active>true</active><petName>Rex</petName><tags>friendly</tags><tags>small</tags></pet>',
      petSchema,
    )

    expect(parsed).toEqual({
      ok: true,
      value: {
        id: 42,
        active: true,
        name: 'Rex',
        tags: ['friendly', 'small'],
      },
    })
  })

  it('serializes objects with xml.name and repeated property array elements', () => {
    const xml = serializeXmlBody(
      { id: 42, active: true, name: 'Rex & Dot', tags: ['friendly', 'small'] },
      petSchema,
    )

    expect(xml).toBe(
      '<pet><id>42</id><active>true</active><petName>Rex &amp; Dot</petName><tags>friendly</tags><tags>small</tags></pet>',
    )
  })

  it('serializes root arrays as a wrapper with repeated item elements', () => {
    const schema: OasSchema = {
      type: 'array',
      xml: { name: 'pets' },
      items: {
        type: 'object',
        xml: { name: 'pet' },
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
        },
      },
    }

    expect(serializeXmlBody([{ id: 1, name: 'Rex' }, { id: 2, name: 'Dot' }], schema)).toBe(
      '<pets><pet><id>1</id><name>Rex</name></pet><pet><id>2</id><name>Dot</name></pet></pets>',
    )
  })

  it('uses XML serialization for application/xml response bodies', () => {
    expect(serializeResponseBody('application/xml', { ok: true })).toBe('<response><ok>true</ok></response>')
  })

  it('rejects unsupported XML Object features clearly', () => {
    const parsed = parseXmlBody('<pet id="42"/>', petSchema)

    expect(parsed).toMatchObject({
      ok: false,
      expected: expect.stringContaining('element-only'),
    })
  })
})
