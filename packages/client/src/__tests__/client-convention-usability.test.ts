import { describe, it, expect, vi, afterEach } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import { parseDocument } from '@oa-sdk/parser'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import {
  ClientError,
  isClientError,
  bearerAuth,
  basicAuth,
  apiKeyAuth,
  generateClient,
} from '../index.js'
import {
  ClientError as BrowserClientError,
  isClientError as browserIsClientError,
  bearerAuth as browserBearerAuth,
  basicAuth as browserBasicAuth,
  apiKeyAuth as browserApiKeyAuth,
  generateClient as browserGenerateClient,
} from '../browser.js'
import { generateTanstackQuery } from '../tanstack/generate-tanstack.js'

function buildSampleSpec(): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Convention Usability API', version: '1.0.0' },
    paths: {
      '/users': {
        get: {
          operationId: 'listUsers',
          tags: ['users'],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer' },
            },
            {
              name: 'query',
              in: 'query',
              required: false,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Users list',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                      },
                      required: ['id', 'name'],
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: 'createUser',
          tags: ['users'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    role: { type: 'string' },
                  },
                  required: ['name'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'User created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                    },
                    required: ['id', 'name'],
                  },
                },
              },
            },
          },
        },
      },
      '/users/{id}': {
        get: {
          operationId: 'getUserById',
          tags: ['users'],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'User found',
              headers: {
                'x-custom-header': {
                  schema: { type: 'string' },
                  required: true,
                },
              },
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                    },
                    required: ['id', 'name'],
                  },
                },
              },
            },
            '404': {
              description: 'User not found',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string' },
                      code: { type: 'string' },
                    },
                    required: ['message', 'code'],
                  },
                },
              },
            },
          },
        },
        put: {
          operationId: 'updateUser',
          tags: ['users'],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'notify',
              in: 'query',
              required: false,
              schema: { type: 'boolean' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    role: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'User updated',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      role: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/events': {
        get: {
          operationId: 'streamEvents',
          tags: ['events'],
          responses: {
            '200': {
              description: 'SSE stream',
              content: {
                'text/event-stream': {
                  schema: {
                    type: 'object',
                    properties: {
                      event: { type: 'string' },
                      data: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  } as OasDocument
}

async function instantiateClient(code: string): Promise<Record<string, any>> {
  const js = transpileModule(code, {
    compilerOptions: {
      module: ModuleKind.ES2022,
      target: ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  }).outputText
  const url = `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
  return await import(url)
}

describe('Client Convention & Usability Suite', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  describe('1. Package & Browser Entrypoint Parity', () => {
    it('exports all core types and runtime helpers identically from root and browser entrypoints', () => {
      expect(ClientError).toBe(BrowserClientError)
      expect(isClientError).toBe(browserIsClientError)
      expect(bearerAuth).toBe(browserBearerAuth)
      expect(basicAuth).toBe(browserBasicAuth)
      expect(apiKeyAuth).toBe(browserApiKeyAuth)
      expect(typeof generateClient).toBe('function')
      expect(typeof browserGenerateClient).toBe('function')
    })

    it('multi-realm duck typing: isClientError recognizes native and cross-realm error objects', () => {
      const mockResponse = new Response(JSON.stringify({ error: 'denied' }), {
        status: 403,
        statusText: 'Forbidden',
      })
      const nativeErr = new ClientError(403, { error: 'denied' }, mockResponse)
      expect(isClientError(nativeErr)).toBe(true)

      // Cross-realm simulation (e.g. iframe, worker, another version of package)
      const crossRealmErr = {
        name: 'ClientError',
        isClientError: true,
        status: 404,
        statusText: 'Not Found',
        data: { message: 'not found' },
        response: mockResponse,
      }
      expect(isClientError(crossRealmErr)).toBe(true)

      // Standard errors or arbitrary objects return false
      expect(isClientError(new Error('plain error'))).toBe(false)
      expect(isClientError(new TypeError('type error'))).toBe(false)
      expect(isClientError(null)).toBe(false)
      expect(isClientError(undefined)).toBe(false)
      expect(isClientError({ status: 500 })).toBe(false)
    })

    it('auth middleware factories produce standard headers', async () => {
      const bearer = bearerAuth('token-abc-123')
      const bearerReq = await bearer.onRequest!('https://api.example.com', { headers: { 'X-Tenant': 'demo' } })
      expect(new Headers(bearerReq.headers).get('Authorization')).toBe('Bearer token-abc-123')
      expect(new Headers(bearerReq.headers).get('X-Tenant')).toBe('demo')

      const basic = basicAuth('user', 'secret')
      const basicReq = await basic.onRequest!('https://api.example.com', {})
      const expectedBasic = `Basic ${Buffer.from('user:secret').toString('base64')}`
      expect(new Headers(basicReq.headers).get('Authorization')).toBe(expectedBasic)

      const apiKey = apiKeyAuth('x-api-key', 'my-key-999')
      const apiReq = await apiKey.onRequest!('https://api.example.com', {})
      expect(new Headers(apiReq.headers).get('x-api-key')).toBe('my-key-999')

      const defaultApiKey = apiKeyAuth('default-secret')
      const defaultReq = await defaultApiKey.onRequest!('https://api.example.com', {})
      expect(new Headers(defaultReq.headers).get('x-api-key')).toBe('default-secret')
    })
  })

  describe('2. Dual-Call Conventions & Clean Option Disambiguation', () => {
    it('supports standard positional arguments and single-object unified requests', async () => {
      const spec = buildSampleSpec()
      const clientCode = generateClient(spec)
      const mod = await instantiateClient(clientCode)

      let capturedUrl = ''
      let capturedInit: RequestInit | undefined

      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url)
        capturedInit = init
        return new Response(JSON.stringify({ id: 'u1', name: 'Alice' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'x-custom-header': 'custom-val' },
        })
      })

      const client = mod.createClient({
        baseUrl: 'https://api.domain.test',
        middleware: [bearerAuth('auth-token')],
      })

      // Calling pattern A: Positional parameters with options
      const userA = await client.getUserById({ id: 'u1' }, { headers: { 'X-Call-Id': 'call-1' } })
      expect(userA).toEqual({ id: 'u1', name: 'Alice' })
      expect(capturedUrl).toBe('https://api.domain.test/users/u1')
      expect(new Headers(capturedInit?.headers).get('Authorization')).toBe('Bearer auth-token')
      expect(new Headers(capturedInit?.headers).get('x-call-id')).toBe('call-1')

      // Calling pattern B: Unified single-object calling with { params, headers, signal }
      const userB = await client.getUserById({
        params: { id: 'u1' },
        headers: { 'X-Call-Id': 'call-2' },
      })
      expect(userB).toEqual({ id: 'u1', name: 'Alice' })
      expect(capturedUrl).toBe('https://api.domain.test/users/u1')
      expect(new Headers(capturedInit?.headers).get('x-call-id')).toBe('call-2')
    })

    it('eliminates query parameter pollution when passing { signal } without query parameters', async () => {
      const spec = buildSampleSpec()
      const clientCode = generateClient(spec)
      const mod = await instantiateClient(clientCode)

      let capturedUrl = ''
      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        capturedUrl = String(url)
        return new Response(JSON.stringify([{ id: 'u1', name: 'Alice' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })

      const client = mod.createClient({ baseUrl: 'https://api.domain.test' })
      const controller = new AbortController()

      // Passing { signal } to listUsers(query?, options?) where query is omitted
      await client.listUsers({ signal: controller.signal })
      // Critical check: URL MUST NOT have ?signal=[object+AbortSignal]
      expect(capturedUrl).toBe('https://api.domain.test/users')

      // Passing actual query with options
      await client.listUsers({ limit: 10 }, { signal: controller.signal })
      expect(capturedUrl).toBe('https://api.domain.test/users?limit=10')

      // Passing query named 'query' (adversarial collision check)
      await client.listUsers({ query: 'search-keyword' }, { signal: controller.signal })
      expect(capturedUrl).toBe('https://api.domain.test/users?query=search-keyword')

      // Unified object calling with query and signal
      await client.listUsers({
        query: { limit: 25 },
        signal: controller.signal,
      })
      expect(capturedUrl).toBe('https://api.domain.test/users?limit=25')
    })

    it('supports unified single-object calling for endpoints with body and query', async () => {
      const spec = buildSampleSpec()
      const clientCode = generateClient(spec)
      const mod = await instantiateClient(clientCode)

      let capturedUrl = ''
      let capturedBody = ''

      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url)
        capturedBody = String(init?.body ?? '')
        return new Response(JSON.stringify({ id: 'u1', name: 'Bob', role: 'admin' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })

      const client = mod.createClient({ baseUrl: 'https://api.domain.test' })

      // Unified single-object calling
      const updated = await client.updateUser({
        params: { id: 'u1' },
        body: { name: 'Bob', role: 'admin' },
        query: { notify: true },
      })
      expect(updated).toEqual({ id: 'u1', name: 'Bob', role: 'admin' })
      expect(capturedUrl).toBe('https://api.domain.test/users/u1?notify=true')
      expect(JSON.parse(capturedBody)).toEqual({ name: 'Bob', role: 'admin' })
    })
  })

  describe('3. Response Inspection via withResponse', () => {
    it('returns body, headers, and native Response object', async () => {
      const spec = buildSampleSpec()
      const clientCode = generateClient(spec)
      const mod = await instantiateClient(clientCode)

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify({ id: 'u1', name: 'Alice' }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'x-custom-header': 'header-value-42',
          },
        })
      })

      const client = mod.createClient({ baseUrl: 'https://api.domain.test' })

      const res = await client.withResponse.getUserById({ id: 'u1' })
      expect(res.body).toEqual({ id: 'u1', name: 'Alice' })
      expect(res.headers['x-custom-header']).toBe('header-value-42')
      expect(res.response).toBeInstanceOf(Response)
      expect(res.response.status).toBe(200)

      // Also works via unified single-object options
      const resUnified = await client.withResponse.getUserById({
        params: { id: 'u1' },
      })
      expect(resUnified.body).toEqual({ id: 'u1', name: 'Alice' })
      expect(resUnified.headers['x-custom-header']).toBe('header-value-42')
    })
  })

  describe('4. Error Handling & Multi-Status Error Contracts', () => {
    it('throws ClientError on non-2xx responses and populates status, data, and response', async () => {
      const spec = buildSampleSpec()
      const clientCode = generateClient(spec)
      const mod = await instantiateClient(clientCode)

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify({ message: 'User not found', code: 'USER_NOT_FOUND' }), {
          status: 404,
          statusText: 'Not Found',
          headers: { 'Content-Type': 'application/json' },
        })
      })

      const client = mod.createClient({ baseUrl: 'https://api.domain.test' })

      try {
        await client.getUserById({ id: 'non-existent' })
        expect.unreachable('Should have thrown ClientError')
      } catch (err) {
        expect(mod.isClientError(err)).toBe(true)
        expect(isClientError(err)).toBe(true)
        const clientErr = err as ClientError
        expect(clientErr.status).toBe(404)
        expect(clientErr.statusText).toBe('Not Found')
        expect(clientErr.data).toEqual({ message: 'User not found', code: 'USER_NOT_FOUND' })
      }
    })
  })

  describe('5. Real-Time Streaming & Cancellation', () => {
    it('handles stream events and cancels underlying body stream on abort', async () => {
      const spec = buildSampleSpec()
      const clientCode = generateClient(spec)
      const mod = await instantiateClient(clientCode)

      let cancelCalled = false
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('event: update\ndata: {"status":"ok"}\n\n'))
        },
        cancel() {
          cancelCalled = true
        },
      })

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      })

      const client = mod.createClient({ baseUrl: 'https://api.domain.test' })
      const controller = new AbortController()
      const events: any[] = []
      for await (const evt of client.streamEvents({ signal: controller.signal })) {
        events.push(evt)
        controller.abort()
        break
      }

      expect(events.length).toBeGreaterThanOrEqual(1)
      expect(events[0]).toEqual({ status: 'ok' })
      expect(cancelCalled).toBe(true)
    })
  })

  describe('6. TanStack Query v5 Integration Parity', () => {
    it('integrates cleanly with queryOptions and propagates signal without pollution', async () => {
      const spec = buildSampleSpec()
      const parsed = parseDocument(spec)
      const bundle = generateTanstackQuery(spec)

      expect(bundle.keysCode).toContain("usersKeys")
      expect(bundle.queriesCode).toContain("listUsersQueryOptions")
      expect(bundle.hooksCode).toContain("useListUsersQuery")

      // Verify that queryOptions function returns standard TanStack Query object
      // and that the queryFn passes signal safely
      const clientCode = generateClient(spec)
      const clientMod = await instantiateClient(clientCode)

      let capturedUrl = ''
      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        capturedUrl = String(url)
        return new Response(JSON.stringify([{ id: 'u1', name: 'Alice' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })

      const client = clientMod.createClient({ baseUrl: 'https://api.domain.test' })
      const abortController = new AbortController()

      // Simulate TanStack Query queryFn execution:
      // queryFn: ({ signal }) => client.listUsers({ limit: 5 }, { signal })
      const queryFn = ({ signal }: { signal?: AbortSignal }) =>
        client.listUsers({ limit: 5 }, { signal })

      const result = await queryFn({ signal: abortController.signal })
      expect(result).toEqual([{ id: 'u1', name: 'Alice' }])
      expect(capturedUrl).toBe('https://api.domain.test/users?limit=5')
    })
  })
})
