import { describe, it, expect } from 'vitest'
import {
  downgrade,
  transform,
  escapePointer,
  isSchemaContext,
  isPathItem,
  PRESERVE_FIELDS,
  REMOVE_FIELDS,
} from '../downgrade-3.1.js'

/* ── helpers ────────────────────────────────────────────────── */

describe('escapePointer', () => {
  it('escapes ~ and /', () => {
    expect(escapePointer('a/b')).toBe('a~1b')
    expect(escapePointer('a~b')).toBe('a~0b')
    expect(escapePointer('a~/b')).toBe('a~0~1b')
  })

  it('leaves plain strings untouched', () => {
    expect(escapePointer('simple')).toBe('simple')
  })
})

describe('isSchemaContext', () => {
  it('returns true for type, properties, allOf, oneOf, anyOf', () => {
    expect(isSchemaContext({ type: 'object' })).toBe(true)
    expect(isSchemaContext({ properties: {} })).toBe(true)
    expect(isSchemaContext({ allOf: [] })).toBe(true)
    expect(isSchemaContext({ oneOf: [] })).toBe(true)
    expect(isSchemaContext({ anyOf: [] })).toBe(true)
  })

  it('returns false for non-schema objects', () => {
    expect(isSchemaContext({ description: 'hello' })).toBe(false)
  })
})

describe('isPathItem', () => {
  it('detects HTTP method keys', () => {
    expect(isPathItem({ get: {} })).toBe(true)
    expect(isPathItem({ post: {} })).toBe(true)
    expect(isPathItem({ delete: {} })).toBe(true)
  })

  it('detects parameters key', () => {
    expect(isPathItem({ parameters: [] })).toBe(true)
  })

  it('returns false for non-path-item objects', () => {
    expect(isPathItem({ type: 'object' })).toBe(false)
  })
})

/* ── openapi version ────────────────────────────────────────── */

describe('downgrade — openapi version', () => {
  it('converts openapi 3.2.0 to 3.1.0', () => {
    const { transformed } = downgrade({ openapi: '3.2.0' })
    expect(transformed['openapi']).toBe('3.1.0')
  })

  it('leaves non-3.2.0 version untouched', () => {
    const { transformed } = downgrade({ openapi: '3.0.3' })
    expect(transformed['openapi']).toBe('3.0.3')
  })
})

/* ── dataValue → value ──────────────────────────────────────── */

describe('downgrade — dataValue → value', () => {
  it('converts dataValue to value in example objects', () => {
    const doc = {
      openapi: '3.2.0',
      components: {
        examples: {
          Foo: { summary: 'example', dataValue: 'hello' },
        },
      },
    }
    const { transformed } = downgrade(doc)
    const ex = (transformed['components'] as any)['examples']['Foo']
    expect(ex['value']).toBe('hello')
    expect(ex['dataValue']).toBeUndefined()
  })

  it('does not overwrite existing value with dataValue', () => {
    const sidecar: Record<string, unknown> = {}
    const node = { value: 'keep', dataValue: 'ignore' }
    const result = transform(node, '/test', sidecar) as Record<string, unknown>
    expect(result['value']).toBe('keep')
    expect(result['dataValue']).toBeUndefined()
  })
})

/* ── Schema examples (named map) → example (singular) ───────── */

describe('downgrade — schema examples → example', () => {
  it('converts named examples map to singular example', () => {
    const doc = {
      openapi: '3.2.0',
      components: {
        schemas: {
          User: {
            type: 'object',
            examples: {
              first: { value: 'Alice' },
              second: { value: 'Bob' },
            },
          },
        },
      },
    }
    const { transformed, sidecar } = downgrade(doc)
    const schema = (transformed['components'] as any)['schemas']['User']
    // Should have singular example (first value found)
    expect(schema['example']).toBe('Alice')
    // Should NOT have the examples map in the output
    expect(schema['examples']).toBeUndefined()
    // Should preserve original in sidecar
    expect(sidecar).toHaveProperty('/components/schemas/User/examples')
  })

  it('extracts dataValue from named examples when value is absent', () => {
    const doc = {
      openapi: '3.2.0',
      components: {
        schemas: {
          Score: {
            type: 'number',
            examples: {
              default: { dataValue: 42 },
            },
          },
        },
      },
    }
    const { transformed } = downgrade(doc)
    const schema = (transformed['components'] as any)['schemas']['Score']
    expect(schema['example']).toBe(42)
  })

  it('does not convert array examples in schema context', () => {
    const doc = {
      openapi: '3.2.0',
      components: {
        schemas: {
          Tag: {
            type: 'string',
            examples: ['foo', 'bar'],
          },
        },
      },
    }
    const { transformed } = downgrade(doc)
    const schema = (transformed['components'] as any)['schemas']['Tag']
    // Array examples should pass through untouched
    expect(schema['examples']).toEqual(['foo', 'bar'])
  })
})

/* ── 3.2-only fields → sidecar (PRESERVE_FIELDS) ───────────── */

describe('downgrade — sidecar preservation', () => {
  for (const field of PRESERVE_FIELDS) {
    it(`preserves "${field}" in sidecar and removes from output`, () => {
      const doc: Record<string, unknown> = {
        openapi: '3.2.0',
        [field]: { some: 'data' },
      }
      const { transformed, sidecar } = downgrade(doc)
      expect(transformed[field]).toBeUndefined()
      expect(sidecar[`/${field}`]).toEqual({ some: 'data' })
    })
  }
})

/* ── 3.2-only fields → removed entirely (REMOVE_FIELDS) ────── */

describe('downgrade — removed fields', () => {
  for (const field of REMOVE_FIELDS) {
    it(`drops "${field}" from 3.1 output and preserves it in sidecar`, () => {
      const doc: Record<string, unknown> = {
        openapi: '3.2.0',
        [field]: 'something',
      }
      const { transformed, sidecar } = downgrade(doc)
      expect(transformed[field]).toBeUndefined()
      expect(sidecar[`/${field}`]).toBe('something')
    })
  }
})

/* ── Server.name, Tag.parent/kind removal ───────────────────── */

describe('downgrade — context-specific removals', () => {
  it('removes Server.name', () => {
    const sidecar: Record<string, unknown> = {}
    const server = { url: 'https://api.example.com', name: 'production' }
    const result = transform(server, '/servers/0', sidecar, 'servers') as Record<string, unknown>
    expect(result['url']).toBe('https://api.example.com')
    expect(result['name']).toBeUndefined()
    expect(sidecar['/servers/0/name']).toBe('production')
  })

  it('removes Tag.parent and Tag.kind', () => {
    const sidecar: Record<string, unknown> = {}
    const tag = { name: 'Auth', parent: 'Security', kind: 'module' }
    const result = transform(tag, '/tags/0', sidecar, 'tags') as Record<string, unknown>
    expect(result['name']).toBe('Auth')
    expect(result['parent']).toBeUndefined()
    expect(result['kind']).toBeUndefined()
    expect(sidecar['/tags/0/parent']).toBe('Security')
    expect(sidecar['/tags/0/kind']).toBe('module')
  })

  it('removes PathItem.query', () => {
    const sidecar: Record<string, unknown> = {}
    const pathItem = { get: { summary: 'Get users' }, query: { foo: 'bar' } }
    const result = transform(pathItem, '/paths/~1users', sidecar) as Record<string, unknown>
    expect(result['get']).toBeDefined()
    expect(result['query']).toBeUndefined()
    expect(sidecar['/paths/~1users/query']).toEqual({ foo: 'bar' })
  })

  it('removes Components.pathItems and Components.mediaTypes', () => {
    const sidecar: Record<string, unknown> = {}
    const components = {
      schemas: { A: { type: 'string' } },
      pathItems: { x: {} },
      mediaTypes: { y: {} },
    }
    const result = transform(components, '/components', sidecar, 'components') as Record<string, unknown>
    expect(result['schemas']).toBeDefined()
    expect(result['pathItems']).toBeUndefined()
    expect(result['mediaTypes']).toBeUndefined()
    expect(sidecar['/components/pathItems']).toEqual({ x: {} })
    expect(sidecar['/components/mediaTypes']).toEqual({ y: {} })
  })

  it('removes $ref override fields (summary, description)', () => {
    const sidecar: Record<string, unknown> = {}
    const refObj = {
      $ref: '#/components/schemas/Foo',
      summary: 'overridden',
      description: 'overridden desc',
    }
    const result = transform(refObj, '/test', sidecar) as Record<string, unknown>
    expect(result['$ref']).toBe('#/components/schemas/Foo')
    expect(result['summary']).toBeUndefined()
    expect(result['description']).toBeUndefined()
    expect(sidecar['/test/summary']).toBe('overridden')
    expect(sidecar['/test/description']).toBe('overridden desc')
  })
})

/* ── recursion (arrays + nested) ────────────────────────────── */

describe('downgrade — recursion', () => {
  it('handles arrays recursively', () => {
    const doc = {
      openapi: '3.2.0',
      items: [
        { additionalOperations: 'x', keep: 'yes' },
        { $self: 'y', keep: 'also' },
      ],
    }
    const { transformed } = downgrade(doc)
    const items = transformed['items'] as Array<Record<string, unknown>>
    expect(items).toHaveLength(2)
    // REMOVE_FIELDS should be dropped in array items too
    expect(items[0]['additionalOperations']).toBeUndefined()
    expect(items[0]['keep']).toBe('yes')
    expect(items[1]['$self']).toBeUndefined()
    expect(items[1]['keep']).toBe('also')
  })

  it('propagates array parent context for Server.name removal', () => {
    const doc = {
      openapi: '3.2.0',
      servers: [{ url: 'https://a.com', name: 'srv-a' }],
    }
    const { transformed, sidecar } = downgrade(doc)
    const server = (transformed['servers'] as Array<Record<string, unknown>>)[0]!
    expect(server['name']).toBeUndefined()
    expect(server['url']).toBe('https://a.com')
    expect(sidecar['/servers/0/name']).toBe('srv-a')
  })

  it('handles deeply nested structures', () => {
    const doc = {
      openapi: '3.2.0',
      paths: {
        '/users': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      additionalOperations: 'should-be-removed',
                    },
                  },
                },
              },
            },
          },
        },
      },
    }
    const { transformed } = downgrade(doc)
    const schema = (transformed as any).paths['/users'].get.responses['200'].content['application/json'].schema
    expect(schema['type']).toBe('object')
    expect(schema['additionalOperations']).toBeUndefined()
  })

  it('preserves null and primitive values', () => {
    const sidecar: Record<string, unknown> = {}
    expect(transform(null, '', sidecar)).toBeNull()
    expect(transform(42, '', sidecar)).toBe(42)
    expect(transform('hello', '', sidecar)).toBe('hello')
    expect(transform(true, '', sidecar)).toBe(true)
  })
})

/* ── full document round-trip sanity ────────────────────────── */

describe('downgrade — full document', () => {
  it('produces a valid 3.1 document structure', () => {
    const doc = {
      openapi: '3.2.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/health': {
          get: {
            summary: 'Health check',
            responses: {
              '200': { description: 'OK' },
            },
          },
        },
      },
      components: {
        schemas: {
          Status: { type: 'string' },
        },
        examples: {
          StatusExample: { summary: 'ok', dataValue: 'healthy' },
        },
      },
    }

    const { transformed, sidecar } = downgrade(doc)

    expect(transformed['openapi']).toBe('3.1.0')
    expect(transformed['info']).toEqual({ title: 'Test API', version: '1.0.0' })
    expect((transformed as any).paths['/health'].get.summary).toBe('Health check')
    // dataValue → value
    expect((transformed as any).components.examples.StatusExample.value).toBe('healthy')
    expect((transformed as any).components.examples.StatusExample.dataValue).toBeUndefined()
    // sidecar should be empty or minimal for this simple doc
    expect(typeof sidecar).toBe('object')
  })
})
