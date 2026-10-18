import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generateHandlerContract } from '../contracts/handler-contract.js'
import { renderFastifyRouter } from '../targets/fastify.js'
import { renderHonoRouter } from '../targets/hono.js'
import { renderElysiaRouter } from '../targets/elysia.js'
import { parseDocument, type OasDocument } from '@oa-sdk/parser/browser'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import ts from 'typescript'

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
    throw new Error(diagnostics)
  }
}

const STREAMING_SPEC: OasDocument = {
  openapi: '3.1.0',
  info: { title: 'Streaming API', version: '1.0.0' },
  paths: {
    '/chunks/{id}': {
      get: {
        operationId: 'getChunkStream',
        summary: 'Stream binary chunk data with range support',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'Range', in: 'header', required: false, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Full binary stream',
            content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
          },
          '206': {
            description: 'Partial content binary chunk',
            headers: {
              'Content-Range': { schema: { type: 'string' } },
              'Accept-Ranges': { schema: { type: 'string' } },
            },
            content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
          },
        },
      },
    },
  },
}

describe('Streaming Response Contract & Adapters', () => {
  let tmpDir: string
  const parsed = parseDocument(STREAMING_SPEC)

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'oa-router-stream-test-'))
    writeFileSync(
      join(tmpDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          noEmit: true,
          skipLibCheck: true,
        },
      }),
      'utf8',
    )
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('generates handler contract containing StreamingBody, StreamingResponse, and 206 Partial Content', () => {
    const contract = generateHandlerContract(parsed, { contractName: 'StreamHandlers' })
    expect(contract).toContain('export type StreamingBody =')
    expect(contract).toContain('export interface StreamingResponse')
    expect(contract).toContain('status: 206')
    expect(contract).toContain('GetChunkStreamHandler')
    expect(contract).toContain('StreamHandlers')
  })

  it('compiles Fastify router with streaming handler under tsc --strict', () => {
    writeFileSync(join(tmpDir, 'contract.ts'), generateHandlerContract(parsed, { contractName: 'StreamHandlers' }), 'utf8')
    writeFileSync(
      join(tmpDir, 'router.ts'),
      renderFastifyRouter(parsed, {
        mode: 'contract',
        contractName: 'StreamHandlers',
        contractImport: './contract',
      }),
      'utf8',
    )

    writeFileSync(
      join(tmpDir, 'fastify.d.ts'),
      [
        "declare module 'fastify' {",
        '  export interface FastifyRequest {',
        '    params: unknown',
        '    query: unknown',
        '    headers: Record<string, string>',
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
        '    get(url: string, opts: { schema?: any }, handler: RouteHandler): void',
        '    get(url: string, handler: RouteHandler): void',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    )

    writeFileSync(
      join(tmpDir, 'impl.ts'),
      [
        "import type { StreamHandlers, StreamingResponse } from './contract'",
        "import apiRouter from './router'",
        '',
        'const handlers: StreamHandlers = {',
        '  async getChunkStream(ctx) {',
        "    if (ctx.headers?.['Range']) {",
        '      return {',
        '        status: 206,',
        '        body: new Uint8Array([1, 2, 3]),',
        '        headers: {',
        "          'Content-Range': 'bytes 0-2/3',",
        "          'Accept-Ranges': 'bytes',",
        '        },',
        '      }',
        '    }',
        '    const res: StreamingResponse = {',
        '      status: 200,',
        '      body: (async function* () {',
        '        yield new Uint8Array([1, 2])',
        '      })(),',
        "      headers: { 'Content-Type': 'application/octet-stream' },",
        '    }',
        '    return res',
        '  },',
        '}',
        '',
        'void apiRouter',
        'void handlers',
      ].join('\n'),
      'utf8',
    )

    expect(() => runTsc(tmpDir)).not.toThrow()
  })

  it('compiles Hono router with streaming handler under tsc --strict', () => {
    writeFileSync(join(tmpDir, 'contract.ts'), generateHandlerContract(parsed, { contractName: 'StreamHandlers' }), 'utf8')
    writeFileSync(
      join(tmpDir, 'router.ts'),
      renderHonoRouter(parsed, {
        mode: 'contract',
        contractName: 'StreamHandlers',
        contractImport: './contract',
      }),
      'utf8',
    )

    writeFileSync(
      join(tmpDir, 'hono.d.ts'),
      [
        "declare module 'hono' {",
        '  export interface Context {',
        '    req: {',
        '      param(): Record<string, string>;',
        '      query(): Record<string, string>;',
        '      header(): Record<string, string>;',
        '      raw: { url: string; body: unknown };',
        '      json(): Promise<unknown>;',
        '      text(): Promise<string>;',
        '      formData(): Promise<unknown>;',
        '      parseBody(): Promise<unknown>;',
        '    };',
        '    header(name: string, value: string): void;',
        '    body(data: any, status?: number): Response;',
        '    json(data: any, status?: number): Response;',
        '  }',
        '  export class Hono {',
        '    get(path: string, ...handlers: Array<(c: Context) => any>): this;',
        '    post(path: string, ...handlers: Array<(c: Context) => any>): this;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    )

    writeFileSync(
      join(tmpDir, 'impl.ts'),
      [
        "import type { StreamHandlers } from './contract'",
        "import { createRouter } from './router'",
        '',
        'const handlers: StreamHandlers = {',
        '  async getChunkStream() {',
        '    return {',
        '      status: 206,',
        '      body: new Uint8Array([10, 20]),',
        '    }',
        '  },',
        '}',
        'const app = createRouter(handlers)',
        'void app',
      ].join('\n'),
      'utf8',
    )

    expect(() => runTsc(tmpDir)).not.toThrow()
  })

  it('Fastify router converts raw AsyncIterable body into a Web ReadableStream at runtime', async () => {
    const code = renderFastifyRouter(parsed, {
      mode: 'contract',
      contractName: 'StreamHandlers',
      contractImport: './contract',
    })
    const transpiled = ts.transpileModule(code, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const exports: Record<string, any> = {}
    const mod = { exports }
    new Function('exports', 'require', 'module', transpiled)(exports, () => ({}), mod)

    let routeHandler: any
    const mockFastify = {
      get: (_url: string, optsOrHandler: any, maybeHandler?: any) => {
        routeHandler = maybeHandler ?? optsOrHandler
      },
    }
    await mod.exports.apiRouter(mockFastify, {
      handlers: {
        getChunkStream: async () => ({
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
          body: (async function* () {
            yield 'chunk-1:'
            yield new Uint8Array([65, 66])
          })(),
        }),
      },
    })

    const headers: Record<string, string> = {}
    let statusCode = 200
    const reply = {
      header(k: string, v: string) {
        headers[k] = v
        return this
      },
      status(c: number) {
        statusCode = c
        return this
      },
      send(p?: unknown) {
        return p
      },
    }

    const result = await routeHandler(
      { params: { id: '1' }, headers: {}, query: {}, raw: {}, url: '/chunks/1' },
      reply,
    )
    expect(statusCode).toBe(200)
    expect(headers['Content-Type']).toBe('application/octet-stream')
    expect(result).toBeInstanceOf(ReadableStream)
    const text = await new Response(result as ReadableStream).text()
    expect(text).toBe('chunk-1:AB')
  })

  it('Hono router consumes reusable AsyncIterable objects across multiple pulls without repeating the first chunk', async () => {
    const code = renderHonoRouter(parsed, {
      mode: 'contract',
      contractName: 'StreamHandlers',
      contractImport: './contract',
    })
    const transpiled = ts.transpileModule(code, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const exports: Record<string, any> = {}
    const mod = { exports }
    let registeredHandler: any
    new Function('exports', 'require', 'module', transpiled)(
      exports,
      (id: string) =>
        id === 'hono'
          ? {
              Hono: class {
                get(_path: string, handler: any) {
                  registeredHandler = handler
                  return this
                }
              },
            }
          : {},
      mod,
    )

    const reusableIterable: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        const chunks = ['first-', 'second-', 'third']
        let idx = 0
        return {
          async next() {
            if (idx < chunks.length) {
              return { value: chunks[idx++]!, done: false }
            }
            return { value: undefined, done: true }
          },
        }
      },
    }

    mod.exports.createRouter({
      getChunkStream: async () => ({
        status: 200,
        body: reusableIterable,
      }),
    })

    let bodyStream: ReadableStream | undefined
    const res = await registeredHandler({
      req: {
        param: () => ({ id: '1' }),
        header: () => ({}),
        query: () => ({}),
        raw: { url: 'http://localhost/chunks/1', body: null },
      },
      header: () => {},
      body: (stream: ReadableStream, status: number) => {
        bodyStream = stream
        return new Response(stream, { status })
      },
      json: (data: unknown, status: number) => new Response(JSON.stringify(data), { status }),
    })

    expect(res.status).toBe(200)
    expect(bodyStream).toBeInstanceOf(ReadableStream)
    expect(await res.text()).toBe('first-second-third')
  })

  it('Elysia router normalizes envelope header keys to lowercase to prevent duplicate Content-Type headers', async () => {
    const code = renderElysiaRouter(parsed, {
      mode: 'contract',
      contractName: 'StreamHandlers',
      contractImport: './contract',
    })
    const transpiled = ts.transpileModule(code, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const exports: Record<string, any> = {}
    const mod = { exports }
    let registeredHandler: any
    new Function('exports', 'require', 'module', transpiled)(
      exports,
      (id: string) =>
        id === 'elysia'
          ? {
              Elysia: class {
                get(_path: string, handler: any) {
                  registeredHandler = handler
                  return this
                }
              },
            }
          : {},
      mod,
    )

    mod.exports.createRouter({
      getChunkStream: async () => ({
        status: 206,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Range': 'bytes 0-1/2',
        },
        body: new Uint8Array([1, 2]),
      }),
    })

    const set = {
      status: 200,
      headers: {
        'content-type': 'text/plain;charset=utf-8',
      } as Record<string, string>,
    }

    await registeredHandler({
      params: { id: '1' },
      headers: {},
      set,
    })

    expect(set.status).toBe(206)
    expect(Object.keys(set.headers)).toEqual(['content-type', 'content-range'])
    expect(set.headers['content-type']).toBe('application/octet-stream')
    expect(set.headers['Content-Type']).toBeUndefined()
  })
})
