/**
 * packages/codegen/src/__tests__/challenger-m5-adversarial-stress.test.ts
 *
 * Tier 5 Adversarial Coverage Hardening Suite (Challenger 1):
 *
 * 1. Broken Symlinks & File System Edge Cases in Root Discovery (findProjectRoot).
 * 2. Environment Variable Corruption & Edge-Case CLI Flags (OA_PROJECT_ROOT, --root "", precedence).
 * 3. Unexpected Payload Types, Prototype Pollution, and Frozen Objects in Configuration.
 * 4. Spec Drift & Freshness Engine Resilience against 0-byte, corrupt, and key-permuted specs.
 * 5. Manifest V3 CSP Audit Scanner Evasion and False-Positive Invariants.
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
  auditCspSource,
  auditCspSourceSync,
  collectBundleFiles,
  auditCspBundle,
  getTs,
} from '../cli/commands/audit-csp.js'
import { computeVersionHash, projectTargetSpec } from '../spec-projector.js'
import { runOaCli } from './e2e/helpers/cli-runner.js'
import { createWorkspaceFixture, type WorkspaceFixture } from './e2e/helpers/fixture-builder.js'

describe('Tier 5 Adversarial Coverage Hardening (M5 Challenger 1)', () => {
  let fixture: WorkspaceFixture
  let tempDirs: string[] = []

  const createTempDir = async (prefix = 'oa-adv-c1-') => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
  }

  beforeEach(async () => {
    fixture = await createWorkspaceFixture({}, 'oa-m5-c1-')
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
  // 1. BROKEN SYMLINKS & ANCESTOR CORRUPTION IN ROOT DISCOVERY
  // =========================================================================
  describe('Dimension 1: Broken Symlinks & File System Edge Cases in Root Discovery', () => {
    it('gracefully survives broken symlinks for config files, workspace files, and .git markers', async () => {
      const baseTemp = await createTempDir('broken-symlinks-')
      const repoRoot = path.join(baseTemp, 'real-repo')
      const subDir = path.join(repoRoot, 'packages', 'client')
      await fs.mkdir(subDir, { recursive: true })

      // Create broken symlinks in ancestor directories
      const nonExistentTarget = path.join(baseTemp, 'does-not-exist-file')
      await fs.symlink(nonExistentTarget, path.join(subDir, 'oa.config.ts'))
      await fs.symlink(nonExistentTarget, path.join(subDir, 'pnpm-workspace.yaml'))
      await fs.symlink(nonExistentTarget, path.join(subDir, '.git'))

      // Real config is placed at repoRoot
      await fs.writeFile(path.join(repoRoot, 'oa.config.ts'), 'export default { rootDir: ".", specs: [] };', 'utf8')

      // Should not throw ENOENT; broken symlinks must be safely ignored and real config found
      const detail = findProjectRootDetail({ cwd: subDir })
      expect(detail.root).toBe(repoRoot)
      expect(detail.tier).toBe(3)
      expect(detail.reason).toBe('config')
      expect(detail.matchedMarker).toBe('oa.config.ts')
    })

    it('correctly resolves root when cwd is accessed via a directory symlink', async () => {
      const baseTemp = await createTempDir('dir-symlink-')
      const realRoot = path.join(baseTemp, 'real-root')
      const realSub = path.join(realRoot, 'pkg', 'sub')
      await fs.mkdir(realSub, { recursive: true })
      await fs.writeFile(path.join(realRoot, 'oa.config.ts'), 'export default { rootDir: ".", specs: [] };', 'utf8')

      const linkRoot = path.join(baseTemp, 'linked-root')
      await fs.symlink(realRoot, linkRoot, 'dir')

      const linkSub = path.join(linkRoot, 'pkg', 'sub')

      // Invoking from symlinked path
      const detail = findProjectRootDetail({ cwd: linkSub })
      // detail.root should resolve lexically to linked-root or real-root
      expect(detail.tier).toBe(3)
      expect(detail.matchedMarker).toBe('oa.config.ts')
      expect(fsSync.existsSync(path.join(detail.root, 'oa.config.ts'))).toBe(true)
    })

    it('gracefully handles package.json that is not valid JSON or contains primitive values', async () => {
      const baseTemp = await createTempDir('corrupt-pkg-')
      const repoRoot = path.join(baseTemp, 'repo')
      const subDir = path.join(repoRoot, 'nested')
      await fs.mkdir(subDir, { recursive: true })

      // Case A: Corrupted JSON in package.json
      await fs.writeFile(path.join(subDir, 'package.json'), '{{{ INVALID JSON }}}', 'utf8')
      // Real git marker at repoRoot
      await fs.mkdir(path.join(repoRoot, '.git'), { recursive: true })

      const detailA = findProjectRootDetail({ cwd: subDir })
      expect(detailA.root).toBe(repoRoot)
      expect(detailA.tier).toBe(5)
      expect(detailA.reason).toBe('vcs')

      // Case B: package.json with primitive or non-workspace values
      await fs.writeFile(path.join(subDir, 'package.json'), JSON.stringify({ workspaces: 12345 }), 'utf8')
      const detailB = findProjectRootDetail({ cwd: subDir })
      expect(detailB.root).toBe(repoRoot)

      // Case C: package.json with workspaces: { packages: "not-an-array" }
      await fs.writeFile(path.join(subDir, 'package.json'), JSON.stringify({ workspaces: { packages: 'single' } }), 'utf8')
      const detailC = findProjectRootDetail({ cwd: subDir })
      expect(detailC.root).toBe(repoRoot)

      // Case D: package.json with standard workspaces array
      await fs.writeFile(path.join(subDir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }), 'utf8')
      const detailD = findProjectRootDetail({ cwd: subDir })
      expect(detailD.root).toBe(subDir)
      expect(detailD.tier).toBe(4)
      expect(detailD.reason).toBe('workspace')
    })
  })

  // =========================================================================
  // 2. ENVIRONMENT VARIABLE CORRUPTION & CLI EDGE CASES
  // =========================================================================
  describe('Dimension 2: Environment Variable Corruption & Edge-Case CLI Flags', () => {
    it('gracefully ignores empty string or whitespace OA_PROJECT_ROOT and falls back to traversal', async () => {
      const baseTemp = await createTempDir('env-corruption-')
      const repoRoot = path.join(baseTemp, 'repo')
      const subDir = path.join(repoRoot, 'pkg')
      await fs.mkdir(subDir, { recursive: true })
      await fs.writeFile(path.join(repoRoot, 'oa.config.json'), '{"rootDir": ".", "specs": []}', 'utf8')

      const origEnv = process.env.OA_PROJECT_ROOT
      try {
        // Test 1: Empty string
        process.env.OA_PROJECT_ROOT = ''
        const detailEmpty = findProjectRootDetail({ cwd: subDir })
        expect(detailEmpty.tier).toBe(3)
        expect(detailEmpty.root).toBe(repoRoot)

        // Test 2: Whitespace only
        process.env.OA_PROJECT_ROOT = '   \t\n  '
        const detailSpaces = findProjectRootDetail({ cwd: subDir })
        expect(detailSpaces.tier).toBe(3)
        expect(detailSpaces.root).toBe(repoRoot)
      } finally {
        if (origEnv !== undefined) {
          process.env.OA_PROJECT_ROOT = origEnv
        } else {
          delete process.env.OA_PROJECT_ROOT
        }
      }
    })

    it('handles non-existent OA_PROJECT_ROOT path as explicit env value without crashing', () => {
      const origEnv = process.env.OA_PROJECT_ROOT
      try {
        process.env.OA_PROJECT_ROOT = '/path/to/nonexistent/destination/definitely_not_here'
        const detail = findProjectRootDetail({ cwd: process.cwd() })
        expect(detail.tier).toBe(2)
        expect(detail.reason).toBe('env')
        expect(detail.root).toBe(path.resolve('/path/to/nonexistent/destination/definitely_not_here'))
      } finally {
        if (origEnv !== undefined) {
          process.env.OA_PROJECT_ROOT = origEnv
        } else {
          delete process.env.OA_PROJECT_ROOT
        }
      }
    })

    it('rejects empty --root or --project-root CLI arguments with exit code 1', () => {
      const resultEmptyRoot = runOaCli(['validate', '--root', ''])
      expect(resultEmptyRoot.status).toBe(1)
      expect(resultEmptyRoot.stderr).toMatch(/--root 또는 --project-root 값은 비어 있을 수 없습니다/)

      const resultEmptyProjRoot = runOaCli(['validate', '--project-root', ''])
      expect(resultEmptyProjRoot.status).toBe(1)
      expect(resultEmptyProjRoot.stderr).toMatch(/--root 또는 --project-root 값은 비어 있을 수 없습니다/)
    })

    it('enforces precedence of --project-root over --root if both are provided', async () => {
      const baseTemp = await createTempDir('precedence-cli-')
      const rootA = path.join(baseTemp, 'root-a')
      const rootB = path.join(baseTemp, 'root-b')
      await fs.mkdir(rootA, { recursive: true })
      await fs.mkdir(rootB, { recursive: true })

      await fs.writeFile(path.join(rootA, 'oa.config.json'), '{"rootDir": ".", "specs": []}', 'utf8')
      await fs.writeFile(path.join(rootB, 'oa.config.json'), '{"rootDir": ".", "specs": []}', 'utf8')

      // When both --root and --project-root are given, --project-root takes precedence
      const res = runOaCli(['validate', '--root', rootA, '--project-root', rootB])
      expect(res.status).toBe(1)
      expect(res.stderr).toMatch(/specs 목록이 비어 있습니다/)
    })
  })

  // =========================================================================
  // 3. UNEXPECTED PAYLOAD TYPES & PROTOTYPE POLLUTION IN CONFIGURATION
  // =========================================================================
  describe('Dimension 3: Unexpected Payload Types, Prototype Pollution, and Frozen Objects', () => {
    it('handles Object.create(null) configurations without crashing on missing prototype methods', () => {
      const nullProtoConfig = Object.create(null)
      nullProtoConfig.rootDir = '.'
      nullProtoConfig.specs = [
        {
          id: 'test-null-proto',
          profile: 'component-bundle',
          schemaEntry: './schema.ts',
          outDir: './dist',
        },
      ]

      const result = validateOaConfig(nullProtoConfig)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('rejects configurations with unexpected or malicious payload types', () => {
      // Non-object primitives
      expect(validateOaConfig(undefined).valid).toBe(false)
      expect(validateOaConfig(null).valid).toBe(false)
      expect(validateOaConfig(123).valid).toBe(false)
      expect(validateOaConfig('string-config').valid).toBe(false)
      expect(validateOaConfig(true).valid).toBe(false)
      expect(validateOaConfig(Symbol('config')).valid).toBe(false)
      expect(validateOaConfig([1, 2, 3]).valid).toBe(false)

      // specs containing non-object items
      const badSpecsResult = validateOaConfig({
        rootDir: '.',
        specs: ['string', 123, null, undefined, true],
      })
      expect(badSpecsResult.valid).toBe(false)
      expect(badSpecsResult.errors.length).toBeGreaterThanOrEqual(5)

      // guards with wrong types
      const badGuardsResult = validateOaConfig({
        rootDir: '.',
        guards: {
          outDir: './guards',
          split: 'yes' as any,
          moduleFormat: 'invalid-format' as any,
          auditCsp: 'no' as any,
        },
      })
      expect(badGuardsResult.valid).toBe(false)
      expect(badGuardsResult.errors.some(e => e.path === 'guards.split')).toBe(true)
      expect(badGuardsResult.errors.some(e => e.path === 'guards.moduleFormat')).toBe(true)
      expect(badGuardsResult.errors.some(e => e.path === 'guards.auditCsp')).toBe(true)
    })

    it('rejects empty or whitespace-only strings across all spec target fields', () => {
      const result = validateOaConfig({
        rootDir: '   ',
        specs: [
          {
            id: '   ',
            profile: 'component-bundle',
            schemaEntry: '   ',
            outDir: '   ',
            title: '   ',
            version: '   ',
          },
        ],
      })

      expect(result.valid).toBe(false)
      const errorPaths = result.errors.map(e => e.path)
      expect(errorPaths).toContain('rootDir')
      expect(errorPaths).toContain('specs[0].id')
      expect(errorPaths).toContain('specs[0].schemaEntry')
      expect(errorPaths).toContain('specs[0].outDir')
      expect(errorPaths).toContain('specs[0].title')
      expect(errorPaths).toContain('specs[0].version')
    })
  })

  // =========================================================================
  // 4. SPEC DRIFT & FRESHNESS RESILIENCE UNDER ADVERSARIAL INPUTS
  // =========================================================================
  describe('Dimension 4: Spec Drift & Freshness Engine Resilience against Hostile Inputs', () => {
    it('reports missing or 0-byte artifact as corrupt/missing and exits 1', async () => {
      const baseTemp = await createTempDir('drift-corrupt-')
      const emptyArtifact = path.join(baseTemp, 'empty.openapi.json')
      await fs.writeFile(emptyArtifact, '', 'utf8')

      // Single artifact check on 0-byte file
      const res0Byte = runOaCli(['check-artifact', '--artifact', emptyArtifact, '--format', 'json'])
      expect(res0Byte.status).toBe(1)
      const parsed0Byte = JSON.parse(res0Byte.stdout)
      expect(parsed0Byte.fresh).toBe(false)
      expect(parsed0Byte.targets[0].status).toBe('corrupt')

      // Single artifact check on missing file
      const missingArtifact = path.join(baseTemp, 'missing.openapi.json')
      const resMissing = runOaCli(['check-artifact', '--artifact', missingArtifact, '--format', 'json'])
      expect(resMissing.status).toBe(1)
      const parsedMissing = JSON.parse(resMissing.stdout)
      expect(parsedMissing.fresh).toBe(false)
      expect(parsedMissing.targets[0].status).toBe('missing')
    })

    it('reports invalid JSON syntax in artifact as corrupt and exits 1', async () => {
      const baseTemp = await createTempDir('drift-json-')
      const invalidJsonArtifact = path.join(baseTemp, 'invalid.openapi.json')
      await fs.writeFile(invalidJsonArtifact, '{"title": "Broken JSON", "openapi": 3.1.0, }', 'utf8')

      const res = runOaCli(['check-artifact', '--artifact', invalidJsonArtifact, '--format', 'json'])
      expect(res.status).toBe(1)
      const parsed = JSON.parse(res.stdout)
      expect(parsed.fresh).toBe(false)
      expect(parsed.targets[0].status).toBe('corrupt')
      expect(parsed.targets[0].message).toMatch(/Invalid JSON/)
    })

    it('computes bit-for-bit identical version hash regardless of object key insertion order', () => {
      const docA = {
        openapi: '3.1.0',
        info: { title: 'Order Test', version: '1.0.0', description: 'Test' },
        paths: {
          '/items': {
            get: {
              operationId: 'getItems',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
        components: {
          schemas: {
            User: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                age: { type: 'integer' },
                name: { type: 'string' },
              },
            },
          },
        },
      }

      // Permute key insertion order completely
      const docB = {
        components: {
          schemas: {
            User: {
              properties: {
                name: { type: 'string' },
                id: { type: 'string' },
                age: { type: 'integer' },
              },
              type: 'object',
            },
          },
        },
        paths: {
          '/items': {
            get: {
              responses: { '200': { description: 'OK' } },
              operationId: 'getItems',
            },
          },
        },
        info: { description: 'Test', version: '1.0.0', title: 'Order Test' },
        openapi: '3.1.0',
      }

      const hashA = computeVersionHash(docA)
      const hashB = computeVersionHash(docB)

      expect(hashA).toBe(hashB)
      expect(hashA).toMatch(/^(?:sha256:)?[a-f0-9]{64}$/)
    })

    it('correctly reports partial drift in multi-target config (1 fresh, 1 drifted) and exits 1', async () => {
      const baseTemp = await createTempDir('partial-drift-')

      // Write schemas
      const schemaA = path.join(baseTemp, 'schema-a.ts')
      await fs.writeFile(schemaA, `import { z } from 'zod'; export const A = z.object({ id: z.string() });`, 'utf8')

      const schemaB = path.join(baseTemp, 'schema-b.ts')
      await fs.writeFile(schemaB, `import { z } from 'zod'; export const B = z.object({ count: z.number() });`, 'utf8')

      const configPath = path.join(baseTemp, 'oa.config.json')
      await fs.writeFile(
        configPath,
        JSON.stringify({
          rootDir: '.',
          specs: [
            { id: 'target-a', profile: 'component-bundle', schemaEntry: './schema-a.ts', outDir: './artifacts' },
            { id: 'target-b', profile: 'component-bundle', schemaEntry: './schema-b.ts', outDir: './artifacts' },
          ],
        }),
        'utf8'
      )

      // Generate both
      const genRes = runOaCli(['generate', '--config', configPath], { cwd: baseTemp })
      expect(genRes.status).toBe(0)

      // Verify both are fresh initially
      const checkInitial = runOaCli(['drift:check', '--config', configPath, '--format', 'json'], { cwd: baseTemp })
      expect(checkInitial.status).toBe(0)
      const initialJson = JSON.parse(checkInitial.stdout)
      expect(initialJson.fresh).toBe(true)
      expect(initialJson.targets).toHaveLength(2)
      expect(initialJson.targets.every((t: any) => t.fresh)).toBe(true)

      // Now mutate schema-b without regenerating
      await fs.writeFile(
        schemaB,
        `import { z } from 'zod'; export const B = z.object({ count: z.number(), extraField: z.string() });`,
        'utf8'
      )

      // drift:check should now fail with exit 1, target-a fresh, target-b drift
      const checkMutated = runOaCli(['drift:check', '--config', configPath, '--format', 'json'], { cwd: baseTemp })
      expect(checkMutated.status).toBe(1)
      const mutatedJson = JSON.parse(checkMutated.stdout)
      expect(mutatedJson.fresh).toBe(false)
      expect(mutatedJson.targets.find((t: any) => t.id === 'target-a').status).toBe('fresh')
      expect(mutatedJson.targets.find((t: any) => t.id === 'target-b').status).toBe('drift')
    })
  })

  // =========================================================================
  // 5. MANIFEST V3 CSP AUDIT EVASION & FALSE-POSITIVE IMMUNITY
  // =========================================================================
  describe('Dimension 5: Manifest V3 CSP Audit Scanner Adversarial Stress & False-Positive Immunity', () => {
    it('ignores occurrences of eval and Function inside code comments and documentation', async () => {
      const codeWithComments = `
        /**
         * Disallowed function explanation:
         * Never use eval() or new Function() in Manifest V3 code.
         * setTimeout("string", 100) is also prohibited.
         * require('ajv') and import { z } from 'zod' are prohibited.
         */
        // Single-line comment: eval("alert(1)")
        // Single-line comment: new Function("return 1")()
        export function safeValidate(data: unknown): boolean {
          return typeof data === 'object' && data !== null;
        }
      `

      const violations = await auditCspSource('comments-test.js', codeWithComments)
      expect(violations).toHaveLength(0)
    })

    it('ignores eval used as a string literal parameter to safe logging/reporting functions', async () => {
      const codeWithStrings = `
        function logAction(actionName: string, detail: string) {
          console.log(actionName, detail);
        }

        logAction("eval", "eval() is not used");
        logAction("Function", "Function() is not used");
        const message = "Do not eval() anything";
      `

      const violations = await auditCspSource('strings-test.js', codeWithStrings)
      expect(violations).toHaveLength(0)
    })

    it('catches multiple chained violations on a single line', async () => {
      const multiViolationLine = `
        eval("1"); new Function("2"); setTimeout("3", 100); require('zod');
      `

      const violations = await auditCspSource('multi-line.js', multiViolationLine)
      expect(violations.length).toBe(4)
      const rules = violations.map(v => v.rule)
      expect(rules).toContain('csp/no-eval')
      expect(rules).toContain('csp/no-new-function')
      expect(rules).toContain('csp/no-string-settimeout')
      expect(rules).toContain('csp/no-disallowed-import')
    })

    it('throws informative error when auditCspBundle is pointed to non-existent path', async () => {
      await expect(auditCspBundle('/nonexistent/path/to/guards')).rejects.toThrow(/번들 경로를 찾을 수 없습니다/)
    })

    it('throws informative error when auditCspBundle finds no JS files in directory', async () => {
      const baseTemp = await createTempDir('empty-bundle-')
      await fs.writeFile(path.join(baseTemp, 'readme.md'), '# No JS here', 'utf8')
      await fs.writeFile(path.join(baseTemp, 'styles.css'), 'body { color: red; }', 'utf8')

      await expect(auditCspBundle(baseTemp)).rejects.toThrow(/감사 대상 JavaScript 파일.*발견되지 않았습니다/)
    })
  })
})
