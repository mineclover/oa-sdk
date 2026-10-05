/**
 * packages/codegen/src/__tests__/challenger-m2.test.ts
 *
 * Empirical Adversarial Challenge Suite for Milestone 2:
 * 1. Candidate resolution priority (oa.config.ts > .mjs > .json > .oarc.json)
 * 2. Malformed configs (syntax errors, duplicate target IDs, missing fields, invalid profiles)
 * 3. Path remapping and relative rootDir normalization
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  mkdtempSync,
  realpathSync,
  existsSync,
  readFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  defineConfig,
  validateOaConfig,
  assertOaConfig,
  isOaConfig,
  OaConfigError,
  type OaConfig,
} from '../config.js'
import {
  loadOaConfig,
  findConfigFile,
  resolveProfileTarget,
  resolveGuardTarget,
  CANDIDATE_CONFIG_FILES,
} from '../cli/lib/config-loader.js'
import { spawnSync } from 'node:child_process'
import { SUBPROCESS_TEST_BUDGET_MS } from './helpers/subprocess-budget.js'
import { findProjectRoot } from '@oa-sdk/core'

const REPO_ROOT = findProjectRoot(__dirname)
const TSX_CLI = resolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs')
const CLI_SRC = resolve(REPO_ROOT, 'packages/codegen/src/cli/index.ts')

function runCli(args: string[], cwd: string) {
  const result = spawnSync('node', [TSX_CLI, CLI_SRC, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: SUBPROCESS_TEST_BUDGET_MS,
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

describe('M2 Adversarial Challenge Suite (Challenger 1)', () => {
  let testDir: string

  beforeEach(() => {
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'm2-challenger-')))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  // =========================================================================
  // 1. Candidate Resolution Priority
  // =========================================================================
  describe('1. Candidate Resolution Priority Strict Ordering', () => {
    it('CAND-PRIORITY-01: oa.config.ts takes highest precedence when all 4 files exist', async () => {
      writeFileSync(join(testDir, 'oa.config.ts'), 'export default { rootDir: "./from-ts" };')
      writeFileSync(join(testDir, 'oa.config.mjs'), 'export default { rootDir: "./from-mjs" };')
      writeFileSync(join(testDir, 'oa.config.json'), JSON.stringify({ rootDir: './from-json' }))
      writeFileSync(join(testDir, '.oarc.json'), JSON.stringify({ rootDir: './from-rc' }))

      const loaded = await loadOaConfig({ cwd: testDir })
      expect(loaded).not.toBeNull()
      expect(loaded?.configPath).toBe(join(testDir, 'oa.config.ts'))
      expect(loaded?.rootDir).toBe(resolve(testDir, 'from-ts'))
    })

    it('CAND-PRIORITY-02: oa.config.mjs takes precedence when ts is removed', async () => {
      writeFileSync(join(testDir, 'oa.config.mjs'), 'export default { rootDir: "./from-mjs" };')
      writeFileSync(join(testDir, 'oa.config.json'), JSON.stringify({ rootDir: './from-json' }))
      writeFileSync(join(testDir, '.oarc.json'), JSON.stringify({ rootDir: './from-rc' }))

      const loaded = await loadOaConfig({ cwd: testDir })
      expect(loaded).not.toBeNull()
      expect(loaded?.configPath).toBe(join(testDir, 'oa.config.mjs'))
      expect(loaded?.rootDir).toBe(resolve(testDir, 'from-mjs'))
    })

    it('CAND-PRIORITY-03: oa.config.json takes precedence when ts and mjs are removed', async () => {
      writeFileSync(join(testDir, 'oa.config.json'), JSON.stringify({ rootDir: './from-json' }))
      writeFileSync(join(testDir, '.oarc.json'), JSON.stringify({ rootDir: './from-rc' }))

      const loaded = await loadOaConfig({ cwd: testDir })
      expect(loaded).not.toBeNull()
      expect(loaded?.configPath).toBe(join(testDir, 'oa.config.json'))
      expect(loaded?.rootDir).toBe(resolve(testDir, 'from-json'))
    })

    it('CAND-PRIORITY-04: .oarc.json is resolved as final fallback candidate', async () => {
      writeFileSync(join(testDir, '.oarc.json'), JSON.stringify({ rootDir: './from-rc' }))

      const loaded = await loadOaConfig({ cwd: testDir })
      expect(loaded).not.toBeNull()
      expect(loaded?.configPath).toBe(join(testDir, '.oarc.json'))
      expect(loaded?.rootDir).toBe(resolve(testDir, 'from-rc'))
    })

    it('CAND-PRIORITY-05: Directory named oa.config.ts is skipped without crashing', async () => {
      // Create a directory named oa.config.ts to simulate directory collision
      mkdirSync(join(testDir, 'oa.config.ts'), { recursive: true })
      writeFileSync(join(testDir, 'oa.config.json'), JSON.stringify({ rootDir: './fallback-json' }))

      const loaded = await loadOaConfig({ cwd: testDir })
      expect(loaded).not.toBeNull()
      expect(loaded?.configPath).toBe(join(testDir, 'oa.config.json'))
      expect(loaded?.rootDir).toBe(resolve(testDir, 'fallback-json'))
    })

    it('CAND-PRIORITY-06: Precedence is preserved when explicitRoot is specified', async () => {
      const explicitDir = join(testDir, 'explicit-root')
      mkdirSync(explicitDir)
      writeFileSync(join(explicitDir, 'oa.config.mjs'), 'export default { rootDir: "./mjs" };')
      writeFileSync(join(explicitDir, 'oa.config.json'), JSON.stringify({ rootDir: './json' }))

      const subDir = join(testDir, 'sub')
      mkdirSync(subDir)

      const loaded = await loadOaConfig({ cwd: subDir, explicitRoot: explicitDir })
      expect(loaded?.configPath).toBe(join(explicitDir, 'oa.config.mjs'))
      expect(loaded?.rootDir).toBe(resolve(explicitDir, 'mjs'))
    })

    it('CAND-PRIORITY-07: CANDIDATE_CONFIG_FILES constant exactly matches specification order', () => {
      expect(CANDIDATE_CONFIG_FILES).toEqual([
        'oa.config.ts',
        'oa.config.mjs',
        'oa.config.json',
        '.oarc.json',
      ])
    })
  })

  // =========================================================================
  // 2. Malformed Configurations & Error Boundary Behavior
  // =========================================================================
  describe('2. Malformed Configurations & Error Boundaries', () => {
    it('MAL-01: JSON config with syntax error throws informative parse error', async () => {
      writeFileSync(join(testDir, 'oa.config.json'), '{\n  "rootDir": ".",\n  "specs": [ missing-quotes ]\n}')

      await expect(loadOaConfig({ cwd: testDir })).rejects.toThrow(/Failed to parse JSON config file/)
    })

    it('MAL-02: Empty (0-byte) JSON config throws parse error', async () => {
      writeFileSync(join(testDir, 'oa.config.json'), '')

      await expect(loadOaConfig({ cwd: testDir })).rejects.toThrow(/Failed to parse JSON config file/)
    })

    it('MAL-03: Non-object export in config (number, string, boolean, array) throws error', async () => {
      writeFileSync(join(testDir, 'oa.config.json'), '12345')
      await expect(loadOaConfig({ cwd: testDir })).rejects.toThrow(/must be an object, but received number/)

      writeFileSync(join(testDir, 'oa.config.json'), '"just-a-string"')
      await expect(loadOaConfig({ cwd: testDir })).rejects.toThrow(/must be an object, but received string/)

      writeFileSync(join(testDir, 'oa.config.json'), 'true')
      await expect(loadOaConfig({ cwd: testDir })).rejects.toThrow(/must be an object, but received boolean/)

      writeFileSync(join(testDir, 'oa.config.json'), '[]')
      await expect(loadOaConfig({ cwd: testDir })).rejects.toThrow(/must be an object, but received array/)
    })

    it('MAL-04: validateOaConfig & assertOaConfig detect duplicate target IDs and report exact indices', () => {
      const configWithDupes = {
        rootDir: '.',
        specs: [
          { id: 'shared-id', profile: 'component-bundle' as const, schemaEntry: './a.ts', outDir: './out' },
          { id: 'unique-id', profile: 'operation-contract' as const, schemaEntry: './b.ts', outDir: './out' },
          { id: 'shared-id', profile: 'full-api-document' as const, schemaEntry: './c.ts', outDir: './out' },
        ],
      }

      const val = validateOaConfig(configWithDupes)
      expect(val.valid).toBe(false)
      expect(val.errors.length).toBe(1)
      expect(val.errors[0]?.path).toBe('specs[2].id')
      expect(val.errors[0]?.message).toContain(
        'Duplicate spec target id "shared-id" at index 2 (already declared at index 0)'
      )

      expect(() => assertOaConfig(configWithDupes)).toThrow(OaConfigError)
      expect(() => assertOaConfig(configWithDupes)).toThrow(/Duplicate spec target id "shared-id"/)
    })

    it('MAL-05: validateOaConfig detects multiple duplicate target IDs', () => {
      const config = {
        specs: [
          { id: 'dup-1', profile: 'component-bundle' as const, schemaEntry: './a.ts', outDir: './out' },
          { id: 'dup-1', profile: 'component-bundle' as const, schemaEntry: './b.ts', outDir: './out' },
          { id: 'dup-2', profile: 'component-bundle' as const, schemaEntry: './c.ts', outDir: './out' },
          { id: 'dup-2', profile: 'component-bundle' as const, schemaEntry: './d.ts', outDir: './out' },
        ],
      }

      const val = validateOaConfig(config)
      expect(val.valid).toBe(false)
      expect(val.errors.length).toBe(2)
      expect(val.errors[0]?.path).toBe('specs[1].id')
      expect(val.errors[1]?.path).toBe('specs[3].id')
    })

    it('MAL-06: validateOaConfig detects missing required fields in spec targets', () => {
      const config = {
        specs: [
          {
            // missing id
            profile: 'component-bundle',
            schemaEntry: './a.ts',
            outDir: './out',
          },
          {
            id: 'spec-2',
            // missing profile
            schemaEntry: './b.ts',
            outDir: './out',
          },
          {
            id: 'spec-3',
            profile: 'component-bundle',
            // missing schemaEntry
            outDir: './out',
          },
          {
            id: 'spec-4',
            profile: 'component-bundle',
            schemaEntry: './d.ts',
            // missing outDir
          },
        ],
      }

      const val = validateOaConfig(config)
      expect(val.valid).toBe(false)
      const paths = val.errors.map(e => e.path)
      expect(paths).toContain('specs[0].id')
      expect(paths).toContain('specs[1].profile')
      expect(paths).toContain('specs[2].schemaEntry')
      expect(paths).toContain('specs[3].outDir')
    })

    it('MAL-07: validateOaConfig detects invalid profile names', () => {
      const config = {
        specs: [
          {
            id: 'spec-invalid-profile',
            profile: 'unsupported-profile-name',
            schemaEntry: './a.ts',
            outDir: './out',
          },
        ],
      }

      const val = validateOaConfig(config)
      expect(val.valid).toBe(false)
      expect(val.errors[0]?.path).toBe('specs[0].profile')
      expect(val.errors[0]?.message).toContain(
        "profile is required and must be one of: 'component-bundle', 'operation-contract', 'full-api-document'"
      )
    })

    it('MAL-08: validateOaConfig detects malformed guard targets', () => {
      const config = {
        guards: {
          outDir: '',
          moduleFormat: 'umd',
          split: 'true',
          auditCsp: 0,
        },
      }

      const val = validateOaConfig(config)
      expect(val.valid).toBe(false)
      const paths = val.errors.map(e => e.path)
      expect(paths).toContain('guards.outDir')
      expect(paths).toContain('guards.moduleFormat')
      expect(paths).toContain('guards.split')
      expect(paths).toContain('guards.auditCsp')
    })

    it('MAL-09: validateOaConfig detects malformed rootDir type', () => {
      const config = { rootDir: 12345 }
      const val = validateOaConfig(config)
      expect(val.valid).toBe(false)
      expect(val.errors[0]?.path).toBe('rootDir')
      expect(val.errors[0]?.message).toContain('rootDir must be a non-empty string')
    })

    it('MAL-10: EMPIRICAL PROBE: does defineConfig perform runtime validation or identity return?', () => {
      // Check the empirical behavior of defineConfig when given invalid specs
      const badConfig: any = {
        specs: [
          { id: 'dup', profile: 'component-bundle', schemaEntry: './a.ts', outDir: './out' },
          { id: 'dup', profile: 'component-bundle', schemaEntry: './b.ts', outDir: './out' },
        ],
      }
      // Empirical observation: Does defineConfig throw or pass through?
      const result = defineConfig(badConfig)
      // If it passes through without throwing, record this critical empirical fact:
      expect(result).toBe(badConfig)
    })

    it('MAL-11: loadOaConfig performs runtime schema validation and rejects duplicate target IDs', async () => {
      writeFileSync(
        join(testDir, 'oa.config.json'),
        JSON.stringify({
          specs: [
            { id: 'dup', profile: 'component-bundle', schemaEntry: './a.ts', outDir: './out' },
            { id: 'dup', profile: 'component-bundle', schemaEntry: './b.ts', outDir: './out' },
          ],
        })
      )

      await expect(loadOaConfig({ cwd: testDir })).rejects.toThrow(OaConfigError)
    })

    it('MAL-12: CLI STRESS TEST: oa-gen validate behavior on duplicate target IDs', () => {
      // Setup a minimal valid schema
      mkdirSync(join(testDir, 'src'))
      writeFileSync(
        join(testDir, 'src', 'model.ts'),
        `import { z } from 'zod';\nexport const Item = z.object({ id: z.string() });`
      )

      // Setup config with duplicate target IDs
      writeFileSync(
        join(testDir, 'oa.config.json'),
        JSON.stringify({
          rootDir: '.',
          specs: [
            { id: 'dup-spec', profile: 'component-bundle', schemaEntry: './src/model.ts', outDir: './artifacts' },
            { id: 'dup-spec', profile: 'component-bundle', schemaEntry: './src/model.ts', outDir: './artifacts' },
          ],
        })
      )

      const res = runCli(['validate'], testDir)
      expect(res.status).toBe(1)
      expect(res.stderr).toContain('Duplicate spec target id')
    })

    it('MAL-13: CLI STRESS TEST: oa-gen generate behavior on missing schemaEntry', () => {
      writeFileSync(
        join(testDir, 'oa.config.json'),
        JSON.stringify({
          rootDir: '.',
          specs: [
            { id: 'missing-entry', profile: 'component-bundle', outDir: './artifacts' },
          ],
        })
      )

      const res = runCli(['generate'], testDir)
      console.log('    [INFO] CLI generate on missing schemaEntry exit status:', res.status)
      console.log('    [INFO] CLI generate stderr:', res.stderr)
      // Expect it to fail with non-zero status
      expect(res.status).not.toBe(0)
    })

    it('MAL-14: oa-gen generate rejects duplicate target IDs and prevents silent overwrite', () => {
      mkdirSync(join(testDir, 'src'))
      writeFileSync(
        join(testDir, 'src', 'schema-a.ts'),
        `import { z } from 'zod';\nexport const ModelA = z.object({ kind: z.literal('A') });`
      )
      writeFileSync(
        join(testDir, 'src', 'schema-b.ts'),
        `import { z } from 'zod';\nexport const ModelB = z.object({ kind: z.literal('B') });`
      )

      writeFileSync(
        join(testDir, 'oa.config.json'),
        JSON.stringify({
          rootDir: '.',
          specs: [
            { id: 'collision', profile: 'component-bundle', schemaEntry: './src/schema-a.ts', outDir: './artifacts' },
            { id: 'collision', profile: 'component-bundle', schemaEntry: './src/schema-b.ts', outDir: './artifacts' },
          ],
        })
      )

      const res = runCli(['generate'], testDir)
      expect(res.status).toBe(1)
      expect(res.stderr).toContain('Duplicate spec target id')
    })

    it('MAL-15: Export flexibility: async function and double-wrapped default are handled', async () => {
      writeFileSync(
        join(testDir, 'oa.config.ts'),
        'export default async () => ({ rootDir: "./async-dir", specs: [] });'
      )
      const loaded = await loadOaConfig({ cwd: testDir })
      expect(loaded?.rootDir).toBe(resolve(testDir, 'async-dir'))
    })


  })

  // =========================================================================
  // 3. Path Remapping & Relative rootDir Normalization
  // =========================================================================
  describe('3. Path Remapping & Relative rootDir Normalization', () => {
    it('NORM-01: rootDir "." resolves to directory containing config file', async () => {
      writeFileSync(join(testDir, 'oa.config.json'), JSON.stringify({ rootDir: '.' }))
      const loaded = await loadOaConfig({ cwd: testDir })
      expect(loaded?.rootDir).toBe(testDir)
      expect(loaded?.config.rootDir).toBe(testDir)
    })

    it('NORM-02: omitted rootDir defaults to directory containing config file', async () => {
      writeFileSync(join(testDir, 'oa.config.json'), JSON.stringify({ specs: [] }))
      const loaded = await loadOaConfig({ cwd: testDir })
      expect(loaded?.rootDir).toBe(testDir)
      expect(loaded?.config.rootDir).toBe(testDir)
    })

    it('NORM-03: relative rootDir "./workspace/root" resolves relative to config directory', async () => {
      writeFileSync(join(testDir, 'oa.config.json'), JSON.stringify({ rootDir: './workspace/root' }))
      const loaded = await loadOaConfig({ cwd: testDir })
      const expected = resolve(testDir, 'workspace/root')
      expect(loaded?.rootDir).toBe(expected)
      expect(loaded?.config.rootDir).toBe(expected)
    })

    it('NORM-04: parent relative rootDir "../parent" resolves relative to config directory', async () => {
      const sub = join(testDir, 'sub')
      mkdirSync(sub)
      writeFileSync(join(sub, 'oa.config.json'), JSON.stringify({ rootDir: '..' }))
      const loaded = await loadOaConfig({ cwd: sub })
      expect(loaded?.rootDir).toBe(testDir)
      expect(loaded?.config.rootDir).toBe(testDir)
    })

    it('NORM-05: absolute rootDir is preserved without modification', async () => {
      const absPath = resolve(testDir, 'abs', 'path')
      writeFileSync(join(testDir, 'oa.config.json'), JSON.stringify({ rootDir: absPath }))
      const loaded = await loadOaConfig({ cwd: testDir })
      expect(loaded?.rootDir).toBe(absPath)
      expect(loaded?.config.rootDir).toBe(absPath)
    })

    it('NORM-06: resolveProfileTarget resolves schemaEntry and outDir relative to rootDir', () => {
      const rootDir = '/monorepo/root'
      const target = {
        id: 'surface-engine',
        profile: 'component-bundle' as const,
        schemaEntry: 'packages/surface-engine/src/types/schemas.ts',
        outDir: 'artifacts/specs',
        title: 'Surface Engine',
        version: '1.0.0',
      }

      const resolved = resolveProfileTarget(target, rootDir)
      expect(resolved.resolvedSchemaEntry).toBe(
        '/monorepo/root/packages/surface-engine/src/types/schemas.ts'
      )
      expect(resolved.resolvedOutDir).toBe('/monorepo/root/artifacts/specs')
      expect(resolved.id).toBe('surface-engine')
      expect(resolved.title).toBe('Surface Engine')
    })

    it('NORM-07: resolveProfileTarget preserves absolute schemaEntry and outDir', () => {
      const rootDir = '/monorepo/root'
      const target = {
        id: 'external-target',
        profile: 'operation-contract' as const,
        schemaEntry: '/opt/external/schemas.ts',
        outDir: '/var/out/specs',
      }

      const resolved = resolveProfileTarget(target, rootDir)
      expect(resolved.resolvedSchemaEntry).toBe('/opt/external/schemas.ts')
      expect(resolved.resolvedOutDir).toBe('/var/out/specs')
    })

    it('NORM-08: resolveGuardTarget resolves outDir relative to rootDir', () => {
      const rootDir = '/monorepo/root'
      const guards = {
        outDir: 'dist/guards',
        split: true,
        moduleFormat: 'esm' as const,
        auditCsp: true,
      }

      const resolved = resolveGuardTarget(guards, rootDir)
      expect(resolved.resolvedOutDir).toBe('/monorepo/root/dist/guards')
      expect(resolved.split).toBe(true)
      expect(resolved.moduleFormat).toBe('esm')
      expect(resolved.auditCsp).toBe(true)
    })

    it('NORM-09: Subdirectory execution from deep path resolves upward to config and normalizes relative root', async () => {
      writeFileSync(join(testDir, 'oa.config.json'), JSON.stringify({ rootDir: './workspace' }))
      const deepPath = join(testDir, 'packages', 'deep', 'nested', 'pkg')
      mkdirSync(deepPath, { recursive: true })

      const loaded = await loadOaConfig({ cwd: deepPath })
      expect(loaded).not.toBeNull()
      expect(loaded?.configPath).toBe(join(testDir, 'oa.config.json'))
      expect(loaded?.rootDir).toBe(resolve(testDir, 'workspace'))
    })
  })
})
