import { describe, expect, it } from 'vitest'
import { createDefinitionNode } from '../definition-node.js'
import { createDefinitionRegistry } from '../definition-registry.js'
import { allocateDefinitionOutputNames } from '../definition-output-names.js'
import { rewriteDefinitionOutputRefs } from '../definition-output-refs.js'
import { validateDefinitionIds } from '../definition-id.js'

describe('definition output name allocation', () => {
  it('preserves local names when they are unique within one target', () => {
    const note = definitionNode('schema:public/book/Note')
    const author = definitionNode('schema:public/book/Author')

    const allocation = allocateDefinitionOutputNames([note, author], { targetName: 'public-api' })

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
    expect(allocation.collisionReport).toEqual([
      {
        canonicalId: 'schema:public/book/Note',
        targetName: 'public-api',
        kind: 'schema',
        scope: 'public',
        domain: 'book',
        localName: 'Note',
        outputName: 'Note',
        reason: 'preserve-if-unique',
        severity: 'info',
      },
      {
        canonicalId: 'schema:public/book/Author',
        targetName: 'public-api',
        kind: 'schema',
        scope: 'public',
        domain: 'book',
        localName: 'Author',
        outputName: 'Author',
        reason: 'preserve-if-unique',
        severity: 'info',
      },
    ])
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

    const allocation = allocateDefinitionOutputNames(registry.nodes, { targetName: 'public-api' })
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
    expect(allocation.collisionReport.map(entry => [
      entry.canonicalId,
      entry.targetName,
      entry.outputName,
      entry.reason,
      entry.severity,
    ])).toEqual([
      ['schema:public/book/Reader', 'public-api', 'Reader', 'preserve-if-unique', 'info'],
      ['schema:public/book/Note', 'public-api', 'BookNote', 'domain-prefix', 'warning'],
      ['schema:public/notebook/Note', 'public-api', 'NotebookNote', 'domain-prefix', 'warning'],
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

  it('keeps allocation target-local across server targets', () => {
    const sharedError = definitionNode('schema:shared/common/Error')
    const publicTarget = allocateDefinitionOutputNames([
      sharedError,
      definitionNode('schema:public/book/Note'),
      definitionNode('schema:public/notebook/Note'),
    ], { targetName: 'public-api' })
    const adminTarget = allocateDefinitionOutputNames([
      sharedError,
      definitionNode('schema:admin/book/Note'),
      definitionNode('schema:admin/notebook/Note'),
    ], { targetName: 'admin-api' })
    const publicBookOnly = allocateDefinitionOutputNames([
      definitionNode('schema:public/book/Note'),
    ], { targetName: 'public-api' })
    const adminBookOnly = allocateDefinitionOutputNames([
      definitionNode('schema:admin/book/Note'),
    ], { targetName: 'admin-api' })

    expect(publicTarget.outputNames.get('schema:shared/common/Error')).toBe('Error')
    expect(adminTarget.outputNames.get('schema:shared/common/Error')).toBe('Error')
    expect(publicTarget.outputNames.get('schema:public/book/Note')).toBe('BookNote')
    expect(publicTarget.outputNames.get('schema:public/notebook/Note')).toBe('NotebookNote')
    expect(adminTarget.outputNames.get('schema:admin/book/Note')).toBe('BookNote')
    expect(adminTarget.outputNames.get('schema:admin/notebook/Note')).toBe('NotebookNote')
    expect(adminTarget.collisionReport.map(entry => [
      entry.canonicalId,
      entry.targetName,
      entry.outputName,
      entry.reason,
      entry.severity,
    ])).toEqual([
      ['schema:shared/common/Error', 'admin-api', 'Error', 'preserve-if-unique', 'info'],
      ['schema:admin/book/Note', 'admin-api', 'BookNote', 'domain-prefix', 'warning'],
      ['schema:admin/notebook/Note', 'admin-api', 'NotebookNote', 'domain-prefix', 'warning'],
    ])
    expect(publicBookOnly.outputNames.get('schema:public/book/Note')).toBe('Note')
    expect(adminBookOnly.outputNames.get('schema:admin/book/Note')).toBe('Note')
    expect(publicBookOnly.collisionReport[0]).toMatchObject({
      canonicalId: 'schema:public/book/Note',
      targetName: 'public-api',
      outputName: 'Note',
      severity: 'info',
    })
    expect(adminBookOnly.collisionReport[0]).toMatchObject({
      canonicalId: 'schema:admin/book/Note',
      targetName: 'admin-api',
      outputName: 'Note',
      severity: 'info',
    })
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
    expect(allocation.collisionReport).toEqual([
      {
        canonicalId: 'schema:public/book/Note',
        targetName: 'default',
        kind: 'schema',
        scope: 'public',
        domain: 'book',
        localName: 'Note',
        outputName: 'Note',
        reason: 'output-name-collision',
        severity: 'error',
      },
      {
        canonicalId: 'schema:public/notebook/Note',
        targetName: 'default',
        kind: 'schema',
        scope: 'public',
        domain: 'notebook',
        localName: 'Note',
        outputName: 'Note',
        reason: 'output-name-collision',
        severity: 'error',
      },
    ])
  })

  it('fails flattened path output collisions without semantic dedupe', () => {
    const fixtureIds = [
      'schema:public/a/Name',
      'schema:public/aname/Name',
      'schema:public/a-name/Name',
      'schema:admin/a/Name',
    ] as const
    const registry = createDefinitionRegistry(fixtureIds.map(id => definitionNode(id, {
      type: 'object',
      title: id,
    })))

    expect(validateDefinitionIds(fixtureIds).valid).toBe(true)
    expect(registry.valid).toBe(true)
    expect(registry.nodes.map(node => node.id)).toEqual(fixtureIds)
    expect(registry.nodeById.size).toBe(4)

    const allocation = allocateDefinitionOutputNames([
      registry.nodeById.get('schema:public/a/Name')!,
      registry.nodeById.get('schema:public/aname/Name')!,
      registry.nodeById.get('schema:public/a-name/Name')!,
    ], {
      targetName: 'public-api',
      aliases: {
        'schema:public/a/Name': 'AName',
        'schema:public/aname/Name': 'AName',
        'schema:public/a-name/Name': 'AName',
      },
    })

    expect(allocation.valid).toBe(false)
    expect([...allocation.outputNames.entries()]).toEqual([
      ['schema:public/a/Name', 'AName'],
      ['schema:public/aname/Name', 'AName'],
      ['schema:public/a-name/Name', 'AName'],
    ])
    expect(allocation.diagnostics).toEqual([
      {
        code: 'definition-output-name/collision',
        severity: 'error',
        kind: 'schema',
        outputName: 'AName',
        ids: [
          'schema:public/a/Name',
          'schema:public/aname/Name',
          'schema:public/a-name/Name',
        ],
        message: 'Output component name "AName" for schema collides between canonical ids: schema:public/a/Name, schema:public/aname/Name, schema:public/a-name/Name.',
      },
    ])
    expect(allocation.collisionReport).toEqual([
      {
        canonicalId: 'schema:public/a/Name',
        targetName: 'public-api',
        kind: 'schema',
        scope: 'public',
        domain: 'a',
        localName: 'Name',
        outputName: 'AName',
        reason: 'output-name-collision',
        severity: 'error',
      },
      {
        canonicalId: 'schema:public/aname/Name',
        targetName: 'public-api',
        kind: 'schema',
        scope: 'public',
        domain: 'aname',
        localName: 'Name',
        outputName: 'AName',
        reason: 'output-name-collision',
        severity: 'error',
      },
      {
        canonicalId: 'schema:public/a-name/Name',
        targetName: 'public-api',
        kind: 'schema',
        scope: 'public',
        domain: 'a-name',
        localName: 'Name',
        outputName: 'AName',
        reason: 'output-name-collision',
        severity: 'error',
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
