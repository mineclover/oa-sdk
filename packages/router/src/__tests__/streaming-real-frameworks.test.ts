import { describe, it, expect, afterEach } from 'vitest'
import { Readable } from 'node:stream'
import Fastify from 'fastify'
import { Hono } from 'hono'
import { Elysia } from 'elysia'
import ts from 'typescript'
import { parseDocument, type OasDocument } from '@oa-sdk/parser/browser'
import { renderElysiaRouter } from '../targets/elysia.js'
import { renderFastifyRouter } from '../targets/fastify.js'
import { renderHonoRouter } from '../targets/hono.js'

/**
 * End-to-end checks with the real frameworks. The unit suite transpiles the generated routers and
 * mocks `fastify`/`hono`; these tests register them in real Fastify 5 / Hono 4 instances, which is
 * where a Web `ReadableStream` payload or a per-chunk iterator would actually fail.
 */

const SPEC: OasDocument = {
  openapi: '3.1.0',
  info: { title: 'Real streaming API', version: '1.0.0' },
  paths: {
    '/sse': {
      get: {
        operationId: 'getSse',
        responses: {
          '200': {
            description: 'SSE',
            content: { 'text/event-stream': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/ndjson': {
      get: {
        operationId: 'getNdjson',
        responses: {
          '200': {
            description: 'NDJSON',
            content: { 'application/x-ndjson': { schema: { type: 'string' } } },
          },
        },
      },
    },
  },
}

const parsed = parseDocument(SPEC)

function loadGeneratedRouter(code: string): Record<string, any> {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports: Record<string, any> = {}
  const mod = { exports }
  new Function('exports', 'require', 'module', js)(
    exports,
    (id: string) => {
      if (id === 'hono') return { Hono }
      if (id === 'elysia') return { Elysia }
      throw new Error(`unexpected runtime import: ${id}`)
    },
    mod,
  )
  return mod.exports
}

function asyncIterable(chunks: string[], state?: { returned: boolean }): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      try {
        for (const chunk of chunks) yield chunk
      } finally {
        if (state) state.returned = true
      }
    },
  }
}

function webStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(chunks[index++]!))
    },
  })
}

function handlersFor(
  body: (chunks: string[]) => unknown,
): Record<string, () => Promise<unknown>> {
  const make = (chunks: string[], contentType: string) => async () => ({
    status: 200,
    headers: { 'Content-Type': contentType },
    body: body(chunks),
  })
  return {
    getSse: make(['data: one\n\n', 'data: two\n\n'], 'text/event-stream'),
    getNdjson: make(['{"n":1}\n', '{"n":2}\n'], 'application/x-ndjson'),
  }
}

describe('streaming responses through real Fastify and Hono', () => {
  const fastifyApps: Array<ReturnType<typeof Fastify>> = []

  afterEach(async () => {
    await Promise.all(fastifyApps.splice(0).map(app => app.close()))
  })

  async function listenFastify(handlers: Record<string, () => Promise<unknown>>) {
    const router = loadGeneratedRouter(
      renderFastifyRouter(parsed, {
        mode: 'contract',
        contractName: 'StreamHandlers',
        contractImport: './contract',
      }),
    )
    const app = Fastify({ logger: false })
    fastifyApps.push(app)
    await app.register(router.apiRouter as any, { handlers })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const address = app.server.address()
    if (typeof address !== 'object' || address === null) throw new Error('Fastify did not bind a port')
    return `http://127.0.0.1:${address.port}`
  }

  const fastifyBodyModes = [
    ['AsyncIterable', (chunks: string[]) => asyncIterable(chunks)],
    ['Web ReadableStream', (chunks: string[]) => webStream(chunks)],
    ['Node Readable', (chunks: string[]) => Readable.from(chunks)],
  ] as const

  for (const [label, body] of fastifyBodyModes) {
    it(`Fastify 5 sends a ${label} body without buffering it into JSON`, async () => {
      const base = await listenFastify(handlersFor(body))

      const sse = await fetch(`${base}/sse`)
      expect(sse.status).toBe(200)
      expect(sse.headers.get('content-type')).toBe('text/event-stream')
      expect(await sse.text()).toBe('data: one\n\ndata: two\n\n')

      const ndjson = await fetch(`${base}/ndjson`)
      expect(ndjson.status).toBe(200)
      expect(ndjson.headers.get('content-type')).toBe('application/x-ndjson')
      expect(await ndjson.text()).toBe('{"n":1}\n{"n":2}\n')
    })
  }

  it('Fastify cancels the source iterator when the client disconnects', async () => {
    const state = { returned: false }
    const handlers = handlersFor(() => {
      let index = 0
      return {
        async *[Symbol.asyncIterator]() {
          try {
            for (;;) {
              yield `data: ${index++}\n\n`
              await new Promise(resolve => setTimeout(resolve, 5))
            }
          } finally {
            state.returned = true
          }
        },
      }
    })
    const base = await listenFastify(handlers)

    const controller = new AbortController()
    const response = await fetch(`${base}/sse`, { signal: controller.signal })
    const reader = response.body!.getReader()
    await reader.read()
    await reader.read()
    controller.abort()

    await expect.poll(() => state.returned, { timeout: 2000 }).toBe(true)
  })

  it('Hono 4 streams an AsyncIterable once and cancels it on client disconnect', async () => {
    const state = { returned: false }
    const reusable: AsyncIterable<string> = asyncIterable(
      ['data: one\n\n', 'data: two\n\n'],
      state,
    )
    const router = loadGeneratedRouter(
      renderHonoRouter(parsed, {
        mode: 'contract',
        contractName: 'StreamHandlers',
        contractImport: './contract',
      }),
    )
    const app = router.createRouter({
      getSse: async () => ({ status: 200, body: reusable }),
      // Node Readable is also an AsyncIterable; Hono must wrap it and consume it only once.
      getNdjson: async () => ({ status: 200, body: Readable.from(['{"n":1}\n', '{"n":2}\n']) }),
    })

    const response = await app.request('http://localhost/sse')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('data: one\n\ndata: two\n\n')

    // A single-shot generator must not restart when the consumer reads it again.
    const second = await app.request('http://localhost/ndjson')
    expect(await second.text()).toBe('{"n":1}\n{"n":2}\n')

    // Cancel a long-running generator and check the generated wrapper calls iterator.return().
    const cancelState = { returned: false }
    const infinite = router.createRouter({
      getSse: async () => ({
        status: 200,
        body: {
          async *[Symbol.asyncIterator]() {
            try {
              for (let i = 0; ; i++) {
                yield `data: ${i}\n\n`
                await new Promise(resolve => setTimeout(resolve, 5))
              }
            } finally {
              cancelState.returned = true
            }
          },
        },
      }),
      getNdjson: async () => ({ status: 200, body: '{}' }),
    })
    const streamed = await infinite.request('http://localhost/sse')
    const reader = streamed.body!.getReader()
    await reader.read()
    await reader.cancel()
    await expect.poll(() => cancelState.returned, { timeout: 2000 }).toBe(true)
  })

  it('Elysia streams envelope and direct AsyncIterable/Node Readable bodies', async () => {
    const router = loadGeneratedRouter(
      renderElysiaRouter(parsed, {
        mode: 'contract',
        contractName: 'StreamHandlers',
        contractImport: './contract',
      }),
    )
    const app = router.createRouter({
      getSse: async () => ({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: asyncIterable(['data: one\n\n', 'data: two\n\n']),
      }),
      getNdjson: async () => ({
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
        body: Readable.from(['{"n":1}\n', '{"n":2}\n']),
      }),
    })

    const sse = await app.handle(new Request('http://localhost/sse'))
    expect(sse.status).toBe(200)
    expect(sse.headers.get('content-type')).toBe('text/event-stream')
    expect(await sse.text()).toBe('data: one\n\ndata: two\n\n')

    const ndjson = await app.handle(new Request('http://localhost/ndjson'))
    expect(ndjson.status).toBe(200)
    expect(ndjson.headers.get('content-type')).toBe('application/x-ndjson')
    expect(await ndjson.text()).toBe('{"n":1}\n{"n":2}\n')

    // Direct return (no { status, body } envelope) takes the same conversion path.
    const direct = router.createRouter({
      getSse: async () => asyncIterable(['data: direct\n\n']),
      getNdjson: async () => Readable.from(['{"n":3}\n']),
    })
    const directSse = await direct.handle(new Request('http://localhost/sse'))
    expect(await directSse.text()).toBe('data: direct\n\n')
    const directNdjson = await direct.handle(new Request('http://localhost/ndjson'))
    expect(await directNdjson.text()).toBe('{"n":3}\n')
  })

  it('Elysia cancels the source iterator on response cancel', async () => {
    const state = { returned: false }
    const router = loadGeneratedRouter(
      renderElysiaRouter(parsed, {
        mode: 'contract',
        contractName: 'StreamHandlers',
        contractImport: './contract',
      }),
    )
    const app = router.createRouter({
      getSse: async () => ({
        status: 200,
        body: {
          async *[Symbol.asyncIterator]() {
            try {
              for (let i = 0; ; i++) {
                yield `data: ${i}\n\n`
                await new Promise(resolve => setTimeout(resolve, 5))
              }
            } finally {
              state.returned = true
            }
          },
        },
      }),
      getNdjson: async () => ({ status: 200, body: '{}' }),
    })

    const response = await app.handle(new Request('http://localhost/sse'))
    const reader = response.body!.getReader()
    await reader.read()
    await reader.cancel()
    await expect.poll(() => state.returned, { timeout: 2000 }).toBe(true)
  })
})
