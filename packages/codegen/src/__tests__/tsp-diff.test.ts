import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import { compile, NodeHost } from '@typespec/compiler'
import {
  diffTypeSpecPrograms,
  formatTypeSpecDiffMarkdown,
  formatTypeSpecDiffJson,
  hasBreakingChanges,
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

describe('TypeSpec AST Semantic Diff & Breaking Change Analyzer Suite', () => {
  let fixture: WorkspaceFixture

  beforeEach(async () => {
    fixture = await createWorkspaceFixture({}, 'tsp-diff-')

    // Symlink repository root node_modules into fixture so @typespec/http and @typespec/openapi resolve
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
  // Section 1: Operation & Route Breaking Changes
  // =========================================================================
  describe('Operation & Route Breaking Changes', () => {
    it('detects operation-removed when an endpoint is deleted', async () => {
      const baseCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @get
        @route("/items")
        op getItems(): string;

        @post
        @route("/items")
        op createItem(): string;
      `
      const headCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @get
        @route("/items")
        op getItems(): string;
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(true)
      const change = result.breakingChanges.find(c => c.code === 'operation-removed')
      expect(change).toBeDefined()
      expect(change?.target).toContain('/items')
      expect(change?.detail).toContain('removed')
    })

    it('detects route-changed when an operation route path changes with same @operationId', async () => {
      const baseCode = `
        import "@typespec/http";
        import "@typespec/openapi";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;

        @route("/users/{id}")
        @get
        @operationId("getUserById")
        op getUser(id: string): string;
      `
      const headCode = `
        import "@typespec/http";
        import "@typespec/openapi";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;

        @route("/accounts/{id}")
        @get
        @operationId("getUserById")
        op getUser(id: string): string;
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(true)
      const change = result.breakingChanges.find(c => c.code === 'route-changed')
      expect(change).toBeDefined()
      expect(change?.detail).toContain('/users/{id}')
      expect(change?.detail).toContain('/accounts/{id}')
    })

    it('detects http-method-changed when an operation HTTP method changes with same @operationId', async () => {
      const baseCode = `
        import "@typespec/http";
        import "@typespec/openapi";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;

        @route("/data")
        @get
        @operationId("fetchData")
        op getData(): string;
      `
      const headCode = `
        import "@typespec/http";
        import "@typespec/openapi";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;

        @route("/data")
        @post
        @operationId("fetchData")
        op getData(): string;
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(true)
      const change = result.breakingChanges.find(c => c.code === 'http-method-changed')
      expect(change).toBeDefined()
      expect(change?.detail).toContain('GET')
      expect(change?.detail).toContain('POST')
    })

    it('detects operation-id-changed when @operationId changes or is removed', async () => {
      const baseCode = `
        import "@typespec/http";
        import "@typespec/openapi";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;

        @route("/login")
        @post
        @operationId("authenticateUser")
        op login(): string;
      `
      const headCode = `
        import "@typespec/http";
        import "@typespec/openapi";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;

        @route("/login")
        @post
        @operationId("performLogin")
        op login(): string;
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(true)
      const change = result.breakingChanges.find(c => c.code === 'operation-id-changed')
      expect(change).toBeDefined()
      expect(change?.detail).toContain('authenticateUser')
      expect(change?.detail).toContain('performLogin')
    })

    it('detects status-code-removed when a response status code is deleted', async () => {
      const baseCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @route("/resource")
        @get
        op getResource(): { @statusCode code: 200 } | { @statusCode code: 404 };
      `
      const headCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @route("/resource")
        @get
        op getResource(): { @statusCode code: 200 };
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(true)
      const change = result.breakingChanges.find(c => c.code === 'status-code-removed')
      expect(change).toBeDefined()
      expect(change?.detail).toContain('404')
    })

    it('detects parameter-type-changed when an operation parameter type changes (e.g. @path id: string -> int32)', async () => {
      const baseCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @route("/users/{id}")
        @get
        op getUser(@path id: string): string;
      `
      const headCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @route("/users/{id}")
        @get
        op getUser(@path id: int32): string;
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(true)
      const change = result.breakingChanges.find(c => c.code === 'parameter-type-changed')
      expect(change).toBeDefined()
      expect(change?.target).toContain('GET /users/{id} [id]')
      expect(change?.detail).toContain('string')
      expect(change?.detail).toContain('int32')
    })
  })

  // =========================================================================
  // Section 2: Model & Property Breaking Changes
  // =========================================================================
  describe('Model & Property Breaking Changes', () => {
    it('detects model-removed when a named model is deleted', async () => {
      const baseCode = `
        model User { id: string; }
        model LegacySession { token: string; }
      `
      const headCode = `
        model User { id: string; }
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(true)
      const change = result.breakingChanges.find(c => c.code === 'model-removed')
      expect(change).toBeDefined()
      expect(change?.target).toBe('LegacySession')
    })

    it('detects property-removed when a property is deleted from a model', async () => {
      const baseCode = `
        model Profile {
          id: string;
          username: string;
          bio: string;
        }
      `
      const headCode = `
        model Profile {
          id: string;
          username: string;
        }
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(true)
      const change = result.breakingChanges.find(c => c.code === 'property-removed')
      expect(change).toBeDefined()
      expect(change?.target).toBe('Profile.bio')
    })

    it('detects property-required when an existing optional property becomes required', async () => {
      const baseCode = `
        model Account {
          id: string;
          nickname?: string;
        }
      `
      const headCode = `
        model Account {
          id: string;
          nickname: string;
        }
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(true)
      const change = result.breakingChanges.find(c => c.code === 'property-required')
      expect(change).toBeDefined()
      expect(change?.target).toBe('Account.nickname')
      expect(change?.detail).toContain('became required')
    })

    it('detects required-property-added when a new required property is introduced', async () => {
      const baseCode = `
        model Config {
          name: string;
        }
      `
      const headCode = `
        model Config {
          name: string;
          apiKey: string;
        }
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(true)
      const change = result.breakingChanges.find(c => c.code === 'required-property-added')
      expect(change).toBeDefined()
      expect(change?.target).toBe('Config.apiKey')
      expect(change?.detail).toContain('Required property')
    })

    it('detects property-type-changed when a property type is modified', async () => {
      const baseCode = `
        model Metric {
          value: string;
        }
      `
      const headCode = `
        model Metric {
          value: int32;
        }
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(true)
      const change = result.breakingChanges.find(c => c.code === 'property-type-changed')
      expect(change).toBeDefined()
      expect(change?.target).toBe('Metric.value')
      expect(change?.detail).toContain('string')
      expect(change?.detail).toContain('int32')
    })

    it('detects property-type-changed when array element type changes from string[] to int32[]', async () => {
      const baseCode = `
        model Item {
          tags: string[];
        }
      `
      const headCode = `
        model Item {
          tags: int32[];
        }
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(true)
      const change = result.breakingChanges.find(c => c.code === 'property-type-changed')
      expect(change).toBeDefined()
      expect(change?.target).toBe('Item.tags')
      expect(change?.detail).toContain('string[]')
      expect(change?.detail).toContain('int32[]')
    })

    it('detects property-type-changed when multidimensional array changes (string[][] to string[])', async () => {
      const baseCode = `
        model Grid {
          matrix: string[][];
        }
      `
      const headCode = `
        model Grid {
          matrix: string[];
        }
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(true)
      const change = result.breakingChanges.find(c => c.code === 'property-type-changed')
      expect(change).toBeDefined()
      expect(change?.target).toBe('Grid.matrix')
      expect(change?.detail).toContain('string[][]')
      expect(change?.detail).toContain('string[]')
    })

    it('detects property-type-changed when generic model argument or record value type changes', async () => {
      const baseCode = `
        model User { id: string; }
        model Account { id: string; }
        model Page<T> { items: T[]; }
        model Container {
          data: Page<User>;
          meta: Record<string>;
        }
      `
      const headCode = `
        model User { id: string; }
        model Account { id: string; }
        model Page<T> { items: T[]; }
        model Container {
          data: Page<Account>;
          meta: Record<int32>;
        }
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(true)
      const pageChange = result.breakingChanges.find(
        c => c.code === 'property-type-changed' && c.target === 'Container.data',
      )
      expect(pageChange).toBeDefined()
      expect(pageChange?.detail).toContain('Page<User>')
      expect(pageChange?.detail).toContain('Page<Account>')

      const recordChange = result.breakingChanges.find(
        c => c.code === 'property-type-changed' && c.target === 'Container.meta',
      )
      expect(recordChange).toBeDefined()
      expect(recordChange?.detail).toContain('Record<string>')
      expect(recordChange?.detail).toContain('Record<int32>')
    })
  })

  // =========================================================================
  // Section 3: Non-Breaking Additive & Relaxing Changes
  // =========================================================================
  describe('Non-Breaking Additive & Relaxing Changes', () => {
    it('detects operation-added when a new endpoint is added', async () => {
      const baseCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @get
        @route("/ping")
        op ping(): string;
      `
      const headCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @get
        @route("/ping")
        op ping(): string;

        @get
        @route("/health")
        op health(): string;
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(false)
      const change = result.nonBreakingChanges.find(c => c.code === 'operation-added')
      expect(change).toBeDefined()
      expect(change?.target).toContain('/health')
    })

    it('detects model-added when a new domain model is added', async () => {
      const baseCode = `
        model User { id: string; }
      `
      const headCode = `
        model User { id: string; }
        model Role { name: string; }
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(false)
      const change = result.nonBreakingChanges.find(c => c.code === 'model-added')
      expect(change).toBeDefined()
      expect(change?.target).toBe('Role')
    })

    it('detects property-added when an optional property is added', async () => {
      const baseCode = `
        model Setting {
          theme: string;
        }
      `
      const headCode = `
        model Setting {
          theme: string;
          fontSize?: int32;
        }
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(false)
      const change = result.nonBreakingChanges.find(c => c.code === 'property-added')
      expect(change).toBeDefined()
      expect(change?.target).toBe('Setting.fontSize')
    })

    it('detects property-optional when a required property becomes optional', async () => {
      const baseCode = `
        model Document {
          title: string;
          summary: string;
        }
      `
      const headCode = `
        model Document {
          title: string;
          summary?: string;
        }
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(false)
      const change = result.nonBreakingChanges.find(c => c.code === 'property-optional')
      expect(change).toBeDefined()
      expect(change?.target).toBe('Document.summary')
      expect(change?.detail).toContain('became optional')
    })

    it('detects status-code-added when a new response code is added', async () => {
      const baseCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @route("/job")
        @post
        op createJob(): { @statusCode code: 201 };
      `
      const headCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @route("/job")
        @post
        op createJob(): { @statusCode code: 201 } | { @statusCode code: 202 };
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(false)
      const change = result.nonBreakingChanges.find(c => c.code === 'status-code-added')
      expect(change).toBeDefined()
      expect(change?.detail).toContain('202')
    })

    it('returns zero changes for identical TypeSpec specifications', async () => {
      const code = `
        import "@typespec/http";
        using TypeSpec.Http;

        model Item { id: string; price: int32; }

        @get
        @route("/items")
        op listItems(): Item[];
      `
      const base = await compileTspSnippet(code, 'base.tsp')
      const head = await compileTspSnippet(code, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(false)
      expect(result.summary.totalChanges).toBe(0)
      expect(result.summary.breakingCount).toBe(0)
      expect(result.summary.nonBreakingCount).toBe(0)

      const md = formatTypeSpecDiffMarkdown(result)
      expect(md).toContain('No semantic changes detected.')
    })
  })

  // =========================================================================
  // Section 4: Formatters
  // =========================================================================
  describe('Output Formatters', () => {
    it('formats diff results into human-readable Markdown', async () => {
      const baseCode = `
        model Person { name: string; age?: int32; }
      `
      const headCode = `
        model Person { name: string; age: int32; email: string; }
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'v1.tsp',
        headRef: 'v2.tsp',
      })

      const markdown = formatTypeSpecDiffMarkdown(result)
      expect(markdown).toContain('### TypeSpec Semantic Diff')
      expect(markdown).toContain('**Base**: `v1.tsp`')
      expect(markdown).toContain('**Head**: `v2.tsp`')
      expect(markdown).toContain('#### Breaking Changes')
      expect(markdown).toContain('property-required')
      expect(markdown).toContain('required-property-added')
    })

    it('formats diff results into valid JSON', async () => {
      const baseCode = `model Foo { a: string; }`
      const headCode = `model Foo { a: string; b?: string; }`
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      const jsonStr = formatTypeSpecDiffJson(result)
      const parsed = JSON.parse(jsonStr)
      expect(parsed.baseRef).toBe('base.tsp')
      expect(parsed.headRef).toBe('head.tsp')
      expect(parsed.summary.nonBreakingCount).toBe(1)
      expect(parsed.summary.breakingCount).toBe(0)
    })
  })

  // =========================================================================
  // Section 5: CLI Command Invocation & Exit Policies
  // =========================================================================
  describe('CLI Command Invocation & Exit Policies', () => {
    async function writeFixtureFiles(baseContent: string, headContent: string) {
      const baseFile = path.join(fixture.rootDir, 'base.tsp')
      const headFile = path.join(fixture.rootDir, 'head.tsp')
      await fs.writeFile(baseFile, baseContent, 'utf8')
      await fs.writeFile(headFile, headContent, 'utf8')
      return { baseFile, headFile }
    }

    it('exits with 0 when breaking changes exist WITHOUT --fail-on-breaking', async () => {
      const { baseFile, headFile } = await writeFixtureFiles(
        'model Old { id: string; }',
        'model New { id: string; }',
      )

      const result = runOaCli(
        ['tsp', 'diff', '--base', baseFile, '--head', headFile],
        { cwd: fixture.rootDir },
      )

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('model-removed')
      expect(result.stdout).toContain('model-added')
    })

    it('exits with 1 when breaking changes exist WITH --fail-on-breaking', async () => {
      const { baseFile, headFile } = await writeFixtureFiles(
        'model User { id: string; secret: string; }',
        'model User { id: string; }',
      )

      const result = runOaCli(
        ['tsp', 'diff', '--base', baseFile, '--head', headFile, '--fail-on-breaking'],
        { cwd: fixture.rootDir },
      )

      expect(result.status).toBe(1)
      expect(result.stdout).toContain('property-removed')
      expect(result.stdout).toContain('User.secret')
    })

    it('exits with 0 when only non-breaking changes exist WITH --fail-on-breaking', async () => {
      const { baseFile, headFile } = await writeFixtureFiles(
        'model User { id: string; }',
        'model User { id: string; nickname?: string; }',
      )

      const result = runOaCli(
        ['tsp', 'diff', '--base', baseFile, '--head', headFile, '--fail-on-breaking'],
        { cwd: fixture.rootDir },
      )

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('property-added')
      expect(result.stdout).toContain('User.nickname')
    })

    it('supports single-token alias tsp-diff', async () => {
      const { baseFile, headFile } = await writeFixtureFiles(
        'model X { id: string; }',
        'model X { id: string; }',
      )

      const result = runOaCli(
        ['tsp-diff', '--base', baseFile, '--head', headFile],
        { cwd: fixture.rootDir },
      )

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('No semantic changes detected')
    })

    it('supports colon-separated alias tsp:diff', async () => {
      const { baseFile, headFile } = await writeFixtureFiles(
        'model X { id: string; }',
        'model X { id: string; }',
      )

      const result = runOaCli(
        ['tsp:diff', '--base', baseFile, '--head', headFile],
        { cwd: fixture.rootDir },
      )

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('No semantic changes detected')
    })

    it('supports --format json from CLI', async () => {
      const { baseFile, headFile } = await writeFixtureFiles(
        'model Post { title: string; }',
        'model Post { title: string; body?: string; }',
      )

      const result = runOaCli(
        ['tsp', 'diff', '--base', baseFile, '--head', headFile, '--format', 'json'],
        { cwd: fixture.rootDir },
      )

      expect(result.status).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed.summary.nonBreakingCount).toBe(1)
      expect(parsed.summary.breakingCount).toBe(0)
    })

    it('exits with 1 when required --base option is missing', () => {
      const result = runOaCli(['tsp', 'diff', '--head', 'head.tsp'], {
        cwd: fixture.rootDir,
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('base')
    })

    it('exits with 1 when required --head option is missing', () => {
      const result = runOaCli(['tsp', 'diff', '--base', 'base.tsp'], {
        cwd: fixture.rootDir,
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('head')
    })

    it('exits with 1 when given invalid/non-existent reference', () => {
      const result = runOaCli(
        ['tsp', 'diff', '--base', 'does-not-exist.tsp', '--head', 'also-fake.tsp'],
        { cwd: fixture.rootDir },
      )
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Unable to resolve TypeSpec reference')
    })
  })

  // =========================================================================
  // Section 6: Git Ref Resolution Integration
  // =========================================================================
  describe('Git Ref Resolution Integration', () => {
    it('resolves git ref HEAD against packages/schemas/typespec/main.tsp', async () => {
      const result = runOaCli(
        [
          'tsp',
          'diff',
          '--base',
          'HEAD',
          '--head',
          'packages/schemas/typespec/main.tsp',
          '--format',
          'json',
        ],
        { cwd: REPO_ROOT },
      )

      expect(result.status).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed.summary.totalChanges).toBe(0)
    })

    it('resolves git ref HEAD~1 against HEAD', async () => {
      const result = runOaCli(
        [
          'tsp',
          'diff',
          '--base',
          'HEAD~1',
          '--head',
          'HEAD',
          '--format',
          'json',
        ],
        { cwd: REPO_ROOT },
      )

      expect(result.status).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed.baseRef).toBe('HEAD~1')
      expect(parsed.headRef).toBe('HEAD')
    })
  })
})
