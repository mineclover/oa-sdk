import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import type { OasDocument, ParsedDocument } from '@oa-sdk/parser/browser'
import { isParsedDocument, parseDocument } from '@oa-sdk/parser/browser'
import * as liveConfig from '../../../config.js'

// ============================================================================
// Types & Enums
// ============================================================================

export const PRODUCT_LIFECYCLE_ARCHETYPES = ['mvp', 'microservice', 'enterprise'] as const
export type ProductLifecycleArchetype = (typeof PRODUCT_LIFECYCLE_ARCHETYPES)[number]

export const TARGET_FRAMEWORK_IDS = [
  'fastify',
  'elysia',
  'hono',
  'express',
  'nestjs',
  'generic',
] as const
export type TargetFrameworkId = (typeof TARGET_FRAMEWORK_IDS)[number]

export const TARGET_RUNTIMES = ['node', 'bun'] as const
export type TargetRuntime = (typeof TARGET_RUNTIMES)[number]

export const OPENAPI_PROJECTION_PROFILES = [
  'component-bundle',
  'operation-contract',
  'full-api-document',
] as const
export type OpenApiProjectionProfile = (typeof OPENAPI_PROJECTION_PROFILES)[number]

export interface SharedPlatformDialectConfig {
  oasVersion?: '3.2.0' | '3.1.0' | undefined
  jsonSchemaDialect?: 'draft-2020-12' | undefined
  canonicalProjection?: boolean | undefined
}

export interface SharedPlatformContractsConfig {
  pureHandlers?: boolean | undefined
  contractName?: string | undefined
  namingPattern?: string | undefined
  outDir?: string | undefined
  banner?: boolean | undefined
}

export interface SharedPlatformClientConfig {
  enabled?: boolean | undefined
  wireFormatSafety?: boolean | undefined
  outDir?: string | undefined
}

export interface SharedPlatformTypegenConfig {
  resolveSymbolCycles?: boolean | undefined
  discriminatedUnions?: boolean | undefined
  targetAdapter?: 'ts' | 'zod' | 'typia' | undefined
}

export interface SharedPlatformGatesConfig {
  driftCheck?: boolean | undefined
  failOnBreaking?: boolean | undefined
  baseRef?: string | undefined
  preflightLint?: 'off' | 'warn' | 'error' | undefined
}

export interface SharedPlatformCoreConfig {
  dialect?: SharedPlatformDialectConfig | undefined
  contracts?: SharedPlatformContractsConfig | undefined
  client?: SharedPlatformClientConfig | undefined
  typegen?: SharedPlatformTypegenConfig | undefined
  gates?: SharedPlatformGatesConfig | undefined
}

export interface HandlerContextInjectionConfig {
  typeName: string
  importPath: string
  propertyKey?: string | undefined
  fields?: string[] | undefined
}

export interface ProductSecurityScheme {
  type: 'http' | 'apiKey' | 'oauth2' | 'openIdConnect'
  scheme?: string | undefined
  bearerFormat?: string | undefined
  in?: 'header' | 'query' | 'cookie' | undefined
  name?: string | undefined
  description?: string | undefined
  flows?: Record<string, unknown> | undefined
}

export interface ProductSecurityConfig {
  schemes?: Record<string, ProductSecurityScheme> | undefined
  defaultRequirement?: Array<Record<string, string[]>> | undefined
}

export interface PersonaGovernanceConfig {
  registryPath?: string | undefined
  requiredTraits?: string[] | undefined
  enforceCoverage?: boolean | undefined
  minCoverageRatio?: number | undefined
}

export interface ProfileTargetConfig {
  id: string
  schemaEntry: string
  outDir: string
  profile?: OpenApiProjectionProfile | undefined
  target?: TargetFrameworkId | undefined
  title?: string | undefined
  version?: string | undefined
  tags?: string[] | undefined
}

export interface GuardTargetConfig {
  outDir: string
  split?: boolean | undefined
  moduleFormat?: 'esm' | 'cjs' | undefined
  auditCsp?: boolean | undefined
}

export interface ProductDomainConfig {
  archetype?: ProductLifecycleArchetype | undefined
  framework?: TargetFrameworkId | undefined
  runtime?: TargetRuntime | undefined
  jitSchema?: boolean | undefined
  zeroCopy?: boolean | undefined
  specs?: ProfileTargetConfig[] | undefined
  guards?: GuardTargetConfig | undefined
  contextInjection?: HandlerContextInjectionConfig | undefined
  security?: ProductSecurityConfig | undefined
  personas?: PersonaGovernanceConfig | undefined
}

export interface OaConfig {
  rootDir?: string | undefined
  archetype?: ProductLifecycleArchetype | undefined
  core?: SharedPlatformCoreConfig | undefined
  product?: ProductDomainConfig | undefined
  specs?: ProfileTargetConfig[] | undefined
  guards?: GuardTargetConfig | undefined
  schemas?: Record<string, z.ZodTypeAny> | undefined
  framework?: TargetFrameworkId | undefined
  runtime?: TargetRuntime | undefined
  contextInjection?: HandlerContextInjectionConfig | undefined
  personas?: PersonaGovernanceConfig | undefined
  security?: ProductSecurityConfig | undefined
  output?: string | undefined
  grouping?: 'single' | 'per-schema' | undefined
  filename?: string | undefined
}

export interface ResolvedOaConfig extends OaConfig {
  archetype: ProductLifecycleArchetype
  core: Required<SharedPlatformCoreConfig>
  product: ProductDomainConfig
}

export interface ConfigValidationError {
  path: string
  message: string
}

export interface ConfigValidationResult {
  valid: boolean
  errors: ConfigValidationError[]
  config?: OaConfig | undefined
}

// ============================================================================
// Reference Zod Schemas
// ============================================================================

export const productLifecycleArchetypeSchema = z.enum(PRODUCT_LIFECYCLE_ARCHETYPES)
export const targetFrameworkIdSchema = z.enum(TARGET_FRAMEWORK_IDS)
export const targetRuntimeSchema = z.enum(TARGET_RUNTIMES)

export const sharedPlatformDialectConfigSchema = z.object({
  oasVersion: z.enum(['3.2.0', '3.1.0']).optional(),
  jsonSchemaDialect: z.literal('draft-2020-12').optional(),
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
  targetAdapter: z.enum(['ts', 'zod', 'typia']).optional(),
})

export const sharedPlatformGatesConfigSchema = z.object({
  driftCheck: z.boolean().optional(),
  failOnBreaking: z.boolean().optional(),
  baseRef: z.string().min(1).optional(),
  preflightLint: z.enum(['off', 'warn', 'error']).optional(),
})

export const sharedPlatformCoreConfigSchema = z.object({
  dialect: sharedPlatformDialectConfigSchema.optional(),
  contracts: sharedPlatformContractsConfigSchema.optional(),
  client: sharedPlatformClientConfigSchema.optional(),
  typegen: sharedPlatformTypegenConfigSchema.optional(),
  gates: sharedPlatformGatesConfigSchema.optional(),
})

export const handlerContextInjectionConfigSchema = z.object({
  typeName: z.string().min(1, 'contextInjection.typeName is required'),
  importPath: z.string().min(1, 'contextInjection.importPath is required'),
  propertyKey: z.string().min(1).optional(),
  fields: z.array(z.string().min(1)).optional(),
})

export const personaGovernanceConfigSchema = z.object({
  registryPath: z.string().min(1).optional(),
  requiredTraits: z.array(z.string().min(1)).optional(),
  enforceCoverage: z.boolean().optional(),
  minCoverageRatio: z.number().min(0).max(1).optional(),
})

export const profileTargetConfigSchema = z.object({
  id: z.string().min(1, 'Target id is required and must be a non-empty string'),
  schemaEntry: z.string().min(1, 'schemaEntry is required and must be a non-empty string'),
  outDir: z.string().min(1, 'outDir is required and must be a non-empty string'),
  profile: z.enum(OPENAPI_PROJECTION_PROFILES).optional().default('full-api-document'),
  target: targetFrameworkIdSchema.optional(),
  title: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
})

export const guardTargetConfigSchema = z.object({
  outDir: z.string().min(1),
  split: z.boolean().optional(),
  moduleFormat: z.enum(['esm', 'cjs']).optional(),
  auditCsp: z.boolean().optional(),
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
  personas: personaGovernanceConfigSchema.optional(),
})

export const oaConfigMasterSchema = z
  .object({
    rootDir: z.string().min(1).optional(),
    archetype: productLifecycleArchetypeSchema.optional(),
    core: sharedPlatformCoreConfigSchema.optional(),
    product: productDomainConfigSchema.optional(),
    specs: z.array(profileTargetConfigSchema).optional(),
    guards: guardTargetConfigSchema.optional(),
    schemas: z.record(z.string(), z.custom<z.ZodTypeAny>()).optional(),
    framework: targetFrameworkIdSchema.optional(),
    runtime: targetRuntimeSchema.optional(),
    contextInjection: handlerContextInjectionConfigSchema.optional(),
    personas: personaGovernanceConfigSchema.optional(),
    output: z.string().optional(),
    grouping: z.enum(['single', 'per-schema']).optional(),
    filename: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const combinedSpecs = [...(data.specs ?? []), ...(data.product?.specs ?? [])]
    if (combinedSpecs.length > 0) {
      const seen = new Map<string, number>()
      for (let i = 0; i < combinedSpecs.length; i++) {
        const spec = combinedSpecs[i]
        if (!spec) continue
        if (seen.has(spec.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate spec target id "${spec.id}" at index ${i} (already declared at index ${seen.get(spec.id)})`,
            path: ['specs', i, 'id'],
          })
        } else {
          seen.set(spec.id, i)
        }
      }
    }
  })

// ============================================================================
// Archetype Defaults & Resolvers (Oracle & Live Delegation)
// ============================================================================

export function getArchetypeDefaults(archetype: ProductLifecycleArchetype): {
  core: Required<SharedPlatformCoreConfig>
  product: Partial<ProductDomainConfig>
} {
  // Delegate to live implementation if available
  if (typeof (liveConfig as any).getArchetypeDefaults === 'function') {
    return (liveConfig as any).getArchetypeDefaults(archetype)
  }

  switch (archetype) {
    case 'mvp':
      return {
        core: {
          dialect: { oasVersion: '3.2.0', jsonSchemaDialect: 'draft-2020-12', canonicalProjection: true },
          contracts: { pureHandlers: true, contractName: 'ApiHandlers', namingPattern: '[id].contract.ts', outDir: './src/generated', banner: true },
          client: { enabled: true, wireFormatSafety: false, outDir: './src/client' },
          typegen: { resolveSymbolCycles: false, discriminatedUnions: true, targetAdapter: 'ts' },
          gates: { driftCheck: false, failOnBreaking: false, baseRef: 'origin/main', preflightLint: 'warn' },
        },
        product: {
          jitSchema: false,
          zeroCopy: false,
        },
      }
    case 'microservice':
      return {
        core: {
          dialect: { oasVersion: '3.2.0', jsonSchemaDialect: 'draft-2020-12', canonicalProjection: true },
          contracts: { pureHandlers: true, contractName: 'ApiHandlers', namingPattern: '[id].contract.ts', outDir: './src/generated', banner: true },
          client: { enabled: true, wireFormatSafety: true, outDir: './src/client' },
          typegen: { resolveSymbolCycles: true, discriminatedUnions: true, targetAdapter: 'ts' },
          gates: { driftCheck: true, failOnBreaking: false, baseRef: 'origin/main', preflightLint: 'error' },
        },
        product: {
          jitSchema: true,
          zeroCopy: true,
        },
      }
    case 'enterprise':
      return {
        core: {
          dialect: { oasVersion: '3.2.0', jsonSchemaDialect: 'draft-2020-12', canonicalProjection: true },
          contracts: { pureHandlers: true, contractName: 'ApiHandlers', namingPattern: '[id].contract.ts', outDir: './src/generated', banner: true },
          client: { enabled: true, wireFormatSafety: true, outDir: './src/client' },
          typegen: { resolveSymbolCycles: true, discriminatedUnions: true, targetAdapter: 'ts' },
          gates: { driftCheck: true, failOnBreaking: true, baseRef: 'origin/main', preflightLint: 'error' },
        },
        product: {
          jitSchema: true,
          zeroCopy: true,
          personas: { enforceCoverage: true, minCoverageRatio: 0.8 },
        },
      }
  }
}

export function resolveConfigWithDefaults(config: OaConfig): ResolvedOaConfig {
  if (typeof (liveConfig as any).resolveConfigWithDefaults === 'function') {
    return (liveConfig as any).resolveConfigWithDefaults(config)
  }

  const archetype = config.archetype ?? config.product?.archetype ?? 'microservice'
  const defaults = getArchetypeDefaults(archetype)

  const mergedCore: Required<SharedPlatformCoreConfig> = {
    dialect: { ...defaults.core.dialect, ...config.core?.dialect },
    contracts: { ...defaults.core.contracts, ...config.core?.contracts },
    client: { ...defaults.core.client, ...config.core?.client },
    typegen: { ...defaults.core.typegen, ...config.core?.typegen },
    gates: { ...defaults.core.gates, ...config.core?.gates },
  }

  const specs = (config.specs ?? config.product?.specs ?? []).map(s => ({
    ...s,
    profile: s.profile ?? ('full-api-document' as const),
  }))
  const guards = config.guards ?? config.product?.guards
  const framework = config.framework ?? config.product?.framework
  const runtime = config.runtime ?? config.product?.runtime
  const contextInjection = config.contextInjection ?? config.product?.contextInjection
  const personas = config.personas ?? config.product?.personas
  const security = config.security ?? config.product?.security

  const mergedProduct: ProductDomainConfig = {
    archetype,
    framework,
    runtime,
    specs,
    ...(guards !== undefined ? { guards } : {}),
    ...(contextInjection !== undefined ? { contextInjection } : {}),
    ...(personas !== undefined ? { personas } : {}),
    ...(security !== undefined ? { security } : {}),
    jitSchema: config.product?.jitSchema ?? defaults.product.jitSchema,
    zeroCopy: config.product?.zeroCopy ?? defaults.product.zeroCopy,
  }

  return {
    ...config,
    archetype,
    core: mergedCore,
    product: mergedProduct,
    specs,
    guards,
  }
}

export function validateDualLayerConfig(value: unknown): ConfigValidationResult {
  const parseResult = oaConfigMasterSchema.safeParse(value)
  if (!parseResult.success) {
    const errors: ConfigValidationError[] = parseResult.error.issues.map(issue => ({
      path: issue.path.join('.'),
      message: issue.message,
    }))
    return { valid: false, errors }
  }
  return { valid: true, errors: [], config: parseResult.data as OaConfig }
}

// ============================================================================
// Archetype Scripts & Composition Oracle
// ============================================================================

export function getRecommendedScriptsForPair(
  framework: TargetFrameworkId,
  archetype: ProductLifecycleArchetype,
  runtime: TargetRuntime,
): Record<string, string> {
  const scripts: Record<string, string> = {}

  // 1. Framework application script
  if (framework === 'fastify') {
    scripts['dev'] = 'tsx watch src/server.ts'
    scripts['build'] = 'tsc'
    scripts['generate:router'] = 'oa-gen generate --target fastify'
  } else if (framework === 'elysia') {
    scripts['dev'] = 'bun --watch src/index.ts'
    scripts['generate:router'] = 'bun x oa-gen generate --target elysia'
  } else if (framework === 'hono') {
    if (runtime === 'bun') {
      scripts['dev'] = 'bun --watch src/index.ts'
      scripts['generate:router'] = 'bun x oa-gen generate --target hono'
    } else {
      scripts['dev'] = 'tsx watch src/index.ts'
      scripts['build'] = 'tsc'
      scripts['generate:router'] = 'oa-gen generate --target hono'
    }
  } else if (framework === 'express') {
    scripts['dev'] = 'tsx watch src/app.ts'
    scripts['build'] = 'tsc'
    scripts['generate:router'] = 'oa-gen generate --target express'
  } else if (framework === 'nestjs') {
    scripts['start:dev'] = 'nest start --watch'
    scripts['generate:contract'] = 'oa-gen generate --target generic'
  } else {
    scripts['generate'] = 'oa-gen generate'
  }

  // 2. Lifecycle Archetype scripts
  if (archetype === 'mvp') {
    if (runtime === 'bun') {
      scripts['mock'] = 'bun x oa-gen mock --watch'
      scripts['generate:client'] = 'bun x oa-gen generate --target client'
      scripts['validate'] = 'bun x oa-gen validate'
    } else {
      scripts['mock'] = 'oa-gen mock --watch'
      scripts['generate:client'] = 'oa-gen generate --target client'
      scripts['validate'] = 'oa-gen validate'
    }
  } else if (archetype === 'microservice') {
    if (runtime === 'bun') {
      scripts['generate:contract'] = 'bun x oa-gen generate --target contract'
      scripts['test:contract'] = 'bun test src/__tests__/contracts'
      scripts['audit:wire'] = 'bun x oa-gen audit:shape --strict'
      scripts['mock'] = 'bun x oa-gen mock --watch'
    } else {
      scripts['generate:contract'] = 'oa-gen generate --target contract'
      scripts['test:contract'] = 'vitest run src/__tests__/contracts'
      scripts['audit:wire'] = 'oa-gen audit:shape --strict'
      scripts['mock'] = 'oa-gen mock --watch'
    }
  } else if (archetype === 'enterprise') {
    if (runtime === 'bun') {
      scripts['diff'] = 'bun x oa-gen diff --base origin/main --head HEAD --fail-on-breaking'
      scripts['lint:spec'] = 'bun x oa-gen lint --categories structure,refs,components,semantics'
      scripts['audit:csp'] = 'bun x oa-gen audit:csp --bundle ./dist'
      scripts['audit:shape'] = 'bun x oa-gen audit:shape --fail-on-unsupported'
      scripts['personas:check'] = 'bun x oa-gen personas:check'
      scripts['ci:gate'] = 'bun x oa-gen diff --base origin/main --fail-on-breaking && bun x oa-gen validate --require-32'
    } else {
      scripts['diff'] = 'oa-gen diff --base origin/main --head HEAD --fail-on-breaking'
      scripts['lint:spec'] = 'oa-gen lint --categories structure,refs,components,semantics'
      scripts['audit:csp'] = 'oa-gen audit:csp --bundle ./dist'
      scripts['audit:shape'] = 'oa-gen audit:shape --fail-on-unsupported'
      scripts['personas:check'] = 'oa-gen personas:check'
      scripts['ci:gate'] = 'oa-gen diff --base origin/main --fail-on-breaking && oa-gen validate --require-32'
    }
  }

  return scripts
}

/**
 * Where the onboarded project installs `@oa-sdk` packages from: the npm
 * `registry`, or the pnpm `workspace` it is a member of, which has every
 * `@oa-sdk` package as a member (the oa-sdk repository itself).
 */
export type OaSdkInstallSource = 'registry' | 'workspace'

/** `@oa-sdk` packages that are never published, so only a workspace containing them provides them. */
const PRIVATE_OA_SDK_PACKAGES = new Set(['@oa-sdk/personas'])

const CODEGEN_PACKAGE_DIR = path.resolve(__dirname, '../../../..')

/**
 * The release of `name` this codegen is built and tested against: codegen's
 * own version, or the version of the package linked into its node_modules.
 */
export function builtAgainstVersion(name: string): string {
  const manifest = name === '@oa-sdk/codegen'
    ? path.join(CODEGEN_PACKAGE_DIR, 'package.json')
    : path.join(CODEGEN_PACKAGE_DIR, 'node_modules', name, 'package.json')
  return (JSON.parse(fs.readFileSync(manifest, 'utf8')) as { version: string }).version
}

/**
 * Specifier `oa-gen init` writes for `name`: the workspace protocol inside the
 * workspace, the releases compatible with the built-against version from the
 * registry, and nothing for a private package outside the workspace.
 */
export function expectedOaSdkSpecifier(name: string, source: OaSdkInstallSource): string | undefined {
  if (source === 'workspace') return 'workspace:*'
  if (PRIVATE_OA_SDK_PACKAGES.has(name)) return undefined
  return `^${builtAgainstVersion(name)}`
}

export function getRecommendedDevDepsForPair(
  framework: TargetFrameworkId,
  archetype: ProductLifecycleArchetype,
  runtime: TargetRuntime,
  source: OaSdkInstallSource = 'registry',
): Record<string, string> {
  const deps: Record<string, string> = {}
  const addOaSdk = (name: string) => {
    const specifier = expectedOaSdkSpecifier(name, source)
    if (specifier !== undefined) deps[name] = specifier
  }

  addOaSdk('@oa-sdk/codegen')

  if (framework !== 'generic') {
    addOaSdk('@oa-sdk/router')
  }

  if (runtime === 'bun') {
    deps['@types/bun'] = 'latest'
  } else {
    deps['@types/node'] = '^20.0.0'
    deps['typescript'] = '^5.4.0'
    deps['tsx'] = '^4.7.0'
  }

  if (archetype === 'mvp') {
    addOaSdk('@oa-sdk/client')
    addOaSdk('@oa-sdk/mock-server')
  } else if (archetype === 'microservice') {
    addOaSdk('@oa-sdk/core')
    if (runtime === 'node') {
      deps['vitest'] = '^1.6.0'
    }
  } else if (archetype === 'enterprise') {
    addOaSdk('@oa-sdk/core')
    addOaSdk('@oa-sdk/personas')
  }

  return deps
}

// ============================================================================
// Handler Contract Generic Context Generator (Oracle & Live Verification)
// ============================================================================

export interface GenerateHandlerContractOptions {
  typesImport?: string | undefined
  banner?: boolean | undefined
  contractName?: string | undefined
  contextImport?: string | undefined
  contextTypeName?: string | undefined
}

export function generateHandlerContractWithContext(
  spec: OasDocument | ParsedDocument,
  options: GenerateHandlerContractOptions = {},
): string {
  const doc = isParsedDocument(spec) ? spec : parseDocument(spec)
  const {
    typesImport,
    banner = true,
    contractName = 'ApiHandlers',
    contextImport,
    contextTypeName,
  } = options

  const lines: string[] = []

  if (banner) {
    lines.push('// Auto-generated handler contracts from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/router')
    lines.push('')
  }

  if (typesImport) {
    lines.push(`import type * as Types from '${typesImport}'`)
  }
  if (contextImport && contextTypeName) {
    lines.push(`import type { ${contextTypeName} } from '${contextImport}'`)
  }
  if (typesImport || (contextImport && contextTypeName)) {
    lines.push('')
  }

  lines.push('export type HandlerResponse<TBody = unknown, THeaders = Record<string, string>> =')
  lines.push('  | TBody')
  lines.push('  | { status?: number; body: TBody; headers?: THeaders }')
  lines.push('')

  const defaultContextGeneric = contextTypeName ? contextTypeName : 'unknown'

  for (const op of doc.operations) {
    const opId = op.operationId ?? `${op.method}_${op.openApiPath}`
    const baseName = opId.charAt(0).toUpperCase() + opId.slice(1)

    lines.push(`export interface ${baseName}Context<TContext = ${defaultContextGeneric}> {`)
    lines.push(`  params?: Record<string, string>`)
    lines.push(`  query?: Record<string, unknown>`)
    lines.push(`  headers?: Record<string, string>`)
    lines.push(`  body?: unknown`)
    lines.push(`  context?: TContext`)
    lines.push(`}`)
    lines.push('')

    lines.push(`export type ${baseName}Handler<TContext = ${defaultContextGeneric}> = (`)
    lines.push(`  ctx: ${baseName}Context<TContext>,`)
    lines.push(`) => HandlerResponse<unknown> | Promise<HandlerResponse<unknown>>`)
    lines.push('')
  }

  lines.push(`export interface ${contractName}<TContext = ${defaultContextGeneric}> {`)
  for (const op of doc.operations) {
    const opId = op.operationId ?? `${op.method}_${op.openApiPath}`
    const baseName = opId.charAt(0).toUpperCase() + opId.slice(1)
    lines.push(`  ${opId}: ${baseName}Handler<TContext>`)
  }
  lines.push(`}`)

  return lines.join('\n')
}
