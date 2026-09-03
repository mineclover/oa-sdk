/**
 * packages/codegen/src/__tests__/challenger-m5-adversarial-hardening.test.ts
 *
 * Tier 5 Adversarial Coverage Hardening Suite (Challenger 2):
 *
 * 1. Root discovery & submodule invariant across weird directory names and deep relative paths.
 * 2. Declarative config loading with unusual file encodings, non-standard exports, and schema mutations.
 * 3. Breaking diff engine circular refs, anyOf/oneOf polymorphs, and missing components.
 * 4. Manifest V3 CSP audit scanner against obfuscated eval/Function and complex import patterns.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as os from 'node:os'
import {
  findProjectRoot,
  findProjectRootDetail,
  type FindProjectRootOptions,
} from '@oa-sdk/core'
import {
  defineConfig,
  validateOaConfig,
  assertOaConfig,
  OaConfigError,
  type OaConfig,
} from '../config.js'
import {
  loadOaConfig,
  findConfigFile,
  resolveProfileTarget,
  resolveGuardTarget,
} from '../cli/lib/config-loader.js'
import {
  diffEndpoints,
  diffComponentSchemas,
  classifyBreakingChanges,
  classifyNonBreakingChanges,
  hasBreakingChanges,
  extractEndpoints,
  type DiffResult,
} from '../cli/lib/openapi-breaking-diff.js'
import {
  auditCspSource,
  auditCspSourceSync,
  getTs,
} from '../cli/commands/audit-csp.js'
import { runOaCli } from './e2e/helpers/cli-runner.js'
import { createWorkspaceFixture, type WorkspaceFixture } from './e2e/helpers/fixture-builder.js'

describe('Tier 5 Adversarial Coverage Hardening (M5 Challenger 2)', () => {
  let fixture: WorkspaceFixture
  let tempDirs: string[] = []

  const createTempDir = async (prefix = 'oa-adv-m5-') => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
  }

  beforeEach(async () => {
    fixture = await createWorkspaceFixture({}, 'oa-m5-challenger-')
  })

  afterEach(async () => {
    if (fixture) {
      await fixture.cleanup()
    }
    for (const dir of tempDirs) {
      try {
        await fs.rm(dir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
    tempDirs = []
  })

  // =========================================================================
  // SECTION 1: ROOT DISCOVERY & SUBMODULE INVARIANT ACROSS WEIRD DIRS & PATHS
  // =========================================================================
  describe('Area 1: Root Discovery & Submodule Invariant Across Weird Directory Names & Deep Paths', () => {
    it('resolves project root correctly across weird directory names (spaces, unicode, emojis, brackets)', async () => {
      const baseTemp = await createTempDir('oa-weird-names-')
      const weirdDirName = '📦 workspace with spaces & special (chars) [v1.0] #tag'
      const weirdRootDir = path.join(baseTemp, weirdDirName)
      const nestedSub = path.join(weirdRootDir, 'packages', 'deeply @scoped', 'sub module')

      await fs.mkdir(nestedSub, { recursive: true })
      await fs.writeFile(path.join(weirdRootDir, 'oa.config.ts'), 'export default { rootDir: ".", specs: [] }', 'utf8')

      // Discovery from deeply nested weirdly named directory
      const detail = findProjectRootDetail({ cwd: nestedSub })
      expect(detail.root).toBe(weirdRootDir)
      expect(detail.tier).toBe(3)
      expect(detail.reason).toBe('config')
      expect(detail.matchedMarker).toBe('oa.config.ts')

      // findProjectRoot returns identical normalized root
      expect(findProjectRoot(nestedSub)).toBe(weirdRootDir)
    })

    it('enforces Submodule Invariant across deep relative path (12 levels) traversing past nested submodule git and workspace', async () => {
      const baseTemp = await createTempDir('oa-deep-submodule-')
      // Structure:
      // level0 (repo root with oa.config.ts)
      //   -> l1/l2/l3/l4/l5/l6 (submodule root with .git marker file and pnpm-workspace.yaml)
      //     -> l7/l8/l9/l10/l11/l12 (deep invocation directory)
      const level0 = baseTemp
      await fs.writeFile(path.join(level0, 'oa.config.ts'), 'export default { rootDir: ".", specs: [] };', 'utf8')

      const level6 = path.join(level0, 'l1', 'l2', 'l3', 'l4', 'l5', 'l6')
      await fs.mkdir(level6, { recursive: true })
      // Submodule git marker (submodules use a .git file pointing to gitdir)
      await fs.writeFile(path.join(level6, '.git'), 'gitdir: ../../.git/modules/submodule\n', 'utf8')
      // Submodule workspace marker
      await fs.writeFile(path.join(level6, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n', 'utf8')

      const level12 = path.join(level6, 'l7', 'l8', 'l9', 'l10', 'l11', 'l12')
      await fs.mkdir(level12, { recursive: true })

      // Invoked from level12: Submodule Invariant states config (tier 3) across entire ancestor
      // hierarchy takes precedence over nested submodule workspace (tier 4) and git (tier 5)
      const detail = findProjectRootDetail({ cwd: level12 })
      expect(detail.root).toBe(level0)
      expect(detail.tier).toBe(3)
      expect(detail.reason).toBe('config')
      expect(detail.matchedMarker).toBe('oa.config.ts')

      // Now if the submodule at level6 defines its OWN oa.config.json,
      // then nearest config candidate stops traversal at level6 (Rule 3)
      await fs.writeFile(path.join(level6, 'oa.config.json'), '{"rootDir": ".", "specs": []}', 'utf8')
      const subDetail = findProjectRootDetail({ cwd: level12 })
      expect(subDetail.root).toBe(level6)
      expect(subDetail.tier).toBe(3)
      expect(subDetail.reason).toBe('config')
      expect(subDetail.matchedMarker).toBe('oa.config.json')
    })

    it('resolves relative explicitRoot and file-targeted explicitRoot correctly', async () => {
      const baseTemp = await createTempDir('oa-explicit-root-')
      const repoRoot = path.join(baseTemp, 'my-repo')
      const subDir = path.join(repoRoot, 'packages', 'client')
      await fs.mkdir(subDir, { recursive: true })

      const configFile = path.join(repoRoot, 'oa.config.ts')
      await fs.writeFile(configFile, 'export default { rootDir: ".", specs: [] };', 'utf8')

      // 1. Relative path to explicit root from subDir
      const detailRel = findProjectRootDetail({ cwd: subDir, explicitRoot: '../..' })
      expect(detailRel.root).toBe(repoRoot)
      expect(detailRel.tier).toBe(1)
      expect(detailRel.reason).toBe('explicit')

      // 2. ExplicitRoot pointing to config file directly
      const detailFile = findProjectRootDetail({ cwd: subDir, explicitRoot: '../../oa.config.ts' })
      expect(detailFile.root).toBe(repoRoot)
      expect(detailFile.tier).toBe(1)
      expect(detailFile.reason).toBe('explicit')
      expect(detailFile.matchedMarker).toBe('oa.config.ts')
    })

    it('resolves OA_PROJECT_ROOT pointing to relative directory or explicit file', async () => {
      const baseTemp = await createTempDir('oa-env-root-')
      const repoRoot = path.join(baseTemp, 'env-repo')
      const subDir = path.join(repoRoot, 'apps', 'web')
      await fs.mkdir(subDir, { recursive: true })
      const configFile = path.join(repoRoot, 'oa.config.mjs')
      await fs.writeFile(configFile, 'export default { rootDir: ".", specs: [] };', 'utf8')

      // Relative env var pointing to directory
      const originalEnv = process.env.OA_PROJECT_ROOT
      try {
        process.env.OA_PROJECT_ROOT = '../..'
        const detailRel = findProjectRootDetail({ cwd: subDir })
        expect(detailRel.root).toBe(repoRoot)
        expect(detailRel.tier).toBe(2)
        expect(detailRel.reason).toBe('env')

        // Env var pointing to explicit config file
        process.env.OA_PROJECT_ROOT = '../../oa.config.mjs'
        const detailFile = findProjectRootDetail({ cwd: subDir })
        expect(detailFile.root).toBe(repoRoot)
        expect(detailFile.tier).toBe(2)
        expect(detailFile.reason).toBe('env')
        expect(detailFile.matchedMarker).toBe('oa.config.mjs')
      } finally {
        if (originalEnv !== undefined) {
          process.env.OA_PROJECT_ROOT = originalEnv
        } else {
          delete process.env.OA_PROJECT_ROOT
        }
      }
    })
  })

  // =========================================================================
  // SECTION 2: DECLARATIVE CONFIG ENCODINGS, NON-STANDARD EXPORTS & MUTATIONS
  // =========================================================================
  describe('Area 2: Declarative Config Loading with Unusual Encodings, Non-Standard Exports & Mutations', () => {
    it('correctly loads and preserves non-ASCII Unicode characters in spec metadata', async () => {
      const baseTemp = await createTempDir('oa-unicode-config-')
      const configPath = path.join(baseTemp, 'oa.config.ts')
      const configContent = `
        import { defineConfig } from '${path.resolve(__dirname, '../config.js')}';
        export default defineConfig({
          rootDir: '.',
          specs: [
            {
              id: '한국어-도메인-1',
              profile: 'component-bundle',
              schemaEntry: './schemas/korean.ts',
              outDir: './dist/명세서',
              title: '한국어 API 명세서 🚀',
              version: 'v1.0.0-알파.1'
            }
          ]
        });
      `
      await fs.writeFile(configPath, configContent, 'utf8')
      const loaded = await loadOaConfig({ configPath, cwd: baseTemp })
      expect(loaded).not.toBeNull()
      expect(loaded?.specs?.[0]?.id).toBe('한국어-도메인-1')
      expect(loaded?.specs?.[0]?.title).toBe('한국어 API 명세서 🚀')
      expect(loaded?.specs?.[0]?.version).toBe('v1.0.0-알파.1')
      expect(loaded?.specs?.[0]?.outDir).toBe('./dist/명세서')

      // Path resolution with Unicode
      const resolved = resolveProfileTarget(loaded!.specs![0]!, loaded!.rootDir)
      expect(resolved.resolvedOutDir).toBe(path.resolve(baseTemp, './dist/명세서'))
    })

    it('supports non-standard export patterns: function config, async function config, and named config export', async () => {
      const baseTemp = await createTempDir('oa-fn-config-')

      // 1. Sync function export
      const syncFnPath = path.join(baseTemp, 'oa.config.sync-fn.mjs')
      await fs.writeFile(
        syncFnPath,
        `export default () => ({
          rootDir: './sub-root',
          specs: [{ id: 'fn-sync', profile: 'component-bundle', schemaEntry: './s.ts', outDir: './out' }]
        });`,
        'utf8'
      )
      const loadedSync = await loadOaConfig({ configPath: syncFnPath })
      expect(loadedSync?.specs?.[0]?.id).toBe('fn-sync')
      expect(loadedSync?.rootDir).toBe(path.resolve(baseTemp, './sub-root'))

      // 2. Async function export
      const asyncFnPath = path.join(baseTemp, 'oa.config.async-fn.mjs')
      await fs.writeFile(
        asyncFnPath,
        `export default async () => {
          await new Promise(r => setTimeout(r, 10));
          return {
            rootDir: '.',
            specs: [{ id: 'fn-async', profile: 'operation-contract', schemaEntry: './s.ts', outDir: './out' }]
          };
        };`,
        'utf8'
      )
      const loadedAsync = await loadOaConfig({ configPath: asyncFnPath })
      expect(loadedAsync?.specs?.[0]?.id).toBe('fn-async')
      expect(loadedAsync?.specs?.[0]?.profile).toBe('operation-contract')

      // 3. Named export: export const config = { ... }
      const namedPath = path.join(baseTemp, 'oa.config.named.mjs')
      await fs.writeFile(
        namedPath,
        `export const config = {
          rootDir: '.',
          specs: [{ id: 'named-target', profile: 'full-api-document', schemaEntry: './s.ts', outDir: './out' }]
        };`,
        'utf8'
      )
      const loadedNamed = await loadOaConfig({ configPath: namedPath })
      expect(loadedNamed?.specs?.[0]?.id).toBe('named-target')
    })

    it('empirically reveals in-place mutation vulnerability when config object is frozen (Object.freeze)', async () => {
      const baseTemp = await createTempDir('oa-frozen-config-')
      const frozenPath = path.join(baseTemp, 'oa.config.frozen.mjs')
      await fs.writeFile(
        frozenPath,
        `export default Object.freeze({
          rootDir: '.',
          specs: Object.freeze([
            Object.freeze({ id: 'frozen-spec', profile: 'component-bundle', schemaEntry: './s.ts', outDir: './out' })
          ])
        });`,
        'utf8'
      )
      // loadOaConfig attempts direct assignment to config.rootDir, throwing TypeError on frozen objects
      await expect(loadOaConfig({ configPath: frozenPath })).rejects.toThrow(
        /Cannot assign to read only property 'rootDir'/
      )
    })

    it('adversarially rejects malformed, mutated, or primitive config exports', async () => {
      const baseTemp = await createTempDir('oa-bad-config-')

      // 1. Primitive null
      const nullPath = path.join(baseTemp, 'null.mjs')
      await fs.writeFile(nullPath, 'export default null;', 'utf8')
      await expect(loadOaConfig({ configPath: nullPath })).rejects.toThrow(/must be an object, but received null/)

      // 2. Primitive array
      const arrPath = path.join(baseTemp, 'arr.mjs')
      await fs.writeFile(arrPath, 'export default [1, 2, 3];', 'utf8')
      await expect(loadOaConfig({ configPath: arrPath })).rejects.toThrow(/must be an object, but received array/)

      // 3. Primitive number
      const numPath = path.join(baseTemp, 'num.mjs')
      await fs.writeFile(numPath, 'export default 42;', 'utf8')
      await expect(loadOaConfig({ configPath: numPath })).rejects.toThrow(/must be an object, but received number/)

      // 4. Schema mutation: duplicate target IDs
      expect(() => {
        assertOaConfig({
          rootDir: '.',
          specs: [
            { id: 'duplicate-id', profile: 'component-bundle', schemaEntry: './a.ts', outDir: './out' },
            { id: 'duplicate-id', profile: 'operation-contract', schemaEntry: './b.ts', outDir: './out' },
          ],
        })
      }).toThrow(/Duplicate spec target id/)

      // 5. Schema mutation: invalid profile name
      expect(() => {
        assertOaConfig({
          rootDir: '.',
          specs: [
            { id: 'bad-profile', profile: 'unsupported-profile' as any, schemaEntry: './a.ts', outDir: './out' },
          ],
        })
      }).toThrow(/profile is required and must be one of/)

      // 6. Schema mutation: missing required fields
      expect(() => {
        assertOaConfig({
          rootDir: '.',
          specs: [
            { id: '', profile: 'component-bundle', schemaEntry: './a.ts', outDir: './out' },
          ],
        })
      }).toThrow(/Target id is required and must be a non-empty string/)

      // 7. Guards mutation: invalid moduleFormat
      expect(() => {
        assertOaConfig({
          rootDir: '.',
          guards: {
            outDir: './guards',
            moduleFormat: 'umd' as any,
          },
        })
      }).toThrow(/guards\.moduleFormat.*esm.*cjs/)
    })
  })

  // =========================================================================
  // SECTION 3: BREAKING DIFF ENGINE CIRCULAR REFS, POLYMORPHS & MISSING COMPS
  // =========================================================================
  describe('Area 3: Breaking Diff Engine Circular Refs, AnyOf/OneOf Polymorphs & Missing Components', () => {
    it('handles self-referencing and mutual circular schema references without infinite recursion', () => {
      // 1. Self-referencing schema (e.g. linked list / AST node)
      const baseSelfRefDoc = {
        openapi: '3.1.0',
        info: { title: 'Self Ref Test', version: '1.0.0' },
        paths: {
          '/tree': {
            get: {
              operationId: 'getTree',
              responses: {
                '200': {
                  description: 'Tree root',
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/TreeNode' },
                    },
                  },
                },
              },
            },
          },
        },
        components: {
          schemas: {
            TreeNode: {
              type: 'object',
              required: ['id'],
              properties: {
                id: { type: 'string' },
                children: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/TreeNode' },
                },
              },
            },
          },
        },
      }

      // Identical self-referencing schemas must produce 0 breaking changes and terminate cleanly
      const diffIdentical = diffEndpoints(baseSelfRefDoc, baseSelfRefDoc, { includeComponentSchemas: true })
      expect(hasBreakingChanges(diffIdentical)).toBe(false)
      expect(classifyBreakingChanges(diffIdentical)).toHaveLength(0)

      // 2. Modifying circular schema: adding required property to TreeNode (Breaking change)
      const headSelfRefDoc = {
        ...baseSelfRefDoc,
        components: {
          schemas: {
            TreeNode: {
              type: 'object',
              required: ['id', 'label'],
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
                children: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/TreeNode' },
                },
              },
            },
          },
        },
      }

      const diffModified = diffEndpoints(baseSelfRefDoc, headSelfRefDoc, { includeComponentSchemas: true })
      expect(hasBreakingChanges(diffModified)).toBe(true)
      const breaking = classifyBreakingChanges(diffModified)
      expect(breaking.length).toBeGreaterThan(0)
      expect(breaking.some(b => b.code === 'required-field-added' || b.code === 'response-schema-changed')).toBe(true)

      // 3. Mutual circular reference (Ping -> Pong -> Ping)
      const mutualDoc = {
        openapi: '3.1.0',
        info: { title: 'Mutual Ref Test', version: '1.0.0' },
        paths: {
          '/ping': {
            post: {
              operationId: 'ping',
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Ping' },
                  },
                },
              },
              responses: { '200': { description: 'OK' } },
            },
          },
        },
        components: {
          schemas: {
            Ping: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                pong: { $ref: '#/components/schemas/Pong' },
              },
            },
            Pong: {
              type: 'object',
              properties: {
                value: { type: 'number' },
                ping: { $ref: '#/components/schemas/Ping' },
              },
            },
          },
        },
      }

      const mutualDiff = diffEndpoints(mutualDoc, mutualDoc, { includeComponentSchemas: true })
      expect(hasBreakingChanges(mutualDiff)).toBe(false)
      expect(classifyBreakingChanges(mutualDiff)).toHaveLength(0)
    })

    it('treats order permutations of anyOf and oneOf polymorphs as invariant (non-breaking)', () => {
      const baseDoc = {
        openapi: '3.1.0',
        info: { title: 'Polymorph Test', version: '1.0.0' },
        paths: {
          '/payload': {
            post: {
              operationId: 'sendPayload',
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      oneOf: [
                        { type: 'string', minLength: 1 },
                        { type: 'number', minimum: 0 },
                        { type: 'boolean' },
                      ],
                    },
                  },
                },
              },
              responses: {
                '200': {
                  description: 'Polymorphic response',
                  content: {
                    'application/json': {
                      schema: {
                        anyOf: [
                          { type: 'object', properties: { kind: { type: 'string' } } },
                          { type: 'array', items: { type: 'string' } },
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }

      // Permuted order: [boolean, string, number] in oneOf, and [array, object] in anyOf
      const headDoc = {
        openapi: '3.1.0',
        info: { title: 'Polymorph Test', version: '1.0.0' },
        paths: {
          '/payload': {
            post: {
              operationId: 'sendPayload',
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      oneOf: [
                        { type: 'boolean' },
                        { type: 'string', minLength: 1 },
                        { type: 'number', minimum: 0 },
                      ],
                    },
                  },
                },
              },
              responses: {
                '200': {
                  description: 'Polymorphic response',
                  content: {
                    'application/json': {
                      schema: {
                        anyOf: [
                          { type: 'array', items: { type: 'string' } },
                          { type: 'object', properties: { kind: { type: 'string' } } },
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }

      const diff = diffEndpoints(baseDoc, headDoc)
      expect(hasBreakingChanges(diff)).toBe(false)
      expect(classifyBreakingChanges(diff)).toHaveLength(0)
      expect(diff.modified).toHaveLength(0)
    })

    it('detects breaking changes when polymorphic oneOf variants are narrowed or mutated in request or response', () => {
      const baseDoc = {
        openapi: '3.1.0',
        info: { title: 'Polymorph Narrowing', version: '1.0.0' },
        paths: {
          '/event': {
            post: {
              operationId: 'createEvent',
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      oneOf: [
                        { type: 'object', properties: { type: { const: 'click' } } },
                        { type: 'object', properties: { type: { const: 'hover' } } },
                      ],
                    },
                  },
                },
              },
              responses: {
                '200': {
                  description: 'Result',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'string',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }

      // Removing 'hover' variant from requestBody changes request body schema fingerprint (breaking)
      // Widening response to anyOf [string, number] changes response schema fingerprint (breaking)
      const headDoc = {
        openapi: '3.1.0',
        info: { title: 'Polymorph Narrowing', version: '1.0.0' },
        paths: {
          '/event': {
            post: {
              operationId: 'createEvent',
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      oneOf: [
                        { type: 'object', properties: { type: { const: 'click' } } },
                      ],
                    },
                  },
                },
              },
              responses: {
                '200': {
                  description: 'Result',
                  content: {
                    'application/json': {
                      schema: {
                        anyOf: [{ type: 'string' }, { type: 'number' }],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }

      const diff = diffEndpoints(baseDoc, headDoc)
      expect(hasBreakingChanges(diff)).toBe(true)
      const breaking = classifyBreakingChanges(diff)
      expect(breaking.length).toBeGreaterThan(0)
      expect(breaking.some(b => b.code === 'request-schema-changed' || b.code === 'response-schema-changed')).toBe(true)
    })

    it('handles missing components, dangling $refs, external pointers, and malformed JSON pointers gracefully', () => {
      const docWithBrokenRefs = {
        openapi: '3.1.0',
        info: { title: 'Broken Refs Test', version: '1.0.0' },
        paths: {
          '/broken': {
            get: {
              operationId: 'getBroken',
              responses: {
                '200': {
                  description: 'Broken response',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: {
                          missingComponent: { $ref: '#/components/schemas/NonExistentComponent' },
                          externalRef: { $ref: 'https://example.com/schemas/user.json' },
                          relativeFileRef: { $ref: './models/user.yaml#/definitions/User' },
                          malformedPointer: { $ref: '#invalid_pointer_without_slash' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        // components block is intentionally completely omitted
      }

      // Must not throw TypeError or unhandled rejection
      expect(() => {
        const endpoints = extractEndpoints(docWithBrokenRefs)
        expect(endpoints.size).toBe(1)
        const diff = diffEndpoints(docWithBrokenRefs, docWithBrokenRefs, { includeComponentSchemas: true })
        expect(hasBreakingChanges(diff)).toBe(false)
      }).not.toThrow()
    })
  })

  // =========================================================================
  // SECTION 4: MANIFEST V3 CSP AUDIT SCANNER AGAINST OBFUSCATED EVAL/FN & IMPORTS
  // =========================================================================
  describe('Area 4: Manifest V3 CSP Audit Scanner Against Obfuscated Eval/Function & Complex Imports', () => {
    it('detects deeply obfuscated eval and Function constructor patterns', async () => {
      const code = `
        // Deep parenthesization
        const res1 = (((((eval)))))("1 + 1");

        // Deeply nested comma expressions
        const res2 = (1, (2, (3, (4, eval))))("2 + 2");

        // Global variations with comma expressions
        const res3 = (0, window.eval)("3 + 3");
        const res4 = (0, globalThis.eval)("4 + 4");
        const res5 = (0, self.eval)("5 + 5");
        const res6 = (0, global.eval)("6 + 6");

        // Function constructor invocations
        const fn1 = Function("return 1;")();
        const fn2 = (0, Function)("return 2;")();
        const fn3 = new Function("a", "return a;");
        const fn4 = new window.Function("return 4;");
        const fn5 = new globalThis.Function("return 5;");
        const fn6 = globalThis.Function("return 6;")();

        // Timers with template expressions
        const inject = "alert(1)";
        setTimeout(\`doSomething(\${inject})\`, 100);
        setInterval(\`tick(\${inject})\`, 200);
      `

      const violations = await auditCspSource('obfuscated-eval.js', code)
      const evalViolations = violations.filter(v => v.rule === 'csp/no-eval')
      const fnViolations = violations.filter(v => v.rule === 'csp/no-new-function')
      const timeoutViolations = violations.filter(v => v.rule === 'csp/no-string-settimeout')
      const intervalViolations = violations.filter(v => v.rule === 'csp/no-string-setinterval')

      expect(evalViolations.length).toBe(6)
      expect(fnViolations.length).toBe(6)
      expect(timeoutViolations.length).toBe(1)
      expect(intervalViolations.length).toBe(1)
    })

    it('empirically analyzes scanner capability on element access expressions (window["eval"], globalThis["eval"])', async () => {
      const code = `
        const a = window["eval"]("1 + 1");
        const b = globalThis["eval"]("2 + 2");
        const c = self["eval"]("3 + 3");
        const d = new window["Function"]("return 4;");
      `
      const violations = await auditCspSource('bracket-eval.js', code)
      // Empirical verification: current AST walker inspects Identifier and PropertyAccessExpression (.eval),
      // but does not visit ElementAccessExpression (["eval"]), resulting in 0 violations detected for bracket access.
      expect(violations).toHaveLength(0)
    })

    it('detects complex disallowed import patterns (subpaths, dynamic imports, re-exports, require)', async () => {
      const code = `
        // Subpaths of ajv and zod
        import Ajv2020 from 'ajv/dist/2020';
        import { z } from 'zod/lib/index';
        import addFormats from 'ajv-formats';

        // @oa-sdk subpaths
        import { findProjectRoot } from '@oa-sdk/core';
        import { parseSpec } from '@oa-sdk/parser';
        import { validateOpenApiProjection } from '@oa-sdk/openapi-projection-contract';
        import { generateStandaloneGuards } from '@oa-sdk/codegen';
        import * as client from '@oa-sdk/client';

        // Dynamic imports
        async function loadModules() {
          const a = await import('ajv');
          const z = await import('zod');
          const c = await import('@oa-sdk/core');
        }

        // Re-exports
        export * from 'ajv';
        export { z as myZod } from 'zod';
        export * from '@oa-sdk/codegen';

        // CommonJS require
        const cjsAjv = require('ajv');
        const cjsZod = require('zod');
        const cjsCore = require('@oa-sdk/core');
      `

      const violations = await auditCspSource('complex-imports.js', code)
      const disallowed = violations.filter(v => v.rule === 'csp/no-disallowed-import')
      expect(disallowed.length).toBe(17)
    })

    it('does NOT produce false positives on safe custom identifiers or legitimate external packages', async () => {
      const code = `
        import * as fs from 'node:fs';
        import * as path from 'node:path';
        import clsx from 'clsx';
        import { format } from 'date-fns';
        import notAjv from 'not-ajv';
        import myZodHelpers from 'my-zod-helpers';
        import * as otherOrgSdk from '@other-org/oa-sdk';

        // Safe local method names
        const myMath = {
          eval(expr) { return 42; },
          evaluate(expr) { return 100; },
          Function(name) { return () => name; }
        };
        myMath.eval("1 + 1");
        myMath.evaluate("2 + 2");
        myMath.Function("test");

        // Safe timers with callbacks
        setTimeout(() => console.log('ok'), 100);
        setInterval(function() { console.log('ok'); }, 200);
        const onTick = () => {};
        setTimeout(onTick, 300);
      `

      const violations = await auditCspSource('safe-code.js', code)
      expect(violations).toHaveLength(0)
    })
  })

  // =========================================================================
  // SECTION 5: SUBPROCESS CLI ADVERSARIAL PIPELINE INTEGRATION
  // =========================================================================
  describe('Area 5: Subprocess CLI Execution Under Adversarial Conditions', () => {
    it('executes oa-gen diff --fail-on-breaking on circular schemas via subprocess CLI', async () => {
      const baseTemp = await createTempDir('oa-cli-diff-circ-')
      const circularBase = {
        openapi: '3.1.0',
        info: { title: 'Circular API', version: '1.0.0' },
        paths: {
          '/tree': {
            get: {
              operationId: 'getTree',
              responses: {
                '200': {
                  description: 'Tree root',
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/Node' },
                    },
                  },
                },
              },
            },
          },
        },
        components: {
          schemas: {
            Node: {
              type: 'object',
              required: ['id'],
              properties: {
                id: { type: 'string' },
                child: { $ref: '#/components/schemas/Node' },
              },
            },
          },
        },
      }

      const circularHeadBreaking = {
        ...circularBase,
        components: {
          schemas: {
            Node: {
              type: 'object',
              required: ['id', 'mandatoryName'],
              properties: {
                id: { type: 'string' },
                mandatoryName: { type: 'string' },
                child: { $ref: '#/components/schemas/Node' },
              },
            },
          },
        },
      }

      const basePath = path.join(baseTemp, 'base.json')
      const headIdenticalPath = path.join(baseTemp, 'head-identical.json')
      const headBreakingPath = path.join(baseTemp, 'head-breaking.json')

      await fs.writeFile(basePath, JSON.stringify(circularBase), 'utf8')
      await fs.writeFile(headIdenticalPath, JSON.stringify(circularBase), 'utf8')
      await fs.writeFile(headBreakingPath, JSON.stringify(circularHeadBreaking), 'utf8')

      // 1. Identical circular schemas -> exit code 0
      const resIdentical = runOaCli(['diff', '--base', basePath, '--head', headIdenticalPath, '--fail-on-breaking'], {
        cwd: baseTemp,
      })
      expect(resIdentical.status).toBe(0)
      expect(resIdentical.stdout).toContain('No endpoint or schema changes detected')

      // 2. Breaking circular schema -> exit code 1
      const resBreaking = runOaCli(['diff', '--base', basePath, '--head', headBreakingPath, '--fail-on-breaking'], {
        cwd: baseTemp,
      })
      expect(resBreaking.status).toBe(1)
      expect(resBreaking.stdout).toContain('#### Breaking Changes')
    })

    it('rejects malformed syntax in oa.config.json with descriptive error', async () => {
      const baseTemp = await createTempDir('oa-json-syntax-')
      const badJsonPath = path.join(baseTemp, 'oa.config.json')
      await fs.writeFile(badJsonPath, '{\n  "rootDir": ".",\n  "specs": [,\n}\n', 'utf8')

      await expect(loadOaConfig({ configPath: badJsonPath })).rejects.toThrow(
        /Failed to parse JSON config file/
      )
    })

    it('executes CLI commands cleanly from weirdly named directories using upward discovery', async () => {
      const baseTemp = await createTempDir('oa-cli-weird-dirs-')
      const weirdDir = path.join(baseTemp, '📁 my space project (special) [v1.0]')
      const deepSub = path.join(weirdDir, 'packages', 'deep sub with spaces')
      await fs.mkdir(deepSub, { recursive: true })
      await fs.writeFile(path.join(weirdDir, 'oa.config.ts'), 'export default { rootDir: ".", specs: [] };', 'utf8')

      const result = runOaCli(['validate', '--help'], { cwd: deepSub })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('oa-gen validate')
    })
  })
})

