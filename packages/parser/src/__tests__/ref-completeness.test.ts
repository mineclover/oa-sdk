import { describe, expect, it } from 'vitest'

import { parseDocument as parseBrowserDocument } from '../parse-browser.js'
import { parseDocument } from '../parse.js'
import { loadSchema as loadBrowserSchema } from '../schema-loader-browser.js'
import {
  IncompleteParsedDocumentError,
  assertParsedDocumentComplete,
  isParsedDocumentComplete,
} from '../parsed-document.js'
import type { OasDocument } from '../oas32-types.js'

function doc(overrides: Partial<OasDocument> = {}): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Reference completeness', version: '1.0.0' },
    paths: {},
    ...overrides,
  } as OasDocument
}

describe('ParsedDocument $ref completeness', () => {
  it('resolves internal path-item refs with Node/browser semantic parity', () => {
    const spec = doc({
      paths: {
        '/users': { $ref: '#/components/pathItems/Users' },
      },
      components: {
        pathItems: {
          Users: {
            get: {
              operationId: 'listUsers',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      },
    })

    const node = parseDocument(spec)
    const browser = parseBrowserDocument(spec)

    expect(node.resolution).toEqual({ status: 'complete', scope: 'internal', diagnostics: [] })
    expect(browser.resolution).toEqual({ status: 'complete', scope: 'internal', diagnostics: [] })
    expect(browser.operations.map(operation => operation.operationId))
      .toEqual(node.operations.map(operation => operation.operationId))
    expect(browser.routes.has('/users')).toBe(true)
  })

  it.each([
    ['Node', parseDocument],
    ['browser', parseBrowserDocument],
  ] as const)('%s parser reports a missing internal ref as partial', (_runtime, parse) => {
    const parsed = parse(doc({
      paths: { '/missing': { $ref: '#/components/pathItems/Missing' } },
    }))

    expect(parsed.resolution?.status).toBe('partial')
    expect(parsed.resolution?.diagnostics).toContainEqual(expect.objectContaining({
      code: 'ref-not-found',
      ref: '#/components/pathItems/Missing',
    }))
    expect(() => assertParsedDocumentComplete(parsed, 'test generator'))
      .toThrow(IncompleteParsedDocumentError)
  })

  it.each([
    ['Node', parseDocument],
    ['browser', parseBrowserDocument],
  ] as const)('%s parser reports a cycle that never descends into the instance as partial', (_runtime, parse) => {
    const parsed = parse(doc({
      components: {
        schemas: {
          Node: {
            allOf: [{ $ref: '#/components/schemas/Node' }],
          },
          Alias: { $ref: '#/components/schemas/Other' },
          Other: { $ref: '#/components/schemas/Alias' },
        },
      },
    }))

    expect(parsed.resolution?.status).toBe('partial')
    expect(parsed.resolution?.diagnostics).toContainEqual(expect.objectContaining({
      code: 'ref-cycle',
      ref: '#/components/schemas/Node',
    }))
    expect(parsed.resolution?.diagnostics).toContainEqual(expect.objectContaining({
      code: 'ref-cycle',
      ref: '#/components/schemas/Alias',
    }))
  })

  it.each([
    ['Node', parseDocument],
    ['browser', parseBrowserDocument],
  ] as const)('%s parser accepts recursion through instance-descending keywords as complete', (_runtime, parse) => {
    const parsed = parse(doc({
      components: {
        schemas: {
          Tree: {
            type: 'object',
            properties: {
              children: { type: 'array', items: { $ref: '#/components/schemas/Tree' } },
            },
          },
          Json: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { $ref: '#/components/schemas/Json' } },
              { type: 'object', additionalProperties: { $ref: '#/components/schemas/Json' } },
            ],
          },
          Nested: {
            type: 'array',
            items: { $ref: '#/components/schemas/Nested' },
          },
        },
      },
    }))

    expect(parsed.resolution).toEqual({ status: 'complete', scope: 'internal', diagnostics: [] })
    expect(() => assertParsedDocumentComplete(parsed, 'test generator')).not.toThrow()
  })

  it('reports external refs as partial when no loader is available', () => {
    const spec = doc({
      paths: { '/external': { $ref: './paths.yaml#/Users' } },
    })

    const node = parseDocument(spec)
    const browser = parseBrowserDocument(spec)

    expect(node.resolution?.status).toBe('partial')
    expect(node.resolution?.diagnostics).toContainEqual(expect.objectContaining({
      code: 'unsupported-ref',
      ref: './paths.yaml#/Users',
    }))
    expect(browser.resolution?.status).toBe('partial')
    expect(browser.resolution?.diagnostics).toContainEqual(expect.objectContaining({
      code: 'external-ref-unresolved',
      ref: './paths.yaml#/Users',
    }))
    expect(() => loadBrowserSchema(spec)).toThrow(/requires complete \$ref resolution/)
  })

  it('does not claim completeness for custom pass pipelines that started with refs', () => {
    const parsed = parseDocument(doc({
      paths: { '/users': { $ref: '#/components/pathItems/Users' } },
      components: { pathItems: { Users: {} } },
    }), [])

    expect(parsed.resolution?.status).toBe('partial')
    expect(parsed.resolution?.scope).toBe('custom')
  })

  it('rejects legacy ParsedDocument values without completeness metadata', () => {
    const parsed = parseDocument(doc())
    delete parsed.resolution

    expect(isParsedDocumentComplete(parsed)).toBe(false)
    expect(() => assertParsedDocumentComplete(parsed, 'test generator'))
      .toThrow(/no resolution metadata/)
  })

  it.each([
    ['Node', parseDocument],
    ['browser', parseBrowserDocument],
  ] as const)('%s parser accepts mutual recursion (A -> B -> C -> A) and cuts it per cycleStrategy', (_runtime, parse) => {
    const mutualSpec = doc({
      components: {
        schemas: {
          A: {
            type: 'object',
            properties: {
              toB: { $ref: '#/components/schemas/B', title: 'Ref to B' },
            },
          },
          B: {
            type: 'object',
            properties: {
              toC: { $ref: '#/components/schemas/C', title: 'Ref to C' },
            },
          },
          C: {
            type: 'object',
            properties: {
              toA: { $ref: '#/components/schemas/A', title: 'Ref back to A' },
            },
          },
        },
      },
    })

    const parsedDefault = parse(mutualSpec)
    expect(parsedDefault.resolution?.status).toBe('complete')
    expect(parsedDefault.resolution?.diagnostics).toEqual([])
    const schemaADefault = parsedDefault.schemas['A'] as any
    const leafDefault = schemaADefault?.properties?.toB?.properties?.toC?.properties?.toA?.properties?.toB
    expect(leafDefault?.title).toBe('Ref to B')
    expect(leafDefault?.$ref).toBeUndefined()

    const parsedEmpty = parse(mutualSpec, { cycleStrategy: 'empty-schema' })
    expect(parsedEmpty.resolution?.status).toBe('complete')
    const schemaAEmpty = parsedEmpty.schemas['A'] as any
    const leafEmpty = schemaAEmpty?.properties?.toB?.properties?.toC?.properties?.toA?.properties?.toB
    expect(leafEmpty?.title).toBe('Ref to B')
    expect(leafEmpty?.$ref).toBeUndefined()

    const parsed = parse(mutualSpec, { cycleStrategy: 'preserve-ref' })
    // Preserved recursion edges are valid graph edges, not unresolved refs.
    expect(parsed.resolution?.status).toBe('complete')
    expect(parsed.resolution?.diagnostics).toEqual([])
    const schemaA = parsed.schemas['A'] as any
    expect(schemaA?.properties?.toB?.properties?.toC?.properties?.toA?.title).toBe('Ref back to A')
    expect(schemaA?.properties?.toB?.properties?.toC?.properties?.toA?.properties?.toB?.$ref).toBe('#/components/schemas/B')
  })

  it.each([
    ['Node', parseDocument],
    ['browser', parseBrowserDocument],
  ] as const)('%s parser accepts self-recursion, honors cycleStrategy, and preserves siblings', (_runtime, parse) => {
    const selfSpec = doc({
      components: {
        schemas: {
          Node: {
            type: 'object',
            properties: {
              child: {
                $ref: '#/components/schemas/Node',
                title: 'Recursive self reference',
                description: 'Tree child pointer',
              },
            },
          },
        },
      },
    })

    const parsedEmpty = parse(selfSpec, { cycleStrategy: 'empty-schema' })
    expect(parsedEmpty.resolution?.status).toBe('complete')
    const schemaEmpty = parsedEmpty.schemas['Node'] as any
    const leafEmpty = schemaEmpty?.properties?.child?.properties?.child
    expect(leafEmpty?.title).toBe('Recursive self reference')
    expect(leafEmpty?.description).toBe('Tree child pointer')
    expect(leafEmpty?.$ref).toBeUndefined()

    const parsedPreserve = parse(selfSpec, { cycleStrategy: 'preserve-ref' })
    expect(parsedPreserve.resolution?.status).toBe('complete')
    const schemaPreserve = parsedPreserve.schemas['Node'] as any
    const leafPreserve = schemaPreserve?.properties?.child?.properties?.child
    expect(leafPreserve?.title).toBe('Recursive self reference')
    expect(leafPreserve?.description).toBe('Tree child pointer')
    expect(leafPreserve?.$ref).toBe('#/components/schemas/Node')
  })
})


