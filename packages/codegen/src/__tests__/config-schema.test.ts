import { describe, it, expect } from "vitest"
import { z } from "zod"
import {
  defineConfig,
  validateOaConfig,
  assertOaConfig,
  isOaConfig,
  OaConfigError,
  oaConfigSchema,
  OPENAPI_PROJECTION_PROFILES,
  PRODUCT_LIFECYCLE_ARCHETYPES,
  TARGET_FRAMEWORK_IDS,
  TARGET_RUNTIMES,
  getArchetypeDefaults,
  resolveConfigWithDefaults,
  type OaConfig,
  type ProfileTargetConfig,
  type GuardTargetConfig,
  type SharedPlatformCoreConfig,
  type ProductDomainConfig,
  type ResolvedOaConfig,
  type ProductLifecycleArchetype,
  type TargetFrameworkId,
  type TargetRuntime,
} from "../config.js"

describe('M2 Declarative Config Schema & Types (oa.config.ts)', () => {
  describe('1. Valid Monorepo Configurations (Browser Studio Scale)', () => {
    it('validates full Browser Studio multi-target configuration with 5 profiles and guards', () => {
      const config: OaConfig = {
        rootDir: '.',
        specs: [
          {
            id: 'devlink-contracts',
            profile: 'operation-contract',
            schemaEntry: 'packages/devlink-contracts/src/index.ts',
            outDir: 'artifacts/specs',
            title: 'DevLink Native RPC Operation Contract',
            version: '1.0.0',
          },
          {
            id: 'devlink-mcp',
            profile: 'operation-contract',
            schemaEntry: 'packages/devlink-contracts/src/index.ts',
            outDir: 'artifacts/specs',
            title: 'DevLink MCP Stdio Operation Contract',
            version: '1.0.0',
          },
          {
            id: 'surface-engine',
            profile: 'component-bundle',
            schemaEntry: 'packages/surface-engine/src/types/schemas.ts',
            outDir: 'artifacts/specs',
            title: 'Surface Engine Component Bundle',
            version: '1.0.0',
          },
          {
            id: 'visual-ir',
            profile: 'component-bundle',
            schemaEntry: 'packages/visual-ir/src/schema/index.ts',
            outDir: 'artifacts/specs',
            title: 'Universal Visual IR Component Bundle',
            version: '1.0.0',
          },
          {
            id: 'inspector-controls',
            profile: 'component-bundle',
            schemaEntry: 'packages/inspector-controls/src/index.ts',
            outDir: 'artifacts/specs',
            title: 'Inspector Controls Component Bundle',
            version: '1.0.0',
          },
        ],
        guards: {
          outDir: 'dist/guards',
          split: true,
          moduleFormat: 'esm',
          auditCsp: true,
        },
      }

      const defined = defineConfig(config)
      expect(defined).toBe(config)

      const validation = validateOaConfig(config)
      expect(validation.valid).toBe(true)
      expect(validation.errors).toEqual([])
      expect(validation.config).toBe(config)

      expect(isOaConfig(config)).toBe(true)
      expect(() => assertOaConfig(config)).not.toThrow()
    })

    it('validates specs-only configuration without guards', () => {
      const config: OaConfig = {
        specs: [
          {
            id: 'api-core',
            profile: 'full-api-document',
            schemaEntry: 'src/schemas.ts',
            outDir: 'dist/spec',
          },
        ],
      }

      expect(isOaConfig(config)).toBe(true)
      expect(defineConfig(config)).toBe(config)
    })

    it('validates guards-only configuration without specs', () => {
      const config: OaConfig = {
        rootDir: '/workspace/project',
        guards: {
          outDir: 'dist/guards',
          split: false,
          moduleFormat: 'cjs',
          auditCsp: false,
        },
      }

      expect(isOaConfig(config)).toBe(true)
      expect(defineConfig(config)).toBe(config)
    })

    it('validates minimal spec target with only required fields', () => {
      const spec: ProfileTargetConfig = {
        id: 'surface',
        profile: 'component-bundle',
        schemaEntry: 'src/types.ts',
        outDir: 'out',
      }
      const config: OaConfig = { specs: [spec] }
      expect(isOaConfig(config)).toBe(true)
    })

    it('validates guard configuration with default/minimal options', () => {
      const guards: GuardTargetConfig = {
        outDir: 'dist/guards',
      }
      const config: OaConfig = { guards }
      expect(isOaConfig(config)).toBe(true)
    })

    it('preserves backward compatibility with legacy schemas and output options', () => {
      const legacyConfig: OaConfig = {
        output: 'dist/yaml',
        grouping: 'per-schema',
        filename: 'custom-components',
        mergeIntoSpec: true,
        specPath: 'spec.yaml',
        schemas: {
          User: z.object({ id: z.string() }),
        },
      }

      expect(isOaConfig(legacyConfig)).toBe(true)
      const validated = defineConfig(legacyConfig)
      expect(validated.output).toBe('dist/yaml')
      expect(validated.schemas).toBeDefined()
    })
  })

  describe('2. Runtime Validation: Duplicate Spec Target IDs', () => {
    it('detects duplicate target IDs in specs and returns error with exact indices', () => {
      const duplicateConfig = {
        specs: [
          {
            id: 'devlink-contracts',
            profile: 'operation-contract',
            schemaEntry: 'packages/devlink-contracts/src/index.ts',
            outDir: 'artifacts/specs',
          },
          {
            id: 'surface-engine',
            profile: 'component-bundle',
            schemaEntry: 'packages/surface-engine/src/types/schemas.ts',
            outDir: 'artifacts/specs',
          },
          {
            id: 'devlink-contracts', // DUPLICATE ID
            profile: 'operation-contract',
            schemaEntry: 'packages/devlink-contracts/src/duplicate.ts',
            outDir: 'artifacts/specs',
          },
        ],
      }

      const result = validateOaConfig(duplicateConfig)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.path === 'specs[2].id')).toBe(true)
      expect(result.errors.find((e) => e.path === 'specs[2].id')?.message).toContain(
        'Duplicate spec target id "devlink-contracts" at index 2 (already declared at index 0)',
      )

      expect(() => assertOaConfig(duplicateConfig)).toThrow(OaConfigError)
      expect(() => assertOaConfig(duplicateConfig)).toThrow(
        /Duplicate spec target id "devlink-contracts"/,
      )
    })
  })

  describe('3. Runtime Validation: Missing and Invalid Spec Target Fields', () => {
    it('rejects missing or empty id', () => {
      const config = {
        specs: [
          {
            id: '',
            profile: 'component-bundle',
            schemaEntry: 'src/types.ts',
            outDir: 'artifacts',
          },
        ],
      }

      const result = validateOaConfig(config)
      expect(result.valid).toBe(false)
      expect(result.errors.find((e) => e.path === 'specs[0].id')?.message).toContain(
        'Target id is required and must be a non-empty string',
      )
    })

    it('rejects invalid projection profile', () => {
      const config = {
        specs: [
          {
            id: 'test',
            profile: 'invalid-profile-type',
            schemaEntry: 'src/types.ts',
            outDir: 'artifacts',
          },
        ],
      }

      const result = validateOaConfig(config)
      expect(result.valid).toBe(false)
      expect(result.errors.find((e) => e.path === 'specs[0].profile')?.message).toContain(
        "profile is required and must be one of: 'component-bundle', 'operation-contract', 'full-api-document'",
      )
    })

    it('rejects missing schemaEntry', () => {
      const config = {
        specs: [
          {
            id: 'test',
            profile: 'component-bundle',
            schemaEntry: '   ',
            outDir: 'artifacts',
          },
        ],
      }

      const result = validateOaConfig(config)
      expect(result.valid).toBe(false)
      expect(result.errors.find((e) => e.path === 'specs[0].schemaEntry')?.message).toContain(
        'schemaEntry is required and must be a non-empty string',
      )
    })

    it('rejects missing outDir', () => {
      const config = {
        specs: [
          {
            id: 'test',
            profile: 'component-bundle',
            schemaEntry: 'src/types.ts',
            outDir: '',
          },
        ],
      }

      const result = validateOaConfig(config)
      expect(result.valid).toBe(false)
      expect(result.errors.find((e) => e.path === 'specs[0].outDir')?.message).toContain(
        'outDir is required and must be a non-empty string',
      )
    })

    it('rejects non-array specs field', () => {
      const config = {
        specs: 'not-an-array',
      }

      const result = validateOaConfig(config)
      expect(result.valid).toBe(false)
      expect(result.errors.find((e) => e.path === 'specs')?.message).toContain(
        'specs must be an array of ProfileTargetConfig',
      )
    })

    it('rejects non-object spec target items', () => {
      const config = {
        specs: [null, 'invalid'],
      }

      const result = validateOaConfig(config)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.path === 'specs[0]')).toBe(true)
      expect(result.errors.some((e) => e.path === 'specs[1]')).toBe(true)
    })
  })

  describe('4. Runtime Validation: Guard Target Configuration', () => {
    it('rejects missing outDir in guards', () => {
      const config = {
        guards: {
          split: true,
        },
      }

      const result = validateOaConfig(config)
      expect(result.valid).toBe(false)
      expect(result.errors.find((e) => e.path === 'guards.outDir')?.message).toContain(
        'outDir is required and must be a non-empty string',
      )
    })

    it('rejects invalid moduleFormat in guards', () => {
      const config = {
        guards: {
          outDir: 'dist/guards',
          moduleFormat: 'amd',
        },
      }

      const result = validateOaConfig(config)
      expect(result.valid).toBe(false)
      expect(result.errors.find((e) => e.path === 'guards.moduleFormat')?.message).toContain(
        "moduleFormat must be 'esm' or 'cjs'",
      )
    })

    it('rejects non-boolean split or auditCsp in guards', () => {
      const config = {
        guards: {
          outDir: 'dist/guards',
          split: 'true',
          auditCsp: 1,
        },
      }

      const result = validateOaConfig(config)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.path === 'guards.split')).toBe(true)
      expect(result.errors.some((e) => e.path === 'guards.auditCsp')).toBe(true)
    })

    it('rejects non-object guards property', () => {
      const config = {
        guards: 'dist/guards',
      }

      const result = validateOaConfig(config)
      expect(result.valid).toBe(false)
      expect(result.errors.find((e) => e.path === 'guards')?.message).toContain('guards must be an object')
    })
  })

  describe('5. Structural & Top-Level Invariants', () => {
    it('accepts empty configuration object or config with only rootDir', () => {
      const emptyConfig = {}
      const result = validateOaConfig(emptyConfig)
      expect(result.valid).toBe(true)

      const rootOnlyConfig = { rootDir: './workspace' }
      const rootResult = validateOaConfig(rootOnlyConfig)
      expect(rootResult.valid).toBe(true)
      expect(defineConfig(rootOnlyConfig).rootDir).toBe('./workspace')
    })

    it('rejects non-object root inputs (null, string, array, number)', () => {
      expect(validateOaConfig(null).valid).toBe(false)
      expect(validateOaConfig(undefined).valid).toBe(false)
      expect(validateOaConfig('string').valid).toBe(false)
      expect(validateOaConfig(42).valid).toBe(false)
      expect(validateOaConfig([]).valid).toBe(false)
    })

    it('rejects non-string rootDir', () => {
      const config = {
        rootDir: 12345,
        specs: [
          {
            id: 'devlink',
            profile: 'component-bundle',
            schemaEntry: 'src/index.ts',
            outDir: 'artifacts',
          },
        ],
      }

      const result = validateOaConfig(config)
      expect(result.valid).toBe(false)
      expect(result.errors.find((e) => e.path === 'rootDir')?.message).toContain(
        'rootDir must be a non-empty string when provided',
      )
    })

    it('assertOaConfig throws OaConfigError with formatted diagnostic issues', () => {
      const invalid = {
        specs: [
          { id: '', profile: 'unknown', schemaEntry: '', outDir: '' },
          { id: '', profile: 'unknown', schemaEntry: '', outDir: '' },
        ],
      }

      try {
        assertOaConfig(invalid)
        expect.unreachable('Should have thrown OaConfigError')
      } catch (err) {
        expect(err).toBeInstanceOf(OaConfigError)
        const cfgError = err as OaConfigError
        expect(cfgError.errors.length).toBeGreaterThan(0)
        expect(cfgError.message).toContain('Invalid oa-gen configuration:')
        expect(cfgError.message).toContain('specs[0].id')
      }
    })
  })

  describe('6. Zod Master Schema Conformance', () => {
    it('oaConfigSchema validates valid configs', () => {
      const config = {
        specs: [
          {
            id: 'devlink-contracts',
            profile: 'operation-contract' as const,
            schemaEntry: 'packages/devlink-contracts/src/index.ts',
            outDir: 'artifacts/specs',
          },
        ],
        guards: {
          outDir: 'dist/guards',
          moduleFormat: 'esm' as const,
        },
      }

      const parsed = oaConfigSchema.safeParse(config)
      expect(parsed.success).toBe(true)
    })

    it('oaConfigSchema catches duplicate spec target IDs in superRefine', () => {
      const duplicate = {
        specs: [
          {
            id: 'surface',
            profile: 'component-bundle' as const,
            schemaEntry: 'src/types.ts',
            outDir: 'artifacts',
          },
          {
            id: 'surface',
            profile: 'component-bundle' as const,
            schemaEntry: 'src/types.ts',
            outDir: 'artifacts',
          },
        ],
      }

      const parsed = oaConfigSchema.safeParse(duplicate)
      expect(parsed.success).toBe(false)
      if (!parsed.success) {
        expect(parsed.error.issues.some((i) => i.path.join('.') === 'specs.1.id')).toBe(true)
      }
    })

    it('exposes OPENAPI_PROJECTION_PROFILES constant with expected 3 profiles', () => {
      expect(OPENAPI_PROJECTION_PROFILES).toEqual([
        'component-bundle',
        'operation-contract',
        'full-api-document',
      ])
    })
  })

  describe("7. Dual-Layer Configuration Architecture (core vs product)", () => {
    it("validates full dual-layer configuration with complete core and product specifications", () => {
      const config: OaConfig = {
        rootDir: ".",
        archetype: "enterprise",
        core: {
          dialect: {
            oasVersion: "3.2.0",
            jsonSchemaDialect: "draft-2020-12",
            canonicalProjection: true,
          },
          contracts: {
            pureHandlers: true,
            contractName: "EnterpriseHandlers",
            namingPattern: "[id].contract.ts",
            outDir: "src/contracts",
            banner: true,
          },
          client: {
            enabled: true,
            wireFormatSafety: true,
            outDir: "src/sdk",
          },
          typegen: {
            resolveSymbolCycles: true,
            discriminatedUnions: true,
            targetAdapter: "ts",
          },
          gates: {
            driftCheck: true,
            failOnBreaking: true,
            baseRef: "origin/main",
            preflightLint: "error",
          },
        },
        product: {
          archetype: "enterprise",
          framework: "fastify",
          runtime: "node",
          jitSchema: true,
          zeroCopy: false,
          specs: [
            {
              id: "enterprise-api",
              schemaEntry: "src/schemas/api.ts",
              outDir: "artifacts/api",
              profile: "full-api-document",
              target: "fastify",
              title: "Enterprise API",
              version: "2.0.0",
              tags: ["v2", "enterprise"],
            },
          ],
          guards: {
            outDir: "dist/guards",
            split: true,
            moduleFormat: "esm",
            auditCsp: true,
          },
          contextInjection: {
            typeName: "EnterpriseContext",
            importPath: "./src/context.js",
            propertyKey: "ctx",
            fields: ["tenantId", "user", "permissions"],
          },
          personas: {
            registryPath: "personas/registry.yaml",
            requiredTraits: ["auth:bearer", "audit:trail"],
            enforceCoverage: true,
            minCoverageRatio: 0.95,
          },
          security: {
            schemes: {
              bearerAuth: {
                type: "http",
                scheme: "bearer",
                bearerFormat: "JWT",
              },
            },
            defaultRequirement: [{ bearerAuth: ["read", "write"] }],
          },
        },
      }

      expect(isOaConfig(config)).toBe(true)
      expect(defineConfig(config)).toBe(config)
      const validation = validateOaConfig(config)
      expect(validation.valid).toBe(true)
      expect(validation.errors).toEqual([])
      expect(() => assertOaConfig(config)).not.toThrow()
    })

    it("accepts partial dual-layer configuration with only core or only product", () => {
      const coreOnly: OaConfig = {
        core: {
          dialect: { oasVersion: "3.2.0" },
          contracts: { pureHandlers: true },
        },
      }
      expect(validateOaConfig(coreOnly).valid).toBe(true)

      const productOnly: OaConfig = {
        product: {
          framework: "elysia",
          runtime: "bun",
        },
      }
      expect(validateOaConfig(productOnly).valid).toBe(true)
    })

    it("rejects non-object core or product properties", () => {
      const badCore = { core: "not-an-object" }
      const resCore = validateOaConfig(badCore)
      expect(resCore.valid).toBe(false)
      expect(resCore.errors.find((e) => e.path === "core")?.message).toBe("core must be an object")

      const badProduct = { product: 12345 }
      const resProduct = validateOaConfig(badProduct)
      expect(resProduct.valid).toBe(false)
      expect(resProduct.errors.find((e) => e.path === "product")?.message).toBe("product must be an object")
    })
  })

  describe("8. Lifecycle Archetype Presets & Defaults Matrix (getArchetypeDefaults)", () => {
    it("returns expected rapid-iteration defaults for mvp archetype", () => {
      const mvp = getArchetypeDefaults("mvp")
      expect(mvp.core.dialect?.oasVersion).toBe("3.2.0")
      expect(mvp.core.dialect?.jsonSchemaDialect).toBe("draft-2020-12")
      expect(mvp.core.dialect?.canonicalProjection).toBe(true)
      expect(mvp.core.contracts?.pureHandlers).toBe(true)
      expect(mvp.core.contracts?.contractName).toBe("ApiHandlers")
      expect(mvp.core.contracts?.banner).toBe(true)
      expect(mvp.core.client?.enabled).toBe(true)
      expect(mvp.core.client?.wireFormatSafety).toBe(false)
      expect(mvp.core.typegen?.resolveSymbolCycles).toBe(false)
      expect(mvp.core.typegen?.discriminatedUnions).toBe(true)
      expect(mvp.core.gates?.driftCheck).toBe(false)
      expect(mvp.core.gates?.failOnBreaking).toBe(false)
      expect(mvp.core.gates?.preflightLint).toBe("warn")
      expect(mvp.product.jitSchema).toBe(false)
      expect(mvp.product.zeroCopy).toBe(false)
    })

    it("returns expected high-throughput defaults for microservice archetype", () => {
      const ms = getArchetypeDefaults("microservice")
      expect(ms.core.dialect?.oasVersion).toBe("3.2.0")
      expect(ms.core.contracts?.pureHandlers).toBe(true)
      expect(ms.core.client?.wireFormatSafety).toBe(true)
      expect(ms.core.typegen?.resolveSymbolCycles).toBe(true)
      expect(ms.core.typegen?.discriminatedUnions).toBe(true)
      expect(ms.core.gates?.driftCheck).toBe(true)
      expect(ms.core.gates?.failOnBreaking).toBe(false)
      expect(ms.core.gates?.preflightLint).toBe("error")
      expect(ms.product.jitSchema).toBe(true)
      expect(ms.product.zeroCopy).toBe(true)
    })

    it("returns expected strict-governance defaults for enterprise archetype", () => {
      const ent = getArchetypeDefaults("enterprise")
      expect(ent.core.dialect?.oasVersion).toBe("3.2.0")
      expect(ent.core.contracts?.pureHandlers).toBe(true)
      expect(ent.core.client?.wireFormatSafety).toBe(true)
      expect(ent.core.typegen?.resolveSymbolCycles).toBe(true)
      expect(ent.core.gates?.driftCheck).toBe(true)
      expect(ent.core.gates?.failOnBreaking).toBe(true)
      expect(ent.core.gates?.baseRef).toBe("origin/main")
      expect(ent.core.gates?.preflightLint).toBe("error")
      expect(ent.product.jitSchema).toBe(true)
      expect(ent.product.zeroCopy).toBe(true)
      expect(ent.product.personas?.enforceCoverage).toBe(true)
      expect(ent.product.personas?.minCoverageRatio).toBe(0.8)
    })

    it("exposes all archetype, framework, and runtime constants", () => {
      expect(PRODUCT_LIFECYCLE_ARCHETYPES).toEqual(["mvp", "microservice", "enterprise"])
      expect(TARGET_FRAMEWORK_IDS).toEqual(["fastify", "elysia", "hono", "express", "nestjs", "generic"])
      expect(TARGET_RUNTIMES).toEqual(["node", "bun"])
    })
  })

  describe("9. Config Defaults Resolution (resolveConfigWithDefaults)", () => {
    it("resolves empty config to microservice archetype defaults", () => {
      const resolved = resolveConfigWithDefaults({})
      expect(resolved.archetype).toBe("microservice")
      expect(resolved.core!.dialect!.oasVersion).toBe("3.2.0")
      expect(resolved.core!.contracts!.pureHandlers).toBe(true)
      expect(resolved.core!.client!.wireFormatSafety).toBe(true)
      expect(resolved.core!.gates!.driftCheck).toBe(true)
      expect(resolved.product.jitSchema).toBe(true)
      expect(resolved.product.zeroCopy).toBe(true)
      expect(resolved.specs).toEqual([])
    })

    it("user configuration overrides take precedence over archetype defaults", () => {
      const config: OaConfig = {
        archetype: "mvp",
        core: {
          client: { wireFormatSafety: true },
          gates: { preflightLint: "error" },
        },
        product: {
          jitSchema: true,
        },
      }
      const resolved = resolveConfigWithDefaults(config)
      expect(resolved.archetype).toBe("mvp")
      expect(resolved.core!.client!.wireFormatSafety).toBe(true) // User override
      expect(resolved.core!.gates!.preflightLint).toBe("error") // User override
      expect(resolved.core!.gates!.driftCheck).toBe(false) // MVP default preserved
      expect(resolved.product.jitSchema).toBe(true) // User override
      expect(resolved.product.zeroCopy).toBe(false) // MVP default preserved
    })

    it("harmonizes root aliases into resolved product domain configuration", () => {
      const config: OaConfig = {
        framework: "fastify",
        runtime: "node",
        contextInjection: { typeName: "AppCtx", importPath: "./ctx.js" },
        personas: { enforceCoverage: true, minCoverageRatio: 0.85 },
      }
      const resolved = resolveConfigWithDefaults(config)
      expect(resolved.product.framework).toBe("fastify")
      expect(resolved.product.runtime).toBe("node")
      expect(resolved.product.contextInjection?.typeName).toBe("AppCtx")
      expect(resolved.product.personas?.minCoverageRatio).toBe(0.85)
    })
  })

  describe("10. 3-Stage Lifecycle Evolution Walkthrough (MVP -> Microservice -> Enterprise)", () => {
    it("evolves seamlessly across 3 product lifecycle stages without contract breakage", () => {
      const sharedSpecs: ProfileTargetConfig[] = [
        {
          id: "order-service",
          schemaEntry: "./src/schemas/orders.ts",
          outDir: "./src/generated/orders",
        },
      ]

      // Stage 1: Day 1 MVP (Rapid live mock prototyping)
      const day1Mvp: OaConfig = {
        archetype: "mvp",
        product: {
          framework: "hono",
          specs: sharedSpecs,
        },
      }
      const res1 = resolveConfigWithDefaults(day1Mvp)
      expect(res1.archetype).toBe("mvp")
      expect(res1.core!.contracts!.pureHandlers).toBe(true)
      expect(res1.core!.client!.wireFormatSafety).toBe(false)
      expect(res1.core!.gates!.failOnBreaking).toBe(false)
      expect(res1.core!.gates!.preflightLint).toBe("warn")
      expect(res1.specs![0]!.profile).toBe("full-api-document")

      // Stage 2: Day 60 Microservice (Switch to Fastify for JIT acceleration, wire typing)
      const day60Ms: OaConfig = {
        archetype: "microservice",
        product: {
          framework: "fastify",
          contextInjection: {
            typeName: "RequestContext",
            importPath: "./src/context.js",
          },
          specs: sharedSpecs,
        },
      }
      const res2 = resolveConfigWithDefaults(day60Ms)
      expect(res2.archetype).toBe("microservice")
      expect(res2.core!.contracts!.pureHandlers).toBe(true) // SSOT INVARIANT PRESERVED
      expect(res2.core!.client!.wireFormatSafety).toBe(true)
      expect(res2.core!.gates!.driftCheck).toBe(true)
      expect(res2.product.framework).toBe("fastify")
      expect(res2.product.jitSchema).toBe(true)
      expect(res2.product.contextInjection?.typeName).toBe("RequestContext")
      expect(res2.specs![0]!.id).toBe("order-service") // Identical spec target

      // Stage 3: Day 180 Enterprise (Semantic breaking change CI gate and persona governance)
      const day180Ent: OaConfig = {
        archetype: "enterprise",
        product: {
          framework: "fastify",
          contextInjection: {
            typeName: "RequestContext",
            importPath: "./src/context.js",
          },
          personas: {
            registryPath: "./personas/registry.yaml",
            enforceCoverage: true,
            minCoverageRatio: 0.9,
          },
          specs: sharedSpecs,
        },
      }
      const res3 = resolveConfigWithDefaults(day180Ent)
      expect(res3.archetype).toBe("enterprise")
      expect(res3.core!.contracts!.pureHandlers).toBe(true) // SSOT INVARIANT PRESERVED
      expect(res3.core!.gates!.failOnBreaking).toBe(true) // Breaking change gate enabled
      expect(res3.core!.gates!.baseRef).toBe("origin/main")
      expect(res3.product.personas?.enforceCoverage).toBe(true)
      expect(res3.product.personas?.minCoverageRatio).toBe(0.9)
      expect(res3.specs![0]!.id).toBe("order-service") // Identical spec target
    })
  })

  describe("11. Harmonized ProfileTargetConfig (target & default profile)", () => {
    it("accepts target emitted by oa-gen init with target: fastify and omitted profile", () => {
      const initTarget = {
        specs: [
          {
            id: "fastify-api",
            target: "fastify" as const,
            schemaEntry: "src/schemas.ts",
            outDir: "src/generated",
          },
        ],
      }
      expect(isOaConfig(initTarget)).toBe(true)
      const res = resolveConfigWithDefaults(initTarget)
      expect(res.specs![0]!.target).toBe("fastify")
      expect(res.specs![0]!.profile).toBe("full-api-document")
    })

    it("rejects target when both profile and target are missing", () => {
      const missingBoth = {
        specs: [{ id: "minimal-api", schemaEntry: "spec.yaml", outDir: "out" }],
      }
      const val = validateOaConfig(missingBoth)
      expect(val.valid).toBe(false)
      expect(val.errors.find((e) => e.path === "specs[0].profile")?.message).toContain(
        "profile is required and must be one of: 'component-bundle', 'operation-contract', 'full-api-document'",
      )
    })

    it("rejects invalid target framework identifier", () => {
      const invalid = {
        specs: [{ id: "api", target: "invalid-framework", schemaEntry: "spec.yaml", outDir: "out" }],
      }
      const result = validateOaConfig(invalid)
      expect(result.valid).toBe(false)
      expect(result.errors.find((e) => e.path === "specs[0].target")?.message).toContain(
        "target must be one of: 'fastify', 'elysia', 'hono', 'express', 'nestjs', 'generic'",
      )
    })
  })

  describe("12. Product Context Injection & Persona Governance Validation Diagnostics", () => {
    it("rejects missing typeName in contextInjection", () => {
      const invalid = {
        contextInjection: { importPath: "./ctx.js" },
      }
      const res = validateOaConfig(invalid)
      expect(res.valid).toBe(false)
      expect(res.errors.find((e) => e.path === "contextInjection.typeName")?.message).toContain(
        "contextInjection.typeName is required",
      )
    })

    it("rejects missing importPath in contextInjection", () => {
      const invalid = {
        contextInjection: { typeName: "AppContext" },
      }
      const res = validateOaConfig(invalid)
      expect(res.valid).toBe(false)
      expect(res.errors.find((e) => e.path === "contextInjection.importPath")?.message).toContain(
        "contextInjection.importPath is required",
      )
    })

    it("rejects out-of-range minCoverageRatio in personas (> 1.0 or < 0.0)", () => {
      const high = { personas: { minCoverageRatio: 1.5 } }
      const resHigh = validateOaConfig(high)
      expect(resHigh.valid).toBe(false)
      expect(resHigh.errors.find((e) => e.path === "personas.minCoverageRatio")?.message).toContain(
        "minCoverageRatio must be a number between 0.0 and 1.0",
      )

      const negative = { personas: { minCoverageRatio: -0.2 } }
      const resNeg = validateOaConfig(negative)
      expect(resNeg.valid).toBe(false)
      expect(resNeg.errors.find((e) => e.path === "personas.minCoverageRatio")?.message).toContain(
        "minCoverageRatio must be a number between 0.0 and 1.0",
      )
    })

    it("validates invalid archetype and invalid core options with precise diagnostic paths", () => {
      const badArch = { archetype: "unknown-stage" }
      const resArch = validateOaConfig(badArch)
      expect(resArch.valid).toBe(false)
      expect(resArch.errors.find((e) => e.path === "archetype")?.message).toContain(
        "archetype must be one of: 'mvp', 'microservice', 'enterprise'",
      )

      const badCore = { core: { dialect: { oasVersion: "3.0.0" } } }
      const resCore = validateOaConfig(badCore)
      expect(resCore.valid).toBe(false)
      expect(resCore.errors.find((e) => e.path === "core.dialect.oasVersion")?.message).toBe(
        "oasVersion must be '3.2.0' or '3.1.0'",
      )

      const badLint = { core: { gates: { preflightLint: "fatal" } } }
      const resLint = validateOaConfig(badLint)
      expect(resLint.valid).toBe(false)
      expect(resLint.errors.find((e) => e.path === "core.gates.preflightLint")?.message).toBe(
        "preflightLint must be 'off', 'warn', or 'error'",
      )
    })
  })

  describe("13. Dual-Layer Duplicate Target ID Collisions (Cross-Layer Deduplication)", () => {
    it("detects duplicate target ID between root specs and product.specs in procedural validation", () => {
      const crossDuplicate = {
        specs: [
          { id: "shared-api", schemaEntry: "src/spec1.yaml", outDir: "out1" },
        ],
        product: {
          specs: [
            { id: "shared-api", schemaEntry: "src/spec2.yaml", outDir: "out2" },
          ],
        },
      }
      const res = validateOaConfig(crossDuplicate)
      expect(res.valid).toBe(false)
      expect(res.errors.some((e) => e.path === "product.specs[0].id")).toBe(true)
      expect(res.errors.find((e) => e.path === "product.specs[0].id")?.message).toContain(
        'Duplicate spec target id "shared-api"',
      )
      expect(() => assertOaConfig(crossDuplicate)).toThrow(OaConfigError)
    })

    it("oaConfigSchema superRefine catches cross-layer duplicate target IDs", () => {
      const crossDuplicate = {
        specs: [{ id: "collab-api", schemaEntry: "spec.yaml", outDir: "out" }],
        product: {
          specs: [{ id: "collab-api", schemaEntry: "spec.yaml", outDir: "out" }],
        },
      }
      const parsed = oaConfigSchema.safeParse(crossDuplicate)
      expect(parsed.success).toBe(false)
      if (!parsed.success) {
        expect(parsed.error.issues.some((i) => i.path.join(".") === "product.specs.0.id")).toBe(true)
        expect(parsed.error.issues.find((i) => i.path.join(".") === "product.specs.0.id")?.message).toContain(
          'Duplicate spec target id "collab-api"',
        )
      }
    })
  })
})
