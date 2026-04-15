import { describe, expect, it } from 'vitest'
import { createDefinitionNode } from '../definition-node.js'
import { collectDefinitionRefs, createDefinitionRegistry } from '../definition-registry.js'
import { rewriteDefinitionOutputRefs } from '../definition-output-refs.js'

describe('definition registry graph', () => {
  it('registers unique definition nodes by canonical id', () => {
    const bookNote = createDefinitionNode({
      id: 'schema:public/book/Note',
      sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:book-note',
      content: { type: 'object' },
    })
    const notebookNote = createDefinitionNode({
      id: 'schema:public/notebook/Note',
      sourcePath: '/workspace/fragments/schema/public/notebook/Note.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:notebook-note',
      content: { type: 'object' },
    })

    const registry = createDefinitionRegistry([bookNote, notebookNote])

    expect(registry.valid).toBe(true)
    expect(registry.diagnostics).toHaveLength(0)
    expect(registry.nodes.map(node => node.id)).toEqual([
      'schema:public/book/Note',
      'schema:public/notebook/Note',
    ])
    expect(registry.nodeById.get('schema:public/book/Note')).toMatchObject({
      id: 'schema:public/book/Note',
      sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
    })
  })

  it('collects ref edges from fragment content with JSON Pointer-aware paths', () => {
    const node = createDefinitionNode({
      id: 'schema:public/book/Note',
      sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:book-note',
      content: {
        type: 'object',
        properties: {
          'error/detail': { $ref: 'oa://schema/shared/common/Error' },
        },
        allOf: [
          { $ref: 'oa://schema/public/notebook/Note' },
        ],
      },
    })
    const sharedError = createDefinitionNode({
      id: 'schema:shared/common/Error',
      sourcePath: '/workspace/fragments/schema/shared/common/Error.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:shared-error',
      content: { type: 'object' },
    })
    const notebookNote = createDefinitionNode({
      id: 'schema:public/notebook/Note',
      sourcePath: '/workspace/fragments/schema/public/notebook/Note.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:notebook-note',
      content: { type: 'object' },
    })

    const refs = collectDefinitionRefs(node)
    const registry = createDefinitionRegistry([node, sharedError, notebookNote])

    expect(refs).toEqual([
      {
        ref: 'oa://schema/shared/common/Error',
        sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
        sourcePointer: '#/content/properties/error~1detail/$ref',
        targetId: 'schema:shared/common/Error',
      },
      {
        ref: 'oa://schema/public/notebook/Note',
        sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
        sourcePointer: '#/content/allOf/0/$ref',
        targetId: 'schema:public/notebook/Note',
      },
    ])
    expect(registry.refEdges).toEqual([
      {
        sourceId: 'schema:public/book/Note',
        ref: 'oa://schema/shared/common/Error',
        sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
        sourcePointer: '#/content/properties/error~1detail/$ref',
        targetId: 'schema:shared/common/Error',
      },
      {
        sourceId: 'schema:public/book/Note',
        ref: 'oa://schema/public/notebook/Note',
        sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
        sourcePointer: '#/content/allOf/0/$ref',
        targetId: 'schema:public/notebook/Note',
      },
    ])
    expect(registry.diagnostics).toHaveLength(0)
    expect(registry.nodes[0]?.refs).toEqual(refs)
  })

  it('normalizes canonical definition refs and verifies registered targets', () => {
    const note = createDefinitionNode({
      id: 'schema:public/book/Note',
      sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:book-note',
      content: {
        type: 'object',
        properties: {
          error: { $ref: 'oa://schema/shared/common/Error' },
        },
      },
    })
    const error = createDefinitionNode({
      id: 'schema:shared/common/Error',
      sourcePath: '/workspace/fragments/schema/shared/common/Error.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:error',
      content: { type: 'object' },
    })

    const registry = createDefinitionRegistry([note, error])

    expect(registry.valid).toBe(true)
    expect(registry.diagnostics).toHaveLength(0)
    expect(registry.refEdges).toEqual([
      {
        sourceId: 'schema:public/book/Note',
        ref: 'oa://schema/shared/common/Error',
        sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
        sourcePointer: '#/content/properties/error/$ref',
        targetId: 'schema:shared/common/Error',
      },
    ])
  })

  it('normalizes relative file refs to canonical definition ids when the source is registered', () => {
    const note = createDefinitionNode({
      id: 'schema:public/book/Note',
      sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:book-note',
      content: {
        type: 'object',
        properties: {
          author: { $ref: './Author.yaml#/content' },
        },
      },
    })
    const author = createDefinitionNode({
      id: 'schema:public/book/Author',
      sourcePath: '/workspace/fragments/schema/public/book/Author.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:book-author',
      content: { type: 'object' },
    })

    const registry = createDefinitionRegistry([note, author])

    expect(registry.valid).toBe(true)
    expect(registry.diagnostics).toHaveLength(0)
    expect(registry.nodes[0]?.refs).toEqual([
      {
        ref: './Author.yaml#/content',
        sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
        sourcePointer: '#/content/properties/author/$ref',
        targetId: 'schema:public/book/Author',
      },
    ])
    expect(registry.refEdges[0]).toMatchObject({
      sourceId: 'schema:public/book/Note',
      ref: './Author.yaml#/content',
      targetId: 'schema:public/book/Author',
    })
  })

  it('reports missing canonical refs with source coordinates', () => {
    const note = createDefinitionNode({
      id: 'schema:public/book/Note',
      sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:book-note',
      content: {
        type: 'object',
        properties: {
          missing: { $ref: 'oa://schema/public/book/Missing' },
        },
      },
    })

    const registry = createDefinitionRegistry([note], {
      lookupSourceLocation: (sourcePath, pointer) => {
        if (sourcePath.endsWith('Note.yaml') && pointer === '#/content/properties/missing/$ref') {
          return { line: 12, column: 11 }
        }
        return undefined
      },
    })

    expect(registry.valid).toBe(false)
    expect(registry.diagnostics).toEqual([
      {
        code: 'definition-registry/missing-ref',
        severity: 'error',
        id: 'schema:public/book/Missing',
        ref: 'oa://schema/public/book/Missing',
        message: 'Definition ref "oa://schema/public/book/Missing" resolves to missing canonical id "schema:public/book/Missing".',
        sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
        sourcePointer: '#/content/properties/missing/$ref',
        line: 12,
        column: 11,
      },
    ])
  })

  it('reports unsupported source refs without dropping the raw edge', () => {
    const note = createDefinitionNode({
      id: 'schema:public/book/Note',
      sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:book-note',
      content: {
        type: 'object',
        properties: {
          legacy: { $ref: '#/components/schemas/Legacy' },
        },
      },
    })

    const registry = createDefinitionRegistry([note])

    expect(registry.valid).toBe(false)
    expect(registry.refEdges).toEqual([
      {
        sourceId: 'schema:public/book/Note',
        ref: '#/components/schemas/Legacy',
        sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
        sourcePointer: '#/content/properties/legacy/$ref',
      },
    ])
    expect(registry.diagnostics).toEqual([
      {
        code: 'definition-registry/unsupported-ref',
        severity: 'error',
        ref: '#/components/schemas/Legacy',
        message: 'Unsupported definition ref "#/components/schemas/Legacy". Use oa://kind/scope/domain/name or a relative file ref to a registered definition.',
        sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
        sourcePointer: '#/content/properties/legacy/$ref',
      },
    ])
  })

  it('resolves nested refs across registered fragments', () => {
    const note = createDefinitionNode({
      id: 'schema:public/book/Note',
      sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:book-note',
      content: {
        allOf: [
          { $ref: 'oa://schema/public/book/Metadata' },
        ],
      },
    })
    const metadata = createDefinitionNode({
      id: 'schema:public/book/Metadata',
      sourcePath: '/workspace/fragments/schema/public/book/Metadata.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:book-metadata',
      content: {
        type: 'object',
        properties: {
          audit: {
            allOf: [
              { $ref: './Audit.yaml#/content' },
            ],
          },
        },
      },
    })
    const audit = createDefinitionNode({
      id: 'schema:public/book/Audit',
      sourcePath: '/workspace/fragments/schema/public/book/Audit.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:book-audit',
      content: { type: 'object' },
    })

    const registry = createDefinitionRegistry([note, metadata, audit])

    expect(registry.valid).toBe(true)
    expect(registry.refEdges).toEqual([
      {
        sourceId: 'schema:public/book/Note',
        ref: 'oa://schema/public/book/Metadata',
        sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
        sourcePointer: '#/content/allOf/0/$ref',
        targetId: 'schema:public/book/Metadata',
      },
      {
        sourceId: 'schema:public/book/Metadata',
        ref: './Audit.yaml#/content',
        sourcePath: '/workspace/fragments/schema/public/book/Metadata.yaml',
        sourcePointer: '#/content/properties/audit/allOf/0/$ref',
        targetId: 'schema:public/book/Audit',
      },
    ])
  })

  it('rejects duplicate canonical ids with source coordinates when available', () => {
    const first = createDefinitionNode({
      id: 'schema:public/book/Note',
      sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:book-note',
      content: { type: 'object' },
    })
    const duplicate = createDefinitionNode({
      id: 'schema:public/book/Note',
      sourcePath: '/workspace/fragments/schema/public/book/DuplicateNote.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:duplicate-book-note',
      content: { type: 'object' },
    })

    const registry = createDefinitionRegistry([first, duplicate], {
      lookupSourceLocation: (sourcePath, pointer) => {
        if (sourcePath.endsWith('DuplicateNote.yaml') && pointer === '#/content') {
          return { line: 20, column: 5 }
        }
        if (sourcePath.endsWith('Note.yaml') && pointer === '#/content') {
          return { line: 4, column: 3 }
        }
        return undefined
      },
    })

    expect(registry.valid).toBe(false)
    expect(registry.nodes).toHaveLength(1)
    expect(registry.nodeById.get('schema:public/book/Note')?.sourcePath).toBe(
      '/workspace/fragments/schema/public/book/Note.yaml',
    )
    expect(registry.diagnostics).toEqual([
      {
        code: 'definition-registry/duplicate-id',
        severity: 'error',
        id: 'schema:public/book/Note',
        message: 'Duplicate definition id "schema:public/book/Note" already registered from /workspace/fragments/schema/public/book/Note.yaml#/content.',
        sourcePath: '/workspace/fragments/schema/public/book/DuplicateNote.yaml',
        sourcePointer: '#/content',
        line: 20,
        column: 5,
        firstSourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
        firstSourcePointer: '#/content',
        firstLine: 4,
        firstColumn: 3,
      },
    ])
  })
})

describe('definition output ref rewrite', () => {
  it('rewrites nested canonical and relative source refs to OpenAPI component refs', () => {
    const note = createDefinitionNode({
      id: 'schema:public/book/Note',
      sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:book-note',
      content: {
        type: 'object',
        properties: {
          author: { $ref: './Author.yaml#/content' },
          metadata: {
            allOf: [
              { $ref: 'oa://schema/public/book/Metadata' },
            ],
          },
        },
      },
    })
    const author = createDefinitionNode({
      id: 'schema:public/book/Author',
      sourcePath: '/workspace/fragments/schema/public/book/Author.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:book-author',
      content: { type: 'object' },
    })
    const metadata = createDefinitionNode({
      id: 'schema:public/book/Metadata',
      sourcePath: '/workspace/fragments/schema/public/book/Metadata.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:book-metadata',
      content: { type: 'object' },
    })

    const registry = createDefinitionRegistry([note, author, metadata])
    const rewritten = rewriteDefinitionOutputRefs(registry)

    expect(rewritten.valid).toBe(true)
    expect(rewritten.nodes[0]?.content).toEqual({
      type: 'object',
      properties: {
        author: { $ref: '#/components/schemas/Author' },
        metadata: {
          allOf: [
            { $ref: '#/components/schemas/Metadata' },
          ],
        },
      },
    })
    expect(rewritten.nodes[0]?.refs).toEqual([
      {
        ref: '#/components/schemas/Author',
        sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
        sourcePointer: '#/content/properties/author/$ref',
        targetId: 'schema:public/book/Author',
      },
      {
        ref: '#/components/schemas/Metadata',
        sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
        sourcePointer: '#/content/properties/metadata/allOf/0/$ref',
        targetId: 'schema:public/book/Metadata',
      },
    ])
    expect(JSON.stringify(rewritten.nodes.map(node => node.content))).not.toContain('oa://')
  })

  it('rewrites every component-like definition kind to its OpenAPI component location', () => {
    const source = createDefinitionNode({
      id: 'schema:public/book/Source',
      sourcePath: '/workspace/fragments/schema/public/book/Source.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:source',
      content: {
        refs: [
          { $ref: 'oa://schema/public/book/Book' },
          { $ref: 'oa://response/public/book/BookResponse' },
          { $ref: 'oa://parameter/public/book/BookIdParameter' },
          { $ref: 'oa://requestBody/public/book/CreateBookBody' },
          { $ref: 'oa://header/public/book/RateLimitHeader' },
          { $ref: 'oa://link/public/book/BookLink' },
          { $ref: 'oa://callback/public/book/BookCallback' },
          { $ref: 'oa://securityScheme/public/book/ApiKeyAuth' },
        ],
      },
    })
    const targets = [
      createDefinitionNode({
        id: 'schema:public/book/Book',
        sourcePath: '/workspace/fragments/schema/public/book/Book.yaml',
        sourcePointer: '#/content',
        contentHash: 'sha256:book',
        content: { type: 'object' },
      }),
      createDefinitionNode({
        id: 'response:public/book/BookResponse',
        sourcePath: '/workspace/fragments/response/public/book/BookResponse.yaml',
        sourcePointer: '#/content',
        contentHash: 'sha256:book-response',
        content: { description: 'OK' },
      }),
      createDefinitionNode({
        id: 'parameter:public/book/BookIdParameter',
        sourcePath: '/workspace/fragments/parameter/public/book/BookIdParameter.yaml',
        sourcePointer: '#/content',
        contentHash: 'sha256:book-id-parameter',
        content: { name: 'bookId', in: 'path' },
      }),
      createDefinitionNode({
        id: 'requestBody:public/book/CreateBookBody',
        sourcePath: '/workspace/fragments/request-body/public/book/CreateBookBody.yaml',
        sourcePointer: '#/content',
        contentHash: 'sha256:create-book-body',
        content: { content: {} },
      }),
      createDefinitionNode({
        id: 'header:public/book/RateLimitHeader',
        sourcePath: '/workspace/fragments/header/public/book/RateLimitHeader.yaml',
        sourcePointer: '#/content',
        contentHash: 'sha256:rate-limit-header',
        content: { schema: { type: 'string' } },
      }),
      createDefinitionNode({
        id: 'link:public/book/BookLink',
        sourcePath: '/workspace/fragments/link/public/book/BookLink.yaml',
        sourcePointer: '#/content',
        contentHash: 'sha256:book-link',
        content: { operationId: 'getBook' },
      }),
      createDefinitionNode({
        id: 'callback:public/book/BookCallback',
        sourcePath: '/workspace/fragments/callback/public/book/BookCallback.yaml',
        sourcePointer: '#/content',
        contentHash: 'sha256:book-callback',
        content: {},
      }),
      createDefinitionNode({
        id: 'securityScheme:public/book/ApiKeyAuth',
        sourcePath: '/workspace/fragments/security-scheme/public/book/ApiKeyAuth.yaml',
        sourcePointer: '#/content',
        contentHash: 'sha256:api-key-auth',
        content: { type: 'apiKey', name: 'x-api-key', in: 'header' },
      }),
    ]

    const registry = createDefinitionRegistry([source, ...targets])
    const rewritten = rewriteDefinitionOutputRefs(registry)

    expect(rewritten.nodes[0]?.content).toEqual({
      refs: [
        { $ref: '#/components/schemas/Book' },
        { $ref: '#/components/responses/BookResponse' },
        { $ref: '#/components/parameters/BookIdParameter' },
        { $ref: '#/components/requestBodies/CreateBookBody' },
        { $ref: '#/components/headers/RateLimitHeader' },
        { $ref: '#/components/links/BookLink' },
        { $ref: '#/components/callbacks/BookCallback' },
        { $ref: '#/components/securitySchemes/ApiKeyAuth' },
      ],
    })
    expect(JSON.stringify(rewritten.nodes[0]?.content)).not.toContain('oa://')
    expect(collectOutputRefs(rewritten.nodes[0]?.content).every(ref => ref.startsWith('#/components/'))).toBe(true)
  })

  it('uses target-local output names supplied by the caller', () => {
    const note = createDefinitionNode({
      id: 'schema:public/book/Note',
      sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:book-note',
      content: {
        allOf: [
          { $ref: 'oa://schema/public/notebook/Note' },
        ],
      },
    })
    const notebookNote = createDefinitionNode({
      id: 'schema:public/notebook/Note',
      sourcePath: '/workspace/fragments/schema/public/notebook/Note.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:notebook-note',
      content: { type: 'object' },
    })
    const registry = createDefinitionRegistry([note, notebookNote])

    const rewritten = rewriteDefinitionOutputRefs(registry, {
      outputNames: {
        'schema:public/notebook/Note': 'NotebookNote',
      },
    })

    expect(rewritten.nodes[0]?.content).toEqual({
      allOf: [
        { $ref: '#/components/schemas/NotebookNote' },
      ],
    })
    expect(rewritten.rewrites).toEqual([
      {
        sourceId: 'schema:public/book/Note',
        targetId: 'schema:public/notebook/Note',
        originalRef: 'oa://schema/public/notebook/Note',
        outputRef: '#/components/schemas/NotebookNote',
        sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
        sourcePointer: '#/content/allOf/0/$ref',
        outputName: 'NotebookNote',
        componentPath: '#/components/schemas',
      },
    ])
  })

  it('preserves registry diagnostics for refs that cannot be rewritten', () => {
    const note = createDefinitionNode({
      id: 'schema:public/book/Note',
      sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:book-note',
      content: {
        allOf: [
          { $ref: 'oa://schema/public/book/Missing' },
        ],
      },
    })

    const registry = createDefinitionRegistry([note], {
      lookupSourceLocation: (sourcePath, pointer) => {
        if (sourcePath.endsWith('Note.yaml') && pointer === '#/content/allOf/0/$ref') {
          return { line: 9, column: 15 }
        }
        return undefined
      },
    })
    const rewritten = rewriteDefinitionOutputRefs(registry)

    expect(rewritten.valid).toBe(false)
    expect(rewritten.nodes[0]?.content).toEqual({
      allOf: [
        { $ref: 'oa://schema/public/book/Missing' },
      ],
    })
    expect(rewritten.diagnostics).toEqual([
      {
        code: 'definition-registry/missing-ref',
        severity: 'error',
        id: 'schema:public/book/Missing',
        ref: 'oa://schema/public/book/Missing',
        message: 'Definition ref "oa://schema/public/book/Missing" resolves to missing canonical id "schema:public/book/Missing".',
        sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
        sourcePointer: '#/content/allOf/0/$ref',
        line: 9,
        column: 15,
      },
    ])
  })
})

function collectOutputRefs(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(collectOutputRefs)

  const refs: string[] = []
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === '$ref' && typeof child === 'string') {
      refs.push(child)
    } else {
      refs.push(...collectOutputRefs(child))
    }
  }
  return refs
}
