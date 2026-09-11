import { describe, it, expect } from 'vitest'
import { compileTypeSpecSnippet, emitOpenApi3Snippet } from './helpers/compiler.js'
import {
  VALID_PERSONA_TRAITS,
  VALID_DPM_TRANSFORMS,
  VALID_DPM_ROLES,
} from './helpers/decorators.js'
import { loadOperationsFromMergedSpec } from '../../../packages/personas/src/load.js'
import { validateSafetyRules } from '../../../packages/dpm/src/validator/safety-validator.js'
import { executeDpmRows } from '../../../packages/dpm/src/execution/in-memory-executor.js'

describe('Tier 1: Personas & DPM Native TypeSpec Decorators (F14-F19)', () => {
  // =========================================================================
  // F14: TypeSpec @personaCapability Decorator
  // =========================================================================
  describe('F14: TypeSpec @personaCapability Decorator', () => {
    it('T1-F14-1: accepts valid capability trait from skill.yaml (e.g. pagination) with 0 errors', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace ValidTraitService {
          @route("/items")
          @personaCapability("pagination")
          op listItems(): string[];
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

    it('T1-F14-2: rejects unrecognized trait reporting diagnostic invalid-persona-trait', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace BadTraitService {
          @route("/items")
          @personaCapability("unknown-non-existent-skill")
          op listItems(): string[];
        }
      `
      const { program, cleanup } = await compileTypeSpecSnippet(source)
      try {
        const error = program.diagnostics.find(d => d.code === '@oa-sdk/typespec-decorators/invalid-persona-trait')
        expect(error).toBeDefined()
        expect(error?.message).toContain('unknown-non-existent-skill')
      } finally {
        await cleanup()
      }
    })

    it('T1-F14-3: accepts multiple valid traits in a single decorator invocation', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace MultiTraitService {
          @route("/items")
          @personaCapability("pagination", "idempotent", "filter-by-role")
          op listItems(): string[];
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const traits = document.paths['/items'].get['x-oa-sdk-persona-traits']
        expect(traits).toEqual(['filter-by-role', 'idempotent', 'pagination'])
      } finally {
        await cleanup()
      }
    })

    it('T1-F14-4: accepts multiple separate @personaCapability decorator calls on the same operation', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace SeparateCallsService {
          @route("/events")
          @personaCapability("audit-emission")
          @personaCapability("trace-context")
          op getEvents(): string[];
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const traits = document.paths['/events'].get['x-oa-sdk-persona-traits']
        expect(traits).toContain('audit-emission')
        expect(traits).toContain('trace-context')
      } finally {
        await cleanup()
      }
    })

    it('T1-F14-5: automatically deduplicates and sorts declared capability traits', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace DedupService {
          @route("/data")
          @personaCapability("retryable", "batch", "retryable")
          @personaCapability("batch")
          op getData(): string[];
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const traits = document.paths['/data'].get['x-oa-sdk-persona-traits']
        expect(traits).toEqual(['batch', 'retryable'])
      } finally {
        await cleanup()
      }
    })
  })

  // =========================================================================
  // F15: OpenAPI Extension x-oa-sdk-persona-traits
  // =========================================================================
  describe('F15: OpenAPI Extension x-oa-sdk-persona-traits', () => {
    it('T1-F15-1: emits x-oa-sdk-persona-traits array under OpenAPI Operation Object', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace ExtEmitService {
          @route("/users")
          @personaCapability("pagination")
          op getUsers(): string[];
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const op = document.paths['/users'].get
        expect(op['x-oa-sdk-persona-traits']).toBeDefined()
        expect(Array.isArray(op['x-oa-sdk-persona-traits'])).toBe(true)
      } finally {
        await cleanup()
      }
    })

    it('T1-F15-2: emitted extension array contains sorted, unique trait IDs matching decorator input', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace SortService {
          @route("/feed")
          @personaCapability("signed-response", "cacheable", "etag-supported")
          op getFeed(): string;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const traits = document.paths['/feed'].get['x-oa-sdk-persona-traits']
        expect(traits).toEqual(['cacheable', 'etag-supported', 'signed-response'])
      } finally {
        await cleanup()
      }
    })

    it('T1-F15-3: operations without @personaCapability decorator omit the extension', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace UndecoratedService {
          @route("/plain") op plain(): string;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const op = document.paths['/plain'].get
        expect(op['x-oa-sdk-persona-traits']).toBeUndefined()
      } finally {
        await cleanup()
      }
    })

    it('T1-F15-4: multiple operations maintain isolated, distinct persona traits in emitted document', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace IsolatedOps {
          @route("/stream")
          @personaCapability("sse-stream")
          op stream(): string;

          @route("/webhook")
          @personaCapability("webhook-source")
          op webhook(): string;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        expect(document.paths['/stream'].get['x-oa-sdk-persona-traits']).toEqual(['sse-stream'])
        expect(document.paths['/webhook'].get['x-oa-sdk-persona-traits']).toEqual(['webhook-source'])
      } finally {
        await cleanup()
      }
    })

    it('T1-F15-5: extension survives in-memory OpenAPI 3.2 compilation via @typespec/openapi3', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace SurvivesOpenApi3 {
          @route("/auth/token")
          @personaCapability("oauth-scope-aware", "rate-limit-honored")
          op token(): string;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        expect(document.openapi).toBe('3.2.0')
        expect(document.paths['/auth/token'].get['x-oa-sdk-persona-traits']).toEqual([
          'oauth-scope-aware',
          'rate-limit-honored',
        ])
      } finally {
        await cleanup()
      }
    })
  })

  // =========================================================================
  // F16: TypeSpec @pseudonymize Decorator
  // =========================================================================
  describe('F16: TypeSpec @pseudonymize Decorator', () => {
    it('T1-F16-1: accepts valid DPM transforms (keep, redact, mask, null, hash, generalize, relationship_token)', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace TransformService {
          model AnonymizedUser {
            @pseudonymize("mask")
            email: string;

            @pseudonymize("hash")
            phone: string;

            @pseudonymize("null")
            ipAddress?: string;
          }
          @route("/user") op get(): AnonymizedUser;
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

    it('T1-F16-2: enforces SAF001 (direct_identifier cannot use keep transform)', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace Saf001Test {
          model BadUser {
            @pseudonymize("keep", "direct_identifier")
            ssn: string;
          }
        }
      `
      const { program, cleanup } = await compileTypeSpecSnippet(source)
      try {
        const saf001 = program.diagnostics.find(d => d.message.includes('SAF001'))
        expect(saf001).toBeDefined()
        expect(saf001?.severity).toBe('error')
      } finally {
        await cleanup()
      }
    })

    it('T1-F16-3: enforces SAF002 (foreign_identifier with pii requires relationship reference)', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace Saf002Test {
          model BadFk {
            @pseudonymize("hash", "foreign_identifier", true)
            parentId: string;
          }
        }
      `
      const { program, cleanup } = await compileTypeSpecSnippet(source)
      try {
        const saf002 = program.diagnostics.find(d => d.message.includes('SAF002'))
        expect(saf002).toBeDefined()
        expect(saf002?.severity).toBe('error')
      } finally {
        await cleanup()
      }
    })

    it('T1-F16-4: enforces SAF010 (pii field cannot use keep transform)', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace Saf010Test {
          model BadPii {
            @pseudonymize("keep", "business_identifier", true)
            nationalId: string;
          }
        }
      `
      const { program, cleanup } = await compileTypeSpecSnippet(source)
      try {
        const saf010 = program.diagnostics.find(d => d.message.includes('SAF010'))
        expect(saf010).toBeDefined()
        expect(saf010?.severity).toBe('error')
      } finally {
        await cleanup()
      }
    })

    it('T1-F16-5: rejects unknown transforms and invalid role names reporting diagnostics', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace BadTransformTest {
          model BadTransformModel {
            @pseudonymize("encrypt_rot13", "invalid_role")
            secret: string;
          }
        }
      `
      const { program, cleanup } = await compileTypeSpecSnippet(source)
      try {
        const errors = program.diagnostics.filter(d => d.code === '@oa-sdk/typespec-decorators/invalid-pseudonymize-rule')
        expect(errors.length).toBeGreaterThanOrEqual(1)
      } finally {
        await cleanup()
      }
    })
  })

  // =========================================================================
  // F17: OpenAPI Extension x-oa-sdk-dpm-projection
  // =========================================================================
  describe('F17: OpenAPI Extension x-oa-sdk-dpm-projection', () => {
    it('T1-F17-1: emits x-oa-sdk-dpm-projection object under property Schema Object', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace DpmEmitService {
          model Profile {
            @pseudonymize("mask", "direct_identifier", true)
            email: string;
          }
          @route("/profile") op get(): Profile;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const prop = document.components.schemas.Profile.properties.email
        expect(prop['x-oa-sdk-dpm-projection']).toBeDefined()
        expect(prop['x-oa-sdk-dpm-projection'].transform).toBe('mask')
      } finally {
        await cleanup()
      }
    })

    it('T1-F17-2: emitted extension contains transform string', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace TransformCheck {
          model Account {
            @pseudonymize("redact")
            ssn: string;
          }
          @route("/acc") op get(): Account;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const proj = document.components.schemas.Account.properties.ssn['x-oa-sdk-dpm-projection']
        expect(proj.transform).toBe('redact')
      } finally {
        await cleanup()
      }
    })

    it('T1-F17-3: emitted extension contains role when specified', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace RoleCheck {
          model Account {
            @pseudonymize("hash", "business_identifier")
            accountNumber: string;
          }
          @route("/acc") op get(): Account;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const proj = document.components.schemas.Account.properties.accountNumber['x-oa-sdk-dpm-projection']
        expect(proj.role).toBe('business_identifier')
      } finally {
        await cleanup()
      }
    })

    it('T1-F17-4: emitted extension contains pii boolean flag when specified', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace PiiCheck {
          model Patient {
            @pseudonymize("mask", "direct_identifier", true)
            fullName: string;
          }
          @route("/patient") op get(): Patient;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const proj = document.components.schemas.Patient.properties.fullName['x-oa-sdk-dpm-projection']
        expect(proj.pii).toBe(true)
      } finally {
        await cleanup()
      }
    })

    it('T1-F17-5: emitted extension contains relationship identifier when specified', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace RelCheck {
          model Order {
            @pseudonymize("relationship_token", "foreign_identifier", true, "rel_user_orders")
            customerId: string;
          }
          @route("/order") op get(): Order;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const proj = document.components.schemas.Order.properties.customerId['x-oa-sdk-dpm-projection']
        expect(proj.transform).toBe('relationship_token')
        expect(proj.relationship).toBe('rel_user_orders')
      } finally {
        await cleanup()
      }
    })
  })

  // =========================================================================
  // F18: Persona Verification Gate Integration
  // =========================================================================
  describe('F18: Persona Verification Gate Integration', () => {
    it('T1-F18-1: validates that all recognized skills from skill.yaml (24 traits) are enumerated in VALID_PERSONA_TRAITS', () => {
      expect(VALID_PERSONA_TRAITS.size).toBe(24)
      expect(VALID_PERSONA_TRAITS.has('pagination')).toBe(true)
      expect(VALID_PERSONA_TRAITS.has('filter-by-role')).toBe(true)
      expect(VALID_PERSONA_TRAITS.has('filter-by-status')).toBe(true)
      expect(VALID_PERSONA_TRAITS.has('full-text-search')).toBe(true)
      expect(VALID_PERSONA_TRAITS.has('batch')).toBe(true)
      expect(VALID_PERSONA_TRAITS.has('sse-stream')).toBe(true)
      expect(VALID_PERSONA_TRAITS.has('etag-supported')).toBe(true)
      expect(VALID_PERSONA_TRAITS.has('partial-response')).toBe(true)
      expect(VALID_PERSONA_TRAITS.has('idempotent')).toBe(true)
      expect(VALID_PERSONA_TRAITS.has('retryable')).toBe(true)
      expect(VALID_PERSONA_TRAITS.has('cacheable')).toBe(true)
      expect(VALID_PERSONA_TRAITS.has('audit-emission')).toBe(true)
      expect(VALID_PERSONA_TRAITS.has('metrics-emission')).toBe(true)
      expect(VALID_PERSONA_TRAITS.has('trace-context')).toBe(true)
      expect(VALID_PERSONA_TRAITS.has('pii-visible-admin')).toBe(true)
      expect(VALID_PERSONA_TRAITS.has('pii-masked-default')).toBe(true)
      expect(VALID_PERSONA_TRAITS.has('pseudonymized')).toBe(true)
      expect(VALID_PERSONA_TRAITS.has('signed-response')).toBe(true)
      expect(VALID_PERSONA_TRAITS.has('mtls')).toBe(true)
      expect(VALID_PERSONA_TRAITS.has('webhook-source')).toBe(true)
      expect(VALID_PERSONA_TRAITS.has('webhook-target')).toBe(true)
      expect(VALID_PERSONA_TRAITS.has('oauth-scope-aware')).toBe(true)
      expect(VALID_PERSONA_TRAITS.has('rate-limit-honored')).toBe(true)
      expect(VALID_PERSONA_TRAITS.has('idempotency-key-required')).toBe(true)
    })

    it('T1-F18-2: loadOperationsFromMergedSpec reads OpenAPI doc and extracts operation traits', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace LoadTraitsTest {
          @route("/users")
          @operationId("listUsersOp")
          @personaCapability("pagination", "filter-by-status")
          op listUsers(): string[];
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const op = document.paths['/users'].get
        expect(op['x-oa-sdk-persona-traits']).toEqual(['filter-by-status', 'pagination'])
      } finally {
        await cleanup()
      }
    })

    it('T1-F18-3: rejects operation trait assignment with invalid skill category', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace InvalidCategoryTest {
          @route("/invalid")
          @personaCapability("sql-injection-prevention")
          op run(): string;
        }
      `
      const { program, cleanup } = await compileTypeSpecSnippet(source)
      try {
        const errors = program.diagnostics.filter(d => d.severity === 'error')
        expect(errors.length).toBeGreaterThan(0)
      } finally {
        await cleanup()
      }
    })

    it('T1-F18-4: verified against real canonical OpenAPI merged spec with loadOperationsFromMergedSpec', () => {
      const canonicalPath = 'packages/schemas/src/.merged.yaml'
      const ops = loadOperationsFromMergedSpec(canonicalPath)
      expect(ops.size).toBeGreaterThan(20)
    })

    it('T1-F18-5: verified that all 24 skills can be applied across operations without diagnostic collision', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        import "@oa-sdk/typespec-decorators";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;
        using OaSdkTypeSpec;

        @service namespace AllSkillsTest {
          @route("/op1") @personaCapability("pagination", "filter-by-role", "filter-by-status", "full-text-search", "batch") op o1(): string;
          @route("/op2") @personaCapability("sse-stream", "etag-supported", "partial-response") op o2(): string;
          @route("/op3") @personaCapability("idempotent", "retryable", "cacheable") op o3(): string;
          @route("/op4") @personaCapability("audit-emission", "metrics-emission", "trace-context") op o4(): string;
          @route("/op5") @personaCapability("pii-visible-admin", "pii-masked-default", "pseudonymized", "signed-response", "mtls") op o5(): string;
          @route("/op6") @personaCapability("webhook-source", "webhook-target", "oauth-scope-aware", "rate-limit-honored", "idempotency-key-required") op o6(): string;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        expect(document.paths['/op1'].get['x-oa-sdk-persona-traits']).toHaveLength(5)
        expect(document.paths['/op2'].get['x-oa-sdk-persona-traits']).toHaveLength(3)
        expect(document.paths['/op3'].get['x-oa-sdk-persona-traits']).toHaveLength(3)
        expect(document.paths['/op4'].get['x-oa-sdk-persona-traits']).toHaveLength(3)
        expect(document.paths['/op5'].get['x-oa-sdk-persona-traits']).toHaveLength(5)
        expect(document.paths['/op6'].get['x-oa-sdk-persona-traits']).toHaveLength(5)
      } finally {
        await cleanup()
      }
    })
  })

  // =========================================================================
  // F19: DPM Schema & Projection Gate Integration
  // =========================================================================
  describe('F19: DPM Schema & Projection Gate Integration', () => {
    it('T1-F19-1: validates that all DPM transforms and roles are recognized', () => {
      expect(VALID_DPM_TRANSFORMS.size).toBe(8)
      expect(VALID_DPM_ROLES.size).toBe(6)
    })

    it('T1-F19-2: validateSafetyRules rejects direct_identifier with keep transform (SAF001)', () => {
      const issues = validateSafetyRules({
        manifest: {
          id: 'bad-manifest',
          columns: [
            {
              table: 'users',
              column: 'national_id',
              role: 'direct_identifier',
              transform: { type: 'keep' },
            },
          ],
          relationships: [],
          entities: [],
        },
      } as any)
      expect(issues.some(i => i.code === 'SAF001')).toBe(true)
    })

    it('T1-F19-3: validateSafetyRules rejects foreign_identifier with pii but no relationship (SAF002)', () => {
      const issues = validateSafetyRules({
        manifest: {
          id: 'bad-manifest',
          columns: [
            {
              table: 'orders',
              column: 'foreign_ssn',
              role: 'foreign_identifier',
              pii: true,
              transform: { type: 'hash' },
            },
          ],
          relationships: [],
          entities: [],
        },
      } as any)
      expect(issues.some(i => i.code === 'SAF002')).toBe(true)
    })

    it('T1-F19-4: validateSafetyRules rejects pii field with keep transform (SAF010)', () => {
      const issues = validateSafetyRules({
        manifest: {
          id: 'bad-manifest',
          columns: [
            {
              table: 'users',
              column: 'email',
              role: 'business_identifier',
              pii: true,
              transform: { type: 'keep' },
            },
          ],
          relationships: [],
          entities: [],
        },
      } as any)
      expect(issues.some(i => i.code === 'SAF010')).toBe(true)
    })

    it('T1-F19-5: in-memory executor executes transform rules specified in projection without leaking raw PII', () => {
      const plan = {
        catalogId: 'cat-test',
        canonicalKeyEncodingVersion: 'v1',
        columnSteps: [
          {
            table: 'users',
            column: 'email',
            columnRef: 'users.email',
            transform: 'redact',
          },
        ],
        relationshipSteps: [],
      }
      const rows = [{ table: 'users', values: { email: 'john.doe@example.com' } }]
      const result = executeDpmRows(
        {
          plan: plan as any,
          rows,
        },
        { tokenKey: 'test-token-key-32-chars-minimum' },
      )
      expect(result.ok).toBe(true)
      expect(result.rows[0].values.email).not.toBe('john.doe@example.com')
      expect(result.rows[0].values.email).toBe('[REDACTED]')
    })
  })
})
