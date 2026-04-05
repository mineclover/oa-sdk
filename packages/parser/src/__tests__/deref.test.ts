import { describe, it, expect } from 'vitest'
import { derefSpec } from '../deref.js'

function spec(overrides?: Record<string, unknown>) {
  return { openapi: '3.2.0', info: { title: 'T', version: '0' }, paths: {}, ...overrides }
}

describe('derefSpec', () => {
  it('basic $ref resolution (#/components/schemas/Foo)', () => {
    const input = spec({
      components: { schemas: { Foo: { type: 'string' } } },
      paths: { '/x': { $ref: '#/components/schemas/Foo' } },
    })

    const result = derefSpec(input) as Record<string, unknown>
    expect((result.paths as Record<string, unknown>)['/x']).toEqual({ type: 'string' })
  })

  it('nested $ref in object properties', () => {
    const input = spec({
      components: {
        schemas: {
          Name: { type: 'string' },
          User: {
            type: 'object',
            properties: {
              name: { $ref: '#/components/schemas/Name' },
            },
          },
        },
      },
    })

    const result = derefSpec(input) as Record<string, unknown>
    const schemas = (result.components as Record<string, unknown>).schemas as Record<string, unknown>
    const user = schemas.User as Record<string, unknown>
    const props = user.properties as Record<string, unknown>
    expect(props.name).toEqual({ type: 'string' })
  })

  it('chain ref (A→B→C)', () => {
    const input = spec({
      components: {
        schemas: {
          A: { $ref: '#/components/schemas/B' },
          B: { $ref: '#/components/schemas/C' },
          C: { type: 'integer' },
        },
      },
    })

    const result = derefSpec(input) as Record<string, unknown>
    const schemas = (result.components as Record<string, unknown>).schemas as Record<string, unknown>
    expect(schemas.A).toEqual({ type: 'integer' })
    expect(schemas.B).toEqual({ type: 'integer' })
  })

  it('circular ref (A→B→A) returns {} at cycle point', () => {
    const input = spec({
      components: {
        schemas: {
          A: { $ref: '#/components/schemas/B' },
          B: { $ref: '#/components/schemas/A' },
        },
      },
    })

    const result = derefSpec(input) as Record<string, unknown>
    const schemas = (result.components as Record<string, unknown>).schemas as Record<string, unknown>
    // A resolves B, B tries to resolve A but hits cycle → {}
    expect(schemas.A).toEqual({})
    expect(schemas.B).toEqual({})
  })

  it('external ref (./file.yaml) is preserved unchanged', () => {
    const input = spec({
      paths: { '/ext': { $ref: './file.yaml#/Foo' } },
    })

    const result = derefSpec(input) as Record<string, unknown>
    expect((result.paths as Record<string, unknown>)['/ext']).toEqual({ $ref: './file.yaml#/Foo' })
  })

  it('non-existent ref preserves original node', () => {
    const input = spec({
      paths: { '/miss': { $ref: '#/components/schemas/Missing' } },
    })

    const result = derefSpec(input) as Record<string, unknown>
    expect((result.paths as Record<string, unknown>)['/miss']).toEqual({
      $ref: '#/components/schemas/Missing',
    })
  })

  it('RFC 6901 escape (~1 → /)', () => {
    const input = spec({
      components: { 'a/b': { value: 42 } },
      paths: { '/esc': { $ref: '#/components/a~1b' } },
    })

    const result = derefSpec(input) as Record<string, unknown>
    expect((result.paths as Record<string, unknown>)['/esc']).toEqual({ value: 42 })
  })
})
