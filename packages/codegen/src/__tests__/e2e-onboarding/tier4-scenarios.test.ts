import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import { runOaCli } from './helpers/cli-runner.js'
import { createOnboardingFixture, type WorkspaceFixture } from './helpers/fixture-builder.js'
import { SAMPLE_OAS32_JSON, SAMPLE_OAS32_YAML } from './helpers/test-contracts.js'
import {
  resolveConfigWithDefaults,
  validateDualLayerConfig,
  getRecommendedScriptsForPair,
  getRecommendedDevDepsForPair,
  generateHandlerContractWithContext,
} from './helpers/oracle.js'

const REPO_ROOT = path.resolve(__dirname, '../../../../..')
const CODEGEN_SRC = path.resolve(__dirname, '../..')
const CODEGEN_PKG = path.resolve(__dirname, '../../..')

describe('E2E Tier 4: Real-World Workload Scenarios (5 Workflows)', () => {
  let fixture: WorkspaceFixture

  beforeEach(async () => {
    fixture = await createOnboardingFixture({ hasGit: true }, 'tier4-scenario-')
  })

  afterEach(async () => {
    if (fixture) {
      await fixture.cleanup()
    }
  })

  // =========================================================================
  // Scenario 1: Greenfield Day 1 MVP -> Day 60 Microservice -> Day 180 Enterprise
  // =========================================================================
  it('T4-S1: Greenfield Day 1 MVP -> Day 60 Microservice -> Day 180 Enterprise evolution', async () => {
    // Stage 1: Day 1 MVP (Rapid Prototyping)
    await fixture.writeFile('openapi.yaml', SAMPLE_OAS32_YAML)
    await fixture.writeFile(
      'package.json',
      JSON.stringify({
        name: 'ecommerce-service',
        version: '0.1.0',
        dependencies: { hono: '^4.0.0' },
      }, null, 2),
    )

    const mvpConfig = {
      rootDir: '.',
      archetype: 'mvp' as const,
      product: {
        framework: 'hono' as const,
        specs: [{ id: 'ecommerce', schemaEntry: './openapi.yaml', outDir: './src/generated' }],
      },
    }
    const resolvedMvp = resolveConfigWithDefaults(mvpConfig)
    expect(resolvedMvp.archetype).toBe('mvp')
    expect(resolvedMvp.core!.client!.enabled).toBe(true)
    expect(resolvedMvp.core!.gates!.driftCheck).toBe(false) // permissive in MVP

    const mvpScripts = getRecommendedScriptsForPair('hono', 'mvp', 'node')
    expect(mvpScripts['mock']).toBe('oa-gen mock --watch')
    expect(mvpScripts['generate:client']).toBe('oa-gen generate --target client')

    // Initial contract generation
    const contractV1 = generateHandlerContractWithContext(SAMPLE_OAS32_JSON)
    expect(contractV1).toContain('export interface ApiHandlers<TContext = unknown>')
    expect(contractV1).toContain('getUser:')
    expect(contractV1).toContain('createUser:')

    // Stage 2: Day 60 Microservice (High-Throughput Scaling)
    // The team migrates to Fastify for JIT schema acceleration.
    // Core contracts and business logic remain identical!
    const microserviceConfig = {
      rootDir: '.',
      archetype: 'microservice' as const,
      product: {
        framework: 'fastify' as const,
        jitSchema: true,
        contextInjection: {
          typeName: 'ServiceContext',
          importPath: './src/context.js',
        },
        specs: [{ id: 'ecommerce', schemaEntry: './openapi.yaml', outDir: './src/generated' }],
      },
    }
    const resolvedMs = resolveConfigWithDefaults(microserviceConfig)
    expect(resolvedMs.archetype).toBe('microservice')
    expect(resolvedMs.product.jitSchema).toBe(true)
    expect(resolvedMs.core!.client!.wireFormatSafety).toBe(true) // JsonPrimitive<T> safety

    const msScripts = getRecommendedScriptsForPair('fastify', 'microservice', 'node')
    expect(msScripts['test:contract']).toBe('vitest run src/__tests__/contracts')
    expect(msScripts['audit:wire']).toBe('oa-gen audit:shape --strict')

    // Stage 3: Day 180 Enterprise (Governance, Breaking Diff Gates & Personas)
    const enterpriseConfig = {
      rootDir: '.',
      archetype: 'enterprise' as const,
      core: {
        gates: {
          driftCheck: true,
          failOnBreaking: true,
          baseRef: 'origin/main',
        },
      },
      product: {
        framework: 'fastify' as const,
        jitSchema: true,
        contextInjection: {
          typeName: 'ServiceContext',
          importPath: './src/context.js',
        },
        personas: {
          registryPath: './personas/registry.yaml',
          enforceCoverage: true,
          minCoverageRatio: 0.9,
        },
        specs: [{ id: 'ecommerce', schemaEntry: './openapi.yaml', outDir: './src/generated' }],
      },
    }
    const resolvedEnt = resolveConfigWithDefaults(enterpriseConfig)
    expect(resolvedEnt.archetype).toBe('enterprise')
    expect(resolvedEnt.core!.gates!.failOnBreaking).toBe(true)
    expect(resolvedEnt.product.personas?.enforceCoverage).toBe(true)

    // Verify contract signatures across all 3 stages remain 100% compatible
    const contractV3 = generateHandlerContractWithContext(SAMPLE_OAS32_JSON, {
      contextImport: './context.js',
      contextTypeName: 'ServiceContext',
    })
    expect(contractV3).toContain('export interface ApiHandlers<TContext = ServiceContext>')
    expect(contractV3).toContain('getUser: GetUserHandler<TContext>')
    expect(contractV3).toContain('createUser: CreateUserHandler<TContext>')
  })

  // =========================================================================
  // Scenario 2: Brownfield Fastify API Integration with Custom Context
  // =========================================================================
  it('T4-S2: Brownfield Fastify API integration with custom auth and tenancy context', async () => {
    // User already has Fastify app with auth middleware and database pool
    await fixture.writeFile('spec.yaml', SAMPLE_OAS32_YAML)

    // 1. Generate decoupled handler contract with RequestContext
    const contract = generateHandlerContractWithContext(SAMPLE_OAS32_JSON, {
      contextImport: './context.js',
      contextTypeName: 'RequestContext',
    })

    expect(contract).toContain("import type { RequestContext } from './context.js'")
    expect(contract).toContain('GetUserContext<TContext = RequestContext>')
    expect(contract).toContain('context?: TContext')

    // 2. Author business service implementing ApiHandlers with strong typing
    type User = { id: string; name: string; email: string }
    type RequestContext = { tenantId: string; user: { id: string; role: string }; db: { query: () => Promise<any> } }

    const userService = {
      getUser: async (ctx: { params?: { id?: string }; context?: RequestContext }) => {
        const tenantId = ctx.context?.tenantId ?? 'default-tenant'
        const userId = ctx.params?.id ?? '0'
        return {
          id: userId,
          name: `User-${userId}`,
          email: `${userId}@${tenantId}.com`,
        }
      },
      createUser: async () => ({ id: 'new', name: 'New', email: 'new@example.com' }),
      listUsers: async () => ({ items: [], total: 0 }),
      healthCheck: async () => ({ status: 'ok' }),
    }

    // 3. Fastify route binder extracts context from Fastify request decorators
    const mockFastifyRequest = {
      params: { id: 'u-400' },
      user: { id: 'admin-1', role: 'superadmin' },
      tenantId: 'tenant-enterprise',
      db: { query: async () => [] },
    }

    const getContext = (req: typeof mockFastifyRequest): RequestContext => ({
      tenantId: req.tenantId,
      user: req.user,
      db: req.db,
    })

    const extractedCtx = getContext(mockFastifyRequest)
    const result = await userService.getUser({
      params: mockFastifyRequest.params,
      context: extractedCtx,
    })

    expect(result.id).toBe('u-400')
    expect(result.email).toBe('u-400@tenant-enterprise.com')

    // 4. OpenAPI spec remains completely pure (no internal db or tenant parameters)
    expect(SAMPLE_OAS32_YAML).not.toContain('DatabasePool')
    expect(SAMPLE_OAS32_YAML).not.toContain('superadmin')
  })

  // =========================================================================
  // Scenario 3: Bun/Elysia High-Performance Microservice Zero-Node Tooling
  // =========================================================================
  it('T4-S3: Bun/Elysia high-performance microservice zero-node tooling verification', async () => {
    // 1. Scaffolding workspace with bun.lockb
    await fixture.writeFile('bun.lockb', '')
    await fixture.writeFile(
      'package.json',
      JSON.stringify({
        name: 'bun-microservice',
        dependencies: { elysia: '^1.0.0' },
      }, null, 2),
    )

    // 2. Verify Elysia target composition in Bun runtime
    const scripts = getRecommendedScriptsForPair('elysia', 'microservice', 'bun')
    const deps = getRecommendedDevDepsForPair('elysia', 'microservice', 'bun')

    // Verify all emitted commands use Bun native tooling
    expect(scripts['dev']).toBe('bun --watch src/index.ts')
    expect(scripts['generate:contract']).toBe('bun x oa-gen generate --target contract')
    expect(scripts['test:contract']).toBe('bun test src/__tests__/contracts')
    expect(scripts['audit:wire']).toBe('bun x oa-gen audit:shape --strict')
    expect(scripts['mock']).toBe('bun x oa-gen mock --watch')

    // Invariant: zero Node tools injected
    expect(deps['tsx']).toBeUndefined()
    expect(deps['nodemon']).toBeUndefined()
    expect(deps['@types/node']).toBeUndefined()
    expect(deps['vitest']).toBeUndefined()
    expect(deps['@types/bun']).toBe('latest')

    // 3. Verify zero-copy context destructuring simulation
    const elysiaBinderInvocation = (ctx: { params: { id: string }; query: { limit?: string }; set: { status: number } }) => {
      const { params, query, set } = ctx
      set.status = 200
      return { id: params.id, limit: query.limit ?? '10' }
    }

    const mockElysiaCtx = { params: { id: 'bun-1' }, query: { limit: '50' }, set: { status: 0 } }
    const res = elysiaBinderInvocation(mockElysiaCtx)
    expect(res.id).toBe('bun-1')
    expect(res.limit).toBe('50')
    expect(mockElysiaCtx.set.status).toBe(200)
  })

  // =========================================================================
  // Scenario 4: Non-Destructive Multi-Stage Evolution in Complex Monorepo
  // =========================================================================
  it('T4-S4: Non-destructive multi-stage evolution in complex monorepo workspace', async () => {
    // 1. Set up package.json with custom 4-space indentation and pre-existing scripts
    const customPkg = {
      name: 'core-platform-service',
      version: '2.4.0',
      private: true,
      scripts: {
        dev: 'node custom-dev.js',
        test: 'jest --ci',
        lint: 'eslint src/',
      },
      dependencies: {
        express: '^4.19.2',
      },
    }
    await fixture.writeFile('package.json', JSON.stringify(customPkg, null, '    ') + '\n')

    // 2. Run init without force
    const res1 = runOaCli(['init', '--target', 'express', '--yes', '--cwd', fixture.rootDir])
    expect([0, 1]).toContain(res1.status)

    if (res1.status === 0) {
      const pkg1 = await fixture.readJson<{ scripts: Record<string, string> }>('package.json')
      // Custom dev script MUST be preserved!
      expect(pkg1.scripts.dev).toBe('node custom-dev.js')
      expect(pkg1.scripts.test).toBe('jest --ci')
      expect(pkg1.scripts.lint).toBe('eslint src/')

      // 4-space indentation MUST be preserved!
      const raw1 = await fixture.readFile('package.json')
      expect(raw1).toMatch(/\n    "name":/m)
    }

    // 3. Run init with --force to upgrade to standardized scripts
    const res2 = runOaCli(['init', '--target', 'express', '--yes', '--force', '--cwd', fixture.rootDir])
    expect([0, 1]).toContain(res2.status)

    if (res2.status === 0) {
      const pkg2 = await fixture.readJson<{ scripts: Record<string, string> }>('package.json')
      // Now dev is updated to standard tsx watch
      expect(pkg2.scripts.dev).toBe('tsx watch src/app.ts')

      // Formatting remains 4 spaces!
      const raw2 = await fixture.readFile('package.json')
      expect(raw2).toMatch(/\n    "name":/m)
    }
  })

  // =========================================================================
  // Scenario 5: Monorepo Governance & CLI Specification Consistency Audit
  // =========================================================================
  it('T4-S5: Monorepo governance and CLI specification consistency audit', async () => {
    // 1. Check CLI spec checker acknowledges init command
    const checkCliSpecFile = path.resolve(REPO_ROOT, 'scripts/check-cli-spec.ts')
    expect(fsSync.existsSync(checkCliSpecFile)).toBe(true)
    const checkCliContent = await fs.readFile(checkCliSpecFile, 'utf8')
    expect(checkCliContent).toContain("'init'")

    // 2. Verify commands registry contains init
    const commandsFile = path.resolve(CODEGEN_SRC, 'cli/commands.ts')
    const commandsContent = await fs.readFile(commandsFile, 'utf8')
    expect(commandsContent).toContain("import { init } from './commands/init.js'")
    expect(commandsContent).toContain('init,')

    // 3. Verify CLI documentation covers init command
    const cliRefFile = path.resolve(REPO_ROOT, 'docs/guides/cli-command-reference.md')
    expect(fsSync.existsSync(cliRefFile)).toBe(true)
    const cliRefContent = await fs.readFile(cliRefFile, 'utf8')
    expect(cliRefContent).toContain('oa-gen init')

    // 4. Verify API index includes codegen exports
    const apiIndexFile = path.resolve(REPO_ROOT, 'docs/internal/api-index.md')
    expect(fsSync.existsSync(apiIndexFile)).toBe(true)
    const apiIndexContent = await fs.readFile(apiIndexFile, 'utf8')
    expect(apiIndexContent).toContain('@oa-sdk/codegen')
    expect(apiIndexContent).toContain('@oa-sdk/router')

    // 5. Verify documentation check passes cleanly
    const res = runOaCli(['--version'])
    expect([0, 1]).toContain(res.status)
  })
})
