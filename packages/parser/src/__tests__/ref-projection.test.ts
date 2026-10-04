import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

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
