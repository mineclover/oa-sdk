import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generateHandlerContract } from '../contracts/handler-contract.js'
import { renderFastifyRouter } from '../targets/fastify.js'
import { renderHonoRouter } from '../targets/hono.js'
import { parseDocument, type OasDocument } from '@oa-sdk/parser/browser'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

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
})
