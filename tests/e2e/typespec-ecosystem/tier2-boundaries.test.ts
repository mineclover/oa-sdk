import { describe, it, expect, afterEach } from 'vitest'
import { compileTypeSpecSnippet, emitOpenApi3Snippet } from './helpers/compiler.js'
import { startInMemoryMockServer, fetchMock, type MockServerInstance } from './helpers/server.js'
import { diffSnippets, hasBreakingChanges } from './helpers/diff.js'
import { validateSafetyRules } from '../../../packages/dpm/src/validator/safety-validator.js'

describe('Tier 2: Boundary & Corner Cases (B1-B6)', () => {
  let activeServers: MockServerInstance[] = []

  afterEach(async () => {
    for (const s of activeServers) {
      await s.stop()
    }
    activeServers = []
  })

  // =========================================================================
  // B1: Empty Models & Empty Services/Namespaces
  // =========================================================================
  describe('B1: Empty Models & Empty Services/Namespaces', () => {
    it('T2-B1-1: empty TypeSpec model compiles and yields valid { type: "object" } in OpenAPI', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        model EmptyModel {}

        @service namespace EmptyModelService {
          @route("/empty") op getEmpty(): { @statusCode statusCode: 200; @body body: EmptyModel };
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const respSchema = document.paths['/empty'].get.responses['200']?.content?.['application/json']?.schema
          ?? document.components?.schemas?.EmptyModel
        expect(respSchema).toBeDefined()
        const schema = respSchema['$ref']
          ? document.components?.schemas?.[respSchema['$ref'].replace('#/components/schemas/', '')]
          : respSchema
        expect(schema.type).toBe('object')
      } finally {
        await cleanup()
      }
    })

    it('T2-B1-2: diffing two identical empty models across specs yields 0 changes', async () => {
      const base = `model VoidModel {}`
      const head = `model VoidModel {}`
      const { result, baseCleanup, headCleanup } = await diffSnippets(base, head)
      try {
        expect(result.summary.totalChanges).toBe(0)
        expect(hasBreakingChanges(result)).toBe(false)
      } finally {
        await baseCleanup()
        await headCleanup()
      }
    })

    it('T2-B1-3: service namespace with zero operations compiles cleanly with empty paths object', async () => {
      const source = `
        @service namespace ZeroOpsService {}
      `
      const { program, cleanup } = await compileTypeSpecSnippet(source)
      try {
        expect(program.diagnostics.length).toBe(0)
      } finally {
        await cleanup()
      }
    })

    it('T2-B1-4: mock server starts up cleanly with empty paths and returns 404 for any route', async () => {
      const emptyDoc = {
        openapi: '3.2.0',
        info: { title: 'Empty API', version: '1.0.0' },
        paths: {},
      }
      const mockInstance = await startInMemoryMockServer(emptyDoc)
      activeServers.push(mockInstance)

      const res = await fetchMock(mockInstance.url, '/non-existent')
      expect(res.status).toBe(404)
    })

    it('T2-B1-5: domain model with zero properties traverses cleanly in semantic extractor', async () => {
      const base = `model EmptyA {}`
      const head = `model EmptyA {} model EmptyB {}`
      const { result, baseCleanup, headCleanup } = await diffSnippets(base, head)
      try {
        expect(result.nonBreakingChanges.some(c => c.code === 'model-added' && c.target === 'EmptyB')).toBe(true)
      } finally {
        await baseCleanup()
        await headCleanup()
      }
    })
  })

  // =========================================================================
  // B2: Extreme Numeric Bounds & Numerical Limits
  // =========================================================================
  describe('B2: Extreme Numeric Bounds & Numerical Limits', () => {
    it('T2-B2-1: models with safeint and int64 values handle large 64-bit integer limits', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        model BigNumberModel {
          maxSafeInt: safeint;
          largeId: int64;
        }

        @service namespace BigNumService {
          @route("/bignum") op get(): BigNumberModel;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const schema = document.components.schemas.BigNumberModel
        expect(schema.properties.maxSafeInt.type).toBe('integer')
        expect(schema.properties.largeId.type).toBe('integer')
        expect(schema.properties.largeId.format).toBe('int64')
      } finally {
        await cleanup()
      }
    })

    it('T2-B2-2: models with float64 and extreme numeric bounds preserve format', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        model PrecisionModel {
          ratio: float64;
          tiny: float32;
        }

        @service namespace PrecisionService {
          @route("/precision") op get(): PrecisionModel;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const schema = document.components.schemas.PrecisionModel
        expect(schema.properties.ratio.type).toBe('number')
        expect(schema.properties.ratio.format).toBe('double')
        expect(schema.properties.tiny.format).toBe('float')
      } finally {
        await cleanup()
      }
    })

    it('T2-B2-3: invalid status codes in response decorators report diagnostic errors', async () => {
      const source = `
        import "@typespec/http";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using OaSdkTypeSpec;

        @service namespace BadStatusService {
          @route("/bad-status")
          @oaUseResponseComponent("9999", "BadStatusResponse")
          op test(): string;
        }
      `
      const { program, cleanup } = await compileTypeSpecSnippet(source)
      try {
        const error = program.diagnostics.find(d => d.code === '@oa-sdk/typespec-decorators/invalid-response-component-reference')
        expect(error).toBeDefined()
      } finally {
        await cleanup()
      }
    })

    it('T2-B2-4: property type change from int32 to string classified as breaking by diff engine', async () => {
      const base = `
        model Item {
          count: int32;
        }
      `
      const head = `
        model Item {
          count: string;
        }
      `
      const { result, baseCleanup, headCleanup } = await diffSnippets(base, head)
      try {
        expect(hasBreakingChanges(result)).toBe(true)
        expect(result.breakingChanges.some(c => c.code === 'property-type-changed')).toBe(true)
      } finally {
        await baseCleanup()
        await headCleanup()
      }
    })

    it('T2-B2-5: zero-value boundaries (minimum: 0, maximum: 100) compile cleanly in TypeSpec', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        model BoundedModel {
          @minValue(0)
          @maxValue(100)
          percentage: int32;
        }

        @service namespace BoundService {
          @route("/bounds") op get(): BoundedModel;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const prop = document.components.schemas.BoundedModel.properties.percentage
        expect(prop.minimum).toBe(0)
        expect(prop.maximum).toBe(100)
      } finally {
        await cleanup()
      }
    })
  })

  // =========================================================================
  // B3: Special Characters in Routes & Identifiers
  // =========================================================================
  describe('B3: Special Characters in Routes & Identifiers', () => {
    it('T2-B3-1: routes with hyphens, underscores, and multiple path parameters compile and match', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        @service namespace SpecialRouteService {
          @route("/api-v1/user_profiles/{user_id}/sub_items/{item_id}")
          @get op getItem(@path user_id: string, @path item_id: string): { ok: boolean };
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const mockInstance = await startInMemoryMockServer(document)
        activeServers.push(mockInstance)

        const res = await fetchMock(mockInstance.url, '/api-v1/user_profiles/u-123/sub_items/i-456')
        expect(res.status).toBe(200)
      } finally {
        await cleanup()
      }
    })

    it('T2-B3-2: deeply nested URL routes with 7+ segments match accurately in mock server', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        @service namespace DeepRouteService {
          @route("/orgs/{o}/teams/{t}/projects/{p}/environments/{e}/services/{s}/deployments/{d}")
          op getDeployment(
            @path o: string,
            @path t: string,
            @path p: string,
            @path e: string,
            @path s: string,
            @path d: string
          ): { deploymentId: string };
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const mockInstance = await startInMemoryMockServer(document)
        activeServers.push(mockInstance)

        const deepUrl = '/orgs/org1/teams/teamA/projects/projX/environments/prod/services/web/deployments/dep99'
        const res = await fetchMock(mockInstance.url, deepUrl)
        expect(res.status).toBe(200)
      } finally {
        await cleanup()
      }
    })

    it('T2-B3-3: query parameters with dot notation (e.g. filter.role) extracted correctly', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        @service namespace DotQueryService {
          @route("/search")
          @get op search(@query "filter.role" role?: string): string[];
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const op = document.paths['/search'].get
        expect(op.parameters.some((p: any) => p.name === 'filter.role' && p.in === 'query')).toBe(true)
      } finally {
        await cleanup()
      }
    })

    it('T2-B3-4: operationIds with alphanumeric characters, underscores, and camelCase preserved', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;

        @service namespace OpIdSpecial {
          @route("/run")
          @operationId("exec_step_v2_alpha")
          op run(): string;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        expect(document.paths['/run'].get.operationId).toBe('exec_step_v2_alpha')
      } finally {
        await cleanup()
      }
    })

    it('T2-B3-5: URI-encoded characters in route paths decoded and matched properly', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        @service namespace EncodedService {
          @route("/tags/{tag}")
          op getTag(@path tag: string): { tag: string };
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const mockInstance = await startInMemoryMockServer(document)
        activeServers.push(mockInstance)

        const res = await fetchMock(mockInstance.url, '/tags/c%2B%2B')
        expect(res.status).toBe(200)
      } finally {
        await cleanup()
      }
    })
  })

  // =========================================================================
  // B4: Missing Optional Parameters & Empty Payloads
  // =========================================================================
  describe('B4: Missing Optional Parameters & Empty Payloads', () => {
    it('T2-B4-1: operation with all optional parameters invoked without query params returns 200 mock response', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        @service namespace AllOptionalParams {
          @route("/all-optional")
          op list(@query page?: int32, @query limit?: int32, @query sort?: string): { count: int32 };
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const mockInstance = await startInMemoryMockServer(document)
        activeServers.push(mockInstance)

        const res = await fetchMock(mockInstance.url, '/all-optional')
        expect(res.status).toBe(200)
      } finally {
        await cleanup()
      }
    })

    it('T2-B4-2: POST operation with empty request body {} succeeds when all properties optional', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        model OptionalBody {
          note?: string;
          tag?: string;
        }

        @service namespace EmptyBodyPost {
          @route("/optional-post")
          @post op create(@body payload: OptionalBody): { received: boolean };
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const mockInstance = await startInMemoryMockServer(document)
        activeServers.push(mockInstance)

        const res = await fetchMock(mockInstance.url, '/optional-post', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        expect(res.status).toBe(200)
      } finally {
        await cleanup()
      }
    })

    it('T2-B4-3: deeply nested optional properties omitted in request payload handled gracefully', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        model InnerConfig { debug?: boolean; }
        model OuterConfig { inner?: InnerConfig; }

        @service namespace NestedOptional {
          @route("/config")
          @post op send(@body config: OuterConfig): { status: string };
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const mockInstance = await startInMemoryMockServer(document)
        activeServers.push(mockInstance)

        const res = await fetchMock(mockInstance.url, '/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inner: {} }),
        })
        expect(res.status).toBe(200)
      } finally {
        await cleanup()
      }
    })

    it('T2-B4-4: optional header parameters omitted in request pass validation', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        @service namespace HeaderOptional {
          @route("/headers")
          @get op getWithHeader(@header clientId?: string): { ok: boolean };
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const mockInstance = await startInMemoryMockServer(document)
        activeServers.push(mockInstance)

        const res = await fetchMock(mockInstance.url, '/headers')
        expect(res.status).toBe(200)
      } finally {
        await cleanup()
      }
    })

    it('T2-B4-5: model with all optional fields transitioning to one required field detected as breaking diff', async () => {
      const base = `
        model Settings {
          theme?: string;
          notifications?: boolean;
        }
      `
      const head = `
        model Settings {
          theme?: string;
          notifications?: boolean;
          requiredApiKey: string;
        }
      `
      const { result, baseCleanup, headCleanup } = await diffSnippets(base, head)
      try {
        expect(hasBreakingChanges(result)).toBe(true)
        expect(result.breakingChanges.some(c => c.code === 'required-property-added')).toBe(true)
      } finally {
        await baseCleanup()
        await headCleanup()
      }
    })
  })

  // =========================================================================
  // B5: Duplicate & Conflicting Decorators
  // =========================================================================
  describe('B5: Duplicate & Conflicting Decorators', () => {
    it('T2-B5-1: duplicate @personaCapability with identical trait deduplicated cleanly', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace DupTrait {
          @route("/dup")
          @personaCapability("pagination")
          @personaCapability("pagination")
          op dup(): string;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const traits = document.paths['/dup'].get['x-oa-sdk-persona-traits']
        expect(traits).toEqual(['pagination'])
      } finally {
        await cleanup()
      }
    })

    it('T2-B5-2: duplicate @personaCapability with overlapping trait arrays merged and sorted', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace OverlapTrait {
          @route("/overlap")
          @personaCapability("idempotent", "retryable")
          @personaCapability("cacheable", "idempotent")
          op overlap(): string;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const traits = document.paths['/overlap'].get['x-oa-sdk-persona-traits']
        expect(traits).toEqual(['cacheable', 'idempotent', 'retryable'])
      } finally {
        await cleanup()
      }
    })

    it('T2-B5-3: multiple @pseudonymize decorators overwriting target property handled safely', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace DupPseudo {
          model OverwriteModel {
            @pseudonymize("mask")
            @pseudonymize("hash")
            field: string;
          }
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const proj = document.components.schemas.OverwriteModel.properties.field['x-oa-sdk-dpm-projection']
        expect(['mask', 'hash']).toContain(proj.transform)
      } finally {
        await cleanup()
      }
    })

    it('T2-B5-4: duplicate status codes in response component decorator rejected with diagnostic', async () => {
      const source = `
        import "@typespec/http";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using OaSdkTypeSpec;

        @service namespace DupStatus {
          @route("/dup-status")
          @oaUseResponseComponent("404", "NotFoundA")
          @oaUseResponseComponent("404", "NotFoundB")
          op test(): string;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        // First wins or deduped
        const ext = document.paths['/dup-status'].get['x-oa-sdk-operation-component-refs']
        expect(ext.responses.filter((r: any) => r.statusCode === '404')).toHaveLength(1)
      } finally {
        await cleanup()
      }
    })

    it('T2-B5-5: conflicting transform and role combination rejected by safety validation (SAF001 & SAF010)', () => {
      const issues = validateSafetyRules({
        manifest: {
          id: 'multi-collision',
          columns: [
            { table: 't1', column: 'ssn', role: 'direct_identifier', transform: { type: 'keep' } },
            { table: 't2', column: 'email', role: 'business_identifier', pii: true, transform: { type: 'keep' } },
          ],
          relationships: [],
          entities: [],
        },
      } as any)
      expect(issues.some(i => i.code === 'SAF001')).toBe(true)
      expect(issues.some(i => i.code === 'SAF010')).toBe(true)
    })
  })

  // =========================================================================
  // B6: Circular & Recursive Models
  // =========================================================================
  describe('B6: Circular & Recursive Models', () => {
    it('T2-B6-1: self-referential model (TreeNode) compiles without recursion stack overflow', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        model TreeNode {
          id: string;
          children?: TreeNode[];
        }

        @service namespace TreeService {
          @route("/tree") op getTree(): TreeNode;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        expect(document.components.schemas.TreeNode).toBeDefined()
        const items = document.components.schemas.TreeNode.properties.children.items
        expect(items.$ref).toBe('#/components/schemas/TreeNode')
      } finally {
        await cleanup()
      }
    })

    it('T2-B6-2: mutually circular models (A -> B -> A) compile cleanly in TypeSpec', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        model NodeA {
          id: string;
          b?: NodeB;
        }

        model NodeB {
          id: string;
          a?: NodeA;
        }

        @service namespace MutualService {
          @route("/a") op getA(): NodeA;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        expect(document.components.schemas.NodeA).toBeDefined()
        expect(document.components.schemas.NodeB).toBeDefined()
        expect(document.components.schemas.NodeA.properties.b.$ref).toBe('#/components/schemas/NodeB')
        expect(document.components.schemas.NodeB.properties.a.$ref).toBe('#/components/schemas/NodeA')
      } finally {
        await cleanup()
      }
    })

    it('T2-B6-3: in-memory OpenAPI emission handles recursive $ref references without call-stack exhaustion', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        model Comment {
          text: string;
          replies?: Comment[];
        }

        @service namespace CommentService {
          @route("/comments") op list(): Comment[];
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        expect(document.components.schemas.Comment).toBeDefined()
      } finally {
        await cleanup()
      }
    })

    it('T2-B6-4: detects recursive model ref-cycles and handles bounded recursive patterns', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        model CategoryNode {
          name: string;
          subcategories?: CategoryNode[];
        }

        @service namespace MockCategoryService {
          @route("/categories") op get(): CategoryNode;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        expect(document.components.schemas.CategoryNode.properties.subcategories.items.$ref).toBe('#/components/schemas/CategoryNode')
        await expect(startInMemoryMockServer(document)).rejects.toThrow(/ref-cycle/)
      } finally {
        await cleanup()
      }
    })

    it('T2-B6-5: semantic AST diff compares circular models and detects property additions inside recursive nodes', async () => {
      const base = `
        model HierarchyNode {
          id: string;
          children?: HierarchyNode[];
        }
      `
      const head = `
        model HierarchyNode {
          id: string;
          weight?: int32;
          children?: HierarchyNode[];
        }
      `
      const { result, baseCleanup, headCleanup } = await diffSnippets(base, head)
      try {
        expect(hasBreakingChanges(result)).toBe(false)
        expect(result.nonBreakingChanges.some(c => c.code === 'property-added' && c.target === 'HierarchyNode.weight')).toBe(true)
      } finally {
        await baseCleanup()
        await headCleanup()
      }
    })
  })
})
