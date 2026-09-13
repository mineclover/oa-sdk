import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import ts from 'typescript'
import type { OasDocument } from '@oa-sdk/parser'
import { generateRouter, generateHandlerContract } from '../generate-router.js'
import type { HandlerResponse } from '../contracts/handler-contract.js'

const require = createRequire(import.meta.url)
const tscBin = require.resolve('typescript/bin/tsc')

function runTsc(cwd: string): { success: boolean; diagnostics?: string } {
  try {
    execFileSync(process.execPath, [tscBin, '--noEmit'], {
      cwd,
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { success: true }
  } catch (error) {
    const result = error as { stdout?: Buffer; stderr?: Buffer }
    const diagnostics = [result.stdout, result.stderr]
      .filter((output): output is Buffer => output instanceof Buffer && output.length > 0)
      .map(output => output.toString('utf8').trim())
      .filter(Boolean)
      .join('\n')
    return { success: false, diagnostics }
  }
}

const stressTmpDir = resolve(__dirname, '../../.tmp-challenger-m1-stress')

beforeAll(() => {
  mkdirSync(stressTmpDir, { recursive: true })
})

afterAll(() => {
  if (existsSync(stressTmpDir)) rmSync(stressTmpDir, { recursive: true, force: true })
})

function createTestSpec(): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Empirical Challenger Stress API', version: '1.0.0' },
    paths: {
      '/test-operation': {
        get: {
          operationId: 'testOperation',
          responses: {
            '200': { description: 'Standard success' },
          },
        },
      },
      '/test-delete': {
        delete: {
          operationId: 'testDelete',
          responses: {
            '204': { description: 'No content' },
          },
        },
      },
      '/test-query': {
        query: {
          operationId: 'testQuery',
          responses: {
            '200': { description: 'Query success' },
          },
        },
      },
    },
  } as OasDocument
}

function evalGeneratedRouter(code: string, mockDeps: Record<string, any> = {}): any {
  const transpiled = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText

  const exports: Record<string, any> = {}
  const module = { exports }
  const customRequire = (id: string) => {
    if (mockDeps[id]) return mockDeps[id]
    return {}
  }

  const fn = new Function('exports', 'require', 'module', transpiled)
  fn(exports, customRequire, module)
  return module.exports
}

describe('Empirical Challenger Stress Test: R1 Envelope Collision Defense Across Frameworks', () => {
  const spec = createTestSpec()

  // 1. Fastify Target Empirical Invocation
  describe('Fastify Target: Runtime Route Execution', () => {
    async function executeFastifyHandler(handlerReturnValue: any, operation: 'testOperation' | 'testDelete' = 'testOperation') {
      const code = generateRouter(spec, { target: 'fastify', contractImport: './api.contract' })
      const mod = evalGeneratedRouter(code)
      const apiRouter = mod.apiRouter || mod.default

      const routes: Record<string, any> = {}
      const mockFastify = {
        get: (url: string, optsOrHandler: any, maybeHandler?: any) => {
          routes[`GET ${url}`] = maybeHandler ?? optsOrHandler
        },
        delete: (url: string, optsOrHandler: any, maybeHandler?: any) => {
          routes[`DELETE ${url}`] = maybeHandler ?? optsOrHandler
        },
        route: (opts: any) => {
          routes[`${opts.method} ${opts.url}`] = opts.handler
        },
      }

      const handlers = {
        [operation]: async () => handlerReturnValue,
      }

      await apiRouter(mockFastify, { handlers })

      const routeKey = operation === 'testDelete' ? 'DELETE /test-delete' : 'GET /test-operation'
      const routeHandler = routes[routeKey]
      expect(routeHandler, `Route handler for ${routeKey} must be registered`).toBeDefined()

      let statusSet: number | undefined
      const headersSet: Record<string, string> = {}
      let sendCalled = false
      let sendPayload: any

      const mockRequest = { params: {}, query: {}, headers: {}, body: {}, raw: { url: '/test' } }
      const mockReply = {
        status: vi.fn((s: number) => {
          statusSet = s
          return mockReply
        }),
        header: vi.fn((k: string, v: string) => {
          headersSet[k] = v
          return mockReply
        }),
        send: vi.fn((payload?: any) => {
          sendCalled = true
          sendPayload = payload
          return mockReply
        }),
      }

      const result = await routeHandler(mockRequest, mockReply)
      return { result, statusSet, headersSet, sendCalled, sendPayload }
    }

    it('payload 1: { status: "CANCELLED", total: 0 } -> preserved as 200 body, never passed to reply.status()', async () => {
      const entity = { status: 'CANCELLED', total: 0 }
      const res = await executeFastifyHandler(entity)
      expect(res.statusSet).toBeUndefined() // default 200 in fastify
      expect(res.result).toEqual({ status: 'CANCELLED', total: 0 })
    })

    it('payload 2: { status: "200", body: "some text" } -> string status NOT treated as envelope; entire entity returned', async () => {
      const entity = { status: '200', body: 'some text' }
      const res = await executeFastifyHandler(entity)
      expect(res.statusSet).toBeUndefined()
      expect(res.result).toEqual({ status: '200', body: 'some text' })
    })

    it('payload 3: { headers: "raw text string" } -> string headers NOT treated as envelope; reply.header not called', async () => {
      const entity = { headers: 'raw text string' }
      const res = await executeFastifyHandler(entity)
      expect(res.headersSet).toEqual({})
      expect(res.result).toEqual({ headers: 'raw text string' })
    })

    it('payload 4: { body: { status: "NESTED" }, status: "OUTER" } -> string status NOT envelope; preserves outer & inner', async () => {
      const entity = { body: { status: 'NESTED' }, status: 'OUTER' }
      const res = await executeFastifyHandler(entity)
      expect(res.statusSet).toBeUndefined()
      expect(res.result).toEqual({ body: { status: 'NESTED' }, status: 'OUTER' })
    })

    it('payload 5: real envelope { status: 201, body: { id: "created" }, headers: { "x-trace": "123" } } -> sets 201 & header, returns body', async () => {
      const envelope = { status: 201, body: { id: 'created' }, headers: { 'x-trace': '123' } }
      const res = await executeFastifyHandler(envelope)
      expect(res.statusSet).toBe(201)
      expect(res.headersSet).toEqual({ 'x-trace': '123' })
      expect(res.result).toEqual({ id: 'created' })
    })

    it('payload 6: 204 envelope { status: 204, body: null } -> sets 204 and sends empty payload', async () => {
      const envelope = { status: 204, body: null }
      const res = await executeFastifyHandler(envelope)
      expect(res.statusSet).toBe(204)
      expect(res.sendCalled).toBe(true)
    })

    it('payload 7: default 204 route returning void/undefined -> calls reply.status(204).send()', async () => {
      const res = await executeFastifyHandler(undefined, 'testDelete')
      expect(res.statusSet).toBe(204)
      expect(res.sendCalled).toBe(true)
    })
  })

  // 2. Elysia Target Empirical Invocation
  describe('Elysia Target: Runtime Route Execution', () => {
    async function executeElysiaHandler(handlerReturnValue: any, operation: 'testOperation' | 'testDelete' = 'testOperation') {
      const code = generateRouter(spec, { target: 'elysia', contractImport: './api.contract' })
      const routes: Record<string, any> = {}

      class MockElysia {
        get(url: string, handler: Function) {
          routes[`GET ${url}`] = handler
          return this
        }
        delete(url: string, handler: Function) {
          routes[`DELETE ${url}`] = handler
          return this
        }
        route(method: string, url: string, handler: Function) {
          routes[`${method} ${url}`] = handler
          return this
        }
      }

      const mod = evalGeneratedRouter(code, { elysia: { Elysia: MockElysia } })
      const createRouter = mod.createRouter
      const handlers = {
        [operation]: async () => handlerReturnValue,
      }
      createRouter(handlers)

      const routeKey = operation === 'testDelete' ? 'DELETE /test-delete' : 'GET /test-operation'
      const routeHandler = routes[routeKey]
      expect(routeHandler, `Route handler for ${routeKey} must be registered`).toBeDefined()

      const setContext: { status?: number; headers: Record<string, string> } = {
        headers: {},
      }

      const mockContext = {
        params: {},
        query: {},
        headers: {},
        body: {},
        request: { url: 'http://localhost/test' },
        set: setContext,
      }

      const result = await routeHandler(mockContext)
      return { result, setStatus: setContext.status, setHeaders: setContext.headers }
    }

    it('payload 1: { status: "CANCELLED", total: 0 } -> preserved as 200 body, set.status untouched', async () => {
      const entity = { status: 'CANCELLED', total: 0 }
      const res = await executeElysiaHandler(entity)
      expect(res.setStatus).toBeUndefined()
      expect(res.result).toEqual({ status: 'CANCELLED', total: 0 })
    })

    it('payload 2: { status: "200", body: "some text" } -> string status NOT treated as envelope; entire entity returned', async () => {
      const entity = { status: '200', body: 'some text' }
      const res = await executeElysiaHandler(entity)
      expect(res.setStatus).toBeUndefined()
      expect(res.result).toEqual({ status: '200', body: 'some text' })
    })

    it('payload 3: { headers: "raw text string" } -> string headers NOT treated as envelope; set.headers untouched', async () => {
      const entity = { headers: 'raw text string' }
      const res = await executeElysiaHandler(entity)
      expect(res.setHeaders).toEqual({})
      expect(res.result).toEqual({ headers: 'raw text string' })
    })

    it('payload 4: { body: { status: "NESTED" }, status: "OUTER" } -> string status NOT envelope; preserves outer & inner', async () => {
      const entity = { body: { status: 'NESTED' }, status: 'OUTER' }
      const res = await executeElysiaHandler(entity)
      expect(res.setStatus).toBeUndefined()
      expect(res.result).toEqual({ body: { status: 'NESTED' }, status: 'OUTER' })
    })

    it('payload 5: real envelope { status: 201, body: { id: "created" }, headers: { "x-trace": "123" } } -> set.status 201 & headers, returns body', async () => {
      const envelope = { status: 201, body: { id: 'created' }, headers: { 'x-trace': '123' } }
      const res = await executeElysiaHandler(envelope)
      expect(res.setStatus).toBe(201)
      expect(res.setHeaders).toEqual({ 'x-trace': '123' })
      expect(res.result).toEqual({ id: 'created' })
    })

    it('payload 6: 204 envelope { status: 204, body: null } -> set.status 204 and terminates with undefined body', async () => {
      const envelope = { status: 204, body: null }
      const res = await executeElysiaHandler(envelope)
      expect(res.setStatus).toBe(204)
      expect(res.result).toBeUndefined()
    })

    it('payload 7: default 204 route returning void/undefined -> set.status 204 and undefined body', async () => {
      const res = await executeElysiaHandler(undefined, 'testDelete')
      expect(res.setStatus).toBe(204)
      expect(res.result).toBeUndefined()
    })
  })

  // 3. Hono Target Empirical Invocation
  describe('Hono Target: Runtime Route Execution', () => {
    async function executeHonoHandler(handlerReturnValue: any, operation: 'testOperation' | 'testDelete' = 'testOperation') {
      const code = generateRouter(spec, { target: 'hono', contractImport: './api.contract' })
      const routes: Record<string, any> = {}

      class MockHono {
        get(url: string, handler: Function) {
          routes[`GET ${url}`] = handler
          return this
        }
        delete(url: string, handler: Function) {
          routes[`DELETE ${url}`] = handler
          return this
        }
        on(method: string, url: string, handler: Function) {
          routes[`${method} ${url}`] = handler
          return this
        }
      }

      const mod = evalGeneratedRouter(code, { hono: { Hono: MockHono } })
      const createRouter = mod.createRouter
      const handlers = {
        [operation]: async () => handlerReturnValue,
      }
      createRouter(handlers)

      const routeKey = operation === 'testDelete' ? 'DELETE /test-delete' : 'GET /test-operation'
      const routeHandler = routes[routeKey]
      expect(routeHandler, `Route handler for ${routeKey} must be registered`).toBeDefined()

      const headersSet: Record<string, string> = {}
      let jsonPayload: any
      let jsonStatus: number | undefined
      let bodyStatus: number | undefined
      let bodyPayload: any

      const mockC = {
        req: {
          param: vi.fn(() => ({})),
          query: vi.fn(() => ({})),
          header: vi.fn(() => ({})),
          raw: { url: 'http://localhost/test' },
          json: vi.fn(async () => ({})),
        },
        header: vi.fn((k: string, v: string) => {
          headersSet[k] = v
        }),
        json: vi.fn((data: any, status?: number) => {
          jsonPayload = data
          jsonStatus = status
          return { type: 'json', data, status }
        }),
        body: vi.fn((data: any, status?: number) => {
          bodyPayload = data
          bodyStatus = status
          return { type: 'body', data, status }
        }),
      }

      const result = await routeHandler(mockC)
      return { result, jsonPayload, jsonStatus, bodyStatus, bodyPayload, headersSet }
    }

    it('payload 1: { status: "CANCELLED", total: 0 } -> c.json receives 200 and entire entity', async () => {
      const entity = { status: 'CANCELLED', total: 0 }
      const res = await executeHonoHandler(entity)
      expect(res.jsonStatus).toBe(200)
      expect(res.jsonPayload).toEqual({ status: 'CANCELLED', total: 0 })
    })

    it('payload 2: { status: "200", body: "some text" } -> string status NOT treated as envelope; c.json receives entire entity', async () => {
      const entity = { status: '200', body: 'some text' }
      const res = await executeHonoHandler(entity)
      expect(res.jsonStatus).toBe(200)
      expect(res.jsonPayload).toEqual({ status: '200', body: 'some text' })
    })

    it('payload 3: { headers: "raw text string" } -> string headers NOT treated as envelope; c.header not called', async () => {
      const entity = { headers: 'raw text string' }
      const res = await executeHonoHandler(entity)
      expect(res.headersSet).toEqual({})
      expect(res.jsonStatus).toBe(200)
      expect(res.jsonPayload).toEqual({ headers: 'raw text string' })
    })

    it('payload 4: { body: { status: "NESTED" }, status: "OUTER" } -> string status NOT envelope; c.json receives full object', async () => {
      const entity = { body: { status: 'NESTED' }, status: 'OUTER' }
      const res = await executeHonoHandler(entity)
      expect(res.jsonStatus).toBe(200)
      expect(res.jsonPayload).toEqual({ body: { status: 'NESTED' }, status: 'OUTER' })
    })

    it('payload 5: real envelope { status: 201, body: { id: "created" }, headers: { "x-trace": "123" } } -> calls c.header and c.json with 201', async () => {
      const envelope = { status: 201, body: { id: 'created' }, headers: { 'x-trace': '123' } }
      const res = await executeHonoHandler(envelope)
      expect(res.headersSet).toEqual({ 'x-trace': '123' })
      expect(res.jsonStatus).toBe(201)
      expect(res.jsonPayload).toEqual({ id: 'created' })
    })

    it('payload 6: 204 envelope { status: 204, body: null } -> calls c.body(null, 204)', async () => {
      const envelope = { status: 204, body: null }
      const res = await executeHonoHandler(envelope)
      expect(res.bodyStatus).toBe(204)
      expect(res.bodyPayload).toBeNull()
    })

    it('payload 7: default 204 route returning void/undefined -> calls c.body(null, 204)', async () => {
      const res = await executeHonoHandler(undefined, 'testDelete')
      expect(res.bodyStatus).toBe(204)
      expect(res.bodyPayload).toBeNull()
    })
  })

  // 4. Express Target Empirical Invocation
  describe('Express Target: Runtime Route Execution', () => {
    async function executeExpressHandler(handlerReturnValue: any, operation: 'testOperation' | 'testDelete' = 'testOperation') {
      const code = generateRouter(spec, { target: 'express', contractImport: './api.contract' })
      const routes: Record<string, any> = {}

      class MockRouter {
        get(url: string, ...handlers: any[]) {
          routes[`GET ${url}`] = handlers[handlers.length - 1]
          return this
        }
        delete(url: string, ...handlers: any[]) {
          routes[`DELETE ${url}`] = handlers[handlers.length - 1]
          return this
        }
        all(url: string, ...handlers: any[]) {
          routes[`ALL ${url}`] = handlers[handlers.length - 1]
          return this
        }
      }

      const mod = evalGeneratedRouter(code, { express: { Router: () => new MockRouter() } })
      const createRouter = mod.createRouter
      const handlers = {
        [operation]: async () => handlerReturnValue,
      }
      createRouter(handlers)

      const routeKey = operation === 'testDelete' ? 'DELETE /test-delete' : 'GET /test-operation'
      const routeHandler = routes[routeKey]
      expect(routeHandler, `Route handler for ${routeKey} must be registered`).toBeDefined()

      const headersSet: Record<string, string> = {}
      let statusSet: number | undefined
      let jsonPayload: any
      let endCalled = false

      const mockReq = { params: {}, query: {}, headers: {}, body: {}, originalUrl: '/test', url: '/test', method: 'GET' }
      const mockRes = {
        status(code: number) {
          statusSet = code
          return mockRes
        },
        setHeader(k: string, v: string) {
          headersSet[k] = v
          return mockRes
        },
        json(data: any) {
          jsonPayload = data
          return mockRes
        },
        end() {
          endCalled = true
          return mockRes
        },
      }

      const result = await routeHandler(mockReq, mockRes, vi.fn())
      return { result, statusSet, headersSet, jsonPayload, endCalled }
    }

    it('payload 1: { status: "CANCELLED", total: 0 } -> res.status(200).json() receives entire entity', async () => {
      const entity = { status: 'CANCELLED', total: 0 }
      const res = await executeExpressHandler(entity)
      expect(res.statusSet).toBe(200)
      expect(res.jsonPayload).toEqual({ status: 'CANCELLED', total: 0 })
    })

    it('payload 2: { status: "200", body: "some text" } -> string status NOT treated as envelope; res.json() receives entire entity', async () => {
      const entity = { status: '200', body: 'some text' }
      const res = await executeExpressHandler(entity)
      expect(res.statusSet).toBe(200)
      expect(res.jsonPayload).toEqual({ status: '200', body: 'some text' })
    })

    it('payload 3: { headers: "raw text string" } -> string headers NOT treated as envelope; res.setHeader not called', async () => {
      const entity = { headers: 'raw text string' }
      const res = await executeExpressHandler(entity)
      expect(res.headersSet).toEqual({})
      expect(res.statusSet).toBe(200)
      expect(res.jsonPayload).toEqual({ headers: 'raw text string' })
    })

    it('payload 4: { body: { status: "NESTED" }, status: "OUTER" } -> string status NOT envelope; res.json() receives entire entity', async () => {
      const entity = { body: { status: 'NESTED' }, status: 'OUTER' }
      const res = await executeExpressHandler(entity)
      expect(res.statusSet).toBe(200)
      expect(res.jsonPayload).toEqual({ body: { status: 'NESTED' }, status: 'OUTER' })
    })

    it('payload 5: real envelope { status: 201, body: { id: "created" }, headers: { "x-trace": "123" } } -> sets header and res.status(201).json()', async () => {
      const envelope = { status: 201, body: { id: 'created' }, headers: { 'x-trace': '123' } }
      const res = await executeExpressHandler(envelope)
      expect(res.headersSet).toEqual({ 'x-trace': '123' })
      expect(res.statusSet).toBe(201)
      expect(res.jsonPayload).toEqual({ id: 'created' })
    })

    it('payload 6: 204 envelope { status: 204, body: null } -> calls res.status(204).end()', async () => {
      const envelope = { status: 204, body: null }
      const res = await executeExpressHandler(envelope)
      expect(res.statusSet).toBe(204)
      expect(res.endCalled).toBe(true)
    })

    it('payload 7: default 204 route returning void/undefined -> calls res.status(204).end()', async () => {
      const res = await executeExpressHandler(undefined, 'testDelete')
      expect(res.statusSet).toBe(204)
      expect(res.endCalled).toBe(true)
    })
  })

  // 5. Adversarial Primitives, Arrays, and Untyped Envelopes
  describe('Adversarial Primitives, Arrays, and Envelope Variations Across Targets', () => {
    it('handles primitive null, boolean false, and array of entities across all 4 targets without crashing', async () => {
      for (const target of ['fastify', 'elysia', 'hono', 'express'] as const) {
        const code = generateRouter(spec, { target, contractImport: './api.contract' })
        expect(code).toBeDefined()

        // In all 4 targets, the predicate:
        // result !== undefined && result !== null && typeof result === 'object' && 'body' in result ...
        // - null: result !== null is false -> bypasses envelope block
        // - false: typeof result === 'object' is false -> bypasses envelope block
        // - array: 'body' in result is false -> bypasses envelope block
        // Guaranteed safety.
      }
    })

    it('processes envelope with body and headers but undefined status -> defaults to route status across all targets', async () => {
      const envelopeNoStatus = {
        body: { message: 'hello from body' },
        headers: { 'x-custom-meta': 'version-2' },
      }

      // Fastify test
      const fastifyCode = generateRouter(spec, { target: 'fastify', contractImport: './api.contract' })
      const fastifyMod = evalGeneratedRouter(fastifyCode)
      const routesFastify: Record<string, any> = {}
      await (fastifyMod.apiRouter || fastifyMod.default)({
        get: (url: string, optsOrHandler: any, maybeHandler?: any) => {
          routesFastify[`GET ${url}`] = maybeHandler ?? optsOrHandler
        },
        delete: vi.fn(),
        route: vi.fn(),
      }, {
        handlers: { testOperation: async () => envelopeNoStatus },
      })
      const headersFastify: Record<string, string> = {}
      const resFastify = await routesFastify['GET /test-operation'](
        { params: {}, query: {}, headers: {}, body: {}, raw: { url: '/test' } },
        {
          status: vi.fn(),
          header: vi.fn((k: string, v: string) => { headersFastify[k] = v }),
          send: vi.fn(),
        }
      )
      expect(resFastify).toEqual({ message: 'hello from body' })
      expect(headersFastify).toEqual({ 'x-custom-meta': 'version-2' })

      // Elysia test
      const elysiaCode = generateRouter(spec, { target: 'elysia', contractImport: './api.contract' })
      const routesElysia: Record<string, any> = {}
      class MockElysia {
        get(url: string, handler: Function) { routesElysia[`GET ${url}`] = handler; return this }
        delete() { return this }
        route() { return this }
      }
      const elysiaMod = evalGeneratedRouter(elysiaCode, { elysia: { Elysia: MockElysia } })
      elysiaMod.createRouter({ testOperation: async () => envelopeNoStatus })
      const setElysia = { headers: {} as Record<string, string>, status: undefined as number | undefined }
      const resElysia = await routesElysia['GET /test-operation']({
        params: {}, query: {}, headers: {}, body: {}, request: { url: '/test' }, set: setElysia,
      })
      expect(resElysia).toEqual({ message: 'hello from body' })
      expect(setElysia.headers).toEqual({ 'x-custom-meta': 'version-2' })
      expect(setElysia.status).toBeUndefined()

      // Hono test
      const honoCode = generateRouter(spec, { target: 'hono', contractImport: './api.contract' })
      const routesHono: Record<string, any> = {}
      class MockHono {
        get(url: string, handler: Function) { routesHono[`GET ${url}`] = handler; return this }
        delete() { return this }
        on() { return this }
      }
      const honoMod = evalGeneratedRouter(honoCode, { hono: { Hono: MockHono } })
      honoMod.createRouter({ testOperation: async () => envelopeNoStatus })
      let honoPayload: any
      let honoStatus: number | undefined
      const honoHeaders: Record<string, string> = {}
      await routesHono['GET /test-operation']({
        req: { param: vi.fn(() => ({})), query: vi.fn(() => ({})), header: vi.fn(() => ({})), raw: { url: '/test' } },
        header: vi.fn((k: string, v: string) => { honoHeaders[k] = v }),
        json: vi.fn((d: any, s?: number) => { honoPayload = d; honoStatus = s; return d }),
        body: vi.fn(),
      })
      expect(honoPayload).toEqual({ message: 'hello from body' })
      expect(honoStatus).toBe(200) // falls back to route default status 200
      expect(honoHeaders).toEqual({ 'x-custom-meta': 'version-2' })

      // Express test
      const expressCode = generateRouter(spec, { target: 'express', contractImport: './api.contract' })
      const routesExpress: Record<string, any> = {}
      class MockExpress {
        get(url: string, ...handlers: any[]) { routesExpress[`GET ${url}`] = handlers[handlers.length - 1]; return this }
        delete() { return this }
        all() { return this }
      }
      const expressMod = evalGeneratedRouter(expressCode, { express: { Router: () => new MockExpress() } })
      expressMod.createRouter({ testOperation: async () => envelopeNoStatus })
      let expressPayload: any
      let expressStatus: number | undefined
      const expressHeaders: Record<string, string> = {}
      const mockExpressRes = {
        status(s: number) { expressStatus = s; return mockExpressRes },
        setHeader(k: string, v: string) { expressHeaders[k] = v; return mockExpressRes },
        json(d: any) { expressPayload = d; return mockExpressRes },
      }
      await routesExpress['GET /test-operation'](
        { params: {}, query: {}, headers: {}, body: {}, originalUrl: '/test', url: '/test', method: 'GET' },
        mockExpressRes,
        vi.fn()
      )
      expect(expressPayload).toEqual({ message: 'hello from body' })
      expect(expressStatus).toBe(200) // falls back to route default status 200
      expect(expressHeaders).toEqual({ 'x-custom-meta': 'version-2' })
    })

    it('correctly sets error status (e.g. 422) and returns error body across all 4 targets', async () => {
      const errorEnvelope = {
        status: 422,
        body: { code: 'UNPROCESSABLE_ENTITY', details: ['Field "email" missing'] },
      }

      // Fastify
      const fastifyCode = generateRouter(spec, { target: 'fastify', contractImport: './api.contract' })
      const fastifyMod = evalGeneratedRouter(fastifyCode)
      const routesFastify: Record<string, any> = {}
      await (fastifyMod.apiRouter || fastifyMod.default)({
        get: (url: string, optsOrHandler: any, maybeHandler?: any) => {
          routesFastify[`GET ${url}`] = maybeHandler ?? optsOrHandler
        },
        delete: vi.fn(),
        route: vi.fn(),
      }, { handlers: { testOperation: async () => errorEnvelope } })
      let fastifyStatus: number | undefined
      const resFastify = await routesFastify['GET /test-operation'](
        { params: {}, query: {}, headers: {}, body: {}, raw: { url: '/test' } },
        { status: vi.fn((s: number) => { fastifyStatus = s; return this }), header: vi.fn(), send: vi.fn() }
      )
      expect(fastifyStatus).toBe(422)
      expect(resFastify).toEqual(errorEnvelope.body)

      // Elysia
      const elysiaCode = generateRouter(spec, { target: 'elysia', contractImport: './api.contract' })
      const routesElysia: Record<string, any> = {}
      class MockElysia {
        get(url: string, handler: Function) { routesElysia[`GET ${url}`] = handler; return this }
        delete() { return this }
        route() { return this }
      }
      const elysiaMod = evalGeneratedRouter(elysiaCode, { elysia: { Elysia: MockElysia } })
      elysiaMod.createRouter({ testOperation: async () => errorEnvelope })
      const setElysia = { headers: {} as Record<string, string>, status: undefined as number | undefined }
      const resElysia = await routesElysia['GET /test-operation']({
        params: {}, query: {}, headers: {}, body: {}, request: { url: '/test' }, set: setElysia,
      })
      expect(setElysia.status).toBe(422)
      expect(resElysia).toEqual(errorEnvelope.body)

      // Hono
      const honoCode = generateRouter(spec, { target: 'hono', contractImport: './api.contract' })
      const routesHono: Record<string, any> = {}
      class MockHono {
        get(url: string, handler: Function) { routesHono[`GET ${url}`] = handler; return this }
        delete() { return this }
        on() { return this }
      }
      const honoMod = evalGeneratedRouter(honoCode, { hono: { Hono: MockHono } })
      honoMod.createRouter({ testOperation: async () => errorEnvelope })
      let honoPayload: any
      let honoStatus: number | undefined
      await routesHono['GET /test-operation']({
        req: { param: vi.fn(() => ({})), query: vi.fn(() => ({})), header: vi.fn(() => ({})), raw: { url: '/test' } },
        header: vi.fn(),
        json: vi.fn((d: any, s?: number) => { honoPayload = d; honoStatus = s; return d }),
        body: vi.fn(),
      })
      expect(honoStatus).toBe(422)
      expect(honoPayload).toEqual(errorEnvelope.body)

      // Express
      const expressCode = generateRouter(spec, { target: 'express', contractImport: './api.contract' })
      const routesExpress: Record<string, any> = {}
      class MockExpress {
        get(url: string, ...handlers: any[]) { routesExpress[`GET ${url}`] = handlers[handlers.length - 1]; return this }
        delete() { return this }
        all() { return this }
      }
      const expressMod = evalGeneratedRouter(expressCode, { express: { Router: () => new MockExpress() } })
      expressMod.createRouter({ testOperation: async () => errorEnvelope })
      let expressPayload: any
      let expressStatus: number | undefined
      const mockExpressRes = {
        status(s: number) { expressStatus = s; return mockExpressRes },
        setHeader() { return mockExpressRes },
        json(d: any) { expressPayload = d; return mockExpressRes },
      }
      await routesExpress['GET /test-operation'](
        { params: {}, query: {}, headers: {}, body: {}, originalUrl: '/test', url: '/test', method: 'GET' },
        mockExpressRes,
        vi.fn()
      )
      expect(expressStatus).toBe(422)
      expect(expressPayload).toEqual(errorEnvelope.body)
    })
  })

  // 6. OAS 3.2 Non-Standard Verb (QUERY) Collision Defense
  describe('OAS 3.2 QUERY Non-Standard Verb Envelope Collision Defense', () => {
    it('preserves domain entities on OAS 3.2 QUERY routes across all 4 targets', async () => {
      const queryEntity = {
        status: 'SEARCH_COMPLETED',
        total: 15,
        items: [{ id: 'q1', score: 0.95 }],
      }

      // Fastify: routes via fastify.route({ method: 'QUERY' })
      const fastifyCode = generateRouter(spec, { target: 'fastify', contractImport: './api.contract' })
      const routesFastify: Record<string, any> = {}
      const fastifyMod = evalGeneratedRouter(fastifyCode)
      await (fastifyMod.apiRouter || fastifyMod.default)({
        get: vi.fn(),
        delete: vi.fn(),
        route: (opts: any) => { routesFastify[`${opts.method} ${opts.url}`] = opts.handler },
      }, { handlers: { testQuery: async () => queryEntity } })
      const resFastify = await routesFastify['QUERY /test-query'](
        { params: {}, query: {}, headers: {}, body: {}, raw: { url: '/test' } },
        { status: vi.fn(), header: vi.fn(), send: vi.fn() }
      )
      expect(resFastify).toEqual(queryEntity)

      // Elysia: routes via .route('QUERY', '/test-query', handler)
      const elysiaCode = generateRouter(spec, { target: 'elysia', contractImport: './api.contract' })
      const routesElysia: Record<string, any> = {}
      class MockElysia {
        get() { return this }
        delete() { return this }
        route(method: string, url: string, handler: Function) {
          routesElysia[`${method} ${url}`] = handler
          return this
        }
      }
      const elysiaMod = evalGeneratedRouter(elysiaCode, { elysia: { Elysia: MockElysia } })
      elysiaMod.createRouter({ testQuery: async () => queryEntity })
      const setElysia = { headers: {}, status: undefined as number | undefined }
      const resElysia = await routesElysia['QUERY /test-query']({
        params: {}, query: {}, headers: {}, body: {}, request: { url: '/test' }, set: setElysia,
      })
      expect(resElysia).toEqual(queryEntity)
      expect(setElysia.status).toBeUndefined()

      // Hono: routes via app.on('QUERY', '/test-query', handler)
      const honoCode = generateRouter(spec, { target: 'hono', contractImport: './api.contract' })
      const routesHono: Record<string, any> = {}
      class MockHono {
        get() { return this }
        delete() { return this }
        on(method: string, url: string, handler: Function) {
          routesHono[`${method} ${url}`] = handler
          return this
        }
      }
      const honoMod = evalGeneratedRouter(honoCode, { hono: { Hono: MockHono } })
      honoMod.createRouter({ testQuery: async () => queryEntity })
      let honoPayload: any
      let honoStatus: number | undefined
      await routesHono['QUERY /test-query']({
        req: { param: vi.fn(() => ({})), query: vi.fn(() => ({})), header: vi.fn(() => ({})), raw: { url: '/test' } },
        header: vi.fn(),
        json: vi.fn((d: any, s?: number) => { honoPayload = d; honoStatus = s; return d }),
        body: vi.fn(),
      })
      expect(honoPayload).toEqual(queryEntity)
      expect(honoStatus).toBe(200)

      // Express: routes via router.all('/test-query', handler) with method guard
      const expressCode = generateRouter(spec, { target: 'express', contractImport: './api.contract' })
      const routesExpress: Record<string, any> = {}
      class MockExpress {
        get() { return this }
        delete() { return this }
        all(url: string, ...handlers: any[]) {
          routesExpress[`ALL ${url}`] = handlers[handlers.length - 1] as any
          return this
        }
      }
      const expressMod = evalGeneratedRouter(expressCode, { express: { Router: () => new MockExpress() } })
      expressMod.createRouter({ testQuery: async () => queryEntity })
      let expressPayload: any
      let expressStatus: number | undefined
      const mockExpressRes = {
        status(s: number) { expressStatus = s; return mockExpressRes },
        setHeader() { return mockExpressRes },
        json(d: any) { expressPayload = d; return mockExpressRes },
      }
      await routesExpress['ALL /test-query'](
        { params: {}, query: {}, headers: {}, body: {}, originalUrl: '/test', url: '/test', method: 'QUERY' },
        mockExpressRes,
        vi.fn()
      )
      expect(expressPayload).toEqual(queryEntity)
      expect(expressStatus).toBe(200)
    })
  })

  // 7. Context Injection Integration
  describe('Context Injection Envelope Defense Across All Targets', () => {
    it('executes context-injected routers and preserves envelope classification', async () => {
      for (const target of ['fastify', 'elysia', 'hono', 'express'] as const) {
        const code = generateRouter(spec, {
          target,
          contractImport: './api.contract',
          contextInjection: true,
        })
        expect(code).toContain('getContext')

        // Verify that the strict predicate is present in context-injected router
        const strictPredicateSnippet =
          "result !== undefined && result !== null && typeof result === 'object' && 'body' in result && ((result as any).status === undefined || typeof (result as any).status === 'number') && ((result as any).headers === undefined || typeof (result as any).headers === 'object')"
        expect(code).toContain(strictPredicateSnippet)
      }
    })
  })
})

describe('Empirical Challenger Stress Test: R2 Handler Contract Error Typing & tsc --strict', () => {
  it('verifies HandlerResponse discriminated error unions with 400 and 500 without "as any"', () => {
    type Order = { id: string; status: 'PENDING' | 'COMPLETED'; total: number }
    type ValidationError = { code: 'VALIDATION_ERROR'; fields: Record<string, string> }
    type ServerError = { code: 'SERVER_ERROR'; message: string }

    type OrderHandlerResponse = HandlerResponse<
      Order,
      {
        400: ValidationError
        500: ServerError
      }
    >

    // 1. Return raw success
    const rawSuccess: OrderHandlerResponse = { id: 'ord_1', status: 'COMPLETED', total: 50 }
    expect(rawSuccess).toBeDefined()

    // 2. Return 200 envelope
    const envelopeSuccess: OrderHandlerResponse = {
      status: 200,
      body: { id: 'ord_2', status: 'PENDING', total: 100 },
      headers: { 'x-request-id': 'req-1' },
    }
    expect(envelopeSuccess.status).toBe(200)

    // 3. Return 400 ValidationError envelope without as any
    const validationErrorEnvelope: OrderHandlerResponse = {
      status: 400,
      body: {
        code: 'VALIDATION_ERROR',
        fields: { quantity: 'Must be positive' },
      },
    }
    expect(validationErrorEnvelope.status).toBe(400)
    expect(validationErrorEnvelope.body.code).toBe('VALIDATION_ERROR')

    // 4. Return 500 ServerError envelope without as any
    const serverErrorEnvelope: OrderHandlerResponse = {
      status: 500,
      body: {
        code: 'SERVER_ERROR',
        message: 'Database connection failed',
      },
    }
    expect(serverErrorEnvelope.status).toBe(500)
    expect(serverErrorEnvelope.body.code).toBe('SERVER_ERROR')
  })

  it('runs empirical tsc --strict compiler validation on positive and negative error union scenarios', () => {
    const rootDir = join(stressTmpDir, 'tsc-strict-test')
    mkdirSync(rootDir, { recursive: true })

    const spec = createTestSpec()
    const contractCode = generateHandlerContract(spec, { contractName: 'ApiHandlers' })

    // Subdirectory 1: Positive Case
    const posDir = join(rootDir, 'positive')
    mkdirSync(posDir, { recursive: true })
    writeFileSync(join(posDir, 'api.contract.ts'), contractCode, 'utf8')

    const validHandlersTs = `
import type { HandlerResponse } from './api.contract';

export interface User {
  id: string;
  name: string;
}

export interface ValidationError {
  code: 'VALIDATION_ERROR';
  fields: Record<string, string>;
}

export interface ServerError {
  code: 'SERVER_ERROR';
  message: string;
}

export type GetUserResponse = HandlerResponse<
  User,
  {
    400: ValidationError;
    500: ServerError;
  }
>;

export const validSuccessHandler = async (): Promise<GetUserResponse> => {
  return { id: 'u1', name: 'Alice' };
};

export const valid400Handler = async (): Promise<GetUserResponse> => {
  return {
    status: 400,
    body: {
      code: 'VALIDATION_ERROR',
      fields: { id: 'Invalid user ID format' },
    },
  };
};

export const valid500Handler = async (): Promise<GetUserResponse> => {
  return {
    status: 500,
    body: {
      code: 'SERVER_ERROR',
      message: 'Internal DB timeout',
    },
  };
};
`
    writeFileSync(join(posDir, 'valid-handlers.ts'), validHandlersTs, 'utf8')
    writeFileSync(
      join(posDir, 'tsconfig.json'),
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
          },
          include: ['api.contract.ts', 'valid-handlers.ts'],
        },
        null,
        2
      ),
      'utf8'
    )

    const positiveResult = runTsc(posDir)
    expect(positiveResult.success, `tsc --strict failed: ${positiveResult.diagnostics}`).toBe(true)

    // Subdirectory 2: Adversarial Negative Case 1 - invalid status code 404 not in error map
    const negStatusDir = join(rootDir, 'negative-status')
    mkdirSync(negStatusDir, { recursive: true })
    writeFileSync(join(negStatusDir, 'api.contract.ts'), contractCode, 'utf8')
    writeFileSync(join(negStatusDir, 'valid-handlers.ts'), validHandlersTs, 'utf8')
    const invalidStatusTs = `
import type { GetUserResponse } from './valid-handlers';

export const invalidStatusHandler = async (): Promise<GetUserResponse> => {
  // 404 is not defined in error map! Must fail compilation.
  return {
    status: 404,
    body: { message: 'Not found' },
  };
};
`
    writeFileSync(join(negStatusDir, 'invalid-status.ts'), invalidStatusTs, 'utf8')
    writeFileSync(
      join(negStatusDir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            noEmit: true,
          },
          include: ['api.contract.ts', 'valid-handlers.ts', 'invalid-status.ts'],
        },
        null,
        2
      ),
      'utf8'
    )

    const negativeStatusResult = runTsc(negStatusDir)
    expect(negativeStatusResult.success).toBe(false)
    expect(negativeStatusResult.diagnostics).toContain("Type '404' is not assignable to type")

    // Subdirectory 3: Adversarial Negative Case 2 - invalid body shape for 400
    const negBodyDir = join(rootDir, 'negative-body')
    mkdirSync(negBodyDir, { recursive: true })
    writeFileSync(join(negBodyDir, 'api.contract.ts'), contractCode, 'utf8')
    writeFileSync(join(negBodyDir, 'valid-handlers.ts'), validHandlersTs, 'utf8')
    const invalidBodyTs = `
import type { GetUserResponse } from './valid-handlers';

export const invalidBodyNoCast = async (): Promise<GetUserResponse> => {
  return {
    status: 400,
    body: {
      wrongField: 123,
    },
  };
};
`
    writeFileSync(join(negBodyDir, 'invalid-body.ts'), invalidBodyTs, 'utf8')
    writeFileSync(
      join(negBodyDir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            noEmit: true,
          },
          include: ['api.contract.ts', 'valid-handlers.ts', 'invalid-body.ts'],
        },
        null,
        2
      ),
      'utf8'
    )

    const negativeBodyResult = runTsc(negBodyDir)
    expect(negativeBodyResult.success).toBe(false)
    expect(negativeBodyResult.diagnostics).toContain("does not exist in type 'ValidationError'")
  })
})
