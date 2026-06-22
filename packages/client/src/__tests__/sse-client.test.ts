import { describe, it, expect } from 'vitest'
import { generateClient } from '../generate-client.js'
import type { OasDocument } from '@oa-sdk/parser'

function doc(overrides: Partial<OasDocument> = {}): OasDocument {
  return { openapi: '3.2.0', info: { title: 'T', version: '0' }, paths: {}, ...overrides } as OasDocument
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
    expect(code).toContain("split('\\n\\n')")
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
})
