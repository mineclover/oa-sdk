/**
 * packages/codegen/src/__tests__/root-discovery-cli.test.ts
 *
 * Comprehensive end-to-end CLI execution tests for Hierarchical Upward Project Root Discovery:
 * - Upward root resolution from deep subdirectories (workspace, config, git markers)
 * - Explicit CLI argument override (--root and --project-root), trailing and leading
 * - Environment variable override (OA_PROJECT_ROOT)
 * - Precedence rules: CLI arg > Env var > Config file > Workspace marker > VCS marker > cwd
 * - Submodule traversal safety (bypassing nested submodule .git/workspace markers when outer config exists)
 * - Universal global option acceptance across commands without 'Unknown option' errors
 * - Fallback to process.cwd()
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync, realpathSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { SUBPROCESS_TEST_BUDGET_MS } from './helpers/subprocess-budget.js'
import { stringify as yamlStringify } from 'yaml'
import { findProjectRoot } from '@oa-sdk/core'

const REPO_ROOT = findProjectRoot(__dirname)
const TSX_CLI = resolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs')
const TSX_BIN = resolve(REPO_ROOT, 'node_modules/.bin/tsx')
const CLI_SRC = resolve(REPO_ROOT, 'packages/codegen/src/cli/index.ts')
const CLI_DIST = resolve(REPO_ROOT, 'packages/codegen/dist/cli/index.js')


const SAMPLE_SPEC_YAML = yamlStringify({
  openapi: '3.2.0',
  info: { title: 'Test Spec', version: '1.0.0' },
  paths: {
    '/ping': {
      get: {
        operationId: 'getPing',
        responses: {
          '200': {
            description: 'pong',
            content: { 'application/json': { schema: { type: 'string' } } },
          },
        },
      },
    },
  },
})

interface CliResult {
  status: number | null
  stdout: string
  stderr: string
}

function runCli(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}): CliResult {
  const cwd = options.cwd ?? REPO_ROOT
  const timeout = options.timeout ?? SUBPROCESS_TEST_BUDGET_MS
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(options.env ?? {}),
  }

  let command = 'node'
  let commandArgs: string[] = []

  if (existsSync(TSX_CLI)) {
    command = 'node'
    commandArgs = [TSX_CLI, CLI_SRC, ...args]
  } else if (existsSync(TSX_BIN)) {
    command = TSX_BIN
    commandArgs = [CLI_SRC, ...args]
  } else if (existsSync(CLI_DIST)) {
    command = 'node'
    commandArgs = [CLI_DIST, ...args]
  } else {
    command = 'node'
    commandArgs = ['--import', 'tsx', CLI_SRC, ...args]
  }

  const result = spawnSync(command, commandArgs, {
    cwd,
    env,
    encoding: 'utf8',
    timeout,
  })

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

describe('CLI Project Root Discovery & Global Options', () => {
  let testRunDir: string

  beforeEach(() => {
    testRunDir = realpathSync(mkdtempSync(join(tmpdir(), 'oa-root-cli-test-')))
  })

  afterEach(() => {
    if (existsSync(testRunDir)) {
      rmSync(testRunDir, { recursive: true, force: true })
    }
  })


  describe('Upward Root Discovery from Deep Subdirectories', () => {
    it('resolves project root upward to pnpm-workspace.yaml when invoked from deep nested dir', () => {
      // Structure:
      // testRunDir/
      //   pnpm-workspace.yaml
      //   specs/
      //     api.yaml
      //   packages/
      //     engine/
      //       src/
      //         nested/
      //           feature/
      const projectRoot = testRunDir
      writeFileSync(join(projectRoot, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n')
      mkdirSync(join(projectRoot, 'specs'), { recursive: true })
      writeFileSync(join(projectRoot, 'specs/api.yaml'), SAMPLE_SPEC_YAML)

      const deepDir = join(projectRoot, 'packages/engine/src/nested/feature')
      mkdirSync(deepDir, { recursive: true })

      // Invoked with relative spec path from deep directory:
      const result = runCli(['validate', '--spec', 'specs/api.yaml'], { cwd: deepDir })

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Step 1: 파싱 + 구조 검증')
    })

    it('resolves project root upward to oa.config.json when invoked from deep nested dir', () => {
      const projectRoot = testRunDir
      writeFileSync(join(projectRoot, 'oa.config.json'), JSON.stringify({ rootDir: '.' }))
      mkdirSync(join(projectRoot, 'specs'), { recursive: true })
      writeFileSync(join(projectRoot, 'specs/api.yaml'), SAMPLE_SPEC_YAML)

      const deepDir = join(projectRoot, 'apps/client/src/components')
      mkdirSync(deepDir, { recursive: true })

      const result = runCli(['validate', '--spec', 'specs/api.yaml'], { cwd: deepDir })

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Step 1: 파싱 + 구조 검증')
    })
  })

  describe('Explicit CLI Option Override (--root and --project-root)', () => {
    it('resolves paths against explicit --root even when invoked from an unrelated external directory', () => {
      const projectRoot = join(testRunDir, 'target-project')
      mkdirSync(join(projectRoot, 'specs'), { recursive: true })
      writeFileSync(join(projectRoot, 'specs/api.yaml'), SAMPLE_SPEC_YAML)

      const externalDir = join(testRunDir, 'unrelated-dir')
      mkdirSync(externalDir, { recursive: true })

      const result = runCli(
        ['validate', '--spec', 'specs/api.yaml', '--root', projectRoot],
        { cwd: externalDir },
      )

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Step 1: 파싱 + 구조 검증')
    })

    it('resolves paths identically using --project-root alias', () => {
      const projectRoot = join(testRunDir, 'target-project')
      mkdirSync(join(projectRoot, 'specs'), { recursive: true })
      writeFileSync(join(projectRoot, 'specs/api.yaml'), SAMPLE_SPEC_YAML)

      const externalDir = join(testRunDir, 'unrelated-dir')
      mkdirSync(externalDir, { recursive: true })

      const result = runCli(
        ['validate', '--spec', 'specs/api.yaml', '--project-root', projectRoot],
        { cwd: externalDir },
      )

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Step 1: 파싱 + 구조 검증')
    })

    it('explicit --root overrides local workspace marker in current working directory', () => {
      // local dir has its own workspace marker but NO specs/api.yaml
      const localDir = join(testRunDir, 'local-workspace')
      mkdirSync(localDir, { recursive: true })
      writeFileSync(join(localDir, 'pnpm-workspace.yaml'), 'packages: []\n')

      const remoteRoot = join(testRunDir, 'remote-root')
      mkdirSync(join(remoteRoot, 'specs'), { recursive: true })
      writeFileSync(join(remoteRoot, 'specs/api.yaml'), SAMPLE_SPEC_YAML)

      const result = runCli(
        ['validate', '--spec', 'specs/api.yaml', '--root', remoteRoot],
        { cwd: localDir },
      )

      expect(result.status).toBe(0)
    })

    it('accepts leading --root before subcommand (oa-gen --root <dir> <cmd>)', () => {
      const projectRoot = join(testRunDir, 'leading-root')
      mkdirSync(join(projectRoot, 'specs'), { recursive: true })
      writeFileSync(join(projectRoot, 'specs/api.yaml'), SAMPLE_SPEC_YAML)

      const externalDir = join(testRunDir, 'outside')
      mkdirSync(externalDir, { recursive: true })

      const result = runCli(
        ['--root', projectRoot, 'validate', '--spec', 'specs/api.yaml'],
        { cwd: externalDir },
      )

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Step 1: 파싱 + 구조 검증')
    })

    it('accepts leading --project-root=<dir> before subcommand', () => {
      const projectRoot = join(testRunDir, 'leading-project-root')
      mkdirSync(join(projectRoot, 'specs'), { recursive: true })
      writeFileSync(join(projectRoot, 'specs/api.yaml'), SAMPLE_SPEC_YAML)

      const externalDir = join(testRunDir, 'outside')
      mkdirSync(externalDir, { recursive: true })

      const result = runCli(
        [`--project-root=${projectRoot}`, 'validate', '--spec', 'specs/api.yaml'],
        { cwd: externalDir },
      )

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Step 1: 파싱 + 구조 검증')
    })
  })

  describe('Environment Variable Override (OA_PROJECT_ROOT)', () => {
    it('uses OA_PROJECT_ROOT when set', () => {
      const targetRoot = join(testRunDir, 'env-target-root')
      mkdirSync(join(targetRoot, 'specs'), { recursive: true })
      writeFileSync(join(targetRoot, 'specs/api.yaml'), SAMPLE_SPEC_YAML)

      const unrelatedDir = join(testRunDir, 'outside')
      mkdirSync(unrelatedDir, { recursive: true })

      const result = runCli(
        ['validate', '--spec', 'specs/api.yaml'],
        {
          cwd: unrelatedDir,
          env: { OA_PROJECT_ROOT: targetRoot },
        },
      )

      expect(result.status).toBe(0)
    })

    it('explicit --root takes precedence over OA_PROJECT_ROOT (Tier 1 > Tier 2)', () => {
      const validRoot = join(testRunDir, 'valid-root')
      mkdirSync(join(validRoot, 'specs'), { recursive: true })
      writeFileSync(join(validRoot, 'specs/api.yaml'), SAMPLE_SPEC_YAML)

      const invalidRoot = join(testRunDir, 'bogus-root')
      mkdirSync(invalidRoot, { recursive: true })

      const result = runCli(
        ['validate', '--spec', 'specs/api.yaml', '--root', validRoot],
        {
          cwd: testRunDir,
          env: { OA_PROJECT_ROOT: invalidRoot },
        },
      )

      expect(result.status).toBe(0)
    })
  })

  describe('Submodule Traversal Safety', () => {
    it('traverses past nested submodule .git / pnpm-workspace to parent with oa.config.json', () => {
      // Monorepo root has oa.config.json
      const parentRoot = testRunDir
      writeFileSync(join(parentRoot, 'oa.config.json'), JSON.stringify({ rootDir: '.' }))
      mkdirSync(join(parentRoot, 'specs'), { recursive: true })
      writeFileSync(join(parentRoot, 'specs/root-api.yaml'), SAMPLE_SPEC_YAML)

      // Submodule has .git and pnpm-workspace.yaml
      const submoduleDir = join(parentRoot, 'packages/browser-mapper')
      mkdirSync(submoduleDir, { recursive: true })
      writeFileSync(join(submoduleDir, '.git'), 'gitdir: ../../.git/modules/browser-mapper\n')
      writeFileSync(join(submoduleDir, 'pnpm-workspace.yaml'), 'packages: ["packages/*"]\n')

      const deepSubmoduleDir = join(submoduleDir, 'packages/selector-evaluator/src')
      mkdirSync(deepSubmoduleDir, { recursive: true })

      const result = runCli(
        ['validate', '--spec', 'specs/root-api.yaml'],
        { cwd: deepSubmoduleDir },
      )

      expect(result.status).toBe(0)
    })
  })

  describe('Universal Global Option Acceptance across Commands', () => {
    it('accepts --root across multiple oa-gen commands without throwing Unknown option error', () => {
      const rootDir = testRunDir
      mkdirSync(join(rootDir, 'specs'), { recursive: true })
      writeFileSync(join(rootDir, 'specs/api.yaml'), SAMPLE_SPEC_YAML)

      const commandsToTest = [
        ['validate', '--spec', 'specs/api.yaml', '--root', rootDir],
        ['lint', '--spec', 'specs/api.yaml', '--root', rootDir],
        ['typegen', '--spec', 'specs/api.yaml', '--root', rootDir, '--output', join(rootDir, 'types.ts')],
        ['audit:csp', '--help', '--root', rootDir],
        ['generate', '--help', '--root', rootDir],
        ['diff', '--help', '--root', rootDir],
      ]

      for (const cmdArgs of commandsToTest) {
        const result = runCli(cmdArgs, { cwd: rootDir })
        expect(result.stderr).not.toContain("Unknown option '--root'")
        expect(result.stderr).not.toContain("Unknown option '--project-root'")
      }
    })
  })

  describe('Fallback Behavior', () => {
    it('falls back to process.cwd() when no markers or options are present', () => {
      const isolatedDir = join(testRunDir, 'isolated-fallback')
      mkdirSync(isolatedDir, { recursive: true })
      writeFileSync(join(isolatedDir, 'api.yaml'), SAMPLE_SPEC_YAML)

      const result = runCli(['validate', '--spec', 'api.yaml'], { cwd: isolatedDir })

      expect(result.status).toBe(0)
    })
  })
})
