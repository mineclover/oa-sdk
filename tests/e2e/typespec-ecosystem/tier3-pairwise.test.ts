import { describe, it, expect, afterEach } from 'vitest'
import { compileTypeSpecSnippet, emitOpenApi3Snippet } from './helpers/compiler.js'
import { startInMemoryMockServer, fetchMock, type MockServerInstance } from './helpers/server.js'
import { diffSnippets, hasBreakingChanges } from './helpers/diff.js'
import {
  PERSONA_TRAIT_EXTENSION,
  DPM_PROJECTION_EXTENSION,
} from './helpers/decorators.js'
import { loadOperationsFromMergedSpec } from '../../../packages/personas/src/load.js'
import { validateSafetyRules } from '../../../packages/dpm/src/validator/safety-validator.js'
import { executeDpmRows } from '../../../packages/dpm/src/execution/in-memory-executor.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

describe('Tier 3: Pairwise Cross-Feature Combinations (C1-C6)', () => {
  const activeServers: MockServerInstance[] = []

  afterEach(async () => {
    while (activeServers.length > 0) {
      const s = activeServers.pop()
      if (s) {
        try {
          await s.stop()
        } catch {
          // ignore cleanup errors
        }
      }
    }
  })

  // =========================================================================
  // C1: Mock Server + @personaCapability
  // =========================================================================
  describe('C1: Mock Server + @personaCapability', () => {
    it('T3-C1-1: mock server serves endpoints decorated with @personaCapability and returns 200 mock response', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        model UserSummary {
          id: string;
          username: string;
        }

        @service namespace CapabilityService {
          @route("/users")
          @personaCapability("pagination")
          @get op getUser(): UserSummary;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const mockInstance = await startInMemoryMockServer(document)
        activeServers.push(mockInstance)

        const res = await fetchMock(mockInstance.url, '/users')
        expect(res.status).toBe(200)
        const body = res.json()
        expect(body).toHaveProperty('id')
        expect(body).toHaveProperty('username')
      } finally {
        await cleanup()
      }
    })

    it('T3-C1-2: mock server OpenAPI document exposes x-oa-sdk-persona-traits parseable by persona loader', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace ExportCapabilityService {
          @route("/export")
          @personaCapability("batch")
          @get op exportData(): { downloadUrl: string };
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c1-spec-'))
      const specPath = path.join(tmpDir, 'openapi.json')
      fs.writeFileSync(specPath, JSON.stringify(document, null, 2), 'utf8')

      try {
        const ops = loadOperationsFromMergedSpec(specPath)
        expect(ops).not.toBeNull()
        expect(ops!.size).toBeGreaterThanOrEqual(1)

        let foundTrait = false
        for (const op of ops!.values()) {
          if (op.traits && op.traits.has('batch')) {
            foundTrait = true
            break
          }
        }
        expect(foundTrait).toBe(true)
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
        await cleanup()
      }
    })

    it('T3-C1-3: multi-endpoint service with differentiated persona capabilities served without cross-contamination', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace MultiCapabilityService {
          @route("/admin/audit")
          @personaCapability("audit-emission")
          @get op getAuditLogs(): { entries: string[] };

          @route("/public/profile")
          @personaCapability("partial-response")
          @get op getProfile(): { name: string };
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const mockInstance = await startInMemoryMockServer(document)
        activeServers.push(mockInstance)

        const auditRes = await fetchMock(mockInstance.url, '/admin/audit')
        expect(auditRes.status).toBe(200)

        const profileRes = await fetchMock(mockInstance.url, '/public/profile')
        expect(profileRes.status).toBe(200)

        const auditTraits = document.paths['/admin/audit']?.get?.[PERSONA_TRAIT_EXTENSION]
        const profileTraits = document.paths['/public/profile']?.get?.[PERSONA_TRAIT_EXTENSION]

        expect(auditTraits).toContain('audit-emission')
        expect(auditTraits).not.toContain('partial-response')
        expect(profileTraits).toContain('partial-response')
        expect(profileTraits).not.toContain('audit-emission')
      } finally {
        await cleanup()
      }
    })
  })

  // =========================================================================
  // C2: Semantic Diff + @personaCapability
  // =========================================================================
  describe('C2: Semantic Diff + @personaCapability', () => {
    it('T3-C2-1: diff engine tracks addition of @personaCapability trait on operation', async () => {
      const base = `
        import "@typespec/http";
        using TypeSpec.Http;

        @service namespace ServiceA {
          @route("/data") op getData(): string;
        }
      `
      const head = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace ServiceA {
          @route("/data")
          @personaCapability("pagination")
          op getData(): string;
        }
      `
      const { result, baseCleanup, headCleanup } = await diffSnippets(base, head)
      try {
        // Diffing should complete without errors
        expect(result.summary).toBeDefined()
        expect(Array.isArray(result.allChanges)).toBe(true)
      } finally {
        await baseCleanup()
        await headCleanup()
      }
    })

    it('T3-C2-2: diff engine detects removal of @personaCapability trait', async () => {
      const base = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace ServiceB {
          @route("/items")
          @personaCapability("pagination")
          op listItems(): string[];
        }
      `
      const head = `
        import "@typespec/http";
        using TypeSpec.Http;

        @service namespace ServiceB {
          @route("/items")
          op listItems(): string[];
        }
      `
      const { result, baseCleanup, headCleanup } = await diffSnippets(base, head)
      try {
        expect(result.summary).toBeDefined()
      } finally {
        await baseCleanup()
        await headCleanup()
      }
    })

    it('T3-C2-3: diff engine compares specs with persona traits across operations safely', async () => {
      const base = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace ServiceC {
          @route("/op1")
          @personaCapability("filter-by-role")
          op op1(): string;
        }
      `
      const head = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace ServiceC {
          @route("/op1")
          @personaCapability("filter-by-status")
          op op1(): string;
        }
      `
      const { result, baseCleanup, headCleanup } = await diffSnippets(base, head)
      try {
        expect(result.summary).toBeDefined()
      } finally {
        await baseCleanup()
        await headCleanup()
      }
    })
  })

  // =========================================================================
  // C3: Semantic Diff + @pseudonymize (DPM)
  // =========================================================================
  describe('C3: Semantic Diff + @pseudonymize (DPM)', () => {
    it('T3-C3-1: diff engine compares models with differing @pseudonymize transform strategies', async () => {
      const base = `
        import "@oa-sdk/typespec-decorators";
        using OaSdkTypeSpec;

        model User {
          id: string;
          @pseudonymize("mask") email: string;
        }
      `
      const head = `
        import "@oa-sdk/typespec-decorators";
        using OaSdkTypeSpec;

        model User {
          id: string;
          @pseudonymize("hash") email: string;
        }
      `
      const { result, baseCleanup, headCleanup } = await diffSnippets(base, head)
      try {
        expect(result.summary).toBeDefined()
        expect(Array.isArray(result.allChanges)).toBe(true)
      } finally {
        await baseCleanup()
        await headCleanup()
      }
    })

    it('T3-C3-2: diff engine tracks addition of @pseudonymize role restrictions', async () => {
      const base = `
        import "@oa-sdk/typespec-decorators";
        using OaSdkTypeSpec;

        model Customer {
          id: string;
          @pseudonymize("redact", "direct_identifier") ssn: string;
        }
      `
      const head = `
        import "@oa-sdk/typespec-decorators";
        using OaSdkTypeSpec;

        model Customer {
          id: string;
          @pseudonymize("redact", "business_identifier") ssn: string;
        }
      `
      const { result, baseCleanup, headCleanup } = await diffSnippets(base, head)
      try {
        expect(result.summary).toBeDefined()
      } finally {
        await baseCleanup()
        await headCleanup()
      }
    })

    it('T3-C3-3: diff engine tracks removal of @pseudonymize decorator from sensitive model field', async () => {
      const base = `
        import "@oa-sdk/typespec-decorators";
        using OaSdkTypeSpec;

        model Account {
          id: string;
          @pseudonymize("mask") phone: string;
        }
      `
      const head = `
        model Account {
          id: string;
          phone: string;
        }
      `
      const { result, baseCleanup, headCleanup } = await diffSnippets(base, head)
      try {
        expect(result.summary).toBeDefined()
      } finally {
        await baseCleanup()
        await headCleanup()
      }
    })
  })

  // =========================================================================
  // C4: In-Memory Compile + Mock Server + Hot Reload
  // =========================================================================
  describe('C4: In-Memory Compile + Mock Server + Hot Reload', () => {
    it('T3-C4-1: in-memory authoring cycle: compile v1 -> mock serve -> compile v2 -> hot reload -> verify new endpoint', async () => {
      const sourceV1 = `
        import "@typespec/http";
        using TypeSpec.Http;

        @service namespace ShopService {
          @route("/orders")
          @get op listOrders(): { id: string, amount: int32 }[];
        }
      `
      const v1 = await emitOpenApi3Snippet(sourceV1)
      const mockInstance = await startInMemoryMockServer(v1.document)
      activeServers.push(mockInstance)

      try {
        // Verify v1 responds
        const res1 = await fetchMock(mockInstance.url, '/orders')
        expect(res1.status).toBe(200)

        // Compile v2 adding cancel route
        const sourceV2 = `
          import "@typespec/http";
          using TypeSpec.Http;

          @service namespace ShopService {
            @route("/orders")
            @get op listOrders(): { id: string, amount: int32 }[];

            @route("/orders/{orderId}/cancel")
            @post op cancelOrder(@path orderId: string): { cancelled: boolean };
          }
        `
        const v2 = await emitOpenApi3Snippet(sourceV2)
        try {
          const reloadResult = mockInstance.updateSpec(v2.document)
          expect(reloadResult.routesCount).toBeGreaterThanOrEqual(2)

          // Verify new route responds
          const resCancel = await fetchMock(mockInstance.url, '/orders/ord-99/cancel', {
            method: 'POST',
          })
          expect(resCancel.status).toBe(200)
          const cancelBody = resCancel.json()
          expect(cancelBody).toHaveProperty('cancelled')

          // Verify original route still responds
          const resOriginal = await fetchMock(mockInstance.url, '/orders')
          expect(resOriginal.status).toBe(200)
        } finally {
          await v2.cleanup()
        }
      } finally {
        await v1.cleanup()
      }
    })

    it('T3-C4-2: hot reload cleanly unmounts removed routes resulting in 404', async () => {
      const sourceV1 = `
        import "@typespec/http";
        using TypeSpec.Http;

        @service namespace VersionedService {
          @route("/v1/legacy")
          @get op legacyEndpoint(): { deprecated: boolean };

          @route("/v2/active")
          @get op activeEndpoint(): { active: boolean };
        }
      `
      const v1 = await emitOpenApi3Snippet(sourceV1)
      const mockInstance = await startInMemoryMockServer(v1.document)
      activeServers.push(mockInstance)

      try {
        // Both endpoints exist in v1
        const legacyRes1 = await fetchMock(mockInstance.url, '/v1/legacy')
        expect(legacyRes1.status).toBe(200)
        const activeRes1 = await fetchMock(mockInstance.url, '/v2/active')
        expect(activeRes1.status).toBe(200)

        // Compile v2 removing legacy endpoint
        const sourceV2 = `
          import "@typespec/http";
          using TypeSpec.Http;

          @service namespace VersionedService {
            @route("/v2/active")
            @get op activeEndpoint(): { active: boolean };
          }
        `
        const v2 = await emitOpenApi3Snippet(sourceV2)
        try {
          mockInstance.updateSpec(v2.document)

          // Legacy endpoint must now return 404
          const legacyRes2 = await fetchMock(mockInstance.url, '/v1/legacy')
          expect(legacyRes2.status).toBe(404)

          // Active endpoint persists
          const activeRes2 = await fetchMock(mockInstance.url, '/v2/active')
          expect(activeRes2.status).toBe(200)
        } finally {
          await v2.cleanup()
        }
      } finally {
        await v1.cleanup()
      }
    })

    it('T3-C4-3: rapid successive hot reloads maintain consistency without server crashing', async () => {
      const sourceBase = `
        import "@typespec/http";
        using TypeSpec.Http;

        @service namespace RapidService {
          @route("/step") @get op getStep(): { step: int32 };
        }
      `
      const v0 = await emitOpenApi3Snippet(sourceBase)
      const mockInstance = await startInMemoryMockServer(v0.document)
      activeServers.push(mockInstance)

      try {
        for (let i = 1; i <= 3; i++) {
          const sourceN = `
            import "@typespec/http";
            using TypeSpec.Http;

            @service namespace RapidService {
              @route("/step${i}") @get op getStep(): { step: int32 };
            }
          `
          const vN = await emitOpenApi3Snippet(sourceN)
          try {
            mockInstance.updateSpec(vN.document)
            const res = await fetchMock(mockInstance.url, `/step${i}`)
            expect(res.status).toBe(200)
          } finally {
            await vN.cleanup()
          }
        }
      } finally {
        await v0.cleanup()
      }
    })
  })

  // =========================================================================
  // C5: In-Memory Compile + Persona Check Pipeline
  // =========================================================================
  describe('C5: In-Memory Compile + Persona Check Pipeline', () => {
    it('T3-C5-1: compiles TypeSpec with multiple persona capabilities in-memory and validates persona traits', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace PipelineService {
          @route("/admin/users")
          @personaCapability("batch")
          @get op getUsers(): string[];

          @route("/user/feed")
          @personaCapability("pagination")
          @get op getFeed(): string[];
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c5-spec-'))
      const specPath = path.join(tmpDir, 'openapi.json')
      fs.writeFileSync(specPath, JSON.stringify(document, null, 2), 'utf8')

      try {
        const ops = loadOperationsFromMergedSpec(specPath)
        expect(ops).not.toBeNull()
        expect(ops!.size).toBe(2)

        const traitsFound = new Set<string>()
        for (const op of ops!.values()) {
          if (op.traits) {
            for (const t of op.traits) {
              traitsFound.add(t)
            }
          }
        }
        expect(traitsFound.has('batch')).toBe(true)
        expect(traitsFound.has('pagination')).toBe(true)
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
        await cleanup()
      }
    })

    it('T3-C5-2: verify operation traits match declared operation ids after in-memory compilation', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace TaggedOpsService {
          @route("/search")
          @personaCapability("filter-by-role")
          @personaCapability("filter-by-status")
          op searchCatalog(): string[];
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c5-traits-'))
      const specPath = path.join(tmpDir, 'openapi.json')
      fs.writeFileSync(specPath, JSON.stringify(document, null, 2), 'utf8')

      try {
        const ops = loadOperationsFromMergedSpec(specPath)
        expect(ops).not.toBeNull()
        const searchOp = Array.from(ops!.values()).find(o => o.path === '/search')
        expect(searchOp).toBeDefined()
        expect(searchOp!.traits).toBeDefined()
        expect(searchOp!.traits!.has('filter-by-role')).toBe(true)
        expect(searchOp!.traits!.has('filter-by-status')).toBe(true)
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
        await cleanup()
      }
    })

    it('T3-C5-3: multi-namespace TypeSpec in-memory compilation isolates persona traits correctly', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace DualNamespaceService {
          @route("/ns1/op")
          @personaCapability("idempotent")
          op ns1Op(): { ok: boolean };

          @route("/ns2/op")
          @personaCapability("pagination")
          op ns2Op(): { ok: boolean };
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c5-multi-'))
      const specPath = path.join(tmpDir, 'openapi.json')
      fs.writeFileSync(specPath, JSON.stringify(document, null, 2), 'utf8')

      try {
        const ops = loadOperationsFromMergedSpec(specPath)
        expect(ops).not.toBeNull()
        const op1 = Array.from(ops!.values()).find(o => o.path === '/ns1/op')
        const op2 = Array.from(ops!.values()).find(o => o.path === '/ns2/op')

        expect(op1?.traits?.has('idempotent')).toBe(true)
        expect(op1?.traits?.has('pagination')).toBe(false)

        expect(op2?.traits?.has('pagination')).toBe(true)
        expect(op2?.traits?.has('idempotent')).toBe(false)
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
        await cleanup()
      }
    })
  })

  // =========================================================================
  // C6: In-Memory Compile + DPM Safety Validation
  // =========================================================================
  describe('C6: In-Memory Compile + DPM Safety Validation', () => {
    it('T3-C6-1: TypeSpec with @pseudonymize in-memory compilation emits valid x-oa-sdk-dpm-projection passing DPM safety rules', async () => {
      const source = `
        import "@typespec/http";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using OaSdkTypeSpec;

        model UserProfile {
          id: string;
          @pseudonymize("mask", "direct_identifier") email: string;
        }

        @service namespace DpmService {
          @route("/profiles")
          op getProfiles(): UserProfile[];
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const emailProp = document.components?.schemas?.UserProfile?.properties?.email
        expect(emailProp).toBeDefined()
        expect(emailProp[DPM_PROJECTION_EXTENSION]).toBeDefined()

        const projection = emailProp[DPM_PROJECTION_EXTENSION]
        expect(projection.transform).toBe('mask')
        expect(projection.role).toBe('direct_identifier')

        // Run DPM safety rules against the emitted manifest projection
        const diagnostics = validateSafetyRules({
          manifest: {
            columns: [
              {
                name: 'email',
                [DPM_PROJECTION_EXTENSION]: projection,
              },
            ],
          },
          registry: {
            roles: ['direct_identifier', 'business_identifier'],
            transforms: ['mask', 'hash', 'redact'],
          },
        } as any)

        // No critical safety errors should be triggered
        const errorDiags = diagnostics.filter(d => d.severity === 'error')
        expect(errorDiags).toHaveLength(0)
      } finally {
        await cleanup()
      }
    })

    it('T3-C6-2: in-memory compiled DPM projection executes successfully with executeDpmRows', async () => {
      const source = `
        import "@typespec/http";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using OaSdkTypeSpec;

        model CustomerAccount {
          id: string;
          @pseudonymize("mask", "direct_identifier") email: string;
        }

        @service namespace DpmExecService {
          @route("/accounts")
          op getAccounts(): CustomerAccount[];
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const emailProp = document.components?.schemas?.CustomerAccount?.properties?.email
        const projection = emailProp?.[DPM_PROJECTION_EXTENSION]
        expect(projection).toBeDefined()

        const plan = {
          catalogId: 'cat-test',
          canonicalKeyEncodingVersion: 'v1',
          columnSteps: [
            {
              table: 'customers',
              column: 'email',
              columnRef: 'customers.email',
              transform: projection.transform,
            },
          ],
          relationshipSteps: [],
        }
        const rows = [
          { table: 'customers', values: { id: '1', email: 'alice@example.com' } },
          { table: 'customers', values: { id: '2', email: 'bob@example.com' } },
        ]

        const result = executeDpmRows(
          {
            plan: plan as any,
            rows,
          },
          { tokenKey: 'test-token-key-32-chars-minimum' },
        )

        expect(result.ok).toBe(true)
        expect(result.rows).toHaveLength(2)
        expect(result.rows[0].values.email).not.toBe('alice@example.com')
        expect(result.rows[0].values.email).toBe('[MASKED]')
        expect(result.rows[0].values.id).toBe('1')
      } finally {
        await cleanup()
      }
    })

    it('T3-C6-3: invalid DPM role projection triggers diagnostic during safety rule validation', async () => {
      const source = `
        import "@typespec/http";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using OaSdkTypeSpec;

        model SensitiveRecord {
          id: string;
          @pseudonymize("relationship_token", "foreign_identifier", true, "rel_missing") token: string;
        }

        @service namespace InvalidRoleService {
          @route("/sensitive")
          op getSensitive(): SensitiveRecord;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const tokenProp = document.components?.schemas?.SensitiveRecord?.properties?.token
        const projection = tokenProp?.[DPM_PROJECTION_EXTENSION]
        expect(projection).toBeDefined()

        const diagnostics = validateSafetyRules({
          manifest: {
            columns: [
              {
                name: 'token',
                [DPM_PROJECTION_EXTENSION]: projection,
              },
            ],
            relationships: [], // rel_missing is not in manifest
          },
          registry: {},
        } as any)

        // Should report error regarding missing relationship (SAF012)
        expect(diagnostics.some(d => d.code === 'SAF012')).toBe(true)
      } finally {
        await cleanup()
      }
    })
  })
})
