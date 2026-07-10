import { describe, it, expect } from 'vitest'
import { parseDocument } from '@oa-sdk/parser'
import { generateRouter } from '../generate-router.js'
import { generateRouter as generateBrowserRouter } from '../browser.js'
import type { OasDocument } from '@oa-sdk/parser'

function doc(overrides: Partial<OasDocument> = {}): OasDocument {
  return { openapi: '3.2.0', info: { title: 'T', version: '0' }, paths: {}, ...overrides } as OasDocument
}

describe('generateRouter — hono', () => {
  it('accepts ParsedDocument IR in Node and browser entrypoints', () => {
    const spec = doc({
      paths: {
        '/users': { get: { operationId: 'listUsers', responses: { '200': { description: 'OK' } } } },
      },
    })
    const parsed = parseDocument(spec)

    expect(generateRouter(parsed)).toContain("app.get('/users'")
    expect(generateBrowserRouter(parsed)).toContain("app.get('/users'")
  })

  it('기본 GET 라우트', () => {
    const code = generateRouter(doc({
      paths: {
        '/users': { get: { operationId: 'listUsers', responses: { '200': { description: 'OK' } } } },
      },
    }))
    expect(code).toContain("import { Hono } from 'hono'")
    expect(code).toContain("app.get('/users'")
    expect(code).toContain('implement listUsers')
    expect(code).toContain('export default app')
  })

  it('POST + request body', () => {
    const code = generateRouter(doc({
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
            responses: {
              '201': {
                description: 'Created',
                content: { 'application/json': { schema: { type: 'object' } } },
              },
            },
          },
        },
      },
    }))
    expect(code).toContain("app.post('/users'")
    expect(code).toContain('await c.req.json()')
    expect(code).toContain('201')
  })

  it('path params → :id', () => {
    const code = generateRouter(doc({
      paths: {
        '/users/{id}': {
          get: {
            operationId: 'getUser',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }), { typesImport: './types' })
    expect(code).toContain("'/users/:id'")
    expect(code).toContain('c.req.param() as unknown as GetUserPathParams')
  })

  it('query params', () => {
    const code = generateRouter(doc({
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }), { typesImport: './types' })
    expect(code).toContain('c.req.query() as unknown as ListUsersQueryParams')
  })

  it('204 No Content', () => {
    const code = generateRouter(doc({
      paths: {
        '/users/{id}': {
          delete: { operationId: 'deleteUser', responses: { '204': { description: 'Deleted' } } },
        },
      },
    }))
    expect(code).toContain('c.body(null, 204)')
  })

  it('summary → JSDoc', () => {
    const code = generateRouter(doc({
      paths: {
        '/health': {
          get: { operationId: 'getHealth', summary: '서버 상태 확인', responses: { '200': { description: 'OK' } } },
        },
      },
    }))
    expect(code).toContain('/** 서버 상태 확인 */')
  })

  it('typesImport → import 문', () => {
    const code = generateRouter(doc({
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
    }), { typesImport: './api-types' })
    expect(code).toContain("from './api-types'")
    expect(code).toContain('ListUsersResponse')
  })
})

describe('generateRouter — typed router (typesImport)', () => {
  it('typesImport 시 응답 타입 캐스팅', () => {
    const code = generateRouter(doc({
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
    expect(code).toContain('as ListUsersResponse')
    expect(code).not.toContain('as any')
  })

  it('typesImport 시 body 제네릭', () => {
    const code = generateRouter(doc({
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
            responses: {
              '201': {
                description: 'Created',
                content: { 'application/json': { schema: { type: 'object' } } },
              },
            },
          },
        },
      },
    }), { typesImport: './types' })
    expect(code).toContain('c.req.json<CreateUserBody>()')
  })

  it('typesImport 시 ResponseHeaders helper 힌트 생성', () => {
    const spec = doc({
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
              },
            },
          },
        },
      },
    })

    const hono = generateRouter(spec, { typesImport: './types' })
    expect(hono).toContain('ListUsersResponseHeaders')
    expect(hono).toContain('function __setOaResponseHeaders<THeaders extends object>')
    expect(hono).toContain('const responseHeaders: Partial<ListUsersResponseHeaders> = {}')
    expect(hono).toContain('__setOaResponseHeaders<ListUsersResponseHeaders>((name, value) => c.header(name, value), responseHeaders)')

    const express = generateRouter(spec, { target: 'express', typesImport: './types' })
    expect(express).toContain('const responseHeaders: Partial<ListUsersResponseHeaders> = {}')
    expect(express).toContain('__setOaResponseHeaders<ListUsersResponseHeaders>((name, value) => res.setHeader(name, value), responseHeaders)')
  })

  it('typesImport 없으면 as any 유지', () => {
    const code = generateRouter(doc({
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    expect(code).toContain('as any')
  })

  it('typesImport 시 express body 캐스팅', () => {
    const code = generateRouter(doc({
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
            responses: {
              '201': {
                description: 'Created',
                content: { 'application/json': { schema: { type: 'object' } } },
              },
            },
          },
        },
      },
    }), { target: 'express', typesImport: './types' })
    expect(code).toContain('as CreateUserBody')
    expect(code).toContain('as CreateUserResponse')
  })
})

describe('generateRouter — express', () => {
  it('express 타겟', () => {
    const code = generateRouter(doc({
      paths: {
        '/users': { get: { operationId: 'listUsers', responses: { '200': { description: 'OK' } } } },
      },
    }), { target: 'express' })
    expect(code).toContain("import { Router } from 'express'")
    expect(code).toContain("router.get('/users'")
    expect(code).toContain('export default router')
  })
})

describe('generateRouter — content-type aware body parsing', () => {
  it('multipart/form-data → c.req.formData() (hono)', () => {
    const code = generateRouter(doc({
      paths: {
        '/upload': {
          post: {
            operationId: 'uploadFile',
            requestBody: { content: { 'multipart/form-data': { schema: { type: 'object' } } } },
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    expect(code).toContain('await c.req.formData()')
    expect(code).toContain('UploadFileBody')
    expect(code).not.toContain('c.req.json()')
  })

  it('multipart/form-data → req.body with multer hint (express)', () => {
    const code = generateRouter(doc({
      paths: {
        '/upload': {
          post: {
            operationId: 'uploadFile',
            requestBody: { content: { 'multipart/form-data': { schema: { type: 'object' } } } },
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }), { target: 'express' })
    expect(code).toContain('req.body')
    expect(code).toContain('multer')
  })

  it('application/x-www-form-urlencoded → c.req.parseBody() (hono)', () => {
    const code = generateRouter(doc({
      paths: {
        '/submit': {
          post: {
            operationId: 'submitForm',
            requestBody: { content: { 'application/x-www-form-urlencoded': { schema: { type: 'object' } } } },
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    expect(code).toContain('await c.req.parseBody()')
    expect(code).toContain('SubmitFormBody')
  })

  it('text/plain → c.req.text() (hono)', () => {
    const code = generateRouter(doc({
      paths: {
        '/log': {
          post: {
            operationId: 'postLog',
            requestBody: { content: { 'text/plain': { schema: { type: 'string' } } } },
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    expect(code).toContain('await c.req.text()')
    expect(code).toContain('PostLogBody')
  })

  it('application/json still uses c.req.json() (hono)', () => {
    const code = generateRouter(doc({
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
    expect(code).toContain('await c.req.json()')
    expect(code).toContain('CreateUserBody')
  })
})

describe('generateRouter — security hints', () => {
  it('adds security requirement comment', () => {
    const code = generateRouter(doc({
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            security: [{ bearerAuth: [] }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    expect(code).toContain('// Requires: bearerAuth')
  })

  it('lists multiple security schemes', () => {
    const code = generateRouter(doc({
      paths: {
        '/admin': {
          get: {
            operationId: 'adminDashboard',
            security: [{ bearerAuth: [] }, { apiKey: [] }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    expect(code).toContain('// Requires: bearerAuth, apiKey')
  })

  it('no security comment when security is empty', () => {
    const code = generateRouter(doc({
      paths: {
        '/public': {
          get: {
            operationId: 'publicEndpoint',
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    expect(code).not.toContain('Requires:')
  })

  it('inherits global security', () => {
    const code = generateRouter(doc({
      security: [{ bearerAuth: [] }],
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    expect(code).toContain('// Requires: bearerAuth')
  })
})

describe('generateRouter — webhooks', () => {
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

  it('generates webhook handler stubs (hono)', () => {
    const code = generateRouter(webhookSpec)
    expect(code).toContain('Webhooks')
    expect(code).toContain("app.post('/webhooks/orderCreated'")
    expect(code).toContain('incoming webhook')
    expect(code).toContain('implement orderCreatedWebhook webhook handler')
    expect(code).toContain("c.json({ received: true }, 200)")
  })

  it('generates webhook handler stubs (express)', () => {
    const code = generateRouter(webhookSpec, { target: 'express' })
    expect(code).toContain("router.post('/webhooks/orderCreated'")
    expect(code).toContain("res.status(200).json({ received: true })")
  })

  it('webhook body parsing', () => {
    const code = generateRouter(webhookSpec)
    expect(code).toContain('await c.req.json()')
    expect(code).toContain('OrderCreatedWebhookBody')
  })

  it('includes both paths and webhook routes', () => {
    const code = generateRouter(webhookSpec)
    expect(code).toContain("app.get('/orders'")
    expect(code).toContain("app.post('/webhooks/orderCreated'")
  })

  it('webhook types included in typesImport', () => {
    const code = generateRouter(webhookSpec, { typesImport: './types' })
    expect(code).toContain('OrderCreatedWebhookBody')
  })

  it('no webhooks section when spec has none', () => {
    const code = generateRouter(doc({
      paths: { '/users': { get: { operationId: 'listUsers', responses: { '200': { description: 'OK' } } } } }
    }))
    expect(code).not.toContain('Webhooks')
  })
})

describe('generateRouter — banner', () => {
  it('banner 비활성화', () => {
    const code = generateRouter(doc({ paths: {} }), { banner: false })
    expect(code).not.toContain('Auto-generated')
  })
})
