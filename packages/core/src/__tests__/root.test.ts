import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  findProjectRoot,
  findProjectRootDetail,
  DEFAULT_CONFIG_FILES,
  DEFAULT_WORKSPACE_FILES,
  DEFAULT_VCS_DIRS,
  DEFAULT_ENV_VAR_NAME,
} from '../root.js'

describe('findProjectRoot', () => {
  let tmpBase: string
  const originalEnv = process.env[DEFAULT_ENV_VAR_NAME]

  beforeEach(() => {
    tmpBase = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oa-root-test-')))
    delete process.env[DEFAULT_ENV_VAR_NAME]
  })

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env[DEFAULT_ENV_VAR_NAME] = originalEnv
    } else {
      delete process.env[DEFAULT_ENV_VAR_NAME]
    }
    fs.rmSync(tmpBase, { recursive: true, force: true })
  })

  function createStructure(structure: Record<string, string | null>): void {
    for (const [relPath, content] of Object.entries(structure)) {
      const fullPath = path.join(tmpBase, relPath)
      if (content === null) {
        fs.mkdirSync(fullPath, { recursive: true })
      } else {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true })
        fs.writeFileSync(fullPath, content, 'utf-8')
      }
    }
  }

  describe('Tier 1: Explicit CLI Argument Override', () => {
    it('resolves explicitRoot absolute path directly', () => {
      const explicit = path.join(tmpBase, 'custom-root')
      fs.mkdirSync(explicit, { recursive: true })

      const result = findProjectRoot({
        cwd: tmpBase,
        explicitRoot: explicit,
      })
      expect(result).toBe(explicit)
    })

    it('resolves relative explicitRoot relative to cwd', () => {
      const customSub = path.join(tmpBase, 'sub-dir')
      fs.mkdirSync(customSub, { recursive: true })

      const result = findProjectRoot({
        cwd: tmpBase,
        explicitRoot: './sub-dir',
      })
      expect(result).toBe(customSub)
    })

    it('supports two-argument overload findProjectRoot(cwd, explicitRoot)', () => {
      const customSub = path.join(tmpBase, 'target')
      fs.mkdirSync(customSub, { recursive: true })

      const result = findProjectRoot(tmpBase, './target')
      expect(result).toBe(customSub)
    })

    it('returns parent directory if explicitRoot points to an existing file', () => {
      createStructure({
        'nested/oa.config.ts': 'export default {}',
      })
      const configPath = path.join(tmpBase, 'nested/oa.config.ts')
      const result = findProjectRoot({
        explicitRoot: configPath,
      })
      expect(result).toBe(path.join(tmpBase, 'nested'))
    })

    it('explicitRoot takes precedence over Tier 2 env var, Tier 3 config, Tier 4 workspace, Tier 5 git', () => {
      process.env[DEFAULT_ENV_VAR_NAME] = path.join(tmpBase, 'env-root')
      createStructure({
        'oa.config.ts': 'export default {}',
        'pnpm-workspace.yaml': 'packages:\n  - "packages/*"',
        '.git/config': '',
        'explicit-target/marker.txt': '',
      })

      const explicitTarget = path.join(tmpBase, 'explicit-target')
      const detail = findProjectRootDetail({
        cwd: tmpBase,
        explicitRoot: explicitTarget,
      })

      expect(detail.tier).toBe(1)
      expect(detail.reason).toBe('explicit')
      expect(detail.root).toBe(explicitTarget)
    })
  })

  describe('Tier 2: Environment Variable Override', () => {
    it('resolves OA_PROJECT_ROOT environment variable', () => {
      const envRoot = path.join(tmpBase, 'env-root')
      fs.mkdirSync(envRoot, { recursive: true })
      process.env[DEFAULT_ENV_VAR_NAME] = envRoot

      const result = findProjectRoot({ cwd: tmpBase })
      expect(result).toBe(envRoot)
    })

    it('resolves relative OA_PROJECT_ROOT relative to cwd', () => {
      const envRel = path.join(tmpBase, 'my-env')
      fs.mkdirSync(envRel, { recursive: true })
      process.env[DEFAULT_ENV_VAR_NAME] = './my-env'

      const result = findProjectRoot({ cwd: tmpBase })
      expect(result).toBe(envRel)
    })

    it('supports custom envVarName option', () => {
      const customEnvRoot = path.join(tmpBase, 'custom-env')
      fs.mkdirSync(customEnvRoot, { recursive: true })
      process.env.CUSTOM_TEST_ROOT = customEnvRoot

      try {
        const detail = findProjectRootDetail({
          cwd: tmpBase,
          envVarName: 'CUSTOM_TEST_ROOT',
        })
        expect(detail.tier).toBe(2)
        expect(detail.root).toBe(customEnvRoot)
      } finally {
        delete process.env.CUSTOM_TEST_ROOT
      }
    })

    it('ignores empty or whitespace-only environment variable', () => {
      process.env[DEFAULT_ENV_VAR_NAME] = '   '
      createStructure({
        'oa.config.ts': 'export default {}',
      })

      const detail = findProjectRootDetail({ cwd: tmpBase })
      expect(detail.tier).toBe(3)
      expect(detail.root).toBe(tmpBase)
    })

    it('env variable takes precedence over Tier 3 config, Tier 4 workspace, and Tier 5 git', () => {
      const envRoot = path.join(tmpBase, 'env-override')
      fs.mkdirSync(envRoot, { recursive: true })
      process.env[DEFAULT_ENV_VAR_NAME] = envRoot

      createStructure({
        'oa.config.ts': 'export default {}',
        'pnpm-workspace.yaml': 'packages:\n  - "packages/*"',
        '.git/config': '',
      })

      const detail = findProjectRootDetail({ cwd: tmpBase })
      expect(detail.tier).toBe(2)
      expect(detail.reason).toBe('env')
      expect(detail.root).toBe(envRoot)
    })
  })

  describe('Tier 3: Configuration File Candidates', () => {
    it.each([
      ['oa.config.ts'],
      ['oa.config.mjs'],
      ['oa.config.json'],
      ['.oarc.json'],
    ])('discovers %s in current directory', (configFile) => {
      createStructure({
        [configFile]: '{}',
      })
      const detail = findProjectRootDetail(tmpBase)
      expect(detail.tier).toBe(3)
      expect(detail.reason).toBe('config')
      expect(detail.matchedMarker).toBe(configFile)
      expect(detail.root).toBe(tmpBase)
    })

    it('discovers config file in ancestor directory from deep child', () => {
      createStructure({
        'oa.config.ts': 'export default {}',
        'packages/nested/child/deep': null,
      })
      const deepDir = path.join(tmpBase, 'packages/nested/child/deep')
      const result = findProjectRoot(deepDir)
      expect(result).toBe(tmpBase)
    })

    it('returns nearest enclosing config when multiple ancestors contain config files', () => {
      createStructure({
        'oa.config.ts': 'export default {}',
        'packages/module-a/oa.config.json': '{}',
        'packages/module-a/src': null,
      })
      const leafDir = path.join(tmpBase, 'packages/module-a/src')
      const detail = findProjectRootDetail(leafDir)
      expect(detail.tier).toBe(3)
      expect(detail.root).toBe(path.join(tmpBase, 'packages/module-a'))
      expect(detail.matchedMarker).toBe('oa.config.json')
    })
  })

  describe('Tier 4: Monorepo Workspace Markers', () => {
    it('discovers pnpm-workspace.yaml', () => {
      createStructure({
        'pnpm-workspace.yaml': 'packages:\n  - "packages/*"',
        'packages/core/src': null,
      })
      const startDir = path.join(tmpBase, 'packages/core/src')
      const detail = findProjectRootDetail(startDir)
      expect(detail.tier).toBe(4)
      expect(detail.reason).toBe('workspace')
      expect(detail.matchedMarker).toBe('pnpm-workspace.yaml')
      expect(detail.root).toBe(tmpBase)
    })

    it('discovers turbo.json', () => {
      createStructure({
        'turbo.json': '{"$schema": "https://turbo.build/schema.json"}',
        'apps/web/src': null,
      })
      const startDir = path.join(tmpBase, 'apps/web/src')
      const detail = findProjectRootDetail(startDir)
      expect(detail.tier).toBe(4)
      expect(detail.matchedMarker).toBe('turbo.json')
      expect(detail.root).toBe(tmpBase)
    })

    it('discovers lerna.json', () => {
      createStructure({
        'lerna.json': '{"version": "1.0.0"}',
        'packages/pkg-a': null,
      })
      const startDir = path.join(tmpBase, 'packages/pkg-a')
      const detail = findProjectRootDetail(startDir)
      expect(detail.tier).toBe(4)
      expect(detail.matchedMarker).toBe('lerna.json')
      expect(detail.root).toBe(tmpBase)
    })

    it('discovers package.json with array workspaces', () => {
      createStructure({
        'package.json': JSON.stringify({ name: 'root', workspaces: ['packages/*'] }),
        'packages/sub/src': null,
      })
      const startDir = path.join(tmpBase, 'packages/sub/src')
      const detail = findProjectRootDetail(startDir)
      expect(detail.tier).toBe(4)
      expect(detail.matchedMarker).toBe('package.json')
      expect(detail.root).toBe(tmpBase)
    })

    it('discovers package.json with object workspaces', () => {
      createStructure({
        'package.json': JSON.stringify({ name: 'root', workspaces: { packages: ['packages/*'] } }),
        'packages/sub/src': null,
      })
      const startDir = path.join(tmpBase, 'packages/sub/src')
      const detail = findProjectRootDetail(startDir)
      expect(detail.tier).toBe(4)
      expect(detail.matchedMarker).toBe('package.json')
      expect(detail.root).toBe(tmpBase)
    })

    it('ignores regular leaf package.json without workspaces', () => {
      createStructure({
        'package.json': JSON.stringify({ name: 'leaf-package', version: '1.0.0' }),
        '.git/config': '',
        'src': null,
      })
      const startDir = path.join(tmpBase, 'src')
      const detail = findProjectRootDetail(startDir)
      // Must not match leaf package.json; falls through to Tier 5 .git
      expect(detail.tier).toBe(5)
      expect(detail.reason).toBe('vcs')
      expect(detail.matchedMarker).toBe('.git')
      expect(detail.root).toBe(tmpBase)
    })

    it('handles malformed package.json gracefully without throwing', () => {
      createStructure({
        'package.json': '{ bad json content',
        '.git/config': '',
      })
      const detail = findProjectRootDetail(tmpBase)
      expect(detail.tier).toBe(5)
      expect(detail.root).toBe(tmpBase)
    })
  })

  describe('Tier 5: Version Control Markers (.git)', () => {
    it('discovers .git directory in project root', () => {
      createStructure({
        '.git/HEAD': 'ref: refs/heads/main',
        'packages/a/src': null,
      })
      const startDir = path.join(tmpBase, 'packages/a/src')
      const detail = findProjectRootDetail(startDir)
      expect(detail.tier).toBe(5)
      expect(detail.reason).toBe('vcs')
      expect(detail.matchedMarker).toBe('.git')
      expect(detail.root).toBe(tmpBase)
    })

    it('discovers .git file for git submodules or worktrees', () => {
      createStructure({
        '.git': 'gitdir: ../../.git/modules/sub',
        'src': null,
      })
      const startDir = path.join(tmpBase, 'src')
      const detail = findProjectRootDetail(startDir)
      expect(detail.tier).toBe(5)
      expect(detail.reason).toBe('vcs')
      expect(detail.matchedMarker).toBe('.git')
      expect(detail.root).toBe(tmpBase)
    })
  })

  describe('Tier 6: Fallback to cwd', () => {
    it('returns resolved cwd when no markers exist in any ancestor', () => {
      createStructure({
        'a/b/c': null,
      })
      const startDir = path.join(tmpBase, 'a/b/c')
      const detail = findProjectRootDetail({
        cwd: startDir,
        markers: {
          configFiles: ['__non_existent_config__'],
          workspaceFiles: ['__non_existent_ws__'],
          vcsDirs: ['__non_existent_vcs__'],
        },
      })
      expect(detail.tier).toBe(6)
      expect(detail.reason).toBe('fallback')
      expect(detail.root).toBe(startDir)
    })
  })

  describe('Submodule Traversal Invariant (Submodule Safe)', () => {
    it('resolves monorepo root containing oa.config.ts even when nested submodule contains .git and pnpm-workspace.yaml', () => {
      // Replicates browser-studio and nested browser-mapper submodule:
      // tmpBase/ (browser-studio root)
      //   ├── oa.config.ts
      //   ├── pnpm-workspace.yaml
      //   ├── .git/
      //   └── packages/
      //       └── browser-mapper/ (submodule root)
      //           ├── .git/ (or .git file)
      //           ├── pnpm-workspace.yaml
      //           └── packages/
      //               └── selector-evaluator/
      //                   └── src/
      createStructure({
        'oa.config.ts': 'export default { rootDir: "." }',
        'pnpm-workspace.yaml': 'packages:\n  - "packages/*"',
        '.git/config': '',
        'packages/browser-mapper/.git': 'gitdir: ../../.git/modules/browser-mapper',
        'packages/browser-mapper/pnpm-workspace.yaml': 'packages:\n  - "packages/*"',
        'packages/browser-mapper/packages/selector-evaluator/src': null,
      })

      const evaluatorSrc = path.join(
        tmpBase,
        'packages/browser-mapper/packages/selector-evaluator/src',
      )

      const detail = findProjectRootDetail(evaluatorSrc)

      // Must find the parent monorepo root tmpBase via Tier 3, NOT stopping at browser-mapper!
      expect(detail.tier).toBe(3)
      expect(detail.reason).toBe('config')
      expect(detail.matchedMarker).toBe('oa.config.ts')
      expect(detail.root).toBe(tmpBase)
    })

    it('resolves monorepo root containing pnpm-workspace.yaml when submodule has only .git marker and no config exists', () => {
      createStructure({
        'pnpm-workspace.yaml': 'packages:\n  - "packages/*"',
        '.git/config': '',
        'packages/submodule/.git': 'gitdir: ../../.git/modules/submodule',
        'packages/submodule/src': null,
      })

      const subSrc = path.join(tmpBase, 'packages/submodule/src')
      const detail = findProjectRootDetail(subSrc)

      // Tier 4 (workspace) on parent must take precedence over Tier 5 (.git) on submodule
      expect(detail.tier).toBe(4)
      expect(detail.reason).toBe('workspace')
      expect(detail.matchedMarker).toBe('pnpm-workspace.yaml')
      expect(detail.root).toBe(tmpBase)
    })

    it('resolves submodule root when submodule itself contains oa.config.ts', () => {
      createStructure({
        'oa.config.ts': 'export default {}',
        'packages/isolated-sub/oa.config.json': '{}',
        'packages/isolated-sub/src': null,
      })

      const isolatedSrc = path.join(tmpBase, 'packages/isolated-sub/src')
      const detail = findProjectRootDetail(isolatedSrc)

      // Nearest enclosing config must win
      expect(detail.tier).toBe(3)
      expect(detail.root).toBe(path.join(tmpBase, 'packages/isolated-sub'))
      expect(detail.matchedMarker).toBe('oa.config.json')
    })
  })

  describe('Custom Markers & Options', () => {
    it('supports custom configFiles list', () => {
      createStructure({
        'custom.tool.config': 'hello',
        'src': null,
      })
      const detail = findProjectRootDetail({
        cwd: path.join(tmpBase, 'src'),
        markers: {
          configFiles: ['custom.tool.config'],
        },
      })
      expect(detail.tier).toBe(3)
      expect(detail.matchedMarker).toBe('custom.tool.config')
      expect(detail.root).toBe(tmpBase)
    })

    it('empty markers arrays disable corresponding tiers', () => {
      createStructure({
        'oa.config.ts': 'export default {}',
        'pnpm-workspace.yaml': 'packages:\n  - "packages/*"',
        '.git/config': '',
      })

      const detail = findProjectRootDetail({
        cwd: tmpBase,
        markers: {
          configFiles: [],
          workspaceFiles: [],
          vcsDirs: [],
        },
      })

      expect(detail.tier).toBe(6)
      expect(detail.reason).toBe('fallback')
      expect(detail.root).toBe(tmpBase)
    })
  })
})
