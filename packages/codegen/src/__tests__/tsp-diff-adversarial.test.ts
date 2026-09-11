import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as child_process from 'node:child_process'
import { compile, NodeHost } from '@typespec/compiler'
import {
  diffTypeSpecPrograms,
  formatTypeSpecDiffMarkdown,
  formatTypeSpecDiffJson,
  hasBreakingChanges,
  extractTypeSpecSemantics,
} from '../cli/lib/typespec-ast-diff.js'
import { resolveTypeSpecProgramRef } from '../cli/lib/typespec-ref-resolver.js'
import { runOaCli } from './e2e/helpers/cli-runner.js'
import { createWorkspaceFixture, type WorkspaceFixture } from './e2e/helpers/fixture-builder.js'

function findMonorepoRoot(): string {
  let curr = process.cwd()
  while (curr !== path.dirname(curr)) {
    if (fsSync.existsSync(path.join(curr, '.git'))) {
      return curr
    }
    curr = path.dirname(curr)
  }
  return process.cwd()
}

const REPO_ROOT = findMonorepoRoot()

describe('Adversarial Challenge Suite: TypeSpec AST Semantic Diff (Milestone 1)', () => {
  let fixture: WorkspaceFixture

  beforeEach(async () => {
    fixture = await createWorkspaceFixture({}, 'tsp-diff-adv-')
    const fixtureNodeModules = path.join(fixture.rootDir, 'node_modules')
    const rootNodeModules = path.join(REPO_ROOT, 'node_modules')
    if (!fsSync.existsSync(fixtureNodeModules) && fsSync.existsSync(rootNodeModules)) {
      await fs.symlink(rootNodeModules, fixtureNodeModules, 'dir').catch(() => {})
    }
  })

  afterEach(async () => {
    if (fixture) {
      await fixture.cleanup()
    }
  })

  async function compileTspSnippet(content: string, filename = 'spec.tsp') {
    const filePath = path.join(fixture.rootDir, filename)
    await fs.writeFile(filePath, content, 'utf8')
    const program = await compile(NodeHost, filePath, { noEmit: true })
    return { program, filePath }
  }

  // =========================================================================
  // Track 1: Git Reference Resolution Edge Cases
  // =========================================================================
  describe('Track 1: Git Reference Resolution Edge Cases', () => {
    it('resolves full 40-character commit hash cleanly', async () => {
      const fullSha = child_process.execSync('git rev-parse HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
      const resolved = await resolveTypeSpecProgramRef(fullSha, REPO_ROOT)
      try {
        expect(resolved.program).toBeDefined()
        expect(resolved.entrypoint).toContain('main.tsp')
      } finally {
        await resolved.cleanup()
      }
    })

    it('resolves short commit hash (7 characters) cleanly', async () => {
      const shortSha = child_process.execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
      const resolved = await resolveTypeSpecProgramRef(shortSha, REPO_ROOT)
      try {
        expect(resolved.program).toBeDefined()
        expect(resolved.entrypoint).toContain('main.tsp')
      } finally {
        await resolved.cleanup()
      }
    })

    it('resolves relative directory pointing to a TypeSpec project', async () => {
      const resolved = await resolveTypeSpecProgramRef('packages/schemas/typespec', REPO_ROOT)
      try {
        expect(resolved.program).toBeDefined()
        expect(resolved.entrypoint).toContain('main.tsp')
      } finally {
        await resolved.cleanup()
      }
    })

    it('resolves absolute directory path cleanly', async () => {
      const absDir = path.resolve(REPO_ROOT, 'packages/schemas/typespec')
      const resolved = await resolveTypeSpecProgramRef(absDir, REPO_ROOT)
      try {
        expect(resolved.program).toBeDefined()
        expect(resolved.entrypoint).toBe(path.join(absDir, 'main.tsp'))
      } finally {
        await resolved.cleanup()
      }
    })

    it('resolves absolute file path directly', async () => {
      const absFile = path.resolve(REPO_ROOT, 'packages/schemas/typespec/main.tsp')
      const resolved = await resolveTypeSpecProgramRef(absFile, REPO_ROOT)
      try {
        expect(resolved.program).toBeDefined()
        expect(resolved.entrypoint).toBe(absFile)
      } finally {
        await resolved.cleanup()
      }
    })

    it('cleanly rejects non-existent git references with descriptive error', async () => {
      await expect(
        resolveTypeSpecProgramRef('non-existent-git-ref-deadbeef', REPO_ROOT)
      ).rejects.toThrow(/Unable to resolve TypeSpec reference "non-existent-git-ref-deadbeef"/)
    })

    it('cleanly rejects shell injection attempts in git ref string', async () => {
      await expect(
        resolveTypeSpecProgramRef('HEAD; echo "injected"', REPO_ROOT)
      ).rejects.toThrow(/Unable to resolve TypeSpec reference/)
    })

    it('reports error when pointing to directory without main.tsp or tspconfig.yaml', async () => {
      const emptyDir = path.join(fixture.rootDir, 'empty-dir')
      await fs.mkdir(emptyDir, { recursive: true })
      // When pointing to empty dir, compile(NodeHost, emptyDir) fails to locate entrypoint
      await expect(
        resolveTypeSpecProgramRef(emptyDir, fixture.rootDir)
      ).rejects.toThrow()
    })
  })

  // =========================================================================
  // Track 2: Complex TypeSpec Models
  // =========================================================================
  describe('Track 2: Complex TypeSpec Models', () => {
    it('stress tests generic template Page<T>: property deletion on template', async () => {
      const baseCode = `
        model Page<T> {
          items: T[];
          total: int32;
        }
        model User { id: string; }
        model UserPage is Page<User>;
      `
      const headCode = `
        model Page<T> {
          items: T[];
        }
        model User { id: string; }
        model UserPage is Page<User>;
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      // Checking what was extracted
      const baseSemantics = extractTypeSpecSemantics(base.program)
      const headSemantics = extractTypeSpecSemantics(head.program)

      // Verify whether Page or UserPage or both are captured and diffed
      expect(hasBreakingChanges(result)).toBe(true)
      const totalRemoved = result.breakingChanges.find(
        c => c.code === 'property-removed' && (c.target.includes('total'))
      )
      expect(totalRemoved).toBeDefined()
    })

    it('stress tests generic template Page<T>: required property added to template', async () => {
      const baseCode = `
        model Page<T> {
          items: T[];
        }
        model Product { sku: string; }
        model ProductPage is Page<Product>;
      `
      const headCode = `
        model Page<T> {
          items: T[];
          cursor: string;
        }
        model Product { sku: string; }
        model ProductPage is Page<Product>;
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(true)
      const propAdded = result.breakingChanges.find(
        c => c.code === 'required-property-added' && c.target.includes('cursor')
      )
      expect(propAdded).toBeDefined()
    })

    it('stress tests deeply nested namespaces', async () => {
      const baseCode = `
        namespace Company.ECommerce.Catalog {
          model Product {
            id: string;
            price: int32;
          }
        }
      `
      const headCode = `
        namespace Company.ECommerce.Catalog {
          model Product {
            id: string;
          }
        }
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(true)
      const priceRemoved = result.breakingChanges.find(
        c => c.code === 'property-removed' && c.target.includes('price')
      )
      expect(priceRemoved).toBeDefined()
    })

    it('stress tests multiple namespaces with same model name: collision vulnerability', async () => {
      const baseCode = `
        namespace ServiceA {
          model Config {
            timeoutMs: int32;
          }
        }
        namespace ServiceB {
          model Config {
            retries: int32;
          }
        }
      `
      // ServiceA.Config is deleted in head!
      const headCode = `
        namespace ServiceB {
          model Config {
            retries: int32;
          }
        }
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const baseSemantics = extractTypeSpecSemantics(base.program)
      const headSemantics = extractTypeSpecSemantics(head.program)

      // Examine extracted models map keys and sizes
      console.log('Base model names:', Array.from(baseSemantics.models.keys()))
      console.log('Head model names:', Array.from(headSemantics.models.keys()))

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      // If models are keyed only by simple name 'Config', ServiceA.Config was overwritten by ServiceB.Config
      // in baseSemantics.models, so deleting ServiceA.Config in head produces ZERO changes!
      const modelRemovedChange = result.breakingChanges.find(c => c.code === 'model-removed')
      console.log('Total breaking changes for deleted ServiceA.Config:', result.breakingChanges.length)
      console.log('Detected model-removed?', Boolean(modelRemovedChange))
    })

    it('stress tests generic template Page<T> used directly in operation return type', async () => {
      const baseCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        model Page<T> {
          items: T[];
          total: int32;
        }
        model User { id: string; }

        @get
        @route("/users")
        op listUsers(): Page<User>;
      `
      const headCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        model Page<T> {
          items: T[];
        }
        model User { id: string; }

        @get
        @route("/users")
        op listUsers(): Page<User>;
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const baseSemantics = extractTypeSpecSemantics(base.program)
      console.log('Base semantics models with Page<T>:', Array.from(baseSemantics.models.keys()))
      const pageModel = baseSemantics.models.get('Page')
      console.log('Page model properties:', pageModel ? Array.from(pageModel.properties.keys()) : 'NOT FOUND')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      console.log('Diff result for Page<T> property removal:', result.breakingChanges)
      expect(result.breakingChanges.some(c => c.code === 'property-removed' && c.target.includes('total'))).toBe(true)
    })


    it('stress tests model renaming: classified as model-removed (breaking) and model-added (non-breaking)', async () => {
      const baseCode = `
        model Customer {
          id: string;
          name: string;
        }
      `
      const headCode = `
        model Client {
          id: string;
          name: string;
        }
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(true)
      const removed = result.breakingChanges.find(c => c.code === 'model-removed' && c.target === 'Customer')
      expect(removed).toBeDefined()

      const added = result.nonBreakingChanges.find(c => c.code === 'model-added' && c.target === 'Client')
      expect(added).toBeDefined()
    })
  })

  // =========================================================================
  // Track 3: Format Outputs & CLI Error Handling
  // =========================================================================
  describe('Track 3: Format Outputs & CLI Error Handling', () => {
    it('verifies valid JSON structure matching TypeSpecDiffResult schema', async () => {
      const baseFile = path.join(fixture.rootDir, 'base.tsp')
      const headFile = path.join(fixture.rootDir, 'head.tsp')
      await fs.writeFile(baseFile, 'model A { x: string; }', 'utf8')
      await fs.writeFile(headFile, 'model A { x: string; y?: string; }', 'utf8')

      const cliRes = runOaCli(
        ['tsp', 'diff', '--base', baseFile, '--head', headFile, '--format', 'json'],
        { cwd: fixture.rootDir }
      )

      expect(cliRes.status).toBe(0)
      const parsed = JSON.parse(cliRes.stdout)
      expect(parsed).toHaveProperty('baseRef', baseFile)
      expect(parsed).toHaveProperty('headRef', headFile)
      expect(parsed).toHaveProperty('breakingChanges')
      expect(Array.isArray(parsed.breakingChanges)).toBe(true)
      expect(parsed).toHaveProperty('nonBreakingChanges')
      expect(Array.isArray(parsed.nonBreakingChanges)).toBe(true)
      expect(parsed).toHaveProperty('allChanges')
      expect(Array.isArray(parsed.allChanges)).toBe(true)
      expect(parsed).toHaveProperty('summary')
      expect(parsed.summary).toEqual({
        totalChanges: 1,
        breakingCount: 0,
        nonBreakingCount: 1,
      })
    })

    it('verifies markdown output formatting details', async () => {
      const baseFile = path.join(fixture.rootDir, 'base.tsp')
      const headFile = path.join(fixture.rootDir, 'head.tsp')
      await fs.writeFile(baseFile, 'model A { x: string; }', 'utf8')
      await fs.writeFile(headFile, 'model A { }', 'utf8')

      const cliRes = runOaCli(
        ['tsp', 'diff', '--base', baseFile, '--head', headFile, '--format', 'markdown'],
        { cwd: fixture.rootDir }
      )

      expect(cliRes.status).toBe(0)
      expect(cliRes.stdout).toContain('### TypeSpec Semantic Diff')
      expect(cliRes.stdout).toContain('**Base**:')
      expect(cliRes.stdout).toContain('**Head**:')
      expect(cliRes.stdout).toContain('Summary: **!1** breaking')
      expect(cliRes.stdout).toContain('#### Breaking Changes')
      expect(cliRes.stdout).toContain('`property-removed` `A.x`')
    })

    it('handles compilation syntax errors in input files cleanly with exit code 1', async () => {
      const brokenFile = path.join(fixture.rootDir, 'broken.tsp')
      const validFile = path.join(fixture.rootDir, 'valid.tsp')
      await fs.writeFile(brokenFile, 'model Broken {{{ invalid syntax', 'utf8')
      await fs.writeFile(validFile, 'model Valid { id: string; }', 'utf8')

      const cliRes = runOaCli(
        ['tsp', 'diff', '--base', brokenFile, '--head', validFile],
        { cwd: fixture.rootDir }
      )

      expect(cliRes.status).toBe(1)
      expect(cliRes.stderr).toContain('TypeSpec compilation failed')
    })

    it('fails immediately when missing both --base and --head', () => {
      const cliRes = runOaCli(['tsp', 'diff'], { cwd: fixture.rootDir })
      expect(cliRes.status).toBe(1)
      expect(cliRes.stderr).toContain('base')
    })
  })
})
