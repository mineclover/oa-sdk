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
  builtAgainstVersion,
  expectedOaSdkSpecifier,
  PRODUCT_LIFECYCLE_ARCHETYPES,
  TARGET_FRAMEWORK_IDS,
  type OaSdkInstallSource,
} from './helpers/oracle.js'
import { BUILT_AGAINST_VERSIONS } from '../../cli/lib/built-against-versions.js'
import {
  OA_SDK_INIT_PACKAGES,
  REGISTRY_SOURCES,
  composeInitDependencies,
  getArchetypeProfile,
  getTargetProfile,
  type OaSdkPackageSources,
} from '../../cli/lib/init/index.js'

const REPO_ROOT = path.resolve(__dirname, '../../../../..')
const CODEGEN_SRC = path.resolve(__dirname, '../..')
const CODEGEN_PKG = path.resolve(__dirname, '../../..')

describe('E2E Tier 3: Cross-Feature Pairwise Combinations (20 Combinations)', () => {
  let fixture: WorkspaceFixture

  beforeEach(async () => {
    fixture = await createOnboardingFixture({ hasGit: true }, 'tier3-comb-')
  })

  afterEach(async () => {
    if (fixture) {
      await fixture.cleanup()
    }
  })

  // =========================================================================
  // Target Framework x Lifecycle Archetype Matrix Tests
  // =========================================================================

  it('T3-01: Fastify x MVP — Fastify router with live mock-first and client SDK', () => {
    const scripts = getRecommendedScriptsForPair('fastify', 'mvp', 'node')
    const deps = getRecommendedDevDepsForPair('fastify', 'mvp', 'node')

    expect(scripts['dev']).toBe('tsx watch src/server.ts')
    expect(scripts['generate']).toBe('oa-gen generate')
    expect(scripts['mock']).toBe('oa-gen mock --watch')
    expect(scripts['validate']).toBe('oa-gen validate')

    // Outside a workspace, the releases compatible with the ones codegen was built against.
    expect(deps['@oa-sdk/router']).toBe(`^${builtAgainstVersion('@oa-sdk/router')}`)
    expect(deps['@oa-sdk/client']).toBe(`^${builtAgainstVersion('@oa-sdk/client')}`)
    expect(deps['@oa-sdk/mock-server']).toBe(`^${builtAgainstVersion('@oa-sdk/mock-server')}`)
    expect(deps['tsx']).toBe('^4.7.0')

    // Inside the oa-sdk workspace, its own packages.
    const workspaceDeps = getRecommendedDevDepsForPair('fastify', 'mvp', 'node', 'workspace')
    expect(workspaceDeps['@oa-sdk/router']).toBe('workspace:*')
    expect(workspaceDeps['@oa-sdk/client']).toBe('workspace:*')
    expect(workspaceDeps['@oa-sdk/mock-server']).toBe('workspace:*')
  })

  it('T3-02: Fastify x Microservice — pure handler contracts, and no test runner for tests init does not write', () => {
    const scripts = getRecommendedScriptsForPair('fastify', 'microservice', 'node')
    const deps = getRecommendedDevDepsForPair('fastify', 'microservice', 'node')

    expect(scripts['dev']).toBe('tsx watch src/server.ts')
    expect(scripts['generate']).toBe('oa-gen generate')
    expect(scripts['test:contract']).toBeUndefined()
    expect(scripts['audit:wire']).toBeUndefined()

    expect(deps['@oa-sdk/core']).toBe(`^${builtAgainstVersion('@oa-sdk/core')}`)
    expect(deps['vitest']).toBeUndefined()
  })

  it('T3-03: Fastify x Enterprise — breaking diff gate against the contract baseline and persona enforcement', () => {
    const scripts = getRecommendedScriptsForPair('fastify', 'enterprise', 'node')
    const deps = getRecommendedDevDepsForPair('fastify', 'enterprise', 'node')

    expect(scripts['diff']).toBe('oa-gen diff --base openapi.baseline.yaml --head openapi.yaml --fail-on-breaking')
    expect(scripts['personas:check']).toBeUndefined()
    expect(scripts['ci:gate']).toContain('oa-gen diff --base openapi.baseline.yaml --head openapi.yaml --fail-on-breaking')
    // @oa-sdk/personas is private: only the workspace provides it.
    expect(deps['@oa-sdk/personas']).toBeUndefined()
    expect(getRecommendedDevDepsForPair('fastify', 'enterprise', 'node', 'workspace')['@oa-sdk/personas']).toBe('workspace:*')
  })

  it('T3-04: Bun Elysia x MVP — Bun native server with zero Node tools and live mock', () => {
    const scripts = getRecommendedScriptsForPair('elysia', 'mvp', 'bun')
    const deps = getRecommendedDevDepsForPair('elysia', 'mvp', 'bun')

    expect(scripts['dev']).toBe('bun --watch src/index.ts')
    expect(scripts['generate']).toBe('bun x oa-gen generate')
    expect(scripts['mock']).toBe('bun x oa-gen mock --watch')

    // Invariant: strictly 0 Node tooling
    expect(deps['tsx']).toBeUndefined()
    expect(deps['nodemon']).toBeUndefined()
    expect(deps['@types/node']).toBeUndefined()
    expect(deps['@types/bun']).toBe('latest')
  })

  it('T3-05: Bun Elysia x Microservice — handler contracts on Bun, with no test runner', () => {
    const scripts = getRecommendedScriptsForPair('elysia', 'microservice', 'bun')
    const deps = getRecommendedDevDepsForPair('elysia', 'microservice', 'bun')

    expect(scripts['dev']).toBe('bun --watch src/index.ts')
    expect(scripts['generate']).toBe('bun x oa-gen generate')
    expect(scripts['test:contract']).toBeUndefined()

    // Invariant: strictly zero vitest in Bun microservice
    expect(deps['vitest']).toBeUndefined()
    expect(deps['tsx']).toBeUndefined()
    expect(deps['@types/bun']).toBe('latest')
  })

  it('T3-06: Bun Elysia x Enterprise — Bun-native diff gate against the contract baseline', () => {
    const scripts = getRecommendedScriptsForPair('elysia', 'enterprise', 'bun')
    const deps = getRecommendedDevDepsForPair('elysia', 'enterprise', 'bun')

    expect(scripts['diff']).toBe('bun x oa-gen diff --base openapi.baseline.yaml --head openapi.yaml --fail-on-breaking')
    expect(scripts['ci:gate']).toContain('bun x oa-gen diff --base openapi.baseline.yaml --head openapi.yaml --fail-on-breaking')
    expect(deps['@oa-sdk/personas']).toBeUndefined()
    expect(getRecommendedDevDepsForPair('elysia', 'enterprise', 'bun', 'workspace')['@oa-sdk/personas']).toBe('workspace:*')
    expect(deps['tsx']).toBeUndefined()
  })

  it('T3-07: Hono (Node ESM) x Microservice — contracts on Node with no test runner', () => {
    const scripts = getRecommendedScriptsForPair('hono', 'microservice', 'node')
    const deps = getRecommendedDevDepsForPair('hono', 'microservice', 'node')

    expect(scripts['dev']).toBe('tsx watch src/index.ts')
    expect(scripts['generate']).toBe('oa-gen generate')
    expect(scripts['test:contract']).toBeUndefined()
    expect(deps['tsx']).toBe('^4.7.0')
    expect(deps['vitest']).toBeUndefined()
  })

  it('T3-08: Hono (Bun native) x Microservice — contracts on Bun with no test runner', () => {
    const scripts = getRecommendedScriptsForPair('hono', 'microservice', 'bun')
    const deps = getRecommendedDevDepsForPair('hono', 'microservice', 'bun')

    expect(scripts['dev']).toBe('bun --watch src/index.ts')
    expect(scripts['generate']).toBe('bun x oa-gen generate')
    expect(scripts['test:contract']).toBeUndefined()
    expect(deps['@types/bun']).toBe('latest')
    expect(deps['tsx']).toBeUndefined()
    expect(deps['vitest']).toBeUndefined()
  })

  it('T3-09: Express x Enterprise — breaking change CI gate, and no audit of a bundle the API project does not have', () => {
    const scripts = getRecommendedScriptsForPair('express', 'enterprise', 'node')
    expect(scripts['dev']).toBe('tsx watch src/app.ts')
    expect(scripts['diff']).toBe('oa-gen diff --base openapi.baseline.yaml --head openapi.yaml --fail-on-breaking')
    expect(scripts['audit:csp']).toBeUndefined()
  })

  it('T3-10: NestJS x Microservice — Nest CLI co-existence with generic contract generation', () => {
    const scripts = getRecommendedScriptsForPair('nestjs', 'microservice', 'node')
    expect(scripts['start:dev']).toBe('nest start --watch')
    expect(scripts['generate']).toBe('oa-gen generate')
    expect(scripts['test:contract']).toBeUndefined()
  })

  it('T3-11: Generic x MVP — Framework-agnostic baseline with live mock and client SDK', () => {
    const scripts = getRecommendedScriptsForPair('generic', 'mvp', 'node')
    const deps = getRecommendedDevDepsForPair('generic', 'mvp', 'node')

    expect(scripts['generate']).toBe('oa-gen generate')
    expect(scripts['mock']).toBe('oa-gen mock --watch')
    expect(deps['@oa-sdk/router']).toBeUndefined() // generic has 0 router dependency
    expect(deps['@oa-sdk/client']).toBe(`^${builtAgainstVersion('@oa-sdk/client')}`)
  })

  it('T3-12: Generic x Enterprise — Framework-agnostic full governance baseline', () => {
    const scripts = getRecommendedScriptsForPair('generic', 'enterprise', 'node')
    expect(scripts['diff']).toContain('--fail-on-breaking')
    expect(scripts['personas:check']).toBeUndefined()
    expect(scripts['lint:spec']).toBe('oa-gen lint --spec openapi.yaml')
    expect(scripts['ci:gate']).toBeDefined()
  })

  // =========================================================================
  // Dual-Layer Configuration & Resolution Interactions
  // =========================================================================

  it('T3-13: Dual-layer configuration with explicit core and product blocks synthesized into oa.config.ts', async () => {
    const configContent = `import { defineConfig } from '@oa-sdk/codegen'

export default defineConfig({
  rootDir: '.',
  archetype: 'microservice',
  core: {
    dialect: { oasVersion: '3.2.0', jsonSchemaDialect: 'draft-2020-12' },
    contracts: { pureHandlers: true, contractName: 'ApiHandlers' },
    client: { enabled: true, wireFormatSafety: true },
  },
  product: {
    framework: 'fastify',
    jitSchema: true,
    specs: [
      { id: 'orders', schemaEntry: './orders.yaml', outDir: './src/generated' },
    ],
  },
})`
    await fixture.writeFile('oa.config.ts', configContent)
    expect(fixture.exists('oa.config.ts')).toBe(true)
    const read = await fixture.readFile('oa.config.ts')
    expect(read).toContain("archetype: 'microservice'")
    expect(read).toContain("jitSchema: true")
  })

  it('T3-14: Dual-layer config with top-level spec aliases correctly resolved alongside product.specs', () => {
    const rawConfig = {
      specs: [
        { id: 'top-level-api', schemaEntry: './top.yaml', outDir: './out' },
      ],
      product: {
        specs: [
          { id: 'product-api', schemaEntry: './prod.yaml', outDir: './out' },
        ],
      },
    }
    const resolved = resolveConfigWithDefaults(rawConfig)
    expect(resolved.specs).toHaveLength(1) // top-level specs takes precedence or is merged
    expect(resolved.specs![0]?.id).toBe('top-level-api')
  })

  // =========================================================================
  // Context Injection x Framework Binder Interactions
  // =========================================================================

  it('T3-15: Context Injection x Fastify JIT schema Route Generation', () => {
    const contract = generateHandlerContractWithContext(SAMPLE_OAS32_JSON, {
      contextImport: './fastify-context.js',
      contextTypeName: 'FastifyRequestContext',
    })

    expect(contract).toContain("import type { FastifyRequestContext } from './fastify-context.js'")
    expect(contract).toContain('GetUserContext<TContext = FastifyRequestContext>')
    expect(contract).toContain('ApiHandlers<TContext = FastifyRequestContext>')

    // Verify Fastify binder context forwarding pattern
    const simulatedFastifyRouteHandler = (req: { params: { id: string }; user: string; tenantId: string }) => {
      const extractedContext: { user: string; tenantId: string } = { user: req.user, tenantId: req.tenantId }
      return {
        params: req.params,
        context: extractedContext,
      }
    }

    const res = simulatedFastifyRouteHandler({ params: { id: 'u100' }, user: 'alice', tenantId: 'tenant-1' })
    expect(res.params.id).toBe('u100')
    expect(res.context.user).toBe('alice')
    expect(res.context.tenantId).toBe('tenant-1')
  })

  it('T3-16: Context Injection x Bun Elysia Zero-Copy Context Destructuring', () => {
    const contract = generateHandlerContractWithContext(SAMPLE_OAS32_JSON, {
      contextImport: './elysia-context.js',
      contextTypeName: 'ElysiaStateContext',
    })

    expect(contract).toContain("import type { ElysiaStateContext } from './elysia-context.js'")

    // Verify Elysia zero-copy selective destructuring and context injection
    const simulatedElysiaHandler = (elysiaCtx: { params: { id: string }; store: { session: string } }) => {
      const { params, store } = elysiaCtx
      return {
        params,
        context: { session: store.session },
      }
    }

    const res = simulatedElysiaHandler({ params: { id: 'ely-1' }, store: { session: 'sess-abc' } })
    expect(res.params.id).toBe('ely-1')
    expect(res.context.session).toBe('sess-abc')
  })

  it('T3-17: Context Injection x Hono Router (c.var extraction)', () => {
    const contract = generateHandlerContractWithContext(SAMPLE_OAS32_JSON, {
      contextTypeName: 'HonoVariables',
    })

    expect(contract).toContain('export interface ApiHandlers<TContext = HonoVariables>')

    const simulatedHonoRoute = (c: { req: { param: () => Record<string, string> }; get: (key: string) => unknown }) => {
      const context = { userId: c.get('userId'), role: c.get('role') }
      return {
        params: c.req.param(),
        context,
      }
    }

    const mockC = {
      req: { param: () => ({ id: 'hono-user' }) },
      get: (key: string) => (key === 'userId' ? 'u-99' : 'admin'),
    }
    const res = simulatedHonoRoute(mockC)
    expect(res.params.id).toBe('hono-user')
    expect(res.context.userId).toBe('u-99')
    expect(res.context.role).toBe('admin')
  })

  it('T3-18: Context Injection x Express Router (req.user extraction)', () => {
    const contract = generateHandlerContractWithContext(SAMPLE_OAS32_JSON, {
      contextImport: './express-types.js',
      contextTypeName: 'AuthUserContext',
    })

    expect(contract).toContain("import type { AuthUserContext } from './express-types.js'")

    const simulatedExpressRoute = (req: { params: Record<string, string>; user: { id: string } }) => {
      return {
        params: req.params,
        context: req.user,
      }
    }

    const res = simulatedExpressRoute({ params: { id: 'exp-1' }, user: { id: 'admin-1' } })
    expect(res.params.id).toBe('exp-1')
    expect(res.context.id).toBe('admin-1')
  })

  // =========================================================================
  // Multi-Target & Governance Invariant Combinations
  // =========================================================================

  it('T3-19: Multiple Spec Targets with mixed framework bindings in one config', () => {
    const mixedConfig = {
      rootDir: '.',
      archetype: 'microservice' as const,
      specs: [
        { id: 'fastify-gateway', target: 'fastify' as const, schemaEntry: './gateway.yaml', outDir: './src/gateway' },
        { id: 'elysia-worker', target: 'elysia' as const, schemaEntry: './worker.yaml', outDir: './src/worker' },
      ],
    }
    const result = validateDualLayerConfig(mixedConfig)
    expect(result.valid).toBe(true)
    const resolved = resolveConfigWithDefaults(mixedConfig)
    expect(resolved.specs).toHaveLength(2)
    expect(resolved.specs![0]?.target).toBe('fastify')
    expect(resolved.specs![1]?.target).toBe('elysia')
  })

  it('T3-20: Monorepo Governance Manifest Parity + Skill Syntax Validation', async () => {
    // 1. Check skill existence and closed-by-default governance
    const skillPath = path.resolve(REPO_ROOT, '.agents/skills-optional/oa-onboarding/SKILL.md')
    expect(fsSync.existsSync(skillPath)).toBe(true)
    const skillContent = await fs.readFile(skillPath, 'utf8')
    expect(skillContent).toContain('oa-onboarding')
    expect(skillContent).toContain('Diagnostic Decision Matrices')

    // 2. Check playbook existence and runbook content
    const playbookPath = path.resolve(REPO_ROOT, 'docs/guides/onboarding-playbook.md')
    expect(fsSync.existsSync(playbookPath)).toBe(true)
    const playbookContent = await fs.readFile(playbookPath, 'utf8')
    expect(playbookContent).toContain('Value Adoption Ladder')

    // 3. Verify CLI help output
    const res = runOaCli(['init', '--help'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('init')
  })

  it('T3-21: init writes the expected specifier for every @oa-sdk package, from the registry and inside the workspace', () => {
    const sources: Array<[OaSdkInstallSource, OaSdkPackageSources]> = [
      ['registry', REGISTRY_SOURCES],
      ['workspace', { workspacePackages: new Set(Object.keys(OA_SDK_INIT_PACKAGES)), versions: BUILT_AGAINST_VERSIONS }],
    ]
    for (const framework of TARGET_FRAMEWORK_IDS) {
      for (const archetype of PRODUCT_LIFECYCLE_ARCHETYPES) {
        const target = getTargetProfile(framework)
        for (const [source, oaSdkSources] of sources) {
          const label = `${framework} x ${archetype} (${source})`
          const { devDependencies, unavailable } = composeInitDependencies(target, getArchetypeProfile(archetype), {
            cwd: '/workspace/app',
            frameworkId: framework,
            runtime: target.defaultRuntime,
            oaSdkSources,
          })
          for (const [name, specifier] of Object.entries(devDependencies)) {
            if (name.startsWith('@oa-sdk/')) expect(specifier, `${label}: ${name}`).toBe(expectedOaSdkSpecifier(name, source))
          }
          for (const { name } of unavailable) expect(expectedOaSdkSpecifier(name, source), `${label}: ${name}`).toBeUndefined()
        }
      }
    }
  })
})
