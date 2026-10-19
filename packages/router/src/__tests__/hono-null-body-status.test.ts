import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import type { OasDocument } from '@oa-sdk/parser'
import { generateRouter } from '../generate-router.js'

/**
 * Generated Hono routers run against a context whose `body`/`json` build real WHATWG `Response`s,
 * as Hono does, so the Fetch rule that 204/205/304 responses cannot carry a body applies.
 */
type RouteHandler = (c: unknown) => Promise<Response>
type ResponseBody = ConstructorParameters<typeof Response>[0]

const spec = {
  openapi: '3.2.0',
  info: { title: 'Chunk streams', version: '1.0.0' },
  paths: {
    '/streams/{streamId}/manifest': {
      get: {
        operationId: 'getManifest',
        parameters: [
          { name: 'streamId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'If-None-Match', in: 'header', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'manifest', content: { 'application/json': { schema: { type: 'object' } } } },
          '304': { description: 'not modified' },
        },
      },
    },
    '/streams/{streamId}/chunks/{chunkId}': {
      get: {
        operationId: 'getChunk',
        parameters: [
          { name: 'streamId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'chunkId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'Range', in: 'header', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'chunk', content: { 'application/octet-stream': { schema: {} } } },
          '416': { description: 'range not satisfiable' },
        },
      },
    },
    '/resets': {
      post: { operationId: 'resetForm', responses: { '205': { description: 'reset content' } } },
    },
    '/items/{id}': {
      delete: {
        operationId: 'deleteItem',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': { description: 'deleted' } },
      },
    },
  },
} as unknown as OasDocument

function mountRouter(handlers: Record<string, (context: never) => unknown>): Map<string, RouteHandler> {
  const code = generateRouter(spec, { target: 'hono', contractImport: './contract' })
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const routes = new Map<string, RouteHandler>()
  class Hono {
    get(path: string, handler: RouteHandler): this { routes.set(`GET ${path}`, handler); return this }
    post(path: string, handler: RouteHandler): this { routes.set(`POST ${path}`, handler); return this }
    delete(path: string, handler: RouteHandler): this { routes.set(`DELETE ${path}`, handler); return this }
  }
  const module = { exports: {} as { createRouter?: (handlers: unknown) => unknown } }
  new Function('exports', 'require', 'module', js)(module.exports, (id: string) => (id === 'hono' ? { Hono } : {}), module)
  module.exports.createRouter!(handlers)
  return routes
}

/** The parts of a Hono `Context` the generated routes use, answering with real `Response`s. */
function honoContext(request: Request) {
  const headers = new Headers()
  return {
    req: {
      raw: request,
      param: () => ({ streamId: 's1', chunkId: 'c1', id: 'i1' }),
      query: () => ({}),
      header: () => Object.fromEntries(request.headers),
      json: () => request.json(),
      text: () => request.text(),
    },
    header: (name: string, value: string) => headers.set(name, value),
    body: (data: ResponseBody, status?: number) => new Response(data, { status: status ?? 200, headers }),
    json: (data: unknown, status?: number) => {
      const jsonHeaders = new Headers(headers)
      jsonHeaders.set('content-type', 'application/json')
      return new Response(JSON.stringify(data), { status: status ?? 200, headers: jsonHeaders })
    },
  }
}

async function call(routes: Map<string, RouteHandler>, key: string, init: RequestInit = {}): Promise<Response> {
  const handler = routes.get(key)
  expect(handler, `route ${key}`).toBeDefined()
  return handler!(honoContext(new Request('http://localhost/x', init)))
}

describe('Hono contract router: null-body statuses', () => {
  it('answers a 304 revalidation envelope with an empty 304 and keeps its headers', async () => {
    const etag = 'W/"66-eeb439b2"'
    const routes = mountRouter({
      getManifest: async ({ headers }: { headers: Record<string, string> }) => headers['if-none-match'] === etag
        ? { status: 304, headers: { etag }, body: null }
        : { status: 200, headers: { etag }, body: { chunks: 3 } },
      getChunk: async () => ({ body: new Uint8Array([1]) }),
      resetForm: async () => undefined,
      deleteItem: async () => undefined,
    })

    const first = await call(routes, 'GET /streams/:streamId/manifest')
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ chunks: 3 })

    const revalidated = await call(routes, 'GET /streams/:streamId/manifest', { headers: { 'if-none-match': etag } })
    expect(revalidated.status).toBe(304)
    expect(revalidated.headers.get('etag')).toBe(etag)
    expect(await revalidated.text()).toBe('')
  })

  it('answers 205 envelopes and a defaulted 204 envelope status without a body', async () => {
    const routes = mountRouter({
      getManifest: async () => ({ status: 205, body: null }),
      getChunk: async () => ({ body: new Uint8Array([1]) }),
      resetForm: async () => ({ status: 205, body: { ignored: true } }),
      // No status in the envelope: the declared 204 applies, which cannot carry a body either.
      deleteItem: async () => ({ body: null }),
    })

    const reset = await call(routes, 'POST /resets', { method: 'POST' })
    expect(reset.status).toBe(205)
    expect(await reset.text()).toBe('')

    const deleted = await call(routes, 'DELETE /items/:id', { method: 'DELETE' })
    expect(deleted.status).toBe(204)
    expect(await deleted.text()).toBe('')

    const manifest = await call(routes, 'GET /streams/:streamId/manifest')
    expect(manifest.status).toBe(205)
  })

  it('sends no JSON null for an error envelope without a body, and keeps a 2xx JSON null', async () => {
    const routes = mountRouter({
      getManifest: async () => ({ status: 200, body: null }),
      getChunk: async () => ({ status: 416, headers: { 'content-range': 'bytes */11' }, body: null }),
      resetForm: async () => undefined,
      deleteItem: async () => undefined,
    })

    const unsatisfiable = await call(routes, 'GET /streams/:streamId/chunks/:chunkId', { headers: { range: 'bytes=20-30' } })
    expect(unsatisfiable.status).toBe(416)
    expect(unsatisfiable.headers.get('content-range')).toBe('bytes */11')
    expect(unsatisfiable.headers.get('content-type')).not.toBe('application/json')
    expect(await unsatisfiable.text()).toBe('')

    const nullManifest = await call(routes, 'GET /streams/:streamId/manifest')
    expect(nullManifest.status).toBe(200)
    expect(await nullManifest.text()).toBe('null')
  })

  it('answers a route whose declared success status is 205 without a body', async () => {
    const routes = mountRouter({
      getManifest: async () => ({}),
      getChunk: async () => ({ body: new Uint8Array([1]) }),
      resetForm: async () => ({ cleared: true }),
      deleteItem: async () => undefined,
    })

    const reset = await call(routes, 'POST /resets', { method: 'POST' })
    expect(reset.status).toBe(205)
    expect(await reset.text()).toBe('')
  })
})
