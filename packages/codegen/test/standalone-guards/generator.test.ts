import { afterEach, describe, expect, it } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import {
  generateStandaloneGuards,
  type StandaloneGuardGeneratorOptions,
  type StandaloneGuardTarget,
} from '../../src/index.js'
import { typecheckGeneratedFiles } from '../../src/__tests__/plugin/helpers/typecheck-generated.js'

describe('Standalone Guard Generator Unit Tests', () => {
  const tempDirs: string[] = []
  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
  const createTempDir = async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-codegen-unit-guards-'))
    tempDirs.push(dir)
    return dir
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

      expect(artifacts.map(artifact => path.basename(artifact.filePath)).sort()).toEqual([
        'guards.d.ts', 'guards.js', 'index.d.ts', 'index.js', 'types.d.ts',
      ])
      expect(typecheckGeneratedFiles({
        files: Object.fromEntries(artifacts.map(artifact => [path.basename(artifact.filePath), artifact.content])),
        compilerOptions: { skipLibCheck: false },
      })).toEqual([])
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

  describe('Split Mode Generation (split: true)', () => {
    it('outputs individual modular files per schema in guards/ and root index.js / index.d.ts barrels', async () => {
      const outDir = await createTempDir()
      const schemaDoc = {
        $defs: {
          SurfaceBlock: {
            type: 'object',
            required: ['id', 'blockType'],
            properties: {
              id: { type: 'string' },
              blockType: { type: 'string', enum: ['header', 'canvas', 'footer'] },
            },
          },
          SurfaceParam: {
            type: 'object',
            required: ['name', 'value'],
            properties: {
              name: { type: 'string' },
              value: { type: 'string' },
            },
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        split: true,
        typeImportSpecifier: '@my-scope/surface',
        guards: [
          { name: 'isSurfaceBlock', typeName: 'SurfaceBlock', schema: '#/$defs/SurfaceBlock' },
          { name: 'isSurfaceParam', typeName: 'SurfaceParam', schema: '#/$defs/SurfaceParam' },
        ],
      })

      // Artifact check: guards/SurfaceBlock.js, guards/SurfaceBlock.d.ts, guards/SurfaceParam.js, guards/SurfaceParam.d.ts, index.js, index.d.ts
      expect(artifacts.length).toBe(6)

      const blockJs = artifacts.find(a => a.filePath.endsWith(path.join('guards', 'SurfaceBlock.js')))!
      const blockDts = artifacts.find(a => a.filePath.endsWith(path.join('guards', 'SurfaceBlock.d.ts')))!
      const paramJs = artifacts.find(a => a.filePath.endsWith(path.join('guards', 'SurfaceParam.js')))!
      const paramDts = artifacts.find(a => a.filePath.endsWith(path.join('guards', 'SurfaceParam.d.ts')))!
      const indexJs = artifacts.find(a => a.filePath === path.join(outDir, 'index.js'))!
      const indexDts = artifacts.find(a => a.filePath === path.join(outDir, 'index.d.ts'))!

      expect(blockJs).toBeDefined()
      expect(blockDts).toBeDefined()
      expect(paramJs).toBeDefined()
      expect(paramDts).toBeDefined()
      expect(indexJs).toBeDefined()
      expect(indexDts).toBeDefined()

      // Content check
      expect(blockJs.content).toContain('function isSurfaceBlock')
      expect(blockJs.content).not.toContain('function isSurfaceParam')
      expect(blockDts.content).toContain("import type { SurfaceBlock } from '@my-scope/surface';")
      expect(blockDts.content).toContain('export declare function isSurfaceBlock(data: unknown): data is SurfaceBlock;')

      expect(paramJs.content).toContain('function isSurfaceParam')
      expect(paramJs.content).not.toContain('function isSurfaceBlock')
      expect(paramDts.content).toContain("import type { SurfaceParam } from '@my-scope/surface';")
      expect(paramDts.content).toContain('export declare function isSurfaceParam(data: unknown): data is SurfaceParam;')

      expect(indexJs.content).toContain("export * from './guards/SurfaceBlock.js';")
      expect(indexJs.content).toContain("export * from './guards/SurfaceParam.js';")
      expect(indexDts.content).toContain("export * from './guards/SurfaceBlock.js';")
      expect(indexDts.content).toContain("export * from './guards/SurfaceParam.js';")

      // Direct module execution check
      const importedBlock = await import(`file://${blockJs.filePath}`)
      expect(importedBlock.isSurfaceBlock({ id: 'b1', blockType: 'canvas' })).toBe(true)
      expect(importedBlock.isSurfaceBlock({ id: 'b1', blockType: 'invalid' })).toBe(false)
      expect(importedBlock.isSurfaceBlock({ id: 'b1' })).toBe(false)

      const importedIndex = await import(`file://${indexJs.filePath}`)
      expect(importedIndex.isSurfaceBlock({ id: 'b2', blockType: 'header' })).toBe(true)
      expect(importedIndex.isSurfaceParam({ name: 'theme', value: 'dark' })).toBe(true)
      expect(importedIndex.isSurfaceParam({ name: 'theme' })).toBe(false)
    })

    it('inlines $ref sub-schemas so individual split guard files are 100% self-contained with 0 runtime dependencies', async () => {
      const outDir = await createTempDir()
      const schemaDoc = {
        $defs: {
          Address: {
            type: 'object',
            required: ['city', 'zip'],
            properties: {
              city: { type: 'string' },
              zip: { type: 'string', pattern: '^\\d{5}$' },
            },
          },
          UserProfile: {
            type: 'object',
            required: ['name', 'address'],
            properties: {
              name: { type: 'string' },
              address: { $ref: '#/$defs/Address' },
            },
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        split: true,
        guards: [
          { name: 'isUserProfile', typeName: 'UserProfile', schema: '#/$defs/UserProfile' },
        ],
      })

      const userJs = artifacts.find(a => a.filePath.endsWith(path.join('guards', 'UserProfile.js')))!
      expect(userJs).toBeDefined()

      // Verify zero external imports and zero eval
      expect(userJs.content).not.toMatch(/from\s+['"]/);
      expect(userJs.content).not.toMatch(/import\s+/);
      expect(userJs.content).not.toMatch(/\beval\s*\(/);
      expect(userJs.content).not.toMatch(/new\s+Function\s*\(/);

      // Verify execution in isolation
      const importedUser = await import(`file://${userJs.filePath}`)
      expect(importedUser.isUserProfile({ name: 'Alice', address: { city: 'Seoul', zip: '12345' } })).toBe(true)
      expect(importedUser.isUserProfile({ name: 'Alice', address: { city: 'Seoul', zip: '1234' } })).toBe(false)
      expect(importedUser.isUserProfile({ name: 'Alice', address: { city: 'Seoul' } })).toBe(false)
    })

    it('honors generateDeclarations: false in split mode', async () => {
      const outDir = await createTempDir()
      const schemaDoc = {
        $defs: {
          OptionA: { type: 'string' },
          OptionB: { type: 'number' },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        split: true,
        generateDeclarations: false,
      })

      expect(artifacts.every(a => a.kind === 'js')).toBe(true)
      expect(artifacts.some(a => a.filePath.endsWith(path.join('guards', 'OptionA.js')))).toBe(true)
      expect(artifacts.some(a => a.filePath.endsWith(path.join('guards', 'OptionB.js')))).toBe(true)
      expect(artifacts.some(a => a.filePath.endsWith('index.js'))).toBe(true)
      expect(artifacts.some(a => a.filePath.endsWith('index.d.ts'))).toBe(false)
    })
  })

  describe('Selective Filtering (schemas option)', () => {
    const multiSchemaDoc = {
      $defs: {
        SurfaceBlock: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        SurfaceParam: { type: 'object', required: ['key'], properties: { key: { type: 'string' } } },
        SurfaceEvent: { type: 'object', required: ['type'], properties: { type: { type: 'string' } } },
        UserProfile: { type: 'object', required: ['username'], properties: { username: { type: 'string' } } },
      },
    }

    it('filters by exact guard function names', async () => {
      const outDir = await createTempDir()
      const artifacts = await generateStandaloneGuards({
        schemaDocument: multiSchemaDoc,
        outDir,
        schemas: ['isSurfaceBlock', 'isSurfaceParam'],
      })

      const js = artifacts.find(a => a.filePath.endsWith('guards.js'))!.content
      expect(js).toContain('function isSurfaceBlock')
      expect(js).toContain('function isSurfaceParam')
      expect(js).not.toContain('function isSurfaceEvent')
      expect(js).not.toContain('function isUserProfile')
    })

    it('filters by exact schema type names', async () => {
      const outDir = await createTempDir()
      const artifacts = await generateStandaloneGuards({
        schemaDocument: multiSchemaDoc,
        outDir,
        schemas: ['SurfaceEvent', 'UserProfile'],
      })

      const js = artifacts.find(a => a.filePath.endsWith('guards.js'))!.content
      expect(js).toContain('function isSurfaceEvent')
      expect(js).toContain('function isUserProfile')
      expect(js).not.toContain('function isSurfaceBlock')
      expect(js).not.toContain('function isSurfaceParam')
    })

    it('filters with prefix normalization (is-prefix matching type name or vice-versa)', async () => {
      const outDir = await createTempDir()
      const artifacts = await generateStandaloneGuards({
        schemaDocument: multiSchemaDoc,
        outDir,
        schemas: ['isUserProfile'],
      })

      const dts = artifacts.find(a => a.filePath.endsWith('guards.d.ts'))!.content
      expect(dts).toContain('export declare function isUserProfile(data: unknown): data is UserProfile;')
      expect(dts).not.toContain('isSurfaceBlock')
    })

    it('combines split: true and schemas filtering', async () => {
      const outDir = await createTempDir()
      const artifacts = await generateStandaloneGuards({
        schemaDocument: multiSchemaDoc,
        outDir,
        split: true,
        schemas: ['SurfaceBlock', 'isSurfaceParam'],
      })

      expect(artifacts.some(a => a.filePath.endsWith(path.join('guards', 'SurfaceBlock.js')))).toBe(true)
      expect(artifacts.some(a => a.filePath.endsWith(path.join('guards', 'SurfaceBlock.d.ts')))).toBe(true)
      expect(artifacts.some(a => a.filePath.endsWith(path.join('guards', 'SurfaceParam.js')))).toBe(true)
      expect(artifacts.some(a => a.filePath.endsWith(path.join('guards', 'SurfaceParam.d.ts')))).toBe(true)
      expect(artifacts.some(a => a.filePath.includes('SurfaceEvent'))).toBe(false)
      expect(artifacts.some(a => a.filePath.includes('UserProfile'))).toBe(false)

      const indexJs = artifacts.find(a => a.filePath.endsWith('index.js'))!.content
      expect(indexJs).toContain("export * from './guards/SurfaceBlock.js';")
      expect(indexJs).toContain("export * from './guards/SurfaceParam.js';")
      expect(indexJs).not.toContain('SurfaceEvent')
    })

    it('returns empty array when filter matches no schemas', async () => {
      const outDir = await createTempDir()
      const artifacts = await generateStandaloneGuards({
        schemaDocument: multiSchemaDoc,
        outDir,
        schemas: ['NonExistentType', 'isMissing'],
      })

      expect(artifacts).toEqual([])
    })
  })

  describe('Zero Runtime Dependencies & Helper Inlining', () => {
    it('inlines ucs2length helper for minLength/maxLength with zero external requires', async () => {
      const outDir = await createTempDir()
      const schemaDoc = {
        $defs: {
          LimitedText: {
            type: 'object',
            required: ['title'],
            properties: {
              title: { type: 'string', minLength: 3, maxLength: 10 },
            },
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        split: true,
      })

      const js = artifacts.find(a => a.filePath.endsWith('LimitedText.js'))!.content
      expect(js).toContain('function __ucs2length')
      expect(js).not.toContain('require(')
      expect(js).not.toContain('import ')

      const mod = await import(`file://${path.join(outDir, 'guards', 'LimitedText.js')}`)
      expect(mod.isLimitedText({ title: 'hello' })).toBe(true)
      expect(mod.isLimitedText({ title: 'hi' })).toBe(false)
      expect(mod.isLimitedText({ title: 'this is way too long' })).toBe(false)
    })

    it('inlines deep equal helper for uniqueItems on object arrays with zero external requires', async () => {
      const outDir = await createTempDir()
      const schemaDoc = {
        $defs: {
          UniqueTags: {
            type: 'object',
            required: ['tags'],
            properties: {
              tags: {
                type: 'array',
                uniqueItems: true,
                items: {
                  type: 'object',
                  required: ['key', 'val'],
                  properties: {
                    key: { type: 'string' },
                    val: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        split: false,
      })

      const js = artifacts.find(a => a.filePath.endsWith('guards.js'))!.content
      expect(js).toContain('function __equal')
      expect(js).not.toContain('require(')

      const mod = await import(`file://${path.join(outDir, 'guards.js')}`)
      expect(mod.isUniqueTags({
        tags: [{ key: 'env', val: 'prod' }, { key: 'region', val: 'us-west' }],
      })).toBe(true)
      expect(mod.isUniqueTags({
        tags: [{ key: 'env', val: 'prod' }, { key: 'env', val: 'prod' }],
      })).toBe(false)
    })

    it('validates comprehensive string formats with zero external imports or requires', async () => {
      const outDir = await createTempDir()
      const schemaDoc = {
        $defs: {
          AllFormats: {
            type: 'object',
            properties: {
              endpoint: { type: 'string', format: 'uri' },
              created: { type: 'string', format: 'date-time' },
              lease: { type: 'string', format: 'duration' },
              ipv4: { type: 'string', format: 'ipv4' },
              ipv6: { type: 'string', format: 'ipv6' },
              id: { type: 'string', format: 'uuid' },
            },
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        split: true,
      })

      const js = artifacts.find(a => a.filePath.endsWith('AllFormats.js'))!.content
      expect(js).not.toContain('require(')
      expect(js).not.toContain('ajv-formats')

      const mod = await import(`file://${path.join(outDir, 'guards', 'AllFormats.js')}`)
      expect(mod.isAllFormats({
        endpoint: 'https://api.example.com/v1',
        created: '2026-09-03T12:00:00Z',
        lease: 'P1DT12H',
        ipv4: '192.168.1.1',
        ipv6: '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
        id: '123e4567-e89b-12d3-a456-426614174000',
      })).toBe(true)

      expect(mod.isAllFormats({
        endpoint: 'invalid-uri-no-scheme',
      })).toBe(false)
      expect(mod.isAllFormats({
        ipv4: '999.999.999.999',
      })).toBe(false)
    })

    it('ensures package.json with type: module is created in outDir for both split and monolithic mode', async () => {
      const splitDir = await createTempDir()
      const monoDir = await createTempDir()
      const schemaDoc = {
        $defs: {
          SimpleItem: { type: 'object', properties: { ok: { type: 'boolean' } } },
        },
      }

      await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir: splitDir,
        split: true,
      })

      const splitPkg = JSON.parse(await fs.readFile(path.join(splitDir, 'package.json'), 'utf8'))
      expect(splitPkg).toEqual({ type: 'module' })

      await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir: monoDir,
        split: false,
      })

      const monoPkg = JSON.parse(await fs.readFile(path.join(monoDir, 'package.json'), 'utf8'))
      expect(monoPkg).toEqual({ type: 'module' })
    })
  })
})
