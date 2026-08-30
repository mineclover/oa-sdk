import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import type { OasDocument } from '@oa-sdk/parser'
import { createMswHandlers } from '../../adapters/msw.js'
import { createNodeMockServer, type NodeMockServer } from '../../adapters/node-http.js'

const errorSchema = {
  type: 'object',
  required: ['code', 'message'],
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
  },
  additionalProperties: false,
}

const validationErrorSchema = {
  type: 'object',
  required: ['code', 'message'],
  properties: {
    code: { const: 'SCHEMA_VALIDATION_FAILED' },
    message: { type: 'string' },
    details: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'message'],
        properties: {
          path: { type: 'string' },
          message: { type: 'string' },
          expected: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
}

const spec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Auth contract integration', version: '1.0.0' },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' },
      queryKey: { type: 'apiKey', in: 'query', name: 'api_key' },
      cookieKey: { type: 'apiKey', in: 'cookie', name: 'session' },
    },
  },
  paths: {
    '/alternative': {
      get: {
        operationId: 'alternativeAuth',
        security: [{ bearerAuth: [] }, { queryKey: [] }, { cookieKey: [] }],
        responses: {
          '200': { description: 'OK', content: { 'application/json': { example: { ok: true } } } },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: errorSchema,
                example: { code: 'UNAUTHORIZED', message: 'Authentication required' },
              },
            },
          },
        },
      },
    },
    '/vendor-json': {
      get: {
        operationId: 'vendorJsonUnauthorized',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'OK' },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json-patch+json': {
                schema: errorSchema,
                example: { code: 'UNAUTHORIZED', message: 'Authentication required' },
              },
            },
          },
        },
      },
    },
    '/validation': {
      post: {
        operationId: 'validationFailure',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: { name: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'OK' },
          '422': {
            description: 'Unprocessable Content',
            content: {
              'application/problem+json': {
                schema: validationErrorSchema,
                example: { code: 'SCHEMA_VALIDATION_FAILED', message: 'Invalid request' },
              },
            },
          },
        },
      },
    },
  },
}

function expectContractValidationResponse(response: Response): Promise<void> {
  return response.json().then(body => {
    expect(body).toEqual({
      code: 'SCHEMA_VALIDATION_FAILED',
      message: 'Invalid request',
      details: [{ path: '/body/name', message: "필수 필드 누락: 'name'" }],
    })
  })
}

describe('Node HTTP auth and error contract selection', () => {
  let server: NodeMockServer

  beforeAll(async () => {
    server = createNodeMockServer(spec, { port: 0 })
    await server.start()
  })

  afterAll(async () => {
    await server.stop()
  })

  it('rejects blank API-key alternatives but accepts non-empty values', async () => {
    expect((await fetch(`${server.url}/alternative?api_key=`)).status).toBe(401)
    expect((await fetch(`${server.url}/alternative`, { headers: { cookie: 'session=' } })).status).toBe(401)
    expect((await fetch(`${server.url}/alternative?api_key=valid`)).status).toBe(200)
    expect((await fetch(`${server.url}/alternative`, { headers: { cookie: 'session=valid' } })).status).toBe(200)
  })

  it('preserves selected vendor JSON media types', async () => {
    const response = await fetch(`${server.url}/vendor-json`)
    expect(response.status).toBe(401)
    expect(response.headers.get('content-type')).toBe('application/json-patch+json')
  })

  it('uses the documented 422 response body and content type', async () => {
    const response = await fetch(`${server.url}/validation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(response.status).toBe(422)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    await expectContractValidationResponse(response)
  })
})

describe('MSW auth and error contract selection', () => {
  const server = setupServer(...createMswHandlers(spec))
  const baseUrl = 'http://auth-contract.test'

  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' })
  })

  afterEach(() => {
    server.resetHandlers()
  })

  afterAll(() => {
    server.close()
  })

  it('rejects blank API-key alternatives but accepts non-empty values', async () => {
    expect((await fetch(`${baseUrl}/alternative?api_key=`)).status).toBe(401)
    expect((await fetch(`${baseUrl}/alternative`, { headers: { cookie: 'session=' } })).status).toBe(401)
    expect((await fetch(`${baseUrl}/alternative?api_key=valid`)).status).toBe(200)
    expect((await fetch(`${baseUrl}/alternative`, { headers: { cookie: 'session=valid' } })).status).toBe(200)
  })

  it('preserves selected vendor JSON media types', async () => {
    const response = await fetch(`${baseUrl}/vendor-json`)
    expect(response.status).toBe(401)
    expect(response.headers.get('content-type')).toBe('application/json-patch+json')
  })

  it('uses the documented 422 response body and content type', async () => {
    const response = await fetch(`${baseUrl}/validation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(response.status).toBe(422)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    await expectContractValidationResponse(response)
  })
})
