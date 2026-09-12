import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import type { OasDocument } from '@oa-sdk/parser'
import { generateRouter, generateHandlerContract } from '../generate-router.js'

const require = createRequire(import.meta.url)
const tscBin = require.resolve('typescript/bin/tsc')

function runTsc(cwd: string, extraArgs: string[] = []): { success: boolean; output: string } {
  try {
    const stdout = execFileSync(process.execPath, [tscBin, ...extraArgs], {
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
    return { success: false, output: diagnostics || 'tsc failed without diagnostics' }
  }
}

const tmpDir = resolve(__dirname, '../../.tmp-tier5-context-stress')

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
})

function doc(overrides: Partial<OasDocument> = {}): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Tier 5 Context Stress API', version: '1.0.0' },
    paths: {},
    ...overrides,
  } as OasDocument
}

// Complex OAS 3.2 document with standard operations, non-standard verbs, webhooks, and extreme parameters
const stressSpec = doc({
  paths: {
    '/items/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: {
        operationId: 'getItem',
        summary: 'Retrieve item by ID',
        parameters: [
          { name: 'fields', in: 'query', schema: { type: 'string' } },
          { name: 'x-tenant', in: 'header', schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Item details',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
      delete: {
        operationId: 'deleteItem',
        summary: 'Delete item',
        responses: {
          '204': { description: 'Item deleted' },
        },
      },
    },
    '/items': {
      post: {
        operationId: 'createItem',
        summary: 'Create new item',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: {
          '201': {
            description: 'Created item',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
      // OAS 3.2 QUERY method
      query: {
        operationId: 'queryItems',
        summary: 'Search items using QUERY method',
        requestBody: {
          required: false,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: {
          '200': {
            description: 'Search results',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
    '/health/ping': {
      get: {
        operationId: 'ping',
        summary: 'Parameter-less health check',
        responses: {
          '200': {
            description: 'Ping response',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
  },
  webhooks: {
    itemNotification: {
      post: {
        operationId: 'onItemNotification',
        summary: 'Incoming notification webhook',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: {
          '200': { description: 'Notification acknowledged' },
        },
      },
    },
  },
})

// Adversarial document testing wire parameter pollution where wire parameters are explicitly named 'context'
const wireCollisionSpec = doc({
  paths: {
    '/tenants/{context}': {
      parameters: [{ name: 'context', in: 'path', required: true, schema: { type: 'string' } }],
      post: {
        operationId: 'collideContext',
        summary: 'Operation where all wire parameters are named context',
        parameters: [
          { name: 'context', in: 'query', schema: { type: 'string' } },
          { name: 'context', in: 'header', schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { context: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Collision test response',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
  },
})

describe('Tier 5 Adversarial Stress Testing: Generic Context Injection & Framework Binders', () => {
  describe('1. Handler Contract Purity & Generics (handler-contract.ts)', () => {
    it('generates context interfaces with generic TContext = unknown by default', () => {
      const code = generateHandlerContract(stressSpec)

      // Operation context interfaces
      expect(code).toContain('export interface GetItemContext<TContext = unknown> {')
      expect(code).toContain('  params: Record<string, string>')
      expect(code).toContain('  query?: Record<string, unknown>')
      expect(code).toContain('  headers?: Record<string, string>')
      expect(code).toContain('  context?: TContext')

      // Parameter-less operation context interface
      expect(code).toContain('export interface PingContext<TContext = unknown> {')
      expect(code).toContain('  context?: TContext')

      // Handler signatures
      expect(code).toContain('export type GetItemHandler<TContext = unknown> = (')
      expect(code).toContain('export type PingHandler<TContext = unknown> = (')
      expect(code).toContain('export type QueryItemsHandler<TContext = unknown> = (')

      // Webhook context & handler
      expect(code).toContain('export interface OnItemNotificationWebhookContext<TContext = unknown> {')
      expect(code).toContain('  body: unknown')
      expect(code).toContain('  context?: TContext')
      expect(code).toContain('export type OnItemNotificationWebhookHandler<TContext = unknown> = (')

      // Aggregate interface
      expect(code).toContain('export interface ApiHandlers<TContext = unknown> {')
      expect(code).toContain('  getItem: GetItemHandler<TContext>')
      expect(code).toContain('  deleteItem: DeleteItemHandler<TContext>')
      expect(code).toContain('  createItem: CreateItemHandler<TContext>')
      expect(code).toContain('  queryItems: QueryItemsHandler<TContext>')
      expect(code).toContain('  ping: PingHandler<TContext>')
      expect(code).toContain('  onItemNotification?: OnItemNotificationWebhookHandler<TContext>')
    })

    it('specializes TContext with contextImport and contextTypeName', () => {
      const code = generateHandlerContract(stressSpec, {
        contextImport: '@my-org/domain-context',
        contextTypeName: 'DomainContext',
      })

      expect(code).toContain("import type { DomainContext } from '@my-org/domain-context'")
      expect(code).toContain('export interface GetItemContext<TContext = DomainContext> {')
      expect(code).toContain('export type GetItemHandler<TContext = DomainContext> = (')
      expect(code).toContain('export interface ApiHandlers<TContext = DomainContext> {')
      expect(code).toContain('export interface OnItemNotificationWebhookContext<TContext = DomainContext> {')
      expect(code).toContain('export type OnItemNotificationWebhookHandler<TContext = DomainContext> = (')
    })

    it('defaults imported context type name to AppContext when contextTypeName is omitted', () => {
      const code = generateHandlerContract(stressSpec, {
        contextImport: './my-context',
      })

      expect(code).toContain("import type { AppContext } from './my-context'")
      expect(code).toContain('export interface GetItemContext<TContext = AppContext> {')
      expect(code).toContain('export type GetItemHandler<TContext = AppContext> = (')
      expect(code).toContain('export interface ApiHandlers<TContext = AppContext> {')
    })

    it('uses custom contextTypeName without emitting invalid import if contextImport is omitted', () => {
      const code = generateHandlerContract(stressSpec, {
        contextTypeName: 'InlineContext',
      })

      // Must not emit import from undefined
      expect(code).not.toMatch(/import type \{.*\} from 'undefined'/)
      expect(code).not.toMatch(/from ''/)
      expect(code).toContain('export interface GetItemContext<TContext = InlineContext> {')
      expect(code).toContain('export type GetItemHandler<TContext = InlineContext> = (')
      expect(code).toContain('export interface ApiHandlers<TContext = InlineContext> {')
    })

    it('enforces wire parameter purity when wire parameters are named context (anti-collision test)', () => {
      const code = generateHandlerContract(wireCollisionSpec)

      // The context interface must cleanly separate wire parameters from product context
      expect(code).toContain('export interface CollideContextContext<TContext = unknown> {')
      expect(code).toContain('  params: Record<string, string>')
      expect(code).toContain('  query?: Record<string, unknown>')
      expect(code).toContain('  headers?: Record<string, string>')
      expect(code).toContain('  body: unknown')
      expect(code).toContain('  context?: TContext')

      // Wire parameters must NOT leak into the top-level property name or clobber context?: TContext
      const lines = code.split('\n')
      const ctxInterfaceLines = lines.filter(l => l.includes('context?: TContext'))
      expect(ctxInterfaceLines).toHaveLength(1)
    })

    it('makes ctx argument required only when path params or required body exist', () => {
      const code = generateHandlerContract(stressSpec)

      // getItem has path param {id} -> required ctx
      expect(code).toContain('export type GetItemHandler<TContext = unknown> = (\n  ctx: GetItemContext<TContext>\n)')

      // createItem has required body -> required ctx
      expect(code).toContain('export type CreateItemHandler<TContext = unknown> = (\n  ctx: CreateItemContext<TContext>\n)')

      // queryItems has optional body and no path params -> optional ctx?
      expect(code).toContain('export type QueryItemsHandler<TContext = unknown> = (\n  ctx?: QueryItemsContext<TContext>\n)')

      // ping has no params and no body -> optional ctx?
      expect(code).toContain('export type PingHandler<TContext = unknown> = (\n  ctx?: PingContext<TContext>\n)')
    })

    it('supports banner: false to eliminate header banner comments cleanly', () => {
      const code = generateHandlerContract(stressSpec, { banner: false })
      expect(code).not.toContain('// Auto-generated')
      expect(code).not.toContain('// @oa-sdk/router')
      expect(code.startsWith('export type HandlerResponse')).toBe(true)
    })

    it('supports custom aggregate interface name via contractName option', () => {
      const code = generateHandlerContract(stressSpec, { contractName: 'EnterpriseCoreHandlers' })
      expect(code).toContain('export interface EnterpriseCoreHandlers<TContext = unknown> {')
      expect(code).not.toContain('export interface ApiHandlers<')
    })

    it('omits generic TContext from aggregate interface when spec has zero operations and zero webhooks', () => {
      const emptyDoc = doc({ paths: {} })
      const code = generateHandlerContract(emptyDoc)
      expect(code).toContain('export interface ApiHandlers {\n}')
      expect(code).not.toContain('export interface ApiHandlers<')
    })
  })

  describe('2. Zero Framework Runtime Dependencies Guard', () => {
    it('guarantees @oa-sdk/router package.json contains strictly zero runtime framework dependencies', () => {
      const pkgPath = resolve(__dirname, '../../package.json')
      const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf8'))

      const runtimeDeps = Object.keys(pkgJson.dependencies || {})
      const peerDeps = Object.keys(pkgJson.peerDependencies || {})

      const forbiddenFrameworks = ['fastify', 'elysia', 'hono', 'express', 'koa', 'connect']

      for (const framework of forbiddenFrameworks) {
        expect(runtimeDeps).not.toContain(framework)
        expect(peerDeps).not.toContain(framework)
      }

      // Dependencies must contain only core monorepo packages
      expect(runtimeDeps).toEqual(['@oa-sdk/core', '@oa-sdk/parser'])
    })
  })

  describe('3. Framework Route Binders (Fastify, Elysia, Hono, Express)', () => {
    it('activates context injection across all 4 binders via contextInjection: true', () => {
      const targets = ['fastify', 'elysia', 'hono', 'express'] as const
      for (const target of targets) {
        const code = generateRouter(stressSpec, {
          target,
          contractImport: './api.contract',
          contextInjection: true,
        } as any)

        expect(code).toContain('getContext')
        expect(code).toContain('context')
      }
    })

    it('activates context injection across all 4 binders via context: true shorthand', () => {
      const targets = ['fastify', 'elysia', 'hono', 'express'] as const
      for (const target of targets) {
        const code = generateRouter(stressSpec, {
          target,
          contractImport: './api.contract',
          context: true,
        } as any)

        expect(code).toContain('getContext')
        expect(code).toContain('context')
      }
    })

    it('Fastify binder: generates inlined JIT schema without polluting it with context', () => {
      const code = generateRouter(stressSpec, {
        target: 'fastify',
        contractImport: './api.contract',
        contextInjection: true,
      } as any)

      // Check Fastify options signature
      expect(code).toContain('export interface ApiRouterOptions<TContext = unknown> {')
      expect(code).toContain('  handlers: ApiHandlers<TContext>')
      expect(code).toContain('  getContext?: (req: FastifyRequest) => Promise<TContext> | TContext')
      expect(code).toContain('  context?: TContext')

      // Check JIT schema: params, querystring, body, response only
      expect(code).toContain('schema: {')
      expect(code).not.toContain('"context"')

      // Check route handler context extraction & forwarding
      expect(code).toContain('const context = getContext ? await getContext(request) : staticContext')
      expect(code).toContain('...(context !== undefined ? { context } : {})')

      // Check error isolation (try/catch around getContext and handler)
      expect(code).toContain("return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message, details: [] } })")
    })

    it('Bun Elysia binder: zero-copy destructuring extracts all parameters and forwards to getContext', () => {
      const code = generateRouter(stressSpec, {
        target: 'elysia',
        contractImport: './api.contract',
        contextInjection: true,
      } as any)

      expect(code).toContain('export interface ElysiaRouterOptions<TContext = unknown> {')
      expect(code).toContain('  getContext?: (ctx: any) => Promise<TContext> | TContext')
      expect(code).toContain('  context?: TContext')

      // Context destructuring for getContext
      expect(code).toContain('async ({ params, query, headers, body, request, set }) => {')
      expect(code).toContain('const context = getContext ? await getContext({ params, query, headers, body, request, set }) : staticContext')
      expect(code).toContain('...(context !== undefined ? { context } : {})')

      // Error isolation
      expect(code).toContain('set.status = 500')
      expect(code).toContain("return { error: { code: 'INTERNAL_ERROR', message, details: [] } }")
    })

    it('Hono binder: accepts generic context and catches getContext failures', () => {
      const code = generateRouter(stressSpec, {
        target: 'hono',
        contractImport: './api.contract',
        contextInjection: true,
      } as any)

      expect(code).toContain("import { Hono, type Context } from 'hono'")
      expect(code).toContain('export interface HonoRouterOptions<TContext = unknown> {')
      expect(code).toContain('  getContext?: (c: Context) => Promise<TContext> | TContext')
      expect(code).toContain('  context?: TContext')
      expect(code).toContain('const context = getContext ? await getContext(c) : staticContext')
      expect(code).toContain('...(context !== undefined ? { context } : {})')

      // Error isolation
      expect(code).toContain("return c.json({ error: { code: 'INTERNAL_ERROR', message, details: [] } }, 500)")
    })

    it('Express binder: accepts generic context and catches getContext failures', () => {
      const code = generateRouter(stressSpec, {
        target: 'express',
        contractImport: './api.contract',
        contextInjection: true,
      } as any)

      expect(code).toContain("import { Router } from 'express'")
      expect(code).toContain("import type { Request } from 'express'")
      expect(code).toContain('export interface ExpressRouterOptions<TContext = unknown> {')
      expect(code).toContain('  getContext?: (req: Request) => Promise<TContext> | TContext')
      expect(code).toContain('  context?: TContext')
      expect(code).toContain('const context = getContext ? await getContext(req) : staticContext')
      expect(code).toContain('...(context !== undefined ? { context } : {})')

      // Error isolation
      expect(code).toContain("return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message, details: [] } })")
    })

    it('Webhook context forwarding: all 4 binders forward resolved context to webhooks', () => {
      const targets = ['fastify', 'elysia', 'hono', 'express'] as const
      for (const target of targets) {
        const code = generateRouter(stressSpec, {
          target,
          contractImport: './api.contract',
          contextInjection: true,
        } as any)

        expect(code).toContain('// ─── Webhooks ───')
        expect(code).toContain('onItemNotification')
        expect(code).toContain('...(context !== undefined ? { context } : {})')
      }
    })

    it('Preserves backward compatibility when contract mode is used without context options', () => {
      const targets = ['fastify', 'elysia', 'hono', 'express'] as const
      for (const target of targets) {
        const code = generateRouter(stressSpec, {
          target,
          contractImport: './api.contract',
        } as any)

        // Must not emit getContext or context property in options
        expect(code).not.toContain('getContext?:')
        expect(code).not.toContain('staticContext')
        expect(code).not.toContain('context !== undefined')
      }
    })
  })

  describe('4. Strict TypeScript Compilation & Decoupled Verification', () => {
    it('compiles cleanly under tsc --strict with ambient framework declarations and real typed handlers', () => {
      const testDir = join(tmpDir, 'tsc-strict-compilation')
      mkdirSync(testDir, { recursive: true })

      // 1. Write custom domain context
      writeFileSync(
        join(testDir, 'context.ts'),
        [
          'export interface CustomEnterpriseContext {',
          '  tenantId: string',
          '  principal: { id: string; role: "admin" | "user" }',
          '  correlationId: string',
          '  dbPool: { query: (sql: string) => Promise<unknown[]> }',
          '}',
        ].join('\n'),
        'utf8',
      )

      // 2. Generate specialized contract
      const contractCode = generateHandlerContract(stressSpec, {
        contextImport: './context',
        contextTypeName: 'CustomEnterpriseContext',
      })
      writeFileSync(join(testDir, 'api.contract.ts'), contractCode, 'utf8')

      // 3. Generate all 4 framework routers
      for (const target of ['fastify', 'elysia', 'hono', 'express'] as const) {
        const routerCode = generateRouter(stressSpec, {
          target,
          contractImport: './api.contract',
          contextImport: './context',
          contextTypeName: 'CustomEnterpriseContext',
        } as any)
        writeFileSync(join(testDir, `${target}-router.ts`), routerCode, 'utf8')
      }

      // 4. Ambient framework declarations matching real framework types
      writeFileSync(
        join(testDir, 'ambient.d.ts'),
        [
          // Fastify
          "declare module 'fastify' {",
          '  export interface FastifyRequest {',
          '    params: unknown',
          '    query: unknown',
          '    headers: unknown',
          '    body: unknown',
          '    raw: { url?: string }',
          '    url: string',
          '  }',
          '  export interface FastifyReply {',
          '    status(code: number): this',
          '    send(payload?: unknown): this',
          '    header(name: string, value: string): this',
          '  }',
          '  export type RouteHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<any> | any',
          '  export type FastifyPluginAsync<Options = Record<never, never>> = (',
          '    fastify: FastifyInstance,',
          '    options: Options,',
          '  ) => Promise<void>',
          '  export interface FastifyInstance {',
          '    get(url: string, handler: RouteHandler): void',
          '    get(url: string, opts: { schema?: any }, handler: RouteHandler): void',
          '    post(url: string, handler: RouteHandler): void',
          '    post(url: string, opts: { schema?: any }, handler: RouteHandler): void',
          '    delete(url: string, handler: RouteHandler): void',
          '    delete(url: string, opts: { schema?: any }, handler: RouteHandler): void',
          '    route(opts: { method: string; url: string; schema?: any; handler: RouteHandler }): void',
          '  }',
          '}',
          // Elysia
          "declare module 'elysia' {",
          '  export interface Context {',
          '    params?: any',
          '    query?: any',
          '    headers?: any',
          '    body?: any',
          '    request: { url: string }',
          '    set: {',
          '      status?: number',
          '      headers: Record<string, string>',
          '    }',
          '  }',
          '  export class Elysia {',
          '    get(path: string, handler: (ctx: Context) => Promise<any>): this',
          '    post(path: string, handler: (ctx: Context) => Promise<any>): this',
          '    delete(path: string, handler: (ctx: Context) => Promise<any>): this',
          '    route(method: string, path: string, handler: (ctx: Context) => Promise<any>): this',
          '  }',
          '}',
          // Hono
          "declare module 'hono' {",
          '  export interface Context {',
          '    req: {',
          '      param(key?: string): any',
          '      query(key?: string): any',
          '      header(key?: string): any',
          '      raw: { url: string; body: any }',
          '      json(): Promise<any>',
          '    }',
          '    status(code: number): void',
          '    header(name: string, value: string): void',
          '    json(data: unknown, status?: number): Response',
          '    body(data: unknown, status?: number): Response',
          '  }',
          '  export class Hono {',
          '    get(path: string, handler: (c: Context) => Promise<any> | any): this',
          '    post(path: string, handler: (c: Context) => Promise<any> | any): this',
          '    delete(path: string, handler: (c: Context) => Promise<any> | any): this',
          '    on(method: string, path: string, handler: (c: Context) => Promise<any> | any): this',
          '  }',
          '}',
          // Express
          "declare module 'express' {",
          '  export interface Request {',
          '    params: any',
          '    query: any',
          '    headers: any',
          '    body: any',
          '    originalUrl?: string',
          '    url: string',
          '    method: string',
          '  }',
          '  export interface Response {',
          '    status(code: number): this',
          '    json(data?: unknown): this',
          '    end(): this',
          '    setHeader(name: string, value: string): this',
          '  }',
          '  export type RequestHandler = (req: Request, res: Response, next?: any) => any',
          '  export interface Router {',
          '    get(path: string, ...handlers: RequestHandler[]): this',
          '    post(path: string, ...handlers: RequestHandler[]): this',
          '    delete(path: string, ...handlers: RequestHandler[]): this',
          '    all(path: string, ...handlers: RequestHandler[]): this',
          '  }',
          '  export function Router(): Router',
          '}',
        ].join('\n'),
        'utf8',
      )

      // 5. Handlers implementation referencing CustomEnterpriseContext
      writeFileSync(
        join(testDir, 'handlers.ts'),
        [
          "import type { ApiHandlers } from './api.contract'",
          "import type { CustomEnterpriseContext } from './context'",
          '',
          'export const enterpriseHandlers: ApiHandlers<CustomEnterpriseContext> = {',
          '  getItem: async (ctx) => {',
          '    const tenant = ctx.context?.tenantId ?? "anonymous"',
          '    const role = ctx.context?.principal.role',
          '    return {',
          '      id: ctx.params.id,',
          '      tenant,',
          '      role,',
          '    }',
          '  },',
          '  deleteItem: async (_ctx) => {',
          '    return { status: 204, body: undefined }',
          '  },',
          '  createItem: async (ctx) => {',
          '    return {',
          '      body: ctx.body,',
          '      creator: ctx.context?.principal.id,',
          '    }',
          '  },',
          '  queryItems: async (ctx) => {',
          '    const corrId = ctx?.context?.correlationId',
          '    return { items: [], corrId }',
          '  },',
          '  ping: () => {',
          '    return { status: 200, body: { pong: true } }',
          '  },',
          '  onItemNotification: async (ctx) => {',
          '    void ctx.context?.correlationId',
          '    return { received: true }',
          '  },',
          '}',
        ].join('\n'),
        'utf8',
      )

      // 6. Test file mounting handlers into all 4 framework targets
      writeFileSync(
        join(testDir, 'index.ts'),
        [
          "import type { CustomEnterpriseContext } from './context'",
          "import { enterpriseHandlers } from './handlers'",
          "import { apiRouter as fastifyRouter } from './fastify-router'",
          "import createElysiaRouter from './elysia-router'",
          "import createHonoRouter from './hono-router'",
          "import createExpressRouter from './express-router'",
          '',
          'const sampleContext: CustomEnterpriseContext = {',
          '  tenantId: "t-100",',
          '  principal: { id: "u-1", role: "admin" },',
          '  correlationId: "c-999",',
          '  dbPool: { query: async () => [] },',
          '}',
          '',
          '// 1. Fastify with async getContext',
          'declare const fastify: any',
          'void fastifyRouter(fastify, {',
          '  handlers: enterpriseHandlers,',
          '  getContext: async (_req) => sampleContext,',
          '})',
          '',
          '// 2. Elysia with sync getContext',
          'const elysia = createElysiaRouter(enterpriseHandlers, {',
          '  getContext: (_ctx) => sampleContext,',
          '})',
          'void elysia',
          '',
          '// 3. Hono with static context fallback',
          'const hono = createHonoRouter(enterpriseHandlers, {',
          '  context: sampleContext,',
          '})',
          'void hono',
          '',
          '// 4. Express with zero context options',
          'const expressRouter = createExpressRouter(enterpriseHandlers)',
          'void expressRouter',
        ].join('\n'),
        'utf8',
      )

      // 7. tsconfig.json with strict checks
      writeFileSync(
        join(testDir, 'tsconfig.json'),
        JSON.stringify({
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
          include: ['*.ts', '*.d.ts'],
        }),
        'utf8',
      )

      const result = runTsc(testDir, ['--noEmit'])
      expect(result.success, `TypeScript compiler errors:\n${result.output}`).toBe(true)
    }, 30000)

    it('compiles adversarial collision spec cleanly where wire parameters are named context', () => {
      const testDir = join(tmpDir, 'tsc-collision-test')
      mkdirSync(testDir, { recursive: true })

      writeFileSync(
        join(testDir, 'context.ts'),
        'export interface MyProductContext { tenant: string }\n',
        'utf8',
      )

      const contractCode = generateHandlerContract(wireCollisionSpec, {
        contextImport: './context',
        contextTypeName: 'MyProductContext',
      })
      writeFileSync(join(testDir, 'collision.contract.ts'), contractCode, 'utf8')

      writeFileSync(
        join(testDir, 'test-handlers.ts'),
        [
          "import type { ApiHandlers } from './collision.contract'",
          "import type { MyProductContext } from './context'",
          '',
          'export const handlers: ApiHandlers<MyProductContext> = {',
          '  collideContext: async (ctx) => {',
          '    // Verify wire parameters are accessed separately from context',
          '    const pathContext: string = ctx.params.context',
          '    const queryContext: string | undefined = ctx.query?.context as any',
          '    const headerContext: string | undefined = ctx.headers?.context',
          '    const bodyContext: unknown = ctx.body',
          '    const productTenant: string | undefined = ctx.context?.tenant',
          '    return {',
          '      pathContext,',
          '      queryContext,',
          '      headerContext,',
          '      bodyContext,',
          '      productTenant,',
          '    }',
          '  },',
          '}',
        ].join('\n'),
        'utf8',
      )

      writeFileSync(
        join(testDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noEmit: true,
            module: 'ESNext',
            moduleResolution: 'bundler',
            target: 'ES2022',
            skipLibCheck: true,
          },
          include: ['*.ts'],
        }),
        'utf8',
      )

      const result = runTsc(testDir, ['--noEmit'])
      expect(result.success, `TypeScript collision errors:\n${result.output}`).toBe(true)
    }, 30000)
  })

  describe('5. Empirical Runtime Execution: Context Resolution, Edge Cases & Error Isolation', () => {
    // We execute compiled router code by constructing mock framework harnesses
    let testHarnessDir: string

    beforeAll(() => {
      testHarnessDir = join(tmpDir, 'runtime-execution-harness')
      mkdirSync(testHarnessDir, { recursive: true })

      writeFileSync(
        join(testHarnessDir, 'package.json'),
        JSON.stringify({ name: 'test-harness', type: 'module' }),
        'utf8',
      )

      writeFileSync(
        join(testHarnessDir, 'context.ts'),
        'export interface AppRuntimeContext { [key: string]: any }\n',
        'utf8',
      )

      // Ambient declarations for compiler
      writeFileSync(
        join(testHarnessDir, 'ambient.d.ts'),
        [
          "declare module 'fastify' {",
          '  export interface FastifyRequest {',
          '    params: unknown',
          '    query: unknown',
          '    headers: unknown',
          '    body: unknown',
          '    raw: { url?: string }',
          '    url: string',
          '  }',
          '  export interface FastifyReply {',
          '    status(code: number): this',
          '    send(payload?: unknown): this',
          '    header(name: string, value: string): this',
          '  }',
          '  export type RouteHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<any> | any',
          '  export type FastifyPluginAsync<Options = Record<never, never>> = (',
          '    fastify: any,',
          '    options: Options,',
          '  ) => Promise<void>',
          '}',
          "declare module 'elysia' {",
          '  export class Elysia {',
          '    routes: any[]',
          '    get(path: string, handler: (ctx: any) => Promise<any>): this',
          '    post(path: string, handler: (ctx: any) => Promise<any>): this',
          '    delete(path: string, handler: (ctx: any) => Promise<any>): this',
          '    route(method: string, path: string, handler: (ctx: any) => Promise<any>): this',
          '  }',
          '}',
          "declare module 'hono' {",
          '  export interface Context { [key: string]: any }',
          '  export class Hono {',
          '    routes: any[]',
          '    get(path: string, handler: (c: any) => Promise<any> | any): this',
          '    post(path: string, handler: (c: any) => Promise<any> | any): this',
          '    delete(path: string, handler: (c: any) => Promise<any> | any): this',
          '    on(method: string, path: string, handler: (c: any) => Promise<any> | any): this',
          '  }',
          '}',
          "declare module 'express' {",
          '  export interface Request { [key: string]: any }',
          '  export interface Router {',
          '    routes: any[]',
          '    get(path: string, ...handlers: any[]): this',
          '    post(path: string, ...handlers: any[]): this',
          '    delete(path: string, ...handlers: any[]): this',
          '    all(path: string, ...handlers: any[]): this',
          '  }',
          '  export function Router(): Router',
          '}',
        ].join('\n'),
        'utf8',
      )

      // Mock node_modules for hono, elysia, express
      const honoDir = join(testHarnessDir, 'node_modules', 'hono')
      mkdirSync(honoDir, { recursive: true })
      writeFileSync(
        join(honoDir, 'package.json'),
        JSON.stringify({ name: 'hono', type: 'module', main: './index.js' }),
        'utf8',
      )
      writeFileSync(
        join(honoDir, 'index.js'),
        [
          'export class Hono {',
          '  constructor() { this.routes = [] }',
          '  get(path, handler) { this.routes.push({ method: "GET", path, handler }) }',
          '  post(path, handler) { this.routes.push({ method: "POST", path, handler }) }',
          '  delete(path, handler) { this.routes.push({ method: "DELETE", path, handler }) }',
          '  on(method, path, handler) { this.routes.push({ method: String(method).toUpperCase(), path, handler }) }',
          '}',
        ].join('\n'),
        'utf8',
      )

      const elysiaDir = join(testHarnessDir, 'node_modules', 'elysia')
      mkdirSync(elysiaDir, { recursive: true })
      writeFileSync(
        join(elysiaDir, 'package.json'),
        JSON.stringify({ name: 'elysia', type: 'module', main: './index.js' }),
        'utf8',
      )
      writeFileSync(
        join(elysiaDir, 'index.js'),
        [
          'export class Elysia {',
          '  constructor() { this.routes = [] }',
          '  get(path, handler) { this.routes.push({ method: "GET", path, handler }); return this }',
          '  post(path, handler) { this.routes.push({ method: "POST", path, handler }); return this }',
          '  delete(path, handler) { this.routes.push({ method: "DELETE", path, handler }); return this }',
          '  route(method, path, handler) { this.routes.push({ method: String(method).toUpperCase(), path, handler }); return this }',
          '}',
        ].join('\n'),
        'utf8',
      )

      const expressDir = join(testHarnessDir, 'node_modules', 'express')
      mkdirSync(expressDir, { recursive: true })
      writeFileSync(
        join(expressDir, 'package.json'),
        JSON.stringify({ name: 'express', type: 'module', main: './index.js' }),
        'utf8',
      )
      writeFileSync(
        join(expressDir, 'index.js'),
        [
          'export function Router() {',
          '  const r = {',
          '    routes: [],',
          '    get(path, ...handlers) { r.routes.push({ method: "GET", path, handler: handlers[handlers.length - 1] }); return r },',
          '    post(path, ...handlers) { r.routes.push({ method: "POST", path, handler: handlers[handlers.length - 1] }); return r },',
          '    delete(path, ...handlers) { r.routes.push({ method: "DELETE", path, handler: handlers[handlers.length - 1] }); return r },',
          '    all(path, ...handlers) { r.routes.push({ method: "ALL", path, handler: handlers[handlers.length - 1] }); return r },',
          '  }',
          '  return r',
          '}',
        ].join('\n'),
        'utf8',
      )

      // Generate contracts and target routers
      const contractCode = generateHandlerContract(stressSpec, {
        contextImport: './context',
        contextTypeName: 'AppRuntimeContext',
      })
      writeFileSync(join(testHarnessDir, 'api.contract.ts'), contractCode, 'utf8')

      const fastifyCode = generateRouter(stressSpec, {
        target: 'fastify',
        contractImport: './api.contract',
        contextImport: './context',
        contextTypeName: 'AppRuntimeContext',
      } as any)
      writeFileSync(join(testHarnessDir, 'fastify-router.ts'), fastifyCode, 'utf8')

      const elysiaCode = generateRouter(stressSpec, {
        target: 'elysia',
        contractImport: './api.contract',
        contextImport: './context',
        contextTypeName: 'AppRuntimeContext',
      } as any)
      writeFileSync(join(testHarnessDir, 'elysia-router.ts'), elysiaCode, 'utf8')

      const honoCode = generateRouter(stressSpec, {
        target: 'hono',
        contractImport: './api.contract',
        contextImport: './context',
        contextTypeName: 'AppRuntimeContext',
      } as any)
      writeFileSync(join(testHarnessDir, 'hono-router.ts'), honoCode, 'utf8')

      const expressCode = generateRouter(stressSpec, {
        target: 'express',
        contractImport: './api.contract',
        contextImport: './context',
        contextTypeName: 'AppRuntimeContext',
      } as any)
      writeFileSync(join(testHarnessDir, 'express-router.ts'), expressCode, 'utf8')

      // tsconfig for emitting ES module JavaScript
      writeFileSync(
        join(testHarnessDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            module: 'ESNext',
            moduleResolution: 'bundler',
            target: 'ES2022',
            outDir: './dist',
            declaration: false,
            skipLibCheck: true,
          },
          include: ['*.ts', '*.d.ts'],
        }),
        'utf8',
      )

      // Compile to JS
      const compileResult = runTsc(testHarnessDir, [])
      expect(compileResult.success, `Compile failed:\n${compileResult.output}`).toBe(true)
    }, 30000)

    function createMockFastify() {
      const routes: Record<string, Function> = {}
      return {
        routes,
        getRoute(key: string): Function {
          const r = routes[key]
          if (!r) throw new Error(`Route not found: ${key}`)
          return r
        },
        get(url: string, optsOrHandler: any, maybeHandler?: any) {
          routes[`GET ${url}`] = maybeHandler || optsOrHandler
        },
        post(url: string, optsOrHandler: any, maybeHandler?: any) {
          routes[`POST ${url}`] = maybeHandler || optsOrHandler
        },
        delete(url: string, optsOrHandler: any, maybeHandler?: any) {
          routes[`DELETE ${url}`] = maybeHandler || optsOrHandler
        },
        route(opts: any) {
          routes[`${opts.method} ${opts.url}`] = opts.handler
        },
      }
    }

    function createMockReply() {
      let _status = 200
      const _headers: Record<string, string> = {}
      let _sentPayload: any = undefined
      const reply = {
        status(code: number) {
          _status = code
          return reply
        },
        header(name: string, value: string) {
          _headers[name] = value
          return reply
        },
        send(payload: any) {
          _sentPayload = payload
          return payload
        },
        get statusVal() {
          return _status
        },
        get headersVal() {
          return _headers
        },
        get sentVal() {
          return _sentPayload
        },
      }
      return reply
    }

    it('executes Fastify router with async getContext, sync getContext, static context, and precedence', async () => {
      const fastifyModule = await import(join(testHarnessDir, 'dist', 'fastify-router.js'))
      const apiRouter = fastifyModule.apiRouter

      let receivedCtx: any = null
      const handlers = {
        getItem: async (ctx: any) => {
          receivedCtx = ctx
          return { id: ctx.params.id }
        },
        deleteItem: async () => ({ status: 204, body: undefined }),
        createItem: async () => ({ status: 201, body: {} }),
        queryItems: async () => ({ items: [] }),
        ping: () => ({ pong: true }),
        onItemNotification: async () => ({ received: true }),
      }

      // Test 1: Async getContext
      {
        receivedCtx = null
        const mockFastify = createMockFastify()
        await apiRouter(mockFastify, {
          handlers,
          getContext: async (req: any) => {
            await new Promise(r => setTimeout(r, 1))
            return { tenantId: 'async-tenant', user: req.headers['authorization'] }
          },
        })

        const req = {
          params: { id: 'item-123' },
          query: { fields: 'name' },
          headers: { authorization: 'Bearer tok-1', 'x-tenant': 't1' },
          url: '/items/item-123',
          raw: { url: '/items/item-123' },
        }
        const reply = createMockReply()
        await mockFastify.getRoute('GET /items/:id')(req, reply)

        expect(receivedCtx).toBeDefined()
        expect(receivedCtx.params.id).toBe('item-123')
        expect(receivedCtx.query.fields).toBe('name')
        expect(receivedCtx.headers['x-tenant']).toBe('t1')
        expect(receivedCtx.context).toEqual({ tenantId: 'async-tenant', user: 'Bearer tok-1' })
      }

      // Test 2: Synchronous getContext
      {
        receivedCtx = null
        const mockFastify = createMockFastify()
        await apiRouter(mockFastify, {
          handlers,
          getContext: (_req: any) => ({ tenantId: 'sync-tenant' }),
        })

        const req = {
          params: { id: 'item-456' },
          query: {},
          headers: {},
          url: '/items/item-456',
          raw: { url: '/items/item-456' },
        }
        const reply = createMockReply()
        await mockFastify.getRoute('GET /items/:id')(req, reply)

        expect(receivedCtx.context).toEqual({ tenantId: 'sync-tenant' })
      }

      // Test 3: Static context fallback when getContext is omitted
      {
        receivedCtx = null
        const mockFastify = createMockFastify()
        await apiRouter(mockFastify, {
          handlers,
          context: { tenantId: 'static-fallback' },
        })

        const req = {
          params: { id: 'item-789' },
          query: {},
          headers: {},
          url: '/items/item-789',
          raw: { url: '/items/item-789' },
        }
        const reply = createMockReply()
        await mockFastify.getRoute('GET /items/:id')(req, reply)

        expect(receivedCtx.context).toEqual({ tenantId: 'static-fallback' })
      }

      // Test 4: Precedence of getContext over static context
      {
        receivedCtx = null
        const mockFastify = createMockFastify()
        await apiRouter(mockFastify, {
          handlers,
          getContext: () => ({ winner: 'dynamic' }),
          context: { winner: 'static' },
        })

        const req = {
          params: { id: 'item-prec' },
          query: {},
          headers: {},
          url: '/items/item-prec',
          raw: { url: '/items/item-prec' },
        }
        const reply = createMockReply()
        await mockFastify.getRoute('GET /items/:id')(req, reply)

        expect(receivedCtx.context).toEqual({ winner: 'dynamic' })
      }

      // Test 5: Undefined context - context property is not even added
      {
        receivedCtx = null
        const mockFastify = createMockFastify()
        await apiRouter(mockFastify, { handlers })

        const req = {
          params: { id: 'item-undef' },
          query: {},
          headers: {},
          url: '/items/item-undef',
          raw: { url: '/items/item-undef' },
        }
        const reply = createMockReply()
        await mockFastify.getRoute('GET /items/:id')(req, reply)

        expect('context' in receivedCtx).toBe(false)
      }

      // Test 6: getContext returns undefined - context property is omitted
      {
        receivedCtx = null
        const mockFastify = createMockFastify()
        await apiRouter(mockFastify, {
          handlers,
          getContext: () => undefined,
        })

        const req = {
          params: { id: 'item-ret-undef' },
          query: {},
          headers: {},
          url: '/items/item-ret-undef',
          raw: { url: '/items/item-ret-undef' },
        }
        const reply = createMockReply()
        await mockFastify.getRoute('GET /items/:id')(req, reply)

        expect('context' in receivedCtx).toBe(false)
      }

      // Test 7: Falsy non-undefined contexts are preserved (null, false, 0, "")
      for (const falsyVal of [null, false, 0, '']) {
        receivedCtx = null
        const mockFastify = createMockFastify()
        await apiRouter(mockFastify, {
          handlers,
          context: falsyVal,
        })

        const req = {
          params: { id: 'item-falsy' },
          query: {},
          headers: {},
          url: '/items/item-falsy',
          raw: { url: '/items/item-falsy' },
        }
        const reply = createMockReply()
        await mockFastify.getRoute('GET /items/:id')(req, reply)

        expect('context' in receivedCtx).toBe(true)
        expect(receivedCtx.context).toBe(falsyVal)
      }

      // Test 8: Error isolation when getContext throws synchronously
      {
        const mockFastify = createMockFastify()
        await apiRouter(mockFastify, {
          handlers,
          getContext: () => {
            throw new Error('Sync auth failed')
          },
        })

        const req = {
          params: { id: 'item-err' },
          query: {},
          headers: {},
          url: '/items/item-err',
          raw: { url: '/items/item-err' },
        }
        const reply = createMockReply()
        await mockFastify.getRoute('GET /items/:id')(req, reply)

        expect(reply.statusVal).toBe(500)
        expect(reply.sentVal).toEqual({
          error: { code: 'INTERNAL_ERROR', message: 'Sync auth failed', details: [] },
        })
      }

      // Test 9: Error isolation when getContext rejects asynchronously
      {
        const mockFastify = createMockFastify()
        await apiRouter(mockFastify, {
          handlers,
          getContext: async () => {
            await new Promise(r => setTimeout(r, 1))
            throw new Error('Async database timeout')
          },
        })

        const req = {
          params: { id: 'item-err-async' },
          query: {},
          headers: {},
          url: '/items/item-err-async',
          raw: { url: '/items/item-err-async' },
        }
        const reply = createMockReply()
        await mockFastify.getRoute('GET /items/:id')(req, reply)

        expect(reply.statusVal).toBe(500)
        expect(reply.sentVal).toEqual({
          error: { code: 'INTERNAL_ERROR', message: 'Async database timeout', details: [] },
        })
      }

      // Test 10: Webhook receives resolved context
      {
        let receivedWebhookCtx: any = null
        const webhookHandlers = {
          ...handlers,
          onItemNotification: async (ctx: any) => {
            receivedWebhookCtx = ctx
            return { acknowledged: true }
          },
        }

        const mockFastify = createMockFastify()
        await apiRouter(mockFastify, {
          handlers: webhookHandlers,
          getContext: () => ({ webhookTenant: 'wh-42' }),
        })

        const req = {
          body: { event: 'item.created' },
          params: {},
          query: {},
          headers: {},
          url: '/webhooks/itemNotification',
          raw: { url: '/webhooks/itemNotification' },
        }
        const reply = createMockReply()
        const result = await mockFastify.getRoute('POST /webhooks/itemNotification')(req, reply)

        expect(receivedWebhookCtx).toBeDefined()
        expect(receivedWebhookCtx.context).toEqual({ webhookTenant: 'wh-42' })
        expect(receivedWebhookCtx.body).toEqual({ event: 'item.created' })
        expect(result).toEqual({ acknowledged: true })
      }
    })

    it('executes Bun Elysia router: zero-copy destructuring, context forwarding, and error isolation', async () => {
      const elysiaModule = await import(join(testHarnessDir, 'dist', 'elysia-router.js'))
      const createRouter = elysiaModule.default

      let receivedCtx: any = null
      const handlers = {
        getItem: async (ctx: any) => {
          receivedCtx = ctx
          return { id: ctx.params.id }
        },
        deleteItem: async () => ({ status: 204, body: undefined }),
        createItem: async (ctx: any) => ({ status: 201, body: ctx.body }),
        queryItems: async (ctx: any) => ({ query: ctx.query }),
        ping: () => ({ pong: true }),
        onItemNotification: async (ctx: any) => ({ received: true, ctx: ctx.context }),
      }

      // 1. Context forwarding
      {
        receivedCtx = null
        const app = createRouter(handlers, {
          getContext: async (c: any) => {
            return { actor: c.headers['x-actor'], queryMode: c.query['mode'] }
          },
        })

        const route = app.routes.find((r: any) => r.method === 'GET' && r.path === '/items/:id')
        expect(route).toBeDefined()

        const elysiaContext = {
          params: { id: 'elysia-1' },
          query: { mode: 'fast' },
          headers: { 'x-actor': 'bun-user' },
          body: undefined,
          request: { url: 'http://localhost/items/elysia-1?mode=fast' },
          set: { status: 200, headers: {} },
        }

        const res = await route.handler(elysiaContext)
        expect(res).toEqual({ id: 'elysia-1' })
        expect(receivedCtx.context).toEqual({ actor: 'bun-user', queryMode: 'fast' })
        expect(receivedCtx.params.id).toBe('elysia-1')
      }

      // 2. Error isolation in Elysia getContext
      {
        const app = createRouter(handlers, {
          getContext: () => {
            throw new Error('Elysia token invalid')
          },
        })

        const route = app.routes.find((r: any) => r.method === 'GET' && r.path === '/items/:id')
        const elysiaContext = {
          params: { id: 'elysia-err' },
          query: {},
          headers: {},
          body: undefined,
          request: { url: 'http://localhost/items/elysia-err' },
          set: { status: 200, headers: {} },
        }

        const res = await route.handler(elysiaContext)
        expect(elysiaContext.set.status).toBe(500)
        expect(res).toEqual({
          error: { code: 'INTERNAL_ERROR', message: 'Elysia token invalid', details: [] },
        })
      }
    })

    it('executes Hono router: context forwarding, status code mapping, and error isolation', async () => {
      const honoModule = await import(join(testHarnessDir, 'dist', 'hono-router.js'))
      const createRouter = honoModule.default

      let receivedCtx: any = null
      const handlers = {
        getItem: async (ctx: any) => {
          receivedCtx = ctx
          return { id: ctx.params.id }
        },
        deleteItem: async () => ({ status: 204, body: undefined }),
        createItem: async (ctx: any) => ({ status: 201, body: ctx.body }),
        queryItems: async (ctx: any) => ({ query: ctx.query }),
        ping: () => ({ pong: true }),
        onItemNotification: async (ctx: any) => ({ received: true, context: ctx.context }),
      }

      // 1. Context forwarding
      {
        receivedCtx = null
        const app = createRouter(handlers, {
          getContext: async (c: any) => {
            return { honoTrace: c.req.header('x-trace') }
          },
        })

        const route = app.routes.find((r: any) => r.method === 'GET' && r.path === '/items/:id')
        expect(route).toBeDefined()

        const mockHonoContext = {
          req: {
            param: () => ({ id: 'hono-99' }),
            query: () => ({}),
            header: (h: string) => (h === 'x-trace' ? 'trc-123' : undefined),
            raw: { url: 'http://localhost/items/hono-99', body: null },
          },
          json: (data: any, status: number = 200) => ({ status, data }),
          body: (data: any, status: number) => ({ status, data }),
          header: () => {},
        }

        const res = await route.handler(mockHonoContext)
        expect(res.status).toBe(200)
        expect(res.data).toEqual({ id: 'hono-99' })
        expect(receivedCtx.context).toEqual({ honoTrace: 'trc-123' })
      }

      // 2. Error isolation in Hono getContext
      {
        const app = createRouter(handlers, {
          getContext: () => {
            throw new Error('Hono middleware failure')
          },
        })

        const route = app.routes.find((r: any) => r.method === 'GET' && r.path === '/items/:id')
        const mockHonoContext = {
          req: {
            param: () => ({ id: 'hono-err' }),
            query: () => ({}),
            header: () => undefined,
            raw: { url: 'http://localhost/items/hono-err', body: null },
          },
          json: (data: any, status: number) => ({ status, data }),
          body: () => {},
          header: () => {},
        }

        const res = await route.handler(mockHonoContext)
        expect(res.status).toBe(500)
        expect(res.data).toEqual({
          error: { code: 'INTERNAL_ERROR', message: 'Hono middleware failure', details: [] },
        })
      }
    })

    it('executes Express router: context forwarding, method guards, and error isolation', async () => {
      const expressModule = await import(join(testHarnessDir, 'dist', 'express-router.js'))
      const createRouter = expressModule.default

      let receivedCtx: any = null
      const handlers = {
        getItem: async (ctx: any) => {
          receivedCtx = ctx
          return { id: ctx.params.id }
        },
        deleteItem: async () => ({ status: 204, body: undefined }),
        createItem: async (ctx: any) => ({ status: 201, body: ctx.body }),
        queryItems: async (ctx: any) => ({ query: ctx.query }),
        ping: () => ({ pong: true }),
        onItemNotification: async (ctx: any) => ({ received: true, context: ctx.context }),
      }

      // 1. Context forwarding
      {
        receivedCtx = null
        const router = createRouter(handlers, {
          getContext: (req: any) => ({ user: req.headers['x-user'] }),
        })

        const route = router.routes.find((r: any) => r.method === 'GET' && r.path === '/items/:id')
        expect(route).toBeDefined()

        let sentStatus = 200
        let sentJson: any = null
        const mockReq = {
          params: { id: 'exp-1' },
          query: {},
          headers: { 'x-user': 'alice' },
          originalUrl: '/items/exp-1',
          url: '/items/exp-1',
          method: 'GET',
        }
        const mockRes = {
          status(code: number) {
            sentStatus = code
            return mockRes
          },
          json(payload: any) {
            sentJson = payload
            return payload
          },
          end() {
            return mockRes
          },
          setHeader() {
            return mockRes
          },
        }

        await route.handler(mockReq, mockRes)
        expect(sentStatus).toBe(200)
        expect(sentJson).toEqual({ id: 'exp-1' })
        expect(receivedCtx.context).toEqual({ user: 'alice' })
      }

      // 2. Error isolation in Express getContext
      {
        const router = createRouter(handlers, {
          getContext: () => {
            throw new Error('Express session error')
          },
        })

        const route = router.routes.find((r: any) => r.method === 'GET' && r.path === '/items/:id')
        let sentStatus = 200
        let sentJson: any = null
        const mockReq = {
          params: { id: 'exp-err' },
          query: {},
          headers: {},
          originalUrl: '/items/exp-err',
          url: '/items/exp-err',
          method: 'GET',
        }
        const mockRes = {
          status(code: number) {
            sentStatus = code
            return mockRes
          },
          json(payload: any) {
            sentJson = payload
            return payload
          },
          end() {
            return mockRes
          },
          setHeader() {
            return mockRes
          },
        }

        await route.handler(mockReq, mockRes)
        expect(sentStatus).toBe(500)
        expect(sentJson).toEqual({
          error: { code: 'INTERNAL_ERROR', message: 'Express session error', details: [] },
        })
      }
    })

    it('executes routers when options argument is completely omitted (Elysia, Hono, Express)', async () => {
      const elysiaModule = await import(join(testHarnessDir, 'dist', 'elysia-router.js'))
      const honoModule = await import(join(testHarnessDir, 'dist', 'hono-router.js'))
      const expressModule = await import(join(testHarnessDir, 'dist', 'express-router.js'))

      const handlers = {
        getItem: async (ctx: any) => ({ id: ctx.params.id, hasContext: 'context' in ctx }),
        deleteItem: async () => ({ status: 204, body: undefined }),
        createItem: async () => ({ status: 201, body: {} }),
        queryItems: async () => ({ items: [] }),
        ping: () => ({ pong: true }),
        onItemNotification: async () => ({ received: true }),
      }

      // 1. Elysia without options
      const elysiaApp = elysiaModule.default(handlers)
      const elysiaRoute = elysiaApp.routes.find((r: any) => r.method === 'GET' && r.path === '/items/:id')
      const elysiaRes = await elysiaRoute.handler({
        params: { id: 'no-opts-elysia' },
        query: {},
        headers: {},
        body: undefined,
        request: { url: '/items/no-opts-elysia' },
        set: { status: 200, headers: {} },
      })
      expect(elysiaRes).toEqual({ id: 'no-opts-elysia', hasContext: false })

      // 2. Hono without options
      const honoApp = honoModule.default(handlers)
      const honoRoute = honoApp.routes.find((r: any) => r.method === 'GET' && r.path === '/items/:id')
      const honoRes = await honoRoute.handler({
        req: {
          param: () => ({ id: 'no-opts-hono' }),
          query: () => ({}),
          header: () => undefined,
          raw: { url: '/items/no-opts-hono', body: null },
        },
        json: (data: any, status: number = 200) => ({ status, data }),
        body: (data: any, status: number) => ({ status, data }),
        header: () => {},
      })
      expect(honoRes.data).toEqual({ id: 'no-opts-hono', hasContext: false })

      // 3. Express without options
      const expressApp = expressModule.default(handlers)
      const expressRoute = expressApp.routes.find((r: any) => r.method === 'GET' && r.path === '/items/:id')
      let sentJson: any = null
      await expressRoute.handler(
        { params: { id: 'no-opts-exp' }, query: {}, headers: {}, url: '/items/no-opts-exp', method: 'GET' },
        { status: () => ({ json: (d: any) => { sentJson = d } }), setHeader: () => {} },
      )
      expect(sentJson).toEqual({ id: 'no-opts-exp', hasContext: false })
    })

    it('propagates structured response envelopes { status, headers, body } across all 4 frameworks', async () => {
      const fastifyModule = await import(join(testHarnessDir, 'dist', 'fastify-router.js'))
      const elysiaModule = await import(join(testHarnessDir, 'dist', 'elysia-router.js'))
      const honoModule = await import(join(testHarnessDir, 'dist', 'hono-router.js'))
      const expressModule = await import(join(testHarnessDir, 'dist', 'express-router.js'))

      const structuredHandlers = {
        getItem: async () => ({
          status: 202,
          headers: { 'x-correlation-id': 'corr-abc-123', 'cache-control': 'no-store' },
          body: { processed: true, code: 'ACCEPTED' },
        }),
        deleteItem: async () => ({ status: 204, body: undefined }),
        createItem: async () => ({ status: 201, body: {} }),
        queryItems: async () => ({ items: [] }),
        ping: () => ({ pong: true }),
        onItemNotification: async () => ({ received: true }),
      }

      // Fastify check
      {
        const mockFastify = createMockFastify()
        await fastifyModule.apiRouter(mockFastify, { handlers: structuredHandlers })
        const reply = createMockReply()
        const body = await mockFastify.getRoute('GET /items/:id')({ params: {}, query: {}, headers: {}, raw: {} }, reply)
        expect(reply.statusVal).toBe(202)
        expect(reply.headersVal['x-correlation-id']).toBe('corr-abc-123')
        expect(reply.headersVal['cache-control']).toBe('no-store')
        expect(body).toEqual({ processed: true, code: 'ACCEPTED' })
      }

      // Elysia check
      {
        const app = elysiaModule.default(structuredHandlers)
        const route = app.routes.find((r: any) => r.method === 'GET' && r.path === '/items/:id')
        const elysiaCtx = {
          params: {},
          query: {},
          headers: {},
          body: undefined,
          request: { url: '/items/1' },
          set: { status: 200, headers: {} as Record<string, string> },
        }
        const body = await route.handler(elysiaCtx)
        expect(elysiaCtx.set.status).toBe(202)
        expect(elysiaCtx.set.headers['x-correlation-id']).toBe('corr-abc-123')
        expect(body).toEqual({ processed: true, code: 'ACCEPTED' })
      }

      // Hono check
      {
        const app = honoModule.default(structuredHandlers)
        const route = app.routes.find((r: any) => r.method === 'GET' && r.path === '/items/:id')
        const setHeaders: Record<string, string> = {}
        const honoCtx = {
          req: { param: () => ({}), query: () => ({}), header: () => undefined, raw: { url: '/items/1' } },
          header: (k: string, v: string) => { setHeaders[k] = v },
          json: (data: any, status: number) => ({ status, data }),
          body: () => {},
        }
        const res = await route.handler(honoCtx)
        expect(res.status).toBe(202)
        expect(setHeaders['x-correlation-id']).toBe('corr-abc-123')
        expect(res.data).toEqual({ processed: true, code: 'ACCEPTED' })
      }

      // Express check
      {
        const router = expressModule.default(structuredHandlers)
        const route = router.routes.find((r: any) => r.method === 'GET' && r.path === '/items/:id')
        let expStatus = 200
        const expHeaders: Record<string, string> = {}
        let expBody: any = null
        const res = {
          status: (s: number) => { expStatus = s; return res },
          setHeader: (k: string, v: string) => { expHeaders[k] = v; return res },
          json: (b: any) => { expBody = b; return res },
        }
        await route.handler({ params: {}, query: {}, headers: {}, url: '/items/1', method: 'GET' }, res)
        expect(expStatus).toBe(202)
        expect(expHeaders['x-correlation-id']).toBe('corr-abc-123')
        expect(expBody).toEqual({ processed: true, code: 'ACCEPTED' })
      }
    })

    it('safely handles direct null response return without "in" operator crash', async () => {
      const fastifyModule = await import(join(testHarnessDir, 'dist', 'fastify-router.js'))
      const elysiaModule = await import(join(testHarnessDir, 'dist', 'elysia-router.js'))
      const honoModule = await import(join(testHarnessDir, 'dist', 'hono-router.js'))
      const expressModule = await import(join(testHarnessDir, 'dist', 'express-router.js'))

      const nullHandlers = {
        getItem: async () => null,
        deleteItem: async () => ({ status: 204, body: undefined }),
        createItem: async () => ({ status: 201, body: {} }),
        queryItems: async () => ({ items: [] }),
        ping: () => null,
        onItemNotification: async () => ({ received: true }),
      }

      // Fastify
      const mockFastify = createMockFastify()
      await fastifyModule.apiRouter(mockFastify, { handlers: nullHandlers })
      const fastifyReply = createMockReply()
      const fastifyResult = await mockFastify.getRoute('GET /items/:id')({ params: {}, query: {}, headers: {}, raw: {} }, fastifyReply)
      expect(fastifyResult).toBeNull()

      // Elysia
      const elysiaApp = elysiaModule.default(nullHandlers)
      const elysiaRoute = elysiaApp.routes.find((r: any) => r.method === 'GET' && r.path === '/items/:id')
      const elysiaRes = await elysiaRoute.handler({
        params: {},
        query: {},
        headers: {},
        body: undefined,
        request: { url: '/items/1' },
        set: { status: 200, headers: {} },
      })
      expect(elysiaRes).toBeNull()

      // Hono
      const honoApp = honoModule.default(nullHandlers)
      const honoRoute = honoApp.routes.find((r: any) => r.method === 'GET' && r.path === '/items/:id')
      const honoRes = await honoRoute.handler({
        req: { param: () => ({}), query: () => ({}), header: () => undefined, raw: { url: '/items/1' } },
        json: (data: any, status: number = 200) => ({ status, data }),
        body: () => {},
        header: () => {},
      })
      expect(honoRes.data).toBeNull()

      // Express
      const expressApp = expressModule.default(nullHandlers)
      const expressRoute = expressApp.routes.find((r: any) => r.method === 'GET' && r.path === '/items/:id')
      let expResult: any = 'not-called'
      await expressRoute.handler(
        { params: {}, query: {}, headers: {}, url: '/items/1', method: 'GET' },
        { status: () => ({ json: (d: any) => { expResult = d } }), setHeader: () => {} },
      )
      expect(expResult).toBeNull()
    })

    it('safely handles non-Error rejection in getContext across all 4 frameworks', async () => {
      const fastifyModule = await import(join(testHarnessDir, 'dist', 'fastify-router.js'))
      const elysiaModule = await import(join(testHarnessDir, 'dist', 'elysia-router.js'))
      const honoModule = await import(join(testHarnessDir, 'dist', 'hono-router.js'))
      const expressModule = await import(join(testHarnessDir, 'dist', 'express-router.js'))

      const dummyHandlers = {
        getItem: async () => ({ id: '1' }),
        deleteItem: async () => ({ status: 204, body: undefined }),
        createItem: async () => ({ status: 201, body: {} }),
        queryItems: async () => ({ items: [] }),
        ping: () => ({ pong: true }),
        onItemNotification: async () => ({ received: true }),
      }

      // Rejects with raw string (not an Error instance)
      const rawStringRejectContext = () => Promise.reject('Unauthorized string token')

      // Fastify
      {
        const mockFastify = createMockFastify()
        await fastifyModule.apiRouter(mockFastify, {
          handlers: dummyHandlers,
          getContext: rawStringRejectContext,
        })
        const reply = createMockReply()
        await mockFastify.getRoute('GET /items/:id')({ params: {}, query: {}, headers: {}, raw: {} }, reply)
        expect(reply.statusVal).toBe(500)
        expect(reply.sentVal.error.message).toBe('Unauthorized string token')
      }

      // Elysia
      {
        const app = elysiaModule.default(dummyHandlers, { getContext: rawStringRejectContext })
        const route = app.routes.find((r: any) => r.method === 'GET' && r.path === '/items/:id')
        const elysiaCtx = {
          params: {},
          query: {},
          headers: {},
          body: undefined,
          request: { url: '/items/1' },
          set: { status: 200, headers: {} },
        }
        const res = await route.handler(elysiaCtx)
        expect(elysiaCtx.set.status).toBe(500)
        expect(res.error.message).toBe('Unauthorized string token')
      }

      // Hono
      {
        const app = honoModule.default(dummyHandlers, { getContext: rawStringRejectContext })
        const route = app.routes.find((r: any) => r.method === 'GET' && r.path === '/items/:id')
        const honoCtx = {
          req: { param: () => ({}), query: () => ({}), header: () => undefined, raw: { url: '/items/1' } },
          json: (data: any, status: number) => ({ status, data }),
        }
        const res = await route.handler(honoCtx)
        expect(res.status).toBe(500)
        expect(res.data.error.message).toBe('Unauthorized string token')
      }

      // Express
      {
        const router = expressModule.default(dummyHandlers, { getContext: rawStringRejectContext })
        const route = router.routes.find((r: any) => r.method === 'GET' && r.path === '/items/:id')
        let expStatus = 200
        let expBody: any = null
        const res = {
          status: (s: number) => { expStatus = s; return res },
          json: (b: any) => { expBody = b; return res },
        }
        await route.handler({ params: {}, query: {}, headers: {}, url: '/items/1', method: 'GET' }, res)
        expect(expStatus).toBe(500)
        expect(expBody.error.message).toBe('Unauthorized string token')
      }
    })

    it('returns { received: true } for webhooks when webhook handler is not implemented on handlers', async () => {
      const fastifyModule = await import(join(testHarnessDir, 'dist', 'fastify-router.js'))
      const elysiaModule = await import(join(testHarnessDir, 'dist', 'elysia-router.js'))
      const honoModule = await import(join(testHarnessDir, 'dist', 'hono-router.js'))
      const expressModule = await import(join(testHarnessDir, 'dist', 'express-router.js'))

      // Handlers object omitting onItemNotification
      const partialHandlers = {
        getItem: async () => ({ id: '1' }),
        deleteItem: async () => ({ status: 204, body: undefined }),
        createItem: async () => ({ status: 201, body: {} }),
        queryItems: async () => ({ items: [] }),
        ping: () => ({ pong: true }),
      }

      // Fastify webhook route
      {
        const mockFastify = createMockFastify()
        await fastifyModule.apiRouter(mockFastify, { handlers: partialHandlers })
        const reply = createMockReply()
        const res = await mockFastify.getRoute('POST /webhooks/itemNotification')({ body: {}, params: {}, query: {}, headers: {}, raw: {} }, reply)
        expect(res).toEqual({ received: true })
      }

      // Elysia webhook route
      {
        const app = elysiaModule.default(partialHandlers)
        const route = app.routes.find((r: any) => r.method === 'POST' && r.path === '/webhooks/itemNotification')
        const elysiaCtx = {
          params: {},
          query: {},
          headers: {},
          body: {},
          request: { url: '/webhooks/itemNotification' },
          set: { status: 200, headers: {} },
        }
        const res = await route.handler(elysiaCtx)
        expect(res).toEqual({ received: true })
      }

      // Hono webhook route
      {
        const app = honoModule.default(partialHandlers)
        expect(app).toBeDefined()
      }

      // Express webhook route
      {
        const router = expressModule.default(partialHandlers)
        expect(router).toBeDefined()
      }
    })
  })
})

