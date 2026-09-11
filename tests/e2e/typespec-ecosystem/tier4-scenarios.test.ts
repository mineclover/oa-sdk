import { describe, it, expect, afterEach } from 'vitest'
import { compileTypeSpecSnippet, emitOpenApi3Snippet } from './helpers/compiler.js'
import { startInMemoryMockServer, fetchMock, type MockServerInstance } from './helpers/server.js'
import { diffSnippets, diffTypeSpecPrograms, hasBreakingChanges } from './helpers/diff.js'
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

describe('Tier 4: Real-World Application Scenarios (S1-S5)', () => {
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
  // Scenario S1: Complete API Lifecycle
  // Author -> Instant Mock Preview -> Breaking Change Diff Gate -> Persona Matrix
  // =========================================================================
  describe('S1: Complete API Lifecycle', () => {
    it('T4-S1: executes complete API lifecycle from authoring to mocking, diffing, and persona governance', async () => {
      // Step 1: Author initial TypeSpec contract (v1)
      const v1Source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        model UserAccount {
          id: string;
          username: string;
          @pseudonymize("mask", "direct_identifier") email: string;
        }

        @service namespace UserLifecycleService {
          @route("/users")
          @personaCapability("pagination")
          @get op listUsers(): UserAccount[];

          @route("/users/{id}")
          @personaCapability("audit-emission")
          @get op getUser(@path id: string): UserAccount;
        }
      `

      const v1 = await emitOpenApi3Snippet(v1Source)
      try {
        // Step 2: Instant Mock Preview without disk YAML emission
        const mockInstance = await startInMemoryMockServer(v1.document)
        activeServers.push(mockInstance)

        const getRes = await fetchMock(mockInstance.url, '/users/user-123')
        expect(getRes.status).toBe(200)
        const userData = getRes.json()
        expect(userData).toBeDefined()
        expect(userData).toHaveProperty('id')
        expect(userData).toHaveProperty('username')

        // Step 3: Developer drafts v2 with breaking change (removes getUser) and non-breaking addition
        const v2Source = `
          import "@typespec/http";
          import "@typespec/openapi";
          import "@oa-sdk/typespec-decorators";
          using TypeSpec.Http;
          using TypeSpec.OpenAPI;
          using OaSdkTypeSpec;

          model UserAccount {
            id: string;
            username: string;
            @pseudonymize("mask", "direct_identifier") email: string;
          }

          @service namespace UserLifecycleService {
            @route("/users")
            @personaCapability("pagination")
            @get op listUsers(): UserAccount[];

            @route("/users/search")
            @personaCapability("full-text-search")
            @get op searchUsers(@query q: string): UserAccount[];
          }
        `

        const { result: diffResult, baseCleanup, headCleanup } = await diffSnippets(v1Source, v2Source)
        try {
          // Step 4: Semantic diff gate detects breaking change
          expect(hasBreakingChanges(diffResult)).toBe(true)
          expect(diffResult.summary.breakingCount).toBeGreaterThanOrEqual(1)
          const removedOp = diffResult.breakingChanges.find(c => c.code === 'operation-removed')
          expect(removedOp).toBeDefined()
          expect(removedOp?.detail).toContain('/users/{id}')

          // Non-breaking addition also recorded
          const addedOp = diffResult.nonBreakingChanges.find(c => c.code === 'operation-added')
          expect(addedOp).toBeDefined()
        } finally {
          await baseCleanup()
          await headCleanup()
        }

        // Step 5: Persona matrix governance verification on emitted v1 document
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's1-gov-'))
        const specFile = path.join(tmpDir, 'v1-spec.json')
        fs.writeFileSync(specFile, JSON.stringify(v1.document, null, 2), 'utf8')
        try {
          const ops = loadOperationsFromMergedSpec(specFile)
          expect(ops).not.toBeNull()
          expect(ops!.size).toBe(2)

          const listOp = Array.from(ops!.values()).find(o => o.path === '/users')
          expect(listOp).toBeDefined()
          expect(listOp!.traits?.has('pagination')).toBe(true)

          const singleOp = Array.from(ops!.values()).find(o => o.path === '/users/{id}')
          expect(singleOp).toBeDefined()
          expect(singleOp!.traits?.has('audit-emission')).toBe(true)
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true })
        }
      } finally {
        await v1.cleanup()
      }
    })
  })

  // =========================================================================
  // Scenario S2: Multi-Persona Role-Based API Evolution
  // Public Consumers vs Privileged Admin Scopes
  // =========================================================================
  describe('S2: Multi-Persona Role-Based API Evolution', () => {
    it('T4-S2: validates segregated persona capabilities across public and admin operational tiers', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        model PublicProfile {
          displayName: string;
          avatarUrl: string;
        }

        model AdminDetails {
          userId: string;
          email: string;
          lastLoginIp: string;
          roles: string[];
        }

        @service namespace RoleBasedService {
          @route("/public/profile")
          @personaCapability("partial-response", "cacheable")
          @get op getPublicProfile(): PublicProfile;

          @route("/admin/users/{userId}")
          @personaCapability("pii-visible-admin", "audit-emission", "trace-context")
          @get op getAdminDetails(@path userId: string): AdminDetails;
        }
      `

      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        // Verify OpenAPI extensions segregation
        const publicOp = document.paths['/public/profile'].get
        const adminOp = document.paths['/admin/users/{userId}'].get

        expect(publicOp[PERSONA_TRAIT_EXTENSION]).toEqual(['cacheable', 'partial-response'])
        expect(adminOp[PERSONA_TRAIT_EXTENSION]).toEqual(['audit-emission', 'pii-visible-admin', 'trace-context'])

        // Launch mock server and verify both routes respond cleanly
        const mockInstance = await startInMemoryMockServer(document)
        activeServers.push(mockInstance)

        const publicRes = await fetchMock(mockInstance.url, '/public/profile')
        expect(publicRes.status).toBe(200)
        const publicData = publicRes.json()
        expect(publicData).toHaveProperty('displayName')

        const adminRes = await fetchMock(mockInstance.url, '/admin/users/usr-admin-1')
        expect(adminRes.status).toBe(200)
        const adminData = adminRes.json()
        expect(adminData).toHaveProperty('userId')
        expect(adminData).toHaveProperty('email')
      } finally {
        await cleanup()
      }
    })
  })

  // =========================================================================
  // Scenario S3: Microservice CI/CD Breaking Contract Governance Gate
  // Detection, Rejection, and Non-Breaking Mitigation Loop
  // =========================================================================
  describe('S3: Microservice CI/CD Breaking Contract Governance Gate', () => {
    it('T4-S3: blocks merge on breaking route & model changes and clears gate on compliant non-breaking mitigation', async () => {
      // Production baseline: stable Order service
      const baseSource = `
        import "@typespec/http";
        using TypeSpec.Http;

        model OrderItem {
          sku: string;
          quantity: int32;
        }

        model Order {
          id: string;
          items: OrderItem[];
          status: string;
        }

        @service namespace OrderService {
          @route("/orders")
          @get op list(): Order[];

          @route("/orders/{id}")
          @get op get(@path id: string): Order;

          @route("/orders")
          @post op create(@body order: Order): Order;
        }
      `

      // PR candidate with breaking changes:
      // 1. Removed GET /orders/{id}
      // 2. Added newly required field `currency` to Order without default
      const breakingPrSource = `
        import "@typespec/http";
        using TypeSpec.Http;

        model OrderItem {
          sku: string;
          quantity: int32;
        }

        model Order {
          id: string;
          items: OrderItem[];
          status: string;
          currency: string; // BREAKING: newly required property
        }

        @service namespace OrderService {
          @route("/orders")
          @get op list(): Order[];

          // BREAKING: GET /orders/{id} removed!

          @route("/orders")
          @post op create(@body order: Order): Order;
        }
      `

      const { result: breakingDiff, baseCleanup: b1, headCleanup: h1 } = await diffSnippets(baseSource, breakingPrSource)
      try {
        // CI Gate Fails
        expect(hasBreakingChanges(breakingDiff)).toBe(true)
        const breakingCodes = breakingDiff.breakingChanges.map(c => c.code)
        expect(breakingCodes).toContain('operation-removed')
        expect(breakingCodes).toContain('required-property-added')
      } finally {
        await b1()
        await h1()
      }

      // Compliant PR candidate (non-breaking mitigation):
      // 1. Restores GET /orders/{id}
      // 2. Makes `currency` optional (`currency?: string`)
      // 3. Adds non-breaking optional query parameter `@query limit?: int32`
      const compliantPrSource = `
        import "@typespec/http";
        using TypeSpec.Http;

        model OrderItem {
          sku: string;
          quantity: int32;
        }

        model Order {
          id: string;
          items: OrderItem[];
          status: string;
          currency?: string; // NON-BREAKING: optional property
        }

        @service namespace OrderService {
          @route("/orders")
          @get op list(@query limit?: int32): Order[];

          @route("/orders/{id}")
          @get op get(@path id: string): Order;

          @route("/orders")
          @post op create(@body order: Order): Order;
        }
      `

      const { result: compliantDiff, baseCleanup: b2, headCleanup: h2 } = await diffSnippets(baseSource, compliantPrSource)
      try {
        // CI Gate Passes cleanly
        expect(hasBreakingChanges(compliantDiff)).toBe(false)
        expect(compliantDiff.breakingChanges).toHaveLength(0)
        expect(compliantDiff.nonBreakingChanges.length).toBeGreaterThanOrEqual(2)
        const nonBreakingCodes = compliantDiff.nonBreakingChanges.map(c => c.code)
        expect(nonBreakingCodes).toContain('property-added')
      } finally {
        await b2()
        await h2()
      }
    })
  })

  // =========================================================================
  // Scenario S4: Real-Time Developer Live-Editing Loop
  // In-Memory Compilation -> Instant Mock Server -> Atomic updateSpec Hot Reload
  // =========================================================================
  describe('S4: Real-Time Developer Live-Editing Loop', () => {
    it('T4-S4: supports seamless iterative development loop without process restarts or socket drops', async () => {
      // Step 1: Initial developer specification
      const sourceIteration1 = `
        import "@typespec/http";
        using TypeSpec.Http;

        @service namespace CatalogService {
          @route("/products")
          @get op getCatalog(): { count: int32 };
        }
      `

      const iter1 = await emitOpenApi3Snippet(sourceIteration1)
      const mockServer = await startInMemoryMockServer(iter1.document)
      activeServers.push(mockServer)

      try {
        const res1 = await fetchMock(mockServer.url, '/products')
        expect(res1.status).toBe(200)
        expect(res1.json()).toHaveProperty('count')

        // Step 2: Developer adds a detail endpoint and writes an update
        const sourceIteration2 = `
          import "@typespec/http";
          using TypeSpec.Http;

          model ProductReview {
            rating: int32;
            comment: string;
          }

          @service namespace CatalogService {
            @route("/products")
            @get op getCatalog(): { count: int32 };

            @route("/products/{id}/reviews")
            @get op getReviews(@path id: string): ProductReview;
          }
        `

        const iter2 = await emitOpenApi3Snippet(sourceIteration2)
        try {
          // Hot reload spec atomically on active server
          const reloadResult = mockServer.updateSpec(iter2.document)
          expect(reloadResult.routesCount).toBeGreaterThanOrEqual(2)

          // Query the newly authored endpoint immediately
          const res2 = await fetchMock(mockServer.url, '/products/prod-42/reviews')
          expect(res2.status).toBe(200)
          const review = res2.json()
          expect(review).toHaveProperty('rating')
          expect(review).toHaveProperty('comment')

          // Original endpoint still operational on the same connection
          const res1Repeat = await fetchMock(mockServer.url, '/products')
          expect(res1Repeat.status).toBe(200)
        } finally {
          await iter2.cleanup()
        }
      } finally {
        await iter1.cleanup()
      }
    })
  })

  // =========================================================================
  // Scenario S5: Regulated Healthcare/Finance GDPR & PII Compliance Pipeline
  // DPM Native Decorators + Persona Traits + Safety Validator + Row Execution
  // =========================================================================
  describe('S5: Regulated Healthcare/Finance GDPR & PII Compliance Pipeline', () => {
    it('T4-S5: enforces end-to-end privacy governance from TypeSpec modeling to DPM execution', async () => {
      // Step 1: Model sensitive patient data with privacy decorators
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        model PatientRecord {
          patientId: string;
          @pseudonymize("mask", "direct_identifier", true) nationalId: string;
          @pseudonymize("redact", "direct_identifier", true) secretNotes: string;
          conditionCode: string;
        }

        @service namespace HealthcareService {
          @route("/patients/{patientId}")
          @personaCapability("pii-masked-default", "audit-emission", "trace-context")
          @get op getPatient(@path patientId: string): PatientRecord;
        }
      `

      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const schema = document.components?.schemas?.PatientRecord
        expect(schema).toBeDefined()

        const nationalIdProp = schema.properties.nationalId
        expect(nationalIdProp[DPM_PROJECTION_EXTENSION]).toBeDefined()
        expect(nationalIdProp[DPM_PROJECTION_EXTENSION].transform).toBe('mask')
        expect(nationalIdProp[DPM_PROJECTION_EXTENSION].role).toBe('direct_identifier')
        expect(nationalIdProp[DPM_PROJECTION_EXTENSION].pii).toBe(true)

        const secretNotesProp = schema.properties.secretNotes
        expect(secretNotesProp[DPM_PROJECTION_EXTENSION].transform).toBe('redact')

        // Step 2: Run DPM Safety Rules against projected columns
        const safetyDiags = validateSafetyRules({
          manifest: {
            columns: [
              {
                name: 'nationalId',
                [DPM_PROJECTION_EXTENSION]: nationalIdProp[DPM_PROJECTION_EXTENSION],
              },
              {
                name: 'secretNotes',
                [DPM_PROJECTION_EXTENSION]: secretNotesProp[DPM_PROJECTION_EXTENSION],
              },
            ],
          },
          registry: {
            roles: ['direct_identifier', 'business_identifier'],
            transforms: ['mask', 'redact', 'hash'],
          },
        } as any)

        const errors = safetyDiags.filter(d => d.severity === 'error')
        expect(errors).toHaveLength(0)

        // Step 3: Execute in-memory row anonymization using DPM execution engine
        const compiledPlan = {
          catalogId: 'healthcare-cat',
          canonicalKeyEncodingVersion: 'v1',
          columnSteps: [
            {
              table: 'patients',
              column: 'nationalId',
              columnRef: 'patients.nationalId',
              transform: nationalIdProp[DPM_PROJECTION_EXTENSION].transform,
            },
            {
              table: 'patients',
              column: 'secretNotes',
              columnRef: 'patients.secretNotes',
              transform: secretNotesProp[DPM_PROJECTION_EXTENSION].transform,
            },
          ],
          relationshipSteps: [],
        }

        const rawRows = [
          {
            table: 'patients',
            values: {
              patientId: 'P1001',
              nationalId: '987-65-4321',
              secretNotes: 'Highly confidential psychological assessment',
              conditionCode: 'C42',
            },
          },
          {
            table: 'patients',
            values: {
              patientId: 'P1002',
              nationalId: '123-45-6789',
              secretNotes: 'Restricted access oncology observation',
              conditionCode: 'A01',
            },
          },
        ]

        const execResult = executeDpmRows(
          {
            plan: compiledPlan as any,
            rows: rawRows,
          },
          { tokenKey: 'healthcare-secret-token-key-minimum-32' },
        )

        expect(execResult.ok).toBe(true)
        expect(execResult.rows).toHaveLength(2)

        // Assert zero raw PII leakage: nationalId is masked, secretNotes is redacted
        for (const row of execResult.rows) {
          expect(row.values.nationalId).not.toBe('987-65-4321')
          expect(row.values.nationalId).not.toBe('123-45-6789')
          expect(row.values.nationalId).toBe('[MASKED]')

          expect(row.values.secretNotes).not.toContain('confidential')
          expect(row.values.secretNotes).not.toContain('Restricted')
          expect(row.values.secretNotes).toBe('[REDACTED]')

          // Non-PII fields remain unaffected
          expect(row.values.conditionCode).toBeDefined()
        }
      } finally {
        await cleanup()
      }
    })
  })
})
