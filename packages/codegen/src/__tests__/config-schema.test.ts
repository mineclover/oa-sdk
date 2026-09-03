import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  defineConfig,
  validateOaConfig,
  assertOaConfig,
  isOaConfig,
  OaConfigError,
  oaConfigSchema,
  OPENAPI_PROJECTION_PROFILES,
  type OaConfig,
  type ProfileTargetConfig,
  type GuardTargetConfig,
} from '../config.js'

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
})
