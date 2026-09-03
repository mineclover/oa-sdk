import { describe, it, expect } from 'vitest'
import {
  stableStringify,
  computeSha256,
  computeVersionHash,
  stripSchemaEngineExtensions,
} from '../spec-projector.js'

describe('Deterministic Schema Hashing & Version Invariants', () => {
  // =========================================================================
  // 1. Hash Format & Standard Invariants
  // =========================================================================
  describe('1. Hash Format & Standard Invariants', () => {
    it('1.1 formats hash with sha256: prefix and 64 lowercase hexadecimal characters', () => {
      const hash = computeVersionHash({ openapi: '3.1.0', info: { title: 'T', version: '1.0.0' } })
      expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/)
    })

    it('1.2 produces exactly 71 characters in length', () => {
      const hash = computeVersionHash({ test: true })
      expect(hash).toHaveLength(71)
      expect(hash.startsWith('sha256:')).toBe(true)
    })

    it('1.3 contains no uppercase letters in hex digest', () => {
      const hash = computeVersionHash({ openapi: '3.1.0', components: { schemas: {} } })
      const hexPart = hash.slice(7)
      expect(hexPart).toBe(hexPart.toLowerCase())
      expect(hexPart).not.toMatch(/[A-F]/)
    })

    it('1.4 is pure and deterministic across repeated runs', () => {
      const doc = {
        openapi: '3.1.0',
        info: { title: 'Repeat', version: '1.0.0' },
        paths: { '/test': { get: { responses: { '200': { description: 'ok' } } } } },
      }
      const h1 = computeVersionHash(doc)
      const h2 = computeVersionHash(doc)
      const h3 = computeVersionHash(doc)
      expect(h1).toBe(h2)
      expect(h2).toBe(h3)
    })
  })

  // =========================================================================
  // 2. Vendor Extension Stripping (x-schema-engine-*)
  // =========================================================================
  describe('2. Vendor Extension Stripping', () => {
    const baseDoc = {
      openapi: '3.1.0',
      info: { title: 'Test Spec', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          User: {
            type: 'object',
            properties: { id: { type: 'string' } },
          },
        },
      },
    }

    it('2.1 strips x-schema-engine-version-hash to prevent self-referential instability', () => {
      const withHash = {
        ...baseDoc,
        'x-schema-engine-version-hash': 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      }
      expect(computeVersionHash(withHash)).toBe(computeVersionHash(baseDoc))
    })

    it('2.2 strips all registered x-schema-engine-* extensions', () => {
      const withAllExtensions = {
        ...baseDoc,
        'x-schema-engine-profile': 'component-bundle',
        'x-schema-engine-version-hash': 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        'x-schema-engine-sources': { User: { kind: 'file', filePath: 'src/user.ts', pointer: '#/components/schemas/User' } },
        'x-schema-engine-refs': [{ from: '#/components/schemas/User', ref: '#/components/schemas/Id', kind: 'schema-component' }],
      }
      expect(computeVersionHash(withAllExtensions)).toBe(computeVersionHash(baseDoc))
    })

    it('2.3 strips arbitrary wildcard x-schema-engine-* extensions', () => {
      const withWildcard = {
        ...baseDoc,
        'x-schema-engine-custom-metadata': { generator: 'oa-sdk', timestamp: 1234567890 },
      }
      expect(computeVersionHash(withWildcard)).toBe(computeVersionHash(baseDoc))
    })

    it('2.4 preserves non-schema-engine extensions in content hash calculation', () => {
      const docWithOtherExt1 = {
        ...baseDoc,
        'x-tagGroups': [{ name: 'Core', tags: ['User'] }],
      }
      const docWithOtherExt2 = {
        ...baseDoc,
        'x-tagGroups': [{ name: 'Accounts', tags: ['User'] }],
      }
      expect(computeVersionHash(docWithOtherExt1)).not.toBe(computeVersionHash(baseDoc))
      expect(computeVersionHash(docWithOtherExt1)).not.toBe(computeVersionHash(docWithOtherExt2))
    })

    it('2.5 achieves self-referential idempotency when attaching the computed hash', () => {
      const doc = { ...baseDoc }
      const hash1 = computeVersionHash(doc)
      ;(doc as any)['x-schema-engine-version-hash'] = hash1
      const hash2 = computeVersionHash(doc)
      expect(hash1).toBe(hash2)
    })

    it('2.6 strips extensions when document is provided as a raw JSON string', () => {
      const withExtensions = {
        ...baseDoc,
        'x-schema-engine-profile': 'component-bundle',
        'x-schema-engine-version-hash': 'sha256:abcdef0123456789',
      }
      const rawString = JSON.stringify(withExtensions, null, 2)
      expect(computeVersionHash(rawString)).toBe(computeVersionHash(baseDoc))
    })
  })

  // =========================================================================
  // 3. Property Re-ordering Invariance (AST & JSON)
  // =========================================================================
  describe('3. Property Re-ordering Invariance', () => {
    it('3.1 root-level property reordering produces identical hash', () => {
      const docA = {
        openapi: '3.1.0',
        info: { title: 'Order', version: '1.0.0' },
        paths: {},
      }
      const docB = {
        paths: {},
        openapi: '3.1.0',
        info: { title: 'Order', version: '1.0.0' },
      }
      expect(computeVersionHash(docA)).toBe(computeVersionHash(docB))
    })

    it('3.2 component schemas declaration order produces identical hash', () => {
      const docA = {
        openapi: '3.1.0',
        info: { title: 'Schemas', version: '1.0.0' },
        components: {
          schemas: {
            Zeta: { type: 'string' },
            Alpha: { type: 'number' },
            Beta: { type: 'boolean' },
          },
        },
      }
      const docB = {
        openapi: '3.1.0',
        info: { title: 'Schemas', version: '1.0.0' },
        components: {
          schemas: {
            Alpha: { type: 'number' },
            Beta: { type: 'boolean' },
            Zeta: { type: 'string' },
          },
        },
      }
      expect(computeVersionHash(docA)).toBe(computeVersionHash(docB))
    })

    it('3.3 deep nested object property reordering produces identical hash', () => {
      const docA = {
        openapi: '3.1.0',
        info: { title: 'Deep', version: '1.0.0' },
        components: {
          schemas: {
            User: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'User ID' },
                profile: {
                  type: 'object',
                  properties: {
                    lastName: { type: 'string' },
                    firstName: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      }
      const docB = {
        openapi: '3.1.0',
        info: { title: 'Deep', version: '1.0.0' },
        components: {
          schemas: {
            User: {
              properties: {
                profile: {
                  properties: {
                    firstName: { type: 'string' },
                    lastName: { type: 'string' },
                  },
                  type: 'object',
                },
                id: { description: 'User ID', type: 'string' },
              },
              type: 'object',
            },
          },
        },
      }
      expect(computeVersionHash(docA)).toBe(computeVersionHash(docB))
    })

    it('3.4 array order is strictly preserved (negative invariance)', () => {
      const docA = {
        openapi: '3.1.0',
        info: { title: 'Arrays', version: '1.0.0' },
        components: {
          schemas: {
            Role: { type: 'string', enum: ['admin', 'user', 'guest'] },
          },
        },
      }
      const docB = {
        openapi: '3.1.0',
        info: { title: 'Arrays', version: '1.0.0' },
        components: {
          schemas: {
            Role: { type: 'string', enum: ['user', 'admin', 'guest'] },
          },
        },
      }
      expect(computeVersionHash(docA)).not.toBe(computeVersionHash(docB))
    })
  })

  // =========================================================================
  // 4. Platform, Locale & Whitespace Invariance
  // =========================================================================
  describe('4. Platform, Locale & Whitespace Invariance', () => {
    it('4.1 normalizes CRLF to LF in schema descriptions and string fields', () => {
      const docUnix = {
        openapi: '3.1.0',
        info: { title: 'CRLF Test', version: '1.0.0', description: 'Line 1\nLine 2\nLine 3' },
      }
      const docWin = {
        openapi: '3.1.0',
        info: { title: 'CRLF Test', version: '1.0.0', description: 'Line 1\r\nLine 2\r\nLine 3' },
      }
      expect(computeVersionHash(docUnix)).toBe(computeVersionHash(docWin))
    })

    it('4.2 sorts keys by UTF-16 code units / Unicode code point order independently of system locale', () => {
      const keys = ['_id', '$ref', 'a', 'Z', 'ä', '123', 'alpha']
      const obj1: Record<string, number> = {}
      for (const k of keys) obj1[k] = 1

      const obj2: Record<string, number> = {}
      for (const k of [...keys].reverse()) obj2[k] = 1

      expect(stableStringify(obj1)).toBe(stableStringify(obj2))
      expect(computeSha256(obj1)).toBe(computeSha256(obj2))
    })

    it('4.3 strips insignificant whitespace outside string literals', () => {
      const docObj = { openapi: '3.1.0', info: { title: 'Whitespace', version: '1.0.0' } }
      const minifiedJson = '{"openapi":"3.1.0","info":{"title":"Whitespace","version":"1.0.0"}}'
      const prettyJson = '{\n  "openapi": "3.1.0",\n  "info": {\n    "title": "Whitespace",\n    "version": "1.0.0"\n  }\n}'

      expect(computeVersionHash(docObj)).toBe(computeVersionHash(minifiedJson))
      expect(computeVersionHash(docObj)).toBe(computeVersionHash(prettyJson))
    })

    it('4.4 filters undefined properties in objects and normalizes undefined in arrays', () => {
      const docA = { a: 1, b: undefined }
      const docB = { a: 1 }
      expect(stableStringify(docA)).toBe(stableStringify(docB))

      const arrA = [1, undefined, 2]
      const arrB = [1, null, 2]
      expect(stableStringify(arrA)).toBe(stableStringify(arrB))
    })
  })

  // =========================================================================
  // 5. Mutation Sensitivity
  // =========================================================================
  describe('5. Mutation Sensitivity', () => {
    const base = {
      openapi: '3.1.0',
      info: { title: 'Original', version: '1.0.0', description: 'Initial spec.' },
      paths: {
        '/items': {
          get: {
            responses: {
              '200': {
                description: 'Success',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Item: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string', description: 'Unique identifier' },
              count: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
    }
    const baseHash = computeVersionHash(base)

    it('5.1 detects field addition in component schema', () => {
      const mutated = JSON.parse(JSON.stringify(base))
      mutated.components.schemas.Item.properties.label = { type: 'string' }
      expect(computeVersionHash(mutated)).not.toBe(baseHash)
    })

    it('5.2 detects field removal in component schema', () => {
      const mutated = JSON.parse(JSON.stringify(base))
      delete mutated.components.schemas.Item.properties.count
      expect(computeVersionHash(mutated)).not.toBe(baseHash)
    })

    it('5.3 detects field type alteration', () => {
      const mutated = JSON.parse(JSON.stringify(base))
      mutated.components.schemas.Item.properties.count.type = 'number'
      expect(computeVersionHash(mutated)).not.toBe(baseHash)
    })

    it('5.4 detects 1-character description change', () => {
      const mutated = JSON.parse(JSON.stringify(base))
      mutated.components.schemas.Item.properties.id.description = 'Unique identifiers'
      expect(computeVersionHash(mutated)).not.toBe(baseHash)
    })

    it('5.5 detects info.title change', () => {
      const mutated = JSON.parse(JSON.stringify(base))
      mutated.info.title = 'Mutated'
      expect(computeVersionHash(mutated)).not.toBe(baseHash)
    })

    it('5.6 detects info.version change', () => {
      const mutated = JSON.parse(JSON.stringify(base))
      mutated.info.version = '1.0.1'
      expect(computeVersionHash(mutated)).not.toBe(baseHash)
    })

    it('5.7 detects constraint alteration (minimum: 0 -> 1)', () => {
      const mutated = JSON.parse(JSON.stringify(base))
      mutated.components.schemas.Item.properties.count.minimum = 1
      expect(computeVersionHash(mutated)).not.toBe(baseHash)
    })

    it('5.8 detects path operation addition', () => {
      const mutated = JSON.parse(JSON.stringify(base))
      mutated.paths['/items'].post = {
        responses: { '201': { description: 'Created' } },
      }
      expect(computeVersionHash(mutated)).not.toBe(baseHash)
    })

    it('5.9 detects response status code alteration', () => {
      const mutated = JSON.parse(JSON.stringify(base))
      mutated.paths['/items'].get.responses['204'] = mutated.paths['/items'].get.responses['200']
      delete mutated.paths['/items'].get.responses['200']
      expect(computeVersionHash(mutated)).not.toBe(baseHash)
    })
  })
})
