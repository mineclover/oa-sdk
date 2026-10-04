import { describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import type { OasDocument } from '@oa-sdk/parser'
import { createNodeMockServer } from '../../adapters/node-http.js'
import { createMswHandlers } from '../../adapters/msw.js'

const partialExternalRefSpec = {
  openapi: '3.2.0',
  info: { title: 'Partial ref', version: '1.0.0' },
  paths: {
    '/external': { $ref: './external-path-item.yaml' },
  },
} as OasDocument

const optionalJsonBodySpec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Optional body', version: '1.0.0' },
  paths: {
    '/export': {
      post: {
        operationId: 'requestExport',
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { format: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '202': {
            description: 'Accepted',
            content: { 'application/json': { example: { accepted: true } } },
          },
        },
      },
    },
  },
}

const serverPrefixSpec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Server prefix', version: '1.0.0' },
  servers: [{
    url: 'https://api.example.test/{base}',
    variables: { base: { default: 'v1' } },
  }],
  paths: {
    '/ping': {
      get: {
        operationId: 'ping',
        responses: { '200': { description: 'OK', content: { 'application/json': { example: { ok: true } } } } },
      },
    },
  },
}

const recursiveTreeSpec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Recursive Schema', version: '1.0.0' },
  paths: {
    '/tree': {
      get: {
        operationId: 'getTree',
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TreeNode' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      TreeNode: {
        type: 'object',
        properties: {
          children: {
            type: 'array',
            items: { $ref: '#/components/schemas/TreeNode' },
          },
        },
      },
    },
  },
}

// A cycle that never descends into the instance (`allOf` re-evaluates the same
// value) has no finite expansion and stays an incomplete reference.
const unguardedCycleSpec: OasDocument = {
  ...recursiveTreeSpec,
  info: { title: 'Unguarded cycle', version: '1.0.0' },
  components: {
    schemas: {
      TreeNode: { allOf: [{ $ref: '#/components/schemas/TreeNode' }] },
    },
  },
}

describe('mock adapter integrity boundaries', () => {
  it('rejects incomplete external references instead of silently exposing no Node routes', () => {
    expect(() => createNodeMockServer(partialExternalRefSpec)).toThrow(/requires complete \$ref resolution/)
  })

  it('rejects incomplete external references instead of silently creating no MSW handlers', () => {
    expect(() => createMswHandlers(partialExternalRefSpec)).toThrow(/requires complete \$ref resolution/)
  })

  it('rejects unguarded cyclic schema references in Node adapter with IncompleteParsedDocumentError', () => {
    expect(() => createNodeMockServer(unguardedCycleSpec)).toThrow(/requires complete \$ref resolution/)
  })

  it('rejects unguarded cyclic schema references in MSW adapter with IncompleteParsedDocumentError', () => {
    expect(() => createMswHandlers(unguardedCycleSpec)).toThrow(/requires complete \$ref resolution/)
  })

  it('serves recursive schemas whose cycle descends into the instance', async () => {
    expect(() => createMswHandlers(recursiveTreeSpec)).not.toThrow()
    const server = createNodeMockServer(recursiveTreeSpec, { port: 0 })
    await server.start()
    try {
      const response = await fetch(`${server.url}/tree`)
      expect(response.status).toBe(200)
      const body = await response.json() as { children?: unknown }
      expect(body).toEqual(expect.any(Object))
      if (body.children !== undefined) expect(Array.isArray(body.children)).toBe(true)
    } finally {
      await server.stop()
    }
  })

  it('returns a parse validation error for malformed optional JSON in the Node adapter', async () => {
    const server = createNodeMockServer(optionalJsonBodySpec, { port: 0 })
    await server.start()
    try {
      const raw = '{"format":'
      const response = await fetch(`${server.url}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: raw,
      })
      expect(response.status).toBe(422)
      const body = await response.json() as { error: { details: Array<{ code: string; expected?: string }> } }
      expect(body.error.details).toContainEqual(expect.objectContaining({
        code: 'PROTOCOL_MISMATCH',
        expected: 'valid JSON',
      }))
      expect(JSON.stringify(body)).not.toContain(raw)
    } finally {
      await server.stop()
    }
  })

  it('returns a parse validation error for malformed optional JSON in the MSW adapter', async () => {
    const msw = setupServer(...createMswHandlers(optionalJsonBodySpec))
    msw.listen({ onUnhandledRequest: 'error' })
    try {
      const raw = '{"format":'
      const response = await fetch('http://example.test/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: raw,
      })
      expect(response.status).toBe(422)
      const body = await response.json() as { error: { details: Array<{ code: string; expected?: string }> } }
      expect(body.error.details).toContainEqual(expect.objectContaining({
        code: 'PROTOCOL_MISMATCH',
        expected: 'valid JSON',
      }))
      expect(JSON.stringify(body)).not.toContain(raw)
    } finally {
      msw.close()
    }
  })

  it('applies selected server variables to the Node mock URL and route prefix', async () => {
    const server = createNodeMockServer(serverPrefixSpec, { port: 0, serverVariables: { base: 'v2' } })
    await server.start()
    try {
      expect(server.url).toMatch(/\/v2$/)
      const response = await fetch(`${server.url}/ping`)
      expect(response.status).toBe(200)
    } finally {
      await server.stop()
    }
  })

  it('applies serverIndex when a spec declares multiple servers', async () => {
    const multiServerSpec: OasDocument = {
      ...serverPrefixSpec,
      servers: [
        { url: 'https://api.example.test/v1' },
        { url: 'https://api.example.test/v3' },
      ],
    }
    const server = createNodeMockServer(multiServerSpec, { port: 0, serverIndex: 1 })
    await server.start()
    try {
      expect(server.url).toMatch(/\/v3$/)
      expect((await fetch(`${server.url}/ping`)).status).toBe(200)
    } finally {
      await server.stop()
    }
  })

  it('formats an IPv6 Node mock URL as a valid URL', async () => {
    const server = createNodeMockServer(optionalJsonBodySpec, { port: 0, host: '::1' })
    await server.start()
    try {
      expect(() => new URL(server.url)).not.toThrow()
    } finally {
      await server.stop()
    }
  })

  it('does not expose internal exception text in a Node mock response', async () => {
    const server = createNodeMockServer(optionalJsonBodySpec, { port: 0 })
    server.override('requestExport', {
      status: 202,
      body: {
        toJSON() {
          throw new Error('token=SERVER_EXCEPTION_SENTINEL')
        },
      },
    })
    await server.start()
    try {
      const response = await fetch(`${server.url}/export`, { method: 'POST' })
      expect(response.status).toBe(500)
      const body = await response.json() as { error: { message: string } }
      expect(body.error.message).toBe('Mock 처리 중 내부 오류가 발생했습니다')
      expect(JSON.stringify(body)).not.toContain('SERVER_EXCEPTION_SENTINEL')
    } finally {
      await server.stop()
    }
  })
})
