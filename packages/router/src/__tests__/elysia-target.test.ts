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
  execFileSync(process.execPath, [tscBin, '--noEmit'], {
    cwd,
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

const tmpDir = resolve(__dirname, '../../.tmp-elysia-target-test')

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

function doc(overrides: Partial<OasDocument> = {}): OasDocument {
  return { openapi: '3.2.0', info: { title: 'T', version: '0' }, paths: {}, ...overrides } as OasDocument
}

describe('Bun Elysia target', () => {
  it('emits chained new Elysia().get().post() builder with selective zero-copy destructuring', () => {
    const spec = doc({
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            parameters: [
              { name: 'limit', in: 'query', schema: { type: 'integer' } },
            ],
            responses: { '200': { description: 'OK' } },
          },
          post: {
            operationId: 'createUser',
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { type: 'object' } } },
            },
            responses: { '201': { description: 'Created' } },
          },
        },
        '/users/{id}': {
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          get: {
            operationId: 'getUser',
            responses: { '200': { description: 'OK' } },
          },
        },
        '/ping': {
          get: {
            operationId: 'pingServer',
            responses: { '204': { description: 'No Content' } },
          },
        },
      },
    })

    const code = generateRouter(spec, { target: 'elysia' })

    expect(code).toContain("import { Elysia } from 'elysia'")
    expect(code).toContain("export const app = new Elysia()")
    expect(code).toContain("export default app")

    // Selective destructuring:
    // listUsers only uses query: { query, set }
    expect(code).toContain(".get('/users', async ({ query, set }) => {")
    // createUser only uses body: { body, set }
    expect(code).toContain(".post('/users', async ({ body, set }) => {")
    // getUser only uses params: { params, set }
    expect(code).toContain(".get('/users/:id', async ({ params, set }) => {")
    // pingServer uses no params/body/query: { set }
    expect(code).toContain(".get('/ping', async ({ set }) => {")
  })

  it('supports OAS 3.2 verbs (QUERY, TRACE) via .route() method chaining', () => {
    const spec = doc({
      paths: {
        '/search': {
          query: {
            operationId: 'searchItems',
            requestBody: {
              content: { 'application/json': { schema: { type: 'object' } } },
            },
            responses: { '200': { description: 'Results' } },
          },
          trace: {
            operationId: 'traceItems',
            responses: { '200': { description: 'Trace' } },
          },
        },
      },
    })

    const code = generateRouter(spec, { target: 'elysia' })

    expect(code).toContain(".route('QUERY', '/search', async ({ body, set }) => {")
    expect(code).toContain(".route('TRACE', '/search', async ({ set }) => {")
  })

  it('supports contract binding mode with createRouter(handlers: ApiHandlers)', () => {
    const spec = doc({
      paths: {
        '/users/{id}': {
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          get: {
            operationId: 'getUser',
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    })

    const code = generateRouter(spec, {
      target: 'elysia',
      contractImport: './api.contract',
    })

    expect(code).toContain("import type { ApiHandlers } from './api.contract'")
    expect(code).toContain("export function createRouter(handlers: ApiHandlers) {")
    expect(code).toContain("return new Elysia()")
    expect(code).toContain(".get('/users/:id', async ({ params, set }) => {")
    expect(code).toContain("const result = await handlers.getUser({ params: params as any })")
    expect(code).toContain("export default createRouter")
  })

  it('compiles cleanly under tsc --strict with noUnusedLocals and noUnusedParameters', () => {
    const spec = doc({
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            parameters: [
              { name: 'limit', in: 'query', schema: { type: 'integer' } },
            ],
            responses: { '200': { description: 'OK' } },
          },
          post: {
            operationId: 'createUser',
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { type: 'object' } } },
            },
            responses: { '201': { description: 'Created' } },
          },
        },
        '/users/{id}': {
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          get: {
            operationId: 'getUser',
            responses: { '200': { description: 'OK' } },
          },
        },
        '/ping': {
          get: {
            operationId: 'pingServer',
            responses: { '204': { description: 'No Content' } },
          },
        },
      },
    })

    // Write contract
    writeFileSync(join(tmpDir, 'api.contract.ts'), generateHandlerContract(spec), 'utf8')

    // Write Elysia router
    const routerCode = generateRouter(spec, {
      target: 'elysia',
      contractImport: './api.contract',
    })
    writeFileSync(join(tmpDir, 'router.ts'), routerCode, 'utf8')

    // Write ambient elysia.d.ts
    writeFileSync(join(tmpDir, 'elysia.d.ts'), [
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
      '    put(path: string, handler: (ctx: any) => Promise<any>): this',
      '    delete(path: string, handler: (ctx: any) => Promise<any>): this',
      '    patch(path: string, handler: (ctx: any) => Promise<any>): this',
      '    head(path: string, handler: (ctx: any) => Promise<any>): this',
      '    route(method: string, path: string, handler: (ctx: any) => Promise<any>): this',
      '  }',
      '}',
    ].join('\n'), 'utf8')

    // Write index.ts with concrete handlers
    writeFileSync(join(tmpDir, 'index.ts'), [
      "import type { ApiHandlers } from './api.contract'",
      "import createRouter from './router'",
      '',
      'const handlers: ApiHandlers = {',
      '  listUsers: async (ctx) => ({ users: [], limit: ctx?.query?.limit }),',
      '  createUser: async (ctx) => ({ id: "u1", body: ctx.body }),',
      '  getUser: async (ctx) => ({ id: ctx.params.id }),',
      '  pingServer: async () => {},',
      '}',
      '',
      'const app = createRouter(handlers)',
      'void app',
    ].join('\n'), 'utf8')

    // Write tsconfig.json with strict unused variable flags
    writeFileSync(join(tmpDir, 'tsconfig.json'), JSON.stringify({
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
      include: ['elysia.d.ts', 'api.contract.ts', 'router.ts', 'index.ts'],
    }), 'utf8')

    expect(() => runTsc(tmpDir)).not.toThrow()
  })
})
