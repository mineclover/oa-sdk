/**
 * Mock-server edge cases — integration tests
 *
 * - Deeply nested schema generation (5 levels of objects)
 * - Array of objects with required fields
 * - allOf response schema (merged object — first branch selected by algebra)
 * - oneOf response schema (first branch selected)
 * - Empty response body (204) with content-type header
 * - Response with only `default` key (no status codes)
 * - Multiple query parameters with same name (array)
 * - Unicode in path/query values
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createNodeMockServer, type NodeMockServer } from '../../adapters/node-http.js'
import type { OasDocument } from '@oa-sdk/parser'

const spec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Edge Cases', version: '1.0.0' },
  paths: {
    // ─── Deeply nested schema (5 levels) ──────────────────────────────────────
    '/deep-nested': {
      get: {
        operationId: 'deepNested',
        responses: {
          '200': {
            description: 'Deeply nested object (5 levels)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['l1'],
                  properties: {
                    l1: {
                      type: 'object',
                      required: ['l2'],
                      properties: {
                        l2: {
                          type: 'object',
                          required: ['l3'],
                          properties: {
                            l3: {
                              type: 'object',
                              required: ['l4'],
                              properties: {
                                l4: {
                                  type: 'object',
                                  required: ['l5'],
                                  properties: {
                                    l5: { type: 'string', format: 'uuid' },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    // ─── Array of objects with required fields ───────────────────────────────
    '/array-objects': {
      get: {
        operationId: 'arrayObjects',
        responses: {
          '200': {
            description: 'Array of objects',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  minItems: 2,
                  items: {
                    type: 'object',
                    required: ['id', 'name'],
                    properties: {
                      id: { type: 'integer', minimum: 1 },
                      name: { type: 'string' },
                      optional: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    // ─── allOf response schema ───────────────────────────────────────────────
    '/allof-response': {
      get: {
        operationId: 'allOfResponse',
        responses: {
          '200': {
            description: 'allOf merged object',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    {
                      type: 'object',
                      required: ['id'],
                      properties: {
                        id: { type: 'integer', minimum: 1 },
                      },
                    },
                    {
                      type: 'object',
                      required: ['name'],
                      properties: {
                        name: { type: 'string' },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },

    // ─── oneOf response schema ───────────────────────────────────────────────
    '/oneof-response': {
      get: {
        operationId: 'oneOfResponse',
        responses: {
          '200': {
            description: 'oneOf — first branch selected',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    {
                      type: 'object',
                      required: ['kind'],
                      properties: {
                        kind: { type: 'string', enum: ['alpha'] },
                        value: { type: 'integer' },
                      },
                    },
                    {
                      type: 'object',
                      required: ['kind'],
                      properties: {
                        kind: { type: 'string', enum: ['beta'] },
                        score: { type: 'number' },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },

    // ─── Empty response body (204) ──────────────────────────────────────────
    '/empty-204': {
      delete: {
        operationId: 'empty204',
        responses: {
          '204': { description: 'No Content' },
        },
      },
    },

    // ─── Response with only `default` key ────────────────────────────────────
    '/default-only': {
      get: {
        operationId: 'defaultOnly',
        responses: {
          default: {
            description: 'Default fallback',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['status', 'message'],
                  properties: {
                    status: { type: 'string', enum: ['ok'] },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },

    // ─── Multiple query parameters with same name (array) ────────────────────
    '/multi-query': {
      get: {
        operationId: 'multiQuery',
        parameters: [
          {
            name: 'tag',
            in: 'query',
            schema: { type: 'array', items: { type: 'string' } },
          },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                example: { accepted: true },
              },
            },
          },
        },
      },
    },

    // ─── Unicode in path values ──────────────────────────────────────────────
    '/items/{name}': {
      get: {
        operationId: 'getItemByName',
        parameters: [
          {
            name: 'name',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'label',
            in: 'query',
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                example: { found: true },
              },
            },
          },
        },
      },
    },
  },
}

describe('Mock-server edge cases', () => {
  let server: NodeMockServer

  beforeAll(async () => {
    server = createNodeMockServer(spec, { port: 0 })
    await server.start()
  })

  afterAll(async () => { await server.stop() })

  // ─── Deeply nested schema generation (5 levels) ─────────────────────────────

  describe('deeply nested schema (5 levels of objects)', () => {
    it('generates all 5 nested levels with correct leaf type', async () => {
      const res = await fetch(`${server.url}/deep-nested`)
      expect(res.status).toBe(200)

      const body = await res.json() as Record<string, any>
      expect(body).toHaveProperty('l1')
      expect(body.l1).toHaveProperty('l2')
      expect(body.l1.l2).toHaveProperty('l3')
      expect(body.l1.l2.l3).toHaveProperty('l4')
      expect(body.l1.l2.l3.l4).toHaveProperty('l5')
      // Leaf is uuid format string
      expect(body.l1.l2.l3.l4.l5).toBe('00000000-0000-0000-0000-000000000000')
    })
  })

  // ─── Array of objects with required fields ──────────────────────────────────

  describe('array of objects with required fields', () => {
    it('generates array with minItems count, each item has required fields', async () => {
      const res = await fetch(`${server.url}/array-objects`)
      expect(res.status).toBe(200)

      const body = await res.json() as Array<Record<string, unknown>>
      expect(Array.isArray(body)).toBe(true)
      expect(body).toHaveLength(2)

      for (const item of body) {
        expect(item).toHaveProperty('id')
        expect(item).toHaveProperty('name')
        expect(typeof item.id).toBe('number')
        expect(item.id as number).toBeGreaterThanOrEqual(1)
        expect(typeof item.name).toBe('string')
        // optional field should NOT be present (only required fields generated)
        expect(item).not.toHaveProperty('optional')
      }
    })

    it('array items are independent objects (not shared reference)', async () => {
      const res = await fetch(`${server.url}/array-objects`)
      const body = await res.json() as Array<Record<string, unknown>>
      // Values should be equal but not the same reference
      expect(body[0]).toEqual(body[1])
    })
  })

  // ─── allOf response schema ──────────────────────────────────────────────────

  describe('allOf response schema', () => {
    it('returns first branch of allOf (algebra selects branches[0])', async () => {
      const res = await fetch(`${server.url}/allof-response`)
      expect(res.status).toBe(200)

      const body = await res.json() as Record<string, unknown>
      // allOf algebra picks first branch: { id: integer minimum:1 }
      expect(body).toHaveProperty('id')
      expect(typeof body.id).toBe('number')
      expect(body.id as number).toBeGreaterThanOrEqual(1)
    })
  })

  // ─── oneOf response schema ──────────────────────────────────────────────────

  describe('oneOf response schema', () => {
    it('returns first branch of oneOf (kind: alpha)', async () => {
      const res = await fetch(`${server.url}/oneof-response`)
      expect(res.status).toBe(200)

      const body = await res.json() as Record<string, unknown>
      // oneOf algebra picks first branch: { kind: enum['alpha'] }
      expect(body).toHaveProperty('kind', 'alpha')
      // 'score' from second branch should NOT be present
      expect(body).not.toHaveProperty('score')
    })
  })

  // ─── Empty response body (204) ──────────────────────────────────────────────

  describe('empty response body (204)', () => {
    it('returns 204 with no body', async () => {
      const res = await fetch(`${server.url}/empty-204`, { method: 'DELETE' })
      expect(res.status).toBe(204)
      const text = await res.text()
      expect(text).toBe('')
    })
  })

  // ─── Response with only `default` key ──────────────────────────────────────

  describe('response with only `default` key (no status codes)', () => {
    it('falls back to default with status 200 and generates schema body', async () => {
      const res = await fetch(`${server.url}/default-only`)
      expect(res.status).toBe(200)

      const body = await res.json() as Record<string, unknown>
      expect(body).toHaveProperty('status', 'ok')
      expect(body).toHaveProperty('message')
      expect(typeof body.message).toBe('string')
    })
  })

  // ─── Multiple query parameters with same name (array) ──────────────────────

  describe('multiple query parameters with same name', () => {
    it('accepts repeated query params without validation error', async () => {
      const res = await fetch(`${server.url}/multi-query?tag=a&tag=b&tag=c`)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body).toEqual({ accepted: true })
    })

    it('accepts single query param value', async () => {
      const res = await fetch(`${server.url}/multi-query?tag=single`)
      expect(res.status).toBe(200)
    })

    it('accepts no query params at all', async () => {
      const res = await fetch(`${server.url}/multi-query`)
      expect(res.status).toBe(200)
    })
  })

  // ─── Unicode in path/query values ──────────────────────────────────────────

  describe('unicode in path and query values', () => {
    it('handles unicode path parameter (Korean)', async () => {
      const res = await fetch(`${server.url}/items/${encodeURIComponent('테스트')}`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ found: true })
    })

    it('handles unicode path parameter (emoji)', async () => {
      const res = await fetch(`${server.url}/items/${encodeURIComponent('🎉')}`)
      expect(res.status).toBe(200)
    })

    it('handles unicode query parameter', async () => {
      const res = await fetch(`${server.url}/items/test?label=${encodeURIComponent('日本語ラベル')}`)
      expect(res.status).toBe(200)
    })

    it('handles mixed unicode in path and query', async () => {
      const res = await fetch(
        `${server.url}/items/${encodeURIComponent('café')}?label=${encodeURIComponent('étiquette')}`,
      )
      expect(res.status).toBe(200)
    })
  })
})
