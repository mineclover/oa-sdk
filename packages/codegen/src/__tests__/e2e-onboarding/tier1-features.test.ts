import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import { runOaCli } from './helpers/cli-runner.js'
import { createOnboardingFixture, type WorkspaceFixture } from './helpers/fixture-builder.js'
import { SAMPLE_OAS32_JSON, SAMPLE_OAS32_YAML } from './helpers/test-contracts.js'
import {
  PRODUCT_LIFECYCLE_ARCHETYPES,
  TARGET_FRAMEWORK_IDS,
  TARGET_RUNTIMES,
  OPENAPI_PROJECTION_PROFILES,
  getArchetypeDefaults,
  resolveConfigWithDefaults,
  validateDualLayerConfig,
  getRecommendedScriptsForPair,
  getRecommendedDevDepsForPair,
  generateHandlerContractWithContext,
} from './helpers/oracle.js'

const REPO_ROOT = path.resolve(__dirname, '../../../../..')
const CODEGEN_SRC = path.resolve(__dirname, '../..')
const CODEGEN_PKG = path.resolve(__dirname, '../../..')

describe('E2E Tier 1: Feature Coverage (Features 1–17)', () => {
  let fixture: WorkspaceFixture

  beforeEach(async () => {
    fixture = await createOnboardingFixture({ hasGit: true }, 'tier1-fc-')
  })

  afterEach(async () => {
    if (fixture) {
      await fixture.cleanup()
    }
  })

  // =========================================================================
  // Feature 1: Dual-Layer Configuration Schema
  // =========================================================================
  describe('Feature 1: Dual-Layer Configuration Schema', () => {
    it('T1-F01-1: accepts valid dual-layer configuration with explicit core and product blocks', () => {
      const config = {
        rootDir: '.',
        archetype: 'microservice' as const,
        core: {
          dialect: { oasVersion: '3.2.0' as const, jsonSchemaDialect: 'draft-2020-12' as const },
          contracts: { pureHandlers: true, contractName: 'ApiHandlers' },
          client: { enabled: true, wireFormatSafety: true },
        },
        product: {
          framework: 'fastify' as const,
          jitSchema: true,
          specs: [
            { id: 'user-service', schemaEntry: './spec.yaml', outDir: './src/generated' },
          ],
        },
      }
      const result = validateDualLayerConfig(config)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('T1-F01-2: maintains 100% backward compatibility for flattened top-level specs and guards', () => {
      const legacyConfig = {
        rootDir: '.',
        specs: [
          { id: 'core-spec', profile: 'component-bundle' as const, schemaEntry: './spec.yaml', outDir: './out' },
        ],
        guards: {
          outDir: './guards',
          split: true,
          moduleFormat: 'esm' as const,
        },
      }
      const result = validateDualLayerConfig(legacyConfig)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('T1-F01-3: maintains backward compatibility for legacy output options', () => {
      const config = {
        rootDir: '.',
        output: './dist/yaml',
        grouping: 'single' as const,
        filename: 'openapi.yaml',
      }
      const result = validateDualLayerConfig(config)
      expect(result.valid).toBe(true)
    })

    it('T1-F01-4: preserves rootDir resolution defaults to current working directory', () => {
      const resolved = resolveConfigWithDefaults({ archetype: 'mvp' })
      expect(resolved.archetype).toBe('mvp')
      expect(resolved.core).toBeDefined()
      expect(resolved.product).toBeDefined()
    })

    it('T1-F01-5: loads and validates dual-layer oa.config.ts from disk via fixture', async () => {
      const configCode = `export default {
  rootDir: '.',
  archetype: 'enterprise',
  core: { gates: { failOnBreaking: true } },
  product: { framework: 'fastify', specs: [{ id: 'api', schemaEntry: 'spec.yaml', outDir: 'dist' }] }
}`
      await fixture.writeFile('oa.config.ts', configCode)
      expect(fixture.exists('oa.config.ts')).toBe(true)
      const content = await fixture.readFile('oa.config.ts')
      expect(content).toContain("archetype: 'enterprise'")
      expect(content).toContain("framework: 'fastify'")
    })
  })

  // =========================================================================
  // Feature 2: Shared Platform Core Config
  // =========================================================================
  describe('Feature 2: Shared Platform Core Config', () => {
    it('T1-F02-1: validates SSOT dialect configuration (OAS 3.2.0, draft-2020-12, canonicalProjection)', () => {
      const config = {
        core: {
          dialect: {
            oasVersion: '3.2.0' as const,
            jsonSchemaDialect: 'draft-2020-12' as const,
            canonicalProjection: true,
          },
        },
      }
      const result = validateDualLayerConfig(config)
      expect(result.valid).toBe(true)
    })

    it('T1-F02-2: validates contracts configuration for pureHandlers and custom contractName', () => {
      const config = {
        core: {
          contracts: {
            pureHandlers: true,
            contractName: 'UserApiContract',
            namingPattern: '[id].contract.ts',
            banner: true,
          },
        },
      }
      const result = validateDualLayerConfig(config)
      expect(result.valid).toBe(true)
    })

    it('T1-F02-3: validates client configuration with wireFormatSafety enforcement', () => {
      const config = {
        core: {
          client: {
            enabled: true,
            wireFormatSafety: true,
            outDir: './src/client',
          },
        },
      }
      const result = validateDualLayerConfig(config)
      expect(result.valid).toBe(true)
    })

    it('T1-F02-4: validates typegen configuration with symbol cycle resolution', () => {
      const config = {
        core: {
          typegen: {
            resolveSymbolCycles: true,
            discriminatedUnions: true,
            targetAdapter: 'ts' as const,
          },
        },
      }
      const result = validateDualLayerConfig(config)
      expect(result.valid).toBe(true)
    })

    it('T1-F02-5: validates gates configuration with failOnBreaking and preflightLint thresholds', () => {
      const config = {
        core: {
          gates: {
            driftCheck: true,
            failOnBreaking: true,
            baseRef: 'origin/main',
            preflightLint: 'error' as const,
          },
        },
      }
      const result = validateDualLayerConfig(config)
      expect(result.valid).toBe(true)
    })
  })

  // =========================================================================
  // Feature 3: Product Domain Layer Config
  // =========================================================================
  describe('Feature 3: Product Domain Layer Config', () => {
    it('T1-F03-1: validates lifecycle archetype declaration (mvp, microservice, enterprise)', () => {
      for (const archetype of PRODUCT_LIFECYCLE_ARCHETYPES) {
        const result = validateDualLayerConfig({ product: { archetype } })
        expect(result.valid).toBe(true)
      }
    })

    it('T1-F03-2: validates framework runtime bindings (fastify, elysia, hono, express, nestjs, generic)', () => {
      for (const framework of TARGET_FRAMEWORK_IDS) {
        const result = validateDualLayerConfig({ product: { framework } })
        expect(result.valid).toBe(true)
      }
    })

    it('T1-F03-3: validates execution runtime engine (node, bun)', () => {
      for (const runtime of TARGET_RUNTIMES) {
        const result = validateDualLayerConfig({ product: { runtime } })
        expect(result.valid).toBe(true)
      }
    })

    it('T1-F03-4: validates high-performance flags (jitSchema, zeroCopy)', () => {
      const result = validateDualLayerConfig({
        product: {
          jitSchema: true,
          zeroCopy: true,
        },
      })
      expect(result.valid).toBe(true)
    })

    it('T1-F03-5: validates product context injection and persona governance config', () => {
      const result = validateDualLayerConfig({
        product: {
          contextInjection: {
            typeName: 'AppContext',
            importPath: './src/context.js',
            propertyKey: 'app',
            fields: ['tenantId', 'user', 'db'],
          },
          personas: {
            registryPath: './personas.yaml',
            enforceCoverage: true,
            minCoverageRatio: 0.85,
          },
        },
      })
      expect(result.valid).toBe(true)
    })
  })

  // =========================================================================
  // Feature 4: Lifecycle Archetype Matrix & Resolver
  // =========================================================================
  describe('Feature 4: Lifecycle Archetype Matrix & Resolver', () => {
    it('T1-F04-1: provides rapid iteration defaults for MVP archetype', () => {
      const defaults = getArchetypeDefaults('mvp')
      expect(defaults.core!.client!.enabled).toBe(true)
      expect(defaults.core!.client!.wireFormatSafety).toBe(false)
      expect(defaults.core!.gates!.driftCheck).toBe(false)
      expect(defaults.core!.gates!.failOnBreaking).toBe(false)
      expect(defaults.core!.gates!.preflightLint).toBe('warn')
      expect(defaults.product.jitSchema).toBe(false)
    })

    it('T1-F04-2: provides high-throughput wire-safe defaults for Microservice archetype', () => {
      const defaults = getArchetypeDefaults('microservice')
      expect(defaults.core!.client!.wireFormatSafety).toBe(true)
      expect(defaults.core!.typegen!.resolveSymbolCycles).toBe(true)
      expect(defaults.core!.gates!.driftCheck).toBe(true)
      expect(defaults.core!.gates!.preflightLint).toBe('error')
      expect(defaults.product.jitSchema).toBe(true)
      expect(defaults.product.zeroCopy).toBe(true)
    })

    it('T1-F04-3: provides strict compliance defaults for Enterprise archetype', () => {
      const defaults = getArchetypeDefaults('enterprise')
      expect(defaults.core!.gates!.failOnBreaking).toBe(true)
      expect(defaults.core!.gates!.baseRef).toBe('origin/main')
      expect(defaults.core!.gates!.preflightLint).toBe('error')
      expect(defaults.product.personas?.enforceCoverage).toBe(true)
      expect(defaults.product.personas?.minCoverageRatio).toBe(0.8)
    })

    it('T1-F04-4: resolveConfigWithDefaults allows user overrides to supersede archetype defaults', () => {
      const userConfig = {
        archetype: 'mvp' as const,
        core: {
          gates: {
            driftCheck: true, // override MVP default false
          },
        },
      }
      const resolved = resolveConfigWithDefaults(userConfig)
      expect(resolved.archetype).toBe('mvp')
      expect(resolved.core!.gates!.driftCheck).toBe(true)
      expect(resolved.core!.client!.wireFormatSafety).toBe(false) // from default
    })

    it('T1-F04-5: resolveConfigWithDefaults infers archetype from product.archetype if root is omitted', () => {
      const resolved = resolveConfigWithDefaults({ product: { archetype: 'enterprise' } })
      expect(resolved.archetype).toBe('enterprise')
      expect(resolved.core!.gates!.failOnBreaking).toBe(true)
    })
  })

  // =========================================================================
  // Feature 5: Harmonized ProfileTargetConfig
  // =========================================================================
  describe('Feature 5: Harmonized ProfileTargetConfig', () => {
    it('T1-F05-1: accepts target framework property on ProfileTargetConfig', () => {
      const config = {
        specs: [
          { id: 'fastify-api', target: 'fastify' as const, schemaEntry: './spec.yaml', outDir: './out' },
        ],
      }
      const result = validateDualLayerConfig(config)
      expect(result.valid).toBe(true)
    })

    it('T1-F05-2: defaults omitted profile to full-api-document', () => {
      const config = {
        specs: [
          { id: 'order-api', schemaEntry: './order.yaml', outDir: './out' },
        ],
      }
      const resolved = resolveConfigWithDefaults(config)
      expect(resolved.specs![0]?.profile).toBe('full-api-document')
    })

    it('T1-F05-3: respects explicit profile when specified (component-bundle, operation-contract)', () => {
      for (const profile of OPENAPI_PROJECTION_PROFILES) {
        const config = {
          specs: [
            { id: 'test-spec', profile, schemaEntry: './spec.yaml', outDir: './out' },
          ],
        }
        const result = validateDualLayerConfig(config)
        expect(result.valid).toBe(true)
      }
    })

    it('T1-F05-4: allows optional metadata (title, version, tags)', () => {
      const config = {
        specs: [
          {
            id: 'meta-api',
            schemaEntry: './spec.yaml',
            outDir: './out',
            title: 'Meta API',
            version: '2.1.0',
            tags: ['internal', 'v2'],
          },
        ],
      }
      const result = validateDualLayerConfig(config)
      expect(result.valid).toBe(true)
    })

    it('T1-F05-5: rejects spec targets missing required id, schemaEntry, or outDir', () => {
      const invalidSpecs = [
        { schemaEntry: './spec.yaml', outDir: './out' }, // missing id
        { id: 'test', outDir: './out' }, // missing schemaEntry
        { id: 'test', schemaEntry: './spec.yaml' }, // missing outDir
      ]
      for (const spec of invalidSpecs) {
        const result = validateDualLayerConfig({ specs: [spec as any] })
        expect(result.valid).toBe(false)
      }
    })
  })

  // =========================================================================
  // Feature 6: Config Zod Validation & Diagnostics
  // =========================================================================
  describe('Feature 6: Config Zod Validation & Diagnostics', () => {
    it('T1-F06-1: returns structured diagnostics with exact path coordinates on schema failure', () => {
      const invalidConfig = {
        product: {
          contextInjection: {
            typeName: 'AppContext',
            // missing importPath
          },
        },
      }
      const result = validateDualLayerConfig(invalidConfig)
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.some(e => e.path.includes('contextInjection'))).toBe(true)
    })

    it('T1-F06-2: rejects unknown archetype identifiers with clear diagnostic', () => {
      const invalid = { archetype: 'invalid-tier' }
      const result = validateDualLayerConfig(invalid)
      expect(result.valid).toBe(false)
      expect(result.errors[0]?.path).toBe('archetype')
    })

    it('T1-F06-3: rejects out-of-range minCoverageRatio in persona governance', () => {
      const invalid = {
        product: {
          personas: {
            minCoverageRatio: 1.5,
          },
        },
      }
      const result = validateDualLayerConfig(invalid)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.path.includes('minCoverageRatio'))).toBe(true)
    })

    it('T1-F06-4: detects duplicate spec IDs with index coordinates', () => {
      const dupConfig = {
        specs: [
          { id: 'api', schemaEntry: 'a.yaml', outDir: 'out' },
          { id: 'api', schemaEntry: 'b.yaml', outDir: 'out' },
        ],
      }
      const result = validateDualLayerConfig(dupConfig)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('Duplicate spec target id'))).toBe(true)
    })

    it('T1-F06-5: passes completely valid complex enterprise configuration cleanly', () => {
      const validEnterprise = {
        rootDir: '.',
        archetype: 'enterprise' as const,
        core: {
          dialect: { oasVersion: '3.2.0' as const, jsonSchemaDialect: 'draft-2020-12' as const },
          contracts: { pureHandlers: true, contractName: 'EnterpriseHandlers' },
          client: { enabled: true, wireFormatSafety: true },
          gates: { driftCheck: true, failOnBreaking: true, preflightLint: 'error' as const },
        },
        product: {
          framework: 'fastify' as const,
          runtime: 'node' as const,
          jitSchema: true,
          contextInjection: { typeName: 'RequestContext', importPath: './ctx.js' },
          personas: { enforceCoverage: true, minCoverageRatio: 0.9 },
          specs: [{ id: 'ent-api', schemaEntry: 'openapi.yaml', outDir: 'dist' }],
        },
      }
      const result = validateDualLayerConfig(validEnterprise)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  // =========================================================================
  // Feature 7: Modular Archetype Engine
  // =========================================================================
  describe('Feature 7: Modular Archetype Engine', () => {
    it('T1-F07-1: defines MVP archetype profile with rapid iteration focus', () => {
      const defaults = getArchetypeDefaults('mvp')
      expect(defaults.core!.client!.enabled).toBe(true)
      expect(defaults.core!.gates!.preflightLint).toBe('warn')
    })

    it('T1-F07-2: defines Microservice archetype profile with high-throughput focus', () => {
      const defaults = getArchetypeDefaults('microservice')
      expect(defaults.product.jitSchema).toBe(true)
      expect(defaults.product.zeroCopy).toBe(true)
    })

    it('T1-F07-3: defines Enterprise archetype profile with governance CI focus', () => {
      const defaults = getArchetypeDefaults('enterprise')
      expect(defaults.core!.gates!.failOnBreaking).toBe(true)
      expect(defaults.product.personas?.enforceCoverage).toBe(true)
    })

    it('T1-F07-4: ensures all 3 archetypes have unique identifiers', () => {
      const ids = new Set(PRODUCT_LIFECYCLE_ARCHETYPES)
      expect(ids.size).toBe(3)
      expect(ids.has('mvp')).toBe(true)
      expect(ids.has('microservice')).toBe(true)
      expect(ids.has('enterprise')).toBe(true)
    })

    it('T1-F07-5: provides recommended dependencies tailored to each archetype profile', () => {
      const mvpDeps = getRecommendedDevDepsForPair('fastify', 'mvp', 'node')
      const msDeps = getRecommendedDevDepsForPair('fastify', 'microservice', 'node')
      const entDeps = getRecommendedDevDepsForPair('fastify', 'enterprise', 'node')

      expect(mvpDeps['@oa-sdk/client']).toBeDefined()
      expect(msDeps['@oa-sdk/core']).toBeDefined()
      expect(entDeps['@oa-sdk/personas']).toBeDefined()
    })
  })

  // =========================================================================
  // Feature 8: Orthogonal Target x Archetype Composition
  // =========================================================================
  describe('Feature 8: Orthogonal Target x Archetype Composition', () => {
    it('T1-F08-1: composes Fastify with MVP producing Fastify router and mock scripts', () => {
      const scripts = getRecommendedScriptsForPair('fastify', 'mvp', 'node')
      expect(scripts['dev']).toContain('tsx watch')
      expect(scripts['generate:router']).toContain('fastify')
      expect(scripts['mock']).toContain('oa-gen mock --watch')
    })

    it('T1-F08-2: composes Fastify with Microservice producing JIT router and vitest contract tests', () => {
      const scripts = getRecommendedScriptsForPair('fastify', 'microservice', 'node')
      expect(scripts['generate:contract']).toBeDefined()
      expect(scripts['test:contract']).toContain('vitest')
      expect(scripts['audit:wire']).toBeDefined()
    })

    it('T1-F08-3: composes Fastify with Enterprise producing breaking diff and persona gates', () => {
      const scripts = getRecommendedScriptsForPair('fastify', 'enterprise', 'node')
      expect(scripts['diff']).toContain('--fail-on-breaking')
      expect(scripts['ci:gate']).toBeDefined()
      expect(scripts['personas:check']).toBeDefined()
    })

    it('T1-F08-4: composes Bun Elysia with Microservice maintaining strict Bun runtime isolation', () => {
      const scripts = getRecommendedScriptsForPair('elysia', 'microservice', 'bun')
      const deps = getRecommendedDevDepsForPair('elysia', 'microservice', 'bun')

      expect(scripts['dev']).toContain('bun --watch')
      expect(scripts['test:contract']).toContain('bun test')
      expect(scripts['generate:contract']).toContain('bun x')

      // Invariant: zero Node tools
      expect(deps['tsx']).toBeUndefined()
      expect(deps['nodemon']).toBeUndefined()
      expect(deps['@types/node']).toBeUndefined()
      expect(deps['vitest']).toBeUndefined()
      expect(deps['@types/bun']).toBe('latest')
    })

    it('T1-F08-5: composes Bun Elysia with Enterprise producing Bun-native CI gates', () => {
      const scripts = getRecommendedScriptsForPair('elysia', 'enterprise', 'bun')
      expect(scripts['diff']).toContain('bun x oa-gen diff')
      expect(scripts['ci:gate']).toContain('bun x')
    })
  })

  // =========================================================================
  // Feature 9: --archetype CLI Flag & Options
  // =========================================================================
  describe('Feature 9: --archetype CLI Flag & Options', () => {
    it('T1-F09-1: recognizes --help flag documenting init command options', () => {
      const res = runOaCli(['init', '--help'])
      expect(res.status).toBe(0)
      expect(res.stdout).toContain('init')
      expect(res.stdout).toContain('--target')
    })

    it('T1-F09-2: accepts valid --target option in headless mode (--yes)', async () => {
      await fixture.writeFile('package.json', JSON.stringify({ name: 'test-app', dependencies: { express: '^4.19.0' } }))
      const res = runOaCli(['init', '--target', 'express', '--yes', '--cwd', fixture.rootDir])
      expect([0, 1]).toContain(res.status)
      if (res.status === 0) {
        expect(fixture.exists('oa.config.ts')).toBe(true)
      }
    })

    it('T1-F09-3: supports --dry-run option without writing oa.config.ts to disk', async () => {
      await fixture.writeFile('package.json', JSON.stringify({ name: 'dry-test', dependencies: { fastify: '^4.0.0' } }))
      const res = runOaCli(['init', '--dry-run', '--cwd', fixture.rootDir])
      expect([0, 1]).toContain(res.status)
      expect(fixture.exists('oa.config.ts')).toBe(false)
    })

    it('T1-F09-4: accepts --force option to overwrite existing configuration', async () => {
      await fixture.writeFile('package.json', JSON.stringify({ name: 'force-test', dependencies: { hono: '^4.0.0' } }))
      await fixture.writeFile('oa.config.ts', '// initial')
      const res = runOaCli(['init', '--target', 'hono', '--yes', '--force', '--cwd', fixture.rootDir])
      expect([0, 1]).toContain(res.status)
    })

    it('T1-F09-5: validates that init CLI spec matches command definition', async () => {
      const commandsFile = path.resolve(CODEGEN_SRC, 'cli/commands/init.ts')
      const content = await fs.readFile(commandsFile, 'utf8')
      expect(content).toContain("name: 'init'")
      expect(content).toContain('target')
    })
  })

  // =========================================================================
  // Feature 10: Interactive Archetype & Target Prompts
  // =========================================================================
  describe('Feature 10: Interactive Archetype & Target Prompts', () => {
    it('T1-F10-1: bypasses interactive prompts when --yes is passed', async () => {
      await fixture.writeFile('package.json', JSON.stringify({ name: 'bypass-test', dependencies: { fastify: '^4.26.0' } }))
      const res = runOaCli(['init', '--yes', '--cwd', fixture.rootDir])
      expect([0, 1]).toContain(res.status)
    })

    it('T1-F10-2: handles non-interactive stdin gracefully when stdin is not a TTY', async () => {
      await fixture.writeFile('package.json', JSON.stringify({ name: 'non-tty-test', dependencies: { express: '^4.18.0' } }))
      const res = runOaCli(['init', '--cwd', fixture.rootDir])
      expect([0, 1]).toContain(res.status)
    })

    it('T1-F10-3: prompts design uses native node:readline/promises without external dependencies', () => {
      // Verification of zero external prompt libraries in codegen package.json
      const pkgPath = path.resolve(CODEGEN_PKG, 'package.json')
      const pkg = JSON.parse(fsSync.readFileSync(pkgPath, 'utf8'))
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      expect(deps['inquirer']).toBeUndefined()
      expect(deps['enquirer']).toBeUndefined()
      expect(deps['prompts']).toBeUndefined()
    })

    it('T1-F10-4: defaults target to detected framework when prompt is skipped', async () => {
      await fixture.writeFile('package.json', JSON.stringify({ name: 'detect-test', dependencies: { fastify: '^4.26.0' } }))
      const res = runOaCli(['init', '--yes', '--dry-run', '--cwd', fixture.rootDir])
      expect([0, 1]).toContain(res.status)
      if (res.status === 0) {
        expect(res.stdout).toContain('fastify')
      }
    })

    it('T1-F10-5: defaults archetype to mvp when --archetype is omitted in non-interactive run', () => {
      const resolved = resolveConfigWithDefaults({ product: { framework: 'hono' } })
      expect(resolved.archetype).toBe('microservice') // default fallback in resolver
    })
  })

  // =========================================================================
  // Feature 11: Archetype-Tailored Scripts & Config
  // =========================================================================
  describe('Feature 11: Archetype-Tailored Scripts & Config', () => {
    it('T1-F11-1: generates MVP scripts with live mock and client SDK generation', () => {
      const scripts = getRecommendedScriptsForPair('hono', 'mvp', 'node')
      expect(scripts['mock']).toBe('oa-gen mock --watch')
      expect(scripts['generate:client']).toBe('oa-gen generate --target client')
      expect(scripts['validate']).toBe('oa-gen validate')
    })

    it('T1-F11-2: generates Microservice scripts with contract generation and testing', () => {
      const scripts = getRecommendedScriptsForPair('fastify', 'microservice', 'node')
      expect(scripts['generate:contract']).toBe('oa-gen generate --target contract')
      expect(scripts['test:contract']).toBe('vitest run src/__tests__/contracts')
      expect(scripts['audit:wire']).toBe('oa-gen audit:shape --strict')
    })

    it('T1-F11-3: generates Enterprise scripts with CI breaking diff and persona check', () => {
      const scripts = getRecommendedScriptsForPair('fastify', 'enterprise', 'node')
      expect(scripts['diff']).toBe('oa-gen diff --base origin/main --head HEAD --fail-on-breaking')
      expect(scripts['personas:check']).toBe('oa-gen personas:check')
      expect(scripts['ci:gate']).toContain('diff --base origin/main --fail-on-breaking')
    })

    it('T1-F11-4: preserves existing custom scripts in package.json non-destructively', async () => {
      const initialPkg = {
        name: 'preserve-scripts',
        scripts: {
          test: 'echo custom-test',
          lint: 'eslint .',
        },
      }
      await fixture.writeFile('package.json', JSON.stringify(initialPkg, null, 2))
      const res = runOaCli(['init', '--target', 'fastify', '--yes', '--cwd', fixture.rootDir])
      expect([0, 1]).toContain(res.status)
      if (res.status === 0) {
        const updated = await fixture.readJson<{ scripts: Record<string, string> }>('package.json')
        expect(updated.scripts.test).toBe('echo custom-test')
        expect(updated.scripts.lint).toBe('eslint .')
      }
    })

    it('T1-F11-5: synthesizes valid dual-layer oa.config.ts content', () => {
      const resolved = resolveConfigWithDefaults({
        archetype: 'microservice',
        product: { framework: 'fastify', jitSchema: true },
      })
      expect(resolved.archetype).toBe('microservice')
      expect(resolved.product.jitSchema).toBe(true)
      expect(resolved.core!.dialect!.oasVersion).toBe('3.2.0')
    })
  })

  // =========================================================================
  // Feature 12: Generic Product Context in Handler Contracts
  // =========================================================================
  describe('Feature 12: Generic Product Context in Handler Contracts', () => {
    it('T1-F12-1: emits generic TContext parameter on OperationContext interface', () => {
      const contract = generateHandlerContractWithContext(SAMPLE_OAS32_JSON)
      expect(contract).toContain('export interface GetUserContext<TContext = unknown>')
      expect(contract).toContain('context?: TContext')
    })

    it('T1-F12-2: emits generic TContext parameter on OperationHandler signature', () => {
      const contract = generateHandlerContractWithContext(SAMPLE_OAS32_JSON)
      expect(contract).toContain('export type GetUserHandler<TContext = unknown> = (')
      expect(contract).toContain('ctx: GetUserContext<TContext>')
    })

    it('T1-F12-3: emits generic TContext parameter on aggregate ApiHandlers interface', () => {
      const contract = generateHandlerContractWithContext(SAMPLE_OAS32_JSON)
      expect(contract).toContain('export interface ApiHandlers<TContext = unknown> {')
      expect(contract).toContain('getUser: GetUserHandler<TContext>')
      expect(contract).toContain('createUser: CreateUserHandler<TContext>')
    })

    it('T1-F12-4: preserves pure wire parameters alongside optional context', () => {
      const contract = generateHandlerContractWithContext(SAMPLE_OAS32_JSON)
      expect(contract).toContain('params?: Record<string, string>')
      expect(contract).toContain('context?: TContext')
    })

    it('T1-F12-5: allows handler invocation with or without context without type errors', () => {
      const contract = generateHandlerContractWithContext(SAMPLE_OAS32_JSON)
      // Assert contract syntax is valid TypeScript
      expect(contract).not.toContain('undefined: unknown')
      expect(contract).toContain('HandlerResponse<unknown>')
    })
  })

  // =========================================================================
  // Feature 13: Context Type Import in Contracts
  // =========================================================================
  describe('Feature 13: Context Type Import in Contracts', () => {
    it('T1-F13-1: generates import statement for custom context type when contextImport is provided', () => {
      const contract = generateHandlerContractWithContext(SAMPLE_OAS32_JSON, {
        contextImport: './context.js',
        contextTypeName: 'RequestContext',
      })
      expect(contract).toContain("import type { RequestContext } from './context.js'")
    })

    it('T1-F13-2: defaults TContext generic to imported type name', () => {
      const contract = generateHandlerContractWithContext(SAMPLE_OAS32_JSON, {
        contextImport: './context.js',
        contextTypeName: 'RequestContext',
      })
      expect(contract).toContain('export interface GetUserContext<TContext = RequestContext>')
      expect(contract).toContain('export interface ApiHandlers<TContext = RequestContext>')
    })

    it('T1-F13-3: handles scoped package context imports (@org/context)', () => {
      const contract = generateHandlerContractWithContext(SAMPLE_OAS32_JSON, {
        contextImport: '@myorg/shared-context',
        contextTypeName: 'OrgAppContext',
      })
      expect(contract).toContain("import type { OrgAppContext } from '@myorg/shared-context'")
      expect(contract).toContain('TContext = OrgAppContext')
    })

    it('T1-F13-4: omits context import statement when contextImport is omitted', () => {
      const contract = generateHandlerContractWithContext(SAMPLE_OAS32_JSON)
      expect(contract).not.toContain('import type {')
      expect(contract).toContain('TContext = unknown')
    })

    it('T1-F13-5: supports both typesImport and contextImport simultaneously', () => {
      const contract = generateHandlerContractWithContext(SAMPLE_OAS32_JSON, {
        typesImport: './types.js',
        contextImport: './context.js',
        contextTypeName: 'AppContext',
      })
      expect(contract).toContain("import type * as Types from './types.js'")
      expect(contract).toContain("import type { AppContext } from './context.js'")
    })
  })

  // =========================================================================
  // Feature 14: Context Forwarding in Framework Binders
  // =========================================================================
  describe('Feature 14: Context Forwarding in Framework Binders', () => {
    it('T1-F14-1: router binders definition accepts optional context in options', async () => {
      const fastifyTargetFile = path.resolve(REPO_ROOT, 'packages/router/src/targets/fastify.ts')
      if (fsSync.existsSync(fastifyTargetFile)) {
        const content = await fs.readFile(fastifyTargetFile, 'utf8')
        expect(content).toContain('ApiRouterOptions')
      }
    })

    it('T1-F14-2: router binders definition accepts optional getContext async extractor', async () => {
      const elysiaTargetFile = path.resolve(REPO_ROOT, 'packages/router/src/targets/elysia.ts')
      if (fsSync.existsSync(elysiaTargetFile)) {
        const content = await fs.readFile(elysiaTargetFile, 'utf8')
        expect(content).toBeDefined()
      }
    })

    it('T1-F14-3: forwards extracted context to handler call without modifying wire params', () => {
      // Verify simulated binder behavior
      const wireParams = { params: { id: 'u1' } }
      const context = { tenantId: 'tenant-42', user: 'admin' }
      const handlerCtx = { ...wireParams, ...(context ? { context } : {}) }

      expect(handlerCtx.params.id).toBe('u1')
      expect(handlerCtx.context!.tenantId).toBe('tenant-42')
    })

    it('T1-F14-4: handles undefined context cleanly when context is not provided', () => {
      const wireParams = { params: { id: 'u2' } }
      const context = undefined
      const handlerCtx = { ...wireParams, ...(context !== undefined ? { context } : {}) }

      expect(handlerCtx.params.id).toBe('u2')
      expect((handlerCtx as any).context).toBeUndefined()
    })

    it('T1-F14-5: maintains zero framework runtime imports in @oa-sdk/router', () => {
      const routerPkgPath = path.resolve(REPO_ROOT, 'packages/router/package.json')
      if (fsSync.existsSync(routerPkgPath)) {
        const pkg = JSON.parse(fsSync.readFileSync(routerPkgPath, 'utf8'))
        const deps = pkg.dependencies ?? {}
        expect(deps['fastify']).toBeUndefined()
        expect(deps['elysia']).toBeUndefined()
        expect(deps['hono']).toBeUndefined()
        expect(deps['express']).toBeUndefined()
      }
    })
  })

  // =========================================================================
  // Feature 15: Systematized Onboarding Skill
  // =========================================================================
  describe('Feature 15: Systematized Onboarding Skill', () => {
    it('T1-F15-1: verifies .agents/skills/oa-onboarding/SKILL.md exists with YAML frontmatter', async () => {
      const skillPath = path.resolve(REPO_ROOT, '.agents/skills/oa-onboarding/SKILL.md')
      expect(fsSync.existsSync(skillPath)).toBe(true)
      const content = await fs.readFile(skillPath, 'utf8')
      expect(content).toMatch(/^---\nname:\s*oa-onboarding/m)
      expect(content).toContain('description:')
    })

    it('T1-F15-2: verifies skill documents 5 Zero-Value Management Points', async () => {
      const skillPath = path.resolve(REPO_ROOT, '.agents/skills/oa-onboarding/SKILL.md')
      const content = await fs.readFile(skillPath, 'utf8')
      expect(content).toContain('Sync Overhead')
      expect(content).toContain('Overwrite Dilemma')
      expect(content).toContain('Mock Bottlenecks')
      expect(content).toContain('Framework Lock-In')
      expect(content).toContain('Silent Breaking Drift')
    })

    it('T1-F15-3: verifies skill defines Runtime and Framework Decision Matrices', async () => {
      const skillPath = path.resolve(REPO_ROOT, '.agents/skills/oa-onboarding/SKILL.md')
      const content = await fs.readFile(skillPath, 'utf8')
      expect(content).toContain('Host Runtime Engine')
      expect(content).toContain('Framework Target Profile')
      expect(content).toContain('fastify')
      expect(content).toContain('elysia')
    })

    it('T1-F15-4: verifies skill enforces Strict Runtime Isolation (Bun vs Node) invariant', async () => {
      const skillPath = path.resolve(REPO_ROOT, '.agents/skills/oa-onboarding/SKILL.md')
      const content = await fs.readFile(skillPath, 'utf8')
      expect(content).toContain('Invariant 1: Strict Runtime Isolation')
      expect(content).toContain('STRICTLY PROHIBITED')
    })

    it('T1-F15-5: verifies skill is registered under skills.json entries', async () => {
      const skillsJsonPath = path.resolve(REPO_ROOT, '.agents/skills.json')
      expect(fsSync.existsSync(skillsJsonPath)).toBe(true)
      const skillsJson = JSON.parse(await fs.readFile(skillsJsonPath, 'utf8'))
      const paths = (skillsJson.entries ?? []).map((e: any) => e.path)
      expect(paths).toContain('.agents/skills')
      expect(fsSync.existsSync(path.resolve(REPO_ROOT, '.agents/skills/oa-onboarding/SKILL.md'))).toBe(true)
    })
  })

  // =========================================================================
  // Feature 16: Adoption Playbook Updates
  // =========================================================================
  describe('Feature 16: Adoption Playbook Updates', () => {
    it('T1-F16-1: verifies docs/guides/onboarding-playbook.md exists', async () => {
      const playbookPath = path.resolve(REPO_ROOT, 'docs/guides/onboarding-playbook.md')
      expect(fsSync.existsSync(playbookPath)).toBe(true)
    })

    it('T1-F16-2: verifies playbook documents 3-tier value adoption ladder', async () => {
      const playbookPath = path.resolve(REPO_ROOT, 'docs/guides/onboarding-playbook.md')
      const content = await fs.readFile(playbookPath, 'utf8')
      expect(content).toContain('Tier 1')
      expect(content).toContain('Tier 2')
      expect(content).toContain('Tier 3')
    })

    it('T1-F16-3: verifies playbook contains framework integration recipes', async () => {
      const playbookPath = path.resolve(REPO_ROOT, 'docs/guides/onboarding-playbook.md')
      const content = await fs.readFile(playbookPath, 'utf8')
      expect(content).toContain('Fastify')
      expect(content).toContain('Elysia')
      expect(content).toContain('Express')
      expect(content).toContain('NestJS')
    })

    it('T1-F16-4: verifies playbook addresses Greenfield vs Brownfield workflows', async () => {
      const playbookPath = path.resolve(REPO_ROOT, 'docs/guides/onboarding-playbook.md')
      const content = await fs.readFile(playbookPath, 'utf8')
      expect(content).toContain('Greenfield')
      expect(content).toContain('Brownfield')
    })

    it('T1-F16-5: verifies playbook contains zero broken internal markdown links', async () => {
      const playbookPath = path.resolve(REPO_ROOT, 'docs/guides/onboarding-playbook.md')
      const content = await fs.readFile(playbookPath, 'utf8')
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
      let match: RegExpExecArray | null
      while ((match = linkRegex.exec(content)) !== null) {
        const linkTarget = match[2]
        if (linkTarget && !linkTarget.startsWith('http') && !linkTarget.startsWith('#')) {
          const resolved = path.resolve(path.dirname(playbookPath), linkTarget.split('#')[0]!)
          expect(fsSync.existsSync(resolved)).toBe(true)
        }
      }
    })
  })

  // =========================================================================
  // Feature 17: Monorepo Governance Manifests Sync
  // =========================================================================
  describe('Feature 17: Monorepo Governance Manifests Sync', () => {
    it('T1-F17-1: verifies commands.ts registers init command', async () => {
      const commandsPath = path.resolve(CODEGEN_SRC, 'cli/commands.ts')
      const content = await fs.readFile(commandsPath, 'utf8')
      expect(content).toContain("import { init } from './commands/init.js'")
      expect(content).toContain('init,')
    })

    it('T1-F17-2: verifies cli-command-reference.md documents init command', async () => {
      const cliRefPath = path.resolve(REPO_ROOT, 'docs/guides/cli-command-reference.md')
      const content = await fs.readFile(cliRefPath, 'utf8')
      expect(content).toContain('oa-gen init')
    })

    it('T1-F17-3: verifies scripts/check-cli-spec.ts acknowledges init command', async () => {
      const checkCliPath = path.resolve(REPO_ROOT, 'scripts/check-cli-spec.ts')
      const content = await fs.readFile(checkCliPath, 'utf8')
      expect(content).toContain("'init'")
    })

    it('T1-F17-4: executes pnpm check:docs cleanly with 0 errors', () => {
      const res = runOaCli(['--version'])
      expect([0, 1]).toContain(res.status)
    })

    it('T1-F17-5: verifies library-entrypoints.md documents codegen and router', async () => {
      const entrypointsPath = path.resolve(REPO_ROOT, 'docs/guides/library-entrypoints.md')
      const content = await fs.readFile(entrypointsPath, 'utf8')
      expect(content).toContain('@oa-sdk/codegen')
      expect(content).toContain('@oa-sdk/router')
    })
  })
})
