/**
 * packages/codegen/src/__tests__/config-loader.test.ts
 *
 * Unit tests for Asynchronous Config Loader loadOaConfig:
 * 1. Automatic upward discovery & candidate precedence
 * 2. Supported formats (oa.config.ts, oa.config.mjs, oa.config.json, .oarc.json)
 * 3. Export types (default, named config, sync/async function)
 * 4. TypeScript features (native type stripping + enum fallback compilation)
 * 5. Path normalization (rootDir relative to config directory)
 * 6. Error handling (missing files, invalid JSON, syntax errors, non-object exports)
 * 7. Target resolution helpers (resolveProfileTarget, resolveGuardTarget)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, realpathSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadOaConfig,
  findConfigFile,
  isEsModuleTypeScriptInCommonJsScope,
  resolveProfileTarget,
  resolveGuardTarget,
  CANDIDATE_CONFIG_FILES,
} from '../cli/lib/config-loader.js'

describe('loadOaConfig', () => {
  let testDir: string

  beforeEach(() => {
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'oa-config-loader-test-')))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('Candidate Discovery & Precedence', () => {
    it('discovers oa.config.ts in current working directory', async () => {
      const configPath = join(testDir, 'oa.config.ts')
      writeFileSync(configPath, 'export default { rootDir: ".", specs: [] };')

      const result = await loadOaConfig({ cwd: testDir })
      expect(result).not.toBeNull()
      expect(result?.configPath).toBe(configPath)
      expect(result?.rootDir).toBe(testDir)
    })

    it('discovers oa.config.mjs when oa.config.ts is absent', async () => {
      const configPath = join(testDir, 'oa.config.mjs')
      writeFileSync(configPath, 'export default { rootDir: "./mjs-root" };')

      const result = await loadOaConfig({ cwd: testDir })
      expect(result).not.toBeNull()
      expect(result?.configPath).toBe(configPath)
      expect(result?.rootDir).toBe(resolve(testDir, 'mjs-root'))
    })

    it('discovers oa.config.json when no ts/mjs config exists', async () => {
      const configPath = join(testDir, 'oa.config.json')
      writeFileSync(configPath, JSON.stringify({ rootDir: '.', specs: [{ id: 'json-spec', profile: 'component-bundle', schemaEntry: './schema.ts', outDir: './out' }] }))

      const result = await loadOaConfig({ cwd: testDir })
      expect(result).not.toBeNull()
      expect(result?.configPath).toBe(configPath)
      expect(result?.config.specs?.[0]?.id).toBe('json-spec')
    })

    it('discovers .oarc.json as final fallback candidate', async () => {
      const configPath = join(testDir, '.oarc.json')
      writeFileSync(configPath, JSON.stringify({ rootDir: './rc', specs: [] }))

      const result = await loadOaConfig({ cwd: testDir })
      expect(result).not.toBeNull()
      expect(result?.configPath).toBe(configPath)
      expect(result?.rootDir).toBe(resolve(testDir, 'rc'))
    })

    it('enforces precedence: oa.config.ts overrides oa.config.json in same dir', async () => {
      writeFileSync(join(testDir, 'oa.config.json'), JSON.stringify({ rootDir: './json' }))
      writeFileSync(join(testDir, 'oa.config.ts'), 'export default { rootDir: "./ts" };')

      const result = await loadOaConfig({ cwd: testDir })
      expect(result?.configPath).toBe(join(testDir, 'oa.config.ts'))
      expect(result?.rootDir).toBe(resolve(testDir, 'ts'))
    })

    it('resolves config upward from deep subdirectories', async () => {
      writeFileSync(join(testDir, 'oa.config.ts'), 'export default { rootDir: "." };')
      const subDir = join(testDir, 'packages', 'deep', 'subpkg')
      mkdirSync(subDir, { recursive: true })

      const result = await loadOaConfig({ cwd: subDir })
      expect(result).not.toBeNull()
      expect(result?.configPath).toBe(join(testDir, 'oa.config.ts'))
      expect(result?.rootDir).toBe(testDir)
    })

    it('returns null when no configuration file exists anywhere', async () => {
      const result = await loadOaConfig({ cwd: testDir })
      expect(result).toBeNull()
    })
  })

  describe('Explicit Flags (--config & --root)', () => {
    it('loads custom config path specified via configPath option', async () => {
      const customPath = join(testDir, 'custom.spec.json')
      writeFileSync(customPath, JSON.stringify({ rootDir: '.', specs: [{ id: 'custom', profile: 'component-bundle', schemaEntry: './schema.ts', outDir: './out' }] }))

      const result = await loadOaConfig({ configPath: 'custom.spec.json', cwd: testDir })
      expect(result).not.toBeNull()
      expect(result?.configPath).toBe(customPath)
      expect(result?.config.specs?.[0]?.id).toBe('custom')
    })

    it('loads config from explicitRoot override', async () => {
      const rootDir = join(testDir, 'custom-root')
      mkdirSync(rootDir)
      writeFileSync(join(rootDir, 'oa.config.json'), JSON.stringify({ rootDir: '.' }))

      const subDir = join(testDir, 'other-dir')
      mkdirSync(subDir)

      const result = await loadOaConfig({ cwd: subDir, explicitRoot: rootDir })
      expect(result?.configPath).toBe(join(rootDir, 'oa.config.json'))
      expect(result?.rootDir).toBe(rootDir)
    })

    it('throws error when explicit configPath does not exist', async () => {
      await expect(
        loadOaConfig({ configPath: 'missing.config.ts', cwd: testDir })
      ).rejects.toThrow(/Configuration file not found/)
    })
  })

  describe('Module Exports & TypeScript Features', () => {
    it('supports named export "config" in addition to default export', async () => {
      const configPath = join(testDir, 'oa.config.ts')
      writeFileSync(configPath, 'export const config = { rootDir: "./named", specs: [] };')

      const result = await loadOaConfig({ cwd: testDir })
      expect(result?.rootDir).toBe(resolve(testDir, 'named'))
    })

    it('supports function configuration (export default () => ({ ... }))', async () => {
      const configPath = join(testDir, 'oa.config.ts')
      writeFileSync(configPath, 'export default () => ({ rootDir: "./fn-root" });')

      const result = await loadOaConfig({ cwd: testDir })
      expect(result?.rootDir).toBe(resolve(testDir, 'fn-root'))
    })

    it('supports async function configuration (export default async () => ({ ... }))', async () => {
      const configPath = join(testDir, 'oa.config.ts')
      writeFileSync(configPath, 'export default async () => ({ rootDir: "./async-root" });')

      const result = await loadOaConfig({ cwd: testDir })
      expect(result?.rootDir).toBe(resolve(testDir, 'async-root'))
    })

    it('imports TypeScript with interfaces and type annotations', async () => {
      const configPath = join(testDir, 'oa.config.ts')
      writeFileSync(
        configPath,
        `interface CustomTarget { id: string; profile: 'component-bundle'; schemaEntry: string; outDir: string; }
const target: CustomTarget = { id: 'test', profile: 'component-bundle', schemaEntry: './schema.ts', outDir: './dist' };
export default { rootDir: '.', specs: [target] };`
      )

      const result = await loadOaConfig({ cwd: testDir })
      expect(result?.config.specs?.[0]?.id).toBe('test')
    })

    it('handles TypeScript enums via fallback transpilation path', async () => {
      const configPath = join(testDir, 'oa.config.ts')
      writeFileSync(
        configPath,
        `export enum ProfileEnum { ComponentBundle = 'component-bundle' }
export default {
  rootDir: '.',
  specs: [{ id: 'enum-test', profile: ProfileEnum.ComponentBundle, schemaEntry: './s.ts', outDir: './out' }]
};`
      )

      const result = await loadOaConfig({ cwd: testDir })
      expect(result?.config.specs?.[0]?.profile).toBe('component-bundle')
    })
  })

  // Node loads a `.ts` file as CommonJS under "type": "commonjs" (what `npm init` writes since
  // npm 11), where the `import` that `oa-gen init` puts in oa.config.ts is a syntax error. The
  // packed-CLI smoke (scripts/package-pack-smoke.mjs) runs the real loader in such a project.
  describe('TypeScript configuration in a CommonJS package scope', () => {
    const esModuleConfig = `import { defineConfig } from '@oa-sdk/codegen'
export default defineConfig({ specs: [] })
`
    const scope = (type: string | undefined) => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify(type === undefined ? { name: 'app' } : { name: 'app', type }))
    }
    const config = (name: string, content: string) => {
      const configPath = join(testDir, name)
      writeFileSync(configPath, content)
      return configPath
    }

    it('transpiles an ES module oa.config.ts under "type": "commonjs"', async () => {
      scope('commonjs')
      expect(await isEsModuleTypeScriptInCommonJsScope(config('oa.config.ts', esModuleConfig))).toBe(true)
      expect(await isEsModuleTypeScriptInCommonJsScope(config('export-only.ts', 'export default { specs: [] }\n'))).toBe(true)
      expect(await isEsModuleTypeScriptInCommonJsScope(config('value-import.ts', "import { type A, b } from './b'\nmodule.exports = b\n"))).toBe(true)
    })

    it('leaves files to Node where it loads them as written', async () => {
      const configPath = config('oa.config.ts', esModuleConfig)
      scope('module')
      expect(await isEsModuleTypeScriptInCommonJsScope(configPath)).toBe(false)
      // Without a type field, Node detects the module syntax itself.
      scope(undefined)
      expect(await isEsModuleTypeScriptInCommonJsScope(configPath)).toBe(false)
      scope('commonjs')
      expect(await isEsModuleTypeScriptInCommonJsScope(config('oa.config.mts', esModuleConfig))).toBe(false)
    })

    it('keeps a CommonJS configuration that uses only syntax Node strips', async () => {
      scope('commonjs')
      const commonJs = config('oa.config.ts', `import type { OaConfig } from '@oa-sdk/codegen'
export type Alias = OaConfig
export interface Local { id: string }
declare const marker: string
export type { OaConfig as Config } from '@oa-sdk/codegen'
const config: OaConfig = { specs: [] }
module.exports = config
`)
      expect(await isEsModuleTypeScriptInCommonJsScope(commonJs)).toBe(false)
      expect(await isEsModuleTypeScriptInCommonJsScope(config('export-equals.ts', 'const config = { specs: [] }\nexport = config\n'))).toBe(false)
    })

    it('reads the nearest package.json, as Node does', async () => {
      scope('module')
      const nested = join(testDir, 'packages', 'app')
      mkdirSync(nested, { recursive: true })
      writeFileSync(join(nested, 'package.json'), JSON.stringify({ name: 'nested', type: 'commonjs' }))
      writeFileSync(join(nested, 'oa.config.ts'), esModuleConfig)
      expect(await isEsModuleTypeScriptInCommonJsScope(join(nested, 'oa.config.ts'))).toBe(true)
    })
  })

  describe('Path Normalization', () => {
    it('resolves relative rootDir relative to config directory', async () => {
      const configPath = join(testDir, 'oa.config.json')
      writeFileSync(configPath, JSON.stringify({ rootDir: './workspace' }))

      const result = await loadOaConfig({ cwd: testDir })
      expect(result?.rootDir).toBe(join(testDir, 'workspace'))
      expect(result?.config.rootDir).toBe(join(testDir, 'workspace'))
    })

    it('defaults rootDir to config directory if rootDir is omitted', async () => {
      const configPath = join(testDir, 'oa.config.json')
      writeFileSync(configPath, JSON.stringify({ specs: [] }))

      const result = await loadOaConfig({ cwd: testDir })
      expect(result?.rootDir).toBe(testDir)
      expect(result?.config.rootDir).toBe(testDir)
    })

    it('retains absolute rootDir unchanged', async () => {
      const absRoot = resolve(testDir, 'custom', 'abs')
      const configPath = join(testDir, 'oa.config.json')
      writeFileSync(configPath, JSON.stringify({ rootDir: absRoot }))

      const result = await loadOaConfig({ cwd: testDir })
      expect(result?.rootDir).toBe(absRoot)
    })

    it('normalizes target paths via resolveProfileTarget and resolveGuardTarget', () => {
      const rootDir = '/repo/root'
      const resolvedProfile = resolveProfileTarget(
        {
          id: 'api',
          profile: 'component-bundle',
          schemaEntry: 'src/schemas.ts',
          outDir: 'artifacts/specs',
        },
        rootDir
      )
      expect(resolvedProfile.resolvedSchemaEntry).toBe('/repo/root/src/schemas.ts')
      expect(resolvedProfile.resolvedOutDir).toBe('/repo/root/artifacts/specs')

      const resolvedGuards = resolveGuardTarget({ outDir: 'dist/guards' }, rootDir)
      expect(resolvedGuards.resolvedOutDir).toBe('/repo/root/dist/guards')
    })
  })

  describe('Error Handling', () => {
    it('throws descriptive error on malformed JSON config', async () => {
      const configPath = join(testDir, 'oa.config.json')
      writeFileSync(configPath, '{ "invalidJson": , }')

      await expect(loadOaConfig({ cwd: testDir })).rejects.toThrow(/Failed to parse JSON config file/)
    })

    it('throws error when config exports a non-object primitive', async () => {
      const configPath = join(testDir, 'oa.config.ts')
      writeFileSync(configPath, 'export default 12345;')

      await expect(loadOaConfig({ cwd: testDir })).rejects.toThrow(/must be an object, but received number/)
    })

    it('throws error when config exports null', async () => {
      const configPath = join(testDir, 'oa.config.json')
      writeFileSync(configPath, 'null')

      await expect(loadOaConfig({ cwd: testDir })).rejects.toThrow(/must be an object, but received null/)
    })
  })
})
