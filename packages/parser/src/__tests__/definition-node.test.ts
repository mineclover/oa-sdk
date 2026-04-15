import { describe, expect, it } from 'vitest'
import { parseDefinitionId } from '../definition-id.js'
import { createDefinitionNode, createDefinitionRef } from '../definition-node.js'

describe('definition nodes', () => {
  it('constructs a node with identity parts derived from the canonical id', () => {
    const ref = createDefinitionRef({
      ref: 'oa://schema/shared/common/Error',
      sourcePath: 'packages/schemas/src/fragments/schema/public/book/Note.yaml',
      sourcePointer: '#/content/properties/error/$ref',
      targetId: 'schema:shared/common/Error',
      metadata: { usage: 'property' },
    })

    const content = {
      type: 'object',
      properties: {
        error: { $ref: 'oa://schema/shared/common/Error' },
      },
    }

    const node = createDefinitionNode({
      id: 'schema:public/book/Note',
      sourcePath: 'packages/schemas/src/fragments/schema/public/book/Note.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:book-note',
      content,
      metadata: {
        target: 'public-api',
        tags: ['book'],
      },
      refs: [ref],
    })

    expect(node).toEqual({
      id: 'schema:public/book/Note',
      kind: 'schema',
      scope: 'public',
      domain: 'book',
      localName: 'Note',
      sourcePath: 'packages/schemas/src/fragments/schema/public/book/Note.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:book-note',
      content,
      metadata: {
        target: 'public-api',
        tags: ['book'],
      },
      refs: [{
        ref: 'oa://schema/shared/common/Error',
        sourcePath: 'packages/schemas/src/fragments/schema/public/book/Note.yaml',
        sourcePointer: '#/content/properties/error/$ref',
        targetId: 'schema:shared/common/Error',
        metadata: { usage: 'property' },
      }],
    })
  })

  it('preserves source path and pointer metadata for diagnostics', () => {
    const id = parseDefinitionId('response:public/book/ListNotesResponse')
    const refs = [
      createDefinitionRef({
        ref: './schema/public/book/Note.yaml#/content',
        sourcePath: '/workspace/fragments/responses/ListNotesResponse.yaml',
        sourcePointer: '#/content/content/application~1json/schema/items/$ref',
      }),
    ]

    const node = createDefinitionNode({
      id,
      sourcePath: '/workspace/fragments/responses/ListNotesResponse.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:list-notes-response',
      content: {
        description: 'List notes response.',
      },
      refs,
    })

    expect(node.sourcePath).toBe('/workspace/fragments/responses/ListNotesResponse.yaml')
    expect(node.sourcePointer).toBe('#/content')
    expect(node.metadata).toBeUndefined()
    expect(node.refs).not.toBe(refs)
    expect(node.refs[0]!).toMatchObject({
      ref: './schema/public/book/Note.yaml#/content',
      sourcePath: '/workspace/fragments/responses/ListNotesResponse.yaml',
      sourcePointer: '#/content/content/application~1json/schema/items/$ref',
    })
  })
})
