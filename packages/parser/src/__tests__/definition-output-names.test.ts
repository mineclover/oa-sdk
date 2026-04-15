import { describe, expect, it } from 'vitest'
import { createDefinitionNode } from '../definition-node.js'
import { createDefinitionRegistry } from '../definition-registry.js'
import { allocateDefinitionOutputNames } from '../definition-output-names.js'
import { rewriteDefinitionOutputRefs } from '../definition-output-refs.js'

describe('definition output name allocation', () => {
  it('preserves local names when they are unique within one target', () => {
    const note = definitionNode('schema:public/book/Note')
    const author = definitionNode('schema:public/book/Author')

    const allocation = allocateDefinitionOutputNames([note, author])

    expect(allocation.valid).toBe(true)
    expect([...allocation.outputNames.entries()]).toEqual([
      ['schema:public/book/Note', 'Note'],
      ['schema:public/book/Author', 'Author'],
    ])
    expect(allocation.aliases).toEqual([
      {
        id: 'schema:public/book/Note',
        kind: 'schema',
        scope: 'public',
        domain: 'book',
        localName: 'Note',
        outputName: 'Note',
        reason: 'preserve-if-unique',
      },
      {
        id: 'schema:public/book/Author',
        kind: 'schema',
        scope: 'public',
        domain: 'book',
        localName: 'Author',
        outputName: 'Author',
        reason: 'preserve-if-unique',
      },
    ])
    expect(allocation.aliasById.get('schema:public/book/Note')).toEqual({
      id: 'schema:public/book/Note',
      kind: 'schema',
      scope: 'public',
      domain: 'book',
      localName: 'Note',
      outputName: 'Note',
      reason: 'preserve-if-unique',
    })
    expect(allocation.diagnostics).toHaveLength(0)
  })

  it('uses domain prefixes when local names collide across domains in one target', () => {
    const bookNote = definitionNode('schema:public/book/Note')
    const notebookNote = definitionNode('schema:public/notebook/Note')
    const registry = createDefinitionRegistry([
      definitionNode('schema:public/book/Reader', {
        favorite: { $ref: 'oa://schema/public/notebook/Note' },
      }),
      bookNote,
      notebookNote,
    ])

    const allocation = allocateDefinitionOutputNames(registry.nodes)
    const rewritten = rewriteDefinitionOutputRefs(registry, { outputNames: allocation.outputNames })

    expect(allocation.valid).toBe(true)
    expect([...allocation.outputNames.entries()]).toEqual([
      ['schema:public/book/Reader', 'Reader'],
      ['schema:public/book/Note', 'BookNote'],
      ['schema:public/notebook/Note', 'NotebookNote'],
    ])
    expect(allocation.aliases.map(alias => [alias.id, alias.reason])).toEqual([
      ['schema:public/book/Reader', 'preserve-if-unique'],
      ['schema:public/book/Note', 'domain-prefix'],
      ['schema:public/notebook/Note', 'domain-prefix'],
    ])
    expect(rewritten.nodes[0]?.content).toEqual({
      favorite: { $ref: '#/components/schemas/NotebookNote' },
    })
  })

  it('applies explicit aliases before local-name collision fallback', () => {
    const bookNote = definitionNode('schema:public/book/Note')
    const notebookNote = definitionNode('schema:public/notebook/Note')

    const allocation = allocateDefinitionOutputNames([bookNote, notebookNote], {
      aliases: {
        'schema:public/book/Note': 'BookAnnotation',
      },
    })

    expect(allocation.valid).toBe(true)
    expect([...allocation.outputNames.entries()]).toEqual([
      ['schema:public/book/Note', 'BookAnnotation'],
      ['schema:public/notebook/Note', 'Note'],
    ])
    expect(allocation.aliases.map(alias => [alias.id, alias.outputName, alias.reason])).toEqual([
      ['schema:public/book/Note', 'BookAnnotation', 'explicit-alias'],
      ['schema:public/notebook/Note', 'Note', 'preserve-if-unique'],
    ])
  })

  it('keeps allocation target-local for the same canonical id in different targets', () => {
    const sharedError = definitionNode('schema:shared/common/Error')
    const publicTarget = allocateDefinitionOutputNames([
      sharedError,
      definitionNode('schema:public/book/Note'),
      definitionNode('schema:public/notebook/Note'),
    ])
    const adminTarget = allocateDefinitionOutputNames([
      sharedError,
      definitionNode('schema:admin/audit/Entry'),
    ])

    expect(publicTarget.outputNames.get('schema:shared/common/Error')).toBe('Error')
    expect(adminTarget.outputNames.get('schema:shared/common/Error')).toBe('Error')
    expect(publicTarget.outputNames.get('schema:public/book/Note')).toBe('BookNote')
    expect(allocateDefinitionOutputNames([definitionNode('schema:public/book/Note')])
      .outputNames.get('schema:public/book/Note')).toBe('Note')
  })

  it('reports final output name collisions instead of merging canonical ids', () => {
    const allocation = allocateDefinitionOutputNames([
      definitionNode('schema:public/book/Note'),
      definitionNode('schema:public/notebook/Note'),
    ], {
      aliases: {
        'schema:public/book/Note': 'Note',
      },
    })

    expect(allocation.valid).toBe(false)
    expect(allocation.diagnostics).toEqual([
      {
        code: 'definition-output-name/collision',
        severity: 'error',
        kind: 'schema',
        outputName: 'Note',
        ids: [
          'schema:public/book/Note',
          'schema:public/notebook/Note',
        ],
        message: 'Output component name "Note" for schema collides between canonical ids: schema:public/book/Note, schema:public/notebook/Note.',
      },
    ])
  })
})

function definitionNode(id: string, content: unknown = { type: 'object' }) {
  const [, path] = id.split(':')
  if (!path) throw new Error(`Invalid fixture id: ${id}`)
  const [scope, domain, name] = path.split('/')
  return createDefinitionNode({
    id,
    sourcePath: `/workspace/fragments/schema/${scope}/${domain}/${name}.yaml`,
    sourcePointer: '#/content',
    contentHash: `sha256:${id}`,
    content,
  })
}
