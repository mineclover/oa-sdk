import { describe, expect, it } from 'vitest'
import type { OasSchema } from '@oa-sdk/parser'
import { analyzeSchemaGraph } from '../../schema-graph/index.js'
import { lowerToPyIr, schemaToPyType, type PydanticLowerContext } from '../lower.js'
import { preparePydanticDocument } from '../prepare.js'
import { resolvePydanticBuildOptions } from '../options.js'
import { loadPydanticFixture } from './fixtures.js'

function lower(schemas: Record<string, OasSchema>, force = false) {
  const document = {
    openapi: '3.2.0',
    info: { title: 'test', version: '1' },
    paths: {},
    components: { schemas },
  }
  const options = resolvePydanticBuildOptions({ preflight: { force } })
  const prepared = preparePydanticDocument(document, options.preflight)
  return lowerToPyIr(prepared, analyzeSchemaGraph(prepared.schemas), 'models')
}

function decl(ir: ReturnType<typeof lower>, name: string) {
  const value = ir.decls.find(item => item.name === name)
  if (value === undefined) throw new Error(`missing declaration ${name}`)
  return value
}

function context(): PydanticLowerContext {
  return {
    analysis: { edges: {}, recursive: [], order: [], discriminatorFamilies: [] },
    pointerOf: new WeakMap(),
    inlineDecls: [],
    diagnostics: [],
    componentNames: new Set(),
    modelNames: new Set(),
    declaredInline: new WeakMap(),
  }
}

describe('Pydantic S3 lowering', () => {
  it('classifies component declarations as model, enum, or component alias', () => {
    const ir = lower({
      Model: { type: 'object', properties: {} },
      Choice: { type: 'string', enum: ['a', 'b'] },
      Alias: { type: 'string', format: 'email' },
    })
    expect(decl(ir, 'Model').kind).toBe('model')
    expect(decl(ir, 'Choice').kind).toBe('enum')
    expect(decl(ir, 'Alias')).toMatchObject({ kind: 'alias', origin: 'component' })
  })

  it('records format, contentEncoding, and the schema pointer on scalar facts', () => {
    const model = decl(lower({
      Model: {
        type: 'object',
        properties: { token: { type: 'string', contentEncoding: 'base64url' }, at: { type: 'integer', format: 'unixtime' } },
      },
    }), 'Model')
    const types = model.kind === 'model'
      ? Object.fromEntries(model.fields.map(field => [field.wireName, field.type]))
      : null
    expect(types).toEqual({
      token: { kind: 'scalar', base: 'string', contentEncoding: 'base64url', pointer: '/components/schemas/Model/properties/token' },
      at: { kind: 'scalar', base: 'integer', format: 'unixtime', pointer: '/components/schemas/Model/properties/at' },
    })
  })

  it('lowers fields in schema order and records required fields', () => {
    const model = decl(lower({
      Model: {
        type: 'object',
        properties: { first: { type: 'string' }, second: { type: 'integer' } },
        required: ['second'],
      },
    }), 'Model')
    expect(model.kind).toBe('model')
    if (model.kind === 'model') {
      expect(model.fields.map(field => field.wireName)).toEqual(['first', 'second'])
      expect(model.fields[1]?.required).toBe(true)
    }
  })

  it('maps allOf model refs to bases and inline object branches to fields', () => {
    const model = decl(lower({
      Base: { type: 'object', properties: { base: { type: 'string' } } },
      Child: {
        type: 'object',
        allOf: [
          { $ref: '#/components/schemas/Base' },
          { type: 'object', properties: { extra: { type: 'boolean' } }, required: ['extra'] },
        ],
        properties: { own: { type: 'number' } },
      },
    }), 'Child')
    expect(model).toMatchObject({ bases: ['Base'] })
    if (model.kind === 'model') {
      expect(model.fields.map(field => field.wireName)).toEqual(['own', 'extra'])
      expect(model.fields.find(field => field.wireName === 'extra')?.required).toBe(true)
    }
  })

  it('lowers nested allOf refs to model bases', () => {
    const ir = lower({
      Base: { type: 'object', properties: {} },
      Other: { type: 'object', properties: {} },
      Nested: { allOf: [{ $ref: '#/components/schemas/Base' }, { $ref: '#/components/schemas/Other' }] },
    })
    expect(decl(ir, 'Nested')).toMatchObject({ kind: 'model', bases: ['Base', 'Other'] })
  })

  it('flattens non-object allOf to its first branch with a diagnostic', () => {
    const contextValue = context()
    const value = schemaToPyType({
      allOf: [{ type: 'string' }, { type: 'integer' }],
    }, contextValue)
    expect(value).toMatchObject({ kind: 'scalar', base: 'string' })
    expect(contextValue.diagnostics.map(item => item.code)).toContain('pydantic/allof-flattened')
  })

  it('records closed, typed-map, and open object openness', () => {
    const ir = lower({
      Closed: { type: 'object', additionalProperties: false },
      Typed: { type: 'object', additionalProperties: { type: 'string' } },
      Open: { type: 'object' },
    })
    expect(decl(ir, 'Closed')).toMatchObject({ openness: { kind: 'closed' } })
    expect(decl(ir, 'Typed')).toMatchObject({ openness: { kind: 'typed-map' } })
    expect(decl(ir, 'Open')).toMatchObject({ openness: { kind: 'open' } })
  })

  it('records top-level nullability and removes null from field type', () => {
    const model = decl(lower({
      Model: {
        type: 'object',
        properties: { value: { type: ['string', 'null'] } },
      },
    }), 'Model')
    if (model.kind !== 'model') throw new Error('expected model')
    expect(model.fields[0]).toMatchObject({ nullable: true, type: { kind: 'scalar', base: 'string' } })
  })

  it('lowers scalar, boolean, null, Any, const, and inline enum types', () => {
    const ir = lower({
      Model: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          flag: { type: 'boolean' },
          nothing: { type: 'null' },
          unknown: {},
          fixed: { const: 'fixed' },
          enum: { type: 'string', enum: ['one', 'two'] },
        },
      },
    })
    if (decl(ir, 'Model').kind !== 'model') throw new Error('expected model')
    const fields = (decl(ir, 'Model') as Extract<typeof ir.decls[number], { kind: 'model' }>).fields
    expect(fields.map(field => field.type.kind)).toEqual([
      'literal', 'literal', 'builtin', 'builtin', 'scalar', 'builtin',
    ])
  })

  it('lowers arrays, tuples, maps, and inline object declarations', () => {
    const ir = lower({
      Model: {
        type: 'object',
        properties: {
          list: { type: 'array', items: { type: 'string' } },
          tuple: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'integer' }] },
          map: { type: 'object', additionalProperties: { type: 'boolean' } },
          nested: { type: 'object', properties: { id: { type: 'string' } } },
        },
      },
    })
    const model = decl(ir, 'Model')
    if (model.kind !== 'model') throw new Error('expected model')
    expect(model.fields.map(field => field.type.kind)).toEqual(['list', 'dict', 'ref', 'tuple'])
    expect(ir.decls.some(item => item.name === 'Model/nested')).toBe(true)
  })

  it('lowers unions and carries discriminator property names', () => {
    const model = decl(lower({
      Model: {
        type: 'object',
        properties: {
          choice: {
            oneOf: [{ type: 'string' }, { type: 'integer' }],
            discriminator: { propertyName: 'kind' },
          },
        },
      },
    }), 'Model')
    if (model.kind !== 'model') throw new Error('expected model')
    expect(model.fields[0]?.type).toMatchObject({ kind: 'union', discriminator: 'kind' })
  })

  it('wraps scalar and array constraints in constrained facts', () => {
    const model = decl(lower({
      Model: {
        type: 'object',
        properties: {
          text: { type: 'string', minLength: 1, maxLength: 3, pattern: '^x$' },
          values: { type: 'array', minItems: 1, maxItems: 2, uniqueItems: true },
        },
      },
    }), 'Model')
    if (model.kind !== 'model') throw new Error('expected model')
    expect(model.fields[0]?.type).toMatchObject({ kind: 'constrained', constraints: { minLength: 1, maxLength: 3 } })
    expect(model.fields[1]?.type).toMatchObject({ kind: 'constrained', constraints: { uniqueItems: true } })
  })

  it('carries defaults, examples, descriptions, deprecation, extensions, and pointers', () => {
    const model = decl(lower({
      Model: {
        type: 'object',
        description: 'model',
        properties: {
          value: {
            type: 'string', default: 'x', examples: ['x'], description: 'value',
            deprecated: true, 'x-note': 'keep',
          },
        },
      },
    }), 'Model')
    if (model.kind !== 'model') throw new Error('expected model')
    expect(model.fields[0]).toMatchObject({
      schemaDefault: { json: 'x' }, examples: ['x'], description: 'value', deprecated: true,
      extensions: { 'x-note': 'keep' }, pointer: '/components/schemas/Model/properties/value',
    })
  })

  it('strips default and example before folding so their type remains available', () => {
    const model = decl(lower({
      Model: { type: 'object', properties: { value: { type: 'integer', default: 2, example: 3 } } },
    }), 'Model')
    if (model.kind !== 'model') throw new Error('expected model')
    expect(model.fields[0]?.type).toMatchObject({ kind: 'scalar', base: 'integer' })
  })

  it('warns on unsupported keywords and unresolved refs', () => {
    const ir = lower({
      Model: {
        type: 'object',
        properties: { missing: { $ref: '#/components/schemas/Missing' } },
        not: { type: 'string' },
        patternProperties: { '^x': { type: 'string' } },
      },
    }, true)
    expect(ir.diagnostics.map(item => item.code)).toEqual(expect.arrayContaining([
      'pydantic/unsupported-keyword',
      'pydantic/unresolved-ref',
    ]))
  })

  it('marks recursive declarations for rebuild and keeps declaration order stable', () => {
    const ir = lower({
      Node: { type: 'object', properties: { child: { $ref: '#/components/schemas/Node' } } },
      Value: { type: 'string' },
    })
    expect(ir.rebuild).toEqual(['Node'])
    expect(ir.decls.map(item => item.name)).toEqual(['Node', 'Value'])
  })

  it('lowers the chunk-stream discriminator and inheritance facts', () => {
    const ir = lowerToPyIr(
      preparePydanticDocument(loadPydanticFixture('chunk-stream'), resolvePydanticBuildOptions().preflight),
      analyzeSchemaGraph(
        preparePydanticDocument(
          loadPydanticFixture('chunk-stream'), resolvePydanticBuildOptions().preflight,
        ).schemas,
      ),
      'models',
    )
    const next = ir.decls.find(item => item.name === 'NextAvailable')
    const base = ir.decls.find(item => item.name === 'NextPointer')
    expect(next).toMatchObject({ kind: 'model', bases: ['NextPointer'] })
    expect(base).toMatchObject({ kind: 'model', discriminator: { role: 'base' } })
  })
})
