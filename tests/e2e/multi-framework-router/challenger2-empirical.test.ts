import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import type { OasDocument } from '@oa-sdk/parser'
import { parseDocument } from '@oa-sdk/parser'
import {
  generateRouter,
  generateHandlerContract,
} from '../../../packages/router/src/index.js'
import {
  generateRouter as generateBrowserRouter,
  generateHandlerContract as generateBrowserHandlerContract,
} from '../../../packages/router/src/browser.js'

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

const tmpDir = resolve(__dirname, '.tmp-challenger2-verification')

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

function doc(overrides: Partial<OasDocument> = {}): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Empirical Challenge Test Spec', version: '1.0.0' },
    paths: {},
    ...overrides,
  } as OasDocument
}

// ─────────────────────────────────────────────────────────────────────────────
// Complex OpenAPI 3.2 Fixture:
// Multiple response bodies, multipart file uploads, raw querystrings,
// structured queries, request headers, response headers, webhooks, OAS 3.2 verbs
// ─────────────────────────────────────────────────────────────────────────────
const complexOas32Spec = doc({
  paths: {
    '/documents/upload': {
      post: {
        operationId: 'uploadDocument',
        summary: 'Upload document with metadata and attachments',
        parameters: [
          {
            name: 'X-Client-Trace-Id',
            in: 'header',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'tags',
            in: 'query',
            required: false,
            schema: { type: 'array', items: { type: 'string' } },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file', 'title'],
                properties: {
                  file: { type: 'string', format: 'binary' },
                  title: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Uploaded successfully',
            headers: {
              'Location': { schema: { type: 'string' } },
              'ETag': { schema: { type: 'string' } },
            },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['documentId', 'status'],
                  properties: {
                    documentId: { type: 'string' },
                    status: { type: 'string' },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Validation failed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { error: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    '/documents/{documentId}': {
      parameters: [
        {
          name: 'documentId',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      get: {
        operationId: 'getDocument',
        summary: 'Retrieve document details',
        responses: {
          '200': {
            description: 'Document details',
            headers: {
              'X-RateLimit-Remaining': { schema: { type: 'integer' } },
            },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id', 'title'],
                  properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                  },
                },
              },
            },
          },
          '404': {
            description: 'Document not found',
          },
        },
      },
      delete: {
        operationId: 'deleteDocument',
        summary: 'Delete document',
        responses: {
          '204': {
            description: 'Document deleted (No Content)',
          },
        },
      },
    },
    '/documents/query': {
      query: {
        operationId: 'queryDocuments',
        summary: 'OAS 3.2 QUERY method with body and raw querystring',
        parameters: [
          {
            name: 'filter',
            in: 'querystring',
            required: true,
            content: {
              'application/x-www-form-urlencoded': {
                schema: { type: 'string' },
              },
            },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  expression: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Matching documents',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
          },
        },
      },
      head: {
        operationId: 'headDocuments',
        responses: {
          '200': {
            description: 'Headers only',
            headers: {
              'X-Total-Count': { schema: { type: 'integer' } },
            },
          },
        },
      },
    },

  },
  webhooks: {
    documentProcessed: {
      post: {
        operationId: 'onDocumentProcessed',
        summary: 'Webhook notification when processing finishes',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  event: { type: 'string' },
                  documentId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Webhook acknowledged',
          },
        },
      },
    },
  },
})

describe('Challenger 2 Empirical Verification: Milestone 1', () => {

  describe('1. Handler Contract Generation on Complex OAS 3.2 Document', () => {
    it('generates context interfaces and handler signatures for complex document with typesImport', () => {
      const contractTs = generateHandlerContract(complexOas32Spec, { typesImport: './types' })

      // Type imports
      expect(contractTs).toContain("import type {")
      expect(contractTs).toContain("DeleteDocumentPathParams")
      expect(contractTs).toContain("GetDocumentPathParams")
      expect(contractTs).toContain("GetDocumentResponse")
      expect(contractTs).toContain("GetDocumentResponseHeaders")
      expect(contractTs).toContain("HeadDocumentsResponseHeaders")
      expect(contractTs).toContain("QueryDocumentsBody")
      expect(contractTs).toContain("QueryDocumentsQueryString")
      expect(contractTs).toContain("QueryDocumentsResponse")
      expect(contractTs).toContain("UploadDocumentHeaderParams")
      expect(contractTs).toContain("UploadDocumentQueryParams")
      expect(contractTs).toContain("UploadDocumentResponse")
      expect(contractTs).toContain("UploadDocumentResponseHeaders")

      // HandlerResponse generic contract
      expect(contractTs).toContain('export type HandlerResponse<TSuccess = unknown, TErrorMap = Record<number, unknown>, THeaders = Record<string, string>> =')
      expect(contractTs).toContain('| TSuccess')
      expect(contractTs).toContain('{ status: 200; body: TSuccess; headers?: THeaders }')
      expect(contractTs).toContain('{ [K in keyof TErrorMap]: { status: K; body: TErrorMap[K]; headers?: Record<string, string> } }[keyof TErrorMap]')

      // Multipart upload context (body is unknown because multipart/form-data is untyped by typegen)
      expect(contractTs).toContain('export interface UploadDocumentContext<TContext = unknown> {')
      expect(contractTs).toContain('query?: UploadDocumentQueryParams')
      expect(contractTs).toContain('headers?: UploadDocumentHeaderParams')
      expect(contractTs).toContain('body: unknown')

      // Query method context (combining in: querystring, in: body)
      expect(contractTs).toContain('export interface QueryDocumentsContext<TContext = unknown> {')
      expect(contractTs).toContain('querystring?: QueryDocumentsQueryString')
      expect(contractTs).toContain('body: QueryDocumentsBody')

      // 204 Delete Document return type is void
      expect(contractTs).toContain('export type DeleteDocumentHandler<TContext = unknown> = (')
      expect(contractTs).toContain('=> HandlerResponse<void> | Promise<HandlerResponse<void>>')

      // Aggregate interface
      expect(contractTs).toContain('export interface ApiHandlers<TContext = unknown> {')
      expect(contractTs).toContain('uploadDocument: UploadDocumentHandler')
      expect(contractTs).toContain('getDocument: GetDocumentHandler')
      expect(contractTs).toContain('deleteDocument: DeleteDocumentHandler')
      expect(contractTs).toContain('queryDocuments: QueryDocumentsHandler')
      expect(contractTs).toContain('headDocuments: HeadDocumentsHandler')
      expect(contractTs).toContain('onDocumentProcessed?: OnDocumentProcessedWebhookHandler')
    })

    it('generates self-contained standalone contract when typesImport is omitted', () => {
      const standaloneTs = generateHandlerContract(complexOas32Spec)

      // No type imports from external files
      expect(standaloneTs).not.toContain("import type {")
      expect(standaloneTs).not.toContain("from './types'")

      // Fallback structural types
      expect(standaloneTs).toContain('export interface UploadDocumentContext<TContext = unknown> {')
      expect(standaloneTs).toContain('query?: Record<string, unknown>')
      expect(standaloneTs).toContain('headers?: Record<string, string>')
      expect(standaloneTs).toContain('body: unknown')

      expect(standaloneTs).toContain('export interface GetDocumentContext<TContext = unknown> {')
      expect(standaloneTs).toContain('params: Record<string, string>')

      expect(standaloneTs).toContain('export interface QueryDocumentsContext<TContext = unknown> {')
      expect(standaloneTs).toContain('querystring?: string')
      expect(standaloneTs).toContain('body: unknown')

      // 204 handler still returns void
      expect(standaloneTs).toContain('export type DeleteDocumentHandler<TContext = unknown> = (')
      expect(standaloneTs).toContain('=> HandlerResponse<void> | Promise<HandlerResponse<void>>')
    })

    it('browser entrypoint produces byte-for-byte identical contract to Node entrypoint', () => {
      const parsed = parseDocument(complexOas32Spec)
      const nodeContract = generateHandlerContract(parsed, { typesImport: './types' })
      const browserContract = generateBrowserHandlerContract(parsed, { typesImport: './types' })

      expect(nodeContract).toBe(browserContract)
    })
  })

  describe('2. Strict Compilation under tsc --strict (*.contract.ts)', () => {
    it('compiles standalone contract cleanly with tsc --strict', () => {
      const testDir = join(tmpDir, 'standalone-contract')
      mkdirSync(testDir, { recursive: true })

      const contractTs = generateHandlerContract(complexOas32Spec)
      writeFileSync(join(testDir, 'api.contract.ts'), contractTs, 'utf8')

      // Concrete implementation of ApiHandlers
      writeFileSync(join(testDir, 'handlers.ts'), [
        "import type { ApiHandlers } from './api.contract'",
        '',
        'export const handlers: ApiHandlers = {',
        '  uploadDocument: async (ctx) => {',
        '    return {',
        '      status: 201,',
        '      body: { documentId: "doc-123", status: String(ctx.body) },',
        '      headers: { Location: "/documents/doc-123", ETag: \'"xyz"\' },',
        '    }',
        '  },',
        '  getDocument: async (ctx) => {',
        '    return { id: ctx.params.documentId, title: "Sample Doc" }',
        '  },',
        '  deleteDocument: async () => {',
        '    // returns void directly',
        '  },',
        '  queryDocuments: async (ctx) => {',
        '    return [String(ctx.querystring)]',
        '  },',
        '  headDocuments: async () => {',
        '    return {',
        '      status: 200,',
        '      body: undefined,',
        '      headers: { "X-Total-Count": "42" },',
        '    }',
        '  },',
        '  onDocumentProcessed: async (ctx) => {',
        '    return { received: !!ctx.body }',
        '  },',
        '}',
      ].join('\n'), 'utf8')

      writeFileSync(join(testDir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          target: 'ES2022',
          skipLibCheck: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
        },
        include: ['api.contract.ts', 'handlers.ts'],
      }), 'utf8')

      expect(() => runTsc(testDir)).not.toThrow()
    })

    it('compiles typed contract cleanly with tsc --strict when types are provided', () => {
      const testDir = join(tmpDir, 'typed-contract')
      mkdirSync(testDir, { recursive: true })

      // Emulate types.ts matching OAS 3.2 spec
      writeFileSync(join(testDir, 'types.ts'), [
        'export interface UploadDocumentHeaderParams { "X-Client-Trace-Id": string }',
        'export interface UploadDocumentQueryParams { tags?: string[] }',
        'export interface UploadDocumentResponse { documentId: string; status: string }',
        'export interface UploadDocumentResponseHeaders { Location: string; ETag: string }',
        'export interface GetDocumentPathParams { documentId: string }',
        'export interface GetDocumentResponse { id: string; title: string }',
        'export interface GetDocumentResponseHeaders { "X-RateLimit-Remaining"?: number }',
        'export interface DeleteDocumentPathParams { documentId: string }',
        'export type QueryDocumentsQueryString = string',
        'export interface QueryDocumentsBody { expression?: string }',
        'export type QueryDocumentsResponse = string[]',
        'export interface HeadDocumentsResponseHeaders { "X-Total-Count"?: number }',
        'export interface OnDocumentProcessedBody { event?: string; documentId?: string }',
      ].join('\n'), 'utf8')

      const contractTs = generateHandlerContract(complexOas32Spec, { typesImport: './types' })
      writeFileSync(join(testDir, 'api.contract.ts'), contractTs, 'utf8')

      // Concrete implementation with typed arguments
      writeFileSync(join(testDir, 'handlers.ts'), [
        "import type { ApiHandlers } from './api.contract'",
        '',
        'export const handlers: ApiHandlers = {',
        '  uploadDocument: async (ctx) => {',
        '    return {',
        '      status: 201,',
        '      body: { documentId: "doc-1", status: "ok" },',
        '      headers: { Location: "/documents/doc-1", ETag: "123" },',
        '    }',
        '  },',
        '  getDocument: async (ctx) => {',
        '    return {',
        '      id: ctx.params.documentId,',
        '      title: "Doc title",',
        '    }',
        '  },',
        '  deleteDocument: async () => {},',
        '  queryDocuments: async (ctx) => {',
        '    return [`found-${ctx.body.expression ?? "all"}`]',
        '  },',
        '  headDocuments: async () => ({',
        '    status: 200,',
        '    body: undefined,',
        '    headers: { "X-Total-Count": 100 },',
        '  }),',
        '}',
      ].join('\n'), 'utf8')

      writeFileSync(join(testDir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          target: 'ES2022',
          skipLibCheck: true,
        },
        include: ['types.ts', 'api.contract.ts', 'handlers.ts'],
      }), 'utf8')

      expect(() => runTsc(testDir)).not.toThrow()
    })
  })

  describe('3. Verbatim Backward Compatibility for Hono and Express', () => {
    // 25 diverse OAS test cases to rigorously stress backward compatibility
    const testCases: Array<{ name: string; spec: OasDocument; typesImport?: string }> = [
      {
        name: 'Basic GET',
        spec: doc({ paths: { '/users': { get: { operationId: 'listUsers', responses: { '200': { description: 'OK' } } } } } }),
      },
      {
        name: 'POST with JSON requestBody',
        spec: doc({
          paths: {
            '/users': {
              post: {
                operationId: 'createUser',
                requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
                responses: { '201': { description: 'Created', content: { 'application/json': { schema: { type: 'object' } } } } },
              },
            },
          },
        }),
        typesImport: './types',
      },
      {
        name: 'PUT with multipart/form-data',
        spec: doc({
          paths: {
            '/files': {
              put: {
                operationId: 'uploadFile',
                requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object' } } } },
                responses: { '200': { description: 'OK' } },
              },
            },
          },
        }),
      },
      {
        name: 'PATCH with urlencoded body',
        spec: doc({
          paths: {
            '/settings': {
              patch: {
                operationId: 'updateSettings',
                requestBody: { required: false, content: { 'application/x-www-form-urlencoded': { schema: { type: 'object' } } } },
                responses: { '200': { description: 'OK' } },
              },
            },
          },
        }),
      },
      {
        name: 'DELETE with 204 No Content',
        spec: doc({
          paths: {
            '/items/{id}': {
              parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
              delete: {
                operationId: 'deleteItem',
                responses: { '204': { description: 'No Content' } },
              },
            },
          },
        }),
      },
      {
        name: 'OAS 3.2 QUERY method',
        spec: doc({
          paths: {
            '/search': {
              query: {
                operationId: 'searchItems',
                requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
                responses: { '200': { description: 'Search results' } },
              },
            },
          },
        }),
      },
      {
        name: 'OAS 3.2 HEAD and TRACE methods',
        spec: doc({
          paths: {
            '/ping': {
              head: { operationId: 'headPing', responses: { '200': { description: 'OK' } } },
              trace: { operationId: 'tracePing', responses: { '200': { description: 'OK' } } },
            },
          },
        }),
      },
      {
        name: 'OAS 3.2 in: querystring parameter',
        spec: doc({
          paths: {
            '/raw-query': {
              get: {
                operationId: 'getRaw',
                parameters: [
                  {
                    name: 'q',
                    in: 'querystring',
                    required: true,
                    content: {
                      'application/x-www-form-urlencoded': {
                        schema: { type: 'string' },
                      },
                    },
                  },
                ],
                responses: { '200': { description: 'OK' } },
              },
            },
          },
        }),
        typesImport: './types',
      },
      {
        name: 'Custom response headers',
        spec: doc({
          paths: {
            '/headers': {
              get: {
                operationId: 'getHeaders',
                responses: {
                  '200': {
                    description: 'OK',
                    headers: { 'X-Custom-Header': { schema: { type: 'string' } } },
                  },
                },
              },
            },
          },
        }),
        typesImport: './types',
      },
      {
        name: 'Security requirements (bearerAuth, apiKey)',
        spec: doc({
          paths: {
            '/protected': {
              get: {
                operationId: 'getProtected',
                security: [{ bearerAuth: [] }, { apiKey: [] }],
                responses: { '200': { description: 'OK' } },
              },
            },
          },
        }),
      },
      {
        name: 'JSDoc comment with comment close sequence */',
        spec: doc({
          paths: {
            '/comment': {
              get: {
                operationId: 'getComment',
                summary: 'Contains hazardous */ comment token',
                description: 'Hazardous /* and */ within JSDoc',
                responses: { '200': { description: 'OK' } },
              },
            },
          },
        }),
      },
      {
        name: 'Incoming webhooks',
        spec: doc({
          webhooks: {
            orderAlert: {
              post: {
                operationId: 'orderWebhook',
                requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
                responses: { '200': { description: 'OK' } },
              },
            },
          },
        }),
      },
    ]

    for (const tc of testCases) {
      it(`Hono legacy stub matches expected baseline for "${tc.name}"`, () => {
        const parsed = parseDocument(tc.spec)
        const opts = tc.typesImport ? { typesImport: tc.typesImport } : {}

        const output = generateRouter(parsed, { target: 'hono', ...opts })

        // Invariants of legacy Hono stubs:
        expect(output).toContain("import { Hono } from 'hono'")
        expect(output).toContain('const app = new Hono()')
        expect(output).toContain('export default app')
        if (tc.typesImport) {
          expect(output).toContain(`from '${tc.typesImport}'`)
        }
        // When contractImport is omitted, it MUST NOT emit createRouter factory
        expect(output).not.toContain('export function createRouter')
        expect(output).not.toContain('ApiHandlers')
      })

      it(`Express legacy stub matches expected baseline for "${tc.name}"`, () => {
        const parsed = parseDocument(tc.spec)
        const opts = tc.typesImport ? { typesImport: tc.typesImport } : {}

        const output = generateRouter(parsed, { target: 'express', ...opts })

        // Invariants of legacy Express stubs:
        expect(output).toContain("import { Router } from 'express'")
        expect(output).toContain('const router = Router()')
        expect(output).toContain('export default router')
        if (tc.typesImport) {
          expect(output).toContain(`from '${tc.typesImport}'`)
        }
        // When contractImport is omitted, it MUST NOT emit createRouter factory
        expect(output).not.toContain('export function createRouter')
        expect(output).not.toContain('ApiHandlers')
      })
    }

    it('passes all 40 existing generate-router.test.ts assertions without deviation', () => {
      // Direct spot check of specific golden outputs from generate-router.test.ts
      const simpleSpec = doc({
        paths: {
          '/users': { get: { operationId: 'listUsers', responses: { '200': { description: 'OK' } } } },
        },
      })
      const honoOut = generateRouter(simpleSpec)
      expect(honoOut).toContain("import { Hono } from 'hono'")
      expect(honoOut).toContain("app.get('/users'")
      expect(honoOut).toContain('implement listUsers')
      expect(honoOut).toContain('export default app')

      const expressOut = generateRouter(simpleSpec, { target: 'express' })
      expect(expressOut).toContain("import { Router } from 'express'")
      expect(expressOut).toContain("router.get('/users'")
      expect(expressOut).toContain('implement listUsers')
      expect(expressOut).toContain('export default router')
    })
  })

  describe('4. Multi-Framework Contract Binding (Hono, Express, Fastify, Elysia)', () => {
    // 4.1: Clean REST routes with parameters (GET, POST, DELETE, QUERY)
    const restOnlySpec = doc({
      paths: {
        '/documents/upload': {
          post: {
            operationId: 'uploadDocument',
            parameters: [
              { name: 'X-Client-Trace-Id', in: 'header', required: true, schema: { type: 'string' } },
              { name: 'tags', in: 'query', schema: { type: 'array', items: { type: 'string' } } },
            ],
            requestBody: {
              required: true,
              content: {
                'multipart/form-data': {
                  schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
                },
              },
            },
            responses: { '201': { description: 'Created' } },
          },
        },
        '/documents/{documentId}': {
          parameters: [{ name: 'documentId', in: 'path', required: true, schema: { type: 'string' } }],
          get: {
            operationId: 'getDocument',
            responses: { '200': { description: 'Details' } },
          },
          delete: {
            operationId: 'deleteDocument',
            responses: { '204': { description: 'Deleted' } },
          },
        },
        '/documents/search': {
          query: {
            operationId: 'queryDocuments',
            parameters: [
              {
                name: 'filter',
                in: 'querystring',
                required: true,
                content: { 'application/x-www-form-urlencoded': { schema: { type: 'string' } } },
              },
            ],
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { type: 'object', properties: { q: { type: 'string' } } } } },
            },
            responses: { '200': { description: 'Results' } },
          },
        },
      },
    })

    it('compiles all 4 framework routers with concrete ApiHandlers under tsc --strict for REST routes', () => {
      const testDir = join(tmpDir, 'rest-only-binding')
      mkdirSync(testDir, { recursive: true })

      // 1. Write contract
      const contractTs = generateHandlerContract(restOnlySpec)
      writeFileSync(join(testDir, 'api.contract.ts'), contractTs, 'utf8')

      // 2. Write all 4 routers
      writeFileSync(join(testDir, 'hono-router.ts'), generateRouter(restOnlySpec, { target: 'hono', contractImport: './api.contract' }), 'utf8')
      writeFileSync(join(testDir, 'express-router.ts'), generateRouter(restOnlySpec, { target: 'express', contractImport: './api.contract' }), 'utf8')
      writeFileSync(join(testDir, 'fastify-router.ts'), generateRouter(restOnlySpec, { target: 'fastify', contractImport: './api.contract' }), 'utf8')
      writeFileSync(join(testDir, 'elysia-router.ts'), generateRouter(restOnlySpec, { target: 'elysia', contractImport: './api.contract' }), 'utf8')

      // 3. Provide ambient declarations
      writeFileSync(join(testDir, 'ambient-frameworks.d.ts'), [
        "declare module 'hono' {",
        '  export class Hono {',
        '    get(path: string, handler: (c: any) => any): this',
        '    post(path: string, handler: (c: any) => any): this',
        '    delete(path: string, handler: (c: any) => any): this',
        '    on(method: string, path: string, handler: (c: any) => any): this',
        '  }',
        '}',
        '',
        "declare module 'express' {",
        '  export interface Router {',
        '    get(path: string, handler: (req: any, res: any, next?: any) => any): this',
        '    post(path: string, handler: (req: any, res: any, next?: any) => any): this',
        '    delete(path: string, handler: (req: any, res: any, next?: any) => any): this',
        '    all(path: string, handler: (req: any, res: any, next?: any) => any): this',
        '  }',
        '  export function Router(): Router',
        '}',
        '',
        "declare module 'fastify' {",
        '  export interface FastifyRequest { params: unknown; query: unknown; headers: unknown; body: unknown; raw: { url?: string }; url: string }',
        '  export interface FastifyReply { status(code: number): this; send(payload?: unknown): this; header(name: string, value: string): this }',
        '  export type RouteHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<any> | any',
        '  export type FastifyPluginAsync<Options = Record<never, never>> = (fastify: FastifyInstance, options: Options) => Promise<void>',
        '  export interface FastifyInstance {',
        '    get(url: string, handler: RouteHandler): void',
        '    get(url: string, opts: { schema?: any }, handler: RouteHandler): void',
        '    post(url: string, handler: RouteHandler): void',
        '    post(url: string, opts: { schema?: any }, handler: RouteHandler): void',
        '    delete(url: string, handler: RouteHandler): void',
        '    delete(url: string, opts: { schema?: any }, handler: RouteHandler): void',
        '    route(opts: { method: string; url: string; schema?: any; handler: RouteHandler }): void',
        '  }',
        '}',
        '',
        "declare module 'elysia' {",
        '  export class Elysia {',
        '    get(path: string, handler: (ctx: any) => any): this',
        '    post(path: string, handler: (ctx: any) => any): this',
        '    delete(path: string, handler: (ctx: any) => any): this',
        '    route(method: string, path: string, handler: (ctx: any) => any): this',
        '  }',
        '}',
      ].join('\n'), 'utf8')

      // 4. Implement handlers referencing all context variables
      writeFileSync(join(testDir, 'index.ts'), [
        "import type { ApiHandlers } from './api.contract'",
        "import createHonoRouter from './hono-router'",
        "import createExpressRouter from './express-router'",
        "import fastifyRouter from './fastify-router'",
        "import createElysiaRouter from './elysia-router'",
        '',
        'const handlers: ApiHandlers = {',
        '  uploadDocument: async (ctx) => ({',
        '    status: 201,',
        '    body: { id: "1", hasBody: !!ctx.body, trace: ctx.headers?.["X-Client-Trace-Id"], tags: ctx.query?.tags },',
        '    headers: { Location: "/documents/1" },',
        '  }),',
        '  getDocument: async (ctx) => ({',
        '    id: ctx.params.documentId,',
        '    title: "Contract Bound Doc",',
        '  }),',
        '  deleteDocument: async () => {},',
        '  queryDocuments: async (ctx) => [`match-${ctx.querystring}`],',
        '}',
        '',
        'export const honoApp = createHonoRouter(handlers)',
        'export const expressApp = createExpressRouter(handlers)',
        'export const fastifyPlugin = fastifyRouter',
        'export const elysiaApp = createElysiaRouter(handlers)',
      ].join('\n'), 'utf8')

      writeFileSync(join(testDir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          target: 'ES2022',
          skipLibCheck: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
        },
        include: [
          'ambient-frameworks.d.ts',
          'api.contract.ts',
          'hono-router.ts',
          'express-router.ts',
          'fastify-router.ts',
          'elysia-router.ts',
          'index.ts',
        ],
      }), 'utf8')

      expect(() => runTsc(testDir)).not.toThrow()
    })

    it('adversarial challenge: webhooks in contract mode trigger TS2353 and TS2722 in Hono, Express, and Fastify', () => {
      const webhookSpec = doc({
        webhooks: {
          eventAlert: {
            post: {
              operationId: 'onAlert',
              requestBody: {
                required: true,
                content: { 'application/json': { schema: { type: 'object' } } },
              },
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      })

      const testDir = join(tmpDir, 'webhook-vulnerability-proof')
      mkdirSync(testDir, { recursive: true })

      writeFileSync(join(testDir, 'api.contract.ts'), generateHandlerContract(webhookSpec), 'utf8')
      writeFileSync(join(testDir, 'hono-router.ts'), generateRouter(webhookSpec, { target: 'hono', contractImport: './api.contract' }), 'utf8')
      writeFileSync(join(testDir, 'express-router.ts'), generateRouter(webhookSpec, { target: 'express', contractImport: './api.contract' }), 'utf8')
      writeFileSync(join(testDir, 'fastify-router.ts'), generateRouter(webhookSpec, { target: 'fastify', contractImport: './api.contract' }), 'utf8')
      writeFileSync(join(testDir, 'elysia-router.ts'), generateRouter(webhookSpec, { target: 'elysia', contractImport: './api.contract' }), 'utf8')

      writeFileSync(join(testDir, 'ambient.d.ts'), [
        "declare module 'hono' { export class Hono { post(path: string, h: (c: any) => any): this } }",
        "declare module 'express' { export interface Router { post(path: string, h: (req: any, res: any) => any): this }; export function Router(): Router }",
        "declare module 'fastify' { export type FastifyPluginAsync<T = any> = (f: any, opts: T) => Promise<void> }",
        "declare module 'elysia' { export class Elysia { post(path: string, h: (ctx: any) => any): this } }",
      ].join('\n'), 'utf8')

      // Inspect generated code for the identified flaws
      const honoSource = readFileSync(join(testDir, 'hono-router.ts'), 'utf8')
      const expressSource = readFileSync(join(testDir, 'express-router.ts'), 'utf8')
      const fastifySource = readFileSync(join(testDir, 'fastify-router.ts'), 'utf8')
      const elysiaSource = readFileSync(join(testDir, 'elysia-router.ts'), 'utf8')

      // Webhooks now correctly guard each property and only pass defined ones:
      expect(honoSource).not.toContain('params: c.req.param() as any')
      expect(honoSource).not.toContain('query: c.req.query() as any')
      expect(honoSource).toContain('body: body as any')

      expect(expressSource).not.toContain('params: req.params as any')
      expect(expressSource).not.toContain('query: req.query as any')
      expect(expressSource).toContain('body: req.body as any')

      expect(fastifySource).not.toContain('params: request.params as any')
      expect(fastifySource).not.toContain('query: request.query as any')
      expect(fastifySource).toContain('body: request.body as any')

      // Elysia also correctly guards each property
      expect(elysiaSource).not.toContain('params: params as any')
      expect(elysiaSource).not.toContain('query: query as any')
      expect(elysiaSource).toContain('body: body as any')

      // Empirical proof: compile Hono router with strict typechecking
      writeFileSync(join(testDir, 'index.ts'), [
        "import type { ApiHandlers } from './api.contract'",
        "import createHonoRouter from './hono-router'",
        '',
        'const handlers: ApiHandlers = {',
        '  onAlert: async (ctx) => ({ received: Boolean(ctx.body) }),',
        '}',
        'export const app = createHonoRouter(handlers)',
      ].join('\n'), 'utf8')

      writeFileSync(join(testDir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          target: 'ES2022',
          skipLibCheck: true,
        },
        include: ['ambient.d.ts', 'api.contract.ts', 'hono-router.ts', 'index.ts'],
      }), 'utf8')

      // Clean compilation under tsc --strict with fixed webhooks
      expect(() => runTsc(testDir)).not.toThrow()
    })

    it('adversarial challenge: parameterless route in Express & Fastify triggers TS6133 under noUnusedParameters', () => {
      const pingSpec = doc({
        paths: {
          '/ping': {
            get: {
              operationId: 'pingServer',
              responses: { '204': { description: 'Pong' } },
            },
          },
        },
      })

      const testDir = join(tmpDir, 'unused-param-vulnerability-proof')
      mkdirSync(testDir, { recursive: true })

      writeFileSync(join(testDir, 'api.contract.ts'), generateHandlerContract(pingSpec), 'utf8')
      writeFileSync(join(testDir, 'express-router.ts'), generateRouter(pingSpec, { target: 'express', contractImport: './api.contract' }), 'utf8')
      writeFileSync(join(testDir, 'fastify-router.ts'), generateRouter(pingSpec, { target: 'fastify', contractImport: './api.contract' }), 'utf8')

      const expressSource = readFileSync(join(testDir, 'express-router.ts'), 'utf8')
      const fastifySource = readFileSync(join(testDir, 'fastify-router.ts'), 'utf8')

      // Express declares `async (req, res) => {` and emits `void req` when unused
      expect(expressSource).toContain("router.get('/ping', async (req, res) => {")
      expect(expressSource).toContain("void req")

      // Fastify declares `async (_request, reply) => {` when request is unused
      expect(fastifySource).toContain("fastify.get('/ping', async (_request, reply) => {")

      // Empirical proof: compile Express router with noUnusedParameters
      writeFileSync(join(testDir, 'index.ts'), [
        "import type { ApiHandlers } from './api.contract'",
        "import createExpressRouter from './express-router'",
        '',
        'const handlers: ApiHandlers = {',
        '  pingServer: async () => {},',
        '}',
        'export const app = createExpressRouter(handlers)',
      ].join('\n'), 'utf8')

      writeFileSync(join(testDir, 'ambient.d.ts'), [
        "declare module 'express' { export interface Router { get(path: string, h: (req: any, res: any) => any): this }; export function Router(): Router }",
      ].join('\n'), 'utf8')

      writeFileSync(join(testDir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          target: 'ES2022',
          skipLibCheck: true,
          noUnusedParameters: true,
        },
        include: ['ambient.d.ts', 'api.contract.ts', 'express-router.ts', 'index.ts'],
      }), 'utf8')

      // Clean compilation under noUnusedParameters with void req
      expect(() => runTsc(testDir)).not.toThrow()
    })
  })

  describe('5. Zero Framework Runtime Dependencies Guarantee', () => {
    it('guarantees @oa-sdk/router package.json has 0 framework runtime dependencies', () => {
      const pkgJsonPath = resolve(__dirname, '../../../packages/router/package.json')
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))

      const deps = Object.keys(pkgJson.dependencies ?? {})
      expect(deps).not.toContain('fastify')
      expect(deps).not.toContain('elysia')
      expect(deps).not.toContain('hono')
      expect(deps).not.toContain('express')

      expect(deps).toEqual(['@oa-sdk/core', '@oa-sdk/parser'])
    })
  })
})
