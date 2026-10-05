import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { collectRefs } from '../ref-graph.js'
import { projectRefGraph } from '../ref-projection.js'

function doc(overrides: Record<string, unknown> = {}) {
  return { openapi: '3.2.0', info: { title: 'Projection', version: '1.0.0' }, paths: {}, ...overrides }
}

const jsonResponse = (ref: string) => ({
  responses: { '200': { description: 'OK', content: { 'application/json': { schema: { $ref: ref } } } } },
})

describe('projectRefGraph', () => {
  it('projects declarations as nodes and $ref occurrences as edges between their owners', () => {
    const projection = projectRefGraph(doc({
      paths: { '/users/{id}': { get: jsonResponse('#/components/schemas/User') } },
      components: {
        schemas: {
          User: { type: 'object', properties: { role: { $ref: '#/components/schemas/Role' } } },
          Role: { type: 'string', enum: ['admin', 'member'] },
        },
        parameters: { Id: { name: 'id', in: 'path', required: true, schema: { type: 'string' } } },
      },
    }))

    expect(projection.nodes).toEqual([
      { id: '#/components/schemas/User', kind: 'schema', name: 'User', pointer: '#/components/schemas/User' },
      { id: '#/components/schemas/Role', kind: 'schema', name: 'Role', pointer: '#/components/schemas/Role' },
      { id: '#/components/parameters/Id', kind: 'parameter', name: 'Id', pointer: '#/components/parameters/Id' },
      { id: '#/paths/~1users~1{id}', kind: 'path', name: '/users/{id}', pointer: '#/paths/~1users~1{id}' },
    ])
    expect(projection.edges).toEqual([
      {
        source: '#/paths/~1users~1{id}',
        target: '#/components/schemas/User',
        ref: '#/components/schemas/User',
        sourcePointer: '#/paths/~1users~1{id}/get/responses/200/content/application~1json/schema/$ref',
      },
      {
        source: '#/components/schemas/User',
        target: '#/components/schemas/Role',
        ref: '#/components/schemas/Role',
        sourcePointer: '#/components/schemas/User/properties/role/$ref',
      },
    ])
    expect(projection.diagnostics).toEqual([])
  })

  it('keeps self-references and classifies cycles as guarded or unguarded recursion', () => {
    const projection = projectRefGraph(doc({
      components: {
        schemas: {
          Tree: { type: 'object', properties: { children: { type: 'array', items: { $ref: '#/components/schemas/Tree' } } } },
          Leaf: { type: 'object', properties: { tree: { $ref: '#/components/schemas/Tree' } } },
          A: { $ref: '#/components/schemas/B' },
          B: { $ref: '#/components/schemas/A' },
        },
      },
    }))

    const bySource = Object.fromEntries(projection.edges.map(edge => [edge.source, edge]))
    expect(bySource['#/components/schemas/Tree']).toMatchObject({ target: '#/components/schemas/Tree', recursion: 'guarded' })
    expect(bySource['#/components/schemas/Leaf']).not.toHaveProperty('recursion')
    expect(bySource['#/components/schemas/A']).toMatchObject({ target: '#/components/schemas/B', recursion: 'unguarded' })
    expect(bySource['#/components/schemas/B']).toMatchObject({ target: '#/components/schemas/A', recursion: 'unguarded' })
    expect(projection.diagnostics.filter(d => d.code === 'ref-cycle')).toHaveLength(2)
  })

  it('stays linear in the number of occurrences for a reference ring', () => {
    const schemas: Record<string, unknown> = {}
    for (let index = 0; index < 400; index++) {
      schemas[`M${index}`] = { type: 'object', properties: { next: { $ref: `#/components/schemas/M${(index + 1) % 400}` } } }
    }
    const projection = projectRefGraph(doc({ components: { schemas } }))

    expect(projection.nodes).toHaveLength(400)
    expect(projection.edges).toHaveLength(400)
    expect(projection.edges.every(edge => edge.recursion === 'guarded')).toBe(true)
  })

  it('reports each end of a $ref occurrence that lies outside every node instead of dropping it silently', () => {
    const spec = doc({
      info: { title: 'Projection', version: '1.0.0', 'x-logo': { $ref: '#/x-shared/Thing' } },
      components: {
        schemas: {
          A: {
            type: 'object',
            properties: { thing: { $ref: '#/x-shared/Thing' }, tag: { $ref: '#/components/schemas/Tag' } },
          },
          Tag: { type: 'string' },
        },
      },
      'x-shared': { Thing: { $ref: '#/components/schemas/Tag' } },
    })
    const projection = projectRefGraph(spec)

    expect(projection.edges).toEqual([{
      source: '#/components/schemas/A',
      target: '#/components/schemas/Tag',
      ref: '#/components/schemas/Tag',
      sourcePointer: '#/components/schemas/A/properties/tag/$ref',
    }])
    const outside = (code: string, sourcePointer: string, ref: string) => ({
      code,
      ref,
      message: expect.stringContaining(code === 'ref-source-outside-nodes' ? sourcePointer : ref),
      sourcePointer,
      pointer: ref,
    })
    expect(sortDiagnostics(projection.diagnostics)).toEqual([
      outside('ref-target-outside-nodes', '#/components/schemas/A/properties/thing/$ref', '#/x-shared/Thing'),
      outside('ref-source-outside-nodes', '#/info/x-logo/$ref', '#/x-shared/Thing'),
      outside('ref-target-outside-nodes', '#/info/x-logo/$ref', '#/x-shared/Thing'),
      outside('ref-source-outside-nodes', '#/x-shared/Thing/$ref', '#/components/schemas/Tag'),
    ])

    // Every $ref occurrence of the document has an edge or a diagnostic.
    const occurrences: string[] = []
    collectRefs(spec, '#', (_ref, sourcePointer) => occurrences.push(sourcePointer))
    const accounted = new Set([
      ...projection.edges.map(edge => edge.sourcePointer),
      ...projection.diagnostics.map(diagnostic => diagnostic.sourcePointer),
    ])
    expect([...accounted].sort()).toEqual([...occurrences].sort())
  })

  it('locates outside-node occurrences in the file they are written in', () => {
    const basePath = join(tmpdir(), 'oa-sdk-ref-projection-location', 'api.yaml')
    const projection = projectRefGraph(doc({
      components: { schemas: { A: { properties: { thing: { $ref: '#/x-shared/Thing' } } } } },
      'x-shared': { Thing: { type: 'string' } },
    }), {
      basePath,
      lookupSourceLocation: (filePath, pointer) =>
        filePath === basePath && pointer === '#/components/schemas/A/properties/thing/$ref' ? { line: 7, column: 13 } : undefined,
    })

    expect(projection.edges).toEqual([])
    expect(projection.diagnostics).toEqual([expect.objectContaining({
      code: 'ref-target-outside-nodes',
      sourceFilePath: basePath,
      pointer: '#/x-shared/Thing',
      line: 7,
      column: 13,
    })])
    expect(projection.diagnostics[0]).not.toHaveProperty('filePath')
  })

  it('projects external targets as nodes owned by their file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oa-sdk-ref-projection-'))
    try {
      writeFileSync(join(dir, 'shared.yaml'), [
        'components:',
        '  schemas:',
        '    User:',
        '      type: object',
        '      properties:',
        '        role:',
        "          $ref: '#/components/schemas/Role'",
        '    Role:',
        '      type: string',
      ].join('\n'))
      const basePath = join(dir, 'api.yaml')
      const shared = join(dir, 'shared.yaml')

      const projection = projectRefGraph(doc({
        paths: { '/users': { get: jsonResponse('./shared.yaml#/components/schemas/User') } },
      }), { basePath })

      expect(projection.nodes).toContainEqual({
        id: `${shared}#/components/schemas/User`,
        kind: 'external',
        name: 'User',
        pointer: '#/components/schemas/User',
        filePath: shared,
      })
      expect(projection.edges).toEqual([
        expect.objectContaining({ source: '#/paths/~1users', target: `${shared}#/components/schemas/User` }),
        expect.objectContaining({
          source: `${shared}#/components/schemas/User`,
          target: `${shared}#/components/schemas/Role`,
          sourceFilePath: shared,
        }),
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function sortDiagnostics<T extends { sourcePointer?: string; code: string }>(diagnostics: readonly T[]): T[] {
  const key = (diagnostic: T) => `${diagnostic.sourcePointer ?? ''}\u0000${diagnostic.code}`
  return [...diagnostics].sort((left, right) => (key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0))
}
