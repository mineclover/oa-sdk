/**
 * @oa-sdk/codegen — Declarative Specification & Governance Configuration
 *
 * Defines the configuration schema and helper functions for oa.config.ts / oa.config.json.
 */

import { z } from 'zod'
import type { OutputOptions } from './types.js'

/**
 * Supported OpenAPI projection profiles conforming to @oa-sdk/openapi-projection-contract.
 */
export const OPENAPI_PROJECTION_PROFILES = [
  'component-bundle',
  'operation-contract',
  'full-api-document',
] as const

export type OpenApiProjectionProfile = (typeof OPENAPI_PROJECTION_PROFILES)[number]

/**
 * Domain profile specification target configuration.
 */
export interface ProfileTargetConfig {
  /** Unique target identifier (e.g. 'devlink-contracts', 'surface-engine') */
  id: string
  /** OpenAPI projection profile type */
  profile: OpenApiProjectionProfile
  /** Path to source schema file or module (e.g. 'packages/surface-engine/src/types/schemas.ts') */
  schemaEntry: string
  /** Target output directory for generated artifacts (e.g. 'artifacts/specs') */
  outDir: string
  /** Optional document title override (e.g. 'Surface Engine Component Bundle') */
  title?: string | undefined
  /** Optional specification version (e.g. '1.0.0') */
  version?: string | undefined
}

/**
 * Standalone type guard compilation configuration.
 */
export interface GuardTargetConfig {
  /** Target output directory where compiled guards will be emitted (e.g. 'dist/guards') */
  outDir: string
  /** Whether to output individual modular guard files alongside root index.js */
  split?: boolean | undefined
  /** Target module format for emitted guards. Defaults to 'esm'. */
  moduleFormat?: 'esm' | 'cjs' | undefined
  /** Whether to audit emitted guards for Content Security Policy (CSP) compliance */
  auditCsp?: boolean | undefined
}

/**
 * Root specification and governance configuration for oa-sdk.
 */
export interface OaConfig extends Partial<OutputOptions> {
  /** Base directory for relative path resolution (defaults to directory of config file) */
  rootDir?: string | undefined
  /** Array of domain profile specification targets */
  specs?: ProfileTargetConfig[] | undefined
  /** Standalone type guard generation configuration */
  guards?: GuardTargetConfig | undefined
  /** Legacy Zod schema map for backward compatibility */
  schemas?: Record<string, z.ZodTypeAny> | undefined
}

/** Legacy type alias for backward compatibility */
export type CodegenConfig = OaConfig

/**
 * Validation error issue descriptor.
 */
export interface ConfigValidationError {
  /** Property path of the invalid configuration field (e.g. 'specs[0].id') */
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
    this.name = 'OaConfigError'
    this.errors = errors
  }
}

// ============================================================================
// Zod Master Schemas for Config Introspection & OpenAPI / Schema Export
// ============================================================================

export const profileTargetConfigSchema = z.object({
  id: z.string().min(1, 'Target id is required and must be a non-empty string'),
  profile: z.enum(OPENAPI_PROJECTION_PROFILES, {
    message: "profile must be one of: 'component-bundle', 'operation-contract', 'full-api-document'",
  }),
  schemaEntry: z.string().min(1, 'schemaEntry is required and must be a non-empty string'),
  outDir: z.string().min(1, 'outDir is required and must be a non-empty string'),
  title: z.string().min(1, 'title must be a non-empty string when provided').optional(),
  version: z.string().min(1, 'version must be a non-empty string when provided').optional(),
})

export const guardTargetConfigSchema = z.object({
  outDir: z.string().min(1, 'outDir is required and must be a non-empty string'),
  split: z.boolean().optional(),
  moduleFormat: z.enum(['esm', 'cjs'], {
    message: "moduleFormat must be 'esm' or 'cjs'",
  }).optional(),
  auditCsp: z.boolean().optional(),
})

export const oaConfigSchema = z
  .object({
    rootDir: z.string().min(1, 'rootDir must be a non-empty string when provided').optional(),
    specs: z.array(profileTargetConfigSchema).optional(),
    guards: guardTargetConfigSchema.optional(),
    schemas: z.record(z.string(), z.custom<z.ZodTypeAny>()).optional(),
    // Legacy OutputOptions fields
    output: z.string().optional(),
    grouping: z.enum(['single', 'per-schema']).optional(),
    filename: z.string().optional(),
    mergeIntoSpec: z.boolean().optional(),
    specPath: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // Check duplicate target IDs
    if (data.specs && data.specs.length > 0) {
      const seen = new Map<string, number>()
      for (let i = 0; i < data.specs.length; i++) {
        const spec = data.specs[i]
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
// Runtime Validation and Assertion Utilities
// ============================================================================

/**
 * Validates an arbitrary input against the OaConfig specification.
 * Returns a detailed report of errors without throwing.
 */
export function validateOaConfig(config: unknown): ConfigValidationResult {
  const errors: ConfigValidationError[] = []

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {
      valid: false,
      errors: [{ path: '', message: 'Configuration must be a non-null object' }],
    }
  }

  const raw = config as Record<string, unknown>

  // 1. rootDir
  if (raw.rootDir !== undefined) {
    if (typeof raw.rootDir !== 'string' || raw.rootDir.trim().length === 0) {
      errors.push({ path: 'rootDir', message: 'rootDir must be a non-empty string when provided' })
    }
  }

  // 2. specs
  let hasSpecs = false
  if (raw.specs !== undefined) {
    if (!Array.isArray(raw.specs)) {
      errors.push({ path: 'specs', message: 'specs must be an array of ProfileTargetConfig' })
    } else {
      if (raw.specs.length > 0) {
        hasSpecs = true
      }
      const seenIds = new Map<string, number>()
      for (let i = 0; i < raw.specs.length; i++) {
        const item = raw.specs[i]
        const prefix = `specs[${i}]`

        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          errors.push({ path: prefix, message: 'Spec target must be an object' })
          continue
        }

        const spec = item as Record<string, unknown>

        // id
        if (typeof spec.id !== 'string' || spec.id.trim().length === 0) {
          errors.push({ path: `${prefix}.id`, message: 'Target id is required and must be a non-empty string' })
        } else {
          if (seenIds.has(spec.id)) {
            errors.push({
              path: `${prefix}.id`,
              message: `Duplicate spec target id "${spec.id}" at index ${i} (already declared at index ${seenIds.get(spec.id)})`,
            })
          } else {
            seenIds.set(spec.id, i)
          }
        }

        // profile
        if (
          typeof spec.profile !== 'string' ||
          !(OPENAPI_PROJECTION_PROFILES as readonly string[]).includes(spec.profile)
        ) {
          errors.push({
            path: `${prefix}.profile`,
            message: `profile is required and must be one of: 'component-bundle', 'operation-contract', 'full-api-document' (received ${JSON.stringify(spec.profile)})`,
          })
        }

        // schemaEntry
        if (typeof spec.schemaEntry !== 'string' || spec.schemaEntry.trim().length === 0) {
          errors.push({
            path: `${prefix}.schemaEntry`,
            message: 'schemaEntry is required and must be a non-empty string',
          })
        }

        // outDir
        if (typeof spec.outDir !== 'string' || spec.outDir.trim().length === 0) {
          errors.push({
            path: `${prefix}.outDir`,
            message: 'outDir is required and must be a non-empty string',
          })
        }

        // title (optional)
        if (spec.title !== undefined && (typeof spec.title !== 'string' || spec.title.trim().length === 0)) {
          errors.push({
            path: `${prefix}.title`,
            message: 'title must be a non-empty string when provided',
          })
        }

        // version (optional)
        if (spec.version !== undefined && (typeof spec.version !== 'string' || spec.version.trim().length === 0)) {
          errors.push({
            path: `${prefix}.version`,
            message: 'version must be a non-empty string when provided',
          })
        }
      }
    }
  }

  // 3. guards
  let hasGuards = false
  if (raw.guards !== undefined) {
    if (!raw.guards || typeof raw.guards !== 'object' || Array.isArray(raw.guards)) {
      errors.push({ path: 'guards', message: 'guards must be an object' })
    } else {
      hasGuards = true
      const guards = raw.guards as Record<string, unknown>

      // outDir
      if (typeof guards.outDir !== 'string' || guards.outDir.trim().length === 0) {
        errors.push({ path: 'guards.outDir', message: 'outDir is required and must be a non-empty string' })
      }

      // split
      if (guards.split !== undefined && typeof guards.split !== 'boolean') {
        errors.push({ path: 'guards.split', message: 'split must be a boolean when provided' })
      }

      // moduleFormat
      if (guards.moduleFormat !== undefined) {
        if (guards.moduleFormat !== 'esm' && guards.moduleFormat !== 'cjs') {
          errors.push({
            path: 'guards.moduleFormat',
            message: `moduleFormat must be 'esm' or 'cjs' (received ${JSON.stringify(guards.moduleFormat)})`,
          })
        }
      }

      // auditCsp
      if (guards.auditCsp !== undefined && typeof guards.auditCsp !== 'boolean') {
        errors.push({ path: 'guards.auditCsp', message: 'auditCsp must be a boolean when provided' })
      }
    }
  }

  // 4. legacy schemas & output
  let hasSchemas = false
  if (raw.schemas !== undefined) {
    if (!raw.schemas || typeof raw.schemas !== 'object' || Array.isArray(raw.schemas)) {
      errors.push({ path: 'schemas', message: 'schemas must be a record map of Zod schemas' })
    } else if (Object.keys(raw.schemas).length > 0) {
      hasSchemas = true
    }
  }

  const hasOutput = typeof raw.output === 'string' && raw.output.trim().length > 0
  if (raw.grouping !== undefined && raw.grouping !== 'single' && raw.grouping !== 'per-schema') {
    errors.push({ path: 'grouping', message: "grouping must be 'single' or 'per-schema'" })
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
      .join('\n')
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
