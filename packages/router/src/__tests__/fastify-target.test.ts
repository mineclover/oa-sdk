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

const tmpDir = resolve(__dirname, '../../.tmp-fastify-target-test')

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

function doc(overrides: Partial<OasDocument> = {}): OasDocument {
  return { openapi: '3.2.0', info: { title: 'T', version: '0' }, paths: {}, ...overrides } as OasDocument
}

describe('Fastify target', () => {
  it('emits FastifyPluginAsync with inlined route schemas for fast-json-stringify JIT', () => {
    const spec = doc({
      paths: {
        '/users/{id}': {
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          get: {
            operationId: 'getUser',
            parameters: [
              { name: 'fields', in: 'query', schema: { type: 'string' } },
            ],
            responses: {
              '200': {
                description: 'User',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['id', 'name'],
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['name'],
                    properties: {
                      name: { type: 'string' },
                    },
                  },
                },
              },
            },
            responses: {
              '201': {
                description: 'Created',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { id: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    const code = generateRouter(spec, { target: 'fastify' })

    expect(code).toContain("import type { FastifyPluginAsync } from 'fastify'")
    expect(code).toContain("export const apiRouter: FastifyPluginAsync = async (fastify) => {")
    expect(code).toContain("export default apiRouter")

    // Inlined schemas
    expect(code).toContain('"params": {')
    expect(code).toContain('"querystring": {')
    expect(code).toContain('"body": {')
    expect(code).toContain('"response": {')
    expect(code).toContain('"200": {')
    expect(code).toContain('"201": {')

    // Standard methods
    expect(code).toContain("fastify.get('/users/:id'")
    expect(code).toContain("fastify.post('/users'")
  })

  it('supports OAS 3.2 non-standard verbs (QUERY, HEAD, TRACE) via fastify.route', () => {
    const spec = doc({
      paths: {
        '/users/search': {
          query: {
            operationId: 'searchUsers',
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { q: { type: 'string' } } },
                },
              },
            },
            responses: { '200': { description: 'Results' } },
          },
          trace: {
            operationId: 'traceUsers',
            responses: { '200': { description: 'Trace' } },
          },
          head: {
            operationId: 'headUsers',
            responses: { '200': { description: 'Headers' } },
          },
        },
      },
    })

    const code = generateRouter(spec, { target: 'fastify' })

    // head is convenience method in fastify
    expect(code).toContain("fastify.head('/users/search'")

    // QUERY and TRACE use fastify.route
    expect(code).toContain("method: 'QUERY'")
    expect(code).toContain("method: 'TRACE'")
    expect(code).toContain("fastify.route({")
  })

  it('supports contract binding mode with ApiHandlers', () => {
    const spec = doc({
      paths: {
        '/items/{id}': {
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          get: {
            operationId: 'getItem',
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    })

    const code = generateRouter(spec, {
      target: 'fastify',
      contractImport: './api.contract',
    })

    expect(code).toContain("import type { ApiHandlers } from './api.contract'")
    expect(code).toContain("export interface ApiRouterOptions {")
    expect(code).toContain("handlers: ApiHandlers")
    expect(code).toContain("export const apiRouter: FastifyPluginAsync<ApiRouterOptions> = async (fastify, options) => {")
    expect(code).toContain("const { handlers } = options")
    expect(code).toContain("const result = await handlers.getItem({ params: request.params as any })")
  })

  it('compiles cleanly under tsc --strict with ambient Fastify declarations and real handlers', () => {
    const spec = doc({
      paths: {
        '/users/{id}': {
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          get: {
            operationId: 'getUser',
            responses: {
              '200': {
                description: 'User',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { id: { type: 'string' }, name: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
        '/users/search': {
          query: {
            operationId: 'searchUsers',
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { q: { type: 'string' } } },
                },
              },
            },
            responses: { '200': { description: 'Results' } },
          },
        },
      },
    })

    // Write contract
    writeFileSync(join(tmpDir, 'api.contract.ts'), generateHandlerContract(spec), 'utf8')

    // Write Fastify router
    const routerCode = generateRouter(spec, {
      target: 'fastify',
      contractImport: './api.contract',
    })
    writeFileSync(join(tmpDir, 'router.ts'), routerCode, 'utf8')

    // Write ambient fastify.d.ts
    writeFileSync(join(tmpDir, 'fastify.d.ts'), [
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
      '    put(url: string, handler: RouteHandler): void',
      '    put(url: string, opts: { schema?: any }, handler: RouteHandler): void',
      '    delete(url: string, handler: RouteHandler): void',
      '    delete(url: string, opts: { schema?: any }, handler: RouteHandler): void',
      '    patch(url: string, handler: RouteHandler): void',
      '    patch(url: string, opts: { schema?: any }, handler: RouteHandler): void',
      '    head(url: string, handler: RouteHandler): void',
      '    head(url: string, opts: { schema?: any }, handler: RouteHandler): void',
      '    options(url: string, handler: RouteHandler): void',
      '    options(url: string, opts: { schema?: any }, handler: RouteHandler): void',
      '    route(opts: { method: string; url: string; schema?: any; handler: RouteHandler }): void',
      '  }',
      '}',
    ].join('\n'), 'utf8')

    // Write handlers implementation and usage
    writeFileSync(join(tmpDir, 'index.ts'), [
      "import type { ApiHandlers } from './api.contract'",
      "import apiRouter from './router'",
      '',
      'const handlers: ApiHandlers = {',
      '  getUser: async (ctx) => ({',
      '    id: ctx.params.id,',
      "    name: 'Alice',",
      '  }),',
      '  searchUsers: async () => ({ results: [] }),',
      '}',
      '',
      'void apiRouter',
      'void handlers',
    ].join('\n'), 'utf8')

    // Write tsconfig.json
    writeFileSync(join(tmpDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: 'ESNext',
        moduleResolution: 'bundler',
        target: 'ES2022',
        skipLibCheck: true,
      },
      include: ['fastify.d.ts', 'api.contract.ts', 'router.ts', 'index.ts'],
    }), 'utf8')

    expect(() => runTsc(tmpDir)).not.toThrow()
  })
})
