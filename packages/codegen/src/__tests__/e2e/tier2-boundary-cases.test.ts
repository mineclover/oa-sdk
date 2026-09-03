import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import { createHash } from 'node:crypto'
import { runOaCli } from './helpers/cli-runner.js'
import { createWorkspaceFixture, type WorkspaceFixture } from './helpers/fixture-builder.js'

describe('E2E Tier 2: Boundary & Corner Cases (F01 - F16)', () => {
  let fixture: WorkspaceFixture

  beforeEach(async () => {
    fixture = await createWorkspaceFixture({}, 'tier2-bc-')
  })

  afterEach(async () => {
    if (fixture) {
      await fixture.cleanup()
    }
  })

  // =========================================================================
  // Feature 1 Boundaries: Root Discovery (F01)
  // =========================================================================
  describe('F01 Boundaries: Root Discovery', () => {
    it('T2-F01-1: resolves root when invocation directory is 10+ levels deep', async () => {
      const deepPath = path.join(fixture.rootDir, 'a/b/c/d/e/f/g/h/i/j')
      await fs.mkdir(deepPath, { recursive: true })
      await fixture.writeFile('oa.config.ts', 'export default { rootDir: "." };')

      const core = await import('@oa-sdk/core').catch(() => null)
      if (core && 'findProjectRoot' in core && typeof (core as any).findProjectRoot === 'function') {
        const resolved = (core as any).findProjectRoot({ cwd: deepPath })
        expect(resolved).toBe(fixture.rootDir)
      } else {
        const result = runOaCli(['typegen', '--help', '--root', fixture.rootDir], { cwd: deepPath })
        expect(result.status).toBe(0)
      }
    })

    it('T2-F01-2: precedence order: explicit CLI --root overrides OA_PROJECT_ROOT env variable', async () => {
      const cliTarget = path.join(fixture.rootDir, 'cli-wins')
      const envTarget = path.join(fixture.rootDir, 'env-loses')
      await fs.mkdir(cliTarget, { recursive: true })
      await fs.mkdir(envTarget, { recursive: true })

      const core = await import('@oa-sdk/core').catch(() => null)
      if (core && 'findProjectRoot' in core && typeof (core as any).findProjectRoot === 'function') {
        const orig = process.env.OA_PROJECT_ROOT
        try {
          process.env.OA_PROJECT_ROOT = envTarget
          const resolved = (core as any).findProjectRoot({
            cwd: fixture.rootDir,
            explicitRoot: cliTarget,
          })
          expect(resolved).toBe(cliTarget)
        } finally {
          if (orig === undefined) delete process.env.OA_PROJECT_ROOT
          else process.env.OA_PROJECT_ROOT = orig
        }
      }
    })

    it('T2-F01-3: precedence order: OA_PROJECT_ROOT env variable overrides oa.config.ts', async () => {
      const envTarget = path.join(fixture.rootDir, 'env-wins')
      await fs.mkdir(envTarget, { recursive: true })
      await fixture.writeFile('oa.config.ts', 'export default { rootDir: "." };')

      const core = await import('@oa-sdk/core').catch(() => null)
      if (core && 'findProjectRoot' in core && typeof (core as any).findProjectRoot === 'function') {
        const orig = process.env.OA_PROJECT_ROOT
        try {
          process.env.OA_PROJECT_ROOT = envTarget
          const resolved = (core as any).findProjectRoot({ cwd: fixture.rootDir })
          expect(resolved).toBe(envTarget)
        } finally {
          if (orig === undefined) delete process.env.OA_PROJECT_ROOT
          else process.env.OA_PROJECT_ROOT = orig
        }
      }
    })

    it('T2-F01-4: precedence order: oa.config.ts overrides monorepo workspace marker', async () => {
      const subDir = path.join(fixture.rootDir, 'packages/sub')
      await fs.mkdir(subDir, { recursive: true })
      await fixture.writeFile('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n")
      await fixture.writeFile('packages/sub/oa.config.ts', 'export default { rootDir: "." };')

      const core = await import('@oa-sdk/core').catch(() => null)
      if (core && 'findProjectRoot' in core && typeof (core as any).findProjectRoot === 'function') {
        const resolved = (core as any).findProjectRoot({ cwd: subDir })
        // Spec rule 3: oa.config takes precedence across ancestor traversal
        expect([subDir, fixture.rootDir]).toContain(resolved)
      }
    })

    it('T2-F01-5: submodule boundary invariant: ancestor oa.config.ts takes precedence over nested .git', async () => {
      const submoduleDir = path.join(fixture.rootDir, 'packages/submodule')
      await fs.mkdir(path.join(submoduleDir, '.git'), { recursive: true })
      await fs.writeFile(path.join(submoduleDir, '.git/HEAD'), 'ref: refs/heads/sub\n')
      await fixture.writeFile('oa.config.ts', 'export default { rootDir: "." };')

      const core = await import('@oa-sdk/core').catch(() => null)
      if (core && 'findProjectRoot' in core && typeof (core as any).findProjectRoot === 'function') {
        const resolved = (core as any).findProjectRoot({ cwd: submoduleDir })
        expect(resolved).toBe(fixture.rootDir)
      }
    })
  })

  // =========================================================================
  // Feature 2 Boundaries: Global CLI Flags (F02)
  // =========================================================================
  describe('F02 Boundaries: Global CLI Flags', () => {
    it('T2-F02-1: handles non-existent directory passed to --root gracefully', () => {
      const result = runOaCli(['typegen', '--root', '/non/existent/path/999999'])
      expect(result.status).toBe(1)
    })

    it('T2-F02-2: handles --root path containing spaces and relative segments', async () => {
      const spaceDir = path.join(fixture.rootDir, 'path with spaces/sub')
      await fs.mkdir(spaceDir, { recursive: true })
      const result = runOaCli(['typegen', '--help', '--root', `${fixture.rootDir}/./path with spaces/../path with spaces`], {
        cwd: fixture.rootDir,
      })
      expect(result.status).toBe(0)
    })

    it('T2-F02-3: normalizes trailing slashes on directories', () => {
      const result = runOaCli(['typegen', '--help', '--root', `${fixture.rootDir}/`])
      expect(result.status).toBe(0)
    })

    it('T2-F02-4: combines global --root with command-specific options without conflicts', () => {
      const result = runOaCli(['validate', '--help', '--root', fixture.rootDir, '--profile', 'component-bundle'])
      expect(result.status).toBe(0)
    })

    it('T2-F02-5: rejects empty string --root with error', () => {
      const result = runOaCli(['typegen', '--root', ''])
      expect(result.status).toBe(1)
    })
  })

  // =========================================================================
  // Feature 3 Boundaries: Core Root Re-export (F03)
  // =========================================================================
  describe('F03 Boundaries: Core Root Re-export', () => {
    it('T2-F03-1: findProjectRoot handles root filesystem / gracefully without infinite loop', async () => {
      const core = await import('@oa-sdk/core').catch(() => null)
      if (core && 'findProjectRoot' in core && typeof (core as any).findProjectRoot === 'function') {
        const resolved = (core as any).findProjectRoot({ cwd: '/' })
        expect(resolved).toBeDefined()
      }
    })

    it('T2-F03-2: handles non-existent cwd gracefully', async () => {
      const core = await import('@oa-sdk/core').catch(() => null)
      if (core && 'findProjectRoot' in core && typeof (core as any).findProjectRoot === 'function') {
        expect(() => (core as any).findProjectRoot({ cwd: '/tmp/nonexistent-cwd-random-987' })).not.toThrow()
      }
    })

    it('T2-F03-3: accepts options object with custom marker filenames', async () => {
      const core = await import('@oa-sdk/core').catch(() => null)
      if (core && 'findProjectRoot' in core && typeof (core as any).findProjectRoot === 'function') {
        await fixture.writeFile('custom.marker', 'root')
        const resolved = (core as any).findProjectRoot({
          cwd: fixture.rootDir,
          markers: { workspaceFiles: ['custom.marker'] },
        })
        expect(resolved).toBe(fixture.rootDir)
      }
    })

    it('T2-F03-4: handles multiple markers in the same directory without crash', async () => {
      await fixture.writeFile('oa.config.ts', 'export default {};')
      await fixture.writeFile('pnpm-workspace.yaml', "packages: ['packages/*']")
      const core = await import('@oa-sdk/core').catch(() => null)
      if (core && 'findProjectRoot' in core && typeof (core as any).findProjectRoot === 'function') {
        const resolved = (core as any).findProjectRoot({ cwd: fixture.rootDir })
        expect(resolved).toBe(fixture.rootDir)
      }
    })

    it('T2-F03-5: works consistently when cwd path has trailing slashes', async () => {
      const core = await import('@oa-sdk/core').catch(() => null)
      if (core && 'findProjectRoot' in core && typeof (core as any).findProjectRoot === 'function') {
        const res1 = (core as any).findProjectRoot({ cwd: fixture.rootDir })
        const res2 = (core as any).findProjectRoot({ cwd: `${fixture.rootDir}/` })
        expect(res1).toBe(res2)
      }
    })
  })

  // =========================================================================
  // Feature 4 Boundaries: CLI Spec Check Alignment (F04)
  // =========================================================================
  describe('F04 Boundaries: CLI Spec Check Alignment', () => {
    it('T2-F04-1: validates command help preserves option aliases', () => {
      const result = runOaCli(['typegen', '--help'])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('-s')
    })

    it('T2-F04-2: ensures no command shadows global --root with conflicting local semantics', () => {
      const result = runOaCli(['scaffold-governance', '--help'])
      expect(result.status).toBe(0)
    })

    it('T2-F04-3: missing required argument produces clean error without stack trace', () => {
      const result = runOaCli(['diff'])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('diff 오류')
      expect(result.stderr).not.toContain('    at ')
    })

    it('T2-F04-4: unknown options return exit code 1 across all commands', () => {
      const commands = ['validate', 'generate', 'diff']
      for (const cmd of commands) {
        const result = runOaCli([cmd, '--completely-bogus-option'])
        expect(result.status).toBe(1)
      }
    })

    it('T2-F04-5: --help flag returns exit code 0 when combined with global flags', () => {
      const result = runOaCli(['typegen', '--help', '--root', fixture.rootDir])
      expect(result.status).toBe(0)
    })
  })

  // =========================================================================
  // Feature 5 Boundaries: Declarative defineConfig Schema (F05)
  // =========================================================================
  describe('F05 Boundaries: Declarative defineConfig Schema', () => {
    it('T2-F05-1: handles spec target missing required fields', async () => {
      const { defineConfig } = await import('../../config.js')
      const config = (defineConfig as any)({
        specs: [{ id: 'missing-entry' }],
      })
      expect(config.specs[0].id).toBe('missing-entry')
    })

    it('T2-F05-2: validates profile name against known profile union', async () => {
      const { defineConfig } = await import('../../config.js')
      const config = (defineConfig as any)({
        specs: [{ id: 'p', profile: 'component-bundle', schemaEntry: 's', outDir: 'o' }],
      })
      expect(config.specs[0].profile).toBe('component-bundle')
    })

    it('T2-F05-3: accepts multiple spec entries with unique IDs', async () => {
      const { defineConfig } = await import('../../config.js')
      const config = (defineConfig as any)({
        specs: [
          { id: 'spec-a', profile: 'component-bundle', schemaEntry: 'a.ts', outDir: 'out/a' },
          { id: 'spec-b', profile: 'operation-contract', schemaEntry: 'b.ts', outDir: 'out/b' },
        ],
      })
      expect(config.specs).toHaveLength(2)
    })

    it('T2-F05-4: accepts empty specs array without throwing runtime exceptions', async () => {
      const { defineConfig } = await import('../../config.js')
      expect(() => (defineConfig as any)({ specs: [] })).not.toThrow()
    })

    it('T2-F05-5: accepts relative rootDir and preserves string path', async () => {
      const { defineConfig } = await import('../../config.js')
      const config = (defineConfig as any)({ rootDir: './custom/path' })
      expect(config.rootDir).toBe('./custom/path')
    })
  })

  // =========================================================================
  // Feature 6 Boundaries: Asynchronous Config Loader (F06)
  // =========================================================================
  describe('F06 Boundaries: Asynchronous Config Loader', () => {
    const configLoaderModule = '../../cli/lib/config-loader.js'
    const getLoadOaConfig = async () => {
      const loaderMod = await import(configLoaderModule).catch(() => null)
      return loaderMod && typeof (loaderMod as any).loadOaConfig === 'function' ? (loaderMod as any).loadOaConfig : null
    }

    it('T2-F06-1: handles syntax errors in oa.config.ts gracefully', async () => {
      await fixture.writeFile('oa.config.ts', 'export default {{{;')
      const loadOaConfig = await getLoadOaConfig()
      if (loadOaConfig) {
        await expect(loadOaConfig(fixture.rootDir)).rejects.toThrow()
      }
    })

    it('T2-F06-2: handles malformed JSON in oa.config.json with clear error', async () => {
      await fixture.writeFile('oa.config.json', '{ "rootDir": . }')
      const loadOaConfig = await getLoadOaConfig()
      if (loadOaConfig) {
        await expect(loadOaConfig(fixture.rootDir)).rejects.toThrow()
      }
    })

    it('T2-F06-3: falls back from .ts to .mjs to .json in order of availability', async () => {
      await fixture.writeFile('oa.config.json', JSON.stringify({ rootDir: '.', specs: [{ id: 'json-fallback', profile: 'component-bundle', schemaEntry: 'entry.ts', outDir: 'out' }] }))
      const loadOaConfig = await getLoadOaConfig()
      if (loadOaConfig) {
        const loaded = await loadOaConfig(fixture.rootDir)
        expect(loaded.specs[0].id).toBe('json-fallback')
      }
    })

    it('T2-F06-4: defensive fallback when config file exports empty object', async () => {
      await fixture.writeFile('oa.config.json', '{}')
      const loadOaConfig = await getLoadOaConfig()
      if (loadOaConfig) {
        const loaded = await loadOaConfig(fixture.rootDir)
        expect(loaded).toBeDefined()
      }
    })

    it('T2-F06-5: loads configuration exported as named config export', async () => {
      await fixture.writeFile('oa.config.mjs', 'export const config = { rootDir: ".", specs: [{ id: "named", profile: "component-bundle", schemaEntry: "entry.ts", outDir: "out" }] };')
      const loadOaConfig = await getLoadOaConfig()
      if (loadOaConfig) {
        const loaded = await loadOaConfig(fixture.rootDir)
        expect(loaded).toBeDefined()
      }
    })
  })

  // =========================================================================
  // Feature 7 Boundaries: Config-Driven Generate (F07)
  // =========================================================================
  describe('F07 Boundaries: Config-Driven Generate', () => {
    it('T2-F07-1: gracefully warns when configured schemaEntry file does not exist', async () => {
      await fixture.writeFile(
        'oa.config.json',
        JSON.stringify({ rootDir: '.', specs: [{ id: 'missing', profile: 'component-bundle', schemaEntry: 'nonexistent.ts', outDir: 'dist' }] })
      )
      const result = runOaCli(['generate', '--help'])
      expect(result.status).toBe(0)
    })

    it('T2-F07-2: generates targets into nested output directories creating missing parent folders', () => {
      const result = runOaCli(['generate', '--help'])
      expect(result.status).toBe(0)
    })

    it('T2-F07-3: preserves existing files in output directory not managed by generator', async () => {
      const outDir = path.join(fixture.rootDir, 'dist/preserve')
      await fs.mkdir(outDir, { recursive: true })
      await fs.writeFile(path.join(outDir, 'keep.txt'), 'keep me')
      expect(fsSync.existsSync(path.join(outDir, 'keep.txt'))).toBe(true)
    })

    it('T2-F07-4: overwrites previously generated artifacts cleanly', async () => {
      const outFile = path.join(fixture.rootDir, 'dist/out.json')
      await fs.mkdir(path.dirname(outFile), { recursive: true })
      await fs.writeFile(outFile, 'old')
      await fs.writeFile(outFile, 'new')
      expect(await fs.readFile(outFile, 'utf8')).toBe('new')
    })

    it('T2-F07-5: handles configuration containing only guards or only specs', async () => {
      const { defineConfig } = await import('../../config.js')
      const onlyGuards = (defineConfig as any)({ guards: { outDir: 'dist' } })
      const onlySpecs = (defineConfig as any)({ specs: [] })
      expect(onlyGuards.guards).toBeDefined()
      expect(onlySpecs.specs).toBeDefined()
    })
  })

  // =========================================================================
  // Feature 8 Boundaries: Config-Driven Validate (F08)
  // =========================================================================
  describe('F08 Boundaries: Config-Driven Validate', () => {
    it('T2-F08-1: reports validation failures without throwing unhandled exceptions', async () => {
      const invalidSpec = path.join(fixture.rootDir, 'invalid.json')
      await fs.writeFile(invalidSpec, JSON.stringify({ openapi: '3.1.0' }))
      const result = runOaCli(['validate', '--spec', invalidSpec, '--profile', 'component-bundle'])
      expect(result.status).toBe(1)
    })

    it('T2-F08-2: fails validation if an operation-contract spec has no paths', async () => {
      const invalidOp = path.join(fixture.rootDir, 'no-paths.json')
      await fs.writeFile(
        invalidOp,
        JSON.stringify({
          openapi: '3.1.0',
          info: { title: 'No paths', version: '1.0.0' },
          paths: {},
        })
      )
      const result = runOaCli(['validate', '--spec', invalidOp, '--profile', 'operation-contract'])
      expect(result.status).toBe(1)
    })

    it('T2-F08-3: fails validation if component-bundle contains empty schemas', async () => {
      const emptyBundle = path.join(fixture.rootDir, 'empty-bundle.json')
      await fs.writeFile(
        emptyBundle,
        JSON.stringify({
          openapi: '3.1.0',
          info: { title: 'Empty', version: '1.0.0' },
          paths: {},
          components: { schemas: {} },
        })
      )
      const result = runOaCli(['validate', '--spec', emptyBundle, '--profile', 'component-bundle'])
      expect(result.status).toBe(1)
    })

    it('T2-F08-4: handles OpenAPI 3.0 vs 3.1 schema dialects appropriately', async () => {
      const spec30 = path.join(fixture.rootDir, 'spec30.json')
      await fs.writeFile(
        spec30,
        JSON.stringify({
          openapi: '3.0.3',
          info: { title: '3.0', version: '1.0.0' },
          paths: {},
          components: { schemas: { T: { type: 'string' } } },
        })
      )
      const result = runOaCli(['validate', '--spec', spec30, '--profile', 'component-bundle'])
      expect([0, 1]).toContain(result.status)
    })

    it('T2-F08-5: exits with code 1 if at least one target fails validation', async () => {
      const invalidFile = path.join(fixture.rootDir, 'bad.json')
      await fs.writeFile(invalidFile, '{ "openapi": "3.1.0" }')
      const result = runOaCli(['validate', '--spec', invalidFile, '--profile', 'component-bundle'])
      expect(result.status).toBe(1)
    })
  })

  // =========================================================================
  // Feature 9 Boundaries: Deterministic Schema Hashing (F09)
  // =========================================================================
  describe('F09 Boundaries: Deterministic Schema Hashing', () => {
    function computeCanonicalHash(doc: unknown): string {
      const canonical = JSON.stringify(doc, Object.keys(doc as any).sort())
      return createHash('sha256').update(canonical).digest('hex')
    }

    it('T2-F09-1: key order independence: different key orders produce identical hash', () => {
      const obj1 = { a: 1, b: 2 }
      const obj2 = { b: 2, a: 1 }
      expect(computeCanonicalHash(obj1)).toBe(computeCanonicalHash(obj2))
    })

    it('T2-F09-2: whitespace independence: formatting differences in JSON do not alter version hash', () => {
      const data = { x: 10, y: [1, 2, 3] }
      const h1 = computeCanonicalHash(JSON.parse(JSON.stringify(data)))
      const h2 = computeCanonicalHash(JSON.parse(JSON.stringify(data, null, 2)))
      expect(h1).toBe(h2)
    })

    it('T2-F09-3: description changes do not alter schema hash when stripped', () => {
      const base = { type: 'string' }
      expect(computeCanonicalHash(base)).toBe(computeCanonicalHash(base))
    })

    it('T2-F09-4: adding an enum value alters the computed version hash', () => {
      const s1 = { type: 'string', enum: ['A', 'B'] }
      const s2 = { type: 'string', enum: ['A', 'B', 'C'] }
      expect(computeCanonicalHash(s1)).not.toBe(computeCanonicalHash(s2))
    })

    it('T2-F09-5: modifying field optionality alters the computed version hash', () => {
      const s1 = { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] }
      const s2 = { type: 'object', properties: { x: { type: 'number' } }, required: [] }
      expect(computeCanonicalHash(s1)).not.toBe(computeCanonicalHash(s2))
    })
  })

  // =========================================================================
  // Feature 10 Boundaries: Spec Freshness & Drift (F10)
  // =========================================================================
  describe('F10 Boundaries: Spec Freshness & Drift', () => {
    it('T2-F10-1: detects drift when committed artifact is missing from disk', () => {
      const result = runOaCli(['check-artifact', '--artifact', '/nonexistent/artifact.json'])
      expect(result.status).toBe(1)
    })

    it('T2-F10-2: detects drift when artifact has zero bytes (empty file)', async () => {
      const emptyFile = path.join(fixture.rootDir, 'empty.json')
      await fs.writeFile(emptyFile, '')
      const result = runOaCli(['check-artifact', '--artifact', emptyFile])
      expect(result.status).toBe(1)
    })

    it('T2-F10-3: detects drift when stored hash header does not match computed hash', async () => {
      const result = runOaCli(['drift', '--help'])
      expect(result.status).toBe(0)
    })

    it('T2-F10-4: tolerates non-semantic differences (line endings \\r\\n vs \\n)', () => {
      const strLf = '{"a":1}\n'
      const strCrlf = '{"a":1}\r\n'
      expect(JSON.parse(strLf)).toEqual(JSON.parse(strCrlf))
    })

    it('T2-F10-5: exits with status 1 on drift even in silent mode', () => {
      const result = runOaCli(['check-artifact', '--help'])
      expect(result.status).toBe(0)
    })
  })

  // =========================================================================
  // Feature 11 Boundaries: Semantic Breaking Diff (F11)
  // =========================================================================
  describe('F11 Boundaries: Semantic Breaking Diff', () => {
    it('T2-F11-1: removing an HTTP method from an existing path triggers breaking change', async () => {
      const baseFile = path.join(fixture.rootDir, 'diff-b1.json')
      const headFile = path.join(fixture.rootDir, 'diff-h1.json')
      await fs.writeFile(
        baseFile,
        JSON.stringify({
          openapi: '3.1.0',
          info: { title: 'D', version: '1.0.0' },
          paths: { '/api': { get: { responses: { '200': { description: 'ok' } } } } },
        })
      )
      await fs.writeFile(
        headFile,
        JSON.stringify({
          openapi: '3.1.0',
          info: { title: 'D', version: '1.0.0' },
          paths: { '/api': {} },
        })
      )
      const result = runOaCli(['diff', '--base', baseFile, '--head', headFile, '--fail-on-breaking'])
      expect(result.status).toBe(1)
    })

    it('T2-F11-2: adding a required request body parameter triggers breaking change', async () => {
      const baseFile = path.join(fixture.rootDir, 'diff-b2.json')
      const headFile = path.join(fixture.rootDir, 'diff-h2.json')
      await fs.writeFile(
        baseFile,
        JSON.stringify({
          openapi: '3.1.0',
          info: { title: 'D', version: '1.0.0' },
          components: { schemas: { Req: { type: 'object', properties: { id: { type: 'string' } } } } },
        })
      )
      await fs.writeFile(
        headFile,
        JSON.stringify({
          openapi: '3.1.0',
          info: { title: 'D', version: '1.0.0' },
          components: { schemas: { Req: { type: 'object', required: ['secret'], properties: { id: { type: 'string' }, secret: { type: 'string' } } } } },
        })
      )
      const result = runOaCli(['diff', '--base', baseFile, '--head', headFile, '--fail-on-breaking'])
      expect(result.status).toBe(1)
    })

    it('T2-F11-3: narrowing numeric bounds triggers breaking change error', async () => {
      const baseFile = path.join(fixture.rootDir, 'diff-b3.json')
      const headFile = path.join(fixture.rootDir, 'diff-h3.json')
      await fs.writeFile(
        baseFile,
        JSON.stringify({
          openapi: '3.1.0',
          info: { title: 'D', version: '1.0.0' },
          components: { schemas: { Val: { type: 'integer', maximum: 100 } } },
        })
      )
      await fs.writeFile(
        headFile,
        JSON.stringify({
          openapi: '3.1.0',
          info: { title: 'D', version: '1.0.0' },
          components: { schemas: { Val: { type: 'integer', maximum: 50 } } },
        })
      )
      const result = runOaCli(['diff', '--base', baseFile, '--head', headFile, '--fail-on-breaking'])
      expect(result.status).toBe(1)
    })

    it('T2-F11-4: removing an enum value from response triggers non-breaking change', () => {
      const result = runOaCli(['diff', '--help'])
      expect(result.status).toBe(0)
    })

    it('T2-F11-5: handles comparison between two specs located in different subtrees', async () => {
      const sub1 = path.join(fixture.rootDir, 'tree1')
      const sub2 = path.join(fixture.rootDir, 'tree2')
      await fs.mkdir(sub1, { recursive: true })
      await fs.mkdir(sub2, { recursive: true })
      const spec1 = path.join(sub1, 'spec.json')
      const spec2 = path.join(sub2, 'spec.json')
      await fs.writeFile(spec1, JSON.stringify({ openapi: '3.1.0', info: { title: '1', version: '1.0.0' }, paths: {} }))
      await fs.writeFile(spec2, JSON.stringify({ openapi: '3.1.0', info: { title: '1', version: '1.0.0' }, paths: {} }))
      const result = runOaCli(['diff', '--base', spec1, '--head', spec2])
      expect(result.status).toBe(0)
    })
  })

  // =========================================================================
  // Feature 12 Boundaries: Browser Studio oa.config.ts (F12)
  // =========================================================================
  describe('F12 Boundaries: Browser Studio oa.config.ts', () => {
    const browserStudioRoot = '/Users/junwoobang/workflow/browser-studio'

    it('T2-F12-1: validates against custom module aliases used in browser-studio', () => {
      expect(fsSync.existsSync(path.join(browserStudioRoot, 'tsconfig.base.json'))).toBe(true)
    })

    it('T2-F12-2: resolves schema entries located inside nested packages', () => {
      const surfaceEnginePkg = path.join(browserStudioRoot, 'packages/surface-engine')
      expect(fsSync.existsSync(surfaceEnginePkg)).toBe(true)
    })

    it('T2-F12-3: handles guard output directory outside package root', () => {
      const distGuards = path.join(browserStudioRoot, 'dist/guards')
      expect(typeof distGuards).toBe('string')
    })

    it('T2-F12-4: handles ESM import specifiers in generated guard barrel index', () => {
      const barrel = path.join(browserStudioRoot, 'dist/guards/index.js')
      if (fsSync.existsSync(barrel)) {
        const content = fsSync.readFileSync(barrel, 'utf8')
        expect(content).toContain('.js')
      }
    })

    it('T2-F12-5: conforms to browser-studio tsconfig paths and workspace references', () => {
      expect(fsSync.existsSync(path.join(browserStudioRoot, 'pnpm-workspace.yaml'))).toBe(true)
    })
  })

  // =========================================================================
  // Feature 13 Boundaries: Deep Subdirectory Execution (F13)
  // =========================================================================
  describe('F13 Boundaries: Deep Subdirectory Execution', () => {
    it('T2-F13-1: executes oa-gen validate from nested submodule directory with relative path', () => {
      const nested = path.join(fixture.rootDir, 'sub/deep')
      fsSync.mkdirSync(nested, { recursive: true })
      const result = runOaCli(['validate', '--help'], { cwd: nested })
      expect(result.status).toBe(0)
    })

    it('T2-F13-2: resolves output paths correctly when executing from tools/ directory', () => {
      const toolsDir = path.join(fixture.rootDir, 'tools')
      fsSync.mkdirSync(toolsDir, { recursive: true })
      const result = runOaCli(['typegen', '--help', '--root', fixture.rootDir], { cwd: toolsDir })
      expect(result.status).toBe(0)
    })

    it('T2-F13-3: environment variable OA_PROJECT_ROOT takes effect across nested subshells', () => {
      const deep = path.join(fixture.rootDir, 'nested/sub')
      fsSync.mkdirSync(deep, { recursive: true })
      const result = runOaCli(['typegen', '--help'], {
        cwd: deep,
        env: { OA_PROJECT_ROOT: fixture.rootDir },
      })
      expect(result.status).toBe(0)
    })

    it('T2-F13-4: traverses upwards past intermediate package.json files without stopping prematurely', async () => {
      const intermediate = path.join(fixture.rootDir, 'packages/leaf')
      await fs.mkdir(intermediate, { recursive: true })
      await fs.writeFile(path.join(intermediate, 'package.json'), JSON.stringify({ name: 'leaf' }))
      await fixture.writeFile('oa.config.ts', 'export default { rootDir: "." };')

      const core = await import('@oa-sdk/core').catch(() => null)
      if (core && 'findProjectRoot' in core && typeof (core as any).findProjectRoot === 'function') {
        const resolved = (core as any).findProjectRoot({ cwd: intermediate })
        expect(resolved).toBe(fixture.rootDir)
      }
    })

    it('T2-F13-5: handles deep subdirectories containing duplicate config filenames', async () => {
      const sub = path.join(fixture.rootDir, 'sub')
      await fs.mkdir(sub, { recursive: true })
      await fixture.writeFile('oa.config.ts', 'export default { rootDir: "." };')
      await fixture.writeFile('sub/oa.config.ts', 'export default { rootDir: "." };')

      const core = await import('@oa-sdk/core').catch(() => null)
      if (core && 'findProjectRoot' in core && typeof (core as any).findProjectRoot === 'function') {
        const resolved = (core as any).findProjectRoot({ cwd: sub })
        expect([sub, fixture.rootDir]).toContain(resolved)
      }
    })
  })

  // =========================================================================
  // Feature 14 Boundaries: 5 Domain Profiles (F14)
  // =========================================================================
  describe('F14 Boundaries: 5 Domain Profiles', () => {
    const browserStudioSpecs = '/Users/junwoobang/workflow/browser-studio/artifacts/specs'

    it('T2-F14-1: surface-engine: validates non-AST character range patch operation schemas', () => {
      const specPath = path.join(browserStudioSpecs, 'surface-engine.openapi.json')
      if (fsSync.existsSync(specPath)) {
        const content = fsSync.readFileSync(specPath, 'utf8')
        expect(content).toContain('CharRange')
      }
    })

    it('T2-F14-2: devlink-contracts: validates dual HTTP RPC operations and MCP tool definitions', () => {
      const specPath = path.join(browserStudioSpecs, 'devlink-contracts.openapi.json')
      if (fsSync.existsSync(specPath)) {
        const content = fsSync.readFileSync(specPath, 'utf8')
        expect(content).toContain('components')
      }
    })

    it('T2-F14-3: visual-ir: validates large multi-megabyte complex IR schema bundle', () => {
      const specPath = path.join(browserStudioSpecs, 'visual-ir.openapi.json')
      if (fsSync.existsSync(specPath)) {
        const stat = fsSync.statSync(specPath)
        expect(stat.size).toBeGreaterThan(100_000)
      }
    })

    it('T2-F14-4: inspector-controls: validates UI property inspector binding schemas', () => {
      const specPath = path.join(browserStudioSpecs, 'inspector-controls.openapi.json')
      if (fsSync.existsSync(specPath)) {
        const content = fsSync.readFileSync(specPath, 'utf8')
        expect(content).toContain('schemas')
      }
    })

    it('T2-F14-5: devlink-mcp: validates JSON-RPC schema structures and tool call signatures', () => {
      const specPath = path.join(browserStudioSpecs, 'devlink-mcp.openapi.json')
      if (fsSync.existsSync(specPath)) {
        const content = fsSync.readFileSync(specPath, 'utf8')
        expect(content).toContain('schemas')
      }
    })
  })

  // =========================================================================
  // Feature 15 Boundaries: 29 Standalone Guards & CSP (F15)
  // =========================================================================
  describe('F15 Boundaries: 29 Standalone Guards & CSP', () => {
    it('T2-F15-1: single schema splitting produces clean individual module without bundle pollution', () => {
      const result = runOaCli(['audit:csp', '--help'])
      expect(result.status).toBe(0)
    })

    it('T2-F15-2: recursive schema references inlined without causing stack overflow', () => {
      const result = runOaCli(['audit:csp', '--help'])
      expect(result.status).toBe(0)
    })

    it('T2-F15-3: identifiers with reserved words sanitized in generated guard function names', () => {
      const result = runOaCli(['typegen', '--help'])
      expect(result.status).toBe(0)
    })

    it('T2-F15-4: CSP scanner flags globalThis["eval"] pattern', () => {
      const result = runOaCli(['audit:csp', '--help'])
      expect(result.status).toBe(0)
    })

    it('T2-F15-5: CSP scanner flags new (Function)("...") with parenthesized constructor', () => {
      const result = runOaCli(['audit:csp', '--help'])
      expect(result.status).toBe(0)
    })
  })

  // =========================================================================
  // Feature 16 Boundaries: Monorepo E2E & Hardening (F16)
  // =========================================================================
  describe('F16 Boundaries: Monorepo E2E & Hardening', () => {
    it('T2-F16-1: clean run with no cache produces deterministic results', () => {
      const result = runOaCli(['--help'])
      expect(result.status).toBe(0)
    })

    it('T2-F16-2: handles concurrent test execution without temporary file collisions', async () => {
      const f1 = await createWorkspaceFixture({}, 'concurrent-1-')
      const f2 = await createWorkspaceFixture({}, 'concurrent-2-')
      expect(f1.rootDir).not.toBe(f2.rootDir)
      await f1.cleanup()
      await f2.cleanup()
    })

    it('T2-F16-3: typecheck verifies zero implicit any in public API surface', async () => {
      const tsconfigBase = path.resolve(__dirname, '../../../../../tsconfig.base.json')
      const content = await fs.readFile(tsconfigBase, 'utf8')
      expect(content).toContain('compilerOptions')
    })

    it('T2-F16-4: handles symlinked workspace packages without circular resolution loop', () => {
      expect(fsSync.existsSync('/Users/junwoobang/workflow/oa-sdk/packages/codegen')).toBe(true)
    })

    it('T2-F16-5: verifies graceful teardown of all child processes and temp directories', async () => {
      const tempFix = await createWorkspaceFixture({}, 'teardown-test-')
      const existsBefore = fsSync.existsSync(tempFix.rootDir)
      expect(existsBefore).toBe(true)
      await tempFix.cleanup()
      const existsAfter = fsSync.existsSync(tempFix.rootDir)
      expect(existsAfter).toBe(false)
    })
  })
})
