import { describe, expect, it } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import { createPluginContext } from '../../plugin/context.js'
import { pluginRouter } from '../../plugin/plugins/router.js'

function createSampleOasDoc(): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Test Router API', version: '1.0.0' },
    paths: {
      '/users': {
        get: {
          operationId: 'listUsers',
          tags: ['users'],
          summary: 'List users',
          parameters: [
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer' },
            },
          ],
          responses: {
            '200': {
              description: 'Users list',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      $ref: '#/components/schemas/User',
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: 'createUser',
          tags: ['users'],
          summary: 'Create user',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/CreateUserInput',
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Created user',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/User',
                  },
                },
              },
            },
          },
        },
      },
      '/users/{id}': {
        get: {
          operationId: 'getUserById',
          tags: ['users'],
          summary: 'Get user by ID',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'User details',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/User',
                  },
                },
              },
            },
            '404': {
              description: 'User not found',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/ApiError',
                  },
                },
              },
            },
          },
        },
        delete: {
          operationId: 'deleteUser',
          tags: ['users'],
          summary: 'Delete user',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '204': {
              description: 'User deleted',
            },
          },
        },
      },
    },
    components: {
      schemas: {
        User: {
          type: 'object',
          required: ['id', 'name'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            role: { type: 'string' },
          },
        },
        CreateUserInput: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            role: { type: 'string' },
          },
        },
        ApiError: {
          type: 'object',
          required: ['message'],
          properties: {
            message: { type: 'string' },
          },
        },
      },
    },
  }
}

describe('pluginRouter', () => {
  it('declares correct metadata and dependencies', () => {
    const plugin = pluginRouter()
    expect(plugin.name).toBe('router')
    expect(plugin.dependencies).toEqual(['typescript'])
    expect(typeof plugin.generate).toBe('function')
  })

  it('generates both api.contract.ts and router.ts in contract mode by default', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginRouter()
    await plugin.generate!(context)

    expect(context.hasFile('api.contract.ts')).toBe(true)
    expect(context.hasFile('router.ts')).toBe(true)

    const contractFile = context.getFile('api.contract.ts')
    const routerFile = context.getFile('router.ts')

    expect(contractFile?.kind).toBe('contract')
    expect(routerFile?.kind).toBe('router')

    // Contract verification: HandlerResponse multi-status union
    expect(contractFile?.content).toContain('export type HandlerResponse')
    expect(contractFile?.content).toContain('export interface ApiHandlers')
    expect(contractFile?.content).toContain('listUsers: ListUsersHandler')
    expect(contractFile?.content).toContain('createUser: CreateUserHandler')
    expect(contractFile?.content).toContain('getUserById: GetUserByIdHandler')
    expect(contractFile?.content).toContain('deleteUser: DeleteUserHandler')

    // Router verification: relative contract import and 3-part collision defense
    expect(routerFile?.content).toContain('./api.contract.js')
    expect(routerFile?.content).toContain("'body' in result")
    expect(routerFile?.content).toContain("typeof (result as any).status === 'number'")
  })

  it('generates Hono target router with proper routing constructs', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginRouter({ target: 'hono' })
    await plugin.generate!(context)

    const routerFile = context.getFile('router.ts')
    expect(routerFile?.content).toContain('Hono')
    expect(routerFile?.content).toContain("app.get('/users'")
    expect(routerFile?.content).toContain("app.post('/users'")
    expect(routerFile?.content).toContain("app.get('/users/:id'")
    expect(routerFile?.content).toContain("app.delete('/users/:id'")
  })

  it('generates Express target router with proper routing constructs', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginRouter({ target: 'express' })
    await plugin.generate!(context)

    const routerFile = context.getFile('router.ts')
    expect(routerFile?.content).toContain('Router')
    expect(routerFile?.content).toContain("router.get('/users'")
    expect(routerFile?.content).toContain("router.post('/users'")
    expect(routerFile?.content).toContain("router.get('/users/:id'")
  })

  it('generates Fastify target router with JIT inline schemas', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginRouter({ target: 'fastify' })
    await plugin.generate!(context)

    const routerFile = context.getFile('router.ts')
    expect(routerFile?.content).toContain('FastifyPluginAsync')
    expect(routerFile?.content).toContain("fastify.get('/users'")
    expect(routerFile?.content).toContain('schema:')
  })

  it('generates Bun Elysia target router with selective destructuring', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginRouter({ target: 'elysia' })
    await plugin.generate!(context)

    const routerFile = context.getFile('router.ts')
    expect(routerFile?.content).toContain('Elysia')
    expect(routerFile?.content).toContain(".get('/users'")
    expect(routerFile?.content).toContain(".post('/users'")
  })

  it('supports stub mode without separate contract file', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginRouter({ mode: 'stub', target: 'hono' })
    await plugin.generate!(context)

    expect(context.hasFile('router.ts')).toBe(true)
    expect(context.hasFile('api.contract.ts')).toBe(false)

    const routerFile = context.getFile('router.ts')
    expect(routerFile?.content).toContain('TODO: implement listUsers')
  })

  it('supports custom contract name and context injection', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginRouter({
      contractName: 'UserHandlers',
      contextInjection: true,
      contextTypeName: 'MyAppContext',
      contextImport: './app-context.js',
    })
    await plugin.generate!(context)

    const contractFile = context.getFile('api.contract.ts')
    const routerFile = context.getFile('router.ts')

    expect(contractFile?.content).toContain('export interface UserHandlers')
    expect(contractFile?.content).toContain('MyAppContext')
    expect(contractFile?.content).toContain('./app-context.js')
    expect(routerFile?.content).toContain('UserHandlers')
    expect(routerFile?.content).toContain('MyAppContext')
  })

  it('resolves relative imports across directories', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    context.addFile({
      path: 'shared/types.ts',
      content: 'export interface User {}',
      sourcePlugin: 'typescript',
    })

    const plugin = pluginRouter({
      output: 'src/server/router.ts',
      contractOutput: 'src/contracts/api.contract.ts',
    })
    await plugin.generate!(context)

    const contractFile = context.getFile('src/contracts/api.contract.ts')
    const routerFile = context.getFile('src/server/router.ts')

    expect(contractFile).toBeDefined()
    expect(routerFile).toBeDefined()

    // Import from src/contracts/api.contract.ts to shared/types.ts -> ../../shared/types.js
    expect(contractFile?.content).toContain('../../shared/types.js')
    // Import from src/server/router.ts to src/contracts/api.contract.ts -> ../contracts/api.contract.js
    expect(routerFile?.content).toContain('../contracts/api.contract.js')
  })

  it('handles empty OpenAPI paths gracefully', async () => {
    const emptyDoc: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Empty API', version: '1.0.0' },
      paths: {},
    }
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: emptyDoc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginRouter()
    await expect(plugin.generate!(context)).resolves.not.toThrow()
    expect(context.hasFile('api.contract.ts')).toBe(true)
    expect(context.hasFile('router.ts')).toBe(true)
  })
})
