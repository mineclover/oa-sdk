/**
 * @oa-sdk/codegen — Declarative Specification & Governance Configuration
 *
 * Defines the dual-layer configuration architecture and helper functions for oa.config.ts / oa.config.json.
 * Strictly separates Shared Platform Core (SSOT contracts, wire safety, diff gates)
 * from Product-Specific Domain Extensions (lifecycle archetypes, framework bindings, context injection).
 */

import { z } from "zod"
import type { OutputOptions } from "./types.js"

// ============================================================================
// Projection Profiles & Framework Identifiers
// ============================================================================

/**
 * Supported OpenAPI projection profiles conforming to @oa-sdk/openapi-projection-contract.
 */
export const OPENAPI_PROJECTION_PROFILES = [
  "component-bundle",
  "operation-contract",
  "full-api-document",
] as const

export type OpenApiProjectionProfile = (typeof OPENAPI_PROJECTION_PROFILES)[number]

/**
 * Supported product lifecycle archetypes.
 */
export const PRODUCT_LIFECYCLE_ARCHETYPES = ["mvp", "microservice", "enterprise"] as const
export type ProductLifecycleArchetype = (typeof PRODUCT_LIFECYCLE_ARCHETYPES)[number]

/**
 * Supported target framework identifiers for router generation.
 */
export const TARGET_FRAMEWORK_IDS = [
  "fastify",
  "elysia",
  "hono",
  "express",
  "nestjs",
  "generic",
] as const
export type TargetFrameworkId = (typeof TARGET_FRAMEWORK_IDS)[number]

/**
 * Supported execution runtime environments.
 */
export const TARGET_RUNTIMES = ["node", "bun"] as const
export type TargetRuntime = (typeof TARGET_RUNTIMES)[number]

// ============================================================================
// Shared Platform Core (불변 공유 코어)
// ============================================================================

export interface SharedPlatformDialectConfig {
  /** OpenAPI specification dialect version. Defaults to "3.2.0". */
  oasVersion?: "3.2.0" | "3.1.0" | undefined
  /** JSON Schema specification dialect. Defaults to "draft-2020-12". */
  jsonSchemaDialect?: "draft-2020-12" | undefined
  /** Whether to project canonical x-schema-engine-* vendor extensions. Defaults to true. */
  canonicalProjection?: boolean | undefined
}

export interface SharedPlatformContractsConfig {
  /** Whether to generate framework-decoupled pure *.contract.ts interfaces. Defaults to true. */
  pureHandlers?: boolean | undefined
  /** Name of the aggregate handlers interface. Defaults to "ApiHandlers". */
  contractName?: string | undefined
  /** Output file naming pattern. Defaults to "[id].contract.ts". */
  namingPattern?: string | undefined
  /** Optional directory override for generated contract interfaces */
  outDir?: string | undefined
  /** Whether to prepend the auto-generated banner comment. Defaults to true. */
  banner?: boolean | undefined
}

export interface SharedPlatformClientConfig {
  /** Whether to generate typed client SDK. Defaults to true. */
  enabled?: boolean | undefined
  /** Enforce JsonPrimitive<T> wire-format safety (strip functions/prototypes, Date -> string). Defaults to true. */
  wireFormatSafety?: boolean | undefined
  /** Output directory for generated client SDK */
  outDir?: string | undefined
}

export interface SharedPlatformTypegenConfig {
  /** Enable TypeChecker-resolved DFS symbol recursion detection. Defaults to true. */
  resolveSymbolCycles?: boolean | undefined
  /** Support OpenAPI 3.2 discriminator with defaultMapping. Defaults to true. */
  discriminatedUnions?: boolean | undefined
  /** Target code generation adapter. Defaults to "ts". */
  targetAdapter?: "ts" | "zod" | "typia" | undefined
}

export interface SharedPlatformGatesConfig {
  /** Enforce zero-drift SHA-256 spec version hash in CI. */
  driftCheck?: boolean | undefined
  /** Exit non-zero on semantic breaking changes (oa-gen tsp diff --fail-on-breaking). */
  failOnBreaking?: boolean | undefined
  /** Base git ref or spec path for breaking change diff. Defaults to "origin/main". */
  baseRef?: string | undefined
  /** Preflight schema validation severity threshold. */
  preflightLint?: "off" | "warn" | "error" | undefined
}

export interface SharedPlatformCoreConfig {
  /** SSOT OpenAPI and JSON Schema dialect specifications */
  dialect?: SharedPlatformDialectConfig | undefined
  /** Pure TypeScript handler contract generation rules */
  contracts?: SharedPlatformContractsConfig | undefined
  /** Typed client SDK emission and wire-format safety */
  client?: SharedPlatformClientConfig | undefined
  /** AST type generation rules */
  typegen?: SharedPlatformTypegenConfig | undefined
  /** Platform CI governance and drift defense gates */
  gates?: SharedPlatformGatesConfig | undefined
}

// ============================================================================
// Product-Specific Domain Layer (제품 특화 확장 레이어)
// ============================================================================

export interface HandlerContextInjectionConfig {
  /** Name of the imported product context type (e.g. "AppContext", "RequestContext") */
  typeName: string
  /** Module specifier or path to import the context type from (e.g. "./context.js", "@myorg/ctx") */
  importPath: string
  /** Property key attached to ctx where the injected context is accessible (default: "app") */
  propertyKey?: string | undefined
  /** Optional list of documented context field names (e.g. ["tenantId", "user", "traceId"]) */
  fields?: string[] | undefined
}

export interface ProductSecurityScheme {
  type: "http" | "apiKey" | "oauth2" | "openIdConnect"
  scheme?: string | undefined
  bearerFormat?: string | undefined
  in?: "header" | "query" | "cookie" | undefined
  name?: string | undefined
  description?: string | undefined
  flows?: Record<string, unknown> | undefined
}

export interface ProductSecurityConfig {
  schemes?: Record<string, ProductSecurityScheme> | undefined
  defaultRequirement?: Array<Record<string, string[]>> | undefined
}

export interface PersonaGovernanceConfig {
  /** Relative or absolute path to data personas registry.yaml */
  registryPath?: string | undefined
  /** Required capability traits that must be satisfied */
  requiredTraits?: string[] | undefined
  /** Whether to enforce persona coverage across operations in CI */
  enforceCoverage?: boolean | undefined
  /** Minimum acceptable persona coverage ratio (0.0 to 1.0) */
  minCoverageRatio?: number | undefined
}

/**
 * Domain profile specification target configuration.
 */
export interface ProfileTargetConfig {
  /** Unique target identifier (e.g. "devlink-contracts", "fastify-api") */
  id: string
  /** Path to source schema file or module (e.g. "openapi.yaml", "src/schemas.ts") */
  schemaEntry: string
  /** Target output directory for generated artifacts (e.g. "artifacts/specs") */
  outDir: string
  /** OpenAPI projection profile type. Defaults to "full-api-document" when omitted. */
  profile?: OpenApiProjectionProfile | undefined
  /** Target web framework for router generation */
  target?: TargetFrameworkId | undefined
  /** Optional document title override (e.g. "Surface Engine Component Bundle") */
  title?: string | undefined
  /** Optional specification version (e.g. "1.0.0") */
  version?: string | undefined
  /** Optional tags associated with target */
  tags?: string[] | undefined
}

/**
 * Standalone type guard compilation configuration.
 */
export interface GuardTargetConfig {
  /** Target output directory where compiled guards will be emitted (e.g. "dist/guards") */
  outDir: string
  /** Whether to output individual modular guard files alongside root index.js */
  split?: boolean | undefined
  /** Target module format for emitted guards. Defaults to "esm". */
  moduleFormat?: "esm" | "cjs" | undefined
  /** Whether to audit emitted guards for Content Security Policy (CSP) compliance */
  auditCsp?: boolean | undefined
  /** Whether to generate Tier 1 O(1) fast-path validation predicates (*Fast) */
  tiered?: boolean | undefined
  /** Whether to generate O(1) polymorphic dispatch tables for discriminated unions */
  polymorphicDispatch?: boolean | undefined
}

/**
 * Supported artifact kinds for output path routing.
 */
export const ARTIFACT_KINDS = [
  "contract",
  "client",
  "queries",
  "keys",
  "guards",
  "schemas",
  "crdt-contract",
  "crdt-router",
  "crdt-client",
  "crdt-hooks",
] as const

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

/**
 * Conditional routing rule matching operations/artifacts to custom file paths or patterns.
 */
export interface OutputRoutingRule {
  /** Optional filter by OpenAPI tag (exact string or array of strings) */
  tag?: string | string[] | undefined
  /** Optional filter by URL path prefix (e.g. "/api/v1/billing") */
  pathPrefix?: string | undefined
  /** Optional filter by HTTP method ("get" | "post" | "put" | "delete" | "patch" etc.) */
  method?: string | string[] | undefined
  /** Optional filter by artifact kind */
  kind?: ArtifactKind | ArtifactKind[] | undefined
  /** Optional filter by target or profile ID */
  profile?: string | undefined
  /** Target output file path template (supports tokens: {tag}, {kind}, {operationId}, {method}, {group}) */
  target: string
}

/**
 * Explicit output path templates mapped per artifact kind.
 */
export type ByKindRoutingConfig = Partial<Record<ArtifactKind, string>>

/**
 * Configuration for the developer output path routing customization engine.
 */
export interface OutputRoutingConfig {
  /**
   * Global default template pattern for output paths.
   * Supports tokens: {tag}, {kind}, {operationId}, {method}, {group}
   * Example: "src/features/{tag}/api/{tag}.{kind}.ts"
   */
  pattern?: string | undefined

  /**
   * Explicit output path templates per artifact kind (overrides pattern).
   */
  byKind?: ByKindRoutingConfig | undefined

  /**
   * Ordered conditional rule matchers. The first matching rule overrides pattern and byKind.
   */
  rules?: OutputRoutingRule[] | undefined

  /**
   * Base directory for output routing. Resolved relative to config rootDir. Defaults to ".".
   */
  baseDir?: string | undefined

  /**
   * Import specifier style: "relative" (default) or "alias" (uses tsconfig paths).
   */
  importStyle?: "relative" | "alias" | undefined

  /**
   * Explicit path to tsconfig.json for resolving path aliases. Defaults to auto-discovery in rootDir.
   */
  tsconfigPath?: string | undefined

  /**
   * Manifest file path for tracking emitted files and orphan pruning. Defaults to ".oa-manifest.json".
   */
  manifestPath?: string | undefined

  /**
   * Whether to automatically prune obsolete generated artifacts when the spec changes. Defaults to true.
   */
  pruneOrphans?: boolean | undefined

  /**
   * Casing strategy for token substitution: "kebab" (default), "camel", "pascal", or "preserve".
   */
  casing?: "kebab" | "camel" | "pascal" | "preserve" | undefined
}

/**
 * Product-Specific Domain Extension Layer configuration.
 */
export interface ProductDomainConfig {
  /** Product lifecycle archetype preset */
  archetype?: ProductLifecycleArchetype | undefined
  /** Web framework binding */
  framework?: TargetFrameworkId | undefined
  /** Execution runtime environment */
  runtime?: TargetRuntime | undefined
  /** Whether to enable Fastify fast-json-stringify JIT schema acceleration */
  jitSchema?: boolean | undefined
  /** Whether to enable Bun Elysia zero-copy context destructuring */
  zeroCopy?: boolean | undefined
  /** Domain specification targets */
  specs?: ProfileTargetConfig[] | undefined
  /** Standalone type guard generation configuration */
  guards?: GuardTargetConfig | undefined
  /** Product-specific context injection for handler contracts */
  contextInjection?: HandlerContextInjectionConfig | undefined
  /** Security schemes and authentication policies */
  security?: ProductSecurityConfig | undefined
  /** Persona capability traits governance (@oa-sdk/personas) */
  personas?: PersonaGovernanceConfig | undefined
  /** Output path routing customization engine configuration */
  outputRouting?: OutputRoutingConfig | undefined
}

// ============================================================================
// Root OaConfig
// ============================================================================

/**
 * Root specification and governance configuration for oa-sdk.
 */
export interface OaConfig extends Partial<OutputOptions> {
  /** Base directory for relative path resolution (defaults to directory of config file) */
  rootDir?: string | undefined
  /** Product lifecycle archetype preset ("mvp" | "microservice" | "enterprise") */
  archetype?: ProductLifecycleArchetype | undefined
  /** Immutable Shared Platform Core SSOT configuration */
  core?: SharedPlatformCoreConfig | undefined
  /** Product-Specific Domain Extension Layer configuration */
  product?: ProductDomainConfig | undefined

  // Top-level aliases for backward compatibility and flattened authoring
  specs?: ProfileTargetConfig[] | undefined
  guards?: GuardTargetConfig | undefined
  schemas?: Record<string, z.ZodTypeAny> | undefined
  framework?: TargetFrameworkId | undefined
  runtime?: TargetRuntime | undefined
  contextInjection?: HandlerContextInjectionConfig | undefined
  personas?: PersonaGovernanceConfig | undefined
  security?: ProductSecurityConfig | undefined
  outputRouting?: OutputRoutingConfig | undefined
}

/** Legacy type alias for backward compatibility */
export type CodegenConfig = OaConfig

/**
 * Fully resolved and defaulted OaConfig.
 */
export interface ResolvedOaConfig extends OaConfig {
  archetype: ProductLifecycleArchetype
  core: Required<SharedPlatformCoreConfig>
  product: ProductDomainConfig
  specs: ProfileTargetConfig[]
  outputRouting?: OutputRoutingConfig | undefined
}

/**
 * Archetype defaults shape returned by getArchetypeDefaults.
 */
export interface ArchetypeDefaults {
  core: SharedPlatformCoreConfig
  product: Partial<ProductDomainConfig>
}

// ============================================================================
// Archetype Defaults & Configuration Resolver
// ============================================================================

/**
 * Returns canonical platform core and product defaults for a given lifecycle archetype.
 */
export function getArchetypeDefaults(archetype: ProductLifecycleArchetype): ArchetypeDefaults {
  switch (archetype) {
    case "mvp":
      return {
        core: {
          dialect: { oasVersion: "3.2.0", jsonSchemaDialect: "draft-2020-12", canonicalProjection: true },
          contracts: { pureHandlers: true, contractName: "ApiHandlers", banner: true },
          client: { enabled: true, wireFormatSafety: false },
          typegen: { resolveSymbolCycles: false, discriminatedUnions: true },
          gates: { driftCheck: false, failOnBreaking: false, preflightLint: "warn" },
        },
        product: {
          jitSchema: false,
          zeroCopy: false,
        },
      }
    case "microservice":
      return {
        core: {
          dialect: { oasVersion: "3.2.0", jsonSchemaDialect: "draft-2020-12", canonicalProjection: true },
          contracts: { pureHandlers: true, contractName: "ApiHandlers", banner: true },
          client: { enabled: true, wireFormatSafety: true },
          typegen: { resolveSymbolCycles: true, discriminatedUnions: true },
          gates: { driftCheck: true, failOnBreaking: false, preflightLint: "error" },
        },
        product: {
          jitSchema: true,
          zeroCopy: true,
        },
      }
    case "enterprise":
      return {
        core: {
          dialect: { oasVersion: "3.2.0", jsonSchemaDialect: "draft-2020-12", canonicalProjection: true },
          contracts: { pureHandlers: true, contractName: "ApiHandlers", banner: true },
          client: { enabled: true, wireFormatSafety: true },
          typegen: { resolveSymbolCycles: true, discriminatedUnions: true },
          gates: { driftCheck: true, failOnBreaking: true, baseRef: "origin/main", preflightLint: "error" },
        },
        product: {
          jitSchema: true,
          zeroCopy: true,
          personas: { enforceCoverage: true, minCoverageRatio: 0.8 },
        },
      }
  }
}

/**
 * Resolves an OaConfig by applying archetype defaults and harmonizing dual-layer and root options.
 */
export function resolveConfigWithDefaults(config: OaConfig): ResolvedOaConfig {
  const archetype = config.archetype ?? config.product?.archetype ?? "microservice"
  const defaults = getArchetypeDefaults(archetype)

  const mergedCore: Required<SharedPlatformCoreConfig> = {
    dialect: { ...defaults.core.dialect, ...config.core?.dialect },
    contracts: { ...defaults.core.contracts, ...config.core?.contracts },
    client: { ...defaults.core.client, ...config.core?.client },
    typegen: { ...defaults.core.typegen, ...config.core?.typegen },
    gates: { ...defaults.core.gates, ...config.core?.gates },
  }

  const rawSpecs = config.specs ?? config.product?.specs ?? []
  const specs: ProfileTargetConfig[] = rawSpecs.map((spec) => ({
    ...spec,
    profile: spec.profile ?? "full-api-document",
  }))

  const guards = config.guards ?? config.product?.guards
  const framework = config.framework ?? config.product?.framework
  const runtime = config.runtime ?? config.product?.runtime
  const contextInjection = config.contextInjection ?? config.product?.contextInjection
  const security = config.security ?? config.product?.security

  const rawPersonas = config.personas ?? config.product?.personas
  const personas = rawPersonas
    ? (defaults.product.personas ? { ...defaults.product.personas, ...rawPersonas } : rawPersonas)
    : defaults.product.personas

  const jitSchema = config.product?.jitSchema ?? defaults.product.jitSchema ?? false
  const zeroCopy = config.product?.zeroCopy ?? defaults.product.zeroCopy ?? false
  const outputRouting = config.outputRouting ?? config.product?.outputRouting

  const mergedProduct: ProductDomainConfig = {
    archetype,
    ...(framework !== undefined ? { framework } : {}),
    ...(runtime !== undefined ? { runtime } : {}),
    specs,
    ...(guards !== undefined ? { guards } : {}),
    ...(contextInjection !== undefined ? { contextInjection } : {}),
    ...(personas !== undefined ? { personas } : {}),
    ...(security !== undefined ? { security } : {}),
    ...(outputRouting !== undefined ? { outputRouting } : {}),
    jitSchema,
    zeroCopy,
  }

  return {
    ...config,
    archetype,
    core: mergedCore,
    product: mergedProduct,
    specs,
    ...(guards !== undefined ? { guards } : {}),
    ...(outputRouting !== undefined ? { outputRouting } : {}),
  }
}

/**
 * Validation error issue descriptor.
 */
export interface ConfigValidationError {
  /** Property path of the invalid configuration field (e.g. "specs[0].id") */
  path: string
  /** Human-readable explanation of why the field is invalid */
  message: string
}

/**
 * Validation result for an OaConfig object.
 */
export interface ConfigValidationResult {
  /** Whether the configuration is valid */
  valid: boolean
  /** Array of validation errors if invalid */
  errors: ConfigValidationError[]
  /** Typed configuration if valid */
  config?: OaConfig
}

/**
 * Error thrown when an invalid configuration is passed to assertOaConfig or defineConfig.
 */
export class OaConfigError extends Error {
  readonly errors: ConfigValidationError[]

  constructor(message: string, errors: ConfigValidationError[] = []) {
    super(message)
    this.name = "OaConfigError"
    this.errors = errors
  }
}

// ============================================================================
// Zod Master Schemas for Config Introspection & OpenAPI / Schema Export
// ============================================================================

export const productLifecycleArchetypeSchema = z.enum(PRODUCT_LIFECYCLE_ARCHETYPES)
export const targetFrameworkIdSchema = z.enum(TARGET_FRAMEWORK_IDS)
export const targetRuntimeSchema = z.enum(TARGET_RUNTIMES)

export const sharedPlatformDialectConfigSchema = z.object({
  oasVersion: z.enum(["3.2.0", "3.1.0"]).optional(),
  jsonSchemaDialect: z.literal("draft-2020-12").optional(),
  canonicalProjection: z.boolean().optional(),
})

export const sharedPlatformContractsConfigSchema = z.object({
  pureHandlers: z.boolean().optional(),
  contractName: z.string().min(1).optional(),
  namingPattern: z.string().min(1).optional(),
  outDir: z.string().min(1).optional(),
  banner: z.boolean().optional(),
})

export const sharedPlatformClientConfigSchema = z.object({
  enabled: z.boolean().optional(),
  wireFormatSafety: z.boolean().optional(),
  outDir: z.string().min(1).optional(),
})

export const sharedPlatformTypegenConfigSchema = z.object({
  resolveSymbolCycles: z.boolean().optional(),
  discriminatedUnions: z.boolean().optional(),
  targetAdapter: z.enum(["ts", "zod", "typia"]).optional(),
})

export const sharedPlatformGatesConfigSchema = z.object({
  driftCheck: z.boolean().optional(),
  failOnBreaking: z.boolean().optional(),
  baseRef: z.string().min(1).optional(),
  preflightLint: z.enum(["off", "warn", "error"]).optional(),
})

export const sharedPlatformCoreConfigSchema = z.object({
  dialect: sharedPlatformDialectConfigSchema.optional(),
  contracts: sharedPlatformContractsConfigSchema.optional(),
  client: sharedPlatformClientConfigSchema.optional(),
  typegen: sharedPlatformTypegenConfigSchema.optional(),
  gates: sharedPlatformGatesConfigSchema.optional(),
})

export const handlerContextInjectionConfigSchema = z.object({
  typeName: z.string().min(1, "contextInjection.typeName is required"),
  importPath: z.string().min(1, "contextInjection.importPath is required"),
  propertyKey: z.string().min(1).optional(),
  fields: z.array(z.string().min(1)).optional(),
})

export const productSecuritySchemeSchema = z.object({
  type: z.enum(["http", "apiKey", "oauth2", "openIdConnect"]),
  scheme: z.string().optional(),
  bearerFormat: z.string().optional(),
  in: z.enum(["header", "query", "cookie"]).optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  flows: z.record(z.string(), z.unknown()).optional(),
})

export const productSecurityConfigSchema = z.object({
  schemes: z.record(z.string(), productSecuritySchemeSchema).optional(),
  defaultRequirement: z.array(z.record(z.string(), z.array(z.string()))).optional(),
})

export const personaGovernanceConfigSchema = z.object({
  registryPath: z.string().min(1).optional(),
  requiredTraits: z.array(z.string().min(1)).optional(),
  enforceCoverage: z.boolean().optional(),
  minCoverageRatio: z.number().min(0).max(1).optional(),
})

export const profileTargetConfigSchema = z.object({
  id: z.string().min(1, "Target id is required and must be a non-empty string"),
  profile: z.enum(OPENAPI_PROJECTION_PROFILES, {
    message: "profile must be one of: 'component-bundle', 'operation-contract', 'full-api-document'",
  }).optional(),
  target: targetFrameworkIdSchema.optional(),
  schemaEntry: z.string().min(1, "schemaEntry is required and must be a non-empty string"),
  outDir: z.string().min(1, "outDir is required and must be a non-empty string"),
  title: z.string().min(1, "title must be a non-empty string when provided").optional(),
  version: z.string().min(1, "version must be a non-empty string when provided").optional(),
  tags: z.array(z.string()).optional(),
})

export const guardTargetConfigSchema = z.object({
  outDir: z.string().min(1, "outDir is required and must be a non-empty string"),
  split: z.boolean().optional(),
  moduleFormat: z.enum(["esm", "cjs"], {
    message: "moduleFormat must be 'esm' or 'cjs'",
  }).optional(),
  auditCsp: z.boolean().optional(),
  tiered: z.boolean().optional(),
  polymorphicDispatch: z.boolean().optional(),
})

export const artifactKindSchema = z.enum(ARTIFACT_KINDS)

export const outputRoutingRuleSchema = z.object({
  tag: z.union([z.string(), z.array(z.string())]).optional(),
  pathPrefix: z.string().optional(),
  method: z.union([z.string(), z.array(z.string())]).optional(),
  kind: z.union([artifactKindSchema, z.array(artifactKindSchema)]).optional(),
  profile: z.string().optional(),
  target: z.string().min(1, "Rule target path is required and must be a non-empty string"),
})

export const byKindRoutingConfigSchema = z.object({
  contract: z.string().min(1).optional(),
  client: z.string().min(1).optional(),
  queries: z.string().min(1).optional(),
  keys: z.string().min(1).optional(),
  guards: z.string().min(1).optional(),
  schemas: z.string().min(1).optional(),
})

export const outputRoutingConfigSchema = z.object({
  pattern: z.string().min(1).optional(),
  byKind: byKindRoutingConfigSchema.optional(),
  rules: z.array(outputRoutingRuleSchema).optional(),
  baseDir: z.string().min(1).optional(),
  importStyle: z.enum(["relative", "alias"]).optional(),
  tsconfigPath: z.string().min(1).optional(),
  manifestPath: z.string().min(1).optional(),
  pruneOrphans: z.boolean().optional(),
  casing: z.enum(["kebab", "camel", "pascal", "preserve"]).optional(),
})

export const productDomainConfigSchema = z.object({
  archetype: productLifecycleArchetypeSchema.optional(),
  framework: targetFrameworkIdSchema.optional(),
  runtime: targetRuntimeSchema.optional(),
  jitSchema: z.boolean().optional(),
  zeroCopy: z.boolean().optional(),
  specs: z.array(profileTargetConfigSchema).optional(),
  guards: guardTargetConfigSchema.optional(),
  contextInjection: handlerContextInjectionConfigSchema.optional(),
  security: productSecurityConfigSchema.optional(),
  personas: personaGovernanceConfigSchema.optional(),
  outputRouting: outputRoutingConfigSchema.optional(),
})

export const oaConfigSchema = z
  .object({
    rootDir: z.string().min(1, "rootDir must be a non-empty string when provided").optional(),
    archetype: productLifecycleArchetypeSchema.optional(),
    core: sharedPlatformCoreConfigSchema.optional(),
    product: productDomainConfigSchema.optional(),
    specs: z.array(profileTargetConfigSchema).optional(),
    guards: guardTargetConfigSchema.optional(),
    schemas: z.record(z.string(), z.custom<z.ZodTypeAny>()).optional(),
    framework: targetFrameworkIdSchema.optional(),
    runtime: targetRuntimeSchema.optional(),
    contextInjection: handlerContextInjectionConfigSchema.optional(),
    security: productSecurityConfigSchema.optional(),
    personas: personaGovernanceConfigSchema.optional(),
    outputRouting: outputRoutingConfigSchema.optional(),
    // Legacy OutputOptions fields
    output: z.string().optional(),
    grouping: z.enum(["single", "per-schema"]).optional(),
    filename: z.string().optional(),
    mergeIntoSpec: z.boolean().optional(),
    specPath: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // Deduplicate target IDs across top-level and nested specs
    const combinedSpecs: { spec: { id: string }; path: (string | number)[] }[] = []
    if (data.specs) {
      for (let i = 0; i < data.specs.length; i++) {
        const s = data.specs[i]
        if (s) combinedSpecs.push({ spec: s, path: ["specs", i, "id"] })
      }
    }
    if (data.product?.specs) {
      for (let i = 0; i < data.product.specs.length; i++) {
        const s = data.product.specs[i]
        if (s) combinedSpecs.push({ spec: s, path: ["product", "specs", i, "id"] })
      }
    }
    if (combinedSpecs.length > 0) {
      const seen = new Map<string, number>()
      for (let i = 0; i < combinedSpecs.length; i++) {
        const item = combinedSpecs[i]
        if (!item) continue
        const id = item.spec.id
        if (seen.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate spec target id "${id}" at index ${i} (already declared at index ${seen.get(id)})`,
            path: item.path,
          })
        } else {
          seen.set(id, i)
        }
      }
    }
  })

// ============================================================================
// Runtime Validation and Assertion Utilities
// ============================================================================

/**
 * Validates an arbitrary input against the OaConfig specification.
 * Returns a detailed report of errors without throwing.
 */
export function validateOaConfig(config: unknown): ConfigValidationResult {
  const errors: ConfigValidationError[] = []

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return {
      valid: false,
      errors: [{ path: "", message: "Configuration must be a non-null object" }],
    }
  }

  const raw = config as Record<string, unknown>

  // Helper: validate spec item
  function validateSpecItem(
    item: unknown,
    prefix: string,
    globalIndex: number,
    seenIds: Map<string, number>,
  ) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push({ path: prefix, message: "Spec target must be an object" })
      return
    }

    const spec = item as Record<string, unknown>

    // id
    if (typeof spec.id !== "string" || spec.id.trim().length === 0) {
      errors.push({ path: `${prefix}.id`, message: "Target id is required and must be a non-empty string" })
    } else {
      if (seenIds.has(spec.id)) {
        errors.push({
          path: `${prefix}.id`,
          message: `Duplicate spec target id "${spec.id}" at index ${globalIndex} (already declared at index ${seenIds.get(spec.id)})`,
        })
      } else {
        seenIds.set(spec.id, globalIndex)
      }
    }

    // profile (optional when target is specified, otherwise required)
    if (spec.profile === undefined) {
      if (spec.target === undefined) {
        errors.push({
          path: `${prefix}.profile`,
          message: "profile is required and must be one of: 'component-bundle', 'operation-contract', 'full-api-document'",
        })
      }
    } else if (
      typeof spec.profile !== "string" ||
      !(OPENAPI_PROJECTION_PROFILES as readonly string[]).includes(spec.profile)
    ) {
      errors.push({
        path: `${prefix}.profile`,
        message: `profile is required and must be one of: 'component-bundle', 'operation-contract', 'full-api-document' (received ${JSON.stringify(spec.profile)})`,
      })
    }

    // target (optional, but if provided must be in TARGET_FRAMEWORK_IDS)
    if (spec.target !== undefined) {
      if (
        typeof spec.target !== "string" ||
        !(TARGET_FRAMEWORK_IDS as readonly string[]).includes(spec.target as TargetFrameworkId)
      ) {
        errors.push({
          path: `${prefix}.target`,
          message: `target must be one of: ${TARGET_FRAMEWORK_IDS.map((t) => `'${t}'`).join(", ")} (received ${JSON.stringify(spec.target)})`,
        })
      }
    }

    // schemaEntry
    if (typeof spec.schemaEntry !== "string" || spec.schemaEntry.trim().length === 0) {
      errors.push({
        path: `${prefix}.schemaEntry`,
        message: "schemaEntry is required and must be a non-empty string",
      })
    }

    // outDir
    if (typeof spec.outDir !== "string" || spec.outDir.trim().length === 0) {
      errors.push({
        path: `${prefix}.outDir`,
        message: "outDir is required and must be a non-empty string",
      })
    }

    // title (optional)
    if (spec.title !== undefined && (typeof spec.title !== "string" || spec.title.trim().length === 0)) {
      errors.push({
        path: `${prefix}.title`,
        message: "title must be a non-empty string when provided",
      })
    }

    // version (optional)
    if (spec.version !== undefined && (typeof spec.version !== "string" || spec.version.trim().length === 0)) {
      errors.push({
        path: `${prefix}.version`,
        message: "version must be a non-empty string when provided",
      })
    }

    // tags (optional)
    if (spec.tags !== undefined) {
      if (!Array.isArray(spec.tags) || spec.tags.some((t) => typeof t !== "string" || t.trim().length === 0)) {
        errors.push({
          path: `${prefix}.tags`,
          message: "tags must be an array of non-empty strings when provided",
        })
      }
    }
  }

  // Helper: validate guards
  function validateGuardsItem(guardsItem: unknown, prefix: string) {
    if (!guardsItem || typeof guardsItem !== "object" || Array.isArray(guardsItem)) {
      errors.push({ path: prefix, message: `${prefix} must be an object` })
      return
    }
    const guards = guardsItem as Record<string, unknown>

    if (typeof guards.outDir !== "string" || guards.outDir.trim().length === 0) {
      errors.push({ path: `${prefix}.outDir`, message: "outDir is required and must be a non-empty string" })
    }

    if (guards.split !== undefined && typeof guards.split !== "boolean") {
      errors.push({ path: `${prefix}.split`, message: "split must be a boolean when provided" })
    }

    if (guards.moduleFormat !== undefined) {
      if (guards.moduleFormat !== "esm" && guards.moduleFormat !== "cjs") {
        errors.push({
          path: `${prefix}.moduleFormat`,
          message: `moduleFormat must be 'esm' or 'cjs' (received ${JSON.stringify(guards.moduleFormat)})`,
        })
      }
    }

    if (guards.auditCsp !== undefined && typeof guards.auditCsp !== "boolean") {
      errors.push({ path: `${prefix}.auditCsp`, message: "auditCsp must be a boolean when provided" })
    }
  }

  // Helper: validate context injection
  function validateContextInjectionItem(ctxItem: unknown, prefix: string) {
    if (!ctxItem || typeof ctxItem !== "object" || Array.isArray(ctxItem)) {
      errors.push({ path: prefix, message: `${prefix} must be an object` })
      return
    }
    const ctx = ctxItem as Record<string, unknown>
    if (typeof ctx.typeName !== "string" || ctx.typeName.trim().length === 0) {
      errors.push({
        path: `${prefix}.typeName`,
        message: "contextInjection.typeName is required and must be a non-empty string",
      })
    }
    if (typeof ctx.importPath !== "string" || ctx.importPath.trim().length === 0) {
      errors.push({
        path: `${prefix}.importPath`,
        message: "contextInjection.importPath is required and must be a non-empty string",
      })
    }
    if (ctx.propertyKey !== undefined && (typeof ctx.propertyKey !== "string" || ctx.propertyKey.trim().length === 0)) {
      errors.push({
        path: `${prefix}.propertyKey`,
        message: "propertyKey must be a non-empty string when provided",
      })
    }
    if (ctx.fields !== undefined) {
      if (!Array.isArray(ctx.fields) || ctx.fields.some((f) => typeof f !== "string" || f.trim().length === 0)) {
        errors.push({
          path: `${prefix}.fields`,
          message: "fields must be an array of non-empty strings when provided",
        })
      }
    }
  }

  // Helper: validate personas
  function validatePersonasItem(personasItem: unknown, prefix: string) {
    if (!personasItem || typeof personasItem !== "object" || Array.isArray(personasItem)) {
      errors.push({ path: prefix, message: `${prefix} must be an object` })
      return
    }
    const personas = personasItem as Record<string, unknown>
    if (personas.registryPath !== undefined && (typeof personas.registryPath !== "string" || personas.registryPath.trim().length === 0)) {
      errors.push({
        path: `${prefix}.registryPath`,
        message: "registryPath must be a non-empty string when provided",
      })
    }
    if (personas.requiredTraits !== undefined) {
      if (!Array.isArray(personas.requiredTraits) || personas.requiredTraits.some((t) => typeof t !== "string" || t.trim().length === 0)) {
        errors.push({
          path: `${prefix}.requiredTraits`,
          message: "requiredTraits must be an array of non-empty strings when provided",
        })
      }
    }
    if (personas.enforceCoverage !== undefined && typeof personas.enforceCoverage !== "boolean") {
      errors.push({
        path: `${prefix}.enforceCoverage`,
        message: "enforceCoverage must be a boolean when provided",
      })
    }
    if (personas.minCoverageRatio !== undefined) {
      if (typeof personas.minCoverageRatio !== "number" || Number.isNaN(personas.minCoverageRatio) || personas.minCoverageRatio < 0 || personas.minCoverageRatio > 1) {
        errors.push({
          path: `${prefix}.minCoverageRatio`,
          message: "minCoverageRatio must be a number between 0.0 and 1.0",
        })
      }
    }
  }

  // Helper: validate security
  function validateSecurityItem(secItem: unknown, prefix: string) {
    if (!secItem || typeof secItem !== "object" || Array.isArray(secItem)) {
      errors.push({ path: prefix, message: `${prefix} must be an object` })
      return
    }
    const sec = secItem as Record<string, unknown>
    if (sec.schemes !== undefined) {
      if (!sec.schemes || typeof sec.schemes !== "object" || Array.isArray(sec.schemes)) {
        errors.push({ path: `${prefix}.schemes`, message: "schemes must be an object" })
      } else {
        const VALID_SCHEME_TYPES = ["http", "apiKey", "oauth2", "openIdConnect"]
        for (const [key, val] of Object.entries(sec.schemes)) {
          const schemePrefix = `${prefix}.schemes.${key}`
          if (!val || typeof val !== "object" || Array.isArray(val)) {
            errors.push({ path: schemePrefix, message: "Security scheme must be an object" })
            continue
          }
          const s = val as Record<string, unknown>
          if (typeof s.type !== "string" || !VALID_SCHEME_TYPES.includes(s.type)) {
            errors.push({
              path: `${schemePrefix}.type`,
              message: "Security scheme type must be 'http', 'apiKey', 'oauth2', or 'openIdConnect'",
            })
          }
          if (s.in !== undefined && !["header", "query", "cookie"].includes(s.in as string)) {
            errors.push({
              path: `${schemePrefix}.in`,
              message: "in must be 'header', 'query', or 'cookie' when provided",
            })
          }
        }
      }
    }
    if (sec.defaultRequirement !== undefined) {
      if (!Array.isArray(sec.defaultRequirement)) {
        errors.push({ path: `${prefix}.defaultRequirement`, message: "defaultRequirement must be an array" })
      }
    }
  }

  // Helper: validate output routing
  function validateOutputRoutingItem(item: unknown, prefix: string) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push({ path: prefix, message: `${prefix} must be an object` })
      return
    }
    const r = item as Record<string, unknown>

    if (r.pattern !== undefined) {
      if (typeof r.pattern !== "string" || r.pattern.trim().length === 0) {
        errors.push({ path: `${prefix}.pattern`, message: "pattern must be a non-empty string when provided" })
      }
    }

    if (r.byKind !== undefined) {
      if (!r.byKind || typeof r.byKind !== "object" || Array.isArray(r.byKind)) {
        errors.push({ path: `${prefix}.byKind`, message: "byKind must be an object" })
      } else {
        const bk = r.byKind as Record<string, unknown>
        for (const [k, v] of Object.entries(bk)) {
          if (!(ARTIFACT_KINDS as readonly string[]).includes(k as ArtifactKind)) {
            errors.push({
              path: `${prefix}.byKind.${k}`,
              message: `Unknown artifact kind "${k}". Must be one of: ${ARTIFACT_KINDS.map((x) => `'${x}'`).join(", ")}`,
            })
          } else if (typeof v !== "string" || v.trim().length === 0) {
            errors.push({ path: `${prefix}.byKind.${k}`, message: `${k} must be a non-empty string path template` })
          }
        }
      }
    }

    if (r.rules !== undefined) {
      if (!Array.isArray(r.rules)) {
        errors.push({ path: `${prefix}.rules`, message: "rules must be an array of OutputRoutingRule" })
      } else {
        for (let i = 0; i < r.rules.length; i++) {
          const ruleItem = r.rules[i]
          const rulePrefix = `${prefix}.rules[${i}]`
          if (!ruleItem || typeof ruleItem !== "object" || Array.isArray(ruleItem)) {
            errors.push({ path: rulePrefix, message: "Rule must be an object" })
            continue
          }
          const rule = ruleItem as Record<string, unknown>
          if (typeof rule.target !== "string" || rule.target.trim().length === 0) {
            errors.push({ path: `${rulePrefix}.target`, message: "Rule target path is required and must be a non-empty string" })
          }
          if (rule.tag !== undefined) {
            if (Array.isArray(rule.tag)) {
              if (rule.tag.length === 0 || rule.tag.some((t) => typeof t !== "string" || t.trim().length === 0)) {
                errors.push({ path: `${rulePrefix}.tag`, message: "tag must be a non-empty string or array of non-empty strings" })
              }
            } else if (typeof rule.tag !== "string" || rule.tag.trim().length === 0) {
              errors.push({ path: `${rulePrefix}.tag`, message: "tag must be a non-empty string or array of non-empty strings" })
            }
          }
          if (rule.pathPrefix !== undefined) {
            if (typeof rule.pathPrefix !== "string" || rule.pathPrefix.trim().length === 0) {
              errors.push({ path: `${rulePrefix}.pathPrefix`, message: "pathPrefix must be a non-empty string when provided" })
            }
          }
          if (rule.method !== undefined) {
            if (Array.isArray(rule.method)) {
              if (rule.method.length === 0 || rule.method.some((m) => typeof m !== "string" || m.trim().length === 0)) {
                errors.push({ path: `${rulePrefix}.method`, message: "method must be a string or array of strings" })
              }
            } else if (typeof rule.method !== "string" || rule.method.trim().length === 0) {
              errors.push({ path: `${rulePrefix}.method`, message: "method must be a string or array of strings" })
            }
          }
          if (rule.kind !== undefined) {
            const isValidKind = (k: unknown) => typeof k === "string" && (ARTIFACT_KINDS as readonly string[]).includes(k as ArtifactKind)
            if (Array.isArray(rule.kind)) {
              if (rule.kind.length === 0 || rule.kind.some((k) => !isValidKind(k))) {
                errors.push({
                  path: `${rulePrefix}.kind`,
                  message: `kind must be one of: ${ARTIFACT_KINDS.map((x) => `'${x}'`).join(", ")}`,
                })
              }
            } else if (!isValidKind(rule.kind)) {
              errors.push({
                path: `${rulePrefix}.kind`,
                message: `kind must be one of: ${ARTIFACT_KINDS.map((x) => `'${x}'`).join(", ")}`,
              })
            }
          }
          if (rule.profile !== undefined) {
            if (typeof rule.profile !== "string" || rule.profile.trim().length === 0) {
              errors.push({ path: `${rulePrefix}.profile`, message: "profile must be a non-empty string when provided" })
            }
          }
        }
      }
    }

    if (r.baseDir !== undefined) {
      if (typeof r.baseDir !== "string" || r.baseDir.trim().length === 0) {
        errors.push({ path: `${prefix}.baseDir`, message: "baseDir must be a non-empty string when provided" })
      }
    }

    if (r.importStyle !== undefined) {
      if (r.importStyle !== "relative" && r.importStyle !== "alias") {
        errors.push({
          path: `${prefix}.importStyle`,
          message: `importStyle must be 'relative' or 'alias' (received ${JSON.stringify(r.importStyle)})`,
        })
      }
    }

    if (r.tsconfigPath !== undefined) {
      if (typeof r.tsconfigPath !== "string" || r.tsconfigPath.trim().length === 0) {
        errors.push({ path: `${prefix}.tsconfigPath`, message: "tsconfigPath must be a non-empty string when provided" })
      }
    }

    if (r.manifestPath !== undefined) {
      if (typeof r.manifestPath !== "string" || r.manifestPath.trim().length === 0) {
        errors.push({ path: `${prefix}.manifestPath`, message: "manifestPath must be a non-empty string when provided" })
      }
    }

    if (r.pruneOrphans !== undefined) {
      if (typeof r.pruneOrphans !== "boolean") {
        errors.push({ path: `${prefix}.pruneOrphans`, message: "pruneOrphans must be a boolean when provided" })
      }
    }

    if (r.casing !== undefined) {
      const VALID_CASINGS = ["kebab", "camel", "pascal", "preserve"]
      if (typeof r.casing !== "string" || !VALID_CASINGS.includes(r.casing as string)) {
        errors.push({
          path: `${prefix}.casing`,
          message: `casing must be one of: 'kebab', 'camel', 'pascal', 'preserve' (received ${JSON.stringify(r.casing)})`,
        })
      }
    }
  }

  // 1. rootDir
  if (raw.rootDir !== undefined) {
    if (typeof raw.rootDir !== "string" || raw.rootDir.trim().length === 0) {
      errors.push({ path: "rootDir", message: "rootDir must be a non-empty string when provided" })
    }
  }

  // 2. archetype
  if (raw.archetype !== undefined) {
    if (typeof raw.archetype !== "string" || !(PRODUCT_LIFECYCLE_ARCHETYPES as readonly string[]).includes(raw.archetype as ProductLifecycleArchetype)) {
      errors.push({
        path: "archetype",
        message: `archetype must be one of: 'mvp', 'microservice', 'enterprise' (received ${JSON.stringify(raw.archetype)})`,
      })
    }
  }

  // 3. Shared Platform Core (raw.core)
  if (raw.core !== undefined) {
    if (!raw.core || typeof raw.core !== "object" || Array.isArray(raw.core)) {
      errors.push({ path: "core", message: "core must be an object" })
    } else {
      const core = raw.core as Record<string, unknown>

      // dialect
      if (core.dialect !== undefined) {
        if (!core.dialect || typeof core.dialect !== "object" || Array.isArray(core.dialect)) {
          errors.push({ path: "core.dialect", message: "dialect must be an object" })
        } else {
          const d = core.dialect as Record<string, unknown>
          if (d.oasVersion !== undefined && d.oasVersion !== "3.2.0" && d.oasVersion !== "3.1.0") {
            errors.push({ path: "core.dialect.oasVersion", message: "oasVersion must be '3.2.0' or '3.1.0'" })
          }
          if (d.jsonSchemaDialect !== undefined && d.jsonSchemaDialect !== "draft-2020-12") {
            errors.push({ path: "core.dialect.jsonSchemaDialect", message: "jsonSchemaDialect must be 'draft-2020-12'" })
          }
          if (d.canonicalProjection !== undefined && typeof d.canonicalProjection !== "boolean") {
            errors.push({ path: "core.dialect.canonicalProjection", message: "canonicalProjection must be a boolean" })
          }
        }
      }

      // contracts
      if (core.contracts !== undefined) {
        if (!core.contracts || typeof core.contracts !== "object" || Array.isArray(core.contracts)) {
          errors.push({ path: "core.contracts", message: "contracts must be an object" })
        } else {
          const c = core.contracts as Record<string, unknown>
          if (c.pureHandlers !== undefined && typeof c.pureHandlers !== "boolean") {
            errors.push({ path: "core.contracts.pureHandlers", message: "pureHandlers must be a boolean" })
          }
          if (c.contractName !== undefined && (typeof c.contractName !== "string" || c.contractName.trim().length === 0)) {
            errors.push({ path: "core.contracts.contractName", message: "contractName must be a non-empty string" })
          }
          if (c.namingPattern !== undefined && (typeof c.namingPattern !== "string" || c.namingPattern.trim().length === 0)) {
            errors.push({ path: "core.contracts.namingPattern", message: "namingPattern must be a non-empty string" })
          }
          if (c.outDir !== undefined && (typeof c.outDir !== "string" || c.outDir.trim().length === 0)) {
            errors.push({ path: "core.contracts.outDir", message: "outDir must be a non-empty string" })
          }
          if (c.banner !== undefined && typeof c.banner !== "boolean") {
            errors.push({ path: "core.contracts.banner", message: "banner must be a boolean" })
          }
        }
      }

      // client
      if (core.client !== undefined) {
        if (!core.client || typeof core.client !== "object" || Array.isArray(core.client)) {
          errors.push({ path: "core.client", message: "client must be an object" })
        } else {
          const cl = core.client as Record<string, unknown>
          if (cl.enabled !== undefined && typeof cl.enabled !== "boolean") {
            errors.push({ path: "core.client.enabled", message: "enabled must be a boolean" })
          }
          if (cl.wireFormatSafety !== undefined && typeof cl.wireFormatSafety !== "boolean") {
            errors.push({ path: "core.client.wireFormatSafety", message: "wireFormatSafety must be a boolean" })
          }
          if (cl.outDir !== undefined && (typeof cl.outDir !== "string" || cl.outDir.trim().length === 0)) {
            errors.push({ path: "core.client.outDir", message: "outDir must be a non-empty string" })
          }
        }
      }

      // typegen
      if (core.typegen !== undefined) {
        if (!core.typegen || typeof core.typegen !== "object" || Array.isArray(core.typegen)) {
          errors.push({ path: "core.typegen", message: "typegen must be an object" })
        } else {
          const tg = core.typegen as Record<string, unknown>
          if (tg.resolveSymbolCycles !== undefined && typeof tg.resolveSymbolCycles !== "boolean") {
            errors.push({ path: "core.typegen.resolveSymbolCycles", message: "resolveSymbolCycles must be a boolean" })
          }
          if (tg.discriminatedUnions !== undefined && typeof tg.discriminatedUnions !== "boolean") {
            errors.push({ path: "core.typegen.discriminatedUnions", message: "discriminatedUnions must be a boolean" })
          }
          if (tg.targetAdapter !== undefined && !["ts", "zod", "typia"].includes(tg.targetAdapter as string)) {
            errors.push({ path: "core.typegen.targetAdapter", message: "targetAdapter must be 'ts', 'zod', or 'typia'" })
          }
        }
      }

      // gates
      if (core.gates !== undefined) {
        if (!core.gates || typeof core.gates !== "object" || Array.isArray(core.gates)) {
          errors.push({ path: "core.gates", message: "gates must be an object" })
        } else {
          const g = core.gates as Record<string, unknown>
          if (g.driftCheck !== undefined && typeof g.driftCheck !== "boolean") {
            errors.push({ path: "core.gates.driftCheck", message: "driftCheck must be a boolean" })
          }
          if (g.failOnBreaking !== undefined && typeof g.failOnBreaking !== "boolean") {
            errors.push({ path: "core.gates.failOnBreaking", message: "failOnBreaking must be a boolean" })
          }
          if (g.baseRef !== undefined && (typeof g.baseRef !== "string" || g.baseRef.trim().length === 0)) {
            errors.push({ path: "core.gates.baseRef", message: "baseRef must be a non-empty string" })
          }
          if (g.preflightLint !== undefined && !["off", "warn", "error"].includes(g.preflightLint as string)) {
            errors.push({ path: "core.gates.preflightLint", message: "preflightLint must be 'off', 'warn', or 'error'" })
          }
        }
      }
    }
  }

  // Map to track duplicate target IDs across specs and product.specs
  const seenIds = new Map<string, number>()
  let globalSpecIndex = 0

  // 4. specs (top-level)
  if (raw.specs !== undefined) {
    if (!Array.isArray(raw.specs)) {
      errors.push({ path: "specs", message: "specs must be an array of ProfileTargetConfig" })
    } else {
      for (let i = 0; i < raw.specs.length; i++) {
        validateSpecItem(raw.specs[i], `specs[${i}]`, globalSpecIndex++, seenIds)
      }
    }
  }

  // 5. Product Domain Layer (raw.product)
  if (raw.product !== undefined) {
    if (!raw.product || typeof raw.product !== "object" || Array.isArray(raw.product)) {
      errors.push({ path: "product", message: "product must be an object" })
    } else {
      const prod = raw.product as Record<string, unknown>

      if (prod.archetype !== undefined) {
        if (typeof prod.archetype !== "string" || !(PRODUCT_LIFECYCLE_ARCHETYPES as readonly string[]).includes(prod.archetype as ProductLifecycleArchetype)) {
          errors.push({
            path: "product.archetype",
            message: `archetype must be one of: 'mvp', 'microservice', 'enterprise' (received ${JSON.stringify(prod.archetype)})`,
          })
        }
      }

      if (prod.framework !== undefined) {
        if (typeof prod.framework !== "string" || !(TARGET_FRAMEWORK_IDS as readonly string[]).includes(prod.framework as TargetFrameworkId)) {
          errors.push({
            path: "product.framework",
            message: `framework must be one of: ${TARGET_FRAMEWORK_IDS.map((t) => `'${t}'`).join(", ")} (received ${JSON.stringify(prod.framework)})`,
          })
        }
      }

      if (prod.runtime !== undefined) {
        if (typeof prod.runtime !== "string" || !(TARGET_RUNTIMES as readonly string[]).includes(prod.runtime as TargetRuntime)) {
          errors.push({
            path: "product.runtime",
            message: `runtime must be one of: 'node', 'bun' (received ${JSON.stringify(prod.runtime)})`,
          })
        }
      }

      if (prod.jitSchema !== undefined && typeof prod.jitSchema !== "boolean") {
        errors.push({ path: "product.jitSchema", message: "jitSchema must be a boolean when provided" })
      }

      if (prod.zeroCopy !== undefined && typeof prod.zeroCopy !== "boolean") {
        errors.push({ path: "product.zeroCopy", message: "zeroCopy must be a boolean when provided" })
      }

      if (prod.specs !== undefined) {
        if (!Array.isArray(prod.specs)) {
          errors.push({ path: "product.specs", message: "specs must be an array of ProfileTargetConfig" })
        } else {
          for (let i = 0; i < prod.specs.length; i++) {
            validateSpecItem(prod.specs[i], `product.specs[${i}]`, globalSpecIndex++, seenIds)
          }
        }
      }

      if (prod.guards !== undefined) {
        validateGuardsItem(prod.guards, "product.guards")
      }

      if (prod.contextInjection !== undefined) {
        validateContextInjectionItem(prod.contextInjection, "product.contextInjection")
      }

      if (prod.personas !== undefined) {
        validatePersonasItem(prod.personas, "product.personas")
      }

      if (prod.security !== undefined) {
        validateSecurityItem(prod.security, "product.security")
      }

      if (prod.outputRouting !== undefined) {
        validateOutputRoutingItem(prod.outputRouting, "product.outputRouting")
      }
    }
  }

  // 6. Root aliases for backward compatibility & flattened ergonomics
  if (raw.guards !== undefined) {
    validateGuardsItem(raw.guards, "guards")
  }

  if (raw.framework !== undefined) {
    if (typeof raw.framework !== "string" || !(TARGET_FRAMEWORK_IDS as readonly string[]).includes(raw.framework as TargetFrameworkId)) {
      errors.push({
        path: "framework",
        message: `framework must be one of: ${TARGET_FRAMEWORK_IDS.map((t) => `'${t}'`).join(", ")} (received ${JSON.stringify(raw.framework)})`,
      })
    }
  }

  if (raw.runtime !== undefined) {
    if (typeof raw.runtime !== "string" || !(TARGET_RUNTIMES as readonly string[]).includes(raw.runtime as TargetRuntime)) {
      errors.push({
        path: "runtime",
        message: `runtime must be one of: 'node', 'bun' (received ${JSON.stringify(raw.runtime)})`,
      })
    }
  }

  if (raw.contextInjection !== undefined) {
    validateContextInjectionItem(raw.contextInjection, "contextInjection")
  }

  if (raw.personas !== undefined) {
    validatePersonasItem(raw.personas, "personas")
  }

  if (raw.security !== undefined) {
    validateSecurityItem(raw.security, "security")
  }

  if (raw.outputRouting !== undefined) {
    validateOutputRoutingItem(raw.outputRouting, "outputRouting")
  }

  // 7. Legacy schemas & output options
  if (raw.schemas !== undefined) {
    if (!raw.schemas || typeof raw.schemas !== "object" || Array.isArray(raw.schemas)) {
      errors.push({ path: "schemas", message: "schemas must be a record map of Zod schemas" })
    }
  }

  if (raw.grouping !== undefined && raw.grouping !== "single" && raw.grouping !== "per-schema") {
    errors.push({ path: "grouping", message: "grouping must be 'single' or 'per-schema'" })
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return {
    valid: true,
    errors: [],
    config: raw as unknown as OaConfig,
  }
}

/**
 * Asserts that a value is a valid OaConfig, throwing an OaConfigError if invalid.
 */
export function assertOaConfig(config: unknown): asserts config is OaConfig {
  const result = validateOaConfig(config)
  if (!result.valid) {
    const formatted = result.errors
      .map((e) => (e.path ? `  - ${e.path}: ${e.message}` : `  - ${e.message}`))
      .join("\n")
    throw new OaConfigError(`Invalid oa-gen configuration:\n${formatted}`, result.errors)
  }
}

/**
 * Type guard checking if a value is a valid OaConfig.
 */
export function isOaConfig(config: unknown): config is OaConfig {
  return validateOaConfig(config).valid
}

/**
 * Defines specification and governance configuration for oa.config.ts with full type safety
 * and runtime validation.
 */
export function defineConfig(config: OaConfig): OaConfig {
  return config
}
