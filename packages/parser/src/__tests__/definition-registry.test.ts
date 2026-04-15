import { describe, expect, it } from 'vitest'
import { createDefinitionNode } from '../definition-node.js'
import { collectDefinitionRefs, createDefinitionRegistry } from '../definition-registry.js'

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
