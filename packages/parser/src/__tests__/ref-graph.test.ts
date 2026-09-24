import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as parseYaml } from 'yaml'
import { resolveRefGraph } from '../ref-graph.js'
import { createSourceLocationIndex, type SourceLocationIndex } from '../source-location.js'

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
      expect(graph.diagnostics.some(d =>
        d.code === 'external-ref-read-failed'
        && d.sourceFilePath === basePath
        && d.sourcePointer === '#/paths/~1file/get/responses/200/content/application~1json/schema/$ref'
      )).toBe(true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('external YAML diagnostics include source line and column when mappings are available', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-refgraph-'))
    const basePath = join(tmp, 'api.yaml')
    const sharedPath = join(tmp, 'shared.yaml')
    const emptyPath = join(tmp, 'empty.yaml')
    const apiRaw = [
      'openapi: 3.2.0',
      'info:',
      '  title: T',
      '  version: "0"',
      'paths:',
      '  /users:',
      '    get:',
      '      responses:',
      '        "200":',
      '          content:',
      '            application/json:',
      '              schema:',
      '                $ref: "./shared.yaml#/components/schemas/User"',
      '',
    ].join('\n')
    const sharedRaw = [
      'components:',
      '  schemas:',
      '    User:',
      '      type: object',
      '      properties:',
      '        role:',
      '          $ref: "./empty.yaml#/components/schemas/Missing"',
      '',
    ].join('\n')
    const emptyRaw = [
      'components:',
      '  schemas: {}',
      '',
    ].join('\n')
    writeFileSync(basePath, apiRaw, 'utf8')
    writeFileSync(sharedPath, sharedRaw, 'utf8')
    writeFileSync(emptyPath, emptyRaw, 'utf8')

    try {
      const indexes = new Map<string, SourceLocationIndex>([
        [basePath, createSourceLocationIndex(apiRaw, { filePath: basePath })],
        [sharedPath, createSourceLocationIndex(sharedRaw, { filePath: sharedPath })],
        [emptyPath, createSourceLocationIndex(emptyRaw, { filePath: emptyPath })],
      ])
      const graph = resolveRefGraph(parseYaml(apiRaw) as Record<string, unknown>, {
        basePath,
        lookupSourceLocation: (filePath, pointer) => indexes.get(filePath)?.lookup(pointer),
      })
      const diagnostic = graph.diagnostics.find(d => d.code === 'external-ref-pointer-not-found')

      expect(diagnostic).toMatchObject({
        sourceFilePath: sharedPath,
        sourcePointer: '#/components/schemas/User/properties/role/$ref',
        filePath: emptyPath,
        pointer: '#/components/schemas/Missing',
        line: 7,
        column: 11,
      })
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

  it('accepts recursive object schema references without expanding them forever', () => {
    const graph = resolveRefGraph(doc({
      components: { schemas: { GroupLayer: { type: 'object', properties: { children: { type: 'array', items: { $ref: '#/components/schemas/GroupLayer' } } } } } },
    }))
    expect(graph.nodes.some(node => node.ref === '#/components/schemas/GroupLayer' && node.resolved)).toBe(true)
    expect(graph.diagnostics.some(diagnostic => diagnostic.code === 'ref-cycle')).toBe(false)
  })

  it('$ref sibling 내부의 $ref도 수집한다', () => {
    const graph = resolveRefGraph(doc({
      components: {
        schemas: {
          Base: { type: 'object' },
          Child: { type: 'string' },
        },
      },
      paths: {
        '/x': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/Base',
                      properties: {
                        child: { $ref: '#/components/schemas/Child' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }))

    expect(graph.nodes.some(n => n.ref === '#/components/schemas/Base')).toBe(true)
    expect(graph.nodes.some(n => n.ref === '#/components/schemas/Child')).toBe(true)
  })

  it('root pointer #를 해소한다', () => {
    const graph = resolveRefGraph({ $ref: '#', title: 'Root' } as any)
    expect(graph.nodes.some(n => n.ref === '#' && n.resolved)).toBe(true)
  })
})
