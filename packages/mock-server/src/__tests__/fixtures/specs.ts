/**
 * Shared OAS spec fixtures for mock-server integration tests.
 *
 * Each builder returns a complete, concrete OasDocument. Tests that need
 * minor variations can spread overrides on top; tests with truly unique
 * schemas should keep their specs inline.
 */
import type { OasDocument } from '@oa-sdk/parser'

// ─── Override / simple CRUD (users + health) ─────────────────────────────────

/**
 * Minimal users API with health endpoint.
 * Used by: override.test.ts, msw-override.test.ts
 */
export function createOverrideSpec(): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Override Test', version: '0.0.0' },
    paths: {
      '/users': {
        get: {
          operationId: 'listUsers',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  examples: { default: { dataValue: { items: [], total: 0 } } },
                },
              },
            },
          },
        },
      },
      '/users/{id}': {
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        get: {
          operationId: 'getUserById',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  examples: {
                    default: {
                      dataValue: { id: '123e4567-e89b-12d3-a456-426614174000', name: 'Test' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/health': {
        get: {
          operationId: 'healthCheck',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  examples: { default: { dataValue: { status: 'ok' } } },
                },
              },
            },
          },
        },
      },
    },
  }
}

// ─── Webhook spec (orderCreated + /orders) ───────────────────────────────────

/**
 * Webhook spec with orderCreated webhook and /orders path.
 * Used by: msw.test.ts, node-http.test.ts
 */
export function createWebhookSpec(): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Webhook Test', version: '1.0.0' },
    webhooks: {
      orderCreated: {
        post: {
          operationId: 'orderCreatedWebhook',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['orderId'],
                  properties: { orderId: { type: 'string' } },
                },
              },
            },
          },
          responses: { '200': { description: 'Acknowledged' } },
        },
      },
    },
    paths: {
      '/orders': {
        get: {
          operationId: 'listOrders',
          responses: {
            '200': {
              description: 'OK',
              content: { 'application/json': { example: [] } },
            },
          },
        },
      },
    },
  }
}

// ─── Simple items API (for stress / basic tests) ─────────────────────────────

/**
 * Minimal items CRUD spec: GET /items, POST /items, GET /items/{id}.
 * Used by: stress.test.ts
 */
export function createSimpleItemsSpec(): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Simple Items', version: '1.0.0' },
    paths: {
      '/items': {
        get: {
          operationId: 'listItems',
          responses: {
            '200': {
              description: 'OK',
              content: { 'application/json': { example: { items: [] } } },
            },
          },
        },
        post: {
          operationId: 'createItem',
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
            '201': {
              description: 'Created',
              content: { 'application/json': { example: { id: 1 } } },
            },
          },
        },
      },
      '/items/{id}': {
        get: {
          operationId: 'getItem',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': { example: { id: 1, name: 'test' } },
              },
            },
          },
        },
      },
    },
  } as OasDocument
}
