import { describe, expect, it } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import { diffEndpoints, extractEndpoints } from '../cli/lib/openapi-breaking-diff.js'

describe('OpenAPI breaking diff', () => {
  it('treats TypeSpec OpenAPI 3.2 object sealing as equivalent for plain object schemas', () => {
    const sourceDocument: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Source', version: '0.1.0' },
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CreateUserRequest' },
                },
              },
            },
            responses: {
              '201': {
                description: 'Created',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/User' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          CreateUserRequest: {
            type: 'object',
            required: ['email'],
            additionalProperties: false,
            properties: {
              email: { type: 'string', format: 'email' },
            },
          },
          User: {
            type: 'object',
            required: ['id'],
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
            },
          },
        },
      },
    }
    const emittedDocument: OasDocument = {
      ...sourceDocument,
      components: {
        schemas: {
          CreateUserRequest: {
            type: 'object',
            required: ['email'],
            unevaluatedProperties: { not: {} },
            properties: {
              email: { type: 'string', format: 'email' },
            },
          },
          User: {
            type: 'object',
            required: ['id'],
            unevaluatedProperties: { not: {} },
            properties: {
              id: { type: 'string' },
            },
          },
        },
      },
    }

    expect(diffEndpoints(sourceDocument, emittedDocument)).toEqual({
      added: [],
      removed: [],
      modified: [],
    })
  })

  it('compares the operations of a path item that is a $ref into the document, with the fields next to it', () => {
    const id = { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
    const getUser = { operationId: 'getUser', responses: { '200': { description: 'OK' } } }
    const deleteUser = { operationId: 'deleteUser', responses: { '204': { description: 'Deleted' } } }
    const document = (user: Record<string, unknown>): Record<string, unknown> => ({
      openapi: '3.2.0',
      info: { title: 'Users', version: '1.0.0' },
      paths: {
        '/users/{id}': { $ref: '#/components/pathItems/User', parameters: [id] },
        '/me': { $ref: '#/components/pathItems/Me' },
        // A ref that leads back to itself names no operations.
        '/loop': { $ref: '#/components/pathItems/Loop' },
      },
      components: {
        pathItems: { User: user, Me: { $ref: '#/components/pathItems/User' }, Loop: { $ref: '#/components/pathItems/Loop' } },
      },
    })

    const endpoints = extractEndpoints(document({ get: getUser, delete: deleteUser }))
    expect([...endpoints.keys()].sort()).toEqual(['DELETE /me', 'DELETE /users/{id}', 'GET /me', 'GET /users/{id}'])
    // The parameters next to the ref are the path item's.
    expect(endpoints.get('GET /users/{id}')?.parameters).toEqual(['path:id'])
    expect(endpoints.get('GET /me')?.parameters).toEqual([])

    const result = diffEndpoints(document({ get: getUser, delete: deleteUser }), document({ get: getUser }))
    expect(result.removed.map(endpoint => `${endpoint.method.toUpperCase()} ${endpoint.path}`)).toEqual(['DELETE /me', 'DELETE /users/{id}'])
  })
})
