import type { OasDocument } from '@oa-sdk/parser'

/**
 * Standard Petstore OAS 3.2 Specification with REST endpoints
 */
export const petstoreSpec: OasDocument = {
  openapi: '3.2.0',
  info: {
    title: 'Petstore API',
    version: '1.0.0',
    description: 'Sample Petstore API for E2E router testing',
  },
  servers: [{ url: '/api/v1' }],
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        summary: 'List all pets',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 100 },
          },
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['available', 'pending', 'sold'] },
          },
        ],
        responses: {
          '200': {
            description: 'A paged array of pets',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['id', 'name'],
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      tag: { type: 'string' },
                    },
                  },
                },
                example: [
                  { id: 'p1', name: 'Fluffy', tag: 'dog' },
                  { id: 'p2', name: 'Mittens', tag: 'cat' },
                ],
              },
            },
          },
        },
      },
      post: {
        operationId: 'createPet',
        summary: 'Create a pet',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', minLength: 1 },
                  tag: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Pet created successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id', 'name'],
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    tag: { type: 'string' },
                  },
                },
                example: { id: 'p3', name: 'Barky', tag: 'dog' },
              },
            },
          },
        },
      },
    },
    '/pets/{petId}': {
      get: {
        operationId: 'getPetById',
        summary: 'Info for a specific pet',
        parameters: [
          {
            name: 'petId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Expected response to a valid request',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id', 'name'],
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    tag: { type: 'string' },
                  },
                },
                example: { id: 'p1', name: 'Fluffy', tag: 'dog' },
              },
            },
          },
          '404': {
            description: 'Pet not found',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['code', 'message'],
                  properties: {
                    code: { type: 'string' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      delete: {
        operationId: 'deletePet',
        summary: 'Delete a pet',
        parameters: [
          {
            name: 'petId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '204': {
            description: 'Pet deleted',
          },
        },
      },
    },
  },
}

/**
 * OAS 3.2 Specification with Extended HTTP Verbs (QUERY, HEAD, TRACE)
 */
export const extendedVerbsSpec: OasDocument = {
  openapi: '3.2.0',
  info: {
    title: 'Extended Verbs API',
    version: '1.0.0',
  },
  servers: [{ url: '/' }],
  paths: {
    '/users/search': {
      query: {
        operationId: 'searchUsers',
        summary: 'OAS 3.2 QUERY verb endpoint',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  query: { type: 'string' },
                  filter: { type: 'object' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Search results',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { type: 'object', properties: { id: { type: 'string' } } },
                },
                example: [{ id: 'u1' }],
              },
            },
          },
        },
      },
    },
    '/files/{fileId}': {
      head: {
        operationId: 'checkFile',
        summary: 'HEAD method for file headers',
        parameters: [
          {
            name: 'fileId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'File metadata headers',
            content: {
              'application/json': {
                schema: { type: 'object' },
                example: { size: 1024 },
              },
            },
          },
        },
      },
      get: {
        operationId: 'downloadFile',
        summary: 'Download file',
        parameters: [
          {
            name: 'fileId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'File bytes',
            content: {
              'application/json': {
                schema: { type: 'object' },
                example: { bytes: 'sample-bytes' },
              },
            },
          },
        },
      },
    },
    '/diagnostics/trace': {
      trace: {
        operationId: 'traceRequest',
        summary: 'TRACE method for network loopback diagnostics',
        responses: {
          '200': {
            description: 'Trace echoed',
          },
        },
      },
    },
  },
}

/**
 * Rich Schema Specification for Fastify JIT inlining & context verification
 */
export const richSchemaSpec: OasDocument = {
  openapi: '3.2.0',
  info: {
    title: 'Enterprise Orders API',
    version: '2.4.0',
  },
  paths: {
    '/orders/{orderId}': {
      put: {
        operationId: 'updateOrder',
        summary: 'Update order with params, query, headers, and body',
        parameters: [
          {
            name: 'orderId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'notifyCustomer',
            in: 'query',
            required: false,
            schema: { type: 'boolean', default: false },
          },
          {
            name: 'X-Correlation-ID',
            in: 'header',
            required: false,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: { type: 'string', enum: ['pending', 'shipped', 'delivered', 'cancelled'] },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Order updated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['orderId', 'status', 'updatedAt'],
                  properties: {
                    orderId: { type: 'string' },
                    status: { type: 'string' },
                    updatedAt: { type: 'string', format: 'date-time' },
                  },
                },
                example: { orderId: 'ord-123', status: 'shipped', updatedAt: '2026-09-12T00:00:00Z' },
              },
            },
          },
        },
      },
    },
  },
}

/**
 * Selective Destructuring Specification for Elysia Zero-Copy verification
 */
export const destructuringSpec: OasDocument = {
  openapi: '3.2.0',
  info: {
    title: 'Destructuring Variance API',
    version: '1.0.0',
  },
  paths: {
    '/ping': {
      get: {
        operationId: 'ping',
        summary: 'No params, query, or body (should not destructure params, query, body)',
        responses: {
          '200': {
            description: 'Pong',
            content: { 'text/plain': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/items/{id}': {
      get: {
        operationId: 'getItemById',
        summary: 'Only path params (should destructure { params })',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Item',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
    '/search': {
      get: {
        operationId: 'searchItems',
        summary: 'Only query params (should destructure { query })',
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Search result',
            content: { 'application/json': { schema: { type: 'array' } } },
          },
        },
      },
    },
    '/submit': {
      post: {
        operationId: 'submitPayload',
        summary: 'Only body (should destructure { body })',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { type: 'object', properties: { val: { type: 'number' } } } },
          },
        },
        responses: {
          '201': {
            description: 'Created with custom status (should destructure { body, set })',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
  },
}

/**
 * Empty OAS Specification for boundary testing
 */
export const emptySpec: OasDocument = {
  openapi: '3.2.0',
  info: {
    title: 'Empty Spec',
    version: '0.0.1',
  },
  paths: {},
}

/**
 * Multi-verb same-route Specification
 */
export const multiVerbSpec: OasDocument = {
  openapi: '3.2.0',
  info: {
    title: 'Multi-Verb API',
    version: '1.0.0',
  },
  paths: {
    '/resources/{id}': {
      get: {
        operationId: 'getResource',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Resource details' } },
      },
      post: {
        operationId: 'createResourceUnderId',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { '201': { description: 'Created' } },
      },
      put: {
        operationId: 'putResource',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { '200': { description: 'Replaced' } },
      },
      delete: {
        operationId: 'deleteResource',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': { description: 'Deleted' } },
      },
      patch: {
        operationId: 'patchResource',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { '200': { description: 'Patched' } },
      },
      query: {
        operationId: 'queryResource',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { '200': { description: 'Queried' } },
      },
    },
  },
}

/**
 * Complex path template spec for boundary testing
 */
export const complexPathTemplateSpec: OasDocument = {
  openapi: '3.2.0',
  info: {
    title: 'Nested Template API',
    version: '1.0.0',
  },
  paths: {
    '/orgs/{org_id}/teams/{teamId}/members/{user:id}': {
      get: {
        operationId: 'getNestedMember',
        parameters: [
          { name: 'org_id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'teamId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'user:id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Member found' } },
      },
    },
  },
}

/**
 * Sample TypeScript source with @oaOperation annotations
 */
export const sampleTsOperationSource = `
/**
 * List all users in system
 * @oaOperation GET /api/v1/users
 */
export function listUsers() {
  return [{ id: 'u1', name: 'Alice' }]
}

/**
 * Create new user
 * @oaOperation POST /api/v1/users
 */
export function createUser(payload: { name: string }) {
  return { id: 'u2', name: payload.name }
}

/**
 * OAS 3.2 QUERY search endpoint
 * @oaOperation QUERY /api/v1/users/search
 */
export function searchUsers(criteria: { keyword: string }) {
  return [{ id: 'u1', name: 'Alice' }]
}
`

/**
 * Sample TypeScript source with malformed/invalid @oaOperation annotations
 */
export const sampleTsInvalidOperationSource = `
/**
 * Invalid operation missing HTTP verb
 * @oaOperation /invalid/no-verb
 */
export function brokenOperation() {
  return null
}

/**
 * Invalid operation with unsupported verb
 * @oaOperation FOOBAR /invalid/unknown-verb
 */
export function unknownVerbOperation() {
  return null
}
`

/**
 * Formatted package.json fixtures
 */
export const packageJson2Spaces = `{
  "name": "sample-fastify-api",
  "version": "1.0.0",
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "fastify": "^4.26.0"
  }
}
`

export const packageJson4Spaces = `{
    "name": "sample-four-spaces",
    "version": "1.0.0",
    "scripts": {
        "lint": "eslint ."
    }
}
`

export const packageJsonTabs = `{\t"name": "sample-tabs",\n\t"version": "1.0.0"\n}\n`

export const packageJsonCrlf = '{\r\n  "name": "sample-crlf",\r\n  "version": "1.0.0"\r\n}\r\n'

export const packageJsonWithCollisions = `{
  "name": "collision-project",
  "scripts": {
    "dev": "custom-dev-server --port 3000",
    "build": "custom-build-tool",
    "test": "jest"
  }
}
`
