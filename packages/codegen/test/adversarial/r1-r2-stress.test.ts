import { afterEach, describe, expect, it } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import {
  generateStandaloneGuards,
  type StandaloneGuardGeneratorOptions,
} from '../../src/index.js'
import {
  lint,
  parseLintCategories,
  ALLOWED_LINT_CATEGORIES,
} from '../../src/cli/commands/lint.js'
import {
  validate,
} from '../../src/cli/commands/validate.js'
import {
  generate,
} from '../../src/cli/commands/generate.js'
import {
  lintDocument,
} from '@oa-sdk/parser'
import {
  validateOpenApiProjection,
  isOpenApiProjectionProfile,
  OPENAPI_PROJECTION_PROFILES,
} from '@oa-sdk/openapi-projection-contract'
import { CliExitError } from '../../src/cli/lib/errors.js'

const execFileAsync = promisify(execFile)

describe('Adversarial Stress Testing: R1 & R2', () => {
  const tempDirs: string[] = []
  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
  const createTempDir = async (prefix = 'oa-adv-r1-r2-') => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
  }

  // =========================================================================
  // R1 ADVERSARIAL CHALLENGES: Standalone Guards Splitting & Filtering
  // =========================================================================
  describe('R1 Adversarial: Standalone Guards Splitting (--split)', () => {
    it('R1-ADV-1: 5-level deep cross-referencing schemas generate 100% self-contained modular files', async () => {
      const outDir = await createTempDir()
      const schemaDoc = {
        $defs: {
          LevelE: {
            type: 'object',
            required: ['leafValue'],
            properties: {
              leafValue: { type: 'string', minLength: 3 },
            },
            additionalProperties: false,
          },
          LevelD: {
            type: 'object',
            required: ['eRef', 'dValue'],
            properties: {
              eRef: { $ref: '#/$defs/LevelE' },
              dValue: { type: 'number', minimum: 0 },
            },
            additionalProperties: false,
          },
          LevelC: {
            type: 'object',
            required: ['dRefList'],
            properties: {
              dRefList: {
                type: 'array',
                items: { $ref: '#/$defs/LevelD' },
                minItems: 1,
              },
            },
            additionalProperties: false,
          },
          LevelB: {
            type: 'object',
            required: ['cRefOptional', 'status'],
            properties: {
              cRefOptional: { $ref: '#/$defs/LevelC' },
              status: { type: 'string', enum: ['active', 'inactive'] },
            },
            additionalProperties: false,
          },
          LevelA: {
            type: 'object',
            required: ['bRef', 'id'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              bRef: { $ref: '#/$defs/LevelB' },
            },
            additionalProperties: false,
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        split: true,
      })

      expect(artifacts.length).toBeGreaterThanOrEqual(10) // 5 js, 5 dts + index.js, index.d.ts

      // Verify each guard file exists
      const guardsDir = path.join(outDir, 'guards')
      const files = ['LevelA.js', 'LevelB.js', 'LevelC.js', 'LevelD.js', 'LevelE.js']
      for (const file of files) {
        expect(fsSync.existsSync(path.join(guardsDir, file))).toBe(true)
      }

      // Isolate runtime environment: ensure no eval, no Function, no external imports
      const prevEval = globalThis.eval
      const prevFunction = globalThis.Function
      try {
        // Test dynamic import of LevelA.js in isolation
        const levelAPath = path.join(guardsDir, 'LevelA.js')
        const levelAModule = await import(pathToFileURL(levelAPath).href)

        expect(typeof levelAModule.isLevelA).toBe('function')

        // Test valid deeply nested object
        const validPayload = {
          id: '123e4567-e89b-12d3-a456-426614174000',
          bRef: {
            status: 'active',
            cRefOptional: {
              dRefList: [
                {
                  dValue: 42,
                  eRef: {
                    leafValue: 'valid-leaf',
                  },
                },
              ],
            },
          },
        }
        expect(levelAModule.isLevelA(validPayload)).toBe(true)

        // Test invalid deeply nested object (leafValue too short)
        const invalidLeafPayload = {
          id: '123e4567-e89b-12d3-a456-426614174000',
          bRef: {
            status: 'active',
            cRefOptional: {
              dRefList: [
                {
                  dValue: 42,
                  eRef: {
                    leafValue: 'ab', // minLength: 3 violated
                  },
                },
              ],
            },
          },
        }
        expect(levelAModule.isLevelA(invalidLeafPayload)).toBe(false)

        // Test invalid UUID
        const invalidUuidPayload = {
          ...validPayload,
          id: 'not-a-uuid',
        }
        expect(levelAModule.isLevelA(invalidUuidPayload)).toBe(false)

        // Test dynamic import of LevelD.js directly in total isolation
        const levelDPath = path.join(guardsDir, 'LevelD.js')
        const levelDModule = await import(pathToFileURL(levelDPath).href)
        expect(levelDModule.isLevelD({ dValue: 10, eRef: { leafValue: 'hello' } })).toBe(true)
        expect(levelDModule.isLevelD({ dValue: -1, eRef: { leafValue: 'hello' } })).toBe(false)
      } finally {
        globalThis.eval = prevEval
        globalThis.Function = prevFunction
      }
    })

    it('R1-ADV-2: Recursive tree data structures (TreeNode -> children: TreeNode[]) compile and validate in split mode', async () => {
      const outDir = await createTempDir()
      const schemaDoc = {
        $id: 'urn:test:tree',
        $defs: {
          TreeNode: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string' },
              children: {
                type: 'array',
                items: { $ref: 'urn:test:tree#/$defs/TreeNode' },
              },
            },
            additionalProperties: false,
          },
        },
      }

      await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        split: true,
      })

      const treeNodeJs = path.join(outDir, 'guards', 'TreeNode.js')
      expect(fsSync.existsSync(treeNodeJs)).toBe(true)

      const mod = await import(pathToFileURL(treeNodeJs).href)
      expect(typeof mod.isTreeNode).toBe('function')

      // Leaf node
      expect(mod.isTreeNode({ name: 'root' })).toBe(true)

      // Nested tree 3 levels deep
      const nestedTree = {
        name: 'root',
        children: [
          {
            name: 'child-1',
            children: [
              { name: 'grandchild-1' },
              { name: 'grandchild-2' },
            ],
          },
          {
            name: 'child-2',
          },
        ],
      }
      expect(mod.isTreeNode(nestedTree)).toBe(true)

      // Invalid grandchild (missing name)
      const invalidTree = {
        name: 'root',
        children: [
          {
            name: 'child-1',
            children: [
              { notName: 'oops' },
            ],
          },
        ],
      }
      expect(mod.isTreeNode(invalidTree)).toBe(false)
    })

    it('R1-ADV-3: Discriminated union with internal references and polymorphic variants in split mode', async () => {
      const outDir = await createTempDir()
      const schemaDoc = {
        $defs: {
          TextCommand: {
            type: 'object',
            required: ['type', 'text'],
            properties: {
              type: { const: 'text' },
              text: { type: 'string' },
            },
            additionalProperties: false,
          },
          ImageCommand: {
            type: 'object',
            required: ['type', 'url', 'width', 'height'],
            properties: {
              type: { const: 'image' },
              url: { type: 'string', format: 'uri' },
              width: { type: 'integer', minimum: 1 },
              height: { type: 'integer', minimum: 1 },
            },
            additionalProperties: false,
          },
          CommandBatch: {
            type: 'object',
            required: ['commands'],
            properties: {
              commands: {
                type: 'array',
                items: {
                  oneOf: [
                    { $ref: '#/$defs/TextCommand' },
                    { $ref: '#/$defs/ImageCommand' },
                  ],
                },
              },
            },
            additionalProperties: false,
          },
        },
      }

      await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        split: true,
      })

      const batchJs = path.join(outDir, 'guards', 'CommandBatch.js')
      const mod = await import(pathToFileURL(batchJs).href)
      expect(typeof mod.isCommandBatch).toBe('function')

      // Valid batch with both commands
      expect(mod.isCommandBatch({
        commands: [
          { type: 'text', text: 'hello' },
          { type: 'image', url: 'https://example.com/logo.png', width: 100, height: 100 },
        ],
      })).toBe(true)

      // Invalid: missing height on image
      expect(mod.isCommandBatch({
        commands: [
          { type: 'image', url: 'https://example.com/logo.png', width: 100 },
        ],
      })).toBe(false)
    })

    it('R1-ADV-4: Special characters and identifier boundaries in type names', async () => {
      const outDir = await createTempDir()
      const schemaDoc = {
        $defs: {
          user_profile_v2: {
            type: 'object',
            required: ['user_id'],
            properties: {
              user_id: { type: 'string' },
            },
          },
          _InternalConfig: {
            type: 'object',
            required: ['debug_mode'],
            properties: {
              debug_mode: { type: 'boolean' },
            },
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        split: true,
      })

      expect(artifacts.some(a => a.filePath.endsWith('user_profile_v2.js'))).toBe(true)
      expect(artifacts.some(a => a.filePath.endsWith('_InternalConfig.js'))).toBe(true)

      const userProfileMod = await import(pathToFileURL(path.join(outDir, 'guards', 'user_profile_v2.js')).href)
      expect(userProfileMod.isuser_profile_v2({ user_id: 'abc' })).toBe(true)
      expect(userProfileMod.isuser_profile_v2({ user_id: 123 })).toBe(false)
    })

    it('R1-ADV-5: Dynamic execution in isolated clean Node subprocess with 0 runtime dependencies', async () => {
      const outDir = await createTempDir()
      const schemaDoc = {
        openapi: '3.1.0',
        info: { title: 'Cross Ref API', version: '1.0.0' },
        components: {
          schemas: {
            ParentModel: {
              type: 'object',
              required: ['child', 'label'],
              properties: {
                label: { type: 'string' },
                child: { $ref: '#/components/schemas/ChildModel' },
              },
            },
            ChildModel: {
              type: 'object',
              required: ['value'],
              properties: {
                value: { type: 'number', minimum: 10 },
              },
            },
          },
        },
      }

      await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        split: true,
      })

      const parentJs = path.join(outDir, 'guards', 'ParentModel.js')
      const childJs = path.join(outDir, 'guards', 'ChildModel.js')
      const indexJs = path.join(outDir, 'index.js')

      // Execute a standalone Node script in a separate OS process
      const scriptCode = `
        import { isParentModel } from '${pathToFileURL(parentJs).href}';
        import { isChildModel } from '${pathToFileURL(childJs).href}';
        import * as Barrel from '${pathToFileURL(indexJs).href}';

        // 1. Direct Parent Model invocation
        if (!isParentModel({ label: 'test', child: { value: 15 } })) {
          process.exit(10);
        }
        if (isParentModel({ label: 'test', child: { value: 5 } })) {
          process.exit(11);
        }

        // 2. Direct Child Model invocation
        if (!isChildModel({ value: 100 })) {
          process.exit(20);
        }
        if (isChildModel({ value: 'string' })) {
          process.exit(21);
        }

        // 3. Barrel re-export invocation
        if (!Barrel.isParentModel({ label: 'from barrel', child: { value: 20 } })) {
          process.exit(30);
        }

        process.stdout.write('SUCCESS');
      `

      const runnerScript = path.join(outDir, 'runner.mjs')
      await fs.writeFile(runnerScript, scriptCode, 'utf8')

      const { stdout } = await execFileAsync(process.execPath, [runnerScript])
      expect(stdout).toBe('SUCCESS')
    })
  })

  describe('R1 Adversarial: Selective Filtering (--schemas)', () => {
    it('R1-ADV-6: Fuzzy, mixed-case, whitespace-padded, and prefix variations with --schemas', async () => {
      const outDir = await createTempDir()
      const schemaDoc = {
        $defs: {
          SurfaceBlock: { type: 'object', properties: { id: { type: 'string' } } },
          SurfaceParam: { type: 'object', properties: { key: { type: 'string' } } },
          DataPipeline: { type: 'object', properties: { flow: { type: 'string' } } },
          ConfigManifest: { type: 'object', properties: { ver: { type: 'number' } } },
        },
      }

      // Comma-separated with arbitrary spaces, mix of "is" prefix and non-"is", mixed case
      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        split: true,
        schemas: ['  surfaceblock  ', 'isSurfaceParam', '   '],
      })

      const jsFiles = artifacts.filter(a => a.kind === 'js' && !a.filePath.endsWith('index.js'))
      expect(jsFiles.length).toBe(2)
      expect(jsFiles.some(a => a.filePath.endsWith('SurfaceBlock.js'))).toBe(true)
      expect(jsFiles.some(a => a.filePath.endsWith('SurfaceParam.js'))).toBe(true)
      expect(jsFiles.some(a => a.filePath.endsWith('DataPipeline.js'))).toBe(false)
      expect(jsFiles.some(a => a.filePath.endsWith('ConfigManifest.js'))).toBe(false)

      // Verify generated index.js re-exports only the filtered schemas
      const indexJs = await fs.readFile(path.join(outDir, 'index.js'), 'utf8')
      expect(indexJs).toContain("export * from './guards/SurfaceBlock.js';")
      expect(indexJs).toContain("export * from './guards/SurfaceParam.js';")
      expect(indexJs).not.toContain('DataPipeline')
      expect(indexJs).not.toContain('ConfigManifest')
    })

    it('R1-ADV-7: Schema filter matching 0 items returns clean empty array without crashing', async () => {
      const outDir = await createTempDir()
      const schemaDoc = {
        $defs: {
          ExistingA: { type: 'string' },
          ExistingB: { type: 'number' },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        split: true,
        schemas: ['CompletelyUnknownSchema', 'AnotherPhantom'],
      })

      expect(artifacts).toEqual([])
      // Ensure guards directory was not created or no orphan files
      expect(fsSync.existsSync(path.join(outDir, 'guards'))).toBe(false)
    })

    it('R1-ADV-8: CLI generate command with --split and --schemas options end-to-end', async () => {
      const tempDir = await createTempDir()
      const specPath = path.join(tempDir, 'spec.yaml')
      const outDir = path.join(tempDir, 'dist-guards')

      await fs.writeFile(
        specPath,
        `
openapi: 3.1.0
info:
  title: Multi Schema Test
  version: 1.0.0
paths: {}
components:
  schemas:
    AlphaItem:
      type: object
      properties:
        id:
          type: string
    BetaItem:
      type: object
      properties:
        count:
          type: integer
    GammaItem:
      type: object
      properties:
        flag:
          type: boolean
`,
        'utf8',
      )

      await generate.run({
        target: 'standalone-guards',
        input: specPath,
        'out-dir': outDir,
        split: true,
        schemas: 'isAlphaItem, BetaItem',
      })

      expect(fsSync.existsSync(path.join(outDir, 'guards', 'AlphaItem.js'))).toBe(true)
      expect(fsSync.existsSync(path.join(outDir, 'guards', 'BetaItem.js'))).toBe(true)
      expect(fsSync.existsSync(path.join(outDir, 'guards', 'GammaItem.js'))).toBe(false)
      expect(fsSync.existsSync(path.join(outDir, 'index.js'))).toBe(true)
    })
  })

  // =========================================================================
  // R2 ADVERSARIAL CHALLENGES: CLI Category-Aware Linting & Profile Validation
  // =========================================================================
  describe('R2 Adversarial: Category-Aware Linting (--categories)', () => {
    it('R2-ADV-1: parseLintCategories robustly handles irregular whitespace, empty tokens, and rejects invalid categories', () => {
      // Valid combinations with weird whitespaces
      expect(parseLintCategories('surface, operations , parameters')).toEqual([
        'surface',
        'operations',
        'parameters',
      ])

      expect(parseLintCategories(['surface,style', 'components'])).toEqual([
        'surface',
        'style',
        'components',
      ])

      // All 8 categories
      expect(parseLintCategories('structure,operations,parameters,refs,security,style,components,surface')).toEqual([
        ...ALLOWED_LINT_CATEGORIES,
      ])

      // Empty string -> throws
      expect(() => parseLintCategories('')).toThrow(/하나 이상의 유효한 카테고리를 지정해야 합니다/)
      expect(() => parseLintCategories('   ')).toThrow(/하나 이상의 유효한 카테고리를 지정해야 합니다/)
      expect(() => parseLintCategories(',,, , ')).toThrow(/하나 이상의 유효한 카테고리를 지정해야 합니다/)

      // Invalid category name -> throws with list of allowed
      expect(() => parseLintCategories('unknown_cat')).toThrow(/--categories 값은/)
      expect(() => parseLintCategories('surface, fakeCategory')).toThrow(/--categories 값은.*fakeCategory/)
    })

    it('R2-ADV-2: lintDocument strictly isolates categories and suppresses unselected category violations across multiple categories', () => {
      // Construct a document with intentional errors across 5 different categories
      const dirtyDoc = {
        openapi: '3.2.0',
        // Missing info.title and info.version -> structure errors
        info: {},
        paths: {
          '/test/{param}': {
            get: {
              // Missing parameter definition -> parameters error
              // Missing responses -> operations error
            },
          },
        },
        components: {
          schemas: {
            BadSurfaceModel: {
              type: 'object',
              'x-surface-anchor': {
                id: 'bad-anchor',
                line: -5,
                column: 1,
              },
            },
            UnusedModel: {
              type: 'string', // components/unused-schema
            },
          },
          securitySchemes: {
            BadAuth: {
              type: 'apiKey',
              // missing name and in -> security error
            },
          },
        },
      }

      // 1. Surface only
      const surfaceResults = lintDocument(dirtyDoc, { categories: ['surface'] })
      expect(surfaceResults.length).toBeGreaterThan(0)
      expect(surfaceResults.every(r => r.rule.startsWith('surface/'))).toBe(true)

      // 2. Operations only
      const operationsResults = lintDocument(dirtyDoc, { categories: ['operations'] })
      expect(operationsResults.length).toBeGreaterThan(0)
      expect(operationsResults.every(r => r.rule.startsWith('operations/'))).toBe(true)

      // 3. Structure only
      const structureResults = lintDocument(dirtyDoc, { categories: ['structure'] })
      expect(structureResults.length).toBeGreaterThan(0)
      expect(structureResults.every(r => r.rule.startsWith('structure/'))).toBe(true)

      // 4. Combined categories (parameters + surface)
      const combinedResults = lintDocument(dirtyDoc, { categories: ['parameters', 'surface'] })
      expect(combinedResults.some(r => r.rule.startsWith('parameters/'))).toBe(true)
      expect(combinedResults.some(r => r.rule.startsWith('surface/'))).toBe(true)
      expect(combinedResults.some(r => r.rule.startsWith('structure/'))).toBe(false)
      expect(combinedResults.some(r => r.rule.startsWith('operations/'))).toBe(false)
    })

    it('R2-ADV-3: CLI lint command exits cleanly when category filters suppress non-matching errors', async () => {
      const tempDir = await createTempDir()
      // Spec has ONLY structure errors (missing info.title), but clean surface schemas
      const specPath = path.join(tempDir, 'spec.json')
      await fs.writeFile(
        specPath,
        JSON.stringify({
          openapi: '3.2.0',
          info: { version: '1.0.0' }, // missing title -> structure error
          paths: {},
          components: {
            schemas: {
              ValidBlock: {
                type: 'object',
                'x-surface-anchor': { id: 'block-anchor', line: 10, column: 5 },
                properties: { id: { type: 'string' } },
              },
            },
          },
        }),
        'utf8',
      )

      // Running with --categories surface must NOT fail because surface has 0 errors
      let errorThrown = false
      try {
        await lint.run({ spec: specPath, categories: 'surface' })
      } catch {
        errorThrown = true
      }
      expect(errorThrown).toBe(false)

      // Running without category filter or with structure category must throw CliExitError(1)
      let structureErrorThrown = false
      try {
        await lint.run({ spec: specPath, categories: 'structure' })
      } catch (err) {
        structureErrorThrown = true
        expect(err).toBeInstanceOf(CliExitError)
      }
      expect(structureErrorThrown).toBe(true)
    })
  })

  describe('R2 Adversarial: Profile-Aware Validation (--profile)', () => {
    it('R2-ADV-4: component-bundle profile invariants under edge cases', () => {
      // 1. Completely absent paths with valid schemas -> VALID
      const res1 = validateOpenApiProjection({
        profile: 'component-bundle',
        projection: {
          openapi: '3.1.0',
          info: { title: 'Bundle', version: '1.0.0' },
          components: {
            schemas: {
              Item: { type: 'string' },
            },
          },
        },
        refs: [],
        diagnostics: [],
        sources: {},
        versionHash: 'hash-1',
      })
      expect(res1.valid).toBe(true)

      // 2. Empty paths object -> VALID
      const res2 = validateOpenApiProjection({
        profile: 'component-bundle',
        projection: {
          openapi: '3.1.0',
          info: { title: 'Bundle', version: '1.0.0' },
          paths: {},
          components: {
            schemas: {
              Item: { type: 'string' },
            },
          },
        },
        refs: [],
        diagnostics: [],
        sources: {},
        versionHash: 'hash-2',
      })
      expect(res2.valid).toBe(true)

      // 3. Absent components.schemas -> INVALID
      const res3 = validateOpenApiProjection({
        profile: 'component-bundle',
        projection: {
          openapi: '3.1.0',
          info: { title: 'Bundle', version: '1.0.0' },
          paths: {},
        },
        refs: [],
        diagnostics: [],
        sources: {},
        versionHash: 'hash-3',
      })
      expect(res3.valid).toBe(false)
      expect(res3.diagnostics.some(d => d.code === 'openapi-projection/profile-requirement')).toBe(true)

      // 4. Empty components.schemas object -> INVALID
      const res4 = validateOpenApiProjection({
        profile: 'component-bundle',
        projection: {
          openapi: '3.1.0',
          info: { title: 'Bundle', version: '1.0.0' },
          components: { schemas: {} },
        },
        refs: [],
        diagnostics: [],
        sources: {},
        versionHash: 'hash-4',
      })
      expect(res4.valid).toBe(false)
      expect(res4.diagnostics.some(d => d.code === 'openapi-projection/profile-requirement')).toBe(true)
    })

    it('R2-ADV-5: operation-contract profile invariants under edge cases (parameters-only, non-standard methods, empty paths)', () => {
      // 1. Empty paths -> INVALID
      const res1 = validateOpenApiProjection({
        profile: 'operation-contract',
        projection: {
          openapi: '3.1.0',
          info: { title: 'API', version: '1.0.0' },
          paths: {},
        },
        refs: [],
        diagnostics: [],
        sources: {},
        versionHash: 'hash-op-1',
      })
      expect(res1.valid).toBe(false)
      expect(res1.diagnostics.some(d => d.code === 'openapi-projection/profile-requirement')).toBe(true)

      // 2. Path item with ONLY parameters (no HTTP method operations) -> INVALID
      const res2 = validateOpenApiProjection({
        profile: 'operation-contract',
        projection: {
          openapi: '3.1.0',
          info: { title: 'API', version: '1.0.0' },
          paths: {
            '/items/{id}': {
              summary: 'Path item level summary only',
              parameters: [
                { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
              ],
            },
          },
        },
        refs: [],
        diagnostics: [],
        sources: {},
        versionHash: 'hash-op-2',
      })
      expect(res2.valid).toBe(false)
      expect(res2.diagnostics.some(d => d.code === 'openapi-projection/profile-requirement')).toBe(true)

      // 3. Path item with OAS 3.2 'query' method with responses -> VALID
      const res3 = validateOpenApiProjection({
        profile: 'operation-contract',
        projection: {
          openapi: '3.2.0',
          info: { title: 'Search API', version: '1.0.0' },
          paths: {
            '/search': {
              query: {
                summary: 'Complex Query operation',
                responses: {
                  '200': { description: 'Results' },
                },
              },
            },
          },
        },
        refs: [],
        diagnostics: [],
        sources: {},
        versionHash: 'hash-op-3',
      })
      expect(res3.valid).toBe(true)

      // 4. Path item key missing leading slash -> INVALID
      const res4 = validateOpenApiProjection({
        profile: 'operation-contract',
        projection: {
          openapi: '3.1.0',
          info: { title: 'API', version: '1.0.0' },
          paths: {
            'items': {
              get: {
                responses: { '200': { description: 'ok' } },
              },
            },
          },
        },
        refs: [],
        diagnostics: [],
        sources: {},
        versionHash: 'hash-op-4',
      })
      expect(res4.valid).toBe(false)
      expect(res4.diagnostics.some(d => d.message.includes('must start with "/"'))).toBe(true)
    })

    it('R2-ADV-6: full-api-document profile invariants under edge cases', () => {
      // 1. Valid full document -> VALID
      const res1 = validateOpenApiProjection({
        profile: 'full-api-document',
        projection: {
          openapi: '3.1.0',
          info: { title: 'Full API', version: '1.0.0' },
          paths: {
            '/health': {
              get: {
                responses: { '200': { description: 'healthy' } },
              },
            },
          },
        },
        refs: [],
        diagnostics: [],
        sources: {},
        versionHash: 'full-1',
      })
      expect(res1.valid).toBe(true)

      // 2. Missing info object -> INVALID
      const res2 = validateOpenApiProjection({
        profile: 'full-api-document',
        projection: {
          openapi: '3.1.0',
          paths: {},
        },
        refs: [],
        diagnostics: [],
        sources: {},
        versionHash: 'full-2',
      })
      expect(res2.valid).toBe(false)
      expect(res2.diagnostics.some(d => d.message.includes('must declare an info object'))).toBe(true)

      // 3. Missing paths object -> INVALID
      const res3 = validateOpenApiProjection({
        profile: 'full-api-document',
        projection: {
          openapi: '3.1.0',
          info: { title: 'No Paths API', version: '1.0.0' },
        },
        refs: [],
        diagnostics: [],
        sources: {},
        versionHash: 'full-3',
      })
      expect(res3.valid).toBe(false)
      expect(res3.diagnostics.some(d => d.message.includes('must declare a paths object'))).toBe(true)
    })

    it('R2-ADV-7: CLI validate command integrates with profile flags', async () => {
      const tempDir = await createTempDir()
      const specPath = path.join(tempDir, 'spec.json')

      // Component bundle spec (empty paths, valid schema)
      await fs.writeFile(
        specPath,
        JSON.stringify({
          openapi: '3.1.0',
          info: { title: 'Schema Bundle', version: '1.0.0' },
          paths: {},
          components: {
            schemas: {
              Widget: { type: 'object', properties: { id: { type: 'string' } } },
            },
          },
        }),
        'utf8',
      )

      // 1. validate with --profile component-bundle -> PASS
      let bundleError = false
      try {
        await validate.run({ spec: specPath, profile: 'component-bundle' })
      } catch {
        bundleError = true
      }
      expect(bundleError).toBe(false)

      // 2. validate with --profile operation-contract on component bundle -> FAIL
      let opContractError = false
      try {
        await validate.run({ spec: specPath, profile: 'operation-contract' })
      } catch (err) {
        opContractError = true
        expect(err).toBeInstanceOf(CliExitError)
      }
      expect(opContractError).toBe(true)

      // 3. validate with invalid profile name -> throws error
      await expect(
        validate.run({ spec: specPath, profile: 'invalid-profile-name' }),
      ).rejects.toThrow(/--profile 값은.*중 하나여야 합니다/)
    })
  })
})
