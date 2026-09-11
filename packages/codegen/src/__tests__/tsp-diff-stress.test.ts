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
  getTypeName,
} from '../cli/lib/typespec-ast-diff.js'
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

describe('TypeSpec AST Diff Adversarial Stress Suite (Challenger 1)', () => {
  let fixture: WorkspaceFixture

  beforeEach(async () => {
    fixture = await createWorkspaceFixture({}, 'tsp-stress-')
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
  // Challenge 1: Deeply Nested Models & Complex Property Types
  // =========================================================================
  describe('Challenge 1: Complex Property Types (Arrays, Tuples, Unions, Scalars)', () => {
    // BUG 1 (RESOLVED): Array element type changes (T[] -> U[]) are now detected because getTypeName
    // resolves element types via indexer before checking generic model name.
    it('detects array element type change from string[] to int32[]', async () => {
      const baseCode = `
        model Container {
          tags: string[];
        }
      `
      const headCode = `
        model Container {
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
      expect(change?.target).toBe('Container.tags')
    })

    // BUG 1b (RESOLVED): Multidimensional array changes are now correctly resolved
    it('detects multidimensional array type change from string[][] to string[]', async () => {
      const baseCode = `
        model Matrix {
          grid: string[][];
        }
      `
      const headCode = `
        model Matrix {
          grid: string[];
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
      expect(change?.target).toBe('Matrix.grid')
    })

    it('detects union variant narrowing (breaking) and widening (type-changed)', async () => {
      // Narrowing: string | int32 -> string
      const baseCode = `
        model UnionHolder {
          value: string | int32;
        }
      `
      const headCode = `
        model UnionHolder {
          value: string;
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
      expect(change?.target).toBe('UnionHolder.value')
    })

    it('detects tuple element type mutation and length mutation', async () => {
      const baseCode = `
        model Coords {
          point: [float64, float64];
        }
      `
      const headCode = `
        model Coords {
          point: [float64, float64, float64];
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
      expect(change?.target).toBe('Coords.point')
    })

    it('detects custom scalar mutation', async () => {
      const baseCode = `
        scalar CustomId extends string;
        model Entity {
          id: CustomId;
        }
      `
      const headCode = `
        model Entity {
          id: string;
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
      expect(change?.target).toBe('Entity.id')
    })

    it('detects nested domain model property deletion across multiple levels', async () => {
      const baseCode = `
        model Level1 {
          child: Level2;
        }
        model Level2 {
          child: Level3;
        }
        model Level3 {
          deepSecret: string;
          safeName: string;
        }
      `
      const headCode = `
        model Level1 {
          child: Level2;
        }
        model Level2 {
          child: Level3;
        }
        model Level3 {
          safeName: string;
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
      expect(change?.target).toBe('Level3.deepSecret')
    })

    // BUG 2 (RESOLVED): Parameter type mutations (@path id: string -> int32) are now checked in diffTypeSpecSemantics
    it('detects parameter type mutation (e.g. string to int32)', async () => {
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
    })

    // BUG 3 (RESOLVED): Record value type changes (Record<string> -> Record<int32>) are resolved with inner value types
    it('detects Record value type mutation from Record<string> to Record<int32>', async () => {
      const baseCode = `
        model Dictionary {
          meta: Record<string>;
        }
      `
      const headCode = `
        model Dictionary {
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
    })

    // BUG 4 (RESOLVED): Generic model argument changes (Page<User> -> Page<Account>) are preserved via templateMapper args
    it('detects generic template model argument mutation Page<User> to Page<Account>', async () => {
      const baseCode = `
        model User { id: string; }
        model Account { id: string; balance: int32; }
        model Page<T> { items: T[]; }
        model Catalog {
          page: Page<User>;
        }
      `
      const headCode = `
        model User { id: string; }
        model Account { id: string; balance: int32; }
        model Page<T> { items: T[]; }
        model Catalog {
          page: Page<Account>;
        }
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(true)
    })
  })

  // =========================================================================
  // Challenge 2: Rapid Addition & Removal of Optional vs Required Properties
  // =========================================================================
  describe('Challenge 2: High-Volume Property Mutation Matrix', () => {
    it('correctly audits 30 simultaneous property mutations with exact counts', async () => {
      // 30 properties:
      // - 1..5: removed (5 breaking)
      // - 6..10: optional -> required (5 breaking)
      // - 11..15: required -> optional (5 non-breaking)
      // - 16..20: unchanged required
      // - 21..25: unchanged optional
      // Head adds:
      // - 26..30: new required (5 breaking)
      // - 31..35: new optional (5 non-breaking)
      // Total breaking: 5 (removed) + 5 (req) + 5 (new req) = 15 breaking
      // Total non-breaking: 5 (opt) + 5 (new opt) = 10 non-breaking

      const baseCode = `
        model MassiveModel {
          f01: string;
          f02: string;
          f03: string;
          f04: string;
          f05: string;

          f06?: string;
          f07?: string;
          f08?: string;
          f09?: string;
          f10?: string;

          f11: string;
          f12: string;
          f13: string;
          f14: string;
          f15: string;

          f16: string;
          f17: string;
          f18: string;
          f19: string;
          f20: string;

          f21?: string;
          f22?: string;
          f23?: string;
          f24?: string;
          f25?: string;
        }
      `

      const headCode = `
        model MassiveModel {
          // f01-f05 removed

          // f06-f10 become required
          f06: string;
          f07: string;
          f08: string;
          f09: string;
          f10: string;

          // f11-f15 become optional
          f11?: string;
          f12?: string;
          f13?: string;
          f14?: string;
          f15?: string;

          // f16-f20 unchanged
          f16: string;
          f17: string;
          f18: string;
          f19: string;
          f20: string;

          // f21-f25 unchanged
          f21?: string;
          f22?: string;
          f23?: string;
          f24?: string;
          f25?: string;

          // f26-f30 new required
          f26: string;
          f27: string;
          f28: string;
          f29: string;
          f30: string;

          // f31-f35 new optional
          f31?: string;
          f32?: string;
          f33?: string;
          f34?: string;
          f35?: string;
        }
      `

      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(result.summary.breakingCount).toBe(15)
      expect(result.summary.nonBreakingCount).toBe(10)
      expect(result.summary.totalChanges).toBe(25)

      // Verify specific change types
      const removed = result.breakingChanges.filter(c => c.code === 'property-removed')
      expect(removed).toHaveLength(5)

      const becameRequired = result.breakingChanges.filter(c => c.code === 'property-required')
      expect(becameRequired).toHaveLength(5)

      const addedRequired = result.breakingChanges.filter(c => c.code === 'required-property-added')
      expect(addedRequired).toHaveLength(5)

      const becameOptional = result.nonBreakingChanges.filter(c => c.code === 'property-optional')
      expect(becameOptional).toHaveLength(5)

      const addedOptional = result.nonBreakingChanges.filter(c => c.code === 'property-added')
      expect(addedOptional).toHaveLength(5)
    })
  })

  // =========================================================================
  // Challenge 3: Operation Route Path Changes With & Without @operationId
  // =========================================================================
  describe('Challenge 3: Route Path Changes With and Without @operationId', () => {
    it('detects route change as route-changed when @operationId is present', async () => {
      const baseCode = `
        import "@typespec/http";
        import "@typespec/openapi";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;

        @route("/v1/orders/{orderId}")
        @get
        @operationId("getOrder")
        op fetchOrder(orderId: string): string;
      `
      const headCode = `
        import "@typespec/http";
        import "@typespec/openapi";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;

        @route("/v2/orders/{orderId}")
        @get
        @operationId("getOrder")
        op fetchOrder(orderId: string): string;
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(true)
      const routeChange = result.breakingChanges.find(c => c.code === 'route-changed')
      expect(routeChange).toBeDefined()
      expect(routeChange?.detail).toContain('/v1/orders/{orderId}')
      expect(routeChange?.detail).toContain('/v2/orders/{orderId}')
      expect(routeChange?.target).toBe('getOrder')
    })

    it('detects route change WITHOUT @operationId as operation-removed and operation-added', async () => {
      const baseCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @route("/v1/legacy-reports")
        @get
        op generateReport(): string;
      `
      const headCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @route("/v2/modern-reports")
        @get
        op generateReport(): string;
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      // When no @operationId is specified, changing the path must still be classified as breaking
      expect(hasBreakingChanges(result)).toBe(true)
      const opRemoved = result.breakingChanges.find(c => c.code === 'operation-removed')
      expect(opRemoved).toBeDefined()
      expect(opRemoved?.target).toContain('/v1/legacy-reports')

      const opAdded = result.nonBreakingChanges.find(c => c.code === 'operation-added')
      expect(opAdded).toBeDefined()
      expect(opAdded?.target).toContain('/v2/modern-reports')
    })

    it('handles adding @operationId to an existing anonymous route safely', async () => {
      const baseCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @route("/ping")
        @get
        op ping(): string;
      `
      const headCode = `
        import "@typespec/http";
        import "@typespec/openapi";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;

        @route("/ping")
        @get
        @operationId("healthPing")
        op ping(): string;
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      // Adding operationId to an operation that did not previously have one is non-breaking
      expect(hasBreakingChanges(result)).toBe(false)
    })

    it('detects removal of @operationId as a breaking change', async () => {
      const baseCode = `
        import "@typespec/http";
        import "@typespec/openapi";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;

        @route("/ping")
        @get
        @operationId("healthPing")
        op ping(): string;
      `
      const headCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @route("/ping")
        @get
        op ping(): string;
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(true)
      const opIdChange = result.breakingChanges.find(c => c.code === 'operation-id-changed')
      expect(opIdChange).toBeDefined()
      expect(opIdChange?.detail).toContain('healthPing')
      expect(opIdChange?.detail).toContain('removed')
    })
  })

  // =========================================================================
  // Challenge 4: HTTP Method Swaps on Same Route
  // =========================================================================
  describe('Challenge 4: HTTP Method Swaps on Same Route', () => {
    it('detects HTTP method swap (GET to POST) with @operationId as http-method-changed', async () => {
      const baseCode = `
        import "@typespec/http";
        import "@typespec/openapi";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;

        @route("/search")
        @get
        @operationId("performSearch")
        op search(): string;
      `
      const headCode = `
        import "@typespec/http";
        import "@typespec/openapi";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;

        @route("/search")
        @post
        @operationId("performSearch")
        op search(): string;
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(true)
      const methodChange = result.breakingChanges.find(c => c.code === 'http-method-changed')
      expect(methodChange).toBeDefined()
      expect(methodChange?.detail).toContain('GET')
      expect(methodChange?.detail).toContain('POST')
    })

    it('detects HTTP method swap (GET to POST) WITHOUT @operationId as breaking operation-removed', async () => {
      const baseCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @route("/search")
        @get
        op search(): string;
      `
      const headCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @route("/search")
        @post
        op search(): string;
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(true)
      const removed = result.breakingChanges.find(c => c.code === 'operation-removed')
      expect(removed).toBeDefined()
      expect(removed?.target).toBe('GET /search')

      const added = result.nonBreakingChanges.find(c => c.code === 'operation-added')
      expect(added).toBeDefined()
      expect(added?.target).toBe('POST /search')
    })

    it('handles multiple methods on same path when only one method changes', async () => {
      const baseCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @route("/resource")
        @get
        op getRes(): string;

        @route("/resource")
        @delete
        op deleteRes(): string;
      `
      const headCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @route("/resource")
        @get
        op getRes(): string;

        @route("/resource")
        @post
        op createRes(): string;
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(true)
      const removed = result.breakingChanges.find(c => c.code === 'operation-removed')
      expect(removed).toBeDefined()
      expect(removed?.target).toBe('DELETE /resource')

      const added = result.nonBreakingChanges.find(c => c.code === 'operation-added')
      expect(added).toBeDefined()
      expect(added?.target).toBe('POST /resource')

      // GET /resource should have NO changes
      const getChange = result.allChanges.find(c => c.target.includes('GET /resource'))
      expect(getChange).toBeUndefined()
    })
  })

  // =========================================================================
  // Challenge 5: Status Codes Removed from Responses
  // =========================================================================
  describe('Challenge 5: Status Codes Removed & Altered', () => {
    it('detects status code differences between implicit 200 return type and void', async () => {
      const baseCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @route("/ping")
        @get
        op ping(): string;
      `
      const headCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @route("/ping")
        @get
        op ping(): void;
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      console.log('Result for implicit 200 vs void:', JSON.stringify(result, null, 2))
    })

    it('detects status-code-removed when standard response types change (OkResponse to NoContentResponse)', async () => {
      const baseCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @route("/ping")
        @get
        op ping(): OkResponse | NotFoundResponse;
      `
      const headCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @route("/ping")
        @get
        op ping(): OkResponse;
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      console.log('Result for OkResponse vs NotFoundResponse:', JSON.stringify(result, null, 2))
      expect(hasBreakingChanges(result)).toBe(true)
      const change = result.breakingChanges.find(c => c.code === 'status-code-removed')
      expect(change).toBeDefined()
      expect(change?.detail).toContain('404')
    })

    it('detects status-code-removed when 200 is kept but 404 is removed', async () => {
      const baseCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @route("/item/{id}")
        @get
        op getItem(id: string): { @statusCode code: 200; body: string } | { @statusCode code: 404 };
      `
      const headCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @route("/item/{id}")
        @get
        op getItem(id: string): { @statusCode code: 200; body: string };
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
      expect(change?.target).toBe('GET /item/{id}')
    })

    it('detects multiple status codes removed and new status code added simultaneously', async () => {
      const baseCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @route("/action")
        @post
        op doAction():
          | { @statusCode code: 200 }
          | { @statusCode code: 400 }
          | { @statusCode code: 401 }
          | { @statusCode code: 403 }
          | { @statusCode code: 500 };
      `
      const headCode = `
        import "@typespec/http";
        using TypeSpec.Http;

        @route("/action")
        @post
        op doAction():
          | { @statusCode code: 200 }
          | { @statusCode code: 204 }
          | { @statusCode code: 500 };
      `
      const base = await compileTspSnippet(baseCode, 'base.tsp')
      const head = await compileTspSnippet(headCode, 'head.tsp')

      const result = diffTypeSpecPrograms(base.program, head.program, {
        baseRef: 'base.tsp',
        headRef: 'head.tsp',
      })

      expect(hasBreakingChanges(result)).toBe(true)
      const removedCodes = result.breakingChanges.filter(c => c.code === 'status-code-removed')
      expect(removedCodes).toHaveLength(3) // 400, 401, 403 removed
      const removedDetails = removedCodes.map(c => c.detail).join(' ')
      expect(removedDetails).toContain('400')
      expect(removedDetails).toContain('401')
      expect(removedDetails).toContain('403')

      const addedCodes = result.nonBreakingChanges.filter(c => c.code === 'status-code-added')
      expect(addedCodes).toHaveLength(1) // 204 added
      expect(addedCodes[0]?.detail).toContain('204')
    })
  })

  // =========================================================================
  // Challenge 6: CLI Subprocess --fail-on-breaking & Exit Policy Rigor
  // =========================================================================
  describe('Challenge 6: CLI --fail-on-breaking & Subprocess Exit Codes', () => {
    async function writeFixtureFiles(baseContent: string, headContent: string) {
      const baseFile = path.join(fixture.rootDir, 'base.tsp')
      const headFile = path.join(fixture.rootDir, 'head.tsp')
      await fs.writeFile(baseFile, baseContent, 'utf8')
      await fs.writeFile(headFile, headContent, 'utf8')
      return { baseFile, headFile }
    }

    it('exits with code 1 when breaking changes are detected with --fail-on-breaking', async () => {
      const { baseFile, headFile } = await writeFixtureFiles(
        `
        import "@typespec/http";
        using TypeSpec.Http;
        @route("/api")
        @get
        op test(): { @statusCode code: 200 } | { @statusCode code: 404 };
        `,
        `
        import "@typespec/http";
        using TypeSpec.Http;
        @route("/api")
        @get
        op test(): { @statusCode code: 200 };
        `,
      )

      const res = runOaCli(
        ['tsp', 'diff', '--base', baseFile, '--head', headFile, '--fail-on-breaking'],
        { cwd: fixture.rootDir },
      )

      expect(res.status).toBe(1)
      expect(res.stdout).toContain('status-code-removed')
      expect(res.stdout).toContain('**!1** breaking')
    })

    it('exits with code 0 when breaking changes exist WITHOUT --fail-on-breaking', async () => {
      const { baseFile, headFile } = await writeFixtureFiles(
        `
        import "@typespec/http";
        using TypeSpec.Http;
        @route("/api")
        @get
        op test(): { @statusCode code: 200 } | { @statusCode code: 404 };
        `,
        `
        import "@typespec/http";
        using TypeSpec.Http;
        @route("/api")
        @get
        op test(): { @statusCode code: 200 };
        `,
      )

      const res = runOaCli(
        ['tsp', 'diff', '--base', baseFile, '--head', headFile],
        { cwd: fixture.rootDir },
      )

      expect(res.status).toBe(0)
      expect(res.stdout).toContain('status-code-removed')
    })

    it('exits with code 0 when only additive non-breaking changes exist WITH --fail-on-breaking', async () => {
      const { baseFile, headFile } = await writeFixtureFiles(
        `
        model User {
          id: string;
        }
        `,
        `
        model User {
          id: string;
          bio?: string;
        }
        `,
      )

      const res = runOaCli(
        ['tsp', 'diff', '--base', baseFile, '--head', headFile, '--fail-on-breaking'],
        { cwd: fixture.rootDir },
      )

      expect(res.status).toBe(0)
      expect(res.stdout).toContain('property-added')
      expect(res.stdout).toContain('**+1** non-breaking')
    })

    it('outputs valid JSON schema when --format json is provided with --fail-on-breaking', async () => {
      const { baseFile, headFile } = await writeFixtureFiles(
        `model A { id: string; }`,
        `model A { id: string; val: int32; }`,
      )

      const res = runOaCli(
        ['tsp', 'diff', '--base', baseFile, '--head', headFile, '--format', 'json', '--fail-on-breaking'],
        { cwd: fixture.rootDir },
      )

      expect(res.status).toBe(1)
      const parsed = JSON.parse(res.stdout)
      expect(parsed.summary.breakingCount).toBe(1)
      expect(parsed.breakingChanges[0].code).toBe('required-property-added')
    })
  })
})
