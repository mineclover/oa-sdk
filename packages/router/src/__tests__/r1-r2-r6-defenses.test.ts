import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import type { OasDocument } from '@oa-sdk/parser'
import { generateRouter, generateHandlerContract } from '../generate-router.js'
import type { RouterRenderOptions } from '../generate-router-renderer.js'
import type { HandlerResponse } from '../contracts/handler-contract.js'

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

const tmpDir = resolve(__dirname, '../../.tmp-r1-r2-r6-defenses-test')

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
})

function createSampleSpec(): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Collision & Error Defense API', version: '1.0.0' },
    paths: {
      '/orders/{id}': {
        get: {
          operationId: 'getOrder',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Order details',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['id', 'status', 'total'],
                    properties: {
                      id: { type: 'string' },
                      status: { type: 'string' },
                      total: { type: 'number' },
                    },
                  },
                },
              },
            },
            '404': {
              description: 'Order not found',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['code', 'message'],
                    properties: {
                      code: { type: 'string' },
                      message: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        delete: {
          operationId: 'cancelOrder',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '204': {
              description: 'Order cancelled, no content',
            },
          },
        },
      },
      '/articles': {
        post: {
          operationId: 'createArticle',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title', 'body', 'status'],
                  properties: {
                    title: { type: 'string' },
                    body: { type: 'string' },
                    status: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Created article',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['id', 'body', 'status'],
                    properties: {
                      id: { type: 'string' },
                      body: { type: 'string' },
                      status: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/audits': {
        get: {
          operationId: 'getAuditLog',
          responses: {
            '200': {
              description: 'Audit log record',
              headers: {
                'X-Request-Id': { schema: { type: 'string' } },
              },
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['id', 'headers'],
                    properties: {
                      id: { type: 'string' },
                      headers: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  } as OasDocument
}

describe('R1: Router Response Envelope Collision Defense', () => {
  const targets = ['fastify', 'elysia', 'hono', 'express'] as const
  const strictPredicateSnippet =
    "result !== undefined && result !== null && typeof result === 'object' && 'body' in result && ((result as any).status === undefined || typeof (result as any).status === 'number') && ((result as any).headers === undefined || typeof (result as any).headers === 'object')"

  it('emits the strict 3-part envelope predicate across all 4 router targets', () => {
    const spec = createSampleSpec()
    for (const target of targets) {
      const code = generateRouter(spec, {
        target,
        contractImport: './api.contract',
      })
      expect(code).toContain(strictPredicateSnippet)
    }
  })

  it('preserves 204 no-content handling when envelope status is 204 across all targets', () => {
    const spec = createSampleSpec()
    const fastifyCode = generateRouter(spec, { target: 'fastify', contractImport: './api.contract' })
    expect(fastifyCode).toContain('if (resp.status === 204) return reply.status(204).send()')

    const elysiaCode = generateRouter(spec, { target: 'elysia', contractImport: './api.contract' })
    expect(elysiaCode).toContain('if (resp.status === 204) return')

    const honoCode = generateRouter(spec, { target: 'hono', contractImport: './api.contract' })
    expect(honoCode).toContain('if (resp.status === 204) return c.body(null, 204)')

    const expressCode = generateRouter(spec, { target: 'express', contractImport: './api.contract' })
    expect(expressCode).toContain('if (resp.status === 204) return res.status(204).end()')
  })

  it('strictly classifies business entities vs HTTP response envelopes', () => {
    // Pure logic function replicating the emitted condition
    function isEnvelope(result: unknown): result is { status?: number; headers?: Record<string, string>; body?: unknown } {
      return (
        result !== undefined &&
        result !== null &&
        typeof result === 'object' &&
        'body' in result &&
        ((result as any).status === undefined || typeof (result as any).status === 'number') &&
        ((result as any).headers === undefined || typeof (result as any).headers === 'object')
      )
    }

    // 1. Domain entities with status: string MUST NOT be envelopes
    const orderEntity = { id: 'order_1', status: 'PENDING', total: 5000 }
    expect(isEnvelope(orderEntity)).toBe(false)

    const userEntity = { status: 'ACTIVE' }
    expect(isEnvelope(userEntity)).toBe(false)

    // 2. Domain entities with headers: string MUST NOT be envelopes
    const auditEntity = { id: 'msg_1', headers: 'MIME-Version: 1.0' }
    expect(isEnvelope(auditEntity)).toBe(false)

    // 3. Domain entities with body: string AND status: string MUST NOT be envelopes
    const articleEntity = { id: 'post_1', body: '# Hello World', status: 'DRAFT' }
    expect(isEnvelope(articleEntity)).toBe(false)

    // 4. Domain entities with body: string AND headers: string MUST NOT be envelopes
    const rawEmailEntity = { body: 'Content...', headers: 'Host: test' }
    expect(isEnvelope(rawEmailEntity)).toBe(false)

    // 5. Valid HTTP envelopes MUST be recognized
    const envelope200 = { status: 200, body: orderEntity }
    expect(isEnvelope(envelope200)).toBe(true)

    const envelopeWithHeaders = { status: 200, headers: { 'X-Custom': '1' }, body: orderEntity }
    expect(isEnvelope(envelopeWithHeaders)).toBe(true)

    const envelope404 = { status: 404, body: { code: 'NOT_FOUND', message: 'Missing order' } }
    expect(isEnvelope(envelope404)).toBe(true)

    const envelope204 = { status: 204, body: null }
    expect(isEnvelope(envelope204)).toBe(true)

    const envelopeBareBody = { body: orderEntity }
    expect(isEnvelope(envelopeBareBody)).toBe(true)
  })
})

describe('R2: Handler Contract Multi-Status & Error Response Type Union', () => {
  it('generates the multi-status discriminated union HandlerResponse definition', () => {
    const spec = createSampleSpec()
    const contract = generateHandlerContract(spec)

    expect(contract).toContain(
      'export type HandlerResponse<TSuccess = unknown, TErrorMap = Record<number, unknown>, THeaders = Record<string, string>> ='
    )
    expect(contract).toContain('| TSuccess')
    expect(contract).toContain('| { status: 200; body: TSuccess; headers?: THeaders }')
    expect(contract).toContain(
      '| { [K in keyof TErrorMap]: { status: K; body: TErrorMap[K]; headers?: Record<string, string> } }[keyof TErrorMap]'
    )
  })

  it('allows returning typed error responses without any "as any" cast', () => {
    type Order = { id: string; status: string; total: number }
    type OrderNotFoundError = { code: 'NOT_FOUND'; message: string }
    type OrderServerError = { code: 'INTERNAL_ERROR'; details: string[] }

    type OrderHandlerResponse = HandlerResponse<
      Order,
      {
        404: OrderNotFoundError
        500: OrderServerError
      }
    >

    // 1. Returning success body directly
    const r1: OrderHandlerResponse = { id: 'order_1', status: 'PENDING', total: 100 }
    expect(r1).toBeDefined()

    // 2. Returning status 200 envelope
    const r2: OrderHandlerResponse = {
      status: 200,
      body: { id: 'order_1', status: 'COMPLETED', total: 200 },
      headers: { 'x-correlation-id': 'abc' },
    }
    expect(r2.status).toBe(200)

    // 3. Returning status 404 error envelope with 100% type safety and zero "as any"
    const r3: OrderHandlerResponse = {
      status: 404,
      body: { code: 'NOT_FOUND', message: 'Order does not exist' },
    }
    expect(r3.status).toBe(404)

    // 4. Returning status 500 error envelope
    const r4: OrderHandlerResponse = {
      status: 500,
      body: { code: 'INTERNAL_ERROR', details: ['Database connection timeout'] },
    }
    expect(r4.status).toBe(500)
  })

  it('provides open error typing with default TErrorMap = Record<number, unknown>', () => {
    type Order = { id: string; status: string; total: number }
    type DefaultResponse = HandlerResponse<Order>

    // Open error responses for arbitrary HTTP status codes
    const r404: DefaultResponse = { status: 404, body: { error: 'Not found' } }
    const r403: DefaultResponse = { status: 403, body: { error: 'Forbidden' } }
    const r418: DefaultResponse = { status: 418, body: 'I am a teapot' }

    expect(r404.status).toBe(404)
    expect(r403.status).toBe(403)
    expect(r418.status).toBe(418)
  })
})

describe('R6: Router Render Options & Facade Typing Integrity', () => {
  it('accepts contextInjection, context, contextImport, and contextTypeName without as any', () => {
    const spec = createSampleSpec()

    // 1. contextInjection: true
    const opts1: RouterRenderOptions = {
      target: 'fastify',
      contractImport: './api.contract',
      contextInjection: true,
    }
    const code1 = generateRouter(spec, opts1)
    expect(code1).toContain('getContext')

    // 2. context: true shorthand
    const opts2: RouterRenderOptions = {
      target: 'elysia',
      contractImport: './api.contract',
      context: true,
    }
    const code2 = generateRouter(spec, opts2)
    expect(code2).toContain('getContext')

    // 3. contextImport and contextTypeName
    const opts3: RouterRenderOptions = {
      target: 'hono',
      contractImport: './api.contract',
      contextImport: './context',
      contextTypeName: 'AppSecurityContext',
    }
    const code3 = generateRouter(spec, opts3)
    expect(code3).toContain('AppSecurityContext')

    // 4. Express with all options
    const opts4: RouterRenderOptions = {
      target: 'express',
      contractImport: './api.contract',
      contextInjection: true,
      contextImport: './context',
      contextTypeName: 'ExpressAppContext',
    }
    const code4 = generateRouter(spec, opts4)
    expect(code4).toContain('ExpressAppContext')
  })
})

describe('End-to-End TypeScript Verification (tsc --strict)', () => {
  it('compiles all 4 framework routers with collision defense entities and typed error returns', () => {
    const spec = createSampleSpec()
    const testDir = join(tmpDir, 'full-verification')
    mkdirSync(testDir, { recursive: true })

    // Generate contract
    const contractCode = generateHandlerContract(spec, {
      contractName: 'ApiHandlers',
    })
    writeFileSync(join(testDir, 'api.contract.ts'), contractCode, 'utf8')

    // Generate Fastify, Elysia, Hono, Express routers
    for (const target of ['fastify', 'elysia', 'hono', 'express'] as const) {
      const routerCode = generateRouter(spec, {
        target,
        contractImport: './api.contract',
      })
      writeFileSync(join(testDir, `${target}-router.ts`), routerCode, 'utf8')
    }

    // Concrete handler implementation demonstrating:
    // 1. Entity with status: string falling through to 200 without collision
    // 2. Entity with body: string falling through to 200 without collision
    // 3. Entity with headers: string falling through to 200 without collision
    // 4. Returning typed 404 error envelope with zero as any
    // 5. Returning 204 no-content envelope
    const handlersCode = `
import type { ApiHandlers } from './api.contract';

export const handlers: ApiHandlers = {
  getOrder: async (ctx) => {
    if (ctx.params.id === 'missing') {
      // Returning typed 404 error without as any!
      return {
        status: 404,
        body: { code: 'NOT_FOUND', message: 'Order not found' },
      };
    }
    // Business entity with status: string!
    return {
      id: ctx.params.id,
      status: 'PENDING',
      total: 10000,
    };
  },

  cancelOrder: async () => {
    // 204 No Content
    return {
      status: 204,
      body: undefined,
    };
  },

  createArticle: async () => {
    // Business entity with body: string and status: string!
    return {
      id: 'article_99',
      body: 'Detailed markdown content here',
      status: 'PUBLISHED',
    };
  },

  getAuditLog: async () => {
    // Business entity with headers: string!
    return {
      id: 'audit_1',
      headers: 'X-Forwarded-For: 127.0.0.1',
    };
  },
};
`
    writeFileSync(join(testDir, 'handlers.ts'), handlersCode, 'utf8')

    // Ambient framework declarations
    const ambientDts = `
declare module 'fastify' {
  export interface FastifyRequest {
    params: unknown;
    query: unknown;
    headers: unknown;
    body: unknown;
    raw: { url?: string };
    url: string;
  }
  export interface FastifyReply {
    status(code: number): this;
    header(name: string, value: string): this;
    send(payload?: unknown): this;
  }
  export type RouteHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<any> | any;
  export interface FastifyInstance {
    get(path: string, handler: RouteHandler): void;
    get(path: string, opts: { schema?: any }, handler: RouteHandler): void;
    post(path: string, handler: RouteHandler): void;
    post(path: string, opts: { schema?: any }, handler: RouteHandler): void;
    delete(path: string, handler: RouteHandler): void;
    delete(path: string, opts: { schema?: any }, handler: RouteHandler): void;
  }
  export type FastifyPluginAsync<TOptions = any> = (
    fastify: FastifyInstance,
    options: TOptions
  ) => Promise<void>;
}

declare module 'elysia' {
  export interface Context {
    params?: any;
    query?: any;
    headers?: any;
    body?: any;
    request: { url: string };
    set: { status?: number; headers: Record<string, string> };
  }
  export class Elysia {
    constructor(options?: any);
    get(path: string, handler: (ctx: Context) => any): this;
    post(path: string, handler: (ctx: Context) => any): this;
    delete(path: string, handler: (ctx: Context) => any): this;
  }
  export default Elysia;
}

declare module 'hono' {
  export interface Context {
    req: {
      param(key?: string): any;
      query(key?: string): any;
      header(key?: string): any;
      raw: { url?: string; body?: any };
      json(): Promise<any>;
    };
    header(name: string, value: string): void;
    status(code: number): void;
    body(data: any, status?: number): Response;
    json(data: any, status?: number): Response;
  }
  export class Hono {
    get(path: string, handler: (c: Context) => any): this;
    post(path: string, handler: (c: Context) => any): this;
    delete(path: string, handler: (c: Context) => any): this;
  }
}

declare module 'express' {
  export interface Request {
    params: any;
    query: any;
    headers: any;
    body: any;
    originalUrl?: string;
    url: string;
    method: string;
  }
  export interface Response {
    status(code: number): this;
    setHeader(name: string, value: string): this;
    json(data?: unknown): this;
    end(): this;
  }
  export type RequestHandler = (req: Request, res: Response, next?: any) => any;
  export interface Router {
    get(path: string, ...handlers: RequestHandler[]): this;
    post(path: string, ...handlers: RequestHandler[]): this;
    delete(path: string, ...handlers: RequestHandler[]): this;
  }
  export function Router(): Router;
}
`
    writeFileSync(join(testDir, 'ambient.d.ts'), ambientDts, 'utf8')

    // Router mounting consumer verifying everything wires together cleanly
    const mountCode = `
import apiRouter from './fastify-router';
import { createRouter as createElysiaRouter } from './elysia-router';
import { createRouter as createHonoRouter } from './hono-router';
import { createRouter as createExpressRouter } from './express-router';
import { handlers } from './handlers';

export async function mountAll(fastifyInstance: any) {
  await apiRouter(fastifyInstance, { handlers });
  const elysia = createElysiaRouter(handlers);
  const hono = createHonoRouter(handlers);
  const express = createExpressRouter(handlers);
  return { elysia, hono, express };
}
`
    writeFileSync(join(testDir, 'mount.ts'), mountCode, 'utf8')

    // tsconfig.json with strict checks
    writeFileSync(
      join(testDir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            noUnusedLocals: true,
            noUnusedParameters: true,
            noEmit: true,
            // The ambient framework shims below stand in for runtime packages; the real Elysia
            // 1.4 declarations use syntax that TypeScript 5.9 rejects inside its own .d.ts.
            skipLibCheck: true,
          },
        },
        null,
        2
      ),
      'utf8'
    )

    // Execute tsc --noEmit to verify zero errors
    expect(() => runTsc(testDir)).not.toThrow()
  })
})
