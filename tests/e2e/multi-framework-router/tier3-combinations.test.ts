import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import {
  petstoreSpec,
  extendedVerbsSpec,
  richSchemaSpec,
  destructuringSpec,
  sampleTsOperationSource,
  packageJson4Spaces,
} from './helpers/fixtures.js'
import {
  generateHandlerContract,
  generateRouter,
  validateTsSyntax,
} from './helpers/router-harness.js'
import {
  TARGET_PROFILES,
  detectSchemas,
  patchPackageJson,
  runInit,
} from './helpers/init-harness.js'
import {
  startMockServer,
  sendHttpRequest,
  parseSpecDocument,
  type ActiveMockInstance,
} from './helpers/mock-harness.js'
import { runRootPackageScript } from './helpers/cli.js'

describe('Tier 3: Cross-Feature Combinations', () => {
  let tmpRoot: string

  beforeAll(async () => {
    tmpRoot = path.resolve(__dirname, '../../../../.tmp-combinations-test')
    await fs.mkdir(tmpRoot, { recursive: true })
  })

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('T3-01: Onboarding Fastify Init + Router Fastify Target + Mock Server Execution', async () => {
    const projectDir = path.join(tmpRoot, 'fastify-combo')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ name: 'fastify-combo', dependencies: { fastify: '^4.26.0' } }),
    )
    await fs.writeFile(path.join(projectDir, 'openapi.yaml'), 'openapi: 3.2.0')

    // 1. Run onboarding
    const initRes = await runInit({ cwd: projectDir, target: 'fastify' })
    expect(initRes.targetId).toBe('fastify')
    expect(initRes.runtime).toBe('node')

    // 2. Generate Fastify router
    const routerCode = generateRouter(petstoreSpec, { target: 'fastify' })
    expect(routerCode).toContain("import type { FastifyPluginAsync } from 'fastify'")
    expect(validateTsSyntax(routerCode).valid).toBe(true)

    // 3. Start mock server and verify response
    const mock = await startMockServer(petstoreSpec)
    try {
      const res = await sendHttpRequest(`${mock.url}/pets`)
      expect(res.status).toBe(200)
    } finally {
      await mock.stop()
    }
  })

  it('T3-02: Onboarding Bun/Elysia Init + Router Elysia Target + Zero-Copy Destructuring', async () => {
    const projectDir = path.join(tmpRoot, 'elysia-combo')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ name: 'elysia-combo', dependencies: { elysia: '^1.0.0' } }),
    )

    // 1. Run onboarding
    const initRes = await runInit({ cwd: projectDir, target: 'elysia' })
    expect(initRes.targetId).toBe('elysia')
    expect(initRes.runtime).toBe('bun')
    const pkg = JSON.parse(await fs.readFile(path.join(projectDir, 'package.json'), 'utf-8'))
    expect(pkg.scripts['dev']).toContain('bun --watch')
    expect(pkg.scripts['dev']).not.toContain('tsx')

    // 2. Generate Elysia router with zero-copy selective destructuring
    const routerCode = generateRouter(destructuringSpec, {
      target: 'elysia',
      contractImport: './api.contract',
    })
    expect(routerCode).toContain(".get('/ping', async ({ set }) => {")
    expect(routerCode).toContain(".get('/items/:id', async ({ params, set }) => {")
    expect(validateTsSyntax(routerCode).valid).toBe(true)
  })

  it('T3-03: Pure Handler Contract Generation + Hono & Express Contract Binding', () => {
    // 1. Generate single handler contract
    const contract = generateHandlerContract(petstoreSpec, { contractName: 'ApiHandlers' })
    expect(contract).toContain('export interface ApiHandlers<TContext = unknown> {')
    expect(validateTsSyntax(contract).valid).toBe(true)

    // 2. Bind Hono router to contract
    const honoRouter = generateRouter(petstoreSpec, {
      target: 'hono',
      contractImport: './api.contract',
    })
    expect(honoRouter).toContain('export function createRouter(handlers: ApiHandlers): Hono')

    // 3. Bind Express router to contract
    const expressRouter = generateRouter(petstoreSpec, {
      target: 'express',
      contractImport: './api.contract',
    })
    expect(expressRouter).toContain('export function createRouter(handlers: ApiHandlers): Router')
  })

  it('T3-04: OAS 3.2 QUERY Verb + Fastify JIT Inlining + Live Mock Server Response', async () => {
    // 1. Fastify inlines schema on QUERY verb route
    const routerCode = generateRouter(extendedVerbsSpec, { target: 'fastify' })
    expect(routerCode).toContain("method: 'QUERY'")
    expect(routerCode).toContain("url: '/users/search'")
    expect(routerCode).toContain('"body": {')

    // 2. Start mock server and send QUERY request
    const mock = await startMockServer(extendedVerbsSpec)
    try {
      const res = await sendHttpRequest(`${mock.url}/users/search`, {
        method: 'QUERY',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'test' }),
      })
      expect(res.status).toBe(200)
    } finally {
      await mock.stop()
    }
  })

  it('T3-05: Agnostic Schema Detection + Onboarding Config Generation', async () => {
    const projectDir = path.join(tmpRoot, 'multi-schema-project')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(path.join(projectDir, 'main.tsp'), 'namespace Test;')
    await fs.writeFile(path.join(projectDir, 'openapi.yaml'), 'openapi: 3.2.0')
    await fs.writeFile(
      path.join(projectDir, 'api.ts'),
      '/** @oaOperation GET /status */\nexport function getStatus() {}',
    )

    const schemas = await detectSchemas(projectDir)
    expect(schemas.length).toBeGreaterThanOrEqual(3)

    // Primary detected schema (.tsp or .yaml) is used in config
    const initRes = await runInit({ cwd: projectDir, target: 'generic' })
    expect(initRes.detectedSchema).toBeDefined()
    const configContent = await fs.readFile(path.join(projectDir, 'oa.config.ts'), 'utf-8')
    expect(configContent).toContain("schemaEntry:")
  })

  it('T3-06: Package Patcher Preservation + Script Injection', () => {
    const res = patchPackageJson(packageJson4Spaces, {
      scripts: {
        'dev': 'tsx watch src/index.ts',
        'build': 'tsc',
      },
    })
    expect(res.indentation).toBe('    ')
    expect(res.modified).toBe(true)
    expect(res.patchedContent).toContain('        "lint": "eslint ."')
    expect(res.patchedContent).toContain('        "dev": "tsx watch src/index.ts"')
  })

  it('T3-07: TypeScript @oaOperation Source + Live Spec Watcher + In-Memory Mock Hot-Swap', async () => {
    const tsPath = path.join(tmpRoot, 'operations.ts')
    await fs.writeFile(tsPath, sampleTsOperationSource, 'utf-8')

    // Parse into OasDocument
    const { document } = await parseSpecDocument(tsPath)
    expect(document.openapi).toBe('3.2.0')
    expect(document.paths['/api/v1/users']?.['get']).toBeDefined()

    const initialSpec = {
      openapi: '3.2.0',
      info: { title: 'Initial API', version: '1.0.0' },
      servers: [{ url: '/' }],
      paths: {
        '/health': {
          get: {
            operationId: 'getHealth',
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { schema: { type: 'object' }, example: { status: 'healthy' } } },
              },
            },
          },
        },
      },
    }

    // Launch mock server with initial spec, then hot-swap with TS-extracted spec
    const mock = await startMockServer(initialSpec as any)
    try {
      const initialRes = await sendHttpRequest(`${mock.url}/health`)
      expect(initialRes.status).toBe(200)

      // Hot-swap
      const updateResult = mock.updateSpec(document)
      expect(updateResult.routesCount).toBeGreaterThan(0)

      // Verify newly added route responds
      const swappedRes = await sendHttpRequest(`${mock.url}/api/v1/users`)
      expect(swappedRes.status).toBe(200)
    } finally {
      await mock.stop()
    }
  })

  it('T3-08: Error Shielding During Live Watch + Recovery on Valid Document Update', async () => {
    const initialSpec = {
      openapi: '3.2.0',
      info: { title: 'Initial Health API', version: '1.0.0' },
      servers: [{ url: '/' }],
      paths: {
        '/health': {
          get: {
            operationId: 'checkHealth',
            responses: {
              '200': {
                description: 'Healthy',
                content: { 'application/json': { schema: { type: 'object' }, example: { ok: true } } },
              },
            },
          },
        },
      },
    }

    const mock = await startMockServer(initialSpec as any)
    try {
      // 1. Initial route works
      const res1 = await sendHttpRequest(`${mock.url}/health`)
      expect(res1.status).toBe(200)

      // 2. Reject broken spec
      const brokenSpec = {
        openapi: '3.2.0',
        paths: { '/broken': { get: { responses: { '200': { $ref: '#/broken/ref' } } } } },
      }
      expect(() => mock.updateSpec(brokenSpec as any)).toThrow()

      // 3. Initial route STILL works
      const res2 = await sendHttpRequest(`${mock.url}/health`)
      expect(res2.status).toBe(200)

      // 4. Recover on valid spec update
      mock.updateSpec(extendedVerbsSpec)
      const res3 = await sendHttpRequest(`${mock.url}/users/search`, {
        method: 'QUERY',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'admin' }),
      })
      expect(res3.status).toBe(200)
    } finally {
      await mock.stop()
    }
  })

  it('T3-09: Fastify Rich Schema Inlining + Handler Contract Context Unwrapping', () => {
    const contract = generateHandlerContract(richSchemaSpec)
    expect(contract).toContain('export interface UpdateOrderContext<TContext = unknown> {')
    expect(contract).toContain('params: Record<string, string>')
    expect(contract).toContain('query?:')
    expect(contract).toContain('body: unknown')

    const routerCode = generateRouter(richSchemaSpec, {
      target: 'fastify',
      contractImport: './api.contract',
    })
    expect(routerCode).toContain("fastify.put('/orders/:orderId'")
    expect(routerCode).toContain('"format": "uuid"')
    expect(routerCode).toContain('"format": "date-time"')
    expect(validateTsSyntax(routerCode).valid).toBe(true)
  })

  it('T3-10: Elysia Destructuring Optimization + Handler Contract Return Unwrapping', () => {
    const routerCode = generateRouter(destructuringSpec, {
      target: 'elysia',
      contractImport: './api.contract',
    })
    // 201 Created operation destructures { body, set } and checks result.status
    expect(routerCode).toContain(".post('/submit', async ({ body, set }) => {")
    expect(routerCode).toContain('if (resp.status) set.status = resp.status')
    expect(validateTsSyntax(routerCode).valid).toBe(true)
  })

  it('T3-11: Multi-Target Onboarding Runtime Isolation Verification', () => {
    const elysiaProfile = TARGET_PROFILES['elysia']
    const fastifyProfile = TARGET_PROFILES['fastify']

    const elysiaDeps = elysiaProfile.getRecommendedDependencies({
      cwd: '.',
      frameworkId: 'elysia',
      runtime: 'bun',
    })
    const fastifyDeps = fastifyProfile.getRecommendedDependencies({
      cwd: '.',
      frameworkId: 'fastify',
      runtime: 'node',
    })

    // Elysia has bun types, NO tsx
    expect(elysiaDeps.devDependencies['@types/bun']).toBeDefined()
    expect(elysiaDeps.devDependencies['tsx']).toBeUndefined()

    // Fastify has tsx and node types, NO bun types
    expect(fastifyDeps.devDependencies['tsx']).toBeDefined()
    expect(fastifyDeps.devDependencies['@types/node']).toBeDefined()
    expect(fastifyDeps.devDependencies['@types/bun']).toBeUndefined()
  })

  it('T3-12: High-Volume Route Spec + Handler Contract Generation + Fastify Plugin Compilation', () => {
    const multiSpec = {
      ...petstoreSpec,
      paths: {
        ...petstoreSpec.paths,
        ...extendedVerbsSpec.paths,
        ...richSchemaSpec.paths,
      },
    }

    const contract = generateHandlerContract(multiSpec)
    expect(validateTsSyntax(contract).valid).toBe(true)

    const fastifyRouter = generateRouter(multiSpec, {
      target: 'fastify',
      contractImport: './api.contract',
    })
    expect(validateTsSyntax(fastifyRouter).valid).toBe(true)
  })

  it('T3-13: Non-Destructive Script Merging with Collision Detection and --force Overwrite', () => {
    const initialPkg = JSON.stringify({
      name: 'collision-test',
      scripts: { 'dev': 'existing-dev-command' },
    })

    // Without force: dev is skipped
    const resNoForce = patchPackageJson(initialPkg, {
      scripts: { 'dev': 'new-dev-command', 'test': 'vitest' },
      force: false,
    })
    expect(resNoForce.scripts.find(s => s.key === 'dev')?.action).toBe('skipped')
    expect(resNoForce.patchedContent).toContain('"dev": "existing-dev-command"')
    expect(resNoForce.patchedContent).toContain('"test": "vitest"')

    // With force: dev is overwritten
    const resForce = patchPackageJson(initialPkg, {
      scripts: { 'dev': 'new-dev-command' },
      force: true,
    })
    expect(resForce.scripts.find(s => s.key === 'dev')?.action).toBe('updated')
    expect(resForce.patchedContent).toContain('"dev": "new-dev-command"')
  })

  it('T3-14: Zero Runtime Framework Dependencies Verification Across Generated Routers', async () => {
    const routerPkgPath = path.resolve(__dirname, '../../../packages/router/package.json')
    const raw = await fs.readFile(routerPkgPath, 'utf-8')
    const pkg = JSON.parse(raw)

    const prohibitedDeps = ['hono', 'express', 'fastify', 'elysia', 'koa', 'restify']
    for (const dep of prohibitedDeps) {
      expect(pkg.dependencies?.[dep]).toBeUndefined()
    }
  })

  it('T3-15: End-to-End Governance Gate Compliance + TypeScript AST Syntax Cleanliness', async () => {
    // Generate all router variants and ensure 100% valid TypeScript syntax
    for (const target of ['hono', 'express', 'fastify', 'elysia'] as const) {
      const stub = generateRouter(petstoreSpec, { target, mode: 'stub' })
      expect(validateTsSyntax(stub).valid).toBe(true)

      const contractBound = generateRouter(petstoreSpec, {
        target,
        contractImport: './api.contract',
      })
      expect(validateTsSyntax(contractBound).valid).toBe(true)
    }

    // Run governance check-cli-spec gate
    const cliSpecRes = await runRootPackageScript('check:cli-spec')
    expect(cliSpecRes.exitCode).toBe(0)
  })
})
