import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveRefGraph } from '../ref-graph.js'

function doc(overrides: Record<string, unknown> = {}) {
  return { openapi: '3.2.0', info: { title: 'T', version: '0' }, paths: {}, ...overrides }
}

describe('resolveRefGraph', () => {
  it('internal refs resolved/missing 진단', () => {
    const graph = resolveRefGraph(doc({
      components: { schemas: { User: { type: 'object' } } },
      paths: {
        '/ok': { get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } } } },
        '/bad': { get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Missing' } } } } } } },
      },
    }))

    expect(graph.nodes.some(n => n.ref === '#/components/schemas/User' && n.resolved)).toBe(true)
    expect(graph.diagnostics.some(d => d.code === 'ref-not-found' && d.ref === '#/components/schemas/Missing')).toBe(true)
  })

  it('external YAML refs를 재귀적으로 추적', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-refgraph-'))
    const basePath = join(tmp, 'api.yaml')
    writeFileSync(join(tmp, 'shared.yaml'), [
      'components:',
      '  schemas:',
      '    User:',
      '      type: object',
      '      properties:',
      '        role:',
      '          $ref: "./roles.yaml#/components/schemas/Role"',
      '',
    ].join('\n'))
    writeFileSync(join(tmp, 'roles.yaml'), [
      'components:',
      '  schemas:',
      '    Role:',
      '      type: string',
      '      enum: [admin, user]',
      '',
    ].join('\n'))

    try {
      const graph = resolveRefGraph(doc({
        paths: {
          '/users': { get: { responses: { '200': { content: { 'application/json': { schema: { $ref: './shared.yaml#/components/schemas/User' } } } } } } },
        },
      }), { basePath })

      expect(graph.nodes.some(n => n.ref === './shared.yaml#/components/schemas/User' && n.resolved)).toBe(true)
      expect(graph.nodes.some(n => n.ref === './roles.yaml#/components/schemas/Role' && n.resolved)).toBe(true)
      expect(graph.diagnostics).toHaveLength(0)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('external file/pointer failures include source details', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-refgraph-'))
    const basePath = join(tmp, 'api.yaml')
    writeFileSync(join(tmp, 'empty.yaml'), 'components: { schemas: {} }\n')

    try {
      const graph = resolveRefGraph(doc({
        paths: {
          '/file': { get: { responses: { '200': { content: { 'application/json': { schema: { $ref: './missing.yaml#/components/schemas/User' } } } } } } },
          '/pointer': { get: { responses: { '200': { content: { 'application/json': { schema: { $ref: './empty.yaml#/components/schemas/User' } } } } } } },
        },
      }), { basePath })

      expect(graph.diagnostics.some(d => d.code === 'external-ref-read-failed' && d.filePath?.endsWith('missing.yaml'))).toBe(true)
      expect(graph.diagnostics.some(d => d.code === 'external-ref-pointer-not-found' && d.pointer === '#/components/schemas/User')).toBe(true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('cycles are diagnosed', () => {
    const graph = resolveRefGraph(doc({
      components: {
        schemas: {
          A: { $ref: '#/components/schemas/B' },
          B: { $ref: '#/components/schemas/A' },
        },
      },
    }))

    expect(graph.diagnostics.some(d => d.code === 'ref-cycle')).toBe(true)
  })
})
