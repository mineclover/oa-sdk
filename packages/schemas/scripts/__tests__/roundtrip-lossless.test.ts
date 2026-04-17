import { describe, expect, it } from 'vitest'
import { downgrade } from '../downgrade-3.1.js'
import { upgrade } from '../upgrade-3.2.js'

describe('OpenAPI 3.2 <-> 3.1 sidecar roundtrip', () => {
  it('restores 3.2-only fields removed from the 3.1 artifact', () => {
    const original = {
      openapi: '3.2.0',
      info: { title: 'Lossless API', version: '1.0.0' },
      servers: [
        { url: 'https://api.example.test', name: 'production' },
      ],
      tags: [
        { name: 'users', parent: 'identity', kind: 'nav' },
      ],
      additionalOperations: {
        queryUsers: { operationId: 'queryUsers' },
      },
      paths: {
        '/users': {
          query: {
            operationId: 'queryUsers',
            responses: { '200': { description: 'OK' } },
          },
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/User' },
                    examples: {
                      alice: { summary: 'Alice', dataValue: { id: 'usr_1', email: 'a@example.test' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        pathItems: {
          UserCollection: {
            get: {
              responses: { '200': { description: 'OK' } },
            },
          },
        },
        mediaTypes: {
          JsonUser: {
            schema: { $ref: '#/components/schemas/User' },
          },
        },
        schemas: {
          User: {
            type: 'object',
            itemSchema: { type: 'string' },
            prefixEncoding: { meta: { contentType: 'application/json' } },
            examples: {
              default: { dataValue: { id: 'usr_1', email: 'a@example.test' } },
            },
            properties: {
              id: { type: 'string' },
              email: { type: 'string', format: 'email' },
              manager: {
                $ref: '#/components/schemas/User',
                summary: 'Recursive manager reference',
                description: 'Allowed in 3.2 ref override fields.',
              },
            },
          },
        },
        securitySchemes: {
          OAuth2: {
            type: 'oauth2',
            flows: {
              deviceAuthorization: {
                deviceAuthorizationUrl: 'https://auth.example.test/device',
                tokenUrl: 'https://auth.example.test/token',
                scopes: {},
              },
            },
            oauth2MetadataUrl: 'https://auth.example.test/.well-known/oauth-authorization-server',
          },
        },
      },
    }

    const { transformed, sidecar } = downgrade(original)

    expect(transformed.openapi).toBe('3.1.0')
    expect(JSON.stringify(transformed)).not.toContain('additionalOperations')
    expect(JSON.stringify(transformed)).not.toContain('itemSchema')
    expect(JSON.stringify(transformed)).not.toContain('deviceAuthorizationUrl')
    expect(sidecar).toEqual(expect.objectContaining({
      '/additionalOperations': original.additionalOperations,
      '/servers/0/name': 'production',
      '/tags/0/parent': 'identity',
      '/tags/0/kind': 'nav',
      '/paths/~1users/query': original.paths['/users'].query,
      '/components/pathItems': original.components.pathItems,
      '/components/mediaTypes': original.components.mediaTypes,
      '/components/schemas/User/itemSchema': original.components.schemas.User.itemSchema,
      '/components/schemas/User/properties/manager/summary': 'Recursive manager reference',
      '/components/schemas/User/properties/manager/description': 'Allowed in 3.2 ref override fields.',
      '/components/securitySchemes/OAuth2/oauth2MetadataUrl': original.components.securitySchemes.OAuth2.oauth2MetadataUrl,
    }))

    const restored = upgrade(transformed, sidecar)

    expect(restored).toEqual(original)
  })
})
