import { describe, expect, it } from 'vitest'
import type { OasSchema } from '@oa-sdk/parser'

import { serializeValidationSchema } from '../runtime-schema.js'

function decode(serialized: string | undefined): unknown {
  const match = /^JSON\.parse\((.*)\) as __OaRuntimeSchema$/.exec(serialized ?? '')
  if (!match) throw new Error(`unexpected serialization: ${serialized}`)
  return JSON.parse(JSON.parse(match[1]!))
}

describe('serializeValidationSchema', () => {
  it('serializes a subtree shared between use sites in full at every site', () => {
    const address: OasSchema = {
      type: 'object',
      required: ['city'],
      properties: { city: { type: 'string', minLength: 1 } },
    }
    const schema: OasSchema = {
      type: 'object',
      properties: { billing: address, shipping: address },
    }

    expect(decode(serializeValidationSchema(schema))).toEqual({
      type: 'object',
      properties: {
        billing: { type: 'object', required: ['city'], properties: { city: { type: 'string', minLength: 1 } } },
        shipping: { type: 'object', required: ['city'], properties: { city: { type: 'string', minLength: 1 } } },
      },
    })
  })

  it('terminates a true object cycle with an open schema', () => {
    const node: OasSchema = { type: 'object', properties: {} }
    node.properties!.child = node

    expect(decode(serializeValidationSchema(node))).toEqual({
      type: 'object',
      properties: { child: {} },
    })
  })
})
