import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import type { OasDocument } from '@oa-sdk/parser'
import { generateRouter, generateHandlerContract } from '../generate-router.js'

const require = createRequire(import.meta.url)
const tscBin = require.resolve('typescript/bin/tsc')

function runTsc(cwd: string): void {
  try {
    execFileSync(process.execPath, [tscBin, '--noEmit'], {
      cwd,
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const result = error as { stdout?: Buffer; stderr?: Buffer }
    const diagnostics = [result.stdout, result.stderr]
      .filter((output): output is Buffer => output instanceof Buffer && output.length > 0)
      .map(output => output.toString('utf8').trim())
      .filter(Boolean)
      .join('\n')
    throw new Error(diagnostics || 'tsc --noEmit failed without diagnostics')
  }
}

const tmpDir = resolve(__dirname, '../../.tmp-handler-context-test')

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

function doc(overrides: Partial<OasDocument> = {}): OasDocument {
  return { openapi: '3.2.0', info: { title: 'T', version: '0' }, paths: {}, ...overrides } as OasDocument
}

const sampleSpec = doc({
  paths: {
    '/users/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: {
        operationId: 'getUser',
        parameters: [{ name: 'fields', in: 'query', schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'User',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
    '/users': {
      post: {
        operationId: 'createUser',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: {
          '201': {
            description: 'Created',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
  },
  webhooks: {
    userEvent: {
      post: {
        operationId: 'onUserEvent',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: {
          '200': { description: 'Webhook received' },
        },
      },
    },
  },
})

describe('Generic Product Context Injection (M3)', () => {
  describe('Handler Contracts (handler-contract.ts)', () => {
    it('generates context interfaces with generic TContext = unknown and optional context field', () => {
      const contract = generateHandlerContract(sampleSpec, { typesImport: './types' })

      // Verify generic context interface with optional context field
      expect(contract).toContain('export interface GetUserContext<TContext = unknown> {')
      expect(contract).toContain('  params: GetUserPathParams')
      expect(contract).toContain('  query?: GetUserQueryParams')
      expect(contract).toContain('  context?: TContext')

      // Verify generic handler signature
      expect(contract).toContain('export type GetUserHandler<TContext = unknown> = (')
      expect(contract).toContain('  ctx: GetUserContext<TContext>')

      // Verify generic webhook interface
      expect(contract).toContain('export interface OnUserEventWebhookContext<TContext = unknown> {')
      expect(contract).toContain('  context?: TContext')
      expect(contract).toContain('export type OnUserEventWebhookHandler<TContext = unknown> = (')
      expect(contract).toContain('  ctx: OnUserEventWebhookContext<TContext>')

      // Verify aggregate interface
      expect(contract).toContain('export interface ApiHandlers<TContext = unknown> {')
      expect(contract).toContain('  getUser: GetUserHandler<TContext>')
      expect(contract).toContain('  createUser: CreateUserHandler<TContext>')
      expect(contract).toContain('  onUserEvent?: OnUserEventWebhookHandler<TContext>')
    })

    it('supports contextImport and contextTypeName to specialize TContext', () => {
      const contract = generateHandlerContract(sampleSpec, {
        typesImport: './types',
        contextImport: './context',
        contextTypeName: 'ProductContext',
      })

      expect(contract).toContain("import type { ProductContext } from './context'")
      expect(contract).toContain('export interface GetUserContext<TContext = ProductContext> {')
      expect(contract).toContain('export type GetUserHandler<TContext = ProductContext> = (')
      expect(contract).toContain('export interface ApiHandlers<TContext = ProductContext> {')
    })
  })

  describe('Fastify Binder (fastify.ts)', () => {
    it('emits ApiRouterOptions with generic TContext, getContext extractor, and context forwarding', () => {
      const code = generateRouter(sampleSpec, {
        target: 'fastify',
        contractImport: './api.contract',
        contextInjection: true,
      } as any)

      expect(code).toContain('export interface ApiRouterOptions<TContext = unknown> {')
      expect(code).toContain('  handlers: ApiHandlers<TContext>')
      expect(code).toContain('  getContext?: (req: FastifyRequest) => Promise<TContext> | TContext')
      expect(code).toContain('  context?: TContext')
      expect(code).toContain('export const apiRouter: FastifyPluginAsync<ApiRouterOptions<any>> = async (fastify, options) => {')
      expect(code).toContain('const context = getContext ? await getContext(request) : staticContext')
      expect(code).toContain('...(context !== undefined ? { context } : {})')
    })

    it('supports contextImport and contextTypeName in Fastify options', () => {
      const code = generateRouter(sampleSpec, {
        target: 'fastify',
        contractImport: './api.contract',
        contextImport: './context',
        contextTypeName: 'FastifyAppContext',
      } as any)

      expect(code).toContain("import type { FastifyAppContext } from './context'")
      expect(code).toContain('export interface ApiRouterOptions<TContext = FastifyAppContext> {')
    })
  })

  describe('Elysia Binder (elysia.ts)', () => {
    it('emits ElysiaRouterOptions with generic TContext, getContext extractor, and context forwarding', () => {
      const code = generateRouter(sampleSpec, {
        target: 'elysia',
        contractImport: './api.contract',
        contextInjection: true,
      } as any)

      expect(code).toContain('export interface ElysiaRouterOptions<TContext = unknown> {')
      expect(code).toContain('  getContext?: (ctx: any) => Promise<TContext> | TContext')
      expect(code).toContain('  context?: TContext')
      expect(code).toContain('export function createRouter<TContext = unknown>(')
      expect(code).toContain('  handlers: ApiHandlers<TContext>,')
      expect(code).toContain('  options?: ElysiaRouterOptions<TContext>,')
      expect(code).toContain('const context = getContext ? await getContext({')
      expect(code).toContain('...(context !== undefined ? { context } : {})')
    })

    it('supports contextImport and contextTypeName in Elysia options', () => {
      const code = generateRouter(sampleSpec, {
        target: 'elysia',
        contractImport: './api.contract',
        contextImport: './context',
        contextTypeName: 'ElysiaAppContext',
      } as any)

      expect(code).toContain("import type { ElysiaAppContext } from './context'")
      expect(code).toContain('export interface ElysiaRouterOptions<TContext = ElysiaAppContext> {')
      expect(code).toContain('export function createRouter<TContext = ElysiaAppContext>(')
    })
  })

  describe('Hono Binder (hono.ts)', () => {
    it('emits HonoRouterOptions with generic TContext, getContext extractor, and context forwarding', () => {
      const code = generateRouter(sampleSpec, {
        target: 'hono',
        contractImport: './api.contract',
        contextInjection: true,
      } as any)

      expect(code).toContain('export interface HonoRouterOptions<TContext = unknown> {')
      expect(code).toContain('  getContext?: (c: Context) => Promise<TContext> | TContext')
      expect(code).toContain('  context?: TContext')
      expect(code).toContain('export function createRouter<TContext = unknown>(')
      expect(code).toContain('  handlers: ApiHandlers<TContext>,')
      expect(code).toContain('  options?: HonoRouterOptions<TContext>,')
      expect(code).toContain('const context = getContext ? await getContext(c) : staticContext')
      expect(code).toContain('...(context !== undefined ? { context } : {})')
    })
  })

  describe('Express Binder (express.ts)', () => {
    it('emits ExpressRouterOptions with generic TContext, getContext extractor, and context forwarding', () => {
      const code = generateRouter(sampleSpec, {
        target: 'express',
        contractImport: './api.contract',
        contextInjection: true,
      } as any)

      expect(code).toContain("import type { Request } from 'express'")
      expect(code).toContain('export interface ExpressRouterOptions<TContext = unknown> {')
      expect(code).toContain('  getContext?: (req: Request) => Promise<TContext> | TContext')
      expect(code).toContain('  context?: TContext')
      expect(code).toContain('export function createRouter<TContext = unknown>(')
      expect(code).toContain('  handlers: ApiHandlers<TContext>,')
      expect(code).toContain('  options?: ExpressRouterOptions<TContext>,')
      expect(code).toContain('const context = getContext ? await getContext(req) : staticContext')
      expect(code).toContain('...(context !== undefined ? { context } : {})')
    })
  })

  describe('End-to-End Strict TypeScript Compilation (Decoupled Portability)', () => {
    it('compiles cleanly under tsc --strict with shared product context across Fastify, Elysia, Hono, and Express', () => {
      const testDir = join(tmpDir, 'e2e-portability')
      mkdirSync(testDir, { recursive: true })

      // 1. Write product context definition
      writeFileSync(
        join(testDir, 'context.ts'),
        [
          'export interface AppContext {',
          '  tenantId: string',
          '  user: { id: string; role: string }',
          '  requestId: string',
          '}',
        ].join('\n'),
        'utf8',
      )

      // 2. Write types.ts
      writeFileSync(
        join(testDir, 'types.ts'),
        [
          'export interface GetUserPathParams { id: string }',
          'export interface GetUserQueryParams { fields?: string }',
          'export interface GetUserResponse { id: string; name: string; tenantId?: string }',
          'export interface CreateUserBody { name: string }',
          'export interface CreateUserResponse { id: string; name: string }',
          'export interface OnUserEventBody { event: string }',
        ].join('\n'),
        'utf8',
      )

      // 3. Write contract.ts specializing with AppContext
      const contractCode = generateHandlerContract(sampleSpec, {
        typesImport: './types',
        contextImport: './context',
        contextTypeName: 'AppContext',
      })
      writeFileSync(join(testDir, 'api.contract.ts'), contractCode, 'utf8')

      // 4. Generate all 4 target routers with context injection
      const fastifyCode = generateRouter(sampleSpec, {
        target: 'fastify',
        contractImport: './api.contract',
        contextImport: './context',
        contextTypeName: 'AppContext',
      } as any)
      writeFileSync(join(testDir, 'fastify-router.ts'), fastifyCode, 'utf8')

      const elysiaCode = generateRouter(sampleSpec, {
        target: 'elysia',
        contractImport: './api.contract',
        contextImport: './context',
        contextTypeName: 'AppContext',
      } as any)
      writeFileSync(join(testDir, 'elysia-router.ts'), elysiaCode, 'utf8')

      const honoCode = generateRouter(sampleSpec, {
        target: 'hono',
        contractImport: './api.contract',
        contextImport: './context',
        contextTypeName: 'AppContext',
      } as any)
      writeFileSync(join(testDir, 'hono-router.ts'), honoCode, 'utf8')

      const expressCode = generateRouter(sampleSpec, {
        target: 'express',
        contractImport: './api.contract',
        contextImport: './context',
        contextTypeName: 'AppContext',
      } as any)
      writeFileSync(join(testDir, 'express-router.ts'), expressCode, 'utf8')

      // 5. Write ambient type declarations for Fastify, Elysia, Hono, Express
      writeFileSync(
        join(testDir, 'fastify.d.ts'),
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
          '    fastify: FastifyInstance,',
          '    options: Options,',
          '  ) => Promise<void>',
          '  export interface FastifyInstance {',
          '    get(url: string, handler: RouteHandler): void',
          '    get(url: string, opts: { schema?: any }, handler: RouteHandler): void',
          '    post(url: string, handler: RouteHandler): void',
          '    post(url: string, opts: { schema?: any }, handler: RouteHandler): void',
          '    route(opts: any): void',
          '  }',
          '}',
        ].join('\n'),
        'utf8',
      )

      writeFileSync(
        join(testDir, 'elysia.d.ts'),
        [
          "declare module 'elysia' {",
          '  export interface Context {',
          '    params?: unknown',
          '    query?: unknown',
          '    headers?: unknown',
          '    body?: unknown',
          '    request: { url: string }',
          '    set: {',
          '      status?: number',
          '      headers: Record<string, string>',
          '    }',
          '  }',
          '  export class Elysia {',
          '    get(path: string, handler: (ctx: any) => Promise<any>): this',
          '    post(path: string, handler: (ctx: any) => Promise<any>): this',
          '    route(method: string, path: string, handler: (ctx: any) => Promise<any>): this',
          '  }',
          '}',
        ].join('\n'),
        'utf8',
      )

      writeFileSync(
        join(testDir, 'hono.d.ts'),
        [
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
          '    on(method: string, path: string, handler: (c: Context) => Promise<any> | any): this',
          '  }',
          '}',
        ].join('\n'),
        'utf8',
      )

      writeFileSync(
        join(testDir, 'express.d.ts'),
        [
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
          '    put(path: string, ...handlers: RequestHandler[]): this',
          '    delete(path: string, ...handlers: RequestHandler[]): this',
          '    all(path: string, ...handlers: RequestHandler[]): this',
          '  }',
          '  export function Router(): Router',
          '}',
        ].join('\n'),
        'utf8',
      )

      // 6. Write implementation: pure handlers with AppContext, completely decoupled from any framework!
      writeFileSync(
        join(testDir, 'handlers.ts'),
        [
          "import type { ApiHandlers } from './api.contract'",
          "import type { AppContext } from './context'",
          '',
          'export const handlers: ApiHandlers<AppContext> = {',
          '  getUser: async (ctx) => {',
          '    const tenantId = ctx.context?.tenantId ?? "default"',
          '    return {',
          '      id: ctx.params.id,',
          '      name: `User-${ctx.params.id}`,',
          '      tenantId,',
          '    }',
          '  },',
          '  createUser: async (ctx) => {',
          '    const actor = ctx.context?.user.id ?? "anonymous"',
          '    return {',
          '      id: "new-user-id",',
          '      name: `Created by ${actor}`,',
          '    }',
          '  },',
          '  onUserEvent: async (ctx) => {',
          '    void ctx.context?.requestId',
          '    return { received: true }',
          '  },',
          '}',
        ].join('\n'),
        'utf8',
      )

      // 7. Write index.ts mounting the SAME handlers across Fastify, Elysia, Hono, and Express
      writeFileSync(
        join(testDir, 'index.ts'),
        [
          "import type { AppContext } from './context'",
          "import { handlers } from './handlers'",
          "import { apiRouter as fastifyRouter } from './fastify-router'",
          "import createElysiaRouter from './elysia-router'",
          "import createHonoRouter from './hono-router'",
          "import createExpressRouter from './express-router'",
          '',
          'const sampleContext: AppContext = {',
          "  tenantId: 'tenant-42',",
          "  user: { id: 'usr-1', role: 'admin' },",
          "  requestId: 'req-abc-123',",
          '}',
          '',
          '// Mount in Fastify',
          'declare const fastify: any',
          'void fastifyRouter(fastify, {',
          '  handlers,',
          '  getContext: async (_req) => sampleContext,',
          '})',
          '',
          '// Mount in Elysia',
          'const elysiaApp = createElysiaRouter(handlers, {',
          '  getContext: async (_ctx) => sampleContext,',
          '})',
          'void elysiaApp',
          '',
          '// Mount in Hono',
          'const honoApp = createHonoRouter(handlers, {',
          '  getContext: async (_c) => sampleContext,',
          '})',
          'void honoApp',
          '',
          '// Mount in Express',
          'const expressRouter = createExpressRouter(handlers, {',
          '  getContext: async (_req) => sampleContext,',
          '})',
          'void expressRouter',
        ].join('\n'),
        'utf8',
      )

      // 8. tsconfig.json with strict checks
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

      expect(() => runTsc(testDir)).not.toThrow()
    })
  })
})
