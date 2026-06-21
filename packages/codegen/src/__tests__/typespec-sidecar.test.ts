import { describe, expect, it } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import {
  applyTypeSpecCompatibilitySidecar,
  createTypeSpecCompatibilitySidecar,
  parseTypeSpecCompatibilitySidecar,
} from '../cli/lib/typespec-sidecar.js'

describe('TypeSpec compatibility sidecar', () => {
  it('captures and restores OpenAPI-owned examples and unsupported security metadata', () => {
    const source: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Source', version: '1.0.0' },
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            parameters: [
              { $ref: '#/components/parameters/Page' },
            ],
            responses: {
              '200': { $ref: '#/components/responses/UserList' },
            },
          },
        },
        '/users/{id}': {
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              examples: {
                default: {
                  dataValue: 'usr_1',
                  serializedValue: 'usr_1',
                },
              },
            },
          ],
          get: {
            operationId: 'getUser',
            responses: {
              '200': { description: 'OK' },
            },
          },
          delete: {
            operationId: 'deleteUser',
            responses: {
              '204': { description: 'No Content' },
            },
          },
        },
      },
      components: {
        parameters: {
          Page: {
            name: 'page',
            in: 'query',
            schema: { type: 'integer', default: 1 },
            examples: {
              default: {
                dataValue: 1,
                serializedValue: 'page=1',
              },
            },
          },
        },
        responses: {
          UserList: {
            description: 'Users',
            content: {
              'application/json': {
                schema: { type: 'object' },
                examples: {
                  default: {
                    dataValue: { items: [] },
                  },
                },
              },
            },
          },
        },
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
          oauth2: {
            type: 'oauth2',
            flows: {
              authorizationCode: {
                authorizationUrl: 'https://auth.example.com/authorize',
                tokenUrl: 'https://auth.example.com/token',
                scopes: { read: 'Read' },
              },
            },
          },
        },
      },
    }
    const emitted: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Source', version: '1.0.0' },
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            parameters: [
              {
                name: 'page',
                in: 'query',
                schema: { type: 'integer', default: 1 },
              },
            ],
            responses: {
              '200': {
                description: 'Users',
                content: {
                  'application/json': {
                    schema: { type: 'object' },
                  },
                },
              },
            },
          },
        },
        '/users/{id}': {
          get: {
            operationId: 'getUser',
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': { description: 'OK' },
            },
          },
          delete: {
            operationId: 'deleteUser',
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: {
              '204': { description: 'No Content' },
            },
          },
        },
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
        },
      },
    }

    const sidecar = createTypeSpecCompatibilitySidecar(source)
    const parsed = parseTypeSpecCompatibilitySidecar(JSON.parse(JSON.stringify(sidecar)) as unknown)
    const restored = applyTypeSpecCompatibilitySidecar(emitted, parsed)

    expect(sidecar.counts).toEqual({
      entries: 4,
      parameterExamples: 2,
      responseMediaExamples: 1,
      securitySchemes: 1,
    })
    expect(restored.report.counts).toEqual({
      entries: 4,
      applied: 5,
      missingTargets: 0,
    })
    expect(restored.report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'typespec-sidecar/parameter-examples-applied-to-multiple-targets',
    }))
    expect(restored.document.components?.securitySchemes?.oauth2).toEqual(source.components?.securitySchemes?.oauth2)
    const restoredDoc = restored.document as Record<string, any>
    const sourceDoc = source as Record<string, any>
    const listUsers = restoredDoc.paths['/users'].get
    expect(listUsers?.parameters?.[0]).toEqual(expect.objectContaining({
      examples: sourceDoc.components.parameters.Page.examples,
    }))
    const listUsers200 = listUsers?.responses?.['200']
    expect(listUsers200 && 'content' in listUsers200
      ? listUsers200.content?.['application/json']?.examples
      : undefined).toEqual(sourceDoc.components.responses.UserList.content['application/json'].examples)
    expect(restoredDoc.paths['/users/{id}'].get.parameters[0]).toEqual(expect.objectContaining({
      examples: sourceDoc.paths['/users/{id}'].parameters[0].examples,
    }))
    expect(restoredDoc.paths['/users/{id}'].delete.parameters[0]).toEqual(expect.objectContaining({
      examples: sourceDoc.paths['/users/{id}'].parameters[0].examples,
    }))
  })

  it('reports missing restore targets without mutating the input document', () => {
    const source: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Source', version: '1.0.0' },
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: {
              '200': {
                description: 'Users',
                content: {
                  'application/json': {
                    schema: { type: 'object' },
                    examples: {
                      default: { dataValue: { items: [] } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }
    const emitted: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Source', version: '1.0.0' },
      paths: {},
    }

    const sidecar = createTypeSpecCompatibilitySidecar(source)
    const restored = applyTypeSpecCompatibilitySidecar(emitted, sidecar)

    expect(restored.report.counts).toEqual({
      entries: 1,
      applied: 0,
      missingTargets: 1,
    })
    expect(restored.report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'typespec-sidecar/missing-target',
      pointer: '#/paths/~1users/get/responses/200/content/application~1json',
    }))
    expect(emitted.paths).toEqual({})
  })

  it('rejects non-sidecar JSON payloads', () => {
    expect(() => parseTypeSpecCompatibilitySidecar({ schemaVersion: 'wrong', entries: [] })).toThrow(
      /invalid TypeSpec compatibility sidecar/,
    )
  })

  it('rejects malformed sidecar entries and inconsistent counts', () => {
    const valid = createTypeSpecCompatibilitySidecar({
      openapi: '3.2.0',
      info: { title: 'Source', version: '1.0.0' },
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: {
              '200': {
                description: 'Users',
                content: {
                  'application/json': {
                    schema: { type: 'object' },
                    examples: { default: { dataValue: { items: [] } } },
                  },
                },
              },
            },
          },
        },
      },
    })

    expect(() => parseTypeSpecCompatibilitySidecar({
      ...valid,
      counts: { ...valid.counts, entries: valid.counts.entries + 1 },
    })).toThrow(/counts\.entries/)

    expect(() => parseTypeSpecCompatibilitySidecar({
      schemaVersion: 'oa-sdk.typespec-compat-sidecar.v1',
      counts: {
        entries: 1,
        parameterExamples: 0,
        responseMediaExamples: 1,
        securitySchemes: 0,
      },
      entries: [
        {
          kind: 'response-media-examples',
          pointer: '#/paths/~1users/get/responses/200/content/application~1json',
          target: {
            path: '/users',
            method: 'bogus',
            statusCode: '200',
            mediaType: 'application/json',
          },
          value: {
            examples: {
              default: { dataValue: { items: [] } },
            },
          },
        },
      ],
    })).toThrow(/target\.method/)

    expect(() => parseTypeSpecCompatibilitySidecar({
      schemaVersion: 'oa-sdk.typespec-compat-sidecar.v1',
      counts: {
        entries: 1,
        parameterExamples: 1,
        responseMediaExamples: 0,
        securitySchemes: 0,
      },
      entries: [
        {
          kind: 'parameter-examples',
          pointer: '#/paths/~1users/get/parameters/0',
          target: {
            path: '/users',
            method: 'get',
            name: 'page',
            in: 'query',
          },
          value: { example: undefined },
        },
      ],
    })).toThrow(/value\.example/)
  })
})
