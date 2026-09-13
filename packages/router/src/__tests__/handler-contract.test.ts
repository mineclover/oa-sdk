import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import type { OasDocument } from '@oa-sdk/parser'
import { parseDocument } from '@oa-sdk/parser'
import { generateHandlerContract } from '../generate-router.js'
import { generateHandlerContract as generateBrowserHandlerContract } from '../browser.js'

const require = createRequire(import.meta.url)
const tscBin = require.resolve('typescript/bin/tsc')

function runTsc(cwd: string): void {
  execFileSync(process.execPath, [tscBin, '--noEmit'], {
    cwd,
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

const tmpDir = resolve(__dirname, '../../.tmp-handler-contract-test')

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

function doc(overrides: Partial<OasDocument> = {}): OasDocument {
  return { openapi: '3.2.0', info: { title: 'T', version: '0' }, paths: {}, ...overrides } as OasDocument
}

describe('generateHandlerContract', () => {
  it('generates pure TypeScript context, handler types, and aggregate ApiHandlers', () => {
    const spec = doc({
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            parameters: [
              { name: 'limit', in: 'query', schema: { type: 'integer' } },
            ],
            responses: {
              '200': {
                description: 'User list',
                content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } },
              },
            },
          },
          post: {
            operationId: 'createUser',
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { type: 'object' } } },
            },
            responses: {
              '201': {
                description: 'Created',
                content: { 'application/json': { schema: { type: 'object' } } },
              },
            },
          },
        },
        '/users/{id}': {
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          get: {
            operationId: 'getUser',
            responses: {
              '200': {
                description: 'User',
                content: { 'application/json': { schema: { type: 'object' } } },
              },
            },
          },
        },
      },
    })

    const code = generateHandlerContract(spec, { typesImport: './types' })

    expect(code).toContain("import type {")
    expect(code).toContain("CreateUserBody")
    expect(code).toContain("CreateUserResponse")
    expect(code).toContain("GetUserPathParams")
    expect(code).toContain("GetUserResponse")
    expect(code).toContain("ListUsersQueryParams")
    expect(code).toContain("ListUsersResponse")
    expect(code).toContain("export type HandlerResponse<TSuccess = unknown, TErrorMap = Record<number, unknown>, THeaders = Record<string, string>> =")

    // Context types
    expect(code).toContain("export interface ListUsersContext<TContext = unknown> {")
    expect(code).toContain("query?: ListUsersQueryParams")
    expect(code).toContain("context?: TContext")
    expect(code).toContain("export interface CreateUserContext<TContext = unknown> {")
    expect(code).toContain("body: CreateUserBody")
    expect(code).toContain("export interface GetUserContext<TContext = unknown> {")
    expect(code).toContain("params: GetUserPathParams")

    // Handler types
    expect(code).toContain("export type ListUsersHandler<TContext = unknown> = (")
    expect(code).toContain("export type CreateUserHandler<TContext = unknown> = (")
    expect(code).toContain("export type GetUserHandler<TContext = unknown> = (")

    // Aggregate interface
    expect(code).toContain("export interface ApiHandlers<TContext = unknown> {")
    expect(code).toContain("listUsers: ListUsersHandler<TContext>")
    expect(code).toContain("createUser: CreateUserHandler<TContext>")
    expect(code).toContain("getUser: GetUserHandler<TContext>")
  })

  it('supports custom contractName option', () => {
    const spec = doc({
      paths: {
        '/ping': {
          get: {
            operationId: 'pingServer',
            responses: { '204': { description: 'No content' } },
          },
        },
      },
    })

    const code = generateHandlerContract(spec, { contractName: 'CustomServiceContract' })
    expect(code).toContain('export interface CustomServiceContract<TContext = unknown> {')
    expect(code).toContain('pingServer: PingServerHandler<TContext>')
    expect(code).toContain('HandlerResponse<void>')
  })

  it('supports raw querystring parameter (OAS 3.2 in: querystring)', () => {
    const spec = doc({
      paths: {
        '/search': {
          get: {
            operationId: 'searchItems',
            parameters: [
              {
                name: 'query',
                in: 'querystring',
                required: true,
                content: { 'application/x-www-form-urlencoded': { schema: { type: 'object' } } },
              },
            ],
            responses: { '200': { description: 'Search results' } },
          },
        },
      },
    })

    const code = generateHandlerContract(spec, { typesImport: './types' })
    expect(code).toContain('querystring?: SearchItemsQueryString')
  })

  it('includes response headers in HandlerResponse generic when documented', () => {
    const spec = doc({
      paths: {
        '/data': {
          get: {
            operationId: 'getData',
            responses: {
              '200': {
                description: 'OK',
                headers: {
                  'X-Total-Count': { schema: { type: 'integer' } },
                },
                content: { 'application/json': { schema: { type: 'string' } } },
              },
            },
          },
        },
      },
    })

    const code = generateHandlerContract(spec, { typesImport: './types' })
    expect(code).toContain('HandlerResponse<GetDataResponse, Record<number, unknown>, Partial<GetDataResponseHeaders>>')
  })

  it('supports incoming webhooks', () => {
    const spec = doc({
      webhooks: {
        newOrder: {
          post: {
            operationId: 'orderWebhook',
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { type: 'object' } } },
            },
            responses: { '200': { description: 'Webhook received' } },
          },
        },
      },
    })

    const code = generateHandlerContract(spec)
    expect(code).toContain('export interface OrderWebhookWebhookContext')
    expect(code).toContain('export type OrderWebhookWebhookHandler')
    expect(code).toContain('orderWebhook?: OrderWebhookWebhookHandler')
  })

  it('Node and browser entrypoints produce identical output for ParsedDocument', () => {
    const spec = doc({
      paths: {
        '/items': {
          get: {
            operationId: 'listItems',
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    })
    const parsed = parseDocument(spec)

    const nodeOut = generateHandlerContract(parsed)
    const browserOut = generateBrowserHandlerContract(parsed)
    expect(nodeOut).toBe(browserOut)
  })

  it('compiles cleanly under tsc --strict with a concrete handler implementation', () => {
    const spec = doc({
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            parameters: [
              { name: 'limit', in: 'query', schema: { type: 'integer' } },
            ],
            responses: {
              '200': {
                description: 'User list',
                content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } },
              },
            },
          },
          post: {
            operationId: 'createUser',
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { type: 'object' } } },
            },
            responses: {
              '201': {
                description: 'Created',
                content: { 'application/json': { schema: { type: 'object' } } },
              },
            },
          },
        },
        '/users/{id}': {
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          get: {
            operationId: 'getUser',
            responses: {
              '200': {
                description: 'User',
                content: { 'application/json': { schema: { type: 'object' } } },
              },
            },
          },
        },
      },
    })

    // Write dummy types.ts
    writeFileSync(join(tmpDir, 'types.ts'), [
      'export interface ListUsersQueryParams { limit?: number }',
      'export type ListUsersResponse = string[]',
      'export interface CreateUserBody { name: string }',
      'export interface CreateUserResponse { id: string; name: string }',
      'export interface GetUserPathParams { id: string }',
      'export interface GetUserResponse { id: string; name: string }',
    ].join('\n'), 'utf8')

    // Write contract.ts
    const contractCode = generateHandlerContract(spec, { typesImport: './types' })
    writeFileSync(join(tmpDir, 'contract.ts'), contractCode, 'utf8')

    // Write concrete implementation
    writeFileSync(join(tmpDir, 'handlers.ts'), [
      "import type { ApiHandlers } from './contract'",
      '',
      'export const handlers: ApiHandlers = {',
      '  listUsers: async (ctx) => {',
      '    return [`user-${ctx?.query?.limit ?? 10}`]',
      '  },',
      '  createUser: async (ctx) => ({',
      "    id: 'user-1',",
      '    name: ctx.body.name,',
      '  }),',
      '  getUser: async (ctx) => ({',
      '    id: ctx.params.id,',
      "    name: 'Alice',",
      '  }),',
      '}',
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
      include: ['types.ts', 'contract.ts', 'handlers.ts'],
    }), 'utf8')

    expect(() => runTsc(tmpDir)).not.toThrow()
  })
})
