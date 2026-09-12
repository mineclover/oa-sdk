/**
 * @oa-sdk/codegen — Tier 5 Adversarial White-Box Stress Testing Suite
 *
 * Exhaustively stress-tests:
 * 1. Dual-layer configuration schema (packages/codegen/src/config.ts):
 *    - Deep validation edge cases, malformed nested structures, prototype poisoning / null-prototype objects,
 *      invalid enums, non-string keys, out-of-range numbers, duplicate target IDs within & across layers,
 *      missing properties, and default resolutions (getArchetypeDefaults, resolveConfigWithDefaults).
 * 2. Archetype engine & orthogonal composer (packages/codegen/src/cli/lib/init/ and composer.ts):
 *    - 6x3 = 18 composition matrix across all 6 framework targets and 3 lifecycle archetypes.
 *    - Strict Bun vs Node runtime isolation: assert 0 @types/node, 0 tsx, 0 vitest, 0 nodemon in Bun projects.
 *    - Script sanitization (vitest -> bun test, oa-gen -> bun x oa-gen).
 * 3. CLI --archetype flag parsing and error handling (CliExitError(1)).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as path from "node:path"
import * as fs from "node:fs/promises"
import * as os from "node:os"
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
  type ProductLifecycleArchetype,
  type TargetFrameworkId,
  type TargetRuntime,
} from "../config.js"
import {
  composeInitConfig,
  composeInitScripts,
  composeInitDependencies,
  composeInitPackagePatches,
} from "../cli/lib/init/composer.js"
import {
  getArchetypeProfile,
  ARCHETYPE_PROFILES,
  MvpArchetypeProfile,
  MicroserviceArchetypeProfile,
  EnterpriseArchetypeProfile,
} from "../cli/lib/init/archetypes/index.js"
import { TARGET_PROFILES, getTargetProfile } from "../cli/lib/init/targets/index.js"
import { init } from "../cli/commands/init.js"
import { CliExitError } from "../cli/lib/errors.js"

// ============================================================================
// SUITE 1: Dual-Layer Configuration Schema Deep Validation & Edge Cases
// ============================================================================

describe("Tier 5 Adversarial: Dual-Layer Configuration Schema (config.ts)", () => {
  describe("1.1 Primitive & Malformed Root Inputs", () => {
    it.each([
      [null, "null"],
      [undefined, "undefined"],
      [42, "number"],
      ["invalid string", "string"],
      [true, "boolean"],
      [Symbol("test"), "symbol"],
      [() => {}, "function"],
      [[], "array"],
    ])("rejects non-object root value: %s (%s)", (input: any, _type?: string) => {
      const res = validateOaConfig(input)
      expect(res.valid).toBe(false)
      expect(res.errors.length).toBeGreaterThan(0)
      expect(res.errors[0]?.message).toContain("Configuration must be a non-null object")
      expect(isOaConfig(input)).toBe(false)
      expect(() => assertOaConfig(input)).toThrow(OaConfigError)
    })

    it("accepts object created with Object.create(null)", () => {
      const nullProto = Object.create(null)
      nullProto.rootDir = "."
      const res = validateOaConfig(nullProto)
      expect(res.valid).toBe(true)
    })

    it("handles prototype poisoning defensively without prototype property pollution", () => {
      const poisoned = JSON.parse('{"__proto__":{"polluted":true},"rootDir":"."}')
      const res = validateOaConfig(poisoned)
      expect(res.valid).toBe(true)
      expect(({} as any).polluted).toBeUndefined()
    })
  })

  describe("1.2 rootDir Boundaries", () => {
    it.each([
      ["", "empty string"],
      ["   ", "whitespace-only"],
      ["\t\n  \r", "control whitespace"],
      [123 as any, "number"],
      [false as any, "boolean"],
      [[] as any, "array"],
      [{} as any, "object"],
    ])("rejects invalid rootDir: %s (%s)", (val) => {
      const res = validateOaConfig({ rootDir: val })
      expect(res.valid).toBe(false)
      expect(res.errors.some((e) => e.path === "rootDir")).toBe(true)
    })

    it.each([".", "./packages/api", "/var/projects/oa-app", "../relative"])("accepts valid rootDir: %s", (dir) => {
      const res = validateOaConfig({ rootDir: dir })
      expect(res.valid).toBe(true)
    })
  })

  describe("1.3 archetype Enum Boundaries & Case Mismatches", () => {
    it.each([
      "monolith",
      "serverless",
      "MVP",
      "Microservice",
      "ENTERPRISE",
      "mvp ",
      " microservice",
      "mvp\0",
      "production",
      "staging",
      "",
    ])("rejects non-canonical archetype string: %j", (archetype) => {
      const res = validateOaConfig({ archetype })
      expect(res.valid).toBe(false)
      expect(res.errors.some((e) => e.path === "archetype")).toBe(true)
      expect(isOaConfig({ archetype })).toBe(false)
    })

    it.each([123, true, false, [], {}])("rejects non-string archetype types: %j", (archetype) => {
      const res = validateOaConfig({ archetype })
      expect(res.valid).toBe(false)
      expect(res.errors.some((e) => e.path === "archetype")).toBe(true)
    })

    it.each(PRODUCT_LIFECYCLE_ARCHETYPES)("accepts valid canonical archetype: %s", (archetype) => {
      const res = validateOaConfig({ archetype })
      expect(res.valid).toBe(true)
    })
  })

  describe("1.4 Shared Platform Core (core.*) Deep Validation", () => {
    it("rejects non-object core value (string, array, number, null)", () => {
      expect(validateOaConfig({ core: "core" as any }).errors.some((e) => e.path === "core")).toBe(true)
      expect(validateOaConfig({ core: [] as any }).errors.some((e) => e.path === "core")).toBe(true)
      expect(validateOaConfig({ core: 123 as any }).errors.some((e) => e.path === "core")).toBe(true)
      expect(validateOaConfig({ core: null as any }).errors.some((e) => e.path === "core")).toBe(true)
    })

    describe("core.dialect", () => {
      it("rejects non-object dialect", () => {
        const res = validateOaConfig({ core: { dialect: "3.2.0" as any } })
        expect(res.errors.some((e) => e.path === "core.dialect")).toBe(true)
      })

      it.each(["3.0.0", "3.0.3", "2.0", "3.3.0", "3.2", "v3.2.0", ""])("rejects invalid oasVersion: %j", (v) => {
        const res = validateOaConfig({ core: { dialect: { oasVersion: v as any } } })
        expect(res.errors.some((e) => e.path === "core.dialect.oasVersion")).toBe(true)
      })

      it.each(["3.2.0", "3.1.0"] as const)("accepts valid oasVersion: %s", (oasVersion) => {
        const res = validateOaConfig({ core: { dialect: { oasVersion } } })
        expect(res.valid).toBe(true)
      })

      it.each(["draft-07", "draft-04", "draft-2019-09", "2020-12", ""])("rejects invalid jsonSchemaDialect: %j", (d) => {
        const res = validateOaConfig({ core: { dialect: { jsonSchemaDialect: d as any } } })
        expect(res.errors.some((e) => e.path === "core.dialect.jsonSchemaDialect")).toBe(true)
      })

      it("accepts valid jsonSchemaDialect draft-2020-12", () => {
        const res = validateOaConfig({ core: { dialect: { jsonSchemaDialect: "draft-2020-12" } } })
        expect(res.valid).toBe(true)
      })

      it.each(["true", 1, 0, null, []])("rejects non-boolean canonicalProjection: %j", (cp) => {
        const res = validateOaConfig({ core: { dialect: { canonicalProjection: cp as any } } })
        expect(res.errors.some((e) => e.path === "core.dialect.canonicalProjection")).toBe(true)
      })
    })

    describe("core.contracts", () => {
      it.each(["true", 1, null, []])("rejects non-boolean pureHandlers: %j", (ph) => {
        const res = validateOaConfig({ core: { contracts: { pureHandlers: ph as any } } })
        expect(res.errors.some((e) => e.path === "core.contracts.pureHandlers")).toBe(true)
      })

      it.each(["", "   ", 123, null])("rejects invalid contractName: %j", (cn) => {
        const res = validateOaConfig({ core: { contracts: { contractName: cn as any } } })
        expect(res.errors.some((e) => e.path === "core.contracts.contractName")).toBe(true)
      })

      it.each(["", "  ", null])("rejects invalid namingPattern: %j", (np) => {
        const res = validateOaConfig({ core: { contracts: { namingPattern: np as any } } })
        expect(res.errors.some((e) => e.path === "core.contracts.namingPattern")).toBe(true)
      })

      it.each(["", "  ", null])("rejects invalid outDir: %j", (od) => {
        const res = validateOaConfig({ core: { contracts: { outDir: od as any } } })
        expect(res.errors.some((e) => e.path === "core.contracts.outDir")).toBe(true)
      })

      it.each(["yes", 1, null])("rejects non-boolean banner: %j", (b) => {
        const res = validateOaConfig({ core: { contracts: { banner: b as any } } })
        expect(res.errors.some((e) => e.path === "core.contracts.banner")).toBe(true)
      })
    })

    describe("core.client", () => {
      it.each([1, "true", null])("rejects non-boolean enabled: %j", (en) => {
        const res = validateOaConfig({ core: { client: { enabled: en as any } } })
        expect(res.errors.some((e) => e.path === "core.client.enabled")).toBe(true)
      })

      it.each([1, "false", null])("rejects non-boolean wireFormatSafety: %j", (wf) => {
        const res = validateOaConfig({ core: { client: { wireFormatSafety: wf as any } } })
        expect(res.errors.some((e) => e.path === "core.client.wireFormatSafety")).toBe(true)
      })

      it.each(["", "   ", 42])("rejects invalid outDir: %j", (od) => {
        const res = validateOaConfig({ core: { client: { outDir: od as any } } })
        expect(res.errors.some((e) => e.path === "core.client.outDir")).toBe(true)
      })
    })

    describe("core.typegen", () => {
      it.each([1, "true"])("rejects non-boolean resolveSymbolCycles: %j", (sc) => {
        const res = validateOaConfig({ core: { typegen: { resolveSymbolCycles: sc as any } } })
        expect(res.errors.some((e) => e.path === "core.typegen.resolveSymbolCycles")).toBe(true)
      })

      it.each([1, "false"])("rejects non-boolean discriminatedUnions: %j", (du) => {
        const res = validateOaConfig({ core: { typegen: { discriminatedUnions: du as any } } })
        expect(res.errors.some((e) => e.path === "core.typegen.discriminatedUnions")).toBe(true)
      })

      it.each(["ajv", "valibot", "joi", "yup", "typebox", ""])("rejects unsupported targetAdapter: %j", (ta) => {
        const res = validateOaConfig({ core: { typegen: { targetAdapter: ta as any } } })
        expect(res.errors.some((e) => e.path === "core.typegen.targetAdapter")).toBe(true)
      })

      it.each(["ts", "zod", "typia"] as const)("accepts valid targetAdapter: %s", (targetAdapter) => {
        const res = validateOaConfig({ core: { typegen: { targetAdapter } } })
        expect(res.valid).toBe(true)
      })
    })

    describe("core.gates", () => {
      it.each(["yes", 1])("rejects non-boolean driftCheck: %j", (dc) => {
        const res = validateOaConfig({ core: { gates: { driftCheck: dc as any } } })
        expect(res.errors.some((e) => e.path === "core.gates.driftCheck")).toBe(true)
      })

      it.each(["no", 0])("rejects non-boolean failOnBreaking: %j", (fb) => {
        const res = validateOaConfig({ core: { gates: { failOnBreaking: fb as any } } })
        expect(res.errors.some((e) => e.path === "core.gates.failOnBreaking")).toBe(true)
      })

      it.each(["", "   ", null])("rejects invalid baseRef: %j", (br) => {
        const res = validateOaConfig({ core: { gates: { baseRef: br as any } } })
        expect(res.errors.some((e) => e.path === "core.gates.baseRef")).toBe(true)
      })

      it.each(["strict", "fatal", "none", "all", ""])("rejects invalid preflightLint: %j", (pl) => {
        const res = validateOaConfig({ core: { gates: { preflightLint: pl as any } } })
        expect(res.errors.some((e) => e.path === "core.gates.preflightLint")).toBe(true)
      })

      it.each(["off", "warn", "error"] as const)("accepts valid preflightLint: %s", (preflightLint) => {
        const res = validateOaConfig({ core: { gates: { preflightLint } } })
        expect(res.valid).toBe(true)
      })
    })
  })

  describe("1.5 Product Domain Layer (product.*) Deep Validation", () => {
    it("rejects non-object product", () => {
      expect(validateOaConfig({ product: "prod" as any }).errors.some((e) => e.path === "product")).toBe(true)
      expect(validateOaConfig({ product: [] as any }).errors.some((e) => e.path === "product")).toBe(true)
      expect(validateOaConfig({ product: null as any }).errors.some((e) => e.path === "product")).toBe(true)
    })

    it.each(["koa", "django", "spring", "flask", ""])("rejects invalid framework: %j", (framework) => {
      const res = validateOaConfig({ product: { framework: framework as any } } as any)
      expect(res.errors.some((e) => e.path === "product.framework")).toBe(true)
    })

    it.each(TARGET_FRAMEWORK_IDS)("accepts valid framework: %s", (framework) => {
      const res = validateOaConfig({ product: { framework } })
      expect(res.valid).toBe(true)
    })

    it.each(["deno", "python", "wasm", "browser", ""])("rejects invalid runtime: %j", (runtime) => {
      const res = validateOaConfig({ product: { runtime: runtime as any } } as any)
      expect(res.errors.some((e) => e.path === "product.runtime")).toBe(true)
    })

    it.each(TARGET_RUNTIMES)("accepts valid runtime: %s", (runtime) => {
      const res = validateOaConfig({ product: { runtime } })
      expect(res.valid).toBe(true)
    })

    it.each(["true", 1, null])("rejects non-boolean jitSchema: %j", (js) => {
      const res = validateOaConfig({ product: { jitSchema: js as any } })
      expect(res.errors.some((e) => e.path === "product.jitSchema")).toBe(true)
    })

    it.each(["false", 0, null])("rejects non-boolean zeroCopy: %j", (zc) => {
      const res = validateOaConfig({ product: { zeroCopy: zc as any } })
      expect(res.errors.some((e) => e.path === "product.zeroCopy")).toBe(true)
    })

    describe("product.guards", () => {
      it("rejects non-object guards", () => {
        const res = validateOaConfig({ product: { guards: "dist" as any } })
        expect(res.errors.some((e) => e.path === "product.guards")).toBe(true)
      })

      it.each(["", "   ", null])("rejects missing/empty outDir in guards: %j", (od) => {
        const res = validateOaConfig({ product: { guards: { outDir: od as any } } })
        expect(res.errors.some((e) => e.path === "product.guards.outDir")).toBe(true)
      })

      it.each(["umd", "amd", "systemjs", ""])("rejects invalid moduleFormat: %j", (mf) => {
        const res = validateOaConfig({ product: { guards: { outDir: "dist", moduleFormat: mf as any } } })
        expect(res.errors.some((e) => e.path === "product.guards.moduleFormat")).toBe(true)
      })

      it.each(["esm", "cjs"] as const)("accepts valid moduleFormat: %s", (moduleFormat) => {
        const res = validateOaConfig({ product: { guards: { outDir: "dist", moduleFormat } } })
        expect(res.valid).toBe(true)
      })
    })

    describe("product.contextInjection", () => {
      it("rejects non-object contextInjection", () => {
        const res = validateOaConfig({ product: { contextInjection: "AppCtx" as any } })
        expect(res.errors.some((e) => e.path === "product.contextInjection")).toBe(true)
      })

      it.each(["", "  ", null, undefined])("rejects missing/empty typeName: %j", (tn) => {
        const res = validateOaConfig({ product: { contextInjection: { typeName: tn as any, importPath: "./ctx.js" } } })
        expect(res.errors.some((e) => e.path === "product.contextInjection.typeName")).toBe(true)
      })

      it.each(["", "  ", null, undefined])("rejects missing/empty importPath: %j", (ip) => {
        const res = validateOaConfig({ product: { contextInjection: { typeName: "AppCtx", importPath: ip as any } } })
        expect(res.errors.some((e) => e.path === "product.contextInjection.importPath")).toBe(true)
      })

      it.each(["", "  "])("rejects empty propertyKey: %j", (pk) => {
        const res = validateOaConfig({
          product: { contextInjection: { typeName: "AppCtx", importPath: "./ctx.js", propertyKey: pk } },
        })
        expect(res.errors.some((e) => e.path === "product.contextInjection.propertyKey")).toBe(true)
      })

      it.each([
        [["user", 123]],
        [["tenant", ""]],
        [["trace", "   "]],
        ["not-array"],
      ])("rejects invalid fields list: %j", (fields) => {
        const res = validateOaConfig({
          product: { contextInjection: { typeName: "AppCtx", importPath: "./ctx.js", fields: fields as any } },
        })
        expect(res.errors.some((e) => e.path === "product.contextInjection.fields")).toBe(true)
      })

      it("accepts valid contextInjection configuration", () => {
        const res = validateOaConfig({
          product: {
            contextInjection: {
              typeName: "RequestContext",
              importPath: "@org/context",
              propertyKey: "ctx",
              fields: ["tenantId", "user", "db"],
            },
          },
        })
        expect(res.valid).toBe(true)
      })
    })

    describe("product.personas", () => {
      it.each(["", "   "])("rejects empty registryPath: %j", (rp) => {
        const res = validateOaConfig({ product: { personas: { registryPath: rp } } })
        expect(res.errors.some((e) => e.path === "product.personas.registryPath")).toBe(true)
      })

      it.each([
        [["admin", 1]],
        [["user", ""]],
        ["not-an-array"],
      ])("rejects invalid requiredTraits: %j", (rt) => {
        const res = validateOaConfig({ product: { personas: { requiredTraits: rt as any } } })
        expect(res.errors.some((e) => e.path === "product.personas.requiredTraits")).toBe(true)
      })

      it.each(["yes", 1])("rejects non-boolean enforceCoverage: %j", (ec) => {
        const res = validateOaConfig({ product: { personas: { enforceCoverage: ec as any } } })
        expect(res.errors.some((e) => e.path === "product.personas.enforceCoverage")).toBe(true)
      })

      it.each([-0.01, -1, 1.01, 2, 100, NaN, Infinity, -Infinity, "0.8" as any])(
        "rejects out-of-range or non-numeric minCoverageRatio: %j",
        (ratio) => {
          const res = validateOaConfig({ product: { personas: { minCoverageRatio: ratio } } })
          expect(res.errors.some((e) => e.path === "product.personas.minCoverageRatio")).toBe(true)
        },
      )

      it.each([0.0, 0.5, 0.8, 1.0])("accepts valid minCoverageRatio boundary: %d", (minCoverageRatio) => {
        const res = validateOaConfig({ product: { personas: { minCoverageRatio } } })
        expect(res.valid).toBe(true)
      })
    })

    describe("product.security", () => {
      it("rejects non-object security", () => {
        const res = validateOaConfig({ product: { security: "bearerAuth" as any } })
        expect(res.errors.some((e) => e.path === "product.security")).toBe(true)
      })

      it("rejects non-object schemes map", () => {
        const res = validateOaConfig({ product: { security: { schemes: [] as any } } })
        expect(res.errors.some((e) => e.path === "product.security.schemes")).toBe(true)
      })

      it.each(["basic", "jwt", "saml", "hawk", ""])("rejects unsupported scheme type: %j", (type) => {
        const res = validateOaConfig({ product: { security: { schemes: { auth: { type: type as any } } } } })
        expect(res.errors.some((e) => e.path === "product.security.schemes.auth.type")).toBe(true)
      })

      it.each(["body", "path", "uri", ""])("rejects invalid security in location: %j", (loc) => {
        const res = validateOaConfig({
          product: { security: { schemes: { key: { type: "apiKey", in: loc as any } } } },
        })
        expect(res.errors.some((e) => e.path === "product.security.schemes.key.in")).toBe(true)
      })

      it("rejects non-array defaultRequirement", () => {
        const res = validateOaConfig({ product: { security: { defaultRequirement: {} as any } } })
        expect(res.errors.some((e) => e.path === "product.security.defaultRequirement")).toBe(true)
      })

      it("accepts valid security scheme and defaultRequirement", () => {
        const res = validateOaConfig({
          product: {
            security: {
              schemes: {
                bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
                apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
              },
              defaultRequirement: [{ bearerAuth: [] }],
            },
          },
        })
        expect(res.valid).toBe(true)
      })
    })
  })

  describe("1.6 Spec Target Validation & Profile Defaulting", () => {
    it("rejects non-array specs", () => {
      expect(validateOaConfig({ specs: {} as any }).errors.some((e) => e.path === "specs")).toBe(true)
      expect(validateOaConfig({ product: { specs: {} as any } }).errors.some((e) => e.path === "product.specs")).toBe(true)
    })

    it("rejects non-object spec items", () => {
      const res = validateOaConfig({ specs: [null, "item", 42] as any })
      expect(res.errors.length).toBeGreaterThanOrEqual(3)
    })

    it.each(["", "   ", null, undefined])("rejects missing/empty spec id: %j", (id) => {
      const res = validateOaConfig({
        specs: [{ id: id as any, schemaEntry: "openapi.yaml", outDir: "dist", target: "fastify" }],
      })
      expect(res.errors.some((e) => e.path === "specs[0].id")).toBe(true)
    })

    it("rejects spec omitting BOTH profile and target", () => {
      const res = validateOaConfig({
        specs: [{ id: "api", schemaEntry: "openapi.yaml", outDir: "dist" }],
      })
      expect(res.valid).toBe(false)
      expect(res.errors.some((e) => e.path === "specs[0].profile")).toBe(true)
      expect(res.errors.find((e) => e.path === "specs[0].profile")?.message).toContain(
        "profile is required and must be one of",
      )
    })

    it("accepts spec omitting profile when target is explicitly provided (harmonized profile defaulting)", () => {
      const res = validateOaConfig({
        specs: [{ id: "fastify-svc", schemaEntry: "openapi.yaml", outDir: "dist", target: "fastify" }],
      })
      expect(res.valid).toBe(true)
      expect(res.errors).toEqual([])
    })

    it.each(["unknown-profile", "bundle", "operations", "single-doc", ""])("rejects invalid profile enum: %j", (p) => {
      const res = validateOaConfig({
        specs: [{ id: "api", profile: p as any, schemaEntry: "openapi.yaml", outDir: "dist" }],
      })
      expect(res.errors.some((e) => e.path === "specs[0].profile")).toBe(true)
    })

    it.each(OPENAPI_PROJECTION_PROFILES)("accepts valid projection profile: %s", (profile) => {
      const res = validateOaConfig({
        specs: [{ id: "api", profile, schemaEntry: "openapi.yaml", outDir: "dist" }],
      })
      expect(res.valid).toBe(true)
    })

    it.each(["", "   ", null, undefined])("rejects missing/empty schemaEntry: %j", (entry) => {
      const res = validateOaConfig({
        specs: [{ id: "api", profile: "full-api-document", schemaEntry: entry as any, outDir: "dist" }],
      })
      expect(res.errors.some((e) => e.path === "specs[0].schemaEntry")).toBe(true)
    })

    it.each(["", "   ", null, undefined])("rejects missing/empty outDir: %j", (outDir) => {
      const res = validateOaConfig({
        specs: [{ id: "api", profile: "full-api-document", schemaEntry: "openapi.yaml", outDir: outDir as any }],
      })
      expect(res.errors.some((e) => e.path === "specs[0].outDir")).toBe(true)
    })

    it.each(["", "   "])("rejects empty title or version when provided: %j", (empty) => {
      const res = validateOaConfig({
        specs: [{ id: "api", profile: "full-api-document", schemaEntry: "openapi.yaml", outDir: "dist", title: empty, version: empty }],
      })
      expect(res.errors.some((e) => e.path === "specs[0].title")).toBe(true)
      expect(res.errors.some((e) => e.path === "specs[0].version")).toBe(true)
    })

    it.each([
      [["tag1", 123]],
      [["tag1", ""]],
      [["tag1", "   "]],
      ["not-array"],
    ])("rejects invalid tags list in spec: %j", (tags) => {
      const res = validateOaConfig({
        specs: [{ id: "api", profile: "full-api-document", schemaEntry: "openapi.yaml", outDir: "dist", tags: tags as any }],
      })
      expect(res.errors.some((e) => e.path === "specs[0].tags")).toBe(true)
    })
  })

  describe("1.7 Duplicate Target ID Collisions (Within & Across Layers)", () => {
    it("detects duplicate target IDs within top-level specs", () => {
      const res = validateOaConfig({
        specs: [
          { id: "users-api", profile: "full-api-document", schemaEntry: "users.yaml", outDir: "dist" },
          { id: "orders-api", profile: "full-api-document", schemaEntry: "orders.yaml", outDir: "dist" },
          { id: "users-api", profile: "full-api-document", schemaEntry: "users-v2.yaml", outDir: "dist" },
        ],
      })
      expect(res.valid).toBe(false)
      const dup = res.errors.find((e) => e.path === "specs[2].id")
      expect(dup).toBeDefined()
      expect(dup?.message).toContain('Duplicate spec target id "users-api" at index 2 (already declared at index 0)')
    })

    it("detects duplicate target IDs within product.specs", () => {
      const res = validateOaConfig({
        product: {
          specs: [
            { id: "auth-api", target: "fastify", schemaEntry: "auth.yaml", outDir: "dist" },
            { id: "auth-api", target: "elysia", schemaEntry: "auth2.yaml", outDir: "dist" },
          ],
        },
      })
      expect(res.valid).toBe(false)
      const dup = res.errors.find((e) => e.path === "product.specs[1].id")
      expect(dup).toBeDefined()
      expect(dup?.message).toContain('Duplicate spec target id "auth-api" at index 1 (already declared at index 0)')
    })

    it("detects duplicate target IDs cross-layer (specs vs product.specs)", () => {
      const res = validateOaConfig({
        specs: [
          { id: "shared-core-api", profile: "full-api-document", schemaEntry: "core.yaml", outDir: "dist" },
        ],
        product: {
          specs: [
            { id: "unique-sub-api", target: "express", schemaEntry: "sub.yaml", outDir: "dist" },
            { id: "shared-core-api", target: "hono", schemaEntry: "duplicate.yaml", outDir: "dist" },
          ],
        },
      })
      expect(res.valid).toBe(false)
      const dup = res.errors.find((e) => e.path === "product.specs[1].id")
      expect(dup).toBeDefined()
      expect(dup?.message).toContain('Duplicate spec target id "shared-core-api" at index 2 (already declared at index 0)')
    })

    it("passes when all spec IDs across both layers are strictly unique", () => {
      const res = validateOaConfig({
        specs: [
          { id: "spec-layer-1", profile: "full-api-document", schemaEntry: "core.yaml", outDir: "dist" },
        ],
        product: {
          specs: [
            { id: "prod-layer-2", target: "express", schemaEntry: "sub.yaml", outDir: "dist" },
            { id: "prod-layer-3", target: "fastify", schemaEntry: "fast.yaml", outDir: "dist" },
          ],
        },
      })
      expect(res.valid).toBe(true)
      expect(res.errors).toEqual([])
    })

    it("oaConfigSchema (Zod superRefine) detects duplicate target IDs", () => {
      const parsed = oaConfigSchema.safeParse({
        specs: [
          { id: "dup-id", profile: "full-api-document", schemaEntry: "s1.yaml", outDir: "dist" },
          { id: "dup-id", profile: "full-api-document", schemaEntry: "s2.yaml", outDir: "dist" },
        ],
      })
      expect(parsed.success).toBe(false)
      if (!parsed.success) {
        expect(parsed.error.issues.some((i) => i.message.includes('Duplicate spec target id "dup-id"'))).toBe(true)
      }
    })
  })

  describe("1.8 Top-Level Aliases & Legacy Options Compatibility", () => {
    it("validates top-level aliases identically to nested product options", () => {
      const validConfig: OaConfig = {
        framework: "fastify",
        runtime: "node",
        guards: { outDir: "dist/guards", split: true, moduleFormat: "esm", auditCsp: true },
        contextInjection: { typeName: "AppCtx", importPath: "./ctx.js", propertyKey: "app", fields: ["u"] },
        personas: { registryPath: "personas.yaml", requiredTraits: ["read"], enforceCoverage: true, minCoverageRatio: 0.9 },
        security: { schemes: { bearer: { type: "http", scheme: "bearer" } } },
      }
      const res = validateOaConfig(validConfig)
      expect(res.valid).toBe(true)
    })

    it("reports invalid top-level aliases with path at root", () => {
      const invalidConfig = {
        framework: "unknown-fw",
        runtime: "unknown-rt",
        guards: { outDir: "" },
        contextInjection: { typeName: "", importPath: "" },
        personas: { minCoverageRatio: 5 },
        security: "invalid",
      }
      const res = validateOaConfig(invalidConfig)
      expect(res.valid).toBe(false)
      expect(res.errors.some((e) => e.path === "framework")).toBe(true)
      expect(res.errors.some((e) => e.path === "runtime")).toBe(true)
      expect(res.errors.some((e) => e.path === "guards.outDir")).toBe(true)
      expect(res.errors.some((e) => e.path === "contextInjection.typeName")).toBe(true)
      expect(res.errors.some((e) => e.path === "personas.minCoverageRatio")).toBe(true)
      expect(res.errors.some((e) => e.path === "security")).toBe(true)
    })

    it("validates legacy schemas map and grouping option", () => {
      expect(validateOaConfig({ schemas: "invalid" as any }).errors.some((e) => e.path === "schemas")).toBe(true)
      expect(validateOaConfig({ grouping: "invalid" as any }).errors.some((e) => e.path === "grouping")).toBe(true)
      expect(validateOaConfig({ grouping: "single" }).valid).toBe(true)
      expect(validateOaConfig({ grouping: "per-schema" }).valid).toBe(true)
    })
  })

  describe("1.9 assertOaConfig, isOaConfig, and defineConfig Ergonomics", () => {
    it("assertOaConfig throws OaConfigError with formatted list of errors", () => {
      let thrown: any
      try {
        assertOaConfig({
          archetype: "invalid",
          core: { dialect: { oasVersion: "2.0" as any } },
        })
      } catch (e) {
        thrown = e
      }
      expect(thrown).toBeInstanceOf(OaConfigError)
      expect(thrown.name).toBe("OaConfigError")
      expect(thrown.errors.length).toBe(2)
      expect(thrown.message).toContain("Invalid oa-gen configuration:")
      expect(thrown.message).toContain("- archetype:")
      expect(thrown.message).toContain("- core.dialect.oasVersion:")
    })

    it("isOaConfig acts as reliable type guard", () => {
      expect(isOaConfig({ rootDir: "." })).toBe(true)
      expect(isOaConfig({ archetype: "bad" })).toBe(false)
    })

    it("defineConfig returns the identical configuration object", () => {
      const cfg: OaConfig = { rootDir: ".", archetype: "mvp" }
      expect(defineConfig(cfg)).toBe(cfg)
    })
  })

  describe("1.10 Defaults Resolution & Archetype Harmonization", () => {
    it("getArchetypeDefaults returns canonical shapes for MVP, Microservice, and Enterprise", () => {
      const mvp = getArchetypeDefaults("mvp")
      expect(mvp.core.client?.wireFormatSafety).toBe(false)
      expect(mvp.core.typegen?.resolveSymbolCycles).toBe(false)
      expect(mvp.core.gates?.driftCheck).toBe(false)
      expect(mvp.core.gates?.failOnBreaking).toBe(false)
      expect(mvp.core.gates?.preflightLint).toBe("warn")
      expect(mvp.product.jitSchema).toBe(false)
      expect(mvp.product.zeroCopy).toBe(false)

      const ms = getArchetypeDefaults("microservice")
      expect(ms.core.client?.wireFormatSafety).toBe(true)
      expect(ms.core.typegen?.resolveSymbolCycles).toBe(true)
      expect(ms.core.gates?.driftCheck).toBe(true)
      expect(ms.core.gates?.failOnBreaking).toBe(false)
      expect(ms.core.gates?.preflightLint).toBe("error")
      expect(ms.product.jitSchema).toBe(true)
      expect(ms.product.zeroCopy).toBe(true)

      const ent = getArchetypeDefaults("enterprise")
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

    it("resolveConfigWithDefaults resolves empty config {} to Microservice defaults", () => {
      const resolved = resolveConfigWithDefaults({})
      expect(resolved.archetype).toBe("microservice")
      expect(resolved.core!.dialect!.oasVersion).toBe("3.2.0")
      expect(resolved.core!.dialect!.jsonSchemaDialect).toBe("draft-2020-12")
      expect(resolved.core!.dialect!.canonicalProjection).toBe(true)
      expect(resolved.core!.contracts!.pureHandlers).toBe(true)
      expect(resolved.core!.contracts!.contractName).toBe("ApiHandlers")
      expect(resolved.core!.contracts!.banner).toBe(true)
      expect(resolved.core!.client!.enabled).toBe(true)
      expect(resolved.core!.client!.wireFormatSafety).toBe(true)
      expect(resolved.core!.typegen!.resolveSymbolCycles).toBe(true)
      expect(resolved.core!.typegen!.discriminatedUnions).toBe(true)
      expect(resolved.core!.gates!.driftCheck).toBe(true)
      expect(resolved.core!.gates!.failOnBreaking).toBe(false)
      expect(resolved.core!.gates!.preflightLint).toBe("error")
      expect(resolved.product.archetype).toBe("microservice")
      expect(resolved.product.jitSchema).toBe(true)
      expect(resolved.product.zeroCopy).toBe(true)
      expect(resolved.specs).toEqual([])
    })

    it("resolveConfigWithDefaults respects top-level archetype override over nested product.archetype", () => {
      const resolved = resolveConfigWithDefaults({
        archetype: "mvp",
        product: { archetype: "enterprise" },
      })
      expect(resolved.archetype).toBe("mvp")
      expect(resolved.product.archetype).toBe("mvp")
      expect(resolved.core!.gates!.failOnBreaking).toBe(false)
      expect(resolved.core!.gates!.preflightLint).toBe("warn")
    })

    it("resolveConfigWithDefaults adopts nested product.archetype when top-level is omitted", () => {
      const resolved = resolveConfigWithDefaults({
        product: { archetype: "enterprise" },
      })
      expect(resolved.archetype).toBe("enterprise")
      expect(resolved.product.archetype).toBe("enterprise")
      expect(resolved.core!.gates!.failOnBreaking).toBe(true)
      expect(resolved.core!.gates!.baseRef).toBe("origin/main")
    })

    it("resolveConfigWithDefaults defaults omitted spec profile to 'full-api-document'", () => {
      const resolved = resolveConfigWithDefaults({
        specs: [
          { id: "api-1", schemaEntry: "s1.yaml", outDir: "dist", target: "fastify" },
          { id: "api-2", profile: "operation-contract", schemaEntry: "s2.yaml", outDir: "dist" },
        ],
      })
      expect(resolved.specs[0]?.profile).toBe("full-api-document")
      expect(resolved.specs[1]?.profile).toBe("operation-contract")
      expect(resolved.product.specs?.[0]?.profile).toBe("full-api-document")
    })

    it("resolveConfigWithDefaults preserves deep user overrides while maintaining default untouched fields", () => {
      const resolved = resolveConfigWithDefaults({
        archetype: "enterprise",
        core: {
          dialect: { oasVersion: "3.1.0" },
          gates: { baseRef: "upstream/main" },
        },
        product: {
          jitSchema: false,
          personas: { minCoverageRatio: 0.95 },
        },
      })
      // Overridden
      expect(resolved.core!.dialect!.oasVersion).toBe("3.1.0")
      expect(resolved.core!.gates!.baseRef).toBe("upstream/main")
      expect(resolved.product.jitSchema).toBe(false)
      expect(resolved.product.personas?.minCoverageRatio).toBe(0.95)

      // Retained enterprise defaults
      expect(resolved.core!.dialect!.jsonSchemaDialect).toBe("draft-2020-12")
      expect(resolved.core!.gates!.driftCheck).toBe(true)
      expect(resolved.core!.gates!.failOnBreaking).toBe(true)
      expect(resolved.core!.gates!.preflightLint).toBe("error")
      expect(resolved.product.zeroCopy).toBe(true)
      expect(resolved.product.personas?.enforceCoverage).toBe(true)
    })

    it("resolveConfigWithDefaults flattens top-level aliases into product configuration", () => {
      const resolved = resolveConfigWithDefaults({
        framework: "elysia",
        runtime: "bun",
        guards: { outDir: "dist/g" },
        contextInjection: { typeName: "Ctx", importPath: "./c.js" },
      })
      expect(resolved.product.framework).toBe("elysia")
      expect(resolved.product.runtime).toBe("bun")
      expect(resolved.product.guards?.outDir).toBe("dist/g")
      expect(resolved.product.contextInjection?.typeName).toBe("Ctx")
    })
  })
})

// ============================================================================
// SUITE 2: Archetype Engine & Orthogonal Composer Matrix (6 x 3 = 18)
// ============================================================================

describe("Tier 5 Adversarial: Archetype Engine & Orthogonal Composer (composer.ts)", () => {
  const frameworks: TargetFrameworkId[] = ["fastify", "elysia", "hono", "express", "nestjs", "generic"]
  const archetypes: ProductLifecycleArchetype[] = ["mvp", "microservice", "enterprise"]

  describe("2.1 6x3 Cartesian Product Configuration Composition", () => {
    for (const fwId of frameworks) {
      for (const archId of archetypes) {
        it(`composes valid dual-layer oa.config.ts for [framework: ${fwId}] x [archetype: ${archId}]`, () => {
          const target = getTargetProfile(fwId)
          const archetype = getArchetypeProfile(archId)
          const runtime: TargetRuntime = target.defaultRuntime ?? (fwId === "elysia" ? "bun" : "node")

          const configCode = composeInitConfig(target, archetype, {
            cwd: "/tmp/project",
            frameworkId: fwId,
            runtime,
            force: false,
            detectedSchema: { filePath: "specs/openapi.yaml", format: "openapi", description: "OpenAPI 3.2 spec" } as any,
          })

          // Structural assertions on generated TypeScript file
          expect(configCode).toContain("import { defineConfig } from '@oa-sdk/codegen'")
          expect(configCode).toContain("export default defineConfig({")
          expect(configCode).toContain(`archetype: '${archId}'`)
          expect(configCode).toContain(`target: '${fwId}'`)
          expect(configCode).toContain(`id: '${fwId}-api'`)
          expect(configCode).toContain("schemaEntry: 'specs/openapi.yaml'")
          expect(configCode).toContain("core: {")
          expect(configCode).toContain("product: {")

          // Framework-specific optimizations
          if (fwId === "fastify") {
            expect(configCode).toContain("jitSchema: true")
          } else {
            expect(configCode).toContain("jitSchema: false")
          }

          if (fwId === "elysia") {
            expect(configCode).toContain("zeroCopy: true")
          } else {
            expect(configCode).toContain("zeroCopy: false")
          }

          // Archetype-specific governance
          if (archId === "enterprise") {
            expect(configCode).toContain("failOnBreaking: true")
            expect(configCode).toContain("baseRef: 'origin/main'")
            expect(configCode).toContain("personas: {")
            expect(configCode).toContain("enforceCoverage: true")
          } else if (archId === "mvp") {
            expect(configCode).toContain("wireFormatSafety: false")
            expect(configCode).toContain("driftCheck: false")
            expect(configCode).toContain("preflightLint: 'warn'")
          } else if (archId === "microservice") {
            expect(configCode).toContain("wireFormatSafety: true")
            expect(configCode).toContain("driftCheck: true")
            expect(configCode).toContain("failOnBreaking: false")
          }
        })
      }
    }

    it("adversarial vulnerability: omitting frameworkId in TargetGenerateOptions causes microservice snippet to clobber target", () => {
      const target = getTargetProfile("express")
      const archetype = getArchetypeProfile("microservice")

      // When frameworkId is omitted from options (e.g. partial options object)
      const configWithoutFwId = composeInitConfig(target, archetype, {
        cwd: "/tmp/project",
        runtime: "node",
      } as any)

      // snippet.specFields { target: undefined } clobbers target: 'express'
      // resulting in no target field emitted in the spec object
      expect(configWithoutFwId).not.toContain("target: 'express'")
    })
  })

  describe("2.2 Strict Bun vs Node Runtime Isolation Verification", () => {
    describe("Bun Runtime Isolation (Assert 0 @types/node, 0 tsx, 0 vitest, 0 nodemon)", () => {
      for (const fwId of frameworks) {
        for (const archId of archetypes) {
          it(`strictly isolates Bun runtime for [framework: ${fwId}] x [archetype: ${archId}]`, () => {
            const target = getTargetProfile(fwId)
            const archetype = getArchetypeProfile(archId)

            const deps = composeInitDependencies(target, archetype, {
              cwd: "/tmp/project",
              frameworkId: fwId,
              runtime: "bun",
              force: false,
            })

            // Strict dependency assertions: ZERO Node tools
            expect(deps.devDependencies["@types/node"]).toBeUndefined()
            expect(deps.devDependencies["tsx"]).toBeUndefined()
            expect(deps.devDependencies["vitest"]).toBeUndefined()
            expect(deps.devDependencies["nodemon"]).toBeUndefined()

            // Bun native types MUST be present
            expect(deps.devDependencies["@types/bun"]).toBeDefined()

            const scripts = composeInitScripts(target, archetype, {
              cwd: "/tmp/project",
              frameworkId: fwId,
              runtime: "bun",
              force: false,
            })

            // Script assertions: strictly no vitest, all oa-gen prefixed with bun x
            for (const [scriptName, cmd] of Object.entries(scripts)) {
              expect(cmd, `Script ${scriptName} contains prohibited vitest`).not.toContain("vitest")
              if (cmd.includes("oa-gen")) {
                expect(cmd, `Script ${scriptName} must invoke oa-gen via bun x`).toMatch(/bun x oa-gen/)
              }
            }
          })
        }
      }
    })

    describe("Node Runtime Isolation (Assert 0 @types/bun, has Node ESM tooling)", () => {
      // Elysia is strictly Bun-native (defaultRuntime: 'bun') and emits Bun scripts by design
      const nodeFrameworks = frameworks.filter((f) => f !== "elysia")

      for (const fwId of nodeFrameworks) {
        for (const archId of archetypes) {
          it(`provides Node tooling for [framework: ${fwId}] x [archetype: ${archId}] under Node runtime`, () => {
            const target = getTargetProfile(fwId)
            const archetype = getArchetypeProfile(archId)

            const deps = composeInitDependencies(target, archetype, {
              cwd: "/tmp/project",
              frameworkId: fwId,
              runtime: "node",
              force: false,
            })

            // Strict dependency assertions: ZERO Bun tooling
            expect(deps.devDependencies["@types/bun"]).toBeUndefined()

            const scripts = composeInitScripts(target, archetype, {
              cwd: "/tmp/project",
              frameworkId: fwId,
              runtime: "node",
              force: false,
            })

            // Scripts for Node targets should NOT use bun x
            for (const [scriptName, cmd] of Object.entries(scripts)) {
              expect(cmd, `Script ${scriptName} should not contain bun x`).not.toContain("bun x")
            }
          })
        }
      }

      it("elysia target is inherently Bun-native with defaultRuntime 'bun'", () => {
        const elysia = getTargetProfile("elysia")
        expect(elysia.defaultRuntime).toBe("bun")
        const scripts = elysia.getRecommendedScripts({ cwd: "/tmp", frameworkId: "elysia", runtime: "bun" })
        expect(scripts["dev"]).toContain("bun --watch")
        expect(scripts["generate:router"]).toContain("bun x oa-gen")
      })
    })
  })


  describe("2.3 composeInitPackagePatches Full Integration", () => {
    it("returns unified patch bundle with scripts, dependencies, devDependencies", () => {
      const target = getTargetProfile("fastify")
      const archetype = getArchetypeProfile("microservice")
      const patch = composeInitPackagePatches(target, archetype, {
        cwd: "/tmp/project",
        frameworkId: "fastify",
        runtime: "node",
        force: false,
      })

      expect(patch.scripts).toBeDefined()
      expect(patch.dependencies).toBeDefined()
      expect(patch.devDependencies).toBeDefined()
      expect(patch.scripts["test:contract"]).toBe("vitest run src/__tests__/contracts")
      expect(patch.dependencies["fastify"]).toBeDefined()
      expect(patch.devDependencies["@oa-sdk/core"]).toBeDefined()
    })
  })

  describe("2.4 Archetype Registry & getArchetypeProfile", () => {
    it("ARCHETYPE_PROFILES exposes 3 concrete profiles", () => {
      expect(ARCHETYPE_PROFILES.length).toBe(3)
      expect(ARCHETYPE_PROFILES[0]).toBeInstanceOf(MvpArchetypeProfile)
      expect(ARCHETYPE_PROFILES[1]).toBeInstanceOf(MicroserviceArchetypeProfile)
      expect(ARCHETYPE_PROFILES[2]).toBeInstanceOf(EnterpriseArchetypeProfile)
    })

    it.each([
      ["mvp", "mvp"],
      [" MVP ", "mvp"],
      ["microservice", "microservice"],
      ["Microservice", "microservice"],
      ["enterprise", "enterprise"],
      [" ENTERPRISE\t", "enterprise"],
    ])("resolves archetype profile with case and whitespace insensitivity: %s -> %s", (input, expectedId) => {
      const profile = getArchetypeProfile(input)
      expect(profile.id).toBe(expectedId)
    })

    it.each(["monolith", "serverless", "production", ""])("throws descriptive error on unknown archetype: %j", (input) => {
      expect(() => getArchetypeProfile(input)).toThrow(/Unknown lifecycle archetype:.*Allowed values: mvp, microservice, enterprise/)
    })
  })
})

// ============================================================================
// SUITE 3: CLI --archetype Flag Parsing and Error Handling
// ============================================================================

describe("Tier 5 Adversarial: CLI --archetype Flag Parsing & Error Handling", () => {
  let tmpDir: string
  let consoleErrorSpy: any
  let consoleLogSpy: any

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oa-challenger-tier5-cli-"))
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(async () => {
    consoleErrorSpy.mockRestore()
    consoleLogSpy.mockRestore()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("exposes --archetype (-a) in init command options manifest", () => {
    expect(init.options?.archetype).toBeDefined()
    expect(init.options?.archetype?.type).toBe("string")
    expect(init.options?.archetype?.short).toBe("a")
    expect(init.options?.archetype?.description).toContain("mvp | microservice | enterprise")
  })

  it.each([
    "monolith",
    "serverless",
    "production",
    "invalid",
    "mvp-extra",
  ])("throws CliExitError(1) when invalid --archetype is supplied: %s", async (badArchetype) => {
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "cli-test-app" }, null, 2),
    )

    let thrownError: any
    try {
      await init.run({
        cwd: tmpDir,
        archetype: badArchetype,
      })
    } catch (err) {
      thrownError = err
    }

    expect(thrownError).toBeInstanceOf(CliExitError)
    expect(thrownError.exitCode).toBe(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(`❌ Invalid archetype: "${badArchetype}". Allowed values: mvp, microservice, enterprise`),
    )
  })

  it.each([
    ["mvp", "mvp"],
    ["MVP", "mvp"],
    ["microservice", "microservice"],
    ["MicroService", "microservice"],
    ["enterprise", "enterprise"],
    [" ENTERPRISE ", "enterprise"],
  ])("successfully parses valid --archetype in dryRun mode without throwing: %s", async (archetypeArg, expectedId) => {
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "cli-test-app", dependencies: { express: "^4.19.0" } }, null, 2),
    )

    await expect(
      init.run({
        cwd: tmpDir,
        target: "express",
        archetype: archetypeArg,
        "dry-run": true,
      }),
    ).resolves.not.toThrow()

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining(`🎯 Lifecycle archetype preset: ${expectedId}`),
    )
  })
})
