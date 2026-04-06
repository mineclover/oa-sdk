import { describe, it, expect } from 'vitest'
import { generateClient } from '../generate-client.js'
import type { OasDocument } from '@oa-sdk/parser'

function doc(overrides: Partial<OasDocument> = {}): OasDocument {
  return { openapi: '3.2.0', info: { title: 'T', version: '0' }, paths: {}, ...overrides } as OasDocument
}

describe('generateClient', () => {
  it('GET 메서드 생성', () => {
    const code = generateClient(doc({
      paths: {
        '/users': { get: { operationId: 'listUsers', responses: { '200': { description: 'OK' } } } },
      },
    }))
    expect(code).toContain('async listUsers(')
    expect(code).toContain("request('GET', '/users'")
    expect(code).toContain('createClient')
  })

  it('POST + body', () => {
    const code = generateClient(doc({
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
            responses: { '201': { description: 'Created' } },
          },
        },
      },
    }))
    expect(code).toContain('async createUser(body')
    expect(code).toContain("request('POST', '/users', { body }")
  })

  it('path params → template literal', () => {
    const code = generateClient(doc({
      paths: {
        '/users/{id}': {
          get: {
            operationId: 'getUser',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    expect(code).toContain('async getUser(params')
    expect(code).toContain('${params.id}')
  })

  it('query params', () => {
    const code = generateClient(doc({
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    expect(code).toContain('async listUsers(query')
    expect(code).toContain('query: query')
  })

  it('204 → Promise<void>', () => {
    const code = generateClient(doc({
      paths: {
        '/users/{id}': {
          delete: {
            operationId: 'deleteUser',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '204': { description: 'Deleted' } },
          },
        },
      },
    }))
    expect(code).toContain('Promise<void>')
  })

  it('typesImport → import 문', () => {
    const code = generateClient(doc({
      paths: {
        '/users': { get: { operationId: 'listUsers', responses: { '200': { description: 'OK' } } } },
      },
    }), { typesImport: './types' })
    expect(code).toContain("from './types'")
    expect(code).toContain('ListUsersResponse')
  })

  it('servers → baseUrl 기본값', () => {
    const code = generateClient(doc({
      servers: [{ url: 'https://api.example.com' }],
      paths: {},
    }))
    expect(code).toContain("'https://api.example.com'")
  })

  it('servers with variables → interpolated baseUrl', () => {
    const code = generateClient(doc({
      servers: [{ url: 'https://{env}.api.example.com/v{version}', variables: { env: { default: 'prod' }, version: { default: '2' } } }],
      paths: {},
    }))
    expect(code).toContain("'https://prod.api.example.com/v2'")
    expect(code).not.toContain('{env}')
    expect(code).not.toContain('{version}')
  })

  it('summary → JSDoc', () => {
    const code = generateClient(doc({
      paths: {
        '/health': {
          get: { operationId: 'getHealth', summary: '서버 상태 확인', responses: { '200': { description: 'OK' } } },
        },
      },
    }))
    expect(code).toContain('/** 서버 상태 확인 */')
  })

  it('banner 비활성화', () => {
    const code = generateClient(doc({ paths: {} }), { banner: false })
    expect(code).not.toContain('Auto-generated')
  })

  it('middleware 타입 정의 생성', () => {
    const code = generateClient(doc({
      paths: {
        '/users': { get: { operationId: 'listUsers', responses: { '200': { description: 'OK' } } } },
      },
    }))
    expect(code).toContain('ClientMiddleware')
    expect(code).toContain('onRequest')
    expect(code).toContain('onResponse')
    expect(code).toContain('onError')
  })

  it('request 함수에 middleware 적용 로직', () => {
    const code = generateClient(doc({
      paths: {
        '/users': { get: { operationId: 'listUsers', responses: { '200': { description: 'OK' } } } },
      },
    }))
    expect(code).toContain('config.middleware')
    expect(code).toContain('mw.onRequest')
    expect(code).toContain('mw.onResponse')
    expect(code).toContain('mw.onError')
  })

  it('ClientConfig에 middleware 필드 포함', () => {
    const code = generateClient(doc({ paths: {} }))
    expect(code).toContain('middleware?: ClientMiddleware[]')
  })
})

describe('generateClient — webhooks', () => {
  const webhookSpec = doc({
    webhooks: {
      orderCreated: {
        post: {
          operationId: 'orderCreatedWebhook',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object', required: ['orderId'], properties: { orderId: { type: 'string' } } }
              }
            }
          },
          responses: { '200': { description: 'Acknowledged' } }
        }
      }
    },
    paths: {
      '/orders': {
        get: {
          operationId: 'listOrders',
          responses: { '200': { description: 'OK', content: { 'application/json': { example: [] } } } }
        }
      }
    }
  })

  it('generates webhook type definitions', () => {
    const code = generateClient(webhookSpec)
    expect(code).toContain('Webhook Types')
    expect(code).toContain('OrderCreatedWebhookWebhook')
    expect(code).toContain('orderId: string')
  })

  it('webhook type with required field is not optional', () => {
    const code = generateClient(webhookSpec)
    // orderId is required, so no ? mark
    expect(code).toContain('orderId: string')
    expect(code).not.toContain('orderId?: string')
  })

  it('does not generate API methods for webhooks', () => {
    const code = generateClient(webhookSpec)
    expect(code).not.toContain('async orderCreatedWebhook(')
  })

  it('still generates API methods for path operations', () => {
    const code = generateClient(webhookSpec)
    expect(code).toContain('async listOrders(')
  })

  it('no webhook section when spec has no webhooks', () => {
    const code = generateClient(doc({
      paths: { '/users': { get: { operationId: 'listUsers', responses: { '200': { description: 'OK' } } } } }
    }))
    expect(code).not.toContain('Webhook Types')
  })

  it('webhook without request body schema generates unknown type', () => {
    const code = generateClient(doc({
      webhooks: {
        simpleHook: {
          post: {
            operationId: 'simpleHook',
            responses: { '200': { description: 'OK' } }
          }
        }
      }
    }))
    expect(code).toContain('SimpleHookWebhook = unknown')
  })
})
