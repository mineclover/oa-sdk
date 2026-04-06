import { describe, it, expect } from 'vitest'
import {
  upgrade,
  transformUpgrade,
  escapePointer,
  unescapePointer,
  isSchemaContext,
} from '../upgrade-3.2.js'
import { downgrade } from '../downgrade-3.1.js'

/* ── helpers ────────────────────────────────────────────────── */

describe('escapePointer', () => {
  it('escapes ~ and /', () => {
    expect(escapePointer('a/b')).toBe('a~1b')
    expect(escapePointer('a~b')).toBe('a~0b')
  })
})

describe('unescapePointer', () => {
  it('unescapes ~1 and ~0', () => {
    expect(unescapePointer('a~1b')).toBe('a/b')
    expect(unescapePointer('a~0b')).toBe('a~b')
    expect(unescapePointer('a~0~1b')).toBe('a~/b')
  })
})

describe('isSchemaContext', () => {
  it('returns true for type, properties, allOf, oneOf, anyOf', () => {
    expect(isSchemaContext({ type: 'string' })).toBe(true)
    expect(isSchemaContext({ properties: {} })).toBe(true)
    expect(isSchemaContext({ anyOf: [] })).toBe(true)
  })

  it('returns false for non-schema objects', () => {
    expect(isSchemaContext({ summary: 'test' })).toBe(false)
  })
})

/* ── openapi version ────────────────────────────────────────── */

describe('upgrade — openapi version', () => {
  it('converts openapi 3.1.0 to 3.2.0', () => {
    const result = upgrade({ openapi: '3.1.0' })
    expect(result['openapi']).toBe('3.2.0')
  })

  it('converts any 3.1.x to 3.2.0', () => {
    const result = upgrade({ openapi: '3.1.1' })
    expect(result['openapi']).toBe('3.2.0')
  })

  it('does not touch non-3.1 versions', () => {
    const result = upgrade({ openapi: '3.0.3' })
    expect(result['openapi']).toBe('3.0.3')
  })
})

/* ── value → dataValue ──────────────────────────────────────── */

describe('upgrade — value → dataValue', () => {
  it('converts value to dataValue in example objects', () => {
    const doc = {
      openapi: '3.1.0',
      components: {
        examples: {
          Foo: { summary: 'example', value: 'hello' },
        },
      },
    }
    const result = upgrade(doc)
    const ex = (result['components'] as any)['examples']['Foo']
    expect(ex['dataValue']).toBe('hello')
    expect(ex['value']).toBeUndefined()
  })

  it('does not convert value in schema context', () => {
    const doc = {
      openapi: '3.1.0',
      components: {
        schemas: {
          Status: {
            type: 'string',
            // value here is NOT an example context, it's a regular field
          },
        },
      },
    }
    const result = upgrade(doc)
    // No dataValue should appear since there's no value field
    expect((result as any).components.schemas.Status.dataValue).toBeUndefined()
  })
})

/* ── example → examples (named map) ─────────────────────────── */

describe('upgrade — schema example → examples', () => {
  it('converts singular example to named examples map without sidecar', () => {
    const doc = {
      openapi: '3.1.0',
      components: {
        schemas: {
          User: {
            type: 'object',
            example: { name: 'Alice' },
          },
        },
      },
    }
    const result = upgrade(doc)
    const schema = (result as any).components.schemas.User
    expect(schema['example']).toBeUndefined()
    expect(schema['examples']).toEqual({
      default: { dataValue: { name: 'Alice' } },
    })
  })

  it('restores original examples from sidecar', () => {
    const sidecar = {
      '/components/schemas/User/examples': {
        first: { value: 'Alice' },
        second: { value: 'Bob' },
      },
    }
    const doc = {
      openapi: '3.1.0',
      components: {
        schemas: {
          User: {
            type: 'object',
            example: 'Alice',
          },
        },
      },
    }
    const result = upgrade(doc, sidecar)
    const schema = (result as any).components.schemas.User
    expect(schema['example']).toBeUndefined()
    expect(schema['examples']).toEqual({
      first: { value: 'Alice' },
      second: { value: 'Bob' },
    })
  })
})

/* ── sidecar restoration ────────────────────────────────────── */

describe('upgrade — sidecar restoration', () => {
  it('restores direct child fields from sidecar at correct pointers', () => {
    const sidecar = {
      '/serializedValue': 'some-serialized',
      '/components/schemas/Foo/itemSchema': { type: 'integer' },
    }
    const doc = {
      openapi: '3.1.0',
      components: {
        schemas: {
          Foo: { type: 'object' },
        },
      },
    }
    const result = upgrade(doc, sidecar)
    expect(result['serializedValue']).toBe('some-serialized')
    expect((result as any).components.schemas.Foo.itemSchema).toEqual({ type: 'integer' })
  })

  it('does not overwrite existing fields with sidecar data', () => {
    const sidecar = {
      '/info': 'sidecar-info',
    }
    const doc = {
      openapi: '3.1.0',
      info: { title: 'Original' },
    }
    const result = upgrade(doc, sidecar)
    expect(result['info']).toEqual({ title: 'Original' })
  })

  it('works with empty sidecar', () => {
    const doc = { openapi: '3.1.0', info: { title: 'Test' } }
    const result = upgrade(doc, {})
    expect(result['openapi']).toBe('3.2.0')
    expect(result['info']).toEqual({ title: 'Test' })
  })
})

/* ── examples map recursion ─────────────────────────────────── */

describe('upgrade — examples map recursion', () => {
  it('recurses into examples map entries in example context', () => {
    const doc = {
      openapi: '3.1.0',
      paths: {
        '/users': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    examples: {
                      alice: { summary: 'Alice', value: { name: 'Alice' } },
                      bob: { summary: 'Bob', value: { name: 'Bob' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }
    const result = upgrade(doc)
    const examples = (result as any).paths['/users'].get.responses['200'].content['application/json'].examples
    expect(examples.alice.dataValue).toEqual({ name: 'Alice' })
    expect(examples.alice.value).toBeUndefined()
    expect(examples.bob.dataValue).toEqual({ name: 'Bob' })
  })
})

/* ── primitives + edge cases ────────────────────────────────── */

describe('upgrade — edge cases', () => {
  it('preserves null and primitive values', () => {
    const sidecar: Record<string, unknown> = {}
    expect(transformUpgrade(null, '', sidecar)).toBeNull()
    expect(transformUpgrade(42, '', sidecar)).toBe(42)
    expect(transformUpgrade('hello', '', sidecar)).toBe('hello')
    expect(transformUpgrade(true, '', sidecar)).toBe(true)
  })

  it('handles arrays recursively', () => {
    const sidecar: Record<string, unknown> = {}
    const arr = [{ value: 1 }, { value: 2 }]
    const result = transformUpgrade(arr, '/items', sidecar, 'example') as Array<Record<string, unknown>>
    expect(result[0]['dataValue']).toBe(1)
    expect(result[1]['dataValue']).toBe(2)
  })
})

/* ── roundtrip: downgrade → upgrade ─────────────────────────── */

describe('roundtrip — downgrade then upgrade', () => {
  it('restores openapi version after roundtrip', () => {
    const original = {
      openapi: '3.2.0',
      info: { title: 'API', version: '1.0' },
    }
    const { transformed, sidecar } = downgrade(original)
    expect(transformed['openapi']).toBe('3.1.0')

    const restored = upgrade(transformed as Record<string, unknown>, sidecar)
    expect(restored['openapi']).toBe('3.2.0')
  })

  it('restores dataValue after downgrade → upgrade', () => {
    const original = {
      openapi: '3.2.0',
      components: {
        examples: {
          Test: { summary: 'test', dataValue: 'hello' },
        },
      },
    }
    const { transformed, sidecar } = downgrade(original)
    // After downgrade, dataValue should become value
    expect((transformed as any).components.examples.Test.value).toBe('hello')

    const restored = upgrade(transformed as Record<string, unknown>, sidecar)
    // After upgrade, value should become dataValue
    expect((restored as any).components.examples.Test.dataValue).toBe('hello')
  })

  it('restores schema examples after roundtrip with sidecar', () => {
    const original = {
      openapi: '3.2.0',
      components: {
        schemas: {
          Status: {
            type: 'string',
            examples: {
              ok: { value: 'healthy' },
              err: { value: 'down' },
            },
          },
        },
      },
    }
    const { transformed, sidecar } = downgrade(original)
    // After downgrade: examples map gone, singular example set
    const schema31 = (transformed as any).components.schemas.Status
    expect(schema31['example']).toBe('healthy')
    expect(schema31['examples']).toBeUndefined()

    // After upgrade with sidecar: original examples restored
    const restored = upgrade(transformed as Record<string, unknown>, sidecar)
    const schema32 = (restored as any).components.schemas.Status
    expect(schema32['examples']).toEqual({
      ok: { value: 'healthy' },
      err: { value: 'down' },
    })
    expect(schema32['example']).toBeUndefined()
  })

  it('restores preserved fields (sidecar) after roundtrip', () => {
    const original = {
      openapi: '3.2.0',
      info: { title: 'API', version: '1.0' },
      serializedValue: 'abc123',
      components: {
        schemas: {
          Enc: {
            type: 'object',
            itemSchema: { type: 'integer' },
          },
        },
      },
    }
    const { transformed, sidecar } = downgrade(original)
    // serializedValue and itemSchema should be in sidecar
    expect(transformed['serializedValue']).toBeUndefined()
    expect((transformed as any).components.schemas.Enc.itemSchema).toBeUndefined()

    const restored = upgrade(transformed as Record<string, unknown>, sidecar)
    expect(restored['serializedValue']).toBe('abc123')
    expect((restored as any).components.schemas.Enc.itemSchema).toEqual({ type: 'integer' })
  })

  it('handles complex nested document roundtrip', () => {
    const original = {
      openapi: '3.2.0',
      info: { title: 'Complex API', version: '2.0' },
      paths: {
        '/users': {
          get: {
            summary: 'List users',
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: { type: 'array' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        examples: {
          UserExample: { summary: 'User', dataValue: { id: 1 } },
        },
      },
    }

    const { transformed, sidecar } = downgrade(original)
    const restored = upgrade(transformed as Record<string, unknown>, sidecar)

    expect(restored['openapi']).toBe('3.2.0')
    expect((restored as any).paths['/users'].get.summary).toBe('List users')
    expect((restored as any).components.examples.UserExample.dataValue).toEqual({ id: 1 })
  })
})
