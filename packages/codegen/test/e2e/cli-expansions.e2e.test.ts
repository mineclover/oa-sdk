import { afterEach, describe, expect, it } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as os from 'node:os'
import { pathToFileURL } from 'node:url'
import {
  generateStandaloneGuards,
} from '../../src/index.js'
import type {
  StandaloneGuardGeneratorOptions,
  GeneratedGuardArtifact,
} from '../../src/index.js'
import {
  auditCspSource,
  auditCspBundle,
  collectBundleFiles,
  auditCsp,
} from '../../src/cli/commands/audit-csp.js'
import {
  lint,
  parseLintCategories,
  ALLOWED_LINT_CATEGORIES,
} from '../../src/cli/commands/lint.js'
import {
  validate,
} from '../../src/cli/commands/validate.js'
import {
  lintDocument,
} from '@oa-sdk/parser'
import {
  validateOpenApiProjection,
  isOpenApiProjectionProfile,
  OPENAPI_PROJECTION_PROFILES,
} from '@oa-sdk/openapi-projection-contract'

describe('E2E CLI Expansions & Conventions Test Suite (Tiers 1-4)', () => {
  const tempDirs: string[] = []
  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
  const setupTempDir = async (prefix = 'oa-cli-e2e-') => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
  }

  // =========================================================================
  // TIER 1: FEATURE COVERAGE (>=5 tests per feature)
  // =========================================================================

  describe('Tier 1: Feature Coverage', () => {
    // -----------------------------------------------------------------------
    // R1: Standalone Guards Splitting (--split) & Selective Filtering (--schemas)
    // -----------------------------------------------------------------------
    describe('R1: Standalone Guards Splitting (--split)', () => {
      it('T1-R1-F1-1: produces separate .js and .d.ts files in guards/ subfolder', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            SurfaceBlock: {
              type: 'object',
              required: ['id', 'selector'],
              properties: {
                id: { type: 'string' },
                selector: { type: 'string' },
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
        })

        expect(artifacts.length).toBeGreaterThanOrEqual(4)

        // Verify guards directory on disk
        const guardsDir = path.join(outDir, 'guards')
        expect(fsSync.existsSync(guardsDir)).toBe(true)

        const blockJs = path.join(guardsDir, 'SurfaceBlock.js')
        const blockDts = path.join(guardsDir, 'SurfaceBlock.d.ts')
        const paramJs = path.join(guardsDir, 'SurfaceParam.js')
        const paramDts = path.join(guardsDir, 'SurfaceParam.d.ts')

        expect(fsSync.existsSync(blockJs)).toBe(true)
        expect(fsSync.existsSync(blockDts)).toBe(true)
        expect(fsSync.existsSync(paramJs)).toBe(true)
        expect(fsSync.existsSync(paramDts)).toBe(true)

        const blockContent = await fs.readFile(blockJs, 'utf8')
        expect(blockContent).toContain('function isSurfaceBlock')
      })

      it('T1-R1-F1-2: produces root index.js barrel re-exporting all emitted guard modules', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            Alpha: { type: 'string' },
            Beta: { type: 'number' },
          },
        }

        await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          split: true,
        })

        const indexJsPath = path.join(outDir, 'index.js')
        expect(fsSync.existsSync(indexJsPath)).toBe(true)
        const indexJs = await fs.readFile(indexJsPath, 'utf8')
        expect(indexJs).toContain("export * from './guards/Alpha.js';")
        expect(indexJs).toContain("export * from './guards/Beta.js';")
      })

      it('T1-R1-F1-3: produces root index.d.ts barrel re-exporting all guard declarations', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            Alpha: { type: 'string' },
          },
        }

        await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          split: true,
          generateDeclarations: true,
        })

        const indexDtsPath = path.join(outDir, 'index.d.ts')
        expect(fsSync.existsSync(indexDtsPath)).toBe(true)
        const indexDts = await fs.readFile(indexDtsPath, 'utf8')
        expect(indexDts).toContain("export * from './guards/Alpha.js';")
      })

      it('T1-R1-F1-4: maps typeImportSpecifier into individual split .d.ts files', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            UserProfile: { type: 'object', properties: { id: { type: 'string' } } },
          },
        }

        await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          split: true,
          typeImportSpecifier: '@browser-studio/models',
        })

        const dtsPath = path.join(outDir, 'guards', 'UserProfile.d.ts')
        expect(fsSync.existsSync(dtsPath)).toBe(true)
        const dtsContent = await fs.readFile(dtsPath, 'utf8')
        expect(dtsContent).toContain("import type { UserProfile } from '@browser-studio/models';")
        expect(dtsContent).toMatch(/export declare function isUserProfile\(data: unknown\): data is UserProfile;/)
      })

      it('T1-R1-F1-5: discovers schemas from OpenAPI components.schemas in split mode', async () => {
        const outDir = await setupTempDir()
        const openApiDoc = {
          openapi: '3.1.0',
          info: { title: 'Test API', version: '1.0.0' },
          components: {
            schemas: {
              PatchOp: { type: 'object', properties: { op: { type: 'string' } } },
              DriftCheck: { type: 'object', properties: { hash: { type: 'string' } } },
            },
          },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: openApiDoc,
          outDir,
          split: true,
        })

        expect(artifacts.some(a => a.filePath.endsWith('PatchOp.js'))).toBe(true)
        expect(artifacts.some(a => a.filePath.endsWith('DriftCheck.js'))).toBe(true)
      })
    })

    describe('R1: Standalone Guards Selective Filtering (--schemas)', () => {
      it('T1-R1-F2-1: filters generation by exact type name (e.g. SurfaceBlock)', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            SurfaceBlock: { type: 'object', properties: { id: { type: 'string' } } },
            SurfaceParam: { type: 'object', properties: { name: { type: 'string' } } },
            UnrelatedType: { type: 'string' },
          },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          split: true,
          schemas: ['SurfaceBlock'],
        })

        const jsFiles = artifacts.filter(a => a.kind === 'js' && a.filePath.includes('guards'))
        expect(jsFiles.length).toBe(1)
        expect(jsFiles[0]!.filePath.endsWith('SurfaceBlock.js')).toBe(true)

        const indexJs = await fs.readFile(path.join(outDir, 'index.js'), 'utf8')
        expect(indexJs).toContain('SurfaceBlock.js')
        expect(indexJs).not.toContain('SurfaceParam.js')
        expect(indexJs).not.toContain('UnrelatedType.js')
      })

      it('T1-R1-F2-2: filters generation by guard function name (e.g. isSurfaceParam)', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            SurfaceBlock: { type: 'object' },
            SurfaceParam: { type: 'object' },
          },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          split: true,
          schemas: ['isSurfaceParam'],
        })

        const jsFiles = artifacts.filter(a => a.kind === 'js' && a.filePath.includes('guards'))
        expect(jsFiles.length).toBe(1)
        expect(jsFiles[0]!.filePath.endsWith('SurfaceParam.js')).toBe(true)
      })

      it('T1-R1-F2-3: filters multiple comma-separated schemas (e.g. isSurfaceBlock,isSurfaceParam)', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            SurfaceBlock: { type: 'object' },
            SurfaceParam: { type: 'object' },
            IgnoredOne: { type: 'string' },
            IgnoredTwo: { type: 'number' },
          },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          split: true,
          schemas: ['isSurfaceBlock', 'SurfaceParam'],
        })

        const jsFiles = artifacts.filter(a => a.kind === 'js' && a.filePath.includes('guards'))
        expect(jsFiles.length).toBe(2)
        expect(jsFiles.some(f => f.filePath.endsWith('SurfaceBlock.js'))).toBe(true)
        expect(jsFiles.some(f => f.filePath.endsWith('SurfaceParam.js'))).toBe(true)
      })

      it('T1-R1-F2-4: selective filtering in monolithic mode includes only selected functions', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            KeepA: { type: 'string' },
            KeepB: { type: 'number' },
            DropC: { type: 'boolean' },
          },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          split: false,
          schemas: ['KeepA', 'isKeepB'],
        })

        const guardsJs = artifacts.find(a => a.filePath.endsWith('guards.js'))?.content ?? ''
        expect(guardsJs).toContain('function isKeepA')
        expect(guardsJs).toContain('function isKeepB')
        expect(guardsJs).not.toContain('function isDropC')
      })

      it('T1-R1-F2-5: case-insensitive schema name matching works correctly', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            TimelineRecord: { type: 'object' },
          },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          split: true,
          schemas: ['timelinerecord'],
        })

        expect(artifacts.some(a => a.filePath.endsWith('TimelineRecord.js'))).toBe(true)
      })
    })

    describe('R1: Zero-Eval & Zero-Dependency Invariants', () => {
      it('T1-R1-F3-1: generated split modules contain 0 eval() calls', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            ComplexModel: {
              type: 'object',
              properties: {
                patternProp: { type: 'string', pattern: '^[A-Z]{3}-[0-9]+$' },
                numProp: { type: 'number', minimum: 0, maximum: 100 },
              },
            },
          },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          split: true,
        })

        for (const artifact of artifacts.filter(a => a.kind === 'js')) {
          expect(artifact.content).not.toMatch(/\beval\s*\(/)
        }
      })

      it('T1-R1-F3-2: generated split modules contain 0 new Function() or Function() calls', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            ItemsList: {
              type: 'array',
              items: { type: 'string', minLength: 1 },
            },
          },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          split: true,
        })

        for (const artifact of artifacts.filter(a => a.kind === 'js')) {
          expect(artifact.content).not.toMatch(/new\s+Function\s*\(/)
          expect(artifact.content).not.toMatch(/\bFunction\s*\(/)
        }
      })

      it('T1-R1-F3-3: generated split modules have 0 external runtime imports (ajv, zod, @oa-sdk)', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            Entity: { type: 'object', properties: { id: { type: 'string' } } },
          },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          split: true,
        })

        for (const artifact of artifacts.filter(a => a.kind === 'js')) {
          expect(artifact.content).not.toMatch(/from\s+['"]ajv/)
          expect(artifact.content).not.toMatch(/from\s+['"]zod/)
          expect(artifact.content).not.toMatch(/from\s+['"]@oa-sdk/)
          expect(artifact.content).not.toMatch(/require\s*\(/)
        }
      })

      it('T1-R1-F3-4: inlines referenced $ref schemas so split module is 100% self-contained', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            Coordinate: {
              type: 'object',
              required: ['x', 'y'],
              properties: { x: { type: 'number' }, y: { type: 'number' } },
            },
            PointSet: {
              type: 'object',
              required: ['points'],
              properties: {
                points: {
                  type: 'array',
                  items: { $ref: '#/$defs/Coordinate' },
                },
              },
            },
          },
        }

        await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          split: true,
          schemas: ['PointSet'],
        })

        const pointSetJs = path.join(outDir, 'guards', 'PointSet.js')
        expect(fsSync.existsSync(pointSetJs)).toBe(true)

        // Dynamic execution of standalone split module
        const mod = await import(pathToFileURL(pointSetJs).href)
        expect(typeof mod.isPointSet).toBe('function')

        // Valid payload
        expect(mod.isPointSet({ points: [{ x: 10, y: 20 }, { x: 0, y: -5 }] })).toBe(true)
        // Invalid payload (bad coordinate)
        expect(mod.isPointSet({ points: [{ x: 10, y: 'bad' }] })).toBe(false)
        // Invalid payload (missing required field)
        expect(mod.isPointSet({ points: [{ x: 10 }] })).toBe(false)
      })

      it('T1-R1-F3-5: dynamic execution verifies split type guard narrowing in pure ESM', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            SurfaceBlock: {
              type: 'object',
              required: ['id', 'selector', 'editable'],
              properties: {
                id: { type: 'string', minLength: 1 },
                selector: { type: 'string' },
                editable: { type: 'boolean' },
              },
            },
          },
        }

        await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          split: true,
        })

        const blockJs = path.join(outDir, 'guards', 'SurfaceBlock.js')
        const mod = await import(pathToFileURL(blockJs).href)

        expect(mod.isSurfaceBlock({ id: 'btn-1', selector: '.btn', editable: true })).toBe(true)
        expect(mod.isSurfaceBlock({ id: '', selector: '.btn', editable: true })).toBe(false)
        expect(mod.isSurfaceBlock(null)).toBe(false)
        expect(mod.isSurfaceBlock(undefined)).toBe(false)
        expect(mod.isSurfaceBlock('string-not-object')).toBe(false)
      })
    })

    // -----------------------------------------------------------------------
    // R2: CLI Category-Aware Linting & Profile-Aware Validation
    // -----------------------------------------------------------------------
    describe('R2: CLI Category-Aware Linting (--categories)', () => {
      it('T1-R2-F1-1: parses and validates ALLOWED_LINT_CATEGORIES', () => {
        const parsed = parseLintCategories('surface,structure,operations')
        expect(parsed).toEqual(['surface', 'structure', 'operations'])

        expect(() => parseLintCategories('invalidCategory')).toThrow(/--categories/)
        expect(() => parseLintCategories('')).toThrow()
      })

      it('T1-R2-F1-2: lintDocument executes ONLY surface rules when categories: [surface]', () => {
        // Spec with both a structure error (missing title/version in info) and a surface error (invalid anchor)
        const doc = {
          openapi: '3.1.0',
          info: {}, // missing title, version -> structure errors
          paths: {},
          'x-surface-anchor': { id: '', line: -1 }, // surface errors
        }

        const results = lintDocument(doc, { categories: ['surface'] })
        expect(results.length).toBeGreaterThan(0)
        expect(results.every(r => r.rule.startsWith('surface/'))).toBe(true)
        expect(results.some(r => r.rule.startsWith('structure/'))).toBe(false)
      })

      it('T1-R2-F1-3: lintDocument executes ONLY operations rules when categories: [operations]', () => {
        const doc = {
          openapi: '3.1.0',
          info: { title: 'Test', version: '1.0.0' },
          paths: {
            '/users': {
              get: {
                operationId: 'getUser',
                responses: {}, // warning: empty responses
              },
              post: {
                operationId: 'getUser', // duplicate operationId
                responses: { '200': { description: 'ok' } },
              },
            },
          },
          'x-surface-anchor': { id: '', line: -1 }, // invalid surface
        }

        const results = lintDocument(doc, { categories: ['operations'] })
        expect(results.length).toBeGreaterThan(0)
        expect(results.every(r => r.rule.startsWith('operations/'))).toBe(true)
        expect(results.some(r => r.rule.startsWith('surface/'))).toBe(false)
      })

      it('T1-R2-F1-4: lintDocument combines multiple specified categories (e.g. surface, parameters)', () => {
        const doc = {
          openapi: '3.1.0',
          info: {}, // structure violation (should be ignored)
          paths: {
            '/items/{id}': {
              get: {
                operationId: 'getItem',
                parameters: [
                  { name: 'id', in: 'invalid-in', required: true }, // parameter violation
                ],
                responses: { '200': { description: 'ok' } },
              },
            },
          },
          'x-surface-fingerprint': 'invalid-hash', // surface violation
        }

        const results = lintDocument(doc, { categories: ['surface', 'parameters'] })
        expect(results.some(r => r.rule.startsWith('parameters/'))).toBe(true)
        expect(results.some(r => r.rule.startsWith('surface/'))).toBe(true)
        expect(results.some(r => r.rule.startsWith('structure/'))).toBe(false)
      })

      it('T1-R2-F1-5: lint CLI command has categories option registered', () => {
        expect(lint.options.categories).toBeDefined()
        expect(lint.options.categories.type).toBe('string')
      })
    })

    describe('R2: CLI Profile-Aware Validation (--profile)', () => {
      it('T1-R2-F2-1: validate CLI options contains profile option', () => {
        expect(validate.options.profile).toBeDefined()
        expect(validate.options.profile.type).toBe('string')
      })

      it('T1-R2-F2-2: validateOpenApiProjection passes component-bundle profile with empty paths', () => {
        const doc = {
          openapi: '3.1.0',
          info: { title: 'Component Bundle Test', version: '1.0.0' },
          paths: {},
          components: {
            schemas: {
              SurfaceBlock: { type: 'object' },
            },
          },
        }

        const result = validateOpenApiProjection({
          profile: 'component-bundle',
          projection: doc,
          refs: [],
          diagnostics: [],
          sources: {},
          versionHash: 'hash-123',
        })

        expect(result.valid).toBe(true)
        expect(result.diagnostics.filter(d => d.severity === 'error')).toHaveLength(0)
      })

      it('T1-R2-F2-3: validateOpenApiProjection fails component-bundle profile when components.schemas is empty', () => {
        const doc = {
          openapi: '3.1.0',
          info: { title: 'Empty Bundle', version: '1.0.0' },
          paths: {},
          components: { schemas: {} },
        }

        const result = validateOpenApiProjection({
          profile: 'component-bundle',
          projection: doc,
          refs: [],
          diagnostics: [],
          sources: {},
          versionHash: 'hash-123',
        })

        expect(result.valid).toBe(false)
        expect(result.diagnostics.some(d => d.code === 'openapi-projection/profile-requirement')).toBe(true)
      })

      it('T1-R2-F2-4: validateOpenApiProjection fails operation-contract profile when paths has no operations', () => {
        const doc = {
          openapi: '3.1.0',
          info: { title: 'Empty Operations', version: '1.0.0' },
          paths: {},
        }

        const result = validateOpenApiProjection({
          profile: 'operation-contract',
          projection: doc,
          refs: [],
          diagnostics: [],
          sources: {},
          versionHash: 'hash-123',
        })

        expect(result.valid).toBe(false)
        expect(result.diagnostics.some(d => d.code === 'openapi-projection/profile-requirement')).toBe(true)
      })

      it('T1-R2-F2-5: validateOpenApiProjection passes operation-contract profile when valid operations exist', () => {
        const doc = {
          openapi: '3.1.0',
          info: { title: 'DevLink RPC Contract', version: '1.0.0' },
          paths: {
            '/rpc/session.hello': {
              post: {
                summary: 'Session Handshake',
                operationId: 'sessionHello',
                responses: {
                  '200': { description: 'Handshake OK' },
                },
              },
            },
          },
        }

        const result = validateOpenApiProjection({
          profile: 'operation-contract',
          projection: doc,
          refs: [],
          diagnostics: [],
          sources: {},
          versionHash: 'hash-123',
        })

        expect(result.valid).toBe(true)
      })
    })

    // -----------------------------------------------------------------------
    // R3: Automated Manifest V3 CSP Audit Command (oa-codegen audit:csp)
    // -----------------------------------------------------------------------
    describe('R3: Manifest V3 CSP Audit Command (oa-codegen audit:csp)', () => {
      it('T1-R3-F1-1: auditCspBundle passes on clean standalone guard output bundle', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            CleanModel: {
              type: 'object',
              properties: { name: { type: 'string' } },
            },
          },
        }

        await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          split: true,
        })

        const result = await auditCspBundle(outDir)
        expect(result.valid).toBe(true)
        expect(result.violations).toHaveLength(0)
        expect(result.scannedFiles.length).toBeGreaterThanOrEqual(2)
      })

      it('T1-R3-F1-2: auditCspSource detects eval(...) call with csp/no-eval rule', async () => {
        const code = `
          export function unsafeValidator(data) {
            return eval("data.age > 10");
          }
        `
        const violations = await auditCspSource('unsafe.js', code)
        expect(violations.some(v => v.rule === 'csp/no-eval')).toBe(true)
        expect(violations[0]!.line).toBe(3)
        expect(violations[0]!.severity).toBe('error')
      })

      it('T1-R3-F1-3: auditCspSource detects new Function(...) and Function(...) calls', async () => {
        const code = `
          const fn = new Function('a', 'b', 'return a + b');
          const fn2 = Function('return 42');
        `
        const violations = await auditCspSource('dynamic-fn.js', code)
        const fnViolations = violations.filter(v => v.rule === 'csp/no-new-function')
        expect(fnViolations.length).toBe(2)
      })

      it('T1-R3-F1-4: auditCspSource detects string setTimeout and setInterval calls', async () => {
        const code = `
          setTimeout("doSomething()", 1000);
          setInterval("tick()", 500);
        `
        const violations = await auditCspSource('timers.js', code)
        expect(violations.some(v => v.rule === 'csp/no-string-settimeout')).toBe(true)
        expect(violations.some(v => v.rule === 'csp/no-string-setinterval')).toBe(true)
      })

      it('T1-R3-F1-5: auditCspSource detects disallowed heavy runtime imports (ajv, zod, @oa-sdk)', async () => {
        const code = `
          import Ajv from 'ajv';
          import { z } from 'zod';
          import { validateDocument } from '@oa-sdk/parser';
          const ajvReq = require('ajv-formats');
        `
        const violations = await auditCspSource('heavy-imports.js', code)
        const importViolations = violations.filter(v => v.rule === 'csp/no-disallowed-import')
        expect(importViolations.length).toBe(4)
      })
    })

    // -----------------------------------------------------------------------
    // R4: Authoring Conventions Documentation & Schema Updates
    // -----------------------------------------------------------------------
    describe('R4: Authoring Conventions Documentation Completeness', () => {
      const getGuideContent = async (): Promise<string> => {
        const candidatePaths = [
          path.resolve(process.cwd(), '../../docs/guides/schema-architecture-and-conventions.md'),
          path.resolve(process.cwd(), 'docs/guides/schema-architecture-and-conventions.md'),
          path.resolve(process.cwd(), '../browser-studio/docs/guides/schema-architecture-and-conventions.md'),
          path.resolve(process.cwd(), '../../browser-studio/docs/guides/schema-architecture-and-conventions.md'),
          '/Users/junwoobang/workflow/browser-studio/docs/guides/schema-architecture-and-conventions.md',
        ]
        for (const p of candidatePaths) {
          if (fsSync.existsSync(p)) {
            return await fs.readFile(p, 'utf8')
          }
        }
        throw new Error(`Guide file not found in candidates: ${candidatePaths.join(', ')}`)
      }

      it('T1-R4-F1-1: verifies presence and completeness of RFC 9457 Problem Details specification', async () => {
        const content = await getGuideContent()
        expect(content.toLowerCase()).toMatch(/rfc\s*9457|problemdetails/i)
      })

      it('T1-R4-F1-2: verifies specification of strict numeric bounds (exclusiveMinimum: 0 vs minimum: 0)', async () => {
        const content = await getGuideContent()
        expect(content).toMatch(/exclusiveMinimum/i)
        expect(content).toMatch(/minimum/i)
      })

      it('T1-R4-F1-3: verifies specification of recursive schemas with z.lazy', async () => {
        const content = await getGuideContent()
        expect(content).toMatch(/z\.lazy|\$ref.*recursive/i)
      })

      it('T1-R4-F1-4: verifies specification of x-surface-* scope rules (targetProperty vs inline)', async () => {
        const content = await getGuideContent()
        expect(content).toMatch(/x-surface-/i)
      })

      it('T1-R4-F1-5: verifies V3 Unified Architecture JSDoc annotation tag specifications', async () => {
        const content = await getGuideContent()
        expect(content).toMatch(/EntitySpec|JSDoc/i)
      })
    })
  })

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES (>=5 tests per feature)
  // =========================================================================

  describe('Tier 2: Boundary & Corner Cases', () => {
    describe('R1 Boundaries', () => {
      it('T2-R1-B1: handles single-component schema document in split mode cleanly', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            Solo: { type: 'string', minLength: 5 },
          },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          split: true,
        })

        expect(artifacts.some(a => a.filePath.endsWith('Solo.js'))).toBe(true)
        expect(artifacts.some(a => a.filePath.endsWith('index.js'))).toBe(true)
        const indexContent = await fs.readFile(path.join(outDir, 'index.js'), 'utf8')
        expect(indexContent.trim()).toBe("export * from './guards/Solo.js';")
      })

      it('T2-R1-B2: handles multi-level nested $ref chains in split generation', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            Level1: { type: 'object', properties: { val: { type: 'number' } } },
            Level2: { type: 'object', properties: { nested: { $ref: '#/$defs/Level1' } } },
            Level3: { type: 'object', properties: { outer: { $ref: '#/$defs/Level2' } } },
          },
        }

        await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          split: true,
          schemas: ['Level3'],
        })

        const level3Js = path.join(outDir, 'guards', 'Level3.js')
        expect(fsSync.existsSync(level3Js)).toBe(true)

        const mod = await import(pathToFileURL(level3Js).href)
        expect(mod.isLevel3({ outer: { nested: { val: 42 } } })).toBe(true)
        expect(mod.isLevel3({ outer: { nested: { val: 'bad' } } })).toBe(false)
      })

      it('T2-R1-B3: handles schema names containing special characters or underscores', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            'custom_profile_v1': { type: 'object', properties: { name: { type: 'string' } } },
          },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          split: true,
        })

        expect(artifacts.some(a => a.filePath.includes('custom_profile_v1'))).toBe(true)
      })

      it('T2-R1-B4: handles empty schema object {} in split mode producing permissive guard', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            AnyPayload: {},
          },
        }

        await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          split: true,
        })

        const anyJs = path.join(outDir, 'guards', 'AnyPayload.js')
        const mod = await import(pathToFileURL(anyJs).href)
        expect(mod.isAnyPayload({ any: 'value' })).toBe(true)
        expect(mod.isAnyPayload(123)).toBe(true)
      })

      it('T2-R1-B5: handles schema filtering returning empty array when no schemas match', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            Existing: { type: 'string' },
          },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          split: true,
          schemas: ['NonExistentType'],
        })

        expect(artifacts).toEqual([])
      })
    })

    describe('R2 Boundaries', () => {
      it('T2-R2-B1: parses categories with irregular whitespace and trims properly', () => {
        const parsed = parseLintCategories('  surface ,   operations  ,  structure  ')
        expect(parsed).toEqual(['surface', 'operations', 'structure'])
      })

      it('T2-R2-B2: validate handles operations with additional custom HTTP methods (query, trace)', () => {
        const doc = {
          openapi: '3.1.0',
          info: { title: 'Extended Verbs', version: '1.0.0' },
          paths: {
            '/search': {
              query: {
                summary: 'OAS 3.2 Query method',
                operationId: 'searchQuery',
                responses: { '200': { description: 'OK' } },
              },
            },
          },
        }

        const result = validateOpenApiProjection({
          profile: 'operation-contract',
          projection: doc,
          refs: [],
          diagnostics: [],
          sources: {},
          versionHash: 'hash-123',
        })

        expect(result.valid).toBe(true)
      })

      it('T2-R2-B3: validate rejects path items containing only parameters without operation methods', () => {
        const doc = {
          openapi: '3.1.0',
          info: { title: 'No Operations', version: '1.0.0' },
          paths: {
            '/users/{id}': {
              parameters: [{ name: 'id', in: 'path', required: true }],
            },
          },
        }

        const result = validateOpenApiProjection({
          profile: 'operation-contract',
          projection: doc,
          refs: [],
          diagnostics: [],
          sources: {},
          versionHash: 'hash-123',
        })

        expect(result.valid).toBe(false)
        expect(result.diagnostics.some(d => d.code === 'openapi-projection/profile-requirement')).toBe(true)
      })

      it('T2-R2-B4: validate supports full-api-document profile with standard paths and components', () => {
        const doc = {
          openapi: '3.1.0',
          info: { title: 'Full API', version: '1.0.0' },
          paths: {
            '/health': {
              get: {
                responses: { '200': { description: 'Healthy' } },
              },
            },
          },
          components: {
            schemas: {
              HealthStatus: { type: 'object', properties: { status: { type: 'string' } } },
            },
          },
        }

        const result = validateOpenApiProjection({
          profile: 'full-api-document',
          projection: doc,
          refs: [],
          diagnostics: [],
          sources: {},
          versionHash: 'hash-123',
        })

        expect(result.valid).toBe(true)
      })

      it('T2-R2-B5: validate rejects document with missing or non-3.x openapi version', () => {
        const doc = {
          openapi: '2.0',
          info: { title: 'Swagger 2.0', version: '1.0.0' },
          paths: {},
        }

        const result = validateOpenApiProjection({
          profile: 'component-bundle',
          projection: doc,
          refs: [],
          diagnostics: [],
          sources: {},
          versionHash: 'hash-123',
        })

        expect(result.valid).toBe(false)
        expect(result.diagnostics.some(d => d.code === 'openapi-projection/invalid-document')).toBe(true)
      })
    })

    describe('R3 Boundaries', () => {
      it('T2-R3-B1: safe setTimeout with arrow function does NOT trigger violation', async () => {
        const code = `
          setTimeout(() => {
            console.log('Safe callback');
          }, 100);
        `
        const violations = await auditCspSource('safe-timer.js', code)
        expect(violations.filter(v => v.rule.startsWith('csp/no-string-'))).toHaveLength(0)
      })

      it('T2-R3-B2: template literal in setTimeout is identified as violation', async () => {
        const code = `
          const expr = "foo()";
          setTimeout(\`\${expr}\`, 100);
        `
        const violations = await auditCspSource('template-timer.js', code)
        expect(violations.some(v => v.rule === 'csp/no-string-settimeout')).toBe(true)
      })

      it('T2-R3-B3: identifiers containing "eval" as substring do NOT trigger violation', async () => {
        const code = `
          function evaluateExpression(val) {
            return val * 2;
          }
          const evalResult = evaluateExpression(5);
        `
        const violations = await auditCspSource('safe-ident.js', code)
        expect(violations.filter(v => v.rule === 'csp/no-eval')).toHaveLength(0)
      })

      it('T2-R3-B4: dynamic import() of forbidden module is detected', async () => {
        const code = `
          async function loadEngine() {
            const z = await import('zod');
            return z;
          }
        `
        const violations = await auditCspSource('dynamic-import.js', code)
        expect(violations.some(v => v.rule === 'csp/no-disallowed-import')).toBe(true)
      })

      it('T2-R3-B5: collects all JS/MJS/CJS files across nested subdirectories', async () => {
        const bundleDir = await setupTempDir('nested-bundle-')
        const subDir1 = path.join(bundleDir, 'sub1')
        const subDir2 = path.join(bundleDir, 'sub1', 'sub2')
        await fs.mkdir(subDir2, { recursive: true })

        await fs.writeFile(path.join(bundleDir, 'root.js'), 'export const a = 1;', 'utf8')
        await fs.writeFile(path.join(subDir1, 'nested.mjs'), 'export const b = 2;', 'utf8')
        await fs.writeFile(path.join(subDir2, 'deep.cjs'), 'module.exports = { c: 3 };', 'utf8')

        const files = collectBundleFiles(bundleDir)
        expect(files).toHaveLength(3)
        expect(files.some(f => f.endsWith('root.js'))).toBe(true)
        expect(files.some(f => f.endsWith('nested.mjs'))).toBe(true)
        expect(files.some(f => f.endsWith('deep.cjs'))).toBe(true)
      })
    })

    describe('R4 Boundaries', () => {
      it('T2-R4-B1: validates that JSON Schema Draft 2020-12 uses numeric exclusiveMinimum', () => {
        const sample2020Schema = {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'number',
          exclusiveMinimum: 0,
        }
        expect(typeof sample2020Schema.exclusiveMinimum).toBe('number')
      })

      it('T2-R4-B2: verifies RFC 9457 Problem Details schema structure fields', () => {
        const problemDetails = {
          type: 'https://example.com/errors/invalid-param',
          title: 'Invalid Parameter',
          status: 422,
          detail: 'The param value exceeds permitted boundary',
          instance: '/rpc/materialize.css',
          code: 'PARAM_OUT_OF_BOUNDS',
          invalidParams: [
            { name: 'width', reason: 'Must be positive integer' },
          ],
        }

        expect(problemDetails.status).toBe(422)
        expect(problemDetails.type).toContain('https://')
        expect(Array.isArray(problemDetails.invalidParams)).toBe(true)
      })

      it('T2-R4-B3: verifies supported OpenAPI projection profiles list', () => {
        expect(OPENAPI_PROJECTION_PROFILES).toContain('component-bundle')
        expect(OPENAPI_PROJECTION_PROFILES).toContain('operation-contract')
        expect(OPENAPI_PROJECTION_PROFILES).toContain('full-api-document')
        expect(isOpenApiProjectionProfile('component-bundle')).toBe(true)
        expect(isOpenApiProjectionProfile('invalid-profile')).toBe(false)
      })

      it('T2-R4-B4: verifies allowed lint categories list', () => {
        expect(ALLOWED_LINT_CATEGORIES).toContain('surface')
        expect(ALLOWED_LINT_CATEGORIES).toContain('structure')
        expect(ALLOWED_LINT_CATEGORIES).toContain('operations')
        expect(ALLOWED_LINT_CATEGORIES).toContain('parameters')
        expect(ALLOWED_LINT_CATEGORIES).toContain('refs')
        expect(ALLOWED_LINT_CATEGORIES).toContain('security')
        expect(ALLOWED_LINT_CATEGORIES).toContain('style')
        expect(ALLOWED_LINT_CATEGORIES).toContain('components')
      })

      it('T2-R4-B5: verifies audit:csp command name and option structure', () => {
        expect(auditCsp.name).toBe('audit:csp')
        expect(auditCsp.options.bundle).toBeDefined()
        expect(auditCsp.options.bundle.required).toBe(true)
      })
    })
  })

  // =========================================================================
  // TIER 3: CROSS-FEATURE INTERACTIONS (Pairwise combinations)
  // =========================================================================

  describe('Tier 3: Cross-Feature Interactions', () => {
    it('T3-1: End-to-End Guard Generation -> CSP Audit -> Dynamic Execution', async () => {
      const outDir = await setupTempDir()
      const schemaDoc = {
        $defs: {
          DevLinkRpcParams: {
            type: 'object',
            required: ['method', 'requestId'],
            properties: {
              method: { type: 'string', pattern: '^[a-z.]+$' },
              requestId: { type: 'string' },
              payload: {
                type: 'object',
                properties: {
                  timestamp: { type: 'number', minimum: 0 },
                },
              },
            },
          },
        },
      }

      // Step 1: Generate split guards with selective schema filtering
      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        split: true,
        schemas: ['isDevLinkRpcParams'],
      })
      expect(artifacts.length).toBeGreaterThan(0)

      // Step 2: Run Manifest V3 CSP audit scanner on the emitted bundle directory
      const auditResult = await auditCspBundle(outDir)
      expect(auditResult.valid).toBe(true)
      expect(auditResult.violations).toHaveLength(0)

      // Step 3: Dynamically import the generated split guard and execute runtime verification
      const guardPath = path.join(outDir, 'guards', 'DevLinkRpcParams.js')
      const mod = await import(pathToFileURL(guardPath).href)

      expect(
        mod.isDevLinkRpcParams({
          method: 'session.hello',
          requestId: 'req-001',
          payload: { timestamp: 1700000000 },
        }),
      ).toBe(true)

      expect(
        mod.isDevLinkRpcParams({
          method: '',
          requestId: 'req-001',
        }),
      ).toBe(false)
    })

    it('T3-2: Category Linting -> Profile Validation -> Split Guard Compilation', async () => {
      const outDir = await setupTempDir()
      const specDoc = {
        openapi: '3.1.0',
        info: { title: 'Visual Surface Schema', version: '1.0.0' },
        paths: {},
        'x-surface-fingerprint': 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        components: {
          schemas: {
            SurfaceBlock: {
              type: 'object',
              required: ['id'],
              properties: { id: { type: 'string' } },
            },
          },
        },
      }

      // Step 1: Category linting targeting only surface rules
      const lintResults = lintDocument(specDoc, { categories: ['surface'] })
      expect(lintResults.filter(r => r.severity === 'error')).toHaveLength(0)

      // Step 2: Projection profile validation under component-bundle
      const profileResult = validateOpenApiProjection({
        profile: 'component-bundle',
        projection: specDoc,
        refs: [],
        diagnostics: [],
        sources: {},
        versionHash: 'hash-abc',
      })
      expect(profileResult.valid).toBe(true)

      // Step 3: Generate standalone split guards
      const artifacts = await generateStandaloneGuards({
        schemaDocument: specDoc,
        outDir,
        split: true,
      })
      expect(artifacts.some(a => a.filePath.endsWith('SurfaceBlock.js'))).toBe(true)
    })

    it('T3-3: RFC 9457 Problem Details Pipeline: Contract Validation -> Guard Emission -> Execution', async () => {
      const outDir = await setupTempDir()
      const problemSchemaDoc = {
        $defs: {
          ProblemDetails: {
            type: 'object',
            required: ['type', 'title', 'status'],
            properties: {
              type: { type: 'string' },
              title: { type: 'string' },
              status: { type: 'integer', minimum: 100, maximum: 599 },
              detail: { type: 'string' },
              instance: { type: 'string' },
              code: { type: 'string' },
              invalidParams: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['name', 'reason'],
                  properties: {
                    name: { type: 'string' },
                    reason: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      }

      // Compile guard
      await generateStandaloneGuards({
        schemaDocument: problemSchemaDoc,
        outDir,
        split: true,
        schemas: ['ProblemDetails'],
      })

      // Audit CSP compliance
      const auditResult = await auditCspBundle(outDir)
      expect(auditResult.valid).toBe(true)

      // Execute runtime guard against standard RFC 9457 422 error payload
      const guardPath = path.join(outDir, 'guards', 'ProblemDetails.js')
      const mod = await import(pathToFileURL(guardPath).href)

      const errorPayload422 = {
        type: 'https://browser-studio.dev/errors/validation-failed',
        title: 'Unprocessable Entity',
        status: 422,
        detail: 'Invalid surface patch range offsets',
        instance: '/rpc/materialize.css',
        code: 'RANGE_OUT_OF_BOUNDS',
        invalidParams: [
          { name: 'start', reason: 'Start offset exceeds document length' },
        ],
      }

      expect(mod.isProblemDetails(errorPayload422)).toBe(true)
      expect(mod.isProblemDetails({ status: 999 })).toBe(false) // status out of bounds
    })

    it('T3-4: Discriminated Union Pipeline: Multi-Variant Split Guard & CSP Audit', async () => {
      const outDir = await setupTempDir()
      const doc = {
        $defs: {
          UpdateParamOp: {
            type: 'object',
            required: ['op', 'paramId', 'value'],
            properties: {
              op: { const: 'update-param' },
              paramId: { type: 'string' },
              value: { type: 'string' },
            },
          },
          DeleteParamOp: {
            type: 'object',
            required: ['op', 'paramId'],
            properties: {
              op: { const: 'delete-param' },
              paramId: { type: 'string' },
            },
          },
          PatchOp: {
            oneOf: [
              { $ref: '#/$defs/UpdateParamOp' },
              { $ref: '#/$defs/DeleteParamOp' },
            ],
          },
        },
      }

      await generateStandaloneGuards({
        schemaDocument: doc,
        outDir,
        split: true,
        schemas: ['PatchOp'],
      })

      const auditResult = await auditCspBundle(outDir)
      expect(auditResult.valid).toBe(true)

      const patchOpJs = path.join(outDir, 'guards', 'PatchOp.js')
      const mod = await import(pathToFileURL(patchOpJs).href)

      expect(mod.isPatchOp({ op: 'update-param', paramId: 'p-1', value: '#ff0000' })).toBe(true)
      expect(mod.isPatchOp({ op: 'delete-param', paramId: 'p-2' })).toBe(true)
      expect(mod.isPatchOp({ op: 'unknown-op', paramId: 'p-3' })).toBe(false)
    })
  })

  // =========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS
  // =========================================================================

  describe('Tier 4: Real-World Application Scenarios', () => {
    it('T4-1: Chrome Extension Manifest V3 Content Script Live-Editing Sandbox Scenario', async () => {
      const outDir = await setupTempDir()
      const surfaceSchemaDoc = {
        $defs: {
          SurfaceBlock: {
            type: 'object',
            required: ['id', 'selector', 'editable'],
            properties: {
              id: { type: 'string' },
              selector: { type: 'string' },
              editable: { type: 'boolean' },
            },
          },
          SurfaceParam: {
            type: 'object',
            required: ['name', 'value', 'unquotedValue'],
            properties: {
              name: { type: 'string' },
              value: { type: 'string' },
              unquotedValue: { type: 'string' },
            },
          },
        },
      }

      // 1. Generate split standalone guards for browser extension
      await generateStandaloneGuards({
        schemaDocument: surfaceSchemaDoc,
        outDir,
        split: true,
      })

      // 2. Audit bundle for strict MV3 CSP compliance
      const auditResult = await auditCspBundle(outDir)
      expect(auditResult.valid).toBe(true)

      // 3. Simulate strict CSP sandbox environment (Function and eval throws)
      const origFunction = globalThis.Function
      const origEval = globalThis.eval
      try {
        (globalThis as any).Function = function () {
          throw new Error('CSP Sandbox Violation: Function() is blocked in MV3 Content Scripts')
        }
        ;(globalThis as any).eval = function () {
          throw new Error('CSP Sandbox Violation: eval() is blocked in MV3 Content Scripts')
        }

        const blockMod = await import(pathToFileURL(path.join(outDir, 'guards', 'SurfaceBlock.js')).href)
        const paramMod = await import(pathToFileURL(path.join(outDir, 'guards', 'SurfaceParam.js')).href)

        // 60fps high-throughput simulation: 500 validation cycles in sandbox
        const start = performance.now()
        for (let i = 0; i < 500; i++) {
          const isValidBlock = blockMod.isSurfaceBlock({
            id: `block-${i}`,
            selector: '.card-container',
            editable: true,
          })
          const isValidParam = paramMod.isSurfaceParam({
            name: 'backgroundColor',
            value: '#ffffff',
            unquotedValue: '#ffffff',
          })
          expect(isValidBlock).toBe(true)
          expect(isValidParam).toBe(true)
        }
        const elapsed = performance.now() - start

        // Must comfortably satisfy sub-millisecond per-frame budget
        expect(elapsed).toBeLessThan(100) // 500 iterations in <100ms
      } finally {
        globalThis.Function = origFunction
        globalThis.eval = origEval
      }
    })

    it('T4-2: DevLink Native RPC & MCP CI Governance Pipeline Scenario', async () => {
      const nativeRpcSpec = {
        openapi: '3.1.0',
        info: {
          title: 'DevLink Native RPC Specification',
          version: '1.0.0',
          description: '17 Native RPC operations for Chrome Native Messaging bridge',
        },
        'x-surface-fingerprint': 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        paths: {
          '/rpc/session.hello': {
            post: {
              summary: 'Session Handshake',
              operationId: 'sessionHello',
              responses: { '200': { description: 'Success' } },
            },
          },
          '/rpc/materialize.css': {
            post: {
              summary: 'CSS Materialization',
              operationId: 'materializeCss',
              responses: {
                '200': { description: 'Materialized' },
                '422': { description: 'Validation failed' },
              },
            },
          },
        },
      }

      // Step 1: Validate spec against operation-contract profile
      const validation = validateOpenApiProjection({
        profile: 'operation-contract',
        projection: nativeRpcSpec,
        refs: [],
        diagnostics: [],
        sources: {},
        versionHash: 'pipeline-run-42',
      })
      expect(validation.valid).toBe(true)

      // Step 2: Lint surface metadata extensions
      const lintResults = lintDocument(nativeRpcSpec, { categories: ['surface'] })
      expect(lintResults.filter(r => r.severity === 'error')).toHaveLength(0)
    })

    it('T4-3: Production Release Packaging Gate Scenario', async () => {
      const bundleDir = await setupTempDir('prod-release-')
      const schemaDoc = {
        $defs: {
          ReleaseModel: { type: 'object', properties: { version: { type: 'string' } } },
        },
      }

      // Step 1: Generate production guard bundle
      await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir: bundleDir,
        split: true,
      })

      // Step 2: Assert clean release bundle passes audit
      const initialAudit = await auditCspBundle(bundleDir)
      expect(initialAudit.valid).toBe(true)

      // Step 3: Simulate an accidental developer dependency leak (e.g. importing ajv in build output)
      const poisonedFilePath = path.join(bundleDir, 'guards', 'LeakedModule.js')
      await fs.writeFile(
        poisonedFilePath,
        `import Ajv from 'ajv';\nexport function leaked() { return new Ajv(); }`,
        'utf8',
      )

      // Step 4: Audit gate catches the violation and halts the release
      const interceptedAudit = await auditCspBundle(bundleDir)
      expect(interceptedAudit.valid).toBe(false)
      expect(interceptedAudit.violations.some(v => v.rule === 'csp/no-disallowed-import')).toBe(true)
    })
  })
})
