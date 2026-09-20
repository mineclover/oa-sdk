import { describe, it, expect, vi } from 'vitest'
import type { OasDocument, OasOperation } from '@oa-sdk/parser'
import { parseDocument } from '@oa-sdk/parser'
import { ModuleKind, ScriptTarget, transpileModule, createSourceFile, createCompilerHost, createProgram, getPreEmitDiagnostics } from 'typescript'
import { generateClient } from '../generate-client.js'
import { detectPagination, generateOptionsFactory } from '../tanstack/options-factory-generator.js'
import { generateHookFactory } from '../tanstack/hook-factory-generator.js'
import { generateTanstackQuery } from '../tanstack/generate-tanstack.js'

function doc(overrides: Partial<OasDocument> = {}): OasDocument {
  return { openapi: '3.2.0', info: { title: 'Test API', version: '1.0.0' }, paths: {}, ...overrides } as OasDocument
}

async function importGeneratedClient(code: string): Promise<{ createClient: (config?: unknown) => Record<string, any> }> {
  const js = transpileModule(code, {
    compilerOptions: {
      module: ModuleKind.ES2022,
      target: ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  }).outputText
  const url = `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
  return await import(url) as { createClient: (config?: unknown) => Record<string, any> }
}

describe('Milestone 2 — R3: AbortSignal & RequestInit Pass-Through Pipeline', () => {
  const sampleSpec = doc({
    paths: {
      '/items': {
        get: {
          operationId: 'listItems',
          parameters: [
            { name: 'query', in: 'query', schema: { type: 'string' } },
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
    },
  })

  it('aborts in-flight fetch request when AbortController aborts mid-flight', async () => {
    const code = generateClient(sampleSpec)
    const { createClient } = await importGeneratedClient(code)

    const originalFetch = globalThis.fetch
    let capturedSignal: AbortSignal | undefined

    globalThis.fetch = ((url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined
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

    try {
      const client = createClient({ baseUrl: 'https://api.example.com' })
      const controller = new AbortController()

      const requestPromise = client.listItems({ query: 'test' }, undefined, { signal: controller.signal })

      expect(capturedSignal).toBeDefined()
      expect(capturedSignal?.aborted).toBe(false)

      // Trigger abort mid-flight
      controller.abort()

      await expect(requestPromise).rejects.toThrow('The operation was aborted.')
      expect(capturedSignal?.aborted).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('rejects immediately with pre-aborted signal without network delay', async () => {
    const code = generateClient(sampleSpec)
    const { createClient } = await importGeneratedClient(code)

    const originalFetch = globalThis.fetch
    let fetchCalled = false

    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      fetchCalled = true
      if (init?.signal?.aborted) {
        return Promise.reject(new DOMException('This operation was aborted', 'AbortError'))
      }
      return Promise.resolve(new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }) as typeof fetch

    try {
      const client = createClient({ baseUrl: 'https://api.example.com' })
      const controller = new AbortController()
      controller.abort()

      await expect(client.listItems(undefined, undefined, { signal: controller.signal })).rejects.toThrow()
      expect(fetchCalled).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('combines timeout and caller AbortSignal so either can abort', async () => {
    const code = generateClient(sampleSpec)
    const { createClient } = await importGeneratedClient(code)

    const originalFetch = globalThis.fetch
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      return new Promise((_, reject) => {
        if (init?.signal?.aborted) {
          reject(new DOMException('Aborted by signal', 'AbortError'))
          return
        }
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted by signal', 'AbortError'))
        })
      })
    }) as typeof fetch

    try {
      // 1. Aborted by caller signal before timeout
      const clientWithTimeout = createClient({ baseUrl: 'https://api.example.com', timeout: 10000 })
      const controller = new AbortController()

      const callerPromise = clientWithTimeout.listItems(undefined, undefined, { signal: controller.signal })
      controller.abort()
      await expect(callerPromise).rejects.toThrow('Aborted by signal')

      // 2. Aborted by timeout when caller signal does not fire
      const clientShortTimeout = createClient({ baseUrl: 'https://api.example.com', timeout: 20 })
      const slowPromise = clientShortTimeout.listItems(undefined, undefined, {})
      await expect(slowPromise).rejects.toThrow('Aborted by signal')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('merges custom options.headers with default headers and operation headers', async () => {
    const code = generateClient(sampleSpec)
    const { createClient } = await importGeneratedClient(code)

    const originalFetch = globalThis.fetch
    let capturedHeaders: Record<string, string> = {}

    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      if (init?.headers instanceof Headers) {
        capturedHeaders = Object.fromEntries(init.headers.entries())
      } else {
        capturedHeaders = (init?.headers as Record<string, string>) || {}
      }
      return Promise.resolve(new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }) as typeof fetch

    try {
      const client = createClient({
        baseUrl: 'https://api.example.com',
        headers: {
          'X-Default': 'default-1',
          'Authorization': 'Bearer token-default',
        },
      })

      await client.listItems(
        { query: 'test' },
        { 'X-Op-Header': 'op-value' },
        {
          headers: {
            'X-Custom': 'custom-123',
            'Authorization': 'Bearer token-override',
          },
        },
      )

      expect(capturedHeaders['x-default']).toBe('default-1')
      expect(capturedHeaders['x-op-header']).toBe('op-value')
      expect(capturedHeaders['x-custom']).toBe('custom-123')
      expect(capturedHeaders['authorization']).toBe('Bearer token-override')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('forwards signal and headers in withResponse methods', async () => {
    const code = generateClient(sampleSpec)
    const { createClient } = await importGeneratedClient(code)

    const originalFetch = globalThis.fetch
    let capturedSignal: AbortSignal | undefined
    let capturedHeaders: Record<string, string> = {}

    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined
      if (init?.headers instanceof Headers) {
        capturedHeaders = Object.fromEntries(init.headers.entries())
      } else {
        capturedHeaders = (init?.headers as Record<string, string>) || {}
      }
      return Promise.resolve(new Response('[]', {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Total-Count': '42' },
      }))
    }) as typeof fetch

    try {
      const client = createClient({ baseUrl: 'https://api.example.com' })
      const controller = new AbortController()

      const res = await client.withResponse.listItems(
        undefined,
        undefined,
        {
          signal: controller.signal,
          headers: { 'X-With-Response': 'active' },
        },
      )

      expect(capturedSignal).toBe(controller.signal)
      expect(capturedHeaders['x-with-response']).toBe('active')
      expect(res.body).toEqual([])
      expect(res.response.status).toBe(200)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('forwards signal and headers in streaming methods', async () => {
    const code = generateClient(sampleSpec)
    const { createClient } = await importGeneratedClient(code)

    const originalFetch = globalThis.fetch
    let capturedSignal: AbortSignal | undefined
    let capturedHeaders: Record<string, string> = {}

    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined
      if (init?.headers instanceof Headers) {
        capturedHeaders = Object.fromEntries(init.headers.entries())
      } else {
        capturedHeaders = (init?.headers as Record<string, string>) || {}
      }
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"message":"hello"}\n\n'))
          c.close()
        },
      })
      return Promise.resolve(new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }))
    }) as typeof fetch

    try {
      const client = createClient({ baseUrl: 'https://api.example.com' })
      const controller = new AbortController()

      const stream = client.streamEvents({
        signal: controller.signal,
        headers: { 'X-Stream-Auth': 'secret' },
      })

      const items: any[] = []
      for await (const item of stream) {
        items.push(item)
      }

      expect(items).toEqual([{ message: 'hello' }])
      expect(capturedSignal).toBe(controller.signal)
      expect(capturedHeaders['x-stream-auth']).toBe('secret')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('TanStack Query queryFn forwards signal into client method', async () => {
    const doc = parseDocument(sampleSpec)
    const optionsCode = generateOptionsFactory(doc, { banner: false })

    expect(optionsCode).toContain('queryFn: async ({ signal }): Promise<JsonPrimitive<unknown>> => {')
    expect(optionsCode).toContain('return client.listItems(query, headers, { signal })')

    // Simple textual confirmation of signal pass-through pipeline in emitted options
    expect(optionsCode).toMatch(/queryFn:\s*async\s*\(\{\s*signal\s*\}\)/)
    expect(optionsCode).toMatch(/client\.listItems\(query,\s*headers,\s*\{\s*signal\s*\}\)/)
  })
})

describe('Milestone 2 — R4: TanStack Query Infinite Query Generator', () => {
  const paginationSpec = doc({
    paths: {
      '/page-items': {
        get: {
          operationId: 'listPageItems',
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'category', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Page list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      items: { type: 'array', items: { type: 'string' } },
                      total: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/offset-items': {
        get: {
          operationId: 'listOffsetItems',
          parameters: [
            { name: 'offset', in: 'query', schema: { type: 'integer' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            '200': {
              description: 'Offset list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      items: { type: 'array', items: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/cursor-items': {
        get: {
          operationId: 'listCursorItems',
          parameters: [
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            '200': {
              description: 'Cursor list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      items: { type: 'array', items: { type: 'string' } },
                      next_cursor: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/after-items': {
        get: {
          operationId: 'listAfterItems',
          parameters: [
            { name: 'starting_after', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            '200': {
              description: 'After list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { type: 'string' } },
                      has_more: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/non-paginated': {
        get: {
          operationId: 'getSummary',
          responses: {
            '200': {
              description: 'Summary',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
        post: {
          operationId: 'createSummary',
          requestBody: {
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          responses: {
            '200': { description: 'Created' },
          },
        },
      },
    },
  })

  describe('detectPagination', () => {
    const doc = parseDocument(paginationSpec)

    it('detects page pagination correctly', () => {
      const op = doc.operations.find(o => o.operationId === 'listPageItems')!
      const info = detectPagination(op)
      expect(info).toEqual({
        type: 'page',
        paramName: 'page',
        limitName: 'limit',
      })
    })

    it('detects offset pagination correctly', () => {
      const op = doc.operations.find(o => o.operationId === 'listOffsetItems')!
      const info = detectPagination(op)
      expect(info).toEqual({
        type: 'offset',
        paramName: 'offset',
        limitName: 'limit',
      })
    })

    it('detects cursor pagination with "cursor" param', () => {
      const op = doc.operations.find(o => o.operationId === 'listCursorItems')!
      const info = detectPagination(op)
      expect(info).toEqual({
        type: 'cursor',
        paramName: 'cursor',
        limitName: 'limit',
      })
    })

    it('detects cursor pagination with "starting_after" param', () => {
      const op = doc.operations.find(o => o.operationId === 'listAfterItems')!
      const info = detectPagination(op)
      expect(info).toEqual({
        type: 'cursor',
        paramName: 'starting_after',
        limitName: 'limit',
      })
    })

    it('returns null for unpaginated GET operations', () => {
      const op = doc.operations.find(o => o.operationId === 'getSummary')!
      expect(detectPagination(op)).toBeNull()
    })

    it('returns null for non-GET operations even if they have page-like fields', () => {
      const op = doc.operations.find(o => o.operationId === 'createSummary')!
      expect(detectPagination(op)).toBeNull()
    })
  })

  describe('Tier 2: Infinite Query Options Factory', () => {
    const doc = parseDocument(paginationSpec)
    const optionsCode = generateOptionsFactory(doc, { banner: false })

    it('imports infiniteQueryOptions and infinite types from queryPackage', () => {
      expect(optionsCode).toContain('import { queryOptions, mutationOptions, infiniteQueryOptions }')
      expect(optionsCode).toContain('UndefinedInitialDataInfiniteOptions')
      expect(optionsCode).toContain('InfiniteData')
    })

    it('emits page-based infinite query options with initialPageParam: 1', () => {
      expect(optionsCode).toContain('export function listPageItemsInfiniteQueryOptions<')
      expect(optionsCode).toContain('TData = InfiniteData<JsonPrimitive<unknown>>,')
      expect(optionsCode).toContain('TPageParam = number,')
      expect(optionsCode).toContain('initialPageParam: 1 as unknown as TPageParam,')
      expect(optionsCode).toContain('getNextPageParam: (lastPage: any, allPages: any[], lastPageParam: any): TPageParam | undefined => {')
      expect(optionsCode).toContain('totalPages = lastPage.totalPages ?? lastPage.total_pages')
      expect(optionsCode).toContain('client.listPageItems(pageQuery as any, { signal })')
    })

    it('emits offset-based infinite query options with initialPageParam: 0', () => {
      expect(optionsCode).toContain('export function listOffsetItemsInfiniteQueryOptions<')
      expect(optionsCode).toContain('initialPageParam: 0 as unknown as TPageParam,')
      expect(optionsCode).toContain('const total = lastPage.total ?? lastPage.total_count ?? lastPage.totalCount')
      expect(optionsCode).toContain('const nextOffset = currentOffset + (items ? items.length : 0)')
      expect(optionsCode).toContain('client.listOffsetItems(pageQuery as any, { signal })')
    })

    it('emits cursor-based infinite query options with initialPageParam: null', () => {
      expect(optionsCode).toContain('export function listCursorItemsInfiniteQueryOptions<')
      expect(optionsCode).toContain('TPageParam = string | null,')
      expect(optionsCode).toContain('initialPageParam: null as unknown as TPageParam,')
      expect(optionsCode).toContain('const nextCursor = lastPage.next_cursor ?? lastPage.nextCursor')
      expect(optionsCode).toContain('client.listCursorItems(pageQuery as any, { signal })')
    })

    it('does NOT emit infinite query options for unpaginated GET operations', () => {
      expect(optionsCode).toContain('export function getSummaryQueryOptions<')
      expect(optionsCode).not.toContain('getSummaryInfiniteQueryOptions')
    })
  })

  describe('Tier 3: Infinite Query Hook Factory', () => {
    const doc = parseDocument(paginationSpec)
    const hooksCode = generateHookFactory(doc, { banner: false })

    it('imports useInfiniteQuery and infinite hook types', () => {
      expect(hooksCode).toContain('useInfiniteQuery')
      expect(hooksCode).toContain('UseInfiniteQueryOptions')
      expect(hooksCode).toContain('UseInfiniteQueryResult')
      expect(hooksCode).toContain('InfiniteData')
    })

    it('emits standalone use*InfiniteQuery hooks', () => {
      expect(hooksCode).toContain('export function useListPageItemsInfiniteQuery<')
      expect(hooksCode).toContain('return useInfiniteQuery(')
      expect(hooksCode).toContain('listPageItemsInfiniteQueryOptions(client, query, options),')

      expect(hooksCode).toContain('export function useListCursorItemsInfiniteQuery<')
      expect(hooksCode).toContain('return useInfiniteQuery(')
      expect(hooksCode).toContain('listCursorItemsInfiniteQueryOptions(client, query, options),')
    })

    it('registers use*Infinite hooks in createApiHooks', () => {
      expect(hooksCode).toContain('useListPageItemsInfinite: <')
      expect(hooksCode).toContain('=> useListPageItemsInfiniteQuery(useClient(), query, options, queryClient),')

      expect(hooksCode).toContain('useListCursorItemsInfinite: <')
      expect(hooksCode).toContain('=> useListCursorItemsInfiniteQuery(useClient(), query, options, queryClient),')
    })

    it('does not register infinite hooks for unpaginated operations in createApiHooks', () => {
      expect(hooksCode).toContain('useGetSummary:')
      expect(hooksCode).not.toContain('useGetSummaryInfinite:')
    })
  })

  describe('Master Orchestrator: Combined File & TypeScript Validity', () => {
    it('emits unified imports in combined file when pagination is present', () => {
      const output = generateTanstackQuery(paginationSpec)
      expect(output.combinedCode).toContain('infiniteQueryOptions, useInfiniteQuery')
      expect(output.combinedCode).toContain('UndefinedInitialDataInfiniteOptions')
      expect(output.combinedCode).toContain('InfiniteData')
      expect(output.combinedCode).toContain('UseInfiniteQueryOptions')
      expect(output.combinedCode).toContain('UseInfiniteQueryResult')
    })

    it('omits infinite query imports when no pagination is present', () => {
      const nonPaginatedSpec = doc({
        paths: {
          '/status': {
            get: {
              operationId: 'getStatus',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      })
      const output = generateTanstackQuery(nonPaginatedSpec)
      expect(output.combinedCode).not.toContain('infiniteQueryOptions')
      expect(output.combinedCode).not.toContain('useInfiniteQuery')
      expect(output.combinedCode).not.toContain('InfiniteData')
    })

    it('transpiles combined code without syntax errors', () => {
      const output = generateTanstackQuery(paginationSpec, {
        typesImport: './types.js',
        clientImport: './client.js',
      })

      const cjsResult = transpileModule(output.combinedCode, {
        compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
      })
      expect(cjsResult.outputText).toContain('exports.listPageItemsInfiniteQueryOptions')
      expect(cjsResult.outputText).toContain('exports.useListPageItemsInfiniteQuery')

      const esmResult = transpileModule(output.combinedCode, {
        compilerOptions: { module: ModuleKind.ES2022, target: ScriptTarget.ES2022 },
      })
      expect(esmResult.outputText).toContain('export function listPageItemsInfiniteQueryOptions')
      expect(esmResult.outputText).toContain('export function useListPageItemsInfiniteQuery')
    })

    it('passes TypeScript compiler typecheck with zero syntax or duplicate declaration errors', () => {
      const output = generateTanstackQuery(paginationSpec)
      const fileName = 'test-infinite-query.ts'
      const sourceFile = createSourceFile(fileName, output.combinedCode, ScriptTarget.ES2022, true)
      const defaultHost = createCompilerHost({})
      const customHost = {
        ...defaultHost,
        getSourceFile: (name: string, lang: any) => (name === fileName ? sourceFile : defaultHost.getSourceFile(name, lang)),
        writeFile: () => {},
        fileExists: (name: string) => name === fileName || defaultHost.fileExists(name),
        readFile: (name: string) => (name === fileName ? output.combinedCode : defaultHost.readFile(name)),
      }
      const program = createProgram([fileName], { noEmit: true, target: ScriptTarget.ES2022, module: ModuleKind.ESNext }, customHost)
      const diagnostics = getPreEmitDiagnostics(program, sourceFile)

      // TS2451: Cannot redeclare block-scoped variable
      const ts2451Errors = diagnostics.filter(d => d.code === 2451)
      expect(ts2451Errors).toHaveLength(0)

      // Syntax error check
      const syntaxErrors = diagnostics.filter(d => d.category === 1 && d.code < 2000)
      expect(syntaxErrors).toHaveLength(0)
    }, 25_000)
  })
})
