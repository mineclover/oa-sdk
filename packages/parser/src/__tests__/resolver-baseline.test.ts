import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { derefSpecWithDiagnostics } from '../deref.js'
import { resolveRefGraph } from '../ref-graph.js'

function spec(overrides: Record<string, unknown> = {}) {
  return { openapi: '3.2.0', info: { title: 'T', version: '0' }, paths: {}, ...overrides }
}

describe('resolver baseline behavior', () => {
  it('resolveRefGraph records internal, external YAML/JSON, nested external, missing, and circular refs', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-resolver-baseline-'))
    const basePath = join(tmp, 'api.yaml')
    writeFileSync(join(tmp, 'shared.yaml'), [
      'components:',
      '  schemas:',
      '    User:',
      '      type: object',
      '      properties:',
      '        id:',
      '          $ref: "#/components/schemas/UserId"',
      '        role:',
      '          $ref: "./role.json#/components/schemas/Role"',
      '    UserId:',
      '      type: string',
      '',
    ].join('\n'))
    writeFileSync(join(tmp, 'role.json'), JSON.stringify({
      components: {
        schemas: {
          Role: { type: 'string', enum: ['admin', 'user'] },
        },
      },
    }))

    try {
      const graph = resolveRefGraph(spec({
        components: {
          schemas: {
            Local: { type: 'object' },
            A: { $ref: '#/components/schemas/B' },
            B: { $ref: '#/components/schemas/A' },
          },
        },
        paths: {
          '/local': { get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Local' } } } } } } },
          '/yaml': { get: { responses: { '200': { content: { 'application/json': { schema: { $ref: './shared.yaml#/components/schemas/User' } } } } } } },
          '/json': { get: { responses: { '200': { content: { 'application/json': { schema: { $ref: './role.json#/components/schemas/Role' } } } } } } },
          '/missing-local': { get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Missing' } } } } } } },
          '/missing-external': { get: { responses: { '200': { content: { 'application/json': { schema: { $ref: './shared.yaml#/components/schemas/Missing' } } } } } } },
        },
      }), { basePath })

      expect(graph.nodes.some(n => n.kind === 'internal' && n.ref === '#/components/schemas/Local' && n.resolved)).toBe(true)
      expect(graph.nodes.some(n => n.kind === 'external' && n.ref === './shared.yaml#/components/schemas/User' && n.filePath?.endsWith('shared.yaml') && n.resolved)).toBe(true)
      expect(graph.nodes.some(n => n.kind === 'external' && n.ref === './role.json#/components/schemas/Role' && n.filePath?.endsWith('role.json') && n.resolved)).toBe(true)
      expect(graph.nodes.some(n => n.kind === 'internal' && n.filePath?.endsWith('shared.yaml') && n.ref === '#/components/schemas/UserId' && n.resolved)).toBe(true)
      expect(graph.diagnostics.some(d => d.code === 'ref-not-found' && d.ref === '#/components/schemas/Missing')).toBe(true)
      expect(graph.diagnostics.some(d => d.code === 'external-ref-pointer-not-found' && d.ref === './shared.yaml#/components/schemas/Missing')).toBe(true)
      expect(graph.diagnostics.some(d => d.code === 'ref-cycle')).toBe(true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('derefSpec inlines external files, resolves nested refs relative to their file, and preserves $ref siblings', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-resolver-baseline-'))
    const basePath = join(tmp, 'api.yaml')
    writeFileSync(join(tmp, 'shared.yaml'), [
      'components:',
      '  schemas:',
      '    ExternalUser:',
      '      type: object',
      '      required: [role]',
      '      properties:',
      '        role:',
      '          $ref: "./role.json#/components/schemas/Role"',
      '',
    ].join('\n'))
    writeFileSync(join(tmp, 'role.json'), JSON.stringify({
      components: {
        schemas: {
          Role: { type: 'string', enum: ['admin', 'user'] },
        },
      },
    }))

    try {
      const { document, diagnostics } = derefSpecWithDiagnostics(spec({
        components: {
          schemas: {
            Base: {
              type: 'object',
              required: ['id'],
              properties: { id: { type: 'string' } },
            },
          },
        },
        paths: {
          '/merged': {
            get: {
              responses: {
                '200': {
                  content: {
                    'application/json': {
                      schema: {
                        $ref: '#/components/schemas/Base',
                        required: ['name'],
                        properties: { name: { type: 'string' } },
                        description: 'sibling metadata survives',
                      },
                    },
                  },
                },
              },
            },
          },
          '/external': {
            get: {
              responses: {
                '200': {
                  content: {
                    'application/json': {
                      schema: { $ref: './shared.yaml#/components/schemas/ExternalUser' },
                    },
                  },
                },
              },
            },
          },
        },
      }), { basePath })

      const result = document as any
      expect(result.paths['/merged'].get.responses['200'].content['application/json'].schema).toEqual({
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        description: 'sibling metadata survives',
      })
      expect(result.paths['/external'].get.responses['200'].content['application/json'].schema).toEqual({
        type: 'object',
        required: ['role'],
        properties: {
          role: { type: 'string', enum: ['admin', 'user'] },
        },
      })
      expect(diagnostics).toHaveLength(0)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('derefSpec preserves missing refs and cuts circular refs with diagnostics', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-resolver-baseline-'))
    const basePath = join(tmp, 'api.yaml')
    writeFileSync(join(tmp, 'empty.json'), JSON.stringify({ components: { schemas: {} } }))

    try {
      const { document, diagnostics } = derefSpecWithDiagnostics(spec({
        components: {
          schemas: {
            A: { $ref: '#/components/schemas/B' },
            B: { $ref: '#/components/schemas/A' },
          },
        },
        paths: {
          '/missing-local': { get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Missing' } } } } } } },
          '/missing-external': { get: { responses: { '200': { content: { 'application/json': { schema: { $ref: './empty.json#/components/schemas/Missing' } } } } } } },
        },
      }), { basePath })

      const result = document as any
      expect(result.components.schemas.A).toEqual({})
      expect(result.components.schemas.B).toEqual({})
      expect(result.paths['/missing-local'].get.responses['200'].content['application/json'].schema).toEqual({
        $ref: '#/components/schemas/Missing',
      })
      expect(result.paths['/missing-external'].get.responses['200'].content['application/json'].schema).toEqual({
        $ref: './empty.json#/components/schemas/Missing',
      })
      expect(diagnostics.some(d => d.code === 'ref-cycle')).toBe(true)
      expect(diagnostics.some(d => d.code === 'ref-not-found' && d.ref === '#/components/schemas/Missing')).toBe(true)
      expect(diagnostics.some(d => d.code === 'external-ref-pointer-not-found' && d.ref === './empty.json#/components/schemas/Missing')).toBe(true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
