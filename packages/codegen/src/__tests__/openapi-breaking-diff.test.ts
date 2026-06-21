import { describe, expect, it } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import { diffEndpoints } from '../cli/lib/openapi-breaking-diff.js'

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
})
