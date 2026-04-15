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

    const refs = collectDefinitionRefs(node)
    const registry = createDefinitionRegistry([node])

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
    expect(registry.nodes[0]?.refs).toEqual(refs)
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
