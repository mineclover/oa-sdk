import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
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
      '    UserId:',
      '      type: string',
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
      expect(documentCache.get(yamlPath)).toBe(yaml.documentRoot)

      const yamlDocument = resolver.resolve({
        ref: './shared.yaml',
        sourcePointer: '#/paths/~1users',
        root: {},
        basePath,
      })
      expect(yamlDocument).toMatchObject({
        kind: 'external',
        filePath: yamlPath,
        pointer: '#',
        cacheKey: `${yamlPath}#`,
        resolved: true,
        target: {
          components: {
            schemas: {
              User: expect.any(Object),
            },
          },
        },
      })

      const yamlDocumentWithEmptyFragment = resolver.resolve({
        ref: './shared.yaml#',
        sourcePointer: '#/paths/~1users',
        root: {},
        basePath,
      })
      expect(yamlDocumentWithEmptyFragment).toMatchObject({
        kind: 'external',
        filePath: yamlPath,
        pointer: '#',
        resolved: true,
      })

      const yamlAgain = resolver.resolve({
        ref: './shared.yaml#/components/schemas/UserId',
        sourcePointer: '#/paths/~1users/get/responses/200/$ref',
        root: {},
        basePath,
      })
      expect(yamlAgain.documentRoot).toBe(yaml.documentRoot)

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
        diagnostic: {
          code: 'external-ref-pointer-not-found',
          sourceFilePath: basePath,
          sourcePointer: '#/paths/~1missing/get/responses/200/$ref',
        },
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

  it.each([true, false])(
    'keys internal refs by their document (includeInternalFilePath: %s only changes reporting)',
    (includeInternalFilePath) => {
      const entryPath = join(tmpdir(), 'oa-sdk-ref-identity', 'api.yaml')
      const sharedPath = join(tmpdir(), 'oa-sdk-ref-identity', 'shared.yaml')
      const ref = '#/components/schemas/Node'
      const entry = { components: { schemas: { Node: { type: 'object' } } } }
      const shared = { components: { schemas: { Node: { type: 'string' } } } }
      const resolver = createRefResolver({ entryPath, includeInternalFilePath })

      const inEntry = resolver.resolve({ ref, sourcePointer: '#/a/$ref', root: entry, basePath: entryPath })
      const inShared = resolver.resolve({ ref, sourcePointer: '#/b/$ref', root: shared, basePath: sharedPath })

      expect(inEntry).toMatchObject({ resolved: true, cacheKey: `<root>${ref}`, target: { type: 'object' } })
      expect(inEntry.filePath).toBeUndefined()
      expect(inShared).toMatchObject({ resolved: true, cacheKey: `${sharedPath}${ref}`, target: { type: 'string' } })
      expect(inShared.filePath).toBe(includeInternalFilePath ? sharedPath : undefined)

      // The entry document's pointer on the stack is not the shared document's pointer.
      const sharedRequest = { ref, sourcePointer: '#/b/$ref', root: shared, basePath: sharedPath }
      expect(resolver.resolve({ ...sharedRequest, stack: [inEntry.cacheKey] }).diagnostic).toBeUndefined()
      const cycle = resolver.resolve({ ...sharedRequest, stack: [inShared.cacheKey] })
      expect(cycle.diagnostic).toMatchObject({ code: 'ref-cycle', ref, pointer: ref, sourceFilePath: sharedPath })
      expect(cycle.diagnostic?.filePath).toBe(includeInternalFilePath ? sharedPath : undefined)
    },
  )

  it('keys the entry file as the entry document however it is addressed', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-ref-resolver-'))
    const entryPath = join(tmp, 'api.yaml')
    const sharedPath = join(tmp, 'shared.yaml')
    writeFileSync(entryPath, [
      'components:',
      '  schemas:',
      '    Node:',
      '      type: object',
      '',
    ].join('\n'))

    try {
      for (const configuredEntryPath of [entryPath, relative(process.cwd(), entryPath)]) {
        const resolver = createRefResolver({ entryPath: configuredEntryPath })
        const backRef = resolver.resolve({
          ref: './api.yaml#/components/schemas/Node',
          sourcePointer: '#/components/schemas/Back/$ref',
          root: {},
          basePath: sharedPath,
        })
        expect(backRef).toMatchObject({
          kind: 'external',
          resolved: true,
          cacheKey: '<root>#/components/schemas/Node',
          filePath: entryPath,
          documentCacheKey: entryPath,
          target: { type: 'object' },
        })

        // The entry loaded through that ref keeps the entry document's keys.
        const internal = resolver.resolve({
          ref: '#/components/schemas/Node',
          sourcePointer: '#/components/schemas/Node/$ref',
          root: backRef.documentRoot,
          basePath: entryPath,
        })
        expect(internal.cacheKey).toBe('<root>#/components/schemas/Node')
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('spells a ref written in another document from the entry document', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-ref-resolver-'))
    const entryPath = join(tmp, 'project', 'api.json')
    const linkPath = join(tmp, 'project', 'sub', 'link.json')
    const leftPath = join(tmp, 'project', 'a', 'left.json')
    const commonPath = join(tmp, 'shared', 'common.json')
    const schemas = (...names: string[]) =>
      ({ components: { schemas: Object.fromEntries(names.map(name => [name, { title: name }])) } })
    const documents = new Map<string, unknown>([
      [entryPath, schemas('Node')],
      [linkPath, schemas('Link', 'No d')],
      [leftPath, schemas('Left')],
      [commonPath, schemas('Common')],
    ])
    for (const [path, document] of documents) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify(document))
    }

    // [written in, ref as written there, the same target spelled from the entry]
    const cases: Array<[string, string, string]> = [
      [linkPath, '../api.json#/components/schemas/Node', '#/components/schemas/Node'],
      [linkPath, '../api.json', '#'],
      [linkPath, '#/components/schemas/Link', './sub/link.json#/components/schemas/Link'],
      [linkPath, '#/components/schemas/No%20d', './sub/link.json#/components/schemas/No%20d'],
      [linkPath, '../a/left.json#/components/schemas/Left', './a/left.json#/components/schemas/Left'],
      [linkPath, '../../shared/common.json#/components/schemas/Common', '../shared/common.json#/components/schemas/Common'],
      [leftPath, './left.json', './a/left.json'],
      [commonPath, '../project/sub/link.json#/components/schemas/Link', './sub/link.json#/components/schemas/Link'],
      // Written in the entry document: already spelled from there.
      [entryPath, './sub/link.json#/components/schemas/Link', './sub/link.json#/components/schemas/Link'],
      [entryPath, '#/components/schemas/Node', '#/components/schemas/Node'],
    ]

    try {
      for (const configuredEntryPath of [entryPath, relative(process.cwd(), entryPath)]) {
        const resolver = createRefResolver({ entryPath: configuredEntryPath })
        const identity = (ref: string, basePath: string) => {
          const resolution = resolver.resolve({
            ref,
            sourcePointer: '#/$ref',
            root: documents.get(basePath),
            basePath,
          })
          expect(resolution.resolved, `${ref} from ${basePath}`).toBe(true)
          return resolution.cacheKey
        }

        for (const [basePath, ref, expected] of cases) {
          const rebased = resolver.entryRelativeRef(ref, basePath)
          expect(rebased, `${ref} from ${basePath}`).toBe(expected)
          expect(identity(rebased, entryPath)).toBe(identity(ref, basePath))
        }
        expect(resolver.entryRelativeRef('#/components/schemas/Node', configuredEntryPath))
          .toBe('#/components/schemas/Node')
        expect(resolver.entryRelativeRef('#/components/schemas/Node', undefined)).toBe('#/components/schemas/Node')
      }

      // Without an entry location there is nothing to spell a ref from.
      expect(createRefResolver().entryRelativeRef('#/components/schemas/Link', linkPath))
        .toBe('#/components/schemas/Link')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
