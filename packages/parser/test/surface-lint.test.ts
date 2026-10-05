import { describe, it, expect } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { lintDocument } from '../src/lint.js'

function baseDoc(overrides: Record<string, unknown> = {}) {
  return {
    openapi: '3.2.0',
    info: { title: 'Surface Test API', version: '1.0.0' },
    paths: {},
    ...overrides,
  }
}

describe('surface lint — surface/valid-anchor', () => {
  it('passes on valid anchor metadata', () => {
    const doc = baseDoc({
      components: {
        schemas: {
          User: {
            type: 'object',
            'x-surface-anchor': {
              id: 'anchor-user-1',
              line: 10,
              column: 2,
              raw: 'interface User { id: string }',
              commentType: 'doc',
            },
          },
        },
      },
    })
    const results = lintDocument(doc, { categories: ['surface'] })
    expect(results.filter(r => r.rule === 'surface/valid-anchor')).toHaveLength(0)
  })

  it('fails when x-surface-anchor is not an object', () => {
    const doc = baseDoc({
      components: {
        schemas: {
          User: {
            type: 'object',
            'x-surface-anchor': 'invalid-anchor-string',
          },
        },
      },
    })
    const results = lintDocument(doc, { categories: ['surface'] })
    const errors = results.filter(r => r.rule === 'surface/valid-anchor')
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0].severity).toBe('error')
    expect(errors[0].path).toBe('/components/schemas/User/x-surface-anchor')
  })

  it('fails when id is empty or non-string', () => {
    const doc = baseDoc({
      components: {
        schemas: {
          A: { type: 'string', 'x-surface-anchor': { id: '', line: 1, column: 1 } },
          B: { type: 'string', 'x-surface-anchor': { id: 123, line: 1, column: 1 } },
          C: { type: 'string', 'x-surface-anchor': { line: 1, column: 1 } },
        },
      },
    })
    const results = lintDocument(doc, { categories: ['surface'] })
    const errors = results.filter(r => r.rule === 'surface/valid-anchor')
    expect(errors).toHaveLength(3)
  })

  it('fails when line or column is < 1 or invalid number', () => {
    const doc = baseDoc({
      components: {
        schemas: {
          A: { type: 'string', 'x-surface-anchor': { id: 'a', line: 0, column: 1 } },
          B: { type: 'string', 'x-surface-anchor': { id: 'b', line: -5, column: 1 } },
          C: { type: 'string', 'x-surface-anchor': { id: 'c', line: 1, column: 0 } },
          D: { type: 'string', 'x-surface-anchor': { id: 'd', line: 1, column: -1 } },
          E: { type: 'string', 'x-surface-anchor': { id: 'e', line: 'one', column: 'two' } },
        },
      },
    })
    const results = lintDocument(doc, { categories: ['surface'] })
    const errors = results.filter(r => r.rule === 'surface/valid-anchor')
    expect(errors.length).toBeGreaterThanOrEqual(5)
  })
})

describe('surface lint — surface/valid-param-range', () => {
  it('passes when targetProperty exists in properties and maxFramerateHz > 0', () => {
    const doc = baseDoc({
      components: {
        schemas: {
          ColorParam: {
            type: 'object',
            properties: {
              value: { type: 'string' },
            },
            'x-surface-param-range': {
              targetProperty: 'value',
              supportsLivePatch: true,
              maxFramerateHz: 60,
            },
          },
        },
      },
    })
    const results = lintDocument(doc, { categories: ['surface'] })
    expect(results.filter(r => r.rule === 'surface/valid-param-range')).toHaveLength(0)
  })

  it('fails when x-surface-param-range is not an object', () => {
    const doc = baseDoc({
      components: {
        schemas: {
          A: { type: 'object', 'x-surface-param-range': 'bad' },
        },
      },
    })
    const results = lintDocument(doc, { categories: ['surface'] })
    const errors = results.filter(r => r.rule === 'surface/valid-param-range')
    expect(errors).toHaveLength(1)
  })

  it('fails when targetProperty does not exist in schema properties', () => {
    const doc = baseDoc({
      components: {
        schemas: {
          ColorParam: {
            type: 'object',
            properties: {
              otherField: { type: 'string' },
            },
            'x-surface-param-range': {
              targetProperty: 'value',
            },
          },
          NoProperties: {
            type: 'string',
            'x-surface-param-range': {
              targetProperty: 'value',
            },
          },
        },
      },
    })
    const results = lintDocument(doc, { categories: ['surface'] })
    const errors = results.filter(r => r.rule === 'surface/valid-param-range')
    expect(errors.length).toBe(2)
  })

  it('fails when maxFramerateHz <= 0 or not a number', () => {
    const doc = baseDoc({
      components: {
        schemas: {
          A: {
            type: 'object',
            properties: { v: { type: 'string' } },
            'x-surface-param-range': { targetProperty: 'v', maxFramerateHz: 0 },
          },
          B: {
            type: 'object',
            properties: { v: { type: 'string' } },
            'x-surface-param-range': { targetProperty: 'v', maxFramerateHz: -60 },
          },
          C: {
            type: 'object',
            properties: { v: { type: 'string' } },
            'x-surface-param-range': { targetProperty: 'v', maxFramerateHz: '60' },
          },
        },
      },
    })
    const results = lintDocument(doc, { categories: ['surface'] })
    const errors = results.filter(r => r.rule === 'surface/valid-param-range')
    expect(errors).toHaveLength(3)
  })
})

describe('surface lint — surface/valid-fingerprint', () => {
  it('passes on valid sha256 64-hex lowercase string', () => {
    const doc = baseDoc({
      components: {
        schemas: {
          Block: {
            type: 'object',
            'x-surface-fingerprint': `sha256:${'0123456789abcdef'.repeat(4)}`,
          },
        },
      },
    })
    const results = lintDocument(doc, { categories: ['surface'] })
    expect(results.filter(r => r.rule === 'surface/valid-fingerprint')).toHaveLength(0)
  })

  it('fails on invalid sha256 formats', () => {
    const doc = baseDoc({
      components: {
        schemas: {
          A: { type: 'object', 'x-surface-fingerprint': 'sha256:short' },
          B: { type: 'object', 'x-surface-fingerprint': `sha256:${'ABCDEF0123456789'.repeat(4)}` }, // uppercase
          C: { type: 'object', 'x-surface-fingerprint': `md5:${'a'.repeat(32)}` },
          D: { type: 'object', 'x-surface-fingerprint': 12345 },
          E: { type: 'object', 'x-surface-fingerprint': '' },
        },
      },
    })
    const results = lintDocument(doc, { categories: ['surface'] })
    const errors = results.filter(r => r.rule === 'surface/valid-fingerprint')
    expect(errors).toHaveLength(5)
  })
})

describe('surface lint — surface/valid-quote-style', () => {
  it('passes on valid quote styles', () => {
    const doc = baseDoc({
      components: {
        schemas: {
          A: { type: 'string', 'x-surface-quote-style': 'single' },
          B: { type: 'string', 'x-surface-quote-style': 'double' },
          C: { type: 'string', 'x-surface-quote-style': 'backtick' },
          D: { type: 'string', 'x-surface-quote-style': 'none' },
        },
      },
    })
    const results = lintDocument(doc, { categories: ['surface'] })
    expect(results.filter(r => r.rule === 'surface/valid-quote-style')).toHaveLength(0)
  })

  it('fails on invalid quote style enum values', () => {
    const doc = baseDoc({
      components: {
        schemas: {
          A: { type: 'string', 'x-surface-quote-style': 'triple' },
          B: { type: 'string', 'x-surface-quote-style': 'raw' },
          C: { type: 'string', 'x-surface-quote-style': 123 },
          D: { type: 'string', 'x-surface-quote-style': null },
        },
      },
    })
    const results = lintDocument(doc, { categories: ['surface'] })
    const errors = results.filter(r => r.rule === 'surface/valid-quote-style')
    expect(errors).toHaveLength(4)
  })
})

describe('surface lint — surface/valid-patch-policy', () => {
  it('passes on valid patch policies', () => {
    const doc = baseDoc({
      components: {
        schemas: {
          A: { type: 'object', 'x-surface-patch-policy': { onDrift: 'abort' } },
          B: { type: 'object', 'x-surface-patch-policy': { onDrift: 'rebase', retryLimit: 3 } },
          C: { type: 'object', 'x-surface-patch-policy': { onDrift: 'force', retryLimit: 0 } },
        },
      },
    })
    const results = lintDocument(doc, { categories: ['surface'] })
    expect(results.filter(r => r.rule === 'surface/valid-patch-policy')).toHaveLength(0)
  })

  it('fails when patch policy is not an object', () => {
    const doc = baseDoc({
      components: {
        schemas: {
          A: { type: 'object', 'x-surface-patch-policy': 'abort' },
        },
      },
    })
    const results = lintDocument(doc, { categories: ['surface'] })
    const errors = results.filter(r => r.rule === 'surface/valid-patch-policy')
    expect(errors).toHaveLength(1)
  })

  it('fails on invalid onDrift values', () => {
    const doc = baseDoc({
      components: {
        schemas: {
          A: { type: 'object', 'x-surface-patch-policy': { onDrift: 'ignore' } },
          B: { type: 'object', 'x-surface-patch-policy': { onDrift: 'retry' } },
          C: { type: 'object', 'x-surface-patch-policy': {} },
        },
      },
    })
    const results = lintDocument(doc, { categories: ['surface'] })
    const errors = results.filter(r => r.rule === 'surface/valid-patch-policy')
    expect(errors).toHaveLength(3)
  })

  it('fails on invalid retryLimit < 0 or not a number', () => {
    const doc = baseDoc({
      components: {
        schemas: {
          A: { type: 'object', 'x-surface-patch-policy': { onDrift: 'rebase', retryLimit: -1 } },
          B: { type: 'object', 'x-surface-patch-policy': { onDrift: 'rebase', retryLimit: '3' } },
        },
      },
    })
    const results = lintDocument(doc, { categories: ['surface'] })
    const errors = results.filter(r => r.rule === 'surface/valid-patch-policy')
    expect(errors).toHaveLength(2)
  })
})

describe('surface lint — nested schemas and categories integration', () => {
  it('validates surface extensions in nested properties and path operations', () => {
    const doc = baseDoc({
      paths: {
        '/items': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      title: {
                        type: 'string',
                        'x-surface-anchor': { id: 'prop-title', line: 15, column: 4 },
                        'x-surface-quote-style': 'single',
                      },
                    },
                    'x-surface-fingerprint': `sha256:${'b'.repeat(64)}`,
                    'x-surface-patch-policy': { onDrift: 'abort' },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'OK',
              },
            },
          },
        },
      },
    })
    const results = lintDocument(doc)
    expect(results.filter(r => r.rule.startsWith('surface/'))).toHaveLength(0)
  })

  it('respects categories filtering', () => {
    const doc = baseDoc({
      components: {
        schemas: {
          Bad: {
            type: 'object',
            'x-surface-fingerprint': 'invalid-hash',
          },
        },
      },
    })

    // surface included by default
    const allResults = lintDocument(doc)
    expect(allResults.some(r => r.rule === 'surface/valid-fingerprint')).toBe(true)

    // surface excluded when specifying only structure
    const structureResults = lintDocument(doc, { categories: ['structure'] })
    expect(structureResults.some(r => r.rule === 'surface/valid-fingerprint')).toBe(false)
  })

  it('respects rules configuration overrides', () => {
    const doc = baseDoc({
      components: {
        schemas: {
          Bad: {
            type: 'object',
            'x-surface-fingerprint': 'invalid-hash',
            'x-surface-quote-style': 'invalid-quote',
          },
        },
      },
    })

    const results = lintDocument(doc, {
      categories: ['surface'],
      rules: {
        'surface/valid-fingerprint': 'off',
        'surface/valid-quote-style': 'warn',
      },
    })

    expect(results.some(r => r.rule === 'surface/valid-fingerprint')).toBe(false)
    const quoteResult = results.find(r => r.rule === 'surface/valid-quote-style')
    expect(quoteResult).toBeDefined()
    expect(quoteResult?.severity).toBe('warning')
  })
})

// Lint input is the source document. YAML aliases parse to shared objects
// (a recursive alias to a cycle), so the document can be a DAG or cyclic.
describe('surface lint — DAG-shaped input', () => {
  const surfacePaths = (doc: unknown) =>
    lintDocument(doc, { categories: ['surface'] }).map(r => `${r.rule} ${r.path}`)

  it('reports every location of a node shared through YAML aliases', () => {
    const doc = parseYaml(`
openapi: 3.2.0
info: { title: Shared, version: '1' }
paths:
  /a:
    get:
      parameters:
        - &limit
          name: limit
          in: query
          schema: { type: integer }
          x-surface-fingerprint: not-a-hash
      responses: { '200': { description: ok } }
  /b:
    get:
      parameters: [*limit]
      responses: { '200': { description: ok } }
`)

    expect(surfacePaths(doc)).toEqual([
      'surface/valid-fingerprint /paths/~1a/get/parameters/0/x-surface-fingerprint',
      'surface/valid-fingerprint /paths/~1b/get/parameters/0/x-surface-fingerprint',
    ])
    expect(surfacePaths(doc)).toEqual(surfacePaths(JSON.parse(JSON.stringify(doc))))
  })

  it('terminates on recursive YAML aliases and reports each location up to the cycle', () => {
    const doc = parseYaml(`
openapi: 3.2.0
info: { title: Cycle, version: '1' }
paths: {}
components:
  schemas:
    Node: &node
      type: object
      x-surface-quote-style: curly
      properties:
        next: *node
    Alias: *node
`)

    // A location whose node is its own ancestor is cut; every other location is reported.
    expect(surfacePaths(doc)).toEqual([
      'surface/valid-quote-style /components/schemas/Node/x-surface-quote-style',
      'surface/valid-quote-style /components/schemas/Alias/x-surface-quote-style',
    ])
  })
})
