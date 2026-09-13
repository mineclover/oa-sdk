import { describe, it, expect, vi, afterEach } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import { parseDocument } from '@oa-sdk/parser'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { generateClient } from '../generate-client.js'
import { generateTanstackQuery } from '../tanstack/generate-tanstack.js'

function doc(overrides: Partial<OasDocument> = {}): OasDocument {
  return { openapi: '3.2.0', info: { title: 'Empirical Challenger Stress API', version: '2.0.0' }, paths: {}, ...overrides } as OasDocument
}

async function importGeneratedClient(code: string): Promise<Record<string, any>> {
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

function instantiateTanstackModule(code: string): Record<string, any> {
  const js = transpileModule(code, {
    compilerOptions: {
      module: ModuleKind.CommonJS,
      target: ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  }).outputText

  const fakeQueryPackage = {
    queryOptions: (opt: any) => opt,
    mutationOptions: (opt: any) => opt,
    infiniteQueryOptions: (opt: any) => opt,
    useQuery: () => {},
    useMutation: () => {},
    useInfiniteQuery: () => {},
  }

  const moduleObj = { exports: {} as any }
  const fakeRequire = (mod: string) => {
    if (mod === '@tanstack/react-query') return fakeQueryPackage
    return {}
  }

  const fn = new Function('require', 'exports', 'module', js)
  fn(fakeRequire, moduleObj.exports, moduleObj)
  return moduleObj.exports
}

describe('Adversarial Challenge Suite: Requirement R3 — AbortSignal & RequestInit Pipeline', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  const comprehensiveSpec = doc({
    paths: {
      '/items': {
        get: {
          operationId: 'listItems',
          'x-oa-sdk-retryable': true,
          parameters: [
            { name: 'query', in: 'query', schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer' } },
            { name: 'X-Op-Header', in: 'header', schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'OK',
              headers: {
                'X-Total-Count': { schema: { type: 'integer' } },
              },
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { type: 'object', properties: { id: { type: 'string' } } },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: 'createItem',
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
      '/items/{id}': {
        get: {
          operationId: 'getItem',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'detail', in: 'query', schema: { type: 'boolean' } },
            { name: 'X-Trace-Id', in: 'header', schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'OK',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
      '/health': {
        get: {
          operationId: 'getHealth',
          responses: {
            '200': {
              description: 'Healthy',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
      '/events': {
        get: {
          operationId: 'streamEvents',
          responses: {
            '200': {
              description: 'SSE stream',
              content: { 'text/event-stream': { schema: { type: 'object' } } },
            },
          },
        },
      },
      '/logs': {
        get: {
          operationId: 'streamLogs',
          responses: {
            '200': {
              description: 'NDJSON stream',
              content: { 'application/x-ndjson': { schema: { type: 'object' } } },
            },
          },
        },
      },
    },
  })

  // ─────────────────────────────────────────────────────────────
  // 1. Mid-flight Cancellation
  // ─────────────────────────────────────────────────────────────
  describe('1. Mid-flight Cancellation & Active Signal Abort', () => {
    it('calling controller.abort() mid-flight during fetch throws AbortError', async () => {
      const code = generateClient(comprehensiveSpec)
      const { createClient } = await importGeneratedClient(code)
      const client = createClient({ baseUrl: 'https://api.example.com' })

      let signalCaptured: AbortSignal | null | undefined
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        signalCaptured = init?.signal
        return new Promise((_, reject) => {
          if (init?.signal?.aborted) {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
            return
          }
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        })
      }) as typeof fetch

      const controller = new AbortController()
      const reqPromise = client.listItems({ query: 'active' }, undefined, { signal: controller.signal })

      expect(signalCaptured).toBeDefined()
      expect(signalCaptured?.aborted).toBe(false)

      controller.abort()

      await expect(reqPromise).rejects.toThrow('The operation was aborted.')
      expect(signalCaptured?.aborted).toBe(true)
    })

    it('calling controller.abort() mid-flight in withResponse throws AbortError', async () => {
      const code = generateClient(comprehensiveSpec)
      const { createClient } = await importGeneratedClient(code)
      const client = createClient({ baseUrl: 'https://api.example.com' })

      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        })
      }) as typeof fetch

      const controller = new AbortController()
      const reqPromise = client.withResponse.listItems({ query: 'active' }, undefined, { signal: controller.signal })

      controller.abort()
      await expect(reqPromise).rejects.toThrow('The operation was aborted.')
    })

    it('calling controller.abort() terminates an active SSE stream mid-flight', async () => {
      const code = generateClient(comprehensiveSpec)
      const { createClient } = await importGeneratedClient(code)
      const client = createClient({ baseUrl: 'https://api.example.com' })

      let signalCaptured: AbortSignal | null | undefined
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        signalCaptured = init?.signal
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"id":1}\n\n'))
            init?.signal?.addEventListener('abort', () => {
              controller.error(new DOMException('The user aborted a request.', 'AbortError'))
            })
          },
        })
        return Promise.resolve(new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }))
      }) as typeof fetch

      const controller = new AbortController()
      const items: any[] = []

      await expect(async () => {
        for await (const event of client.streamEvents({ signal: controller.signal })) {
          items.push(event)
          controller.abort() // abort on first received item
        }
      }).rejects.toThrow('The user aborted a request.')

      expect(items).toEqual([{ id: 1 }])
      expect(signalCaptured?.aborted).toBe(true)
    })

    it('isolates signals across concurrent parallel requests', async () => {
      const code = generateClient(comprehensiveSpec)
      const { createClient } = await importGeneratedClient(code)
      const client = createClient({ baseUrl: 'https://api.example.com' })

      globalThis.fetch = ((url: string, init?: RequestInit) => {
        return new Promise((resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'))
            return
          }
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
          if (url.includes('query=req-b')) {
            setTimeout(() => {
              resolve(new Response(JSON.stringify([{ id: 'b-done' }]), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }))
            }, 50)
          }
        })
      }) as typeof fetch

      const controllerA = new AbortController()
      const controllerB = new AbortController()

      const reqA = client.listItems({ query: 'req-a' }, undefined, { signal: controllerA.signal })
      const reqB = client.listItems({ query: 'req-b' }, undefined, { signal: controllerB.signal })

      // Abort only request A
      controllerA.abort()

      await expect(reqA).rejects.toThrow('Aborted')
      const resultB = await reqB
      expect(resultB).toEqual([{ id: 'b-done' }])
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 2. Pre-aborted Signal
  // ─────────────────────────────────────────────────────────────
  describe('2. Pre-aborted Signal Immediate Rejection', () => {
    it('rejects immediately when passed an already aborted signal', async () => {
      const code = generateClient(comprehensiveSpec)
      const { createClient } = await importGeneratedClient(code)
      const client = createClient({ baseUrl: 'https://api.example.com' })

      let fetchInvoked = false
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        fetchInvoked = true
        if (init?.signal?.aborted) {
          return Promise.reject(new DOMException('Pre-aborted request rejected', 'AbortError'))
        }
        return Promise.resolve(new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }) as typeof fetch

      const preAborted = AbortSignal.abort()
      await expect(client.listItems(undefined, undefined, { signal: preAborted }))
        .rejects.toThrow('Pre-aborted request rejected')
      expect(fetchInvoked).toBe(true)
    })

    it('rejects pre-aborted signal in SSE stream before stream iteration', async () => {
      const code = generateClient(comprehensiveSpec)
      const { createClient } = await importGeneratedClient(code)
      const client = createClient({ baseUrl: 'https://api.example.com' })

      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        if (init?.signal?.aborted) {
          return Promise.reject(new DOMException('Stream aborted early', 'AbortError'))
        }
        return Promise.resolve(new Response('data: {}\n\n', { status: 200 }))
      }) as typeof fetch

      const preAborted = AbortSignal.abort()
      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of client.streamEvents({ signal: preAborted })) {
          // should not yield
        }
      }).rejects.toThrow('Stream aborted early')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 3. Dual Timeout & Signal Combination
  // ─────────────────────────────────────────────────────────────
  describe('3. Dual Timeout & Signal Combination', () => {
    it('aborts when user signal fires before client timeout', async () => {
      const code = generateClient(comprehensiveSpec)
      const { createClient } = await importGeneratedClient(code)
      const client = createClient({ baseUrl: 'https://api.example.com', timeout: 5000 })

      let capturedSignal: AbortSignal | null | undefined
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        capturedSignal = init?.signal
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted by caller', 'AbortError'))
          })
        })
      }) as typeof fetch

      const controller = new AbortController()
      const req = client.listItems(undefined, undefined, { signal: controller.signal })

      controller.abort()
      await expect(req).rejects.toThrow('Aborted by caller')
      expect(capturedSignal?.aborted).toBe(true)
    })

    it('aborts when client timeout fires before user signal', async () => {
      const code = generateClient(comprehensiveSpec)
      const { createClient } = await importGeneratedClient(code)
      const client = createClient({ baseUrl: 'https://api.example.com', timeout: 25 })

      let capturedSignal: AbortSignal | null | undefined
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        capturedSignal = init?.signal
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted by timeout', 'AbortError'))
          })
        })
      }) as typeof fetch

      const controller = new AbortController()
      const req = client.listItems(undefined, undefined, { signal: controller.signal })

      // do NOT abort controller; let timeout expire
      await expect(req).rejects.toThrow('Aborted by timeout')
      expect(capturedSignal?.aborted).toBe(true)
      expect(controller.signal.aborted).toBe(false) // user signal was not aborted
    })

    it('does not retry when request fails due to aborted signal on retryable endpoint', async () => {
      const code = generateClient(comprehensiveSpec)
      const { createClient } = await importGeneratedClient(code)
      const client = createClient({ baseUrl: 'https://api.example.com', retries: 3 })

      let attempts = 0
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        attempts++
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted during first attempt', 'AbortError'))
          })
        })
      }) as typeof fetch

      const controller = new AbortController()
      const req = client.listItems(undefined, undefined, { signal: controller.signal })

      controller.abort()
      await expect(req).rejects.toThrow('Aborted during first attempt')
      expect(attempts).toBe(1) // must NOT retry when aborted
    })

    it('works under fallback signal combination when AbortSignal.any is undefined', async () => {
      // Simulate environment without AbortSignal.any
      const originalAny = (AbortSignal as any).any
      try {
        delete (AbortSignal as any).any

        const code = generateClient(comprehensiveSpec)
        const { createClient } = await importGeneratedClient(code)
        const client = createClient({ baseUrl: 'https://api.example.com', timeout: 50 })

        globalThis.fetch = ((_url: string, init?: RequestInit) => {
          return new Promise((_, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Fallback aborted', 'AbortError'))
            })
          })
        }) as typeof fetch

        const controller = new AbortController()
        const req = client.listItems(undefined, undefined, { signal: controller.signal })

        controller.abort()
        await expect(req).rejects.toThrow('Fallback aborted')
      } finally {
        (AbortSignal as any).any = originalAny
      }
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 4. TanStack Query Signal Forwarding
  // ─────────────────────────────────────────────────────────────
  describe('4. TanStack Query Signal Forwarding', () => {
    it('forwards queryFn({ signal }) to client method and aborts upon query cancellation', async () => {
      const parsed = parseDocument(comprehensiveSpec)
      const clientCode = generateClient(parsed)
      const { createClient } = await importGeneratedClient(clientCode)
      const client = createClient({ baseUrl: 'https://api.example.com' })

      const { combinedCode } = generateTanstackQuery(parsed)
      const tanstackModule = instantiateTanstackModule(combinedCode)

      let capturedSignal: AbortSignal | null | undefined
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        capturedSignal = init?.signal
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('TanStack query aborted', 'AbortError'))
          })
        })
      }) as typeof fetch

      // Create queryOptions for getItem (pathParam: id, query: detail, headers: X-Trace-Id)
      const queryOpts = tanstackModule.getItemQueryOptions(client, { id: 'item_42' }, { detail: true })
      expect(queryOpts.queryKey).toEqual(['items', 'detail', 'item_42', { detail: true }])
      expect(typeof queryOpts.queryFn).toBe('function')

      const controller = new AbortController()
      const queryPromise = queryOpts.queryFn({ signal: controller.signal })

      expect(capturedSignal).toBeDefined()
      expect(capturedSignal?.aborted).toBe(false)

      controller.abort()
      await expect(queryPromise).rejects.toThrow('TanStack query aborted')
      expect(capturedSignal?.aborted).toBe(true)
    })

    it('forwards signal through infinite query options queryFn', async () => {
      const parsed = parseDocument(comprehensiveSpec)
      const clientCode = generateClient(parsed)
      const { createClient } = await importGeneratedClient(clientCode)
      const client = createClient({ baseUrl: 'https://api.example.com' })

      const { combinedCode } = generateTanstackQuery(parsed)
      const tanstackModule = instantiateTanstackModule(combinedCode)

      let capturedSignal: AbortSignal | null | undefined
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        capturedSignal = init?.signal
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Infinite query aborted', 'AbortError'))
          })
        })
      }) as typeof fetch

      const infiniteOpts = tanstackModule.listItemsInfiniteQueryOptions(client, { query: 'test' })
      expect(typeof infiniteOpts.queryFn).toBe('function')

      const controller = new AbortController()
      const infinitePromise = infiniteOpts.queryFn({ pageParam: 2, signal: controller.signal })

      expect(capturedSignal).toBeDefined()
      controller.abort()
      await expect(infinitePromise).rejects.toThrow('Infinite query aborted')
      expect(capturedSignal?.aborted).toBe(true)
    })

    it('forwards signal on operations with no parameters (getHealth)', async () => {
      const parsed = parseDocument(comprehensiveSpec)
      const clientCode = generateClient(parsed)
      const { createClient } = await importGeneratedClient(clientCode)
      const client = createClient({ baseUrl: 'https://api.example.com' })

      const { combinedCode } = generateTanstackQuery(parsed)
      const tanstackModule = instantiateTanstackModule(combinedCode)

      let capturedSignal: AbortSignal | null | undefined
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        capturedSignal = init?.signal
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Health check aborted', 'AbortError'))
          })
        })
      }) as typeof fetch

      const healthOpts = tanstackModule.getHealthQueryOptions(client)
      const controller = new AbortController()
      const healthPromise = healthOpts.queryFn({ signal: controller.signal })

      expect(capturedSignal).toBeDefined()
      controller.abort()
      await expect(healthPromise).rejects.toThrow('Health check aborted')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 5. Custom Header Overrides & Precedence
  // ─────────────────────────────────────────────────────────────
  describe('5. Custom Header Overrides & Precedence Pipeline', () => {
    it('applies 3-tier precedence: defaultHeaders < op headers < options.headers with case-insensitivity', async () => {
      const code = generateClient(comprehensiveSpec)
      const { createClient } = await importGeneratedClient(code)
      const client = createClient({
        baseUrl: 'https://api.example.com',
        headers: {
          'X-Client-Version': '1.0.0',
          'Authorization': 'Bearer default-token',
          'X-Tier-Test': 'tier-default',
        },
      })

      let capturedHeaders: Record<string, string> = {}
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        if (init?.headers instanceof Headers) {
          capturedHeaders = Object.fromEntries(init.headers.entries())
        }
        return Promise.resolve(new Response('[]', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      }) as typeof fetch

      await client.listItems(
        { query: 'test' },
        { 'X-Op-Header': 'op-header-val' },
        {
          headers: {
            'AUTHORIZATION': 'Bearer user-overridden-token',
            'x-tier-test': 'tier-option-override',
            'X-Trace-Id': 'trace-999',
          },
        },
      )

      // In Headers, keys are normalized to lowercase
      expect(capturedHeaders['x-client-version']).toBe('1.0.0') // preserved from default
      expect(capturedHeaders['x-op-header']).toBe('op-header-val') // from operation parameter
      expect(capturedHeaders['authorization']).toBe('Bearer user-overridden-token') // overridden by options.headers
      expect(capturedHeaders['x-tier-test']).toBe('tier-option-override') // overridden by options.headers
      expect(capturedHeaders['x-trace-id']).toBe('trace-999') // injected by options.headers
    })

    it('propagates custom headers through withResponse call', async () => {
      const code = generateClient(comprehensiveSpec)
      const { createClient } = await importGeneratedClient(code)
      const client = createClient({ baseUrl: 'https://api.example.com' })

      let capturedHeaders: Record<string, string> = {}
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        if (init?.headers instanceof Headers) {
          capturedHeaders = Object.fromEntries(init.headers.entries())
        }
        return Promise.resolve(new Response('[]', {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'X-Total-Count': '10' },
        }))
      }) as typeof fetch

      const res = await client.withResponse.listItems(
        undefined,
        undefined,
        { headers: { 'X-Audit-User': 'admin' } },
      )

      expect(res.status ?? res.response.status).toBe(200)
      expect(capturedHeaders['x-audit-user']).toBe('admin')
    })

    it('propagates custom headers through SSE streaming call', async () => {
      const code = generateClient(comprehensiveSpec)
      const { createClient } = await importGeneratedClient(code)
      const client = createClient({ baseUrl: 'https://api.example.com' })

      let capturedHeaders: Record<string, string> = {}
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        if (init?.headers instanceof Headers) {
          capturedHeaders = Object.fromEntries(init.headers.entries())
        }
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"event":"ready"}\n\n'))
            controller.close()
          },
        })
        return Promise.resolve(new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }))
      }) as typeof fetch

      const received: any[] = []
      for await (const item of client.streamEvents({ headers: { 'Last-Event-ID': '42' } })) {
        received.push(item)
      }

      expect(received).toEqual([{ event: 'ready' }])
      expect(capturedHeaders['accept']).toBe('text/event-stream')
      expect(capturedHeaders['last-event-id']).toBe('42')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 6. Options Robustness & Edge Cases
  // ─────────────────────────────────────────────────────────────
  describe('6. Options Robustness & Non-Breaking API Conformance', () => {
    it('handles omitted options gracefully without throwing', async () => {
      const code = generateClient(comprehensiveSpec)
      const { createClient } = await importGeneratedClient(code)
      const client = createClient({ baseUrl: 'https://api.example.com' })

      globalThis.fetch = (() => {
        return Promise.resolve(new Response('[]', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      }) as typeof fetch

      // Call listItems without options
      const res = await client.listItems({ query: 'hello' })
      expect(res).toEqual([])
    })

    it('handles empty options object {} cleanly', async () => {
      const code = generateClient(comprehensiveSpec)
      const { createClient } = await importGeneratedClient(code)
      const client = createClient({ baseUrl: 'https://api.example.com' })

      globalThis.fetch = (() => {
        return Promise.resolve(new Response('[]', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      }) as typeof fetch

      const res = await client.listItems(undefined, undefined, {})
      expect(res).toEqual([])
    })

    it('handles POST request with body and options.signal cleanly', async () => {
      const code = generateClient(comprehensiveSpec)
      const { createClient } = await importGeneratedClient(code)
      const client = createClient({ baseUrl: 'https://api.example.com' })

      let capturedBody: string | undefined
      let capturedSignal: AbortSignal | null | undefined
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        capturedBody = init?.body as string
        capturedSignal = init?.signal
        return Promise.resolve(new Response('{"id":"item_new"}', {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }))
      }) as typeof fetch

      const controller = new AbortController()
      const res = await client.createItem({ name: 'New Item' }, { signal: controller.signal })

      expect(res).toEqual({ id: 'item_new' })
      expect(capturedBody).toBe(JSON.stringify({ name: 'New Item' }))
      expect(capturedSignal).toBeDefined()
      expect(capturedSignal?.aborted).toBe(false)
    })
  })
})
