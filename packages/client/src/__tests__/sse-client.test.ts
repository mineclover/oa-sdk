import { describe, it, expect } from 'vitest'
import { generateClient } from '../generate-client.js'
import type { OasDocument } from '@oa-sdk/parser'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'

function doc(overrides: Partial<OasDocument> = {}): OasDocument {
  return { openapi: '3.2.0', info: { title: 'T', version: '0' }, paths: {}, ...overrides } as OasDocument
}

async function importGeneratedClient(code: string): Promise<{ createClient: (config?: unknown) => Record<string, unknown> }> {
  const js = transpileModule(code, {
    compilerOptions: {
      module: ModuleKind.ES2022,
      target: ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  }).outputText
  const url = `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
  return await import(url) as { createClient: (config?: unknown) => Record<string, unknown> }
}

function streamingSpec(): OasDocument {
  return doc({
    paths: {
      '/events': {
        get: {
          operationId: 'streamEvents',
          responses: { '200': { description: 'SSE', content: { 'text/event-stream': { itemSchema: { type: 'object' } } } } },
        },
      },
      '/logs': {
        get: {
          operationId: 'streamLogs',
          responses: { '200': { description: 'NDJSON', content: { 'application/x-ndjson': { schema: { type: 'object' } } } } },
        },
      },
    },
  })
}

function responseWithChunks(chunks: readonly string[], onCancel?: () => void): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
    cancel() {
      onCancel?.()
    },
  })
  return new Response(body, { status: 200 })
}

describe('SSE streaming client', () => {
  it('text/event-stream → async generator using streamSse', () => {
    const code = generateClient(doc({
      paths: {
        '/events': {
          get: {
            operationId: 'streamEvents',
            responses: {
              '200': {
                description: 'SSE',
                content: { 'text/event-stream': { itemSchema: { type: 'object' } } },
              },
            },
          },
        },
      },
    }))
    expect(code).toContain('async *streamEvents')
    expect(code).toContain('AsyncGenerator')
    expect(code).toContain("yield* streamSse('GET'")
    expect(code).toContain("yield* streamSse('GET', '/events',")
    expect(code).toContain('"streamEvents", {})')
  })

  it('application/x-ndjson → async generator using streamNdjson', () => {
    const code = generateClient(doc({
      paths: {
        '/logs': {
          get: {
            operationId: 'streamLogs',
            responses: {
              '200': {
                description: 'NDJSON',
                content: { 'application/x-ndjson': { schema: { type: 'object' } } },
              },
            },
          },
        },
      },
    }))
    expect(code).toContain('async *streamLogs')
    expect(code).toContain("yield* streamNdjson('GET'")
  })

  it('application/jsonl → async generator using streamNdjson', () => {
    const code = generateClient(doc({
      paths: {
        '/logs': {
          get: {
            operationId: 'streamLogs',
            responses: {
              '200': {
                description: 'JSONL',
                content: { 'application/jsonl': { schema: { type: 'object' } } },
              },
            },
          },
        },
      },
    }))
    expect(code).toContain('async *streamLogs')
    expect(code).toContain("yield* streamNdjson('GET'")
  })

  it('일반 JSON → async (generator 아님)', () => {
    const code = generateClient(doc({
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { schema: { type: 'array' } } },
              },
            },
          },
        },
      },
    }))
    expect(code).toContain('async listUsers')
    expect(code).not.toContain('async *listUsers')
  })

  it('streamSse helper emitted for SSE ops', () => {
    const code = generateClient(doc({
      paths: {
        '/events': {
          get: {
            operationId: 'streamEvents',
            responses: { '200': { description: 'SSE', content: { 'text/event-stream': {} } } },
          },
        },
      },
    }))
    expect(code).toContain('async function* streamSse<T>')
    expect(code).toContain('getReader()')
    expect(code).toContain('[DONE]')
    expect(code).toContain('split(/\\r?\\n\\r?\\n/)')
    expect(code).toContain("filter(line => line.startsWith('data:'))")
  })

  it('streamNdjson helper emitted for NDJSON ops', () => {
    const code = generateClient(doc({
      paths: {
        '/logs': {
          get: {
            operationId: 'streamLogs',
            responses: { '200': { description: 'NDJSON', content: { 'application/x-ndjson': {} } } },
          },
        },
      },
    }))
    expect(code).toContain('async function* streamNdjson<T>')
    expect(code).toContain('getReader()')
    expect(code).not.toContain('[DONE]')
    expect(code).not.toContain('data: ')
    expect(code).toContain("split('\\n')")
  })

  it('no stream helper when no streaming ops', () => {
    const code = generateClient(doc({
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    expect(code).not.toContain('streamSse')
    expect(code).not.toContain('streamNdjson')
    expect(code).not.toContain('getReader()')
  })

  it('SSE without generated JSON response type uses unknown', () => {
    const code = generateClient(doc({
      paths: {
        '/events': {
          get: {
            operationId: 'streamEvents',
            responses: {
              '200': {
                description: 'SSE',
                content: { 'text/event-stream': { itemSchema: { type: 'object' } } },
              },
            },
          },
        },
      },
    }), { typesImport: './types' })
    expect(code).toContain('AsyncGenerator<unknown>')
    expect(code).not.toContain('StreamEventsResponse')
    expect(code).not.toContain("from './types'")
  })

  it('OpenAPI 3.2 native SSE itemSchema remains a streaming operation', () => {
    const code = generateClient(doc({
      paths: {
        '/health/stream': {
          get: {
            operationId: 'streamHealthEvents',
            responses: {
              '200': {
                description: 'SSE',
                content: {
                  'text/event-stream': {
                    itemSchema: {
                      type: 'object',
                      required: ['event'],
                      properties: {
                        event: { type: 'string' },
                        data: { type: 'string' },
                      },
                      oneOf: [{
                        properties: {
                          event: { const: 'health' },
                          data: {
                            contentMediaType: 'application/json',
                            contentSchema: {
                              type: 'object',
                              required: ['status', 'timestamp'],
                              properties: {
                                status: { type: 'string', enum: ['ok', 'degraded', 'down'] },
                                timestamp: { type: 'string', format: 'date-time' },
                              },
                            },
                          },
                        },
                      }],
                    },
                  },
                },
              },
            },
          },
        },
      },
    }), { typesImport: './types' })

    // itemSchema has no JSON response alias in the current typegen surface, so
    // preserve the safe unknown type while still generating a live SSE iterator.
    expect(code).toContain('async *streamHealthEvents(options?: ClientMethodOptions): AsyncGenerator<unknown>')
    expect(code).toContain("yield* streamSse('GET', '/health/stream',")
    expect(code).toContain('"streamHealthEvents", {})')
    expect(code).toContain("filter(line => line.startsWith('data:'))")
    expect(code).not.toContain("from './types'")
  })

  it('yields scalar SSE data verbatim when itemSchema is text', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => responseWithChunks(['data: hello\n\n', 'data:\n\n'])) as typeof fetch

    try {
      const { createClient } = await importGeneratedClient(generateClient(doc({
        paths: {
          '/notices': {
            get: {
              operationId: 'streamNotices',
              responses: { '200': { description: 'SSE', content: { 'text/event-stream': { itemSchema: { type: 'string' } } } } },
            },
          },
        },
      })))
      const client = createClient({ baseUrl: 'https://example.test' }) as {
        streamNotices(): AsyncGenerator<string>
      }
      const values: string[] = []
      for await (const value of client.streamNotices()) values.push(value)

      expect(values).toEqual(['hello', ''])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('passes declared error media into generated SSE and NDJSON helpers', async () => {
    const spec = doc({
      paths: {
        '/events': {
          get: {
            operationId: 'streamEvents',
            responses: {
              '200': { description: 'SSE', content: { 'text/event-stream': { itemSchema: { type: 'object' } } } },
              '403': { description: 'Denied', content: { 'text/plain': { schema: { type: 'string' } } } },
            },
          },
        },
        '/logs': {
          get: {
            operationId: 'streamLogs',
            responses: {
              '200': { description: 'NDJSON', content: { 'application/x-ndjson': { schema: { type: 'object' } } } },
              '403': { description: 'Denied', content: { 'text/plain': { schema: { type: 'string' } } } },
            },
          },
        },
      },
    })
    const code = generateClient(spec)
    expect(code).toContain('const body = await __readOaErrorBody(res, errorMediaTypes)')
    expect(code).toContain("yield* streamSse('GET', '/events',")
    expect(code).toContain('"streamEvents", { "403": ["text/plain"] })')
    expect(code).toContain("yield* streamNdjson('GET', '/logs',")
    expect(code).toContain('"streamLogs", { "403": ["text/plain"] })')

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response('stream denied', {
      status: 403,
      headers: { 'Content-Type': 'text/plain' },
    })) as typeof fetch
    try {
      const { createClient } = await importGeneratedClient(code)
      const client = createClient({ baseUrl: 'https://example.test' }) as { streamEvents(): AsyncGenerator<unknown> }
      const error = await client.streamEvents().next().catch(reason => reason) as { name: string; body: unknown }
      expect(error).toMatchObject({ name: 'ClientError', body: 'stream denied' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('flushes terminal SSE and NDJSON frames that omit their trailing delimiter', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (url: string | URL | Request) => {
      if (String(url).endsWith('/events')) return responseWithChunks(['event: health\ndata: {"id":1}'])
      return responseWithChunks(['{"id":2}'])
    }) as typeof fetch

    try {
      const { createClient } = await importGeneratedClient(generateClient(streamingSpec()))
      const client = createClient({ baseUrl: 'https://example.test' }) as {
        streamEvents(): AsyncGenerator<{ id: number }>
        streamLogs(): AsyncGenerator<{ id: number }>
      }
      const events: Array<{ id: number }> = []
      const logs: Array<{ id: number }> = []
      for await (const event of client.streamEvents()) events.push(event)
      for await (const log of client.streamLogs()) logs.push(log)

      expect(events).toEqual([{ id: 1 }])
      expect(logs).toEqual([{ id: 2 }])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('reports streaming fetch and middleware failures through onError', async () => {
    const originalFetch = globalThis.fetch
    const reported: string[] = []

    try {
      const { createClient } = await importGeneratedClient(generateClient(streamingSpec()))
      globalThis.fetch = (async () => { throw new Error('network unavailable') }) as typeof fetch
      const fetchFailureClient = createClient({
        baseUrl: 'https://example.test',
        middleware: [{ onError: (error: Error) => reported.push(error.message) }],
      }) as { streamEvents(): AsyncGenerator<unknown> }
      await expect(fetchFailureClient.streamEvents().next()).rejects.toThrow('network unavailable')

      globalThis.fetch = (async () => responseWithChunks(['data: {"id":1}\n\n'])) as typeof fetch
      const requestMiddlewareFailureClient = createClient({
        baseUrl: 'https://example.test',
        middleware: [{
          onRequest: () => { throw new Error('request middleware failed') },
          onError: (error: Error) => reported.push(error.message),
        }],
      }) as { streamEvents(): AsyncGenerator<unknown> }
      await expect(requestMiddlewareFailureClient.streamEvents().next()).rejects.toThrow('request middleware failed')

      const middlewareFailureClient = createClient({
        baseUrl: 'https://example.test',
        middleware: [{
          onResponse: () => { throw new Error('response middleware failed') },
          onError: (error: Error) => reported.push(error.message),
        }],
      }) as { streamEvents(): AsyncGenerator<unknown> }
      await expect(middlewareFailureClient.streamEvents().next()).rejects.toThrow('response middleware failed')

      expect(reported).toEqual(['network unavailable', 'request middleware failed', 'response middleware failed'])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('cancels an open stream when a consumer stops iteration early', async () => {
    const originalFetch = globalThis.fetch
    let cancelled = false
    const encoder = new TextEncoder()
    globalThis.fetch = (async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"id":1}\n\n'))
      },
      cancel() {
        cancelled = true
      },
    }), { status: 200 })) as typeof fetch

    try {
      const { createClient } = await importGeneratedClient(generateClient(streamingSpec()))
      const client = createClient({ baseUrl: 'https://example.test' }) as {
        streamEvents(): AsyncGenerator<{ id: number }>
      }
      const iterator = client.streamEvents()
      await expect(iterator.next()).resolves.toEqual({ done: false, value: { id: 1 } })
      await iterator.return(undefined)

      expect(cancelled).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
