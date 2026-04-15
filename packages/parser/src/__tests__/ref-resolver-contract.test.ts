import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRefResolver } from '../ref-resolver.js'

describe('RefResolver contract', () => {
  it('resolves internal refs with pointer, cache key, source pointer, missing, and cycle metadata', () => {
    const root = {
      components: {
        schemas: {
          User: { type: 'object' },
        },
      },
    }
    const resolver = createRefResolver()

    const resolved = resolver.resolve({
      ref: '#/components/schemas/User',
      sourcePointer: '#/paths/~1users/get/responses/200/$ref',
      root,
    })

    expect(resolved).toMatchObject({
      kind: 'internal',
      ref: '#/components/schemas/User',
      sourcePointer: '#/paths/~1users/get/responses/200/$ref',
      pointer: '#/components/schemas/User',
      cacheKey: '<root>#/components/schemas/User',
      resolved: true,
      target: { type: 'object' },
    })

    const missing = resolver.resolve({
      ref: '#/components/schemas/Missing',
      sourcePointer: '#/paths/~1missing/get/responses/200/$ref',
      root,
    })
    expect(missing).toMatchObject({
      kind: 'internal',
      resolved: false,
      pointer: '#/components/schemas/Missing',
      diagnostic: { code: 'ref-not-found', ref: '#/components/schemas/Missing' },
    })

    const circular = resolver.resolve({
      ref: '#/components/schemas/User',
      sourcePointer: '#/components/schemas/User/$ref',
      root,
      stack: [resolved.cacheKey],
    })
    expect(circular).toMatchObject({
      kind: 'internal',
      resolved: false,
      cacheKey: '<root>#/components/schemas/User',
      diagnostic: { code: 'ref-cycle', ref: '#/components/schemas/User' },
    })
  })

  it('resolves external YAML and JSON refs with document cache keys and pointer diagnostics', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-ref-resolver-'))
    const basePath = join(tmp, 'api.yaml')
    const yamlPath = join(tmp, 'shared.yaml')
    const jsonPath = join(tmp, 'role.json')
    writeFileSync(yamlPath, [
      'components:',
      '  schemas:',
      '    User:',
      '      type: object',
      '      properties:',
      '        id:',
      '          type: string',
      '',
    ].join('\n'))
    writeFileSync(jsonPath, JSON.stringify({
      components: {
        schemas: {
          Role: { type: 'string', enum: ['admin', 'user'] },
        },
      },
    }))

    try {
      const documentCache = new Map<string, unknown>()
      const resolver = createRefResolver({ entryPath: basePath, documentCache })

      const yaml = resolver.resolve({
        ref: './shared.yaml#/components/schemas/User',
        sourcePointer: '#/paths/~1users/get/responses/200/$ref',
        root: {},
        basePath,
      })
      expect(yaml).toMatchObject({
        kind: 'external',
        ref: './shared.yaml#/components/schemas/User',
        sourcePointer: '#/paths/~1users/get/responses/200/$ref',
        filePath: yamlPath,
        pointer: '#/components/schemas/User',
        cacheKey: `${yamlPath}#/components/schemas/User`,
        documentCacheKey: yamlPath,
        basePath: yamlPath,
        resolved: true,
        target: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
      })
      expect(documentCache.has(yamlPath)).toBe(true)

      const json = resolver.resolve({
        ref: './role.json#/components/schemas/Role',
        sourcePointer: '#/paths/~1roles/get/responses/200/$ref',
        root: {},
        basePath,
      })
      expect(json).toMatchObject({
        kind: 'external',
        filePath: jsonPath,
        pointer: '#/components/schemas/Role',
        resolved: true,
        target: { type: 'string', enum: ['admin', 'user'] },
      })
      expect(documentCache.has(jsonPath)).toBe(true)

      const missing = resolver.resolve({
        ref: './shared.yaml#/components/schemas/Missing',
        sourcePointer: '#/paths/~1missing/get/responses/200/$ref',
        root: {},
        basePath,
      })
      expect(missing).toMatchObject({
        kind: 'external',
        filePath: yamlPath,
        pointer: '#/components/schemas/Missing',
        resolved: false,
        diagnostic: { code: 'external-ref-pointer-not-found' },
      })

      const circular = resolver.resolve({
        ref: './shared.yaml#/components/schemas/User',
        sourcePointer: '#/components/schemas/User/$ref',
        root: {},
        basePath,
        stack: [yaml.cacheKey],
      })
      expect(circular).toMatchObject({
        kind: 'external',
        filePath: yamlPath,
        pointer: '#/components/schemas/User',
        resolved: false,
        diagnostic: { code: 'ref-cycle' },
      })
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
