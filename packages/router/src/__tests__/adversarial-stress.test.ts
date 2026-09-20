import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import type { OasDocument } from '@oa-sdk/parser'
import { generateRouter, generateHandlerContract } from '../generate-router.js'

const require = createRequire(import.meta.url)
const tscBin = require.resolve('typescript/bin/tsc')

function runTsc(cwd: string): { success: boolean; output: string } {
  try {
    const stdout = execFileSync(process.execPath, [tscBin, '--noEmit'], {
      cwd,
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { success: true, output: stdout.toString('utf8') }
  } catch (error) {
    const result = error as { stdout?: Buffer; stderr?: Buffer }
    const diagnostics = [result.stdout, result.stderr]
      .filter((output): output is Buffer => output instanceof Buffer && output.length > 0)
      .map(output => output.toString('utf8').trim())
      .filter(Boolean)
      .join('\n')
    return { success: false, output: diagnostics || 'tsc --noEmit failed without diagnostics' }
  }
}

const tmpBase = resolve(__dirname, '../../.tmp-adversarial-stress')

function cleanDir(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
}

beforeAll(() => {
  mkdirSync(tmpBase, { recursive: true })
})

afterAll(() => {
  if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true, force: true })
})

function createDoc(overrides: Partial<OasDocument> = {}): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Adversarial Stress Test API', version: '1.0.0' },
    paths: {},
    ...overrides,
  } as OasDocument
}

const ambientFastifyDts = `
declare module 'fastify' {
  export interface FastifyRequest {
    params: unknown
    query: unknown
    headers: unknown
    body: unknown
    raw: { url?: string }
    url: string
  }
  export interface FastifyReply {
    status(code: number): this
    send(payload?: unknown): this
    header(name: string, value: string): this
  }
  export type RouteHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<any> | any
  export type FastifyPluginAsync<Options = Record<never, never>> = (
    fastify: FastifyInstance,
    options: Options,
  ) => Promise<void>
  export interface FastifyInstance {
    get(url: string, handler: RouteHandler): void
    get(url: string, opts: { schema?: any }, handler: RouteHandler): void
    post(url: string, handler: RouteHandler): void
    post(url: string, opts: { schema?: any }, handler: RouteHandler): void
    put(url: string, handler: RouteHandler): void
    put(url: string, opts: { schema?: any }, handler: RouteHandler): void
    delete(url: string, handler: RouteHandler): void
    delete(url: string, opts: { schema?: any }, handler: RouteHandler): void
    patch(url: string, handler: RouteHandler): void
    patch(url: string, opts: { schema?: any }, handler: RouteHandler): void
    head(url: string, handler: RouteHandler): void
    head(url: string, opts: { schema?: any }, handler: RouteHandler): void
    options(url: string, handler: RouteHandler): void
    options(url: string, opts: { schema?: any }, handler: RouteHandler): void
    route(opts: { method: string; url: string; schema?: any; handler: RouteHandler }): void
  }
}
`

const ambientElysiaDts = `
declare module 'elysia' {
  export interface Context {
    params?: unknown
    query?: unknown
    headers?: unknown
    body?: unknown
    request: { url: string }
    set: {
      status?: number
      headers: Record<string, string>
    }
  }
  export class Elysia {
    get(path: string, handler: (ctx: any) => Promise<any>): this
    post(path: string, handler: (ctx: any) => Promise<any>): this
    put(path: string, handler: (ctx: any) => Promise<any>): this
    delete(path: string, handler: (ctx: any) => Promise<any>): this
    patch(path: string, handler: (ctx: any) => Promise<any>): this
    head(path: string, handler: (ctx: any) => Promise<any>): this
    route(method: string, path: string, handler: (ctx: any) => Promise<any>): this
  }
}
`

describe('Adversarial Stress Testing: Fastify & Elysia Targets', { timeout: 40_000 }, () => {

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 1: Extreme Verbs (OAS 3.2 QUERY, TRACE, HEAD, OPTIONS, PATCH, etc.)
  // ────────────────────────────────────────────────────────────────────────────
  describe('Scenario 1: Extreme Verbs & Custom OAS 3.2 Methods', () => {
    const extremeVerbsSpec = createDoc({
      paths: {
        '/resource/query': {
          query: {
            operationId: 'queryResource',
            requestBody: {
              content: { 'application/json': { schema: { type: 'object', properties: { search: { type: 'string' } } } } },
            },
            responses: { '200': { description: 'OK' } },
          },
        },
        '/resource/trace': {
          trace: {
            operationId: 'traceResource',
            responses: { '200': { description: 'Trace OK' } },
          },
        },
        '/resource/head': {
          head: {
            operationId: 'headResource',
            responses: { '200': { description: 'Head OK' } },
          },
        },
        '/resource/options': {
          options: {
            operationId: 'optionsResource',
            responses: { '200': { description: 'Options OK' } },
          },
        },
        '/resource/patch': {
          patch: {
            operationId: 'patchResource',
            requestBody: {
              content: { 'application/json': { schema: { type: 'object', properties: { delta: { type: 'number' } } } } },
            },
            responses: { '200': { description: 'Patch OK' } },
          },
        },
        '/resource/custom': {
          additionalOperations: {
            search: {
              operationId: 'customSearchResource',
              responses: { '200': { description: 'Search OK' } },
            },
          },
        },
      },
    })

    it('Fastify correctly routes standard vs non-convenience verbs', () => {
      const code = generateRouter(extremeVerbsSpec, { target: 'fastify', contractImport: './api.contract' })

      // Convenience verbs in Fastify: head, options, patch
      expect(code).toContain("fastify.head('/resource/head'")
      expect(code).toContain("fastify.options('/resource/options'")
      expect(code).toContain("fastify.patch('/resource/patch'")

      // Non-convenience verbs: QUERY, TRACE, SEARCH via fastify.route
      expect(code).toContain("method: 'QUERY'")
      expect(code).toContain("url: '/resource/query'")
      expect(code).toContain("method: 'TRACE'")
      expect(code).toContain("url: '/resource/trace'")
      expect(code).toContain("method: 'SEARCH'")
      expect(code).toContain("url: '/resource/custom'")
    })

    it('Elysia correctly routes standard vs non-convenience verbs', () => {
      const code = generateRouter(extremeVerbsSpec, { target: 'elysia', contractImport: './api.contract' })

      // Convenience verbs in Elysia: head, patch
      expect(code).toContain(".head('/resource/head'")
      expect(code).toContain(".patch('/resource/patch'")

      // Non-convenience in Elysia: options, QUERY, TRACE, SEARCH via .route()
      expect(code).toContain(".route('OPTIONS', '/resource/options'")
      expect(code).toContain(".route('QUERY', '/resource/query'")
      expect(code).toContain(".route('TRACE', '/resource/trace'")
      expect(code).toContain(".route('SEARCH', '/resource/custom'")
    })

    it('Compiles cleanly under tsc --strict with dummy handlers for all extreme verbs', () => {
      const dir = join(tmpBase, 'extreme-verbs')
      cleanDir(dir)

      writeFileSync(join(dir, 'fastify.d.ts'), ambientFastifyDts, 'utf8')
      writeFileSync(join(dir, 'elysia.d.ts'), ambientElysiaDts, 'utf8')
      writeFileSync(join(dir, 'api.contract.ts'), generateHandlerContract(extremeVerbsSpec), 'utf8')

      const fastifyRouter = generateRouter(extremeVerbsSpec, { target: 'fastify', contractImport: './api.contract' })
      writeFileSync(join(dir, 'fastify-router.ts'), fastifyRouter, 'utf8')

      const elysiaRouter = generateRouter(extremeVerbsSpec, { target: 'elysia', contractImport: './api.contract' })
      writeFileSync(join(dir, 'elysia-router.ts'), elysiaRouter, 'utf8')

      // 1. Elysia alone under strict + noUnusedLocals + noUnusedParameters:
      writeFileSync(join(dir, 'index-elysia.ts'), `
        import type { ApiHandlers } from './api.contract'
        import createElysiaRouter from './elysia-router'

        const handlers: ApiHandlers = {
          queryResource: async (ctx) => ({ search: ctx?.body }),
          traceResource: async () => ({ ok: true }),
          headResource: async () => ({}),
          optionsResource: async () => ({ allow: ['GET', 'POST'] }),
          patchResource: async (ctx) => ({ delta: ctx?.body }),
          customSearchResource: async () => ({ found: [] }),
        }

        const app = createElysiaRouter(handlers)
        void app
      `, 'utf8')

      writeFileSync(join(dir, 'tsconfig.elysia.json'), JSON.stringify({
        compilerOptions: {
          strict: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noEmit: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          target: 'ES2022',
          skipLibCheck: true,
        },
        include: ['elysia.d.ts', 'api.contract.ts', 'elysia-router.ts', 'index-elysia.ts'],
      }), 'utf8')

      let elysiaResult: { success: boolean; output: string }
      try {
        const out = execFileSync(process.execPath, [tscBin, '--project', 'tsconfig.elysia.json'], {
          cwd: dir,
          timeout: 30_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        elysiaResult = { success: true, output: out.toString('utf8') }
      } catch (err: any) {
        elysiaResult = { success: false, output: (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '') }
      }

      // Elysia passes strict + noUnusedLocals + noUnusedParameters cleanly!
      expect(elysiaResult.success, `Elysia tsc failed: ${elysiaResult.output}`).toBe(true)

      // 2. Fastify alone under strict + noUnusedParameters:
      writeFileSync(join(dir, 'index-fastify.ts'), `
        import type { ApiHandlers } from './api.contract'
        import { apiRouter as fastifyRouter } from './fastify-router'

        const handlers: ApiHandlers = {
          queryResource: async (ctx) => ({ search: ctx?.body }),
          traceResource: async () => ({ ok: true }),
          headResource: async () => ({}),
          optionsResource: async () => ({ allow: ['GET', 'POST'] }),
          patchResource: async (ctx) => ({ delta: ctx?.body }),
          customSearchResource: async () => ({ found: [] }),
        }

        void fastifyRouter
        void handlers
      `, 'utf8')

      writeFileSync(join(dir, 'tsconfig.fastify-strict.json'), JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          target: 'ES2022',
          skipLibCheck: true,
        },
        include: ['fastify.d.ts', 'api.contract.ts', 'fastify-router.ts', 'index-fastify.ts'],
      }), 'utf8')

      // Fastify under standard strict passes:
      let fastifyStrictResult: { success: boolean; output: string }
      try {
        const out = execFileSync(process.execPath, [tscBin, '--project', 'tsconfig.fastify-strict.json'], {
          cwd: dir,
          timeout: 30_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        fastifyStrictResult = { success: true, output: out.toString('utf8') }
      } catch (err: any) {
        fastifyStrictResult = { success: false, output: (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '') }
      }
      expect(fastifyStrictResult.success, `Fastify standard strict failed: ${fastifyStrictResult.output}`).toBe(true)

      // Fastify under noUnusedParameters: triggers TS6133 because 'request' is never read on routes without params/body:
      writeFileSync(join(dir, 'tsconfig.fastify-unused.json'), JSON.stringify({
        compilerOptions: {
          strict: true,
          noUnusedParameters: true,
          noEmit: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          target: 'ES2022',
          skipLibCheck: true,
        },
        include: ['fastify.d.ts', 'api.contract.ts', 'fastify-router.ts', 'index-fastify.ts'],
      }), 'utf8')

      let fastifyUnusedResult: { success: boolean; output: string }
      try {
        const out = execFileSync(process.execPath, [tscBin, '--project', 'tsconfig.fastify-unused.json'], {
          cwd: dir,
          timeout: 30_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        fastifyUnusedResult = { success: true, output: out.toString('utf8') }
      } catch (err: any) {
        fastifyUnusedResult = { success: false, output: (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '') }
      }

      // EMPIRICAL OBSERVATION:
      // Fastify declares (_request, reply) when request is not read, passing TS6133 cleanly:
      expect(fastifyUnusedResult.success, `Fastify unused check failed: ${fastifyUnusedResult.output}`).toBe(true)
      expect(fastifyUnusedResult.output).toBe('')
    }, 30_000)
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 2: Complex Schemas (deep query, multi path, raw querystring, headers, status codes, webhooks)
  // ────────────────────────────────────────────────────────────────────────────
  describe('Scenario 2: Complex Schemas Stress Test', () => {
    const complexSpec = createDoc({
      paths: {
        '/orgs/{orgId}/projects/{projectId}/issues/{issueId}': {
          parameters: [
            { name: 'orgId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'projectId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'issueId', in: 'path', required: true, schema: { type: 'integer' } },
          ],
          get: {
            operationId: 'getIssue',
            parameters: [
              { name: 'includeDetails', in: 'query', schema: { type: 'boolean' } },
              {
                name: 'filters',
                in: 'query',
                schema: {
                  type: 'object',
                  properties: {
                    labels: { type: 'array', items: { type: 'string' } },
                    priority: { type: 'string', enum: ['low', 'medium', 'high'] },
                  },
                },
              },
              { name: 'X-Tenant-Id', in: 'header', required: true, schema: { type: 'string' } },
              { name: 'X-Client-Trace', in: 'header', required: false, schema: { type: 'string' } },
            ],
            responses: {
              '200': {
                description: 'Issue Found',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['id', 'title'],
                      properties: {
                        id: { type: 'integer' },
                        title: { type: 'string' },
                        tags: { type: 'array', items: { type: 'string' } },
                      },
                    },
                  },
                },
              },
              '404': {
                description: 'Not Found',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { error: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
          delete: {
            operationId: 'deleteIssue',
            responses: {
              '204': { description: 'Deleted cleanly, no body' },
            },
          },
        },
        '/search/raw': {
          get: {
            operationId: 'searchRaw',
            parameters: [
              {
                name: 'rawPayload',
                in: 'querystring',
                content: {
                  'text/plain': { schema: { type: 'string' } },
                },
              },
            ],
            responses: {
              '200': { description: 'Search results' },
            },
          },
        },
        '/complex/responses': {
          post: {
            operationId: 'multiStatusOp',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['action'],
                    properties: { action: { type: 'string' } },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Sync Complete',
                content: { 'application/json': { schema: { type: 'object', properties: { done: { type: 'boolean' } } } } },
              },
              '201': {
                description: 'Async Created',
                content: { 'application/json': { schema: { type: 'object', properties: { taskId: { type: 'string' } } } } },
              },
              '204': { description: 'Accepted Nothing' },
              '400': {
                description: 'Bad Request',
                content: { 'application/json': { schema: { type: 'object', properties: { code: { type: 'string' } } } } },
              },
              '500': {
                description: 'Server Error',
                content: { 'application/json': { schema: { type: 'object', properties: { fatal: { type: 'boolean' } } } } },
              },
            },
          },
        },
      },
      webhooks: {
        issueCreatedWebhook: {
          post: {
            operationId: 'onIssueCreated',
            parameters: [
              { name: 'X-Webhook-Signature', in: 'header', required: true, schema: { type: 'string' } },
            ],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['event', 'issueId'],
                    properties: {
                      event: { type: 'string' },
                      issueId: { type: 'integer' },
                    },
                  },
                },
              },
            },
            responses: {
              '200': { description: 'Webhook Received' },
            },
          },
        },
      },
    })

    it('generates inlined Fastify schemas for multi-path and deep-query operations', () => {
      const code = generateRouter(complexSpec, { target: 'fastify' })

      // Path translation
      expect(code).toContain("fastify.get('/orgs/:orgId/projects/:projectId/issues/:issueId'")
      // Inlined params schema
      expect(code).toContain('"params": {')
      expect(code).toContain('"orgId": {')
      expect(code).toContain('"projectId": {')
      expect(code).toContain('"issueId": {')
      // Inlined querystring schema
      expect(code).toContain('"querystring": {')
      expect(code).toContain('"includeDetails": {')
      expect(code).toContain('"filters": {')
      // Raw querystring extraction helper
      expect(code).toContain('__readOaRawQuerystring')
      // Webhook support in Fastify
      expect(code).toContain('// ─── Webhooks ─────────────────────────────────────────────────')
      expect(code).toContain("fastify.post('/webhooks/issueCreatedWebhook'")
    })

    it('generates zero-copy Elysia context destructuring without unused variable warnings', () => {
      const code = generateRouter(complexSpec, { target: 'elysia', contractImport: './api.contract' })

      // Multi-param + query + headers route destructures all required fields:
      expect(code).toContain(".get('/orgs/:orgId/projects/:projectId/issues/:issueId', async ({ params, query, headers, set }) => {")
      // 204 delete route only has path params:
      expect(code).toContain(".delete('/orgs/:orgId/projects/:projectId/issues/:issueId', async ({ params, set }) => {")
      // Raw querystring route destructures request:
      expect(code).toContain(".get('/search/raw', async ({ request, set }) => {")
      // Webhook destructures headers and body:
      expect(code).toContain(".post('/webhooks/issueCreatedWebhook', async ({ headers, body, set }) => {")
    })

    it('Compiles cleanly under tsc --strict with dummy handlers for complex schemas (exposes Fastify webhook bug)', () => {
      const dir = join(tmpBase, 'complex-schemas')
      cleanDir(dir)

      writeFileSync(join(dir, 'fastify.d.ts'), ambientFastifyDts, 'utf8')
      writeFileSync(join(dir, 'elysia.d.ts'), ambientElysiaDts, 'utf8')
      writeFileSync(join(dir, 'api.contract.ts'), generateHandlerContract(complexSpec), 'utf8')

      const fastifyRouter = generateRouter(complexSpec, { target: 'fastify', contractImport: './api.contract' })
      writeFileSync(join(dir, 'fastify-router.ts'), fastifyRouter, 'utf8')

      const elysiaRouter = generateRouter(complexSpec, { target: 'elysia', contractImport: './api.contract' })
      writeFileSync(join(dir, 'elysia-router.ts'), elysiaRouter, 'utf8')

      writeFileSync(join(dir, 'index.ts'), `
        import type { ApiHandlers } from './api.contract'
        import { apiRouter as fastifyRouter } from './fastify-router'
        import createElysiaRouter from './elysia-router'

        const handlers: ApiHandlers = {
          getIssue: async (ctx) => {
            return {
              id: Number(ctx.params.issueId),
              title: 'Bug Report',
              tags: ['urgent'],
            }
          },
          deleteIssue: async (_ctx) => {
            // 204 returns void
          },
          searchRaw: async (ctx) => {
            return { query: ctx?.querystring ?? '' }
          },
          multiStatusOp: async (ctx) => {
            if ((ctx.body as any)?.action === 'created') {
              return { status: 201, headers: { 'X-Task': '123' }, body: { taskId: 'task-1' } }
            }
            return { done: true }
          },
          onIssueCreated: async (ctx) => {
            return { processed: (ctx?.body as any)?.issueId }
          },
        }

        const app = createElysiaRouter(handlers)
        void app
        void fastifyRouter
      `, 'utf8')

      writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          strict: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noEmit: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          target: 'ES2022',
          skipLibCheck: true,
        },
        include: ['*.ts'],
      }), 'utf8')

      const result = runTsc(dir)
      // Fastify router emits only declared webhook context properties, compiling cleanly without TS2353:
      expect(result.success, `Fastify webhook compilation failed: ${result.output}`).toBe(true)
      expect(result.output).toBe('')
    }, 30_000)
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 3: Edge Cases (Empty paths, operations without operationId, etc.)
  // ────────────────────────────────────────────────────────────────────────────
  describe('Scenario 3: Boundary & Edge Cases', () => {
    it('Empty paths object: Fastify and Elysia generate code but trigger TS6133 under strict unused checks', () => {
      const emptySpec = createDoc({ paths: {} })

      const fastifyCode = generateRouter(emptySpec, { target: 'fastify', contractImport: './api.contract' })
      const elysiaCode = generateRouter(emptySpec, { target: 'elysia', contractImport: './api.contract' })
      const contractCode = generateHandlerContract(emptySpec)

      expect(fastifyCode).toContain('export const apiRouter: FastifyPluginAsync<ApiRouterOptions>')
      expect(elysiaCode).toContain('export function createRouter(handlers: ApiHandlers)')
      expect(contractCode).toContain('export interface ApiHandlers {')

      const dir = join(tmpBase, 'empty-paths')
      cleanDir(dir)

      writeFileSync(join(dir, 'fastify.d.ts'), ambientFastifyDts, 'utf8')
      writeFileSync(join(dir, 'elysia.d.ts'), ambientElysiaDts, 'utf8')
      writeFileSync(join(dir, 'api.contract.ts'), contractCode, 'utf8')
      writeFileSync(join(dir, 'fastify-router.ts'), fastifyCode, 'utf8')
      writeFileSync(join(dir, 'elysia-router.ts'), elysiaCode, 'utf8')
      writeFileSync(join(dir, 'index.ts'), `
        import type { ApiHandlers } from './api.contract'
        import { apiRouter as fastifyRouter } from './fastify-router'
        import createElysiaRouter from './elysia-router'

        const handlers: ApiHandlers = {}
        const app = createElysiaRouter(handlers)
        void app
        void fastifyRouter
      `, 'utf8')

      writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          strict: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noEmit: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          target: 'ES2022',
          skipLibCheck: true,
        },
        include: ['*.ts'],
      }), 'utf8')

      const result = runTsc(dir)
      // With no paths, unused parameters are suppressed via void expressions:
      expect(result.success, `Empty paths compilation failed: ${result.output}`).toBe(true)
      expect(result.output).toBe('')
    }, 30_000)

    it('Operations without operationId: synthesized with method + path fallback', () => {
      const specWithoutOpId = createDoc({
        paths: {
          '/health': {
            get: { responses: { '200': { description: 'OK' } } },
          },
          '/ping': {
            post: { responses: { '204': { description: 'No content' } } },
          },
          '/users': {
            get: { operationId: 'getUsers', responses: { '200': { description: 'OK' } } },
          },
        },
      })

      const fastifyCode = generateRouter(specWithoutOpId, { target: 'fastify', contractImport: './api.contract' })
      const elysiaCode = generateRouter(specWithoutOpId, { target: 'elysia', contractImport: './api.contract' })
      const contractCode = generateHandlerContract(specWithoutOpId)

      // Anonymous endpoints /health and /ping are synthesized
      expect(fastifyCode).toContain('/health')
      expect(fastifyCode).toContain('/ping')
      expect(fastifyCode).toContain('/users')

      expect(elysiaCode).toContain('/health')
      expect(elysiaCode).toContain('/ping')
      expect(elysiaCode).toContain('/users')

      expect(contractCode).toContain('getHealth: GetHealthHandler')
      expect(contractCode).toContain('postPing: PostPingHandler')
      expect(contractCode).toContain('getUsers: GetUsersHandler')
    })

    it('Special character and keyword operationIds: verifies Fastify unused parameter error on parameter-less routes', () => {
      const weirdOpIdSpec = createDoc({
        paths: {
          '/a': { get: { operationId: 'delete', responses: { '200': { description: 'OK' } } } },
          '/b': { post: { operationId: 'default', responses: { '200': { description: 'OK' } } } },
          '/c': { put: { operationId: 'user-profile-update', responses: { '200': { description: 'OK' } } } },
          '/d': { delete: { operationId: '123_start_numeric', responses: { '200': { description: 'OK' } } } },
        },
      })

      const contract = generateHandlerContract(weirdOpIdSpec)
      const fastify = generateRouter(weirdOpIdSpec, { target: 'fastify', contractImport: './api.contract' })
      const elysia = generateRouter(weirdOpIdSpec, { target: 'elysia', contractImport: './api.contract' })

      const dir = join(tmpBase, 'weird-op-ids')
      cleanDir(dir)

      writeFileSync(join(dir, 'fastify.d.ts'), ambientFastifyDts, 'utf8')
      writeFileSync(join(dir, 'elysia.d.ts'), ambientElysiaDts, 'utf8')
      writeFileSync(join(dir, 'api.contract.ts'), contract, 'utf8')
      writeFileSync(join(dir, 'fastify-router.ts'), fastify, 'utf8')
      writeFileSync(join(dir, 'elysia-router.ts'), elysia, 'utf8')
      writeFileSync(join(dir, 'index.ts'), `
        import type { ApiHandlers } from './api.contract'
        import { apiRouter as fastifyRouter } from './fastify-router'
        import createElysiaRouter from './elysia-router'

        const handlers: ApiHandlers = {
          delete: async () => ({ ok: true }),
          default: async () => ({ ok: true }),
          userProfileUpdate: async () => ({ ok: true }),
          operation123StartNumeric: async () => ({ ok: true }),
        }

        const app = createElysiaRouter(handlers)
        void app
        void fastifyRouter
      `, 'utf8')

      writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          strict: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noEmit: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          target: 'ES2022',
          skipLibCheck: true,
        },
        include: ['*.ts'],
      }), 'utf8')

      const result = runTsc(dir)
      // Fastify router declares (_request, reply) on routes with no params/body,
      // compiling cleanly under noUnusedParameters:
      expect(result.success, `Weird op IDs compilation failed: ${result.output}`).toBe(true)
      expect(result.output).toBe('')
    }, 30_000)

    it('Duplicate operationId across different paths disambiguates with numeric suffix in contract', () => {
      const dupOpIdSpec = createDoc({
        paths: {
          '/items/first': { get: { operationId: 'getItem', responses: { '200': { description: 'OK' } } } },
          '/items/second': { get: { operationId: 'getItem', responses: { '200': { description: 'OK' } } } },
        },
      })

      const contract = generateHandlerContract(dupOpIdSpec)

      const dir = join(tmpBase, 'dup-op-id')
      cleanDir(dir)
      writeFileSync(join(dir, 'api.contract.ts'), contract, 'utf8')
      writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          target: 'ES2022',
          skipLibCheck: true,
        },
        include: ['*.ts'],
      }), 'utf8')

      const result = runTsc(dir)
      // Disambiguation suffixes getItem2 so no TS2300 duplicate identifier occurs
      expect(result.success, `Duplicate op ID compilation failed: ${result.output}`).toBe(true)
      expect(result.output).toBe('')
      expect(contract).toContain('getItem: GetItemHandler')
      expect(contract).toContain('getItem2: GetItem2Handler')
    }, 30_000)
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 4: Investigating Stub Mode under Strict Compiler Flags
  // ────────────────────────────────────────────────────────────────────────────
  describe('Scenario 4: Stub Mode under Strict Compiler Flags (noUnusedLocals/Parameters)', () => {
    it('Investigates whether stub mode in Elysia and Fastify triggers unused parameter warnings', () => {
      const stubSpec = createDoc({
        paths: {
          '/items/{id}': {
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            get: {
              operationId: 'getItem',
              parameters: [{ name: 'fields', in: 'query', schema: { type: 'string' } }],
              responses: { '200': { description: 'OK' } },
            },
            post: {
              operationId: 'updateItem',
              requestBody: {
                required: true,
                content: { 'application/json': { schema: { type: 'object' } } },
              },
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      })

      // Generate stub mode (no contractImport)
      const elysiaStub = generateRouter(stubSpec, { target: 'elysia' })
      const fastifyStub = generateRouter(stubSpec, { target: 'fastify' })

      const dir = join(tmpBase, 'stub-mode-strict')
      cleanDir(dir)

      writeFileSync(join(dir, 'fastify.d.ts'), ambientFastifyDts, 'utf8')
      writeFileSync(join(dir, 'elysia.d.ts'), ambientElysiaDts, 'utf8')
      writeFileSync(join(dir, 'elysia-stub.ts'), elysiaStub, 'utf8')
      writeFileSync(join(dir, 'fastify-stub.ts'), fastifyStub, 'utf8')

      // Check with standard strict mode:
      writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          target: 'ES2022',
          skipLibCheck: true,
        },
        include: ['*.ts'],
      }), 'utf8')

      const standardStrictResult = runTsc(dir)
      expect(standardStrictResult.success, `standard strict failed: ${standardStrictResult.output}`).toBe(true)

      // Now check with noUnusedParameters and noUnusedLocals:
      writeFileSync(join(dir, 'tsconfig.unused.json'), JSON.stringify({
        compilerOptions: {
          strict: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noEmit: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          target: 'ES2022',
          skipLibCheck: true,
        },
        include: ['*.ts'],
      }), 'utf8')

      // Run tsc with the unused config
      let unusedResult: { success: boolean; output: string }
      try {
        const stdout = execFileSync(process.execPath, [tscBin, '--project', 'tsconfig.unused.json'], {
          cwd: dir,
          timeout: 30_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        unusedResult = { success: true, output: stdout.toString('utf8') }
      } catch (err: any) {
        unusedResult = { success: false, output: (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '') }
      }

      // EMPIRICAL FINDING:
      // In stub mode, Elysia destructures params and query ({ params, query, set }),
      // but the TODO body never reads params or query!
      // In Fastify, (request, reply) is declared, but request is never read!
      expect(unusedResult.output).toContain("error TS6133: 'params' is declared but its value is never read")
      expect(unusedResult.output).toContain("error TS6133: 'request' is declared but its value is never read")
    }, 30_000)
  })
})

