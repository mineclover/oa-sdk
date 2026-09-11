import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { compile, NodeHost } from '@typespec/compiler'
import { getAllHttpServices } from '@typespec/http'
import { getOperationId } from '@typespec/openapi'
import { compileTypeSpecSnippet } from './helpers/compiler.js'
import {
  diffSnippets,
  diffTypeSpecSemantics,
  extractTypeSpecSemantics,
  hasBreakingChanges,
  formatTypeSpecDiffMarkdown,
  formatTypeSpecDiffJson,
} from './helpers/diff.js'
import { resolveTypeSpecProgramRef } from '../../../packages/codegen/src/cli/lib/typespec-ref-resolver.js'
import { runOaGen } from './helpers/cli.js'

describe('Tier 1: TypeSpec AST Semantic Diff & Analyzer (F1-F8)', () => {
  // =========================================================================
  // F1: In-Memory TypeSpec AST Program Compilation
  // =========================================================================
  describe('F1: In-Memory TypeSpec AST Program Compilation', () => {
    it('T1-F1-1: compiles TypeSpec source in-memory with noEmit=true without disk artifacts', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        @service
        namespace MemoryService {
          @route("/health")
          op checkHealth(): { @statusCode code: 200, status: string };
        }
      `
      const { program, tmpDir, cleanup } = await compileTypeSpecSnippet(source)
      try {
        expect(program).toBeDefined()
        expect(program.diagnostics.length).toBe(0)

        // Verify no YAML or JSON artifacts were written to disk
        const files = await fs.readdir(tmpDir)
        expect(files).toContain('main.tsp')
        expect(files.some(f => f.endsWith('.yaml') || f.endsWith('.json'))).toBe(false)
      } finally {
        await cleanup()
      }
    })

    it('T1-F1-2: resolves multi-file imports in-memory across sibling TypeSpec files', async () => {
      const subSource = `
        namespace MemoryService {
          model UserProfile {
            id: string;
            displayName: string;
          }
        }
      `
      const mainSource = `
        import "@typespec/http";
        import "./models.tsp";
        using TypeSpec.Http;

        @service
        namespace MemoryService {
          @route("/me")
          op getProfile(): UserProfile;
        }
      `
      const { program, cleanup } = await compileTypeSpecSnippet(mainSource, {
        files: {
          'models.tsp': subSource,
        },
      })
      try {
        expect(program.diagnostics.length).toBe(0)
        const semantics = extractTypeSpecSemantics(program)
        expect(semantics.models.has('UserProfile')).toBe(true)
        const profileModel = semantics.models.get('UserProfile')!
        expect(profileModel.properties.has('displayName')).toBe(true)
      } finally {
        await cleanup()
      }
    })

    it('T1-F1-3: standard library namespaces (@typespec/http, @typespec/openapi) load with 0 error diagnostics', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;

        @service
        namespace StdLibCheck {
          @route("/version")
          @operationId("getVersion")
          op version(): string;
        }
      `
      const { program, cleanup } = await compileTypeSpecSnippet(source)
      try {
        const errors = program.diagnostics.filter(d => d.severity === 'error')
        expect(errors).toHaveLength(0)
      } finally {
        await cleanup()
      }
    })

    it('T1-F1-4: diagnostics extraction captures syntax errors with error severity and file positions', async () => {
      const brokenSource = `
        import "@typespec/http";
        using TypeSpec.Http;

        @service
        namespace BrokenService {
          model BrokenModel {
            invalid field without type;
          }
        }
      `
      const { program, cleanup } = await compileTypeSpecSnippet(brokenSource)
      try {
        const errors = program.diagnostics.filter(d => d.severity === 'error')
        expect(errors.length).toBeGreaterThan(0)
        expect(errors[0].message).toBeDefined()
        expect(errors[0].code).toBeDefined()
      } finally {
        await cleanup()
      }
    })

    it('T1-F1-5: incremental recompilation using oldProgram reuses compiler state and succeeds', async () => {
      const sourceV1 = `
        import "@typespec/http";
        using TypeSpec.Http;

        @service
        namespace IncrementalTest {
          @route("/items")
          op listItems(): string[];
        }
      `
      const { program: p1, entrypoint, cleanup } = await compileTypeSpecSnippet(sourceV1)
      try {
        expect(p1.diagnostics.length).toBe(0)

        // Modify source
        const sourceV2 = `
          import "@typespec/http";
          using TypeSpec.Http;

          @service
          namespace IncrementalTest {
            @route("/items")
            op listItems(): string[];
            @route("/items/{id}")
            op getItem(@path id: string): string;
          }
        `
        await fs.writeFile(entrypoint, sourceV2, 'utf8')
        const p2 = await compile(NodeHost, entrypoint, { noEmit: true }, p1)

        expect(p2.diagnostics.length).toBe(0)
        const semantics = extractTypeSpecSemantics(p2)
        expect(semantics.operations.has('GET /items')).toBe(true)
        expect(semantics.operations.has('GET /items/{id}')).toBe(true)
      } finally {
        await cleanup()
      }
    })
  })

  // =========================================================================
  // F2: HTTP Operation & Route Extraction
  // =========================================================================
  describe('F2: HTTP Operation & Route Extraction', () => {
    it('T1-F2-1: extracts routes with parameterized path segments', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        @service
        namespace RouteTest {
          @route("/users/{userId}/posts/{postId}")
          op getPost(@path userId: string, @path postId: string): string;
        }
      `
      const { program, cleanup } = await compileTypeSpecSnippet(source)
      try {
        const semantics = extractTypeSpecSemantics(program)
        const op = semantics.operations.get('GET /users/{userId}/posts/{postId}')
        expect(op).toBeDefined()
        expect(op?.path).toBe('/users/{userId}/posts/{postId}')
        expect(op?.parameters.some(p => p.name === 'userId' && p.paramType === 'path')).toBe(true)
      } finally {
        await cleanup()
      }
    })

    it('T1-F2-2: extracts all standard HTTP verbs correctly', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        @service
        namespace VerbsTest {
          @route("/resource")
          op list(): string;
          @route("/resource")
          @post op create(): string;
          @route("/resource/{id}")
          @put op replace(@path id: string): string;
          @route("/resource/{id}")
          @patch op modify(@path id: string): string;
          @route("/resource/{id}")
          @delete op remove(@path id: string): void;
        }
      `
      const { program, cleanup } = await compileTypeSpecSnippet(source)
      try {
        const semantics = extractTypeSpecSemantics(program)
        expect(semantics.operations.has('GET /resource')).toBe(true)
        expect(semantics.operations.has('POST /resource')).toBe(true)
        expect(semantics.operations.has('PUT /resource/{id}')).toBe(true)
        expect(semantics.operations.has('PATCH /resource/{id}')).toBe(true)
        expect(semantics.operations.has('DELETE /resource/{id}')).toBe(true)
      } finally {
        await cleanup()
      }
    })

    it('T1-F2-3: extracts query parameters with optionality', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        @service
        namespace QueryTest {
          @route("/search")
          op search(@query q: string, @query limit?: int32): string[];
        }
      `
      const { program, cleanup } = await compileTypeSpecSnippet(source)
      try {
        const semantics = extractTypeSpecSemantics(program)
        const op = semantics.operations.get('GET /search')!
        expect(op).toBeDefined()

        const qParam = op.parameters.find(p => p.name === 'q')
        const limitParam = op.parameters.find(p => p.name === 'limit')

        expect(qParam?.optional).toBe(false)
        expect(limitParam?.optional).toBe(true)
      } finally {
        await cleanup()
      }
    })

    it('T1-F2-4: extracts multiple response status codes', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        @service
        namespace ResponseTest {
          @route("/actions")
          op execute(): { @statusCode code: 200, result: string } | { @statusCode code: 202 } | { @statusCode code: 422, message: string };
        }
      `
      const { program, cleanup } = await compileTypeSpecSnippet(source)
      try {
        const semantics = extractTypeSpecSemantics(program)
        const op = semantics.operations.get('GET /actions')!
        expect(op.statusCodes).toEqual([200, 202, 422])
      } finally {
        await cleanup()
      }
    })

    it('T1-F2-5: resolves explicit @operationId decorator over default operation name', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;

        @service
        namespace OpIdTest {
          @route("/users")
          @operationId("customListAllUsers")
          op list(): string[];
        }
      `
      const { program, cleanup } = await compileTypeSpecSnippet(source)
      try {
        const semantics = extractTypeSpecSemantics(program)
        const op = semantics.operations.get('GET /users')!
        expect(op.operationId).toBe('customListAllUsers')
      } finally {
        await cleanup()
      }
    })
  })

  // =========================================================================
  // F3: Model & Property Semantic Traversal
  // =========================================================================
  describe('F3: Model & Property Semantic Traversal', () => {
    it('T1-F3-1: extracts user models and excludes standard library namespaces', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        @service
        namespace DomainTest {
          model Customer {
            id: string;
            name: string;
          }
        }
      `
      const { program, cleanup } = await compileTypeSpecSnippet(source)
      try {
        const semantics = extractTypeSpecSemantics(program)
        expect(semantics.models.has('Customer')).toBe(true)
        expect(semantics.models.has('TypeSpec')).toBe(false)
      } finally {
        await cleanup()
      }
    })

    it('T1-F3-2: traverses model properties and extracts required vs optional flags', async () => {
      const source = `
        model Account {
          id: string;
          email: string;
          nickname?: string;
          avatarUrl?: string;
        }
      `
      const { program, cleanup } = await compileTypeSpecSnippet(source)
      try {
        const semantics = extractTypeSpecSemantics(program)
        const account = semantics.models.get('Account')!
        expect(account.properties.get('id')?.optional).toBe(false)
        expect(account.properties.get('email')?.optional).toBe(false)
        expect(account.properties.get('nickname')?.optional).toBe(true)
        expect(account.properties.get('avatarUrl')?.optional).toBe(true)
      } finally {
        await cleanup()
      }
    })

    it('T1-F3-3: resolves scalar property types including int32, boolean, and utcDateTime', async () => {
      const source = `
        model EventLog {
          id: string;
          count: int32;
          isActive: boolean;
          timestamp: utcDateTime;
        }
      `
      const { program, cleanup } = await compileTypeSpecSnippet(source)
      try {
        const semantics = extractTypeSpecSemantics(program)
        const eventLog = semantics.models.get('EventLog')!
        expect(eventLog.properties.get('id')?.typeStr).toBe('string')
        expect(eventLog.properties.get('count')?.typeStr).toBe('int32')
        expect(eventLog.properties.get('isActive')?.typeStr).toBe('boolean')
        expect(eventLog.properties.get('timestamp')?.typeStr).toBe('utcDateTime')
      } finally {
        await cleanup()
      }
    })

    it('T1-F3-4: resolves array types and model reference types', async () => {
      const source = `
        model Tag {
          label: string;
        }
        model Article {
          title: string;
          tags: Tag[];
        }
      `
      const { program, cleanup } = await compileTypeSpecSnippet(source)
      try {
        const semantics = extractTypeSpecSemantics(program)
        const article = semantics.models.get('Article')!
        expect(article.properties.get('tags')?.typeStr).toMatch(/Array|Tag\[\]/)
      } finally {
        await cleanup()
      }
    })

    it('T1-F3-5: resolves union types and variant values', async () => {
      const source = `
        model Order {
          id: string;
          status: "pending" | "processing" | "shipped" | "delivered";
        }
      `
      const { program, cleanup } = await compileTypeSpecSnippet(source)
      try {
        const semantics = extractTypeSpecSemantics(program)
        const order = semantics.models.get('Order')!
        const statusType = order.properties.get('status')?.typeStr
        expect(statusType).toContain('pending')
        expect(statusType).toContain('shipped')
      } finally {
        await cleanup()
      }
    })
  })

  // =========================================================================
  // F4: Git Ref & File Path Resolution
  // =========================================================================
  describe('F4: Git Ref & File Path Resolution', () => {
    it('T1-F4-1: resolves direct local file path to entrypoint .tsp file', async () => {
      const source = `
        @service namespace DirectFileTest {}
      `
      const { entrypoint, cleanup } = await compileTypeSpecSnippet(source)
      try {
        const resolved = await resolveTypeSpecProgramRef(entrypoint, process.cwd())
        expect(resolved.program).toBeDefined()
        expect(resolved.entrypoint).toBe(entrypoint)
        await resolved.cleanup()
      } finally {
        await cleanup()
      }
    })

    it('T1-F4-2: resolves local directory path discovering main.tsp automatically', async () => {
      const source = `
        @service namespace DirDiscoverTest {}
      `
      const { tmpDir, cleanup } = await compileTypeSpecSnippet(source, { mainFileName: 'main.tsp' })
      try {
        const resolved = await resolveTypeSpecProgramRef(tmpDir, process.cwd())
        expect(resolved.program).toBeDefined()
        expect(resolved.entrypoint).toBe(path.join(tmpDir, 'main.tsp'))
        await resolved.cleanup()
      } finally {
        await cleanup()
      }
    })

    it('T1-F4-3: resolves git references like HEAD via git archive extraction', async () => {
      // In this repository, HEAD has packages/schemas/typespec/main.tsp
      const resolved = await resolveTypeSpecProgramRef('HEAD', process.cwd(), 'packages/schemas/typespec/main.tsp')
      try {
        expect(resolved.program).toBeDefined()
        expect(resolved.program.diagnostics.length).toBe(0)
      } finally {
        await resolved.cleanup()
      }
    })

    it('T1-F4-4: rejects non-existent file paths throwing descriptive error', async () => {
      const nonExistentPath = path.resolve(process.cwd(), 'does-not-exist/missing.tsp')
      await expect(resolveTypeSpecProgramRef(nonExistentPath, process.cwd())).rejects.toThrow(
        /Unable to resolve TypeSpec reference/,
      )
    })

    it('T1-F4-5: rejects completely invalid git references throwing descriptive error', async () => {
      const badRef = 'non-existent-git-branch-12345xyz'
      await expect(resolveTypeSpecProgramRef(badRef, process.cwd(), 'packages/schemas/typespec/main.tsp')).rejects.toThrow(
        /Unable to resolve TypeSpec reference/,
      )
    })
  })

  // =========================================================================
  // F5: 7-Category Breaking Change Classification
  // =========================================================================
  describe('F5: 7-Category Breaking Change Classification', () => {
    it('T1-F5-1 (Operation removal): classifies removed operation as breaking operation-removed', async () => {
      const base = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace Test {
          @route("/users") op listUsers(): string[];
          @route("/posts") op listPosts(): string[];
        }
      `
      const head = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace Test {
          @route("/users") op listUsers(): string[];
        }
      `
      const { result, baseCleanup, headCleanup } = await diffSnippets(base, head)
      try {
        expect(hasBreakingChanges(result)).toBe(true)
        const removal = result.breakingChanges.find(c => c.code === 'operation-removed')
        expect(removal).toBeDefined()
        expect(removal?.target).toBe('GET /posts')
      } finally {
        await baseCleanup()
        await headCleanup()
      }
    })

    it('T1-F5-2 (Route/verb change): classifies route change as breaking route-changed', async () => {
      const base = `
        import "@typespec/http";
        import "@typespec/openapi";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        @service namespace Test {
          @route("/v1/items") @operationId("getItems") op list(): string[];
        }
      `
      const head = `
        import "@typespec/http";
        import "@typespec/openapi";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        @service namespace Test {
          @route("/v2/items") @operationId("getItems") op list(): string[];
        }
      `
      const { result, baseCleanup, headCleanup } = await diffSnippets(base, head)
      try {
        expect(hasBreakingChanges(result)).toBe(true)
        const routeChange = result.breakingChanges.find(c => c.code === 'route-changed')
        expect(routeChange).toBeDefined()
        expect(routeChange?.detail).toContain('/v1/items')
        expect(routeChange?.detail).toContain('/v2/items')
      } finally {
        await baseCleanup()
        await headCleanup()
      }
    })

    it('T1-F5-3 (Model removal): classifies removed domain model as breaking model-removed', async () => {
      const base = `
        model User { id: string; }
        model Organization { id: string; }
      `
      const head = `
        model User { id: string; }
      `
      const { result, baseCleanup, headCleanup } = await diffSnippets(base, head)
      try {
        expect(hasBreakingChanges(result)).toBe(true)
        const modelRemoval = result.breakingChanges.find(c => c.code === 'model-removed')
        expect(modelRemoval).toBeDefined()
        expect(modelRemoval?.target).toBe('Organization')
      } finally {
        await baseCleanup()
        await headCleanup()
      }
    })

    it('T1-F5-4 (Property removal): classifies removed model property as breaking property-removed', async () => {
      const base = `
        model Account {
          id: string;
          username: string;
          legacyToken: string;
        }
      `
      const head = `
        model Account {
          id: string;
          username: string;
        }
      `
      const { result, baseCleanup, headCleanup } = await diffSnippets(base, head)
      try {
        expect(hasBreakingChanges(result)).toBe(true)
        const propRemoval = result.breakingChanges.find(c => c.code === 'property-removed')
        expect(propRemoval).toBeDefined()
        expect(propRemoval?.target).toBe('Account.legacyToken')
      } finally {
        await baseCleanup()
        await headCleanup()
      }
    })

    it('T1-F5-5 (Newly required property): classifies newly required property as breaking', async () => {
      const base = `
        model Profile {
          id: string;
          bio?: string;
        }
      `
      const head = `
        model Profile {
          id: string;
          bio: string;
          taxId: string;
        }
      `
      const { result, baseCleanup, headCleanup } = await diffSnippets(base, head)
      try {
        expect(hasBreakingChanges(result)).toBe(true)
        const bioRequired = result.breakingChanges.find(c => c.code === 'property-required')
        const taxRequired = result.breakingChanges.find(c => c.code === 'required-property-added')
        expect(bioRequired).toBeDefined()
        expect(taxRequired).toBeDefined()
      } finally {
        await baseCleanup()
        await headCleanup()
      }
    })

    it('T1-F5-6 (Status code removal): classifies removed response status code as breaking status-code-removed', async () => {
      const base = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace Test {
          @route("/submit")
          op submit(): { @statusCode code: 200 } | { @statusCode code: 204 };
        }
      `
      const head = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace Test {
          @route("/submit")
          op submit(): { @statusCode code: 200 };
        }
      `
      const { result, baseCleanup, headCleanup } = await diffSnippets(base, head)
      try {
        expect(hasBreakingChanges(result)).toBe(true)
        const scRemoval = result.breakingChanges.find(c => c.code === 'status-code-removed')
        expect(scRemoval).toBeDefined()
        expect(scRemoval?.detail).toContain('204')
      } finally {
        await baseCleanup()
        await headCleanup()
      }
    })

    it('T1-F5-7 (@operationId change): classifies changed @operationId as breaking operation-id-changed', async () => {
      const base = `
        import "@typespec/http";
        import "@typespec/openapi";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        @service namespace Test {
          @route("/users")
          @operationId("fetchUsersList")
          op list(): string[];
        }
      `
      const head = `
        import "@typespec/http";
        import "@typespec/openapi";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        @service namespace Test {
          @route("/users")
          @operationId("getUsersV2")
          op list(): string[];
        }
      `
      const { result, baseCleanup, headCleanup } = await diffSnippets(base, head)
      try {
        expect(hasBreakingChanges(result)).toBe(true)
        const opIdChange = result.breakingChanges.find(c => c.code === 'operation-id-changed')
        expect(opIdChange).toBeDefined()
        expect(opIdChange?.detail).toContain('fetchUsersList')
        expect(opIdChange?.detail).toContain('getUsersV2')
      } finally {
        await baseCleanup()
        await headCleanup()
      }
    })
  })

  // =========================================================================
  // F6: Non-Breaking Change Classification
  // =========================================================================
  describe('F6: Non-Breaking Change Classification', () => {
    it('T1-F6-1: classifies newly added operation as non-breaking operation-added', async () => {
      const base = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace Test {
          @route("/users") op list(): string[];
        }
      `
      const head = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace Test {
          @route("/users") op list(): string[];
          @route("/metrics") op getMetrics(): string;
        }
      `
      const { result, baseCleanup, headCleanup } = await diffSnippets(base, head)
      try {
        expect(hasBreakingChanges(result)).toBe(false)
        const added = result.nonBreakingChanges.find(c => c.code === 'operation-added')
        expect(added).toBeDefined()
        expect(added?.target).toBe('GET /metrics')
      } finally {
        await baseCleanup()
        await headCleanup()
      }
    })

    it('T1-F6-2: classifies newly added domain model as non-breaking model-added', async () => {
      const base = `
        model User { id: string; }
      `
      const head = `
        model User { id: string; }
        model AuditEvent { eventId: string; timestamp: string; }
      `
      const { result, baseCleanup, headCleanup } = await diffSnippets(base, head)
      try {
        expect(hasBreakingChanges(result)).toBe(false)
        const modelAdded = result.nonBreakingChanges.find(c => c.code === 'model-added')
        expect(modelAdded).toBeDefined()
        expect(modelAdded?.target).toBe('AuditEvent')
      } finally {
        await baseCleanup()
        await headCleanup()
      }
    })

    it('T1-F6-3: classifies newly added optional property as non-breaking property-added', async () => {
      const base = `
        model Device {
          id: string;
        }
      `
      const head = `
        model Device {
          id: string;
          firmwareVersion?: string;
        }
      `
      const { result, baseCleanup, headCleanup } = await diffSnippets(base, head)
      try {
        expect(hasBreakingChanges(result)).toBe(false)
        const propAdded = result.nonBreakingChanges.find(c => c.code === 'property-added')
        expect(propAdded).toBeDefined()
        expect(propAdded?.target).toBe('Device.firmwareVersion')
      } finally {
        await baseCleanup()
        await headCleanup()
      }
    })

    it('T1-F6-4: classifies property transitioning from required to optional as non-breaking property-optional', async () => {
      const base = `
        model Member {
          id: string;
          phone: string;
        }
      `
      const head = `
        model Member {
          id: string;
          phone?: string;
        }
      `
      const { result, baseCleanup, headCleanup } = await diffSnippets(base, head)
      try {
        expect(hasBreakingChanges(result)).toBe(false)
        const propOptional = result.nonBreakingChanges.find(c => c.code === 'property-optional')
        expect(propOptional).toBeDefined()
        expect(propOptional?.target).toBe('Member.phone')
      } finally {
        await baseCleanup()
        await headCleanup()
      }
    })

    it('T1-F6-5: classifies newly added response status code as non-breaking status-code-added', async () => {
      const base = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace Test {
          @route("/jobs") op create(): { @statusCode code: 201 };
        }
      `
      const head = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace Test {
          @route("/jobs") op create(): { @statusCode code: 201 } | { @statusCode code: 202 };
        }
      `
      const { result, baseCleanup, headCleanup } = await diffSnippets(base, head)
      try {
        expect(hasBreakingChanges(result)).toBe(false)
        const scAdded = result.nonBreakingChanges.find(c => c.code === 'status-code-added')
        expect(scAdded).toBeDefined()
        expect(scAdded?.detail).toContain('202')
      } finally {
        await baseCleanup()
        await headCleanup()
      }
    })
  })

  // =========================================================================
  // F7: CLI Command `oa-gen tsp diff` & `--fail-on-breaking`
  // =========================================================================
  describe('F7: CLI Command `oa-gen tsp diff` & `--fail-on-breaking`', () => {
    it('T1-F7-1: outputs formatted Markdown diff summary to stdout', async () => {
      const base = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace Test {
          @route("/old") op oldRoute(): string;
        }
      `
      const head = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace Test {
          @route("/new") op newRoute(): string;
        }
      `
      const baseRes = await compileTypeSpecSnippet(base)
      const headRes = await compileTypeSpecSnippet(head)
      try {
        const cliRes = await runOaGen(['tsp', 'diff', '--base', baseRes.entrypoint, '--head', headRes.entrypoint])
        expect(cliRes.exitCode).toBe(0)
        expect(cliRes.stdout).toContain('TypeSpec Semantic Diff')
        expect(cliRes.stdout).toContain('Breaking Changes')
      } finally {
        await baseRes.cleanup()
        await headRes.cleanup()
      }
    })

    it('T1-F7-2: supports --format json emitting parseable JSON diff structure', async () => {
      const base = `model A { id: string; }`
      const head = `model A { id: string; name?: string; }`
      const baseRes = await compileTypeSpecSnippet(base)
      const headRes = await compileTypeSpecSnippet(head)
      try {
        const cliRes = await runOaGen([
          'tsp', 'diff',
          '--base', baseRes.entrypoint,
          '--head', headRes.entrypoint,
          '--format', 'json',
        ])
        expect(cliRes.exitCode).toBe(0)
        const parsed = JSON.parse(cliRes.stdout)
        expect(parsed.summary).toBeDefined()
        expect(parsed.summary.breakingCount).toBe(0)
        expect(parsed.summary.nonBreakingCount).toBe(1)
        expect(parsed.nonBreakingChanges[0].code).toBe('property-added')
      } finally {
        await baseRes.cleanup()
        await headRes.cleanup()
      }
    })

    it('T1-F7-3: exits with code 1 when breaking changes are detected with --fail-on-breaking', async () => {
      const base = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace Test {
          @route("/users") op list(): string[];
        }
      `
      const head = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace Test {
          // list operation removed!
        }
      `
      const baseRes = await compileTypeSpecSnippet(base)
      const headRes = await compileTypeSpecSnippet(head)
      try {
        const cliRes = await runOaGen([
          'tsp', 'diff',
          '--base', baseRes.entrypoint,
          '--head', headRes.entrypoint,
          '--fail-on-breaking',
        ])
        expect(cliRes.exitCode).toBe(1)
      } finally {
        await baseRes.cleanup()
        await headRes.cleanup()
      }
    })

    it('T1-F7-4: exits with code 0 when only non-breaking additions are present even with --fail-on-breaking', async () => {
      const base = `model M { id: string; }`
      const head = `model M { id: string; optionalNote?: string; }`
      const baseRes = await compileTypeSpecSnippet(base)
      const headRes = await compileTypeSpecSnippet(head)
      try {
        const cliRes = await runOaGen([
          'tsp', 'diff',
          '--base', baseRes.entrypoint,
          '--head', headRes.entrypoint,
          '--fail-on-breaking',
        ])
        expect(cliRes.exitCode).toBe(0)
      } finally {
        await baseRes.cleanup()
        await headRes.cleanup()
      }
    })

    it('T1-F7-5: exits with code 0 when base and head are identical with 0 changes reported', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace Same {
          @route("/status") op status(): string;
        }
      `
      const baseRes = await compileTypeSpecSnippet(source)
      const headRes = await compileTypeSpecSnippet(source)
      try {
        const cliRes = await runOaGen([
          'tsp', 'diff',
          '--base', baseRes.entrypoint,
          '--head', headRes.entrypoint,
          '--format', 'json',
          '--fail-on-breaking',
        ])
        expect(cliRes.exitCode).toBe(0)
        const parsed = JSON.parse(cliRes.stdout)
        expect(parsed.summary.totalChanges).toBe(0)
        expect(parsed.summary.breakingCount).toBe(0)
      } finally {
        await baseRes.cleanup()
        await headRes.cleanup()
      }
    })
  })

  // =========================================================================
  // F8: Multi-Token CLI Router
  // =========================================================================
  describe('F8: Multi-Token CLI Router', () => {
    it('T1-F8-1: correctly dispatches two-token compound subcommand `tsp diff`', async () => {
      const res = await runOaGen(['tsp', 'diff', '--help'])
      expect(res.exitCode).toBe(0)
      expect(res.stdout).toContain('TypeSpec AST semantic diff')
      expect(res.stdout).toContain('--base')
      expect(res.stdout).toContain('--head')
      expect(res.stdout).toContain('--fail-on-breaking')
    })

    it('T1-F8-2: correctly dispatches hyphenated single-token alias `tsp-diff` identically', async () => {
      const res = await runOaGen(['tsp-diff', '--help'])
      expect(res.exitCode).toBe(0)
      expect(res.stdout).toContain('TypeSpec AST semantic diff')
    })

    it('T1-F8-3: handles leading global flags passed before compound subcommand (`--root . tsp diff`)', async () => {
      const res = await runOaGen(['--root', '.', 'tsp', 'diff', '--help'])
      expect(res.exitCode).toBe(0)
      expect(res.stdout).toContain('TypeSpec AST semantic diff')
    })

    it('T1-F8-4: reports unknown command error on unrecognized subcommand under `tsp`', async () => {
      const res = await runOaGen(['tsp', 'unsupportedSubcommand'])
      expect(res.exitCode).toBe(1)
      expect(res.stderr).toContain('알 수 없는 커맨드')
    })

    it('T1-F8-5: displays help documentation and lists tsp diff under top-level --help', async () => {
      const res = await runOaGen(['--help'])
      expect(res.exitCode).toBe(0)
      expect(res.stdout).toContain('tsp diff')
    })
  })
})
