/**
 * core/generate.ts — GenerateFolder output contract.
 *
 * The built-in generator must produce exactly what folding the schema with
 * `generateAlgebra` through the parser's `foldSchema` produces without folding
 * the optional properties it discards, and a folder whose generation was
 * customized (subclass, replaced method, changed `generateAlgebra` handler)
 * must fold exactly like `foldSchema`: every property, in the same order.
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

/** Wraps schema nodes in proxies that record every look at their own keys. */
function schemaReads() {
  const reads: string[] = []
  const watch = (label: string, node: OasSchema): OasSchema => {
    const record = (key: PropertyKey) => reads.push(`${label}.${String(key)}`)
    return new Proxy(node, {
      get: (target, key, receiver) => (record(key), Reflect.get(target, key, receiver)),
      has: (target, key) => (record(key), Reflect.has(target, key)),
      getOwnPropertyDescriptor: (target, key) => (record(key), Reflect.getOwnPropertyDescriptor(target, key)),
      ownKeys: (target) => (record('ownKeys'), Reflect.ownKeys(target)),
    })
  }
  return { reads, watch }
}

/** Optional properties at every depth, each one watched. */
function watchedOptionalsSchema(watch: (label: string, node: OasSchema) => OasSchema): OasSchema {
  const item: OasSchema = {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'integer', minimum: 3 }, label: watch('label', { type: 'string', minLength: 4 }) },
  }
  return {
    type: 'object',
    required: ['a', 'nested'],
    properties: {
      a: { type: 'string' },
      b: watch('b', { type: 'string', format: 'email' }),
      nested: {
        type: 'object',
        required: ['c'],
        properties: {
          c: { type: 'array', minItems: 2, items: item },
          d: watch('d', { type: 'object', properties: { e: { type: 'string' } } }),
        },
      },
    },
  }
}

class TaggedFolder extends GenerateFolder {
  readonly tag = 'generation methods untouched'
}

describe('GenerateFolder — built-in generation skips optional properties', () => {
  it.each([
    ['the shared generator', generator],
    ['a new GenerateFolder', new GenerateFolder()],
    ['a subclass that keeps the generation methods', new TaggedFolder()],
  ])('%s never looks at an optional property', (_name, folder) => {
    const { reads, watch } = schemaReads()
    const schema = watchedOptionalsSchema(watch)

    const value = folder.fold(schema)

    expect(reads).toEqual([])
    expect(value).toEqual({ a: '', nested: { c: [{ id: 3 }, { id: 3 }] } })

    // The watch does see a fold that visits them, and that fold produces the same value.
    expect(foldSchema(schema, generateAlgebra)).toEqual(value)
    expect(watchedLabels(reads)).toEqual(new Set(['b', 'd', 'label']))
  })

  it('so an error a built-in handler would raise inside a dropped property no longer occurs', () => {
    const schema: OasSchema = {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' }, padding: { type: 'string', minLength: Number.MAX_SAFE_INTEGER } },
    }

    expect(() => foldSchema(schema, generateAlgebra)).toThrow(RangeError)
    expect(generator.fold(schema)).toEqual({ id: '' })
  })
})

/** The watched nodes that were looked at. */
function watchedLabels(reads: string[]): Set<string> {
  return new Set(reads.map(read => read.slice(0, read.indexOf('.'))))
}

/** Every SchemaAlgebra handler name: `satisfies` stops compiling when the parser adds one. */
const HANDLER_NAMES = Object.keys({
  string: true, integer: true, number: true, boolean: true, null: true,
  object: true, array: true, allOf: true, oneOf: true, anyOf: true, typeUnion: true,
  const_: true, ref: true, example: true, default_: true, fallback: true,
} satisfies Record<keyof SchemaAlgebra<unknown>, true>)

describe('GenerateFolder — a replaced generateAlgebra handler ends the skip', () => {
  const builtinAlgebra = { ...generateAlgebra }

  /**
   * Puts an equivalent handler under `name` (a pass-through to the built-in one,
   * or, for an optional handler the built-in algebra lacks, one that picks what
   * its absence would), folds the watched schema with a new folder, and undoes it.
   */
  function foldWithEquivalentHandler(name: string) {
    const original: unknown = Reflect.get(generateAlgebra, name)
    const equivalent = typeof original === 'function'
      ? (...args: unknown[]) => original(...args)
      : (_schema: OasSchema, branches: unknown[]) => branches[0]
    Reflect.set(generateAlgebra, name, equivalent)
    try {
      const { reads, watch } = schemaReads()
      return { value: new GenerateFolder().fold(watchedOptionalsSchema(watch)), reads }
    } finally {
      if (original === undefined) Reflect.deleteProperty(generateAlgebra, name)
      else Reflect.set(generateAlgebra, name, original)
    }
  }

  it.each(HANDLER_NAMES.filter(name => name !== 'string'))('%s', (name) => {
    const { value, reads } = foldWithEquivalentHandler(name)

    expect(value).toEqual({ a: '', nested: { c: [{ id: 3 }, { id: 3 }] } })
    expect(watchedLabels(reads)).toEqual(new Set(['b', 'd', 'label']))
    expect({ ...generateAlgebra }).toStrictEqual(builtinAlgebra)
  })

  it('except string, which GenerateFolder always replaces with generateString', () => {
    const { value, reads } = foldWithEquivalentHandler('string')

    expect(value).toEqual({ a: '', nested: { c: [{ id: 3 }, { id: 3 }] } })
    expect(reads).toEqual([])
    expect({ ...generateAlgebra }).toStrictEqual(builtinAlgebra)
  })
})

/**
 * Each customization below numbers the results of one handler, so a required
 * value shows how many calls came before it, optional properties included.
 */
const NUMBERED: OasSchema = {
  type: 'object',
  required: ['name', 'count', 'child'],
  properties: {
    nickname: { type: 'string' },
    age: { type: 'integer' },
    alias: { type: ['string', 'null'] },
    name: { type: 'string' },
    count: { type: 'integer' },
    child: {
      type: 'object',
      required: ['id'],
      properties: { note: { type: 'string' }, id: { type: ['integer', 'null'] } },
    },
  },
}

interface Customized {
  folder: GenerateFolder
  calls: OasSchema[]
  restore(): void
}

/** A handler with observable state: it records each schema and returns its call number. */
function numbering() {
  const calls: OasSchema[] = []
  const handler = (schema: OasSchema) => {
    calls.push(schema)
    return `#${calls.length}`
  }
  return { calls, handler }
}

const NUMBERED_STRINGS = { name: '#3', count: 0, child: { id: 0 } }
const NUMBERED_INTEGERS = { name: '', count: '#2', child: { id: '#3' } }

const CUSTOMIZATIONS: [string, () => Customized, unknown][] = [
  ['a subclass overriding generateString', () => {
    const { calls, handler } = numbering()
    class NumberingFolder extends GenerateFolder {
      protected override generateString(schema: OasSchema): string {
        return handler(schema)
      }
    }
    return { folder: new NumberingFolder(), calls, restore: () => {} }
  }, NUMBERED_STRINGS],
  ['a subclass overriding algebra() but keeping the object handler', () => {
    const { calls, handler } = numbering()
    class NumberingFolder extends GenerateFolder {
      protected override algebra(): SchemaAlgebra<unknown> {
        return { ...super.algebra(), integer: handler }
      }
    }
    return { folder: new NumberingFolder(), calls, restore: () => {} }
  }, NUMBERED_INTEGERS],
  ['an instance whose generateString is replaced', () => {
    const { calls, handler } = numbering()
    const folder = new GenerateFolder()
    Object.defineProperty(folder, 'generateString', { value: handler })
    return { folder, calls, restore: () => {} }
  }, NUMBERED_STRINGS],
  ['GenerateFolder.prototype.generateString replaced', () => {
    const { calls, handler } = numbering()
    const original = Object.getOwnPropertyDescriptor(GenerateFolder.prototype, 'generateString')!
    Object.defineProperty(GenerateFolder.prototype, 'generateString', { ...original, value: handler })
    return {
      folder: new GenerateFolder(),
      calls,
      restore: () => Object.defineProperty(GenerateFolder.prototype, 'generateString', original),
    }
  }, NUMBERED_STRINGS],
  ['a generateAlgebra handler replaced', () => {
    const { calls, handler } = numbering()
    const original = generateAlgebra.integer
    generateAlgebra.integer = handler
    return { folder: new GenerateFolder(), calls, restore: () => { generateAlgebra.integer = original } }
  }, NUMBERED_INTEGERS],
  ['a handler added to generateAlgebra', () => {
    const { calls, handler } = numbering()
    generateAlgebra.typeUnion = (schema) => handler(schema)
    return { folder: new GenerateFolder(), calls, restore: () => { delete generateAlgebra.typeUnion } }
  }, { name: '', count: 0, child: { id: '#2' } }],
]

/** Applies a customization, folds with it, and undoes it. */
function foldCustomized(customize: () => Customized, fold: (folder: GenerateFolder) => unknown) {
  const { folder, calls, restore } = customize()
  try {
    return { value: fold(folder), calls }
  } finally {
    restore()
  }
}

describe('GenerateFolder — customized generation folds like foldSchema', () => {
  it.each(CUSTOMIZATIONS)('%s', (_name, customize, expectedValue) => {
    const folded = foldCustomized(customize, folder => folder.fold(NUMBERED))
    const reference = foldCustomized(customize, folder => foldSchema(NUMBERED, folder['algebra']()))

    expect(folded.value).toEqual(expectedValue)
    expect(folded).toEqual(reference)
    // Every customization was undone: the built-in output is back.
    expect(generator.fold(NUMBERED)).toEqual({ name: '', count: 0, child: { id: 0 } })
  })

  it('lets an overridden handler throw on an optional property, as foldSchema does', () => {
    class NoBinaryFolder extends GenerateFolder {
      protected override generateString(schema: OasSchema): string {
        if (schema.format === 'binary') throw new Error('binary strings are not supported')
        return super.generateString(schema)
      }
    }
    const schema: OasSchema = {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' }, avatar: { type: 'string', format: 'binary' } },
    }

    expect(() => new NoBinaryFolder().fold(schema)).toThrow('binary strings are not supported')
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
