import { describe, it, expect } from 'vitest'
import { generateClient } from '../generate-client.js'
import type { OasDocument } from '@oa-sdk/parser'

function doc(overrides: Partial<OasDocument> = {}): OasDocument {
  return { openapi: '3.2.0', info: { title: 'T', version: '0' }, paths: {}, ...overrides } as OasDocument
}

describe('SSE streaming client', () => {
  it('text/event-stream → async generator', () => {
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
    expect(code).toContain("yield* stream('GET'")
  })

  it('application/x-ndjson → async generator', () => {
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

  it('stream 헬퍼 함수 포함', () => {
    const code = generateClient(doc({
      paths: {
        '/events': {
          get: {
            operationId: 'stream',
            responses: { '200': { description: 'SSE', content: { 'text/event-stream': {} } } },
          },
        },
      },
    }))
    expect(code).toContain('async function* stream<T>')
    expect(code).toContain('getReader()')
    expect(code).toContain('[DONE]')
  })

  it('SSE + types import', () => {
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
    expect(code).toContain('StreamEventsResponse')
    expect(code).toContain("from './types'")
  })
})
