/**
 * packages/codegen/src/__tests__/challenger-m4-subdirectory.test.ts
 *
 * EMPIRICAL ADVERSARIAL CHALLENGER TEST SUITE (Milestone 4 - Challenger 2)
 *
 * Comprehensive stress testing of:
 * 1. Real-World Browser-Studio Subdirectory CLI Invocation Matrix
 *    - Root (browser-studio)
 *    - Standard package (packages/surface-engine)
 *    - Nested package directory (packages/surface-engine/test)
 *    - Submodule root (packages/browser-mapper)
 *    - Deep nested submodule package (packages/browser-mapper/packages/unified-utils)
 *    - Deep nested submodule package 2 (packages/browser-mapper/packages/browser-mapper)
 *    - Submodule source directory (packages/browser-mapper/packages/unified-utils/src)
 *    Commands:
 *    - oa-gen validate (0 args)
 *    - oa-gen audit:csp --bundle dist/guards
 *    - oa-gen diff --base ... --head ... (identical specs -> 0 breaking)
 *    - oa-gen diff --base ... --head ... (divergent specs -> breaking changes logged)
 *    - oa-gen diff --base ... --head ... --fail-on-breaking (assert exit code 1)
 *
 * 2. Synthetic Arbitrary Deeply Nested Directories (up to 10 levels deep)
 *    - Deep nested within surface-engine
 *    - Deep nested within browser-mapper submodule
 *    - Root resolution detail assertion (tier 3, reason: config, matchedMarker: oa.config.ts)
 *    - Full CLI execution from depth 10
 *
 * 3. Submodule Invariant & Precedence Invariance Under Hostile Scenarios
 *    - Pure submodule isolation (no parent config -> resolves submodule at Tier 4)
 *    - Parent monorepo with oa.config.ts -> bypasses nested pnpm-workspace.yaml & .git (Tier 3)
 *    - Inner submodule with own oa.config.ts -> resolves innermost config (Tier 3)
 *    - Tier 1 explicit argument override (--root, --project-root)
 *    - Tier 2 environment variable override (OA_PROJECT_ROOT)
 *    - Direct pointer to config file (--root /path/to/oa.config.ts -> dirname)
 *
 * 4. Process.cwd Restoration (No CWD Leaks) Under In-Process Execution
 *    - Normal command execution restores process.cwd
 *    - CliExitError failure execution restores process.cwd in finally block
 *    - Unexpected exception execution restores process.cwd in finally block
 *    - 20-iteration rapid random directory walk asserting zero cwd drift
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { execSync, spawnSync } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { fileURLToPath } from 'node:url'
import { findProjectRootDetail, findProjectRoot } from '@oa-sdk/core'
import { runCommand } from '../cli/lib/run.js'
import { validate } from '../cli/commands/validate.js'
import { auditCsp } from '../cli/commands/audit-csp.js'
import { diff } from '../cli/commands/diff.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const browserStudioRoot = '/Users/junwoobang/workflow/browser-studio'
const distCli = path.resolve(__dirname, '../../dist/cli/index.js')
const srcCli = path.resolve(__dirname, '../cli/index.ts')
const cliExecutable = fs.existsSync(distCli) ? `node "${distCli}"` : `npx tsx "${srcCli}"`

// Real-world target directories in browser-studio
const REAL_WORLD_TARGETS = [
  { name: 'Monorepo Root', path: browserStudioRoot },
  { name: 'Standard Package', path: path.join(browserStudioRoot, 'packages/surface-engine') },
  { name: 'Nested Package Directory', path: path.join(browserStudioRoot, 'packages/surface-engine/test') },
  { name: 'Git Submodule Root', path: path.join(browserStudioRoot, 'packages/browser-mapper') },
  { name: 'Deep Submodule Package (unified-utils)', path: path.join(browserStudioRoot, 'packages/browser-mapper/packages/unified-utils') },
  { name: 'Deep Submodule Package (browser-mapper)', path: path.join(browserStudioRoot, 'packages/browser-mapper/packages/browser-mapper') },
  { name: 'Submodule Source Directory', path: path.join(browserStudioRoot, 'packages/browser-mapper/packages/unified-utils/src') },
]

// Synthetic deep directories created during tests
const syntheticDeepSurface = path.join(
  browserStudioRoot,
  'packages/surface-engine/.synthetic-deep-test/d1/d2/d3/d4/d5/d6/d7/d8/d9/d10',
)
const syntheticDeepSubmodule = path.join(
  browserStudioRoot,
  'packages/browser-mapper/packages/unified-utils/.synthetic-deep-test/s1/s2/s3/s4/s5/s6/s7/s8',
)

describe.skipIf(!fs.existsSync(browserStudioRoot))('Adversarial Challenger M4: Subdirectory Conformance & Submodule Invariant', () => {
  beforeAll(() => {
    fs.mkdirSync(syntheticDeepSurface, { recursive: true })
    fs.mkdirSync(syntheticDeepSubmodule, { recursive: true })
  })

  afterAll(() => {
    const cleanup1 = path.join(browserStudioRoot, 'packages/surface-engine/.synthetic-deep-test')
    const cleanup2 = path.join(browserStudioRoot, 'packages/browser-mapper/packages/unified-utils/.synthetic-deep-test')
    if (fs.existsSync(cleanup1)) fs.rmSync(cleanup1, { recursive: true, force: true })
    if (fs.existsSync(cleanup2)) fs.rmSync(cleanup2, { recursive: true, force: true })
  })

  // ===========================================================================
  // Section 1: Real-World Browser-Studio Subdirectory CLI Invocation Matrix
  // ===========================================================================
  describe('1. Real-World Subdirectory CLI Matrix (validate, audit:csp, diff)', () => {
    for (const target of REAL_WORLD_TARGETS) {
      it(`[${target.name}] resolves root to browser-studio with Tier 3 config`, () => {
        const detail = findProjectRootDetail(target.path)
        expect(detail.root).toBe(browserStudioRoot)
        expect(detail.tier).toBe(3)
        expect(detail.reason).toBe('config')
        expect(detail.matchedMarker).toBe('oa.config.ts')
      })

      it(`[${target.name}] executes oa-gen validate (no args)`, () => {
        const stdout = execSync(`${cliExecutable} validate`, {
          cwd: target.path,
          encoding: 'utf8',
        })
        expect(stdout).toContain('Summary: 5 total targets, 5 passed, 0 failed')
        expect(stdout).toContain('Project Root: /Users/junwoobang/workflow/browser-studio')
      })

      it(`[${target.name}] executes oa-gen audit:csp --bundle dist/guards`, () => {
        const stdout = execSync(`${cliExecutable} audit:csp --bundle dist/guards`, {
          cwd: target.path,
          encoding: 'utf8',
        })
        expect(stdout).toContain('0 CSP violations found')
        expect(stdout).toContain('Manifest V3 compliant')
      })

      it(`[${target.name}] executes oa-gen diff (identical specs -> 0 breaking)`, () => {
        const stdout = execSync(
          `${cliExecutable} diff --base artifacts/specs/devlink-contracts.openapi.json --head artifacts/specs/devlink-contracts.openapi.json`,
          {
            cwd: target.path,
            encoding: 'utf8',
          },
        )
        expect(stdout).toContain('No endpoint or schema changes detected')
      })

      it(`[${target.name}] executes oa-gen diff (divergent specs without flag -> exit 0)`, () => {
        const stdout = execSync(
          `${cliExecutable} diff --base artifacts/specs/devlink-contracts.openapi.json --head artifacts/specs/devlink-mcp.openapi.json`,
          {
            cwd: target.path,
            encoding: 'utf8',
          },
        )
        expect(stdout).toContain('Breaking Changes')
        expect(stdout).toContain('endpoint-removed')
      })

      it(`[${target.name}] executes oa-gen diff --fail-on-breaking (assert exit code 1)`, () => {
        let threw = false
        try {
          execSync(
            `${cliExecutable} diff --base artifacts/specs/devlink-contracts.openapi.json --head artifacts/specs/devlink-mcp.openapi.json --fail-on-breaking`,
            {
              cwd: target.path,
              encoding: 'utf8',
              stdio: 'pipe',
            },
          )
        } catch (err: any) {
          threw = true
          expect(err.status).toBe(1)
          expect(err.stdout.toString()).toContain('Breaking Changes')
        }
        expect(threw).toBe(true)
      })
    }
  })

  // ===========================================================================
  // Section 2: Arbitrary Synthetic Deeply Nested Paths
  // ===========================================================================
  describe('2. Arbitrary Synthetic Deeply Nested Paths (depth 8 to 10)', () => {
    beforeEach(() => {
      fs.mkdirSync(syntheticDeepSurface, { recursive: true })
      fs.mkdirSync(syntheticDeepSubmodule, { recursive: true })
    })

    const syntheticTargets = [
      { name: '10-level deep in surface-engine', path: syntheticDeepSurface },
      { name: '8-level deep in browser-mapper submodule', path: syntheticDeepSubmodule },
    ]

    for (const target of syntheticTargets) {
      it(`[${target.name}] resolves root to browser-studio at Tier 3`, () => {
        const detail = findProjectRootDetail(target.path)
        expect(detail.root).toBe(browserStudioRoot)
        expect(detail.tier).toBe(3)
        expect(detail.reason).toBe('config')
        expect(detail.matchedMarker).toBe('oa.config.ts')
      })

      it(`[${target.name}] executes oa-gen validate (no args)`, () => {
        const stdout = execSync(`${cliExecutable} validate`, {
          cwd: target.path,
          encoding: 'utf8',
        })
        expect(stdout).toContain('Summary: 5 total targets, 5 passed, 0 failed')
      })

      it(`[${target.name}] executes oa-gen audit:csp --bundle dist/guards`, () => {
        const stdout = execSync(`${cliExecutable} audit:csp --bundle dist/guards`, {
          cwd: target.path,
          encoding: 'utf8',
        })
        expect(stdout).toContain('0 CSP violations found')
        expect(stdout).toContain('Manifest V3 compliant')
      })

      it(`[${target.name}] executes oa-gen diff from 10-level depth`, () => {
        const stdout = execSync(
          `${cliExecutable} diff --base artifacts/specs/devlink-contracts.openapi.json --head artifacts/specs/devlink-contracts.openapi.json`,
          {
            cwd: target.path,
            encoding: 'utf8',
          },
        )
        expect(stdout).toContain('No endpoint or schema changes detected')
      })
    }
  })

  // ===========================================================================
  // Section 3: Submodule Invariant & Precedence Invariance Under Hostile Scenarios
  // ===========================================================================
  describe('3. Submodule Invariant & Precedence Hierarchy', () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-submodule-invariant-'))
    })

    afterEach(() => {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('isolates pure submodule when no parent config exists (Tier 4 workspace wins)', () => {
      // Setup:
      // tmpDir/ (parent monorepo: pnpm-workspace.yaml, .git/)
      //   submodule/ (pnpm-workspace.yaml, .git/)
      //     deep/dir/
      const parentWorkspace = path.join(tmpDir, 'pnpm-workspace.yaml')
      fs.writeFileSync(parentWorkspace, 'packages:\n  - "submodule"\n')
      fs.mkdirSync(path.join(tmpDir, '.git'))

      const submodDir = path.join(tmpDir, 'submodule')
      fs.mkdirSync(submodDir)
      fs.writeFileSync(path.join(submodDir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n')
      fs.mkdirSync(path.join(submodDir, '.git'))

      const deepDir = path.join(submodDir, 'deep/dir')
      fs.mkdirSync(deepDir, { recursive: true })

      // Without any oa.config.ts, the upward traversal stops at the submodule's pnpm-workspace.yaml (Tier 4)
      const detail = findProjectRootDetail(deepDir)
      expect(detail.root).toBe(submodDir)
      expect(detail.tier).toBe(4)
      expect(detail.reason).toBe('workspace')
    })

    it('submodule invariant: parent oa.config.ts takes precedence across ancestor tree over submodule workspace/.git', () => {
      // Setup:
      // tmpDir/ (parent: oa.config.ts, pnpm-workspace.yaml, .git/)
      //   submodule/ (pnpm-workspace.yaml, .git/)
      //     packages/unified-utils/
      fs.writeFileSync(path.join(tmpDir, 'oa.config.ts'), 'export default {}')
      fs.writeFileSync(path.join(tmpDir, 'pnpm-workspace.yaml'), 'packages:\n  - "submodule"\n')
      fs.mkdirSync(path.join(tmpDir, '.git'))

      const submodDir = path.join(tmpDir, 'submodule')
      fs.mkdirSync(submodDir)
      fs.writeFileSync(path.join(submodDir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n')
      fs.mkdirSync(path.join(submodDir, '.git'))

      const deepPkgDir = path.join(submodDir, 'packages/unified-utils')
      fs.mkdirSync(deepPkgDir, { recursive: true })

      // With oa.config.ts at parent, Tier 3 ancestor scan matches parent root first!
      const detail = findProjectRootDetail(deepPkgDir)
      expect(detail.root).toBe(tmpDir)
      expect(detail.tier).toBe(3)
      expect(detail.reason).toBe('config')
      expect(detail.matchedMarker).toBe('oa.config.ts')
    })

    it('nested submodule with its own oa.config.ts resolves innermost config (closest ancestor wins)', () => {
      fs.writeFileSync(path.join(tmpDir, 'oa.config.ts'), 'export default { rootDir: "parent" }')
      const submodDir = path.join(tmpDir, 'submodule')
      fs.mkdirSync(submodDir)
      fs.writeFileSync(path.join(submodDir, 'oa.config.ts'), 'export default { rootDir: "submodule" }')

      const deepDir = path.join(submodDir, 'packages/inner')
      fs.mkdirSync(deepDir, { recursive: true })

      const detail = findProjectRootDetail(deepDir)
      expect(detail.root).toBe(submodDir)
      expect(detail.tier).toBe(3)
      expect(detail.matchedMarker).toBe('oa.config.ts')
    })

    it('Tier 1: explicitRoot overrides Tier 3 config and submodule markers', () => {
      const deepDir = path.join(browserStudioRoot, 'packages/browser-mapper/packages/unified-utils')
      const explicitTarget = '/tmp/custom-explicit-root'
      const detail = findProjectRootDetail({
        cwd: deepDir,
        explicitRoot: explicitTarget,
      })
      expect(detail.root).toBe(explicitTarget)
      expect(detail.tier).toBe(1)
      expect(detail.reason).toBe('explicit')
    })

    it('Tier 1: explicitRoot pointing to a file resolves dirname', () => {
      const deepDir = path.join(browserStudioRoot, 'packages/surface-engine')
      const configFilePath = path.join(browserStudioRoot, 'oa.config.ts')
      const detail = findProjectRootDetail({
        cwd: deepDir,
        explicitRoot: configFilePath,
      })
      expect(detail.root).toBe(browserStudioRoot)
      expect(detail.tier).toBe(1)
      expect(detail.matchedMarker).toBe('oa.config.ts')
    })

    it('Tier 2: OA_PROJECT_ROOT environment variable overrides Tier 3 config', () => {
      const deepDir = path.join(browserStudioRoot, 'packages/browser-mapper/packages/unified-utils')
      const originalEnv = process.env.OA_PROJECT_ROOT
      try {
        process.env.OA_PROJECT_ROOT = '/tmp/env-root-override'
        const detail = findProjectRootDetail(deepDir)
        expect(detail.root).toBe('/tmp/env-root-override')
        expect(detail.tier).toBe(2)
        expect(detail.reason).toBe('env')
      } finally {
        if (originalEnv !== undefined) {
          process.env.OA_PROJECT_ROOT = originalEnv
        } else {
          delete process.env.OA_PROJECT_ROOT
        }
      }
    })
  })

  // ===========================================================================
  // Section 4: Process.cwd Restoration (No CWD Leaks) Under In-Process Execution
  // ===========================================================================
  describe('4. In-Process process.cwd Restoration (No CWD Leaks)', () => {
    const originalProcessCwd = process.cwd()
    let savedExitCode: string | number | null | undefined

    beforeEach(() => {
      savedExitCode = process.exitCode
    })

    afterEach(() => {
      process.chdir(originalProcessCwd)
      process.exitCode = savedExitCode
    })

    it('restores process.cwd after successful in-process runCommand(validate)', async () => {
      const startCwd = path.join(browserStudioRoot, 'packages/surface-engine')
      process.chdir(startCwd)
      expect(process.cwd()).toBe(startCwd)

      await runCommand(validate, [])

      expect(process.cwd()).toBe(startCwd)
    })

    it('restores process.cwd after successful in-process runCommand(auditCsp)', async () => {
      const startCwd = path.join(browserStudioRoot, 'packages/browser-mapper/packages/unified-utils')
      process.chdir(startCwd)
      expect(process.cwd()).toBe(startCwd)

      await runCommand(auditCsp, ['--bundle', 'dist/guards'])

      expect(process.cwd()).toBe(startCwd)
    })

    it('restores process.cwd after successful in-process runCommand(diff)', async () => {
      const startCwd = path.join(browserStudioRoot, 'packages/browser-mapper')
      process.chdir(startCwd)
      expect(process.cwd()).toBe(startCwd)

      await runCommand(diff, [
        '--base',
        'artifacts/specs/devlink-contracts.openapi.json',
        '--head',
        'artifacts/specs/devlink-contracts.openapi.json',
      ])

      expect(process.cwd()).toBe(startCwd)
    })

    it('restores process.cwd when runCommand catches CliExitError (error path in finally)', async () => {
      const startCwd = path.join(browserStudioRoot, 'packages/surface-engine/test')
      process.chdir(startCwd)
      expect(process.cwd()).toBe(startCwd)

      // audit:csp pointing to non-existent directory triggers CliExitError / error handling
      await runCommand(auditCsp, ['--bundle', 'non-existent-directory-404'])

      expect(process.cwd()).toBe(startCwd)
    })

    it('restores process.cwd when runCommand fails with missing diff specs', async () => {
      const startCwd = path.join(browserStudioRoot, 'packages/surface-engine')
      process.chdir(startCwd)
      expect(process.cwd()).toBe(startCwd)

      await runCommand(diff, [
        '--base',
        'non-existent-spec-1.json',
        '--head',
        'non-existent-spec-2.json',
      ])

      expect(process.cwd()).toBe(startCwd)
    })

    it('stress test: 20-iteration rapid directory walk with zero process.cwd drift', async () => {
      const testDirs = [
        browserStudioRoot,
        path.join(browserStudioRoot, 'packages/surface-engine'),
        path.join(browserStudioRoot, 'packages/browser-mapper'),
        path.join(browserStudioRoot, 'packages/browser-mapper/packages/unified-utils'),
        path.join(browserStudioRoot, 'packages/surface-engine/test'),
      ]

      for (let i = 0; i < 20; i++) {
        const targetDir = testDirs[i % testDirs.length]!
        process.chdir(targetDir)
        expect(process.cwd()).toBe(targetDir)

        // Alternate commands across iterations
        if (i % 3 === 0) {
          await runCommand(diff, [
            '--base',
            'artifacts/specs/devlink-contracts.openapi.json',
            '--head',
            'artifacts/specs/devlink-contracts.openapi.json',
          ])
        } else if (i % 3 === 1) {
          await runCommand(auditCsp, ['--bundle', 'dist/guards'])
        } else {
          // Failure path to stress finally block
          await runCommand(diff, [
            '--base',
            'missing-artifact.json',
            '--head',
            'missing-artifact.json',
          ])
        }

        expect(process.cwd()).toBe(targetDir)
      }
    }, 120_000)
  })
})
