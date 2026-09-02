import { describe, expect, it } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import {
  generateStandaloneGuards,
  type StandaloneGuardGeneratorOptions,
  type StandaloneGuardTarget,
} from '../../src/index.js'

describe('Standalone Guard Generator Unit Tests', () => {
  const createTempDir = async () => {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'oa-codegen-unit-guards-'))
  }

  describe('Happy Path Schema Compilation', () => {
    it('compiles primitive constraints: pattern, min/max, formats', async () => {
      const outDir = await createTempDir()
      const schemaDoc = {
        $defs: {
          EmailAddress: { type: 'string', format: 'email' },
          UuidString: { type: 'string', format: 'uuid' },
          Score: { type: 'number', minimum: 0, maximum: 100 },
          PostalCode: { type: 'string', pattern: '^\\d{5}$' },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        guards: [
          { name: 'isEmail', typeName: 'EmailAddress', schema: '#/$defs/EmailAddress' },
          { name: 'isUuid', typeName: 'UuidString', schema: '#/$defs/UuidString' },
          { name: 'isScore', typeName: 'Score', schema: '#/$defs/Score' },
          { name: 'isPostalCode', typeName: 'PostalCode', schema: '#/$defs/PostalCode' },
        ],
      })

      expect(artifacts.length).toBe(4) // guards.js, guards.d.ts, index.js, index.d.ts
      const jsArtifact = artifacts.find(a => a.filePath.endsWith('guards.js'))!
      expect(jsArtifact.content).toContain('function isEmail')
      expect(jsArtifact.content).toContain('function isUuid')
      expect(jsArtifact.content).toContain('function isScore')
      expect(jsArtifact.content).toContain('function isPostalCode')

      // Execution verification
      const tempJs = path.join(outDir, 'test-primitives.mjs')
      await fs.writeFile(tempJs, jsArtifact.content, 'utf8')
      const imported = await import(`file://${tempJs}`)

      expect(imported.isEmail('test@example.com')).toBe(true)
      expect(imported.isEmail('invalid-email')).toBe(false)
      expect(imported.isScore(50)).toBe(true)
      expect(imported.isScore(150)).toBe(false)
      expect(imported.isPostalCode('12345')).toBe(true)
      expect(imported.isPostalCode('1234')).toBe(false)
    })

    it('compiles nested objects, arrays, and tuples', async () => {
      const outDir = await createTempDir()
      const schemaDoc = {
        $defs: {
          Coordinates: {
            type: 'array',
            prefixItems: [{ type: 'number' }, { type: 'number' }],
            minItems: 2,
            maxItems: 2,
          },
          GeoPoint: {
            type: 'object',
            required: ['name', 'coords'],
            properties: {
              name: { type: 'string' },
              coords: { $ref: '#/$defs/Coordinates' },
              tags: { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: false,
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        guards: [{ name: 'isGeoPoint', typeName: 'GeoPoint', schema: '#/$defs/GeoPoint' }],
      })

      const jsArtifact = artifacts.find(a => a.filePath.endsWith('guards.js'))!
      const tempJs = path.join(outDir, 'test-objects.mjs')
      await fs.writeFile(tempJs, jsArtifact.content, 'utf8')
      const imported = await import(`file://${tempJs}`)

      expect(imported.isGeoPoint({ name: 'Home', coords: [37.7749, -122.4194], tags: ['primary'] })).toBe(true)
      expect(imported.isGeoPoint({ name: 'Home', coords: [37.7749] })).toBe(false)
      expect(imported.isGeoPoint({ name: 'Home', coords: [37.7749, -122.4194], extra: 123 })).toBe(false)
    })

    it('compiles OpenAPI 3.1 discriminator and oneOf polymorphic models', async () => {
      const outDir = await createTempDir()
      const schemaDoc = {
        openapi: '3.1.0',
        components: {
          schemas: {
            Event: {
              type: 'object',
              required: ['type'],
              properties: { type: { type: 'string' } },
              discriminator: {
                propertyName: 'type',
                mapping: {
                  click: '#/components/schemas/ClickEvent',
                  hover: '#/components/schemas/HoverEvent',
                },
              },
              oneOf: [
                { $ref: '#/components/schemas/ClickEvent' },
                { $ref: '#/components/schemas/HoverEvent' },
              ],
            },
            ClickEvent: {
              type: 'object',
              required: ['type', 'button'],
              properties: {
                type: { const: 'click' },
                button: { type: 'integer', minimum: 0 },
              },
            },
            HoverEvent: {
              type: 'object',
              required: ['type', 'durationMs'],
              properties: {
                type: { const: 'hover' },
                durationMs: { type: 'number', minimum: 0 },
              },
            },
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        guards: [{ name: 'isEvent', typeName: 'Event', schema: '#/components/schemas/Event' }],
      })

      const jsArtifact = artifacts.find(a => a.filePath.endsWith('guards.js'))!
      const tempJs = path.join(outDir, 'test-polymorphic.mjs')
      await fs.writeFile(tempJs, jsArtifact.content, 'utf8')
      const imported = await import(`file://${tempJs}`)

      expect(imported.isEvent({ type: 'click', button: 1 })).toBe(true)
      expect(imported.isEvent({ type: 'hover', durationMs: 250 })).toBe(true)
      expect(imported.isEvent({ type: 'unknown' })).toBe(false)
      expect(imported.isEvent({ type: 'click', button: -1 })).toBe(false)
    })

    it('auto-discovers schemas from components.schemas or $defs when guards is omitted', async () => {
      const outDir = await createTempDir()
      const schemaDoc = {
        components: {
          schemas: {
            Session: {
              type: 'object',
              required: ['token'],
              properties: { token: { type: 'string' } },
            },
            Account: {
              type: 'object',
              required: ['id'],
              properties: { id: { type: 'string' } },
            },
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
      })

      const dts = artifacts.find(a => a.filePath.endsWith('guards.d.ts'))!.content
      expect(dts).toContain('export declare function isSession(data: unknown): data is Session;')
      expect(dts).toContain('export declare function isAccount(data: unknown): data is Account;')
    })
  })

  describe('Zero-Eval and Zero-Dependency Invariants', () => {
    it('guarantees zero eval() and zero new Function() in emitted JS', async () => {
      const outDir = await createTempDir()
      const schemaDoc = {
        $defs: {
          Rule: {
            type: 'object',
            properties: {
              pattern: { type: 'string', pattern: '^[A-Z]{3}-\\d{3}$' },
              range: { type: 'number', minimum: 1, maximum: 100 },
            },
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        guards: [{ name: 'isRule', typeName: 'Rule', schema: '#/$defs/Rule' }],
      })

      const js = artifacts.find(a => a.filePath.endsWith('guards.js'))!.content

      expect(js).not.toMatch(/\beval\s*\(/)
      expect(js).not.toMatch(/new\s+Function\s*\(/)
      expect(js).not.toMatch(/from\s+['"]ajv/)
      expect(js).not.toMatch(/require\s*\(/)
    })

    it('executes in strict sandbox with eval and Function completely blocked', async () => {
      const outDir = await createTempDir()
      const schemaDoc = {
        $defs: {
          Item: {
            type: 'object',
            required: ['name', 'price'],
            properties: {
              name: { type: 'string' },
              price: { type: 'number', minimum: 0 },
            },
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        guards: [{ name: 'isItem', typeName: 'Item', schema: '#/$defs/Item' }],
      })

      const js = artifacts.find(a => a.filePath.endsWith('guards.js'))!.content
      const tempJs = path.join(outDir, 'test-sandbox.mjs')
      await fs.writeFile(tempJs, js, 'utf8')

      const originalEval = globalThis.eval
      const originalFunction = globalThis.Function
      try {
        (globalThis as any).eval = () => {
          throw new Error('CSP blocked eval')
        }
        ;(globalThis as any).Function = () => {
          throw new Error('CSP blocked Function')
        }

        const imported = await import(`file://${tempJs}`)
        expect(imported.isItem({ name: 'Apple', price: 1.5 })).toBe(true)
        expect(imported.isItem({ name: 'Apple', price: -10 })).toBe(false)
        expect(imported.isItem({ name: 'Apple' })).toBe(false)
      } finally {
        globalThis.eval = originalEval
        globalThis.Function = originalFunction
      }
    })
  })

  describe('TypeScript .d.ts Generation', () => {
    it('generates type predicate signatures with custom typeImportSpecifier', async () => {
      const outDir = await createTempDir()
      const schemaDoc = {
        $defs: {
          Client: { type: 'object' },
          Server: { type: 'object' },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        typeImportSpecifier: '@my-scope/models',
        guards: [
          { name: 'isClient', typeName: 'Client', schema: '#/$defs/Client' },
          { name: 'isServer', typeName: 'Server', schema: '#/$defs/Server' },
        ],
      })

      const dts = artifacts.find(a => a.filePath.endsWith('guards.d.ts'))!.content
      expect(dts).toContain("import type { Client, Server } from '@my-scope/models';")
      expect(dts).toContain('export declare function isClient(data: unknown): data is Client;')
      expect(dts).toContain('export declare function isServer(data: unknown): data is Server;')
    })

    it('falls back to data is unknown when typeName is omitted', async () => {
      const outDir = await createTempDir()
      const schemaDoc = {
        $defs: {
          RawPayload: { type: 'object' },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        guards: [{ name: 'isRawPayload', schema: '#/$defs/RawPayload' }],
      })

      const dts = artifacts.find(a => a.filePath.endsWith('guards.d.ts'))!.content
      expect(dts).toContain('export declare function isRawPayload(data: unknown): data is unknown;')
    })

    it('honors generateDeclarations: false to omit .d.ts files', async () => {
      const outDir = await createTempDir()
      const schemaDoc = {
        $defs: {
          Simple: { type: 'string' },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        generateDeclarations: false,
        guards: [{ name: 'isSimple', typeName: 'Simple', schema: '#/$defs/Simple' }],
      })

      expect(artifacts.every(a => !a.filePath.endsWith('.d.ts'))).toBe(true)
      expect(artifacts.some(a => a.filePath.endsWith('guards.js'))).toBe(true)
      expect(artifacts.some(a => a.filePath.endsWith('index.js'))).toBe(true)
    })
  })
})
