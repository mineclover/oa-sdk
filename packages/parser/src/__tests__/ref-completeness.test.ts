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
  ] as const)('%s parser reports a reference cycle as partial', (_runtime, parse) => {
    const parsed = parse(doc({
      components: {
        schemas: {
          Node: {
            type: 'object',
            properties: {
              child: { $ref: '#/components/schemas/Node' },
            },
          },
        },
      },
    }))

    expect(parsed.resolution?.status).toBe('partial')
    expect(parsed.resolution?.diagnostics).toContainEqual(expect.objectContaining({
      code: 'ref-cycle',
      ref: '#/components/schemas/Node',
    }))
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
})
