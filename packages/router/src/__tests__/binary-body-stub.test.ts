import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import ts from 'typescript'
import type { OasDocument } from '@oa-sdk/parser'
import { generateRouter } from '../generate-router.js'

const require = createRequire(import.meta.url)
const tscBin = require.resolve('typescript/bin/tsc')

/** Runs tsc and returns its diagnostics ('' when the project compiles). */
function tscDiagnostics(cwd: string): string {
  try {
    execFileSync(process.execPath, [tscBin, '--noEmit'], { cwd, timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] })
    return ''
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: Buffer; stderr?: Buffer }
    return [stdout, stderr].map(output => output?.toString('utf8').trim() ?? '').filter(Boolean).join('\n')
  }
}

const spec = {
  openapi: '3.2.0',
  info: { title: 'Uploads', version: '1.0.0' },
  paths: {
    '/upload': {
      post: {
        operationId: 'upload',
        requestBody: {
          required: true,
          content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
        },
        responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object' } } } } },
      },
    },
    '/orders': {
      post: {
        operationId: 'createOrder',
        requestBody: {
          content: {
            'application/x-protobuf': { schema: { type: 'object', properties: { id: { type: 'string' } } } },
            'application/json': { schema: { type: 'object', properties: { id: { type: 'string' } } } },
          },
        },
        responses: { '200': { description: 'ok' } },
      },
    },
  },
  webhooks: {
    orderEvent: {
      post: {
        operationId: 'onOrderEvent',
        requestBody: { required: true, content: { 'application/msgpack': { schema: {} } } },
        responses: { '200': { description: 'ok' } },
      },
    },
  },
} as unknown as OasDocument

const STUB_TYPES = [
  'export type UploadResponse = Record<string, unknown>',
  'export type UploadResponseHeaders = Record<string, string>',
  'export type CreateOrderBody = { id?: string }',
  'export type CreateOrderResponse = unknown',
  'export type CreateOrderResponseHeaders = Record<string, string>',
  'export type OnOrderEventBody = unknown',
].join('\n')

const HONO_MODULE = [
  "declare module 'hono' {",
  '  export interface Context {',
  '    req: { raw: Request; arrayBuffer(): Promise<ArrayBuffer>; json<T = unknown>(): Promise<T>; text(): Promise<string>; param(): Record<string, string>; query(): Record<string, string> }',
  '    header(name: string, value: string): void',
  '    body(data: BodyInit | null, status?: number): Response',
  '    json(data: unknown, status?: number): Response',
  '  }',
  '  export class Hono {',
  '    get(path: string, handler: (c: Context) => unknown): this',
  '    post(path: string, handler: (c: Context) => unknown): this',
  '  }',
  '}',
].join('\n')

const EXPRESS_MODULE = [
  "declare module 'express' {",
  '  export interface Request { body: any; params: Record<string, string>; query: Record<string, unknown>; method: string; url: string; originalUrl?: string }',
  '  export interface Response { status(code: number): Response; json(body: unknown): Response; end(): Response; setHeader(name: string, value: string): void }',
  '  export type NextFunction = () => void',
  '  type Handler = (req: Request, res: Response, next: NextFunction) => unknown',
  '  export interface RouterInstance { get(path: string, handler: Handler): void; post(path: string, handler: Handler): void; all(path: string, handler: Handler): void }',
  '  export function Router(): RouterInstance',
  '}',
].join('\n')

describe('legacy router stubs read binary request bodies without an undeclared options binding', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'oa-router-binary-stub-'))
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        strict: true,
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        lib: ['ES2022', 'DOM'],
        types: [],
        noEmit: true,
        skipLibCheck: true,
      },
    }))
    writeFileSync(join(dir, 'types.ts'), STUB_TYPES)
    writeFileSync(join(dir, 'modules.d.ts'), `${HONO_MODULE}\n${EXPRESS_MODULE}\n`)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it.each(['hono', 'express'] as const)('the %s stub has no options reference and compiles under tsc --strict', (target) => {
    const typed = generateRouter(spec, { target, typesImport: './types' })
    const untyped = generateRouter(spec, { target })

    for (const code of [typed, untyped]) {
      expect(code).not.toMatch(/\boptions\b/)
    }
    writeFileSync(join(dir, 'typed.ts'), typed)
    writeFileSync(join(dir, 'untyped.ts'), untyped)
    expect(tscDiagnostics(dir)).toBe('')
  })

  it('the Hono stub answers a binary upload instead of failing with a ReferenceError', async () => {
    const js = ts.transpileModule(generateRouter(spec, { target: 'hono' }), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const routes = new Map<string, (c: unknown) => Promise<Response>>()
    class Hono {
      post(path: string, handler: (c: unknown) => Promise<Response>): this {
        routes.set(path, handler)
        return this
      }
      get(): this { return this }
    }
    const module = { exports: {} }
    new Function('exports', 'require', 'module', js)(module.exports, (id: string) => (id === 'hono' ? { Hono } : {}), module)

    expect([...routes.keys()]).toEqual(['/upload', '/orders', '/webhooks/orderEvent'])
    for (const [path, handler] of routes) {
      const request = new Request(`http://localhost${path}`, { method: 'POST', body: new Uint8Array([1, 2, 3]) })
      const response = await handler({
        req: { raw: request, arrayBuffer: () => request.arrayBuffer() },
        header: () => {},
        json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
        body: (data: ConstructorParameters<typeof Response>[0], status = 200) => new Response(data, { status }),
      })
      expect(response.status, `${path}: ${await response.clone().text()}`).toBe(200)
    }
  })
})
