import { describe, it, expect } from 'vitest'
import { parseDocument } from '@oa-sdk/parser'
import { generateClient } from '../generate-client.js'
import { generateClient as generateBrowserClient } from '../browser.js'
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

function headersSpec(): OasDocument {
  return doc({
    paths: {
      '/users': {
        get: {
          operationId: 'listUsers',
          responses: {
            '200': {
              description: 'OK',
              headers: {
                'X-Rate-Limit': { schema: { type: 'integer' } },
                'X-Request-Id': { schema: { type: 'string' }, required: true },
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
      },
    },
  })
}

describe('generateClient', () => {
  it('typegen과 같은 operationId 정규화 규칙을 사용한다', () => {
    const code = generateClient(doc({
      paths: {
        '/a': { get: { operationId: 'get.user', responses: { '200': { description: 'OK' } } } },
        '/b': { get: { operationId: 'list-users', responses: { '200': { description: 'OK' } } } },
        '/c': { get: { operationId: 'list_users', responses: { '200': { description: 'OK' } } } },
      },
    }), { typesImport: './types' })
    expect(code).toContain('async getUser(')
    expect(code).toContain('async listUsers(')
    expect(code).toContain('async listUsers2(')
  })

  it('accepts ParsedDocument IR in Node and browser entrypoints', () => {
    const spec = doc({
      paths: {
        '/users': { get: { operationId: 'listUsers', responses: { '200': { description: 'OK' } } } },
      },
    })
    const parsed = parseDocument(spec)

    expect(generateClient(parsed)).toContain('async listUsers(')
    expect(generateBrowserClient(parsed)).toContain('async listUsers(')
  })

  it('generates the same internally referenced operation in Node and browser entrypoints', () => {
    const spec = doc({
      paths: { '/users': { $ref: '#/components/pathItems/Users' } },
      components: {
        pathItems: {
          Users: {
            get: {
              operationId: 'listUsers',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      },
    })

    expect(generateClient(spec)).toContain('async listUsers(')
    expect(generateBrowserClient(spec)).toContain('async listUsers(')
  })

  it.each([
    doc({ paths: { '/missing': { $ref: '#/components/pathItems/Missing' } } }),
    doc({ paths: { '/external': { $ref: './paths.yaml#/Users' } } }),
    doc({
      components: {
        schemas: {
          Node: {
            type: 'object',
            properties: { child: { $ref: '#/components/schemas/Node' } },
          },
        },
      },
    }),
  ])('rejects incomplete ref input in Node and browser entrypoints', (spec) => {
    expect(() => generateClient(spec)).toThrow(/requires complete \$ref resolution/)
    expect(() => generateBrowserClient(spec)).toThrow(/requires complete \$ref resolution/)
  })

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
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } },
              },
            },
          },
        },
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

  it('typesImport 시 withResponse가 typed response headers를 노출', () => {
    const code = generateClient(headersSpec(), { typesImport: './types' })
    expect(code).toContain('export type ClientResponse<TBody, THeaders extends object = Record<string, never>>')
    expect(code).toContain('async listUsers(): Promise<ListUsersResponse>')
    expect(code).toContain('withResponse: {')
    expect(code).toContain('async listUsers(): Promise<ClientResponse<ListUsersResponse, ListUsersResponseHeaders>>')
    expect(code).toContain('return requestResponse<ListUsersResponse, ListUsersResponseHeaders>')
    expect(code).toContain('{ name: "X-Rate-Limit", type: "integer" }')
    expect(code).toContain('{ name: "X-Request-Id", type: "string" }')
  })

  it('typesImport 없이 withResponse가 runtime response headers를 열린 타입으로 노출', () => {
    const code = generateClient(headersSpec())
    expect(code).toContain('withResponse: {')
    expect(code).toContain('async listUsers(): Promise<ClientResponse<unknown, Record<string, unknown>>>')
    expect(code).toContain('return requestResponse<unknown, Record<string, unknown>>')
    expect(code).toContain('{ name: "X-Rate-Limit", type: "integer" }')
    expect(code).toContain('{ name: "X-Request-Id", type: "string" }')
  })

  it('withResponse가 case-insensitive header lookup으로 typed headers를 반환', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify([{ id: 'u1' }]), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-rate-limit': '42',
        'x-request-id': 'req_1',
      },
    })) as typeof fetch

    try {
      const { createClient } = await importGeneratedClient(generateClient(headersSpec(), { typesImport: './types' }))
      const client = createClient({ baseUrl: 'https://example.test' }) as {
        withResponse: {
          listUsers(): Promise<{
            body: Array<{ id: string }>
            headers: { 'X-Rate-Limit'?: number; 'X-Request-Id': string }
          }>
        }
      }
      const result = await client.withResponse.listUsers()
      expect(result.body).toEqual([{ id: 'u1' }])
      expect(result.headers['X-Rate-Limit']).toBe(42)
      expect(result.headers['X-Request-Id']).toBe('req_1')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('withResponse에서 누락된 optional response header는 undefined로 남김', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify([{ id: 'u2' }]), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_2',
      },
    })) as typeof fetch

    try {
      const { createClient } = await importGeneratedClient(generateClient(headersSpec(), { typesImport: './types' }))
      const client = createClient({ baseUrl: 'https://example.test' }) as {
        withResponse: {
          listUsers(): Promise<{
            headers: { 'X-Rate-Limit'?: number; 'X-Request-Id': string }
          }>
        }
      }
      const result = await client.withResponse.listUsers()
      expect(result.headers['X-Rate-Limit']).toBeUndefined()
      expect(result.headers['X-Request-Id']).toBe('req_2')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('403 AuthorizationDecision을 보존하는 typed client error를 Node/Browser에 생성한다', () => {
    const spec = doc({
      paths: {
        '/authorization/check': {
          post: {
            operationId: 'checkAuthorization',
            requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
            responses: {
              '200': { description: 'Allowed', content: { 'application/json': { schema: { type: 'object' } } } },
              '403': { description: 'Denied', content: { 'application/json': { schema: { type: 'object', properties: { allowed: { type: 'boolean' } } } } } },
            },
          },
        },
      },
    })

    for (const code of [generateClient(spec, { typesImport: './types' }), generateBrowserClient(spec, { typesImport: './types' })]) {
      expect(code).toContain('export class ClientError<TBody = unknown, TStatus extends number = number>')
      expect(code).toContain('export type CheckAuthorizationClientError = ClientError<CheckAuthorizationErrorByStatus[403], 403>')
      expect(code).toContain('export function isCheckAuthorizationClientError(error: unknown): error is CheckAuthorizationClientError')
      expect(code).toContain('const body = await __readOaErrorBody(res)')
      expect(code).toMatch(/const err = new ClientError\(res\.status, body, res(?:, operationId)?\)/)
    }
  })

  it('403 응답 body/status/response를 ClientError로 전달한다', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ allowed: false, reasonCode: 'OPENFGA_DENY' }), {
      status: 403,
      statusText: 'Forbidden',
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch

    try {
      const { createClient } = await importGeneratedClient(generateClient(doc({
        paths: {
          '/authorization/check': {
            post: {
              operationId: 'checkAuthorization',
              requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
              responses: {
                '200': { description: 'Allowed', content: { 'application/json': { schema: { type: 'object' } } } },
                '403': { description: 'Denied', content: { 'application/json': { schema: { type: 'object' } } } },
              },
            },
          },
        },
      })))
      const client = createClient({ baseUrl: 'https://example.test' }) as { checkAuthorization(body: unknown): Promise<unknown> }

      const thrown = await client.checkAuthorization({ operationKey: 'sales.order.read' }).catch(error => error) as {
        name: string
        status: number
        body: unknown
        response: Response
      }
      expect(thrown).toMatchObject({
        name: 'ClientError',
        status: 403,
        body: { allowed: false, reasonCode: 'OPENFGA_DENY' },
      })
      expect(thrown.response.bodyUsed).toBe(false)
      await expect(thrown.response.json()).resolves.toEqual({ allowed: false, reasonCode: 'OPENFGA_DENY' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('403 ClientError는 retry 설정이 있어도 재시도하지 않는다', async () => {
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return new Response(JSON.stringify({ allowed: false }), {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    try {
      const { createClient } = await importGeneratedClient(generateClient(doc({
        paths: {
          '/authorization/check': {
            post: {
              operationId: 'checkAuthorization',
              requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
              responses: {
                '200': { description: 'Allowed', content: { 'application/json': { schema: { type: 'object' } } } },
                '403': { description: 'Denied', content: { 'application/json': { schema: { type: 'object' } } } },
              },
            },
          },
        },
      })))
      const client = createClient({ baseUrl: 'https://example.test', retry: { maxRetries: 2, baseDelay: 0 } }) as { checkAuthorization(body: unknown): Promise<unknown> }

      await client.checkAuthorization({ operationKey: 'sales.order.read' }).catch(() => undefined)
      expect(calls).toBe(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('browser generated client도 403 decision body를 보존한다', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ allowed: false }), {
      status: 403,
      statusText: 'Forbidden',
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch

    try {
      const { createClient } = await importGeneratedClient(generateBrowserClient(doc({
        paths: {
          '/authorization/check': {
            post: {
              operationId: 'checkAuthorization',
              requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
              responses: {
                '200': { description: 'Allowed', content: { 'application/json': { schema: { type: 'object' } } } },
                '403': { description: 'Denied', content: { 'application/json': { schema: { type: 'object' } } } },
              },
            },
          },
        },
      })))
      const client = createClient({ baseUrl: 'https://example.test' }) as { checkAuthorization(body: unknown): Promise<unknown> }
      const thrown = await client.checkAuthorization({ operationKey: 'sales.order.read' }).catch(error => error) as { status: number; body: unknown }

      expect(thrown.status).toBe(403)
      expect(thrown.body).toEqual({ allowed: false })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('operation retry 정책으로 읽기성 POST만 재시도한다', async () => {
    const spec = doc({
      paths: {
        '/authorization/check': {
          post: {
            operationId: 'checkAuthorization',
            'x-oa-sdk-retryable': true,
            requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
            responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } }, '503': { description: 'Unavailable', content: { 'application/json': { schema: { type: 'object' } } } } },
          },
        },
        '/authorization/relationships': {
          post: {
            operationId: 'writeRelationships',
            requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
            responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } }, '503': { description: 'Unavailable', content: { 'application/json': { schema: { type: 'object' } } } } },
          },
        },
      },
    })
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return calls === 1
        ? new Response(JSON.stringify({ error: 'temporary' }), { status: 503 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as typeof fetch

    try {
      const { createClient } = await importGeneratedClient(generateClient(spec, { typesImport: './types' }))
      const client = createClient({ baseUrl: 'https://example.test', retry: { maxRetries: 1, baseDelay: 0 } }) as {
        checkAuthorization(body: unknown): Promise<unknown>
        writeRelationships(body: unknown): Promise<unknown>
      }
      await expect(client.checkAuthorization({})).resolves.toEqual({ ok: true })
      expect(calls).toBe(2)

      calls = 0
      await expect(client.writeRelationships({})).rejects.toMatchObject({ status: 503 })
      expect(calls).toBe(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('validate가 request schema 제약을 검사하고 fetch 전에 실패한다', async () => {
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as typeof fetch

    try {
      const { createClient } = await importGeneratedClient(generateClient(doc({
        paths: {
          '/relationships/query': {
            post: {
              operationId: 'queryRelationships',
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['pageSize'],
                      properties: { pageSize: { type: 'integer', minimum: 1, maximum: 100 } },
                    },
                  },
                },
              },
              responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } } },
            },
          },
        },
      }), { typesImport: './types' }))
      const client = createClient({ baseUrl: 'https://example.test', validate: true }) as { queryRelationships(body: unknown): Promise<unknown> }

      await expect(client.queryRelationships({ pageSize: 0 })).rejects.toThrow('Invalid body')
      expect(calls).toBe(0)
      await expect(client.queryRelationships({ pageSize: 50 })).resolves.toEqual({ ok: true })
      expect(calls).toBe(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('error body guard가 status별 body와 operation identity를 함께 검사한다', async () => {
    const spec = doc({
      paths: {
        '/authorization/check': {
          post: {
            operationId: 'checkAuthorization',
            requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
            responses: {
              '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } },
              '403': { description: 'Denied', content: { 'application/json': { schema: { oneOf: [
                { type: 'object', required: ['allowed'], properties: { allowed: { const: false } } },
                { type: 'object', required: ['error'], properties: { error: { type: 'string' } } },
              ] } } } },
            },
          },
        },
      },
    })
    const generated = await importGeneratedClient(generateClient(spec, { typesImport: './types' })) as unknown as {
      createClient: (config?: unknown) => Record<string, unknown>
      isCheckAuthorizationErrorBody: (body: unknown, status?: number) => boolean
      isCheckAuthorizationClientError: (error: unknown, status?: number) => boolean
    }
    expect(generated.isCheckAuthorizationErrorBody({ allowed: false }, 403)).toBe(true)
    expect(generated.isCheckAuthorizationErrorBody({ error: 'ACTOR_MISMATCH' }, 403)).toBe(true)
    expect(generated.isCheckAuthorizationErrorBody({ allowed: 'false' }, 403)).toBe(false)

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ allowed: false }), { status: 403 })) as typeof fetch
    try {
      const client = generated.createClient({ baseUrl: 'https://example.test' }) as { checkAuthorization(body: unknown): Promise<unknown> }
      const thrown = await client.checkAuthorization({}).catch(error => error)
      expect((thrown as { operationId?: string }).operationId).toBe('checkAuthorization')
      expect(generated.isCheckAuthorizationClientError(thrown, 403)).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('성공 응답 JSON parse 실패는 retry하지 않는다', async () => {
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return new Response('not-json', { status: 200 })
    }) as typeof fetch

    try {
      const { createClient } = await importGeneratedClient(generateClient(doc({
        paths: { '/health': { get: { operationId: 'getHealth', responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } } } } } },
      })))
      const client = createClient({ baseUrl: 'https://example.test', retry: { maxRetries: 2, baseDelay: 0 } }) as { getHealth(): Promise<unknown> }
      await expect(client.getHealth()).rejects.toThrow()
      expect(calls).toBe(1)
    } finally {
      globalThis.fetch = originalFetch
    }
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
