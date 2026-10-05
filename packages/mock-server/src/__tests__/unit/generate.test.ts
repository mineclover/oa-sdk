/**
 * core/generate.ts — GenerateFolder output contract.
 *
 * The built-in generator must produce exactly what folding the schema with
 * `generateAlgebra` through the parser's `foldSchema` produces, and
 * subclasses that replace the algebra keep receiving every folded property.
 */
import { describe, expect, it } from 'vitest'
import { foldSchema, parseDocument, type OasDocument, type OasMediaType, type OasSchema, type SchemaAlgebra } from '@oa-sdk/parser'
import { GenerateFolder, generateAlgebra, generator } from '../../core/generate.js'
import { createResponseBytesSpec, createStatefulBytesSpec } from '../fixtures/response-bytes.js'
import { createOverrideSpec, createSimpleItemsSpec, createWebhookSpec } from '../fixtures/specs.js'

/** Every request and response media type schema of a parsed spec. */
function mediaTypeSchemas(spec: OasDocument): OasSchema[] {
  const parsed = parseDocument(spec)
  const schemas: OasSchema[] = []
  const collect = (content: Record<string, unknown> | undefined) => {
    for (const mediaType of Object.values(content ?? {})) {
      const { schema, itemSchema } = mediaType as OasMediaType
      if (schema) schemas.push(schema)
      if (itemSchema) schemas.push(itemSchema)
    }
  }
  for (const methods of parsed.routes.values()) {
    for (const entry of methods.values()) {
      collect(entry.requestBody?.content)
      for (const response of Object.values(entry.responses)) collect(response.content)
    }
  }
  return schemas
}

const shared: OasSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 3 }, label: { type: 'string', minLength: 4 } },
}

const SYNTHETIC_SCHEMAS: Record<string, OasSchema> = {
  'optional properties at every depth': {
    type: 'object',
    required: ['a', 'nested'],
    properties: {
      a: { type: 'string' },
      b: { type: 'string', format: 'email' },
      nested: {
        type: 'object',
        required: ['c'],
        properties: {
          c: { type: 'array', minItems: 2, items: shared },
          d: { type: 'object', properties: { e: { type: 'string' } } },
        },
      },
    },
  },
  'node shared by required and optional properties': {
    type: 'object',
    required: ['first'],
    properties: { first: shared, second: shared, third: { type: 'array', items: shared } },
  },
  'required name without a property schema': {
    type: 'object',
    required: ['ghost', 'real'],
    properties: { real: { type: 'boolean' }, extra: { type: 'number' } },
  },
  'properties without a type': {
    required: ['x'],
    properties: { x: { type: 'integer', default: 5 }, y: { type: 'integer' } },
  },
  'type union with object first': {
    type: ['object', 'null'],
    required: ['k'],
    properties: { k: { const: 'fixed' }, l: { type: 'string' } },
  },
  'object branches of combinators': {
    allOf: [
      { type: 'object', required: ['p'], properties: { p: { type: 'string' }, q: { type: 'string' } } },
      { oneOf: [{ type: 'object', properties: { r: { type: 'string' } } }, { type: 'string' }] },
    ],
  },
  'conditional branches': {
    if: { type: 'object' },
    then: { type: 'object', required: ['t'], properties: { t: { type: 'integer' }, u: { type: 'integer' } } },
    else: { type: 'string' },
  },
  'object with example and default': {
    type: 'object',
    required: ['v'],
    properties: { v: { type: 'object', example: { given: true } }, w: { type: 'object', default: {} } },
  },
  'unresolved reference': { $ref: '#/components/schemas/Missing' },
  'property named like an object prototype member': {
    type: 'object',
    required: ['constructor', 'toString'],
    properties: { constructor: { type: 'string', minLength: 1 }, toString: { type: 'integer' }, valueOf: { type: 'boolean' } },
  },
}

describe('GenerateFolder — output equals the generateAlgebra fold', () => {
  const fixtureSchemas = [
    createResponseBytesSpec(),
    createStatefulBytesSpec(),
    createOverrideSpec(),
    createSimpleItemsSpec(),
    createWebhookSpec(),
  ].flatMap(mediaTypeSchemas)

  it('for every media type schema of the fixture specs', () => {
    expect(fixtureSchemas.length).toBeGreaterThan(20)
    for (const schema of fixtureSchemas) {
      expect(generator.fold(schema)).toEqual(foldSchema(schema, generateAlgebra))
    }
  })

  it.each(Object.entries(SYNTHETIC_SCHEMAS))('for %s', (_name, schema) => {
    expect(generator.fold(schema)).toEqual(foldSchema(schema, generateAlgebra))
  })
})

describe('GenerateFolder — optional properties', () => {
  it('does not fold the optional properties the built-in object handler discards', () => {
    const schema = SYNTHETIC_SCHEMAS['optional properties at every depth']!
    const visited: OasSchema[] = []
    class RecordingFolder extends GenerateFolder {
      protected override generateString(node: OasSchema): string {
        visited.push(node)
        return super.generateString(node)
      }
    }

    new RecordingFolder().fold(schema)

    // `a` is the only required string: `b`, `nested.d.e` and the items' `label` are optional.
    expect(visited).toEqual([schema.properties!.a])
  })
})

describe('GenerateFolder — algebra extension contract', () => {
  it('passes every folded property to a subclass object handler', () => {
    class EveryPropertyFolder extends GenerateFolder {
      protected override algebra(): SchemaAlgebra<unknown> {
        return { ...super.algebra(), object: (_schema, properties) => ({ ...properties }) }
      }
    }

    expect(new EveryPropertyFolder().fold(SYNTHETIC_SCHEMAS['optional properties at every depth'])).toEqual({
      a: '',
      b: 'example@example.com',
      nested: { c: [{ id: 3, label: 'xxxx' }, { id: 3, label: 'xxxx' }], d: { e: '' } },
    })
  })

  it('keeps string overrides for required properties', () => {
    class PrefixFolder extends GenerateFolder {
      protected override generateString(schema: OasSchema): string {
        return `PREFIX_${super.generateString(schema)}`
      }
    }

    expect(new PrefixFolder().fold(SYNTHETIC_SCHEMAS['optional properties at every depth'])).toEqual({
      a: 'PREFIX_',
      nested: { c: [{ id: 3 }, { id: 3 }] },
    })
  })
})
