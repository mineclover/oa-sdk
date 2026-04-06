/**
 * Streaming E2E — SSE + NDJSON via Node HTTP mock server
 *
 * Actual stream consumption tests (not just text dump):
 * - SSE: parse `data: ` lines, verify schema compliance, [DONE] terminator
 * - NDJSON: split by \n, verify no SSE prefix, no terminator
 * - SSE with example: single event matching example exactly
 * - Streaming response headers: Cache-Control, Connection
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createNodeMockServer, type NodeMockServer } from '../../adapters/node-http.js'
import type { OasDocument } from '@oa-sdk/parser'

const spec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Stream E2E', version: '1.0.0' },
  paths: {
    '/sse': {
      get: {
        operationId: 'sseStream',
        responses: {
          '200': {
            description: 'SSE',
            content: {
              'text/event-stream': {
                schema: {
                  type: 'object',
                  required: ['id', 'msg'],
                  properties: {
                    id: { type: 'integer', minimum: 0 },
                    msg: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/ndjson': {
      get: {
        operationId: 'ndjsonStream',
        responses: {
          '200': {
            description: 'NDJSON',
            content: {
              'application/x-ndjson': {
                schema: {
                  type: 'object',
                  required: ['ts', 'level'],
                  properties: {
                    ts: { type: 'string', format: 'date-time' },
                    level: { type: 'string', enum: ['info', 'warn', 'error'] },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/sse-with-example': {
      get: {
        operationId: 'sseExample',
        responses: {
          '200': {
            description: 'SSE with example',
            content: {
              'text/event-stream': {
                examples: { ping: { dataValue: { type: 'ping', ts: 1234567890 } } },
              },
            },
          },
        },
      },
    },
  },
}

describe('Streaming E2E — SSE + NDJSON', () => {
  let server: NodeMockServer

  beforeAll(async () => {
    server = createNodeMockServer(spec, { port: 0 })
    await server.start()
  })

  afterAll(async () => { await server.stop() })

  // ─── SSE ────────────────────────────────────────────────────────────────────

  describe('SSE /sse (schema-based)', () => {
    it('each data: line parses as JSON with schema-compliant fields', async () => {
      const res = await fetch(`${server.url}/sse`)
      const text = await res.text()

      const chunks = text.split('\n\n').filter(Boolean)
      // Exclude [DONE] for JSON parse checks
      const dataChunks = chunks.filter(c => !c.includes('[DONE]'))
      for (const chunk of dataChunks) {
        expect(chunk).toMatch(/^data: /)
        const json = JSON.parse(chunk.replace(/^data: /, '')) as Record<string, unknown>
        // id is integer >= 0
        expect(typeof json.id).toBe('number')
        expect(Number.isInteger(json.id)).toBe(true)
        expect(json.id as number).toBeGreaterThanOrEqual(0)
        // msg is string
        expect(typeof json.msg).toBe('string')
      }
    })

    it('[DONE] terminator is present and is the last chunk', async () => {
      const res = await fetch(`${server.url}/sse`)
      const text = await res.text()

      const chunks = text.split('\n\n').filter(Boolean)
      const lastChunk = chunks[chunks.length - 1]!
      expect(lastChunk).toBe('data: [DONE]')
    })

    it('produces exactly 3 events + 1 terminator = 4 chunks', async () => {
      const res = await fetch(`${server.url}/sse`)
      const text = await res.text()

      const chunks = text.split('\n\n').filter(Boolean)
      expect(chunks).toHaveLength(4)
    })

    it('response headers include Cache-Control: no-cache and Connection: keep-alive', async () => {
      const res = await fetch(`${server.url}/sse`)
      await res.text() // consume body
      expect(res.headers.get('cache-control')).toBe('no-cache')
      expect(res.headers.get('connection')).toBe('keep-alive')
    })
  })

  // ─── NDJSON ─────────────────────────────────────────────────────────────────

  describe('NDJSON /ndjson (schema-based)', () => {
    it('each line parses as JSON with schema-compliant fields', async () => {
      const res = await fetch(`${server.url}/ndjson`)
      const text = await res.text()

      const lines = text.split('\n').filter(Boolean)
      for (const line of lines) {
        const json = JSON.parse(line) as Record<string, unknown>
        // ts is date-time string
        expect(typeof json.ts).toBe('string')
        expect(new Date(json.ts as string).toISOString()).toBe(json.ts)
        // level is one of the enum values
        expect(['info', 'warn', 'error']).toContain(json.level)
      }
    })

    it('lines have NO data: prefix', async () => {
      const res = await fetch(`${server.url}/ndjson`)
      const text = await res.text()
      expect(text).not.toContain('data: ')
    })

    it('lines have NO [DONE] terminator', async () => {
      const res = await fetch(`${server.url}/ndjson`)
      const text = await res.text()
      expect(text).not.toContain('[DONE]')
    })

    it('produces exactly 3 lines', async () => {
      const res = await fetch(`${server.url}/ndjson`)
      const text = await res.text()

      const lines = text.split('\n').filter(Boolean)
      expect(lines).toHaveLength(3)
    })

    it('response headers include Cache-Control: no-cache and Connection: keep-alive', async () => {
      const res = await fetch(`${server.url}/ndjson`)
      await res.text()
      expect(res.headers.get('cache-control')).toBe('no-cache')
      expect(res.headers.get('connection')).toBe('keep-alive')
    })
  })

  // ─── SSE with example ──────────────────────────────────────────────────────

  describe('SSE /sse-with-example (example-based)', () => {
    it('single event matching the example exactly, no [DONE]', async () => {
      const res = await fetch(`${server.url}/sse-with-example`)
      const text = await res.text()

      const chunks = text.split('\n\n').filter(Boolean)
      // example body → single event, no terminator
      expect(chunks).toHaveLength(1)
      expect(text).not.toContain('[DONE]')

      const data = JSON.parse(chunks[0]!.replace('data: ', ''))
      expect(data).toEqual({ type: 'ping', ts: 1234567890 })
    })

    it('content-type is text/event-stream', async () => {
      const res = await fetch(`${server.url}/sse-with-example`)
      await res.text()
      expect(res.headers.get('content-type')).toContain('text/event-stream')
    })
  })
})
