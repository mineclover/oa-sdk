import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { generate } from '../../cli/commands/generate.js'
import { resolveConfigWithDefaults, validateOaConfig } from '../../config.js'
import { runInit } from '../../cli/lib/init/index.js'

describe('CLI: oa-gen generate (Declarative Spec Pipeline)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-generate-pipeline-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('orchestrates end-to-end declarative pipeline with outputRouting presets and byKind rules', async () => {
    // 1. Create schema entry file that exports a projection builder
    const schemaEntryPath = path.join(tmpDir, 'spec-source.mjs')
    fs.writeFileSync(
      schemaEntryPath,
      `
export function buildProjection() {
  return {
    openApiDoc: {
      openapi: '3.1.0',
      info: { title: 'Pipeline Test API', version: '1.0.0' },
      paths: {
        '/users': {
          get: {
            tags: ['users'],
            operationId: 'listUsers',
            summary: 'List users',
            responses: {
              '200': {
                description: 'Users list',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/User' },
                    },
                  },
                },
              },
            },
          },
          post: {
            tags: ['users'],
            operationId: 'createUser',
            summary: 'Create user',
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/User' },
                },
              },
            },
            responses: {
              '201': {
                description: 'Created',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/User' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          User: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
            },
            required: ['id', 'name'],
          },
        },
      },
    },
    jsonSchemaDoc: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Pipeline Schema Bundle',
      $defs: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
          },
          required: ['id', 'name'],
        },
      },
    },
  }
}
`,
      'utf8',
    )

    // 2. Create oa.config.json with specs, core.contracts, core.client, product.outputRouting
    const configPath = path.join(tmpDir, 'oa.config.json')
    const configData = {
      rootDir: '.',
      specs: [
        {
          id: 'users-api',
          profile: 'full-api-document',
          schemaEntry: './spec-source.mjs',
          outDir: './generated/specs',
        },
      ],
      core: {
        contracts: {
          pureHandlers: true,
          contractName: 'UserHandlers',
        },
        client: {
          enabled: true,
        },
      },
      product: {
        outputRouting: {
          byKind: {
            contract: 'src/contracts/{tag}.contract.ts',
            client: 'src/sdk/{tag}.client.ts',
            keys: 'src/queries/{tag}.keys.ts',
            queries: 'src/queries/{tag}.queries.ts',
          },
        },
      },
    }
    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8')

    // 3. Execute declarative pipeline
    await generate.run({}, { cwd: tmpDir, projectRoot: tmpDir })

    // 4. Verify Step 1: Spec and schema artifacts
    const openApiPath = path.join(tmpDir, 'generated/specs/users-api.openapi.json')
    const jsonSchemaPath = path.join(tmpDir, 'generated/specs/users-api.schema.json')
    expect(fs.existsSync(openApiPath)).toBe(true)
    expect(fs.existsSync(jsonSchemaPath)).toBe(true)

    const openApiContent = JSON.parse(fs.readFileSync(openApiPath, 'utf8'))
    expect(openApiContent.openapi).toBe('3.1.0')
    expect(openApiContent.paths['/users']?.get?.operationId).toBe('listUsers')

    // 5. Verify Step 3: Handler contract
    const contractPath = path.join(tmpDir, 'src/contracts/users-api.contract.ts')
    expect(fs.existsSync(contractPath)).toBe(true)
    const contractContent = fs.readFileSync(contractPath, 'utf8')
    expect(contractContent).toContain('UserHandlers')

    // 6. Verify Step 4: Client SDK
    const clientPath = path.join(tmpDir, 'src/sdk/users-api.client.ts')
    expect(fs.existsSync(clientPath)).toBe(true)
    const clientContent = fs.readFileSync(clientPath, 'utf8')
    expect(clientContent.length).toBeGreaterThan(50)

    // 7. Verify Step 5: TanStack Query options
    const keysPath = path.join(tmpDir, 'src/queries/users-api.keys.ts')
    const queriesPath = path.join(tmpDir, 'src/queries/users-api.queries.ts')
    expect(fs.existsSync(keysPath)).toBe(true)
    expect(fs.existsSync(queriesPath)).toBe(true)

    const keysContent = fs.readFileSync(keysPath, 'utf8')
    expect(keysContent).toContain('usersKeys')

    const queriesContent = fs.readFileSync(queriesPath, 'utf8')
    expect(queriesContent).toContain('listUsersQueryOptions')
    // Relative import resolved between src/queries and src/sdk
    expect(queriesContent).toContain('../sdk/users-api.client.js')
    expect(queriesContent).toContain('./users-api.keys.js')

    // 8. Verify Step 6: Manifest tracking and SHA-256 hashes
    const manifestPath = path.join(tmpDir, '.oa-manifest.json')
    expect(fs.existsSync(manifestPath)).toBe(true)

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    expect(manifest.version).toBe(1)
    expect(manifest.artifacts).toHaveLength(6)

    const kinds = manifest.artifacts.map((a: any) => a.kind)
    expect(kinds).toContain('schemas')
    expect(kinds).toContain('contract')
    expect(kinds).toContain('client')
    expect(kinds).toContain('keys')
    expect(kinds).toContain('queries')

    for (const art of manifest.artifacts) {
      expect(art.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/)
      expect(fs.existsSync(path.resolve(tmpDir, art.path))).toBe(true)
    }
  })

  it('supports default fallback directory routing when outputRouting is omitted', async () => {
    const schemaEntryPath = path.join(tmpDir, 'spec-source.mjs')
    fs.writeFileSync(
      schemaEntryPath,
      `
export function buildProjection() {
  return {
    openApiDoc: {
      openapi: '3.1.0',
      info: { title: 'Default Routing API', version: '1.0.0' },
      paths: {
        '/items': {
          get: {
            tags: ['items'],
            operationId: 'getItems',
            responses: { '200': { description: 'ok' } },
          },
        },
      },
      components: { schemas: {} },
    },
    jsonSchemaDoc: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Default Routing',
      $defs: {},
    },
  }
}
`,
      'utf8',
    )

    const configPath = path.join(tmpDir, 'oa.config.json')
    const configData = {
      specs: [
        {
          id: 'items',
          profile: 'full-api-document',
          schemaEntry: './spec-source.mjs',
          outDir: './out/items',
        },
      ],
      core: {
        contracts: {
          pureHandlers: true,
        },
        client: {
          enabled: true,
        },
      },
    }
    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8')

    await generate.run({}, { cwd: tmpDir, projectRoot: tmpDir })

    expect(fs.existsSync(path.join(tmpDir, 'out/items/items.openapi.json'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'out/items/items.schema.json'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'out/items/items.contract.ts'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'out/items/items.client.ts'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'out/items/items.queries.ts'))).toBe(true)
  })

  it('reuses a complete spec target bundle on a second incremental generate run', async () => {
    const specPath = path.join(tmpDir, 'simple.json')
    fs.writeFileSync(specPath, JSON.stringify({
      openapi: '3.2.0',
      info: { title: 'Incremental Generate API', version: '1.0.0' },
      paths: {},
      components: { schemas: {} },
    }, null, 2), 'utf8')
    const warnings: string[] = []
    const warningSpy = vi.spyOn(console, 'warn').mockImplementation((...parts: unknown[]) => {
      warnings.push(parts.map(String).join(' '))
    })
    try {
      const args = {
        spec: specPath,
        output: path.join(tmpDir, 'generated'),
        incremental: true,
        'cache-dir': path.join(tmpDir, '.oa-cache'),
      }
      const context = { cwd: tmpDir, projectRoot: tmpDir }
      await generate.run(args, context)
      const openApiPath = path.join(tmpDir, 'generated', 'simple.openapi.json')
      const schemaPath = path.join(tmpDir, 'generated', 'simple.schema.json')
      const firstOpenApi = fs.readFileSync(openApiPath, 'utf8')
      const firstSchema = fs.readFileSync(schemaPath, 'utf8')

      await generate.run(args, context)

      expect(fs.readFileSync(openApiPath, 'utf8')).toBe(firstOpenApi)
      expect(fs.readFileSync(schemaPath, 'utf8')).toBe(firstSchema)
      expect(warnings.some(message => message.includes('generate target "simple" reused'))).toBe(true)

      fs.writeFileSync(specPath, JSON.stringify({
        openapi: '3.2.0',
        info: { title: 'Incremental Generate API', version: '2.0.0' },
        paths: {},
        components: { schemas: {} },
      }, null, 2), 'utf8')
      warnings.length = 0
      await generate.run(args, context)
      expect(warnings.some(message => message.includes('generate target "simple" regenerating'))).toBe(true)
      expect(JSON.parse(fs.readFileSync(openApiPath, 'utf8')).info.version).toBe('2.0.0')
    } finally {
      warningSpy.mockRestore()
    }
  })

  it('prunes orphaned artifacts safely when targets change', async () => {
    const schemaEntryPath = path.join(tmpDir, 'spec-source.mjs')
    fs.writeFileSync(
      schemaEntryPath,
      `
export function buildProjection() {
  return {
    openApiDoc: {
      openapi: '3.1.0',
      info: { title: 'Orphan Prune API', version: '1.0.0' },
      paths: {
        '/ping': {
          get: {
            operationId: 'ping',
            responses: { '200': { description: 'pong' } },
          },
        },
      },
      components: { schemas: {} },
    },
    jsonSchemaDoc: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $defs: {},
    },
  }
}
`,
      'utf8',
    )

    // Run first generation with target v1
    const configPath = path.join(tmpDir, 'oa.config.json')
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          specs: [{ id: 'v1', profile: 'full-api-document', schemaEntry: './spec-source.mjs', outDir: './out/v1' }],
          core: { contracts: { pureHandlers: true } },
        },
        null,
        2,
      ),
      'utf8',
    )

    await generate.run({}, { cwd: tmpDir, projectRoot: tmpDir })

    const oldContract = path.join(tmpDir, 'out/v1/v1.contract.ts')
    expect(fs.existsSync(oldContract)).toBe(true)

    // Run second generation with target v2 (replacing v1)
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          specs: [{ id: 'v2', profile: 'full-api-document', schemaEntry: './spec-source.mjs', outDir: './out/v2' }],
          core: { contracts: { pureHandlers: true } },
        },
        null,
        2,
      ),
      'utf8',
    )

    await generate.run({}, { cwd: tmpDir, projectRoot: tmpDir })

    // Old target files should be pruned
    expect(fs.existsSync(oldContract)).toBe(false)
    // New target files should exist
    expect(fs.existsSync(path.join(tmpDir, 'out/v2/v2.contract.ts'))).toBe(true)
  })

  it('preserves core.router.target and emits framework router (*.router.ts) alongside handler contract', async () => {
    const schemaEntryPath = path.join(tmpDir, 'spec-source.mjs')
    fs.writeFileSync(
      schemaEntryPath,
      `
export function buildProjection() {
  return {
    openApiDoc: {
      openapi: '3.1.0',
      info: { title: 'Router Target API', version: '1.0.0' },
      paths: {
        '/health': {
          get: {
            operationId: 'checkHealth',
            responses: { '200': { description: 'ok' } },
          },
        },
      },
      components: { schemas: {} },
    },
    jsonSchemaDoc: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $defs: {},
    },
  }
}
`,
      'utf8',
    )

    const configPath = path.join(tmpDir, 'oa.config.json')
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          specs: [{ id: 'health', profile: 'full-api-document', schemaEntry: './spec-source.mjs', outDir: './out/health' }],
          core: {
            contracts: { pureHandlers: true, contractName: 'HealthHandlers' },
            router: { target: 'fastify' },
            client: { enabled: false },
          },
        },
        null,
        2,
      ),
      'utf8',
    )

    await generate.run({}, { cwd: tmpDir, projectRoot: tmpDir })

    const contractPath = path.join(tmpDir, 'out/health/health.contract.ts')
    const routerPath = path.join(tmpDir, 'out/health/health.router.ts')
    expect(fs.existsSync(contractPath)).toBe(true)
    expect(fs.existsSync(routerPath)).toBe(true)

    const routerContent = fs.readFileSync(routerPath, 'utf8')
    expect(routerContent).toContain('HealthHandlers')
    expect(routerContent).toContain("from './health.contract.js'")
  })

  it('validates and resolves core.router and outputRouting.byKind.router in config', () => {
    const resolved = resolveConfigWithDefaults({
      archetype: 'enterprise',
      core: {
        router: {
          target: 'elysia',
          outDir: './src/routers',
          banner: false,
        },
      },
      outputRouting: {
        byKind: {
          router: 'src/server/{tag}.router.ts',
        },
      },
      specs: [{ id: 'orders', schemaEntry: './openapi.yaml', outDir: './dist' }],
    })

    expect(resolved.core.router).toEqual({
      target: 'elysia',
      outDir: './src/routers',
      banner: false,
    })
    expect(resolved.outputRouting?.byKind?.router).toBe('src/server/{tag}.router.ts')

    const validRes = validateOaConfig({
      core: {
        router: { target: 'hono', outDir: './src/routers', banner: true },
      },
      specs: [{ id: 'orders', profile: 'full-api-document', schemaEntry: './openapi.yaml', outDir: './dist' }],
    })
    expect(validRes.valid).toBe(true)

    const invalidRes = validateOaConfig({
      core: {
        router: { target: 'unknown-framework' as any, outDir: '   ', banner: 'yes' as any },
      },
      specs: [{ id: 'orders', profile: 'full-api-document', schemaEntry: './openapi.yaml', outDir: './dist' }],
    })
    expect(invalidRes.valid).toBe(false)
    expect(invalidRes.errors.map(e => e.path)).toEqual([
      'core.router.target',
      'core.router.outDir',
      'core.router.banner',
    ])
  })

  it('emits stub-mode router without contract file when pureHandlers is false and core.router.target is set', async () => {
    const schemaEntryPath = path.join(tmpDir, 'spec-source.mjs')
    fs.writeFileSync(
      schemaEntryPath,
      `
export function buildProjection() {
  return {
    openApiDoc: {
      openapi: '3.1.0',
      info: { title: 'Stub Router API', version: '1.0.0' },
      paths: {
        '/status': {
          get: {
            operationId: 'getStatus',
            responses: { '200': { description: 'ok' } },
          },
        },
      },
      components: { schemas: {} },
    },
    jsonSchemaDoc: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $defs: {},
    },
  }
}
`,
      'utf8',
    )

    const configPath = path.join(tmpDir, 'oa.config.json')
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          specs: [{ id: 'status', profile: 'full-api-document', schemaEntry: './spec-source.mjs', outDir: './out/status' }],
          core: {
            contracts: { pureHandlers: false },
            router: { target: 'hono', outDir: './src/routers' },
            client: { enabled: false },
          },
        },
        null,
        2,
      ),
      'utf8',
    )

    await generate.run({}, { cwd: tmpDir, projectRoot: tmpDir })

    const contractPath = path.join(tmpDir, 'out/status/status.contract.ts')
    const routerPath = path.join(tmpDir, 'src/routers/status.router.ts')
    expect(fs.existsSync(contractPath)).toBe(false)
    expect(fs.existsSync(routerPath)).toBe(true)

    const routerContent = fs.readFileSync(routerPath, 'utf8')
    expect(routerContent).toContain('TODO: implement getStatus')
    expect(routerContent).not.toContain('.contract.js')
  })

  it('routes contract and router via outputRouting.byKind into separate directories with relative import and manifest tracking', async () => {
    const schemaEntryPath = path.join(tmpDir, 'spec-source.mjs')
    fs.writeFileSync(
      schemaEntryPath,
      `
export function buildProjection() {
  return {
    openApiDoc: {
      openapi: '3.1.0',
      info: { title: 'Routed Router API', version: '1.0.0' },
      paths: {
        '/orders': {
          get: {
            operationId: 'listOrders',
            responses: { '200': { description: 'ok' } },
          },
        },
      },
      components: { schemas: {} },
    },
    jsonSchemaDoc: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $defs: {},
    },
  }
}
`,
      'utf8',
    )

    const configPath = path.join(tmpDir, 'oa.config.json')
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          specs: [{ id: 'orders', profile: 'full-api-document', schemaEntry: './spec-source.mjs', outDir: './out/orders' }],
          core: {
            contracts: { pureHandlers: true, contractName: 'OrderHandlers' },
            router: { target: 'elysia' },
            client: { enabled: false },
          },
          outputRouting: {
            byKind: {
              contract: 'src/contracts/{tag}.contract.ts',
              router: 'src/server/routers/{tag}.router.ts',
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    )

    await generate.run({}, { cwd: tmpDir, projectRoot: tmpDir })

    const contractPath = path.join(tmpDir, 'src/contracts/orders.contract.ts')
    const routerPath = path.join(tmpDir, 'src/server/routers/orders.router.ts')
    expect(fs.existsSync(contractPath)).toBe(true)
    expect(fs.existsSync(routerPath)).toBe(true)

    const routerContent = fs.readFileSync(routerPath, 'utf8')
    expect(routerContent).toContain("from '../../contracts/orders.contract.js'")
    expect(routerContent).toContain('OrderHandlers')

    const manifest = JSON.parse(fs.readFileSync(path.join(tmpDir, '.oa-manifest.json'), 'utf8'))
    expect(manifest.artifacts.some((a: any) => a.kind === 'router' && a.path === 'src/server/routers/orders.router.ts')).toBe(true)
  })

  it('executes full end-to-end flow from oa-gen init scaffolded oa.config.ts to oa-gen generate', async () => {
    const scopeDir = path.join(tmpDir, 'node_modules', '@oa-sdk')
    fs.mkdirSync(scopeDir, { recursive: true })
    fs.symlinkSync(path.resolve(__dirname, '../../..'), path.join(scopeDir, 'codegen'), 'dir')

    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'e2e-init-generate-app', dependencies: { fastify: '^4.20.0' } }, null, 2),
      'utf8',
    )
    const specFile = path.join(tmpDir, 'openapi.json')
    fs.writeFileSync(
      specFile,
      JSON.stringify(
        {
          openapi: '3.2.0',
          info: { title: 'E2E Init Generate API', version: '1.0.0' },
          paths: {
            '/tasks': {
              get: {
                tags: ['tasks'],
                operationId: 'listTasks',
                responses: {
                  '200': {
                    description: 'Task list',
                    content: {
                      'application/json': {
                        schema: {
                          type: 'array',
                          items: { $ref: '#/components/schemas/Task' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          components: {
            schemas: {
              Task: {
                type: 'object',
                required: ['id', 'title'],
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                },
              },
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    )

    const initRes = await runInit({
      cwd: tmpDir,
      target: 'fastify',
      archetype: 'microservice',
      routing: 'default',
      spec: 'openapi.json',
      yes: true,
    })
    expect(initRes.configFileCreated).toBe(true)

    await generate.run({}, { cwd: tmpDir, projectRoot: tmpDir })

    // Verify all scaffolded default routing artifacts for target id 'fastify-api'
    const baseApiDir = path.join(tmpDir, 'src/api/fastify-api')
    const contractPath = path.join(baseApiDir, 'fastify-api.contract.ts')
    const routerPath = path.join(baseApiDir, 'fastify-api.router.ts')
    const clientPath = path.join(baseApiDir, 'fastify-api.client.ts')
    const keysPath = path.join(baseApiDir, 'fastify-api.keys.ts')
    const queriesPath = path.join(baseApiDir, 'fastify-api.queries.ts')

    expect(fs.existsSync(contractPath)).toBe(true)
    expect(fs.existsSync(routerPath)).toBe(true)
    expect(fs.existsSync(clientPath)).toBe(true)
    expect(fs.existsSync(keysPath)).toBe(true)
    expect(fs.existsSync(queriesPath)).toBe(true)

    const routerContent = fs.readFileSync(routerPath, 'utf8')
    expect(routerContent).toContain("from './fastify-api.contract.js'")
    expect(routerContent).toContain('FastifyPluginAsync')

    const queriesContent = fs.readFileSync(queriesPath, 'utf8')
    expect(queriesContent).toContain("from './fastify-api.client.js'")
    expect(queriesContent).toContain("from './fastify-api.keys.js'")
  })
})


