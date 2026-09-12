import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import {
  petstoreSpec,
  extendedVerbsSpec,
  richSchemaSpec,
  destructuringSpec,
  sampleTsOperationSource,
} from './helpers/fixtures.js'
import {
  generateHandlerContract,
  generateRouter,
  validateTsSyntax,
} from './helpers/router-harness.js'
import {
  runInit,
  detectSchemas,
} from './helpers/init-harness.js'
import {
  startMockServer,
  sendHttpRequest,
  parseSpecDocument,
  type ActiveMockInstance,
} from './helpers/mock-harness.js'
import { runScript } from './helpers/cli.js'

describe('Tier 4: Real-World Developer Workflows & End-to-End Scenarios', () => {
  let tmpRoot: string

  beforeAll(async () => {
    tmpRoot = path.resolve(__dirname, '../../../../.tmp-tier4-scenarios')
    await fs.mkdir(tmpRoot, { recursive: true })
  })

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('T4-S1: Bun/Elysia Microservice Complete Onboarding & Live Route Hot-Reload', async () => {
    const projectDir = path.join(tmpRoot, 'bun-microservice')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(path.join(projectDir, 'bun.lockb'), '')
    await fs.writeFile(
      path.join(projectDir, 'package.json'),
      JSON.stringify({
        name: 'bun-microservice',
        version: '1.0.0',
        dependencies: { elysia: '^1.0.0' },
      }, null, 2),
    )
    await fs.writeFile(path.join(projectDir, 'openapi.yaml'), 'openapi: 3.2.0\ninfo:\n  title: Bun API\n  version: 1.0.0\npaths: {}\n')

    // 1. Onboarding with Bun runtime isolation
    const initRes = await runInit({ cwd: projectDir, target: 'elysia' })
    expect(initRes.targetId).toBe('elysia')
    expect(initRes.runtime).toBe('bun')

    const pkg = JSON.parse(await fs.readFile(path.join(projectDir, 'package.json'), 'utf-8'))
    expect(pkg.scripts['dev']).toContain('bun --watch')
    expect(pkg.scripts['dev']).not.toContain('tsx')
    expect(pkg.devDependencies['@types/bun']).toBeDefined()
    expect(pkg.devDependencies['@types/node']).toBeUndefined()

    // 2. Generate Elysia router with zero-copy context destructuring
    const elysiaRouter = generateRouter(destructuringSpec, {
      target: 'elysia',
      contractImport: './api.contract',
    })
    expect(elysiaRouter).toContain("import { Elysia } from 'elysia'")
    expect(elysiaRouter).toContain(".get('/ping', async ({ set }) => {")
    expect(elysiaRouter).toContain(".get('/items/:id', async ({ params, set }) => {")
    expect(validateTsSyntax(elysiaRouter).valid).toBe(true)

    // 3. Start mock server with initial endpoints
    const initialSpec = {
      openapi: '3.2.0',
      info: { title: 'Bun Live API', version: '1.0.0' },
      servers: [{ url: '/' }],
      paths: {
        '/health': {
          get: {
            operationId: 'getHealth',
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { schema: { type: 'object' }, example: { status: 'healthy', runtime: 'bun' } } },
              },
            },
          },
        },
      },
    }

    const mock = await startMockServer(initialSpec as any)
    try {
      const res1 = await sendHttpRequest(`${mock.url}/health`)
      expect(res1.status).toBe(200)
      const data1 = JSON.parse(res1.body)
      expect(data1.runtime).toBe('bun')

      // 4. Hot-reload routes by adding extended OAS 3.2 QUERY verb route
      mock.updateSpec(extendedVerbsSpec)

      const res2 = await sendHttpRequest(`${mock.url}/users/search`, {
        method: 'QUERY',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'bun' }),
      })
      expect(res2.status).toBe(200)
    } finally {
      await mock.stop()
    }
  })

  it('T4-S2: Fastify Enterprise API Contract Update & JIT Schema Regeneration', async () => {
    const projectDir = path.join(tmpRoot, 'fastify-enterprise')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(
      path.join(projectDir, 'package.json'),
      JSON.stringify({
        name: 'fastify-enterprise',
        version: '2.0.0',
        dependencies: { fastify: '^4.26.0' },
      }, null, 2),
    )

    // 1. Onboarding Fastify target
    const initRes = await runInit({ cwd: projectDir, target: 'fastify' })
    expect(initRes.targetId).toBe('fastify')
    expect(initRes.runtime).toBe('node')

    // 2. Generate initial handler contract & Fastify router
    const contractV1 = generateHandlerContract(petstoreSpec, { contractName: 'PetstoreHandlers' })
    expect(contractV1).toContain('export interface PetstoreHandlers<TContext = unknown> {')
    expect(contractV1).toContain('listPets: ListPetsHandler')
    expect(validateTsSyntax(contractV1).valid).toBe(true)

    const routerV1 = generateRouter(petstoreSpec, {
      target: 'fastify',
      contractImport: './petstore.contract',
      contractName: 'PetstoreHandlers',
    })
    expect(routerV1).toContain("fastify.get('/pets'")
    expect(routerV1).toContain('"querystring": {')
    expect(validateTsSyntax(routerV1).valid).toBe(true)

    // 3. Spec updates with new enterprise order management routes
    const updatedSpec = {
      ...petstoreSpec,
      paths: {
        ...petstoreSpec.paths,
        ...richSchemaSpec.paths,
      },
    }

    // 4. Regenerate handler contract & Fastify router
    const contractV2 = generateHandlerContract(updatedSpec, { contractName: 'PetstoreHandlers' })
    expect(contractV2).toContain('listPets: ListPetsHandler')
    expect(contractV2).toContain('updateOrder: UpdateOrderHandler')
    expect(contractV2).toContain('export interface UpdateOrderContext<TContext = unknown> {')
    expect(validateTsSyntax(contractV2).valid).toBe(true)

    const routerV2 = generateRouter(updatedSpec, {
      target: 'fastify',
      contractImport: './petstore.contract',
      contractName: 'PetstoreHandlers',
    })
    expect(routerV2).toContain("fastify.put('/orders/:orderId'")
    expect(routerV2).toContain('"format": "uuid"')
    expect(routerV2).toContain('"format": "date-time"')
    expect(validateTsSyntax(routerV2).valid).toBe(true)
  })

  it('T4-S3: Dual-Framework Contract Deployment (Express Legacy Stubs & Hono Contract Binding)', async () => {
    // 1. Generate Express legacy stubs (when contractImport is omitted)
    const expressLegacyStub = generateRouter(petstoreSpec, {
      target: 'express',
      mode: 'stub',
    })
    expect(expressLegacyStub).toContain("import { Router } from 'express'")
    expect(expressLegacyStub).toContain('// TODO: implement listPets')
    expect(expressLegacyStub).toContain('export default router')
    expect(validateTsSyntax(expressLegacyStub).valid).toBe(true)

    // 2. Generate Hono contract-bound router (when contractImport is provided)
    const honoContractRouter = generateRouter(petstoreSpec, {
      target: 'hono',
      contractImport: './api.contract',
    })
    expect(honoContractRouter).toContain("import { Hono } from 'hono'")
    expect(honoContractRouter).toContain("import type { ApiHandlers } from './api.contract'")
    expect(honoContractRouter).toContain('export function createRouter(handlers: ApiHandlers): Hono')
    expect(honoContractRouter).toContain('export default createRouter')
    expect(validateTsSyntax(honoContractRouter).valid).toBe(true)

    // 3. Verify zero runtime framework dependencies in package.json
    const routerPkgPath = path.resolve(__dirname, '../../../packages/router/package.json')
    const raw = await fs.readFile(routerPkgPath, 'utf-8')
    const pkg = JSON.parse(raw)
    expect(pkg.dependencies?.['express']).toBeUndefined()
    expect(pkg.dependencies?.['hono']).toBeUndefined()
    expect(pkg.dependencies?.['fastify']).toBeUndefined()
    expect(pkg.dependencies?.['elysia']).toBeUndefined()
  })

  it('T4-S4: Live TypeScript-First API Prototyping with JSDoc @oaOperation and Mock Hot-Reload', async () => {
    const tsFile = path.join(tmpRoot, 'controllers.ts')
    await fs.writeFile(tsFile, sampleTsOperationSource, 'utf-8')

    // 1. Schema detector discovers TypeScript source with @oaOperation
    const detected = await detectSchemas(tmpRoot)
    const tsItem = detected.find(d => d.type === 'jsdoc-operations')
    expect(tsItem).toBeDefined()

    // 2. Live spec parser parses TypeScript source into OasDocument 3.2
    const { document, format } = await parseSpecDocument(tsFile)
    expect(format).toBe('typescript')
    expect(document.openapi).toBe('3.2.0')
    expect(document.paths['/api/v1/users']?.['get']).toBeDefined()
    expect(document.paths['/api/v1/users/search']?.['query']).toBeDefined()

    // 3. Launch mock server with initial health check, then hot-swap with extracted operations
    const initialSpec = {
      openapi: '3.2.0',
      info: { title: 'Bootstrap', version: '1.0.0' },
      servers: [{ url: '/' }],
      paths: {
        '/ping': {
          get: {
            operationId: 'ping',
            responses: {
              '200': {
                description: 'Pong',
                content: { 'application/json': { schema: { type: 'object' }, example: { pong: true } } },
              },
            },
          },
        },
      },
    }

    const mock = await startMockServer(initialSpec as any)
    try {
      const pingRes = await sendHttpRequest(`${mock.url}/ping`)
      expect(pingRes.status).toBe(200)

      // Hot-swap
      const updateRes = mock.updateSpec(document)
      expect(updateRes.routesCount).toBeGreaterThan(0)

      // HTTP GET on extracted operation
      const usersRes = await sendHttpRequest(`${mock.url}/api/v1/users`)
      expect(usersRes.status).toBe(200)
      const usersData = JSON.parse(usersRes.body)
      expect(usersData.operationId).toBe('listUsers')

      // HTTP QUERY on extracted OAS 3.2 operation
      const searchRes = await sendHttpRequest(`${mock.url}/api/v1/users/search`, {
        method: 'QUERY',
      })
      expect(searchRes.status).toBe(200)
      const searchData = JSON.parse(searchRes.body)
      expect(searchData.operationId).toBe('searchUsers')
    } finally {
      await mock.stop()
    }
  })

  it('T4-S5: Monorepo Governance & Verification Gate Validation', async () => {
    // 1. Documentation gate
    const docsRes = await runScript('node', ['--import', 'tsx', 'scripts/check-docs.ts'])
    expect(docsRes.exitCode).toBe(0)
    expect(docsRes.stdout).toContain('Documentation OK')

    // 2. CLI spec gate
    const cliRes = await runScript('node', ['--import', 'tsx', 'scripts/check-cli-spec.ts'])
    expect(cliRes.exitCode).toBe(0)
    expect(cliRes.stdout).toContain('CLI spec OK')

    // 3. Release policy gate
    const releaseRes = await runScript('node', ['--import', 'tsx', 'scripts/check-release-policy.ts'])
    expect(releaseRes.exitCode).toBe(0)
    expect(releaseRes.stdout).toContain('Release policy OK')

    // 4. Validate CLI command documentation
    const cliDoc = await fs.readFile(
      path.resolve(__dirname, '../../../docs/guides/cli-command-reference.md'),
      'utf-8',
    )
    expect(cliDoc).toContain('oa-gen')
  })
})
