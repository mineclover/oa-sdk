import { describe, expect, it } from 'vitest'

import { parseDocument as parseBrowserDocument } from '../parse-browser.js'
import { parseDocument } from '../parse.js'
import { countInstanceDescents } from '../recursion-guard.js'
import { resolveRefGraph } from '../ref-graph.js'
import type { OasDocument } from '../oas32-types.js'

function doc(schemas: Record<string, unknown>): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Recursion guard', version: '1.0.0' },
    paths: {},
    components: { schemas },
  } as OasDocument
}

describe('countInstanceDescents', () => {
  it.each([
    [['properties', 'child'], 1],
    [['items'], 1],
    [['properties', 'list', 'items'], 2],
    [['allOf', '0'], 0],
    [['oneOf', '1', 'items'], 1],
    [['not'], 0],
    [['dependentSchemas', 'flag'], 0],
    [['additionalProperties'], 1],
    [['prefixItems', '0'], 1],
  ] as const)('%j descends %i times', (segments, expected) => {
    expect(countInstanceDescents(segments)).toBe(expected)
  })

  it('reads keys under a name map as property names', () => {
    // A property literally named "items" or "0" is a name, not a keyword or index.
    expect(countInstanceDescents(['properties', 'items'])).toBe(1)
    expect(countInstanceDescents(['properties', '0', 'allOf', '0'])).toBe(1)
    expect(countInstanceDescents(['$defs', 'items', 'allOf', '0'])).toBe(0)
  })

  it('ignores keyword-shaped keys inside data values', () => {
    expect(countInstanceDescents(['examples', '0', 'properties', 'items'])).toBe(0)
    expect(countInstanceDescents(['default', 'items'])).toBe(0)
  })
})

describe('recursion guard agreement between parse and lint', () => {
  const cases = [
    ['tree via properties/items', { Tree: { type: 'object', properties: { children: { type: 'array', items: { $ref: '#/components/schemas/Tree' } } } } }, true],
    ['mutual via properties', {
      A: { type: 'object', properties: { b: { $ref: '#/components/schemas/B' } } },
      B: { type: 'object', properties: { a: { $ref: '#/components/schemas/A' } } },
    }, true],
    ['alias entered from a structural schema', {
      Alias: { $ref: '#/components/schemas/Shape' },
      Shape: { type: 'object', properties: { next: { $ref: '#/components/schemas/Alias' } } },
    }, true],
    ['JSON value via oneOf branches', {
      Json: { oneOf: [{ type: 'string' }, { type: 'array', items: { $ref: '#/components/schemas/Json' } }] },
    }, true],
    ['self through allOf', { Loop: { allOf: [{ $ref: '#/components/schemas/Loop' }] } }, false],
    ['alias pair', { A: { $ref: '#/components/schemas/B' }, B: { $ref: '#/components/schemas/A' } }, false],
    ['conditional loop', { C: { if: { type: 'object' }, then: { $ref: '#/components/schemas/C' } } }, false],
  ] as const

  it.each(cases)('%s', (_name, schemas, valid) => {
    const spec = doc(schemas)
    for (const parse of [parseDocument, parseBrowserDocument]) {
      expect(parse(spec).resolution?.status).toBe(valid ? 'complete' : 'partial')
    }
    const graph = resolveRefGraph(spec)
    expect(graph.diagnostics.some(diagnostic => diagnostic.code === 'ref-cycle')).toBe(!valid)
  })
})
