import { describe, expect, it } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import {
  applyTypeSpecCompatibilitySidecar,
  compareTypeSpecCompatibilitySidecars,
  createTypeSpecCompatibilitySidecar,
  parseTypeSpecCompatibilitySidecar,
  type TypeSpecCompatibilitySidecar,
  type TypeSpecCompatibilitySidecarEntry,
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
                example: 999,
              },
            ],
            responses: {
              '200': {
                description: 'Users',
                content: {
                  'application/json': {
                    schema: { type: 'object' },
                    example: { stale: true },
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
                example: 'stale',
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
      entries: 8,
      componentParameters: 1,
      componentResponses: 1,
      operationParameterRefs: 1,
      operationResponseRefs: 1,
      parameterExamples: 2,
      responseMediaExamples: 1,
      securitySchemes: 1,
    })
    expect(restored.report.counts).toEqual({
      entries: 8,
      applied: 9,
      missingTargets: 0,
    })
    expect(restored.report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'typespec-sidecar/parameter-examples-applied-to-multiple-targets',
    }))
    expect(restored.document.components?.securitySchemes?.oauth2).toEqual(source.components?.securitySchemes?.oauth2)
    expect(restored.document.components?.parameters?.Page).toEqual(source.components?.parameters?.Page)
    expect(restored.document.components?.responses?.UserList).toEqual(source.components?.responses?.UserList)
    const restoredDoc = restored.document as Record<string, any>
    const sourceDoc = source as Record<string, any>
    const listUsers = restoredDoc.paths['/users'].get
    expect(listUsers?.parameters?.[0]).toEqual({ $ref: '#/components/parameters/Page' })
    expect(restoredDoc.components.parameters.Page).toEqual(expect.objectContaining({
      examples: sourceDoc.components.parameters.Page.examples,
    }))
    expect(restoredDoc.components.parameters.Page.example).toBeUndefined()
    const listUsers200 = listUsers?.responses?.['200']
    expect(listUsers200).toEqual({ $ref: '#/components/responses/UserList' })
    const listUsers200Json = restoredDoc.components.responses.UserList.content?.['application/json']
    expect(listUsers200Json?.examples).toEqual(sourceDoc.components.responses.UserList.content['application/json'].examples)
    expect(listUsers200Json?.example).toBeUndefined()
    expect(restoredDoc.paths['/users/{id}'].get.parameters[0]).toEqual(expect.objectContaining({
      examples: sourceDoc.paths['/users/{id}'].parameters[0].examples,
    }))
    expect(restoredDoc.paths['/users/{id}'].get.parameters[0].example).toBeUndefined()
    expect(restoredDoc.paths['/users/{id}'].delete.parameters[0]).toEqual(expect.objectContaining({
      examples: sourceDoc.paths['/users/{id}'].parameters[0].examples,
    }))
    expect(restoredDoc.paths['/users/{id}'].delete.parameters[0].example).toBeUndefined()
    const reExtracted = createTypeSpecCompatibilitySidecar(restored.document)
    expect(compareTypeSpecCompatibilitySidecars(sidecar, reExtracted).counts).toEqual({
      expectedEntries: 8,
      actualEntries: 9,
      expectedSatisfied: 8,
      actualCovered: 9,
      missingExpected: 0,
      unexpectedActual: 0,
      valueMismatches: 0,
    })
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

  it('captures, restores, and re-extracts request body media examples', () => {
    const source: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Source', version: '1.0.0' },
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: { $ref: '#/components/requestBodies/CreateUserBody' },
            responses: {
              '201': { description: 'Created' },
            },
          },
        },
      },
      components: {
        requestBodies: {
          CreateUserBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object' },
                examples: {
                  default: {
                    dataValue: {
                      email: 'alice@example.com',
                      name: 'Alice',
                    },
                    serializedValue: '{"email":"alice@example.com","name":"Alice"}',
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
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { type: 'object' },
                  example: { stale: true },
                },
              },
            },
            responses: {
              '201': { description: 'Created' },
            },
          },
        },
      },
    }

    const sidecar = createTypeSpecCompatibilitySidecar(source)
    const restored = applyTypeSpecCompatibilitySidecar(emitted, sidecar)

    expect(sidecar.counts).toEqual({
      entries: 1,
      parameterExamples: 0,
      requestMediaExamples: 1,
      responseMediaExamples: 0,
      securitySchemes: 0,
    })
    expect(restored.report.counts).toEqual({
      entries: 1,
      applied: 1,
      missingTargets: 0,
    })
    const restoredJson = (restored.document as Record<string, any>).paths['/users'].post.requestBody.content['application/json']
    expect(restoredJson.examples).toEqual(
      (source.components as Record<string, any>).requestBodies.CreateUserBody.content['application/json'].examples,
    )
    expect(restoredJson.example).toBeUndefined()
    const reExtracted = createTypeSpecCompatibilitySidecar(restored.document)
    expect(compareTypeSpecCompatibilitySidecars(sidecar, reExtracted).counts).toEqual({
      expectedEntries: 1,
      actualEntries: 1,
      expectedSatisfied: 1,
      actualCovered: 1,
      missingExpected: 0,
      unexpectedActual: 0,
      valueMismatches: 0,
    })
  })

  it('compares semantically equivalent sidecars after path-level parameter expansion', () => {
    const sharedParameterValue = {
      examples: {
        default: {
          dataValue: 'usr_1',
          serializedValue: 'usr_1',
        },
      },
    }
    const expected: TypeSpecCompatibilitySidecar = {
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
          pointer: '#/paths/~1users~1{id}/parameters/0',
          target: {
            path: '/users/{id}',
            name: 'id',
            in: 'path',
          },
          value: sharedParameterValue,
        },
      ],
    }
    const actual: TypeSpecCompatibilitySidecar = {
      schemaVersion: 'oa-sdk.typespec-compat-sidecar.v1',
      counts: {
        entries: 2,
        parameterExamples: 2,
        responseMediaExamples: 0,
        securitySchemes: 0,
      },
      entries: [
        {
          kind: 'parameter-examples',
          pointer: '#/paths/~1users~1{id}/get/parameters/0',
          target: {
            path: '/users/{id}',
            method: 'get',
            name: 'id',
            in: 'path',
          },
          value: sharedParameterValue,
        },
        {
          kind: 'parameter-examples',
          pointer: '#/paths/~1users~1{id}/delete/parameters/0',
          target: {
            path: '/users/{id}',
            method: 'delete',
            name: 'id',
            in: 'path',
          },
          value: {
            examples: {
              default: {
                serializedValue: 'usr_1',
                dataValue: 'usr_1',
              },
            },
          },
        },
      ],
    }

    const report = compareTypeSpecCompatibilitySidecars(expected, actual)

    expect(report.counts).toEqual({
      expectedEntries: 1,
      actualEntries: 2,
      expectedSatisfied: 1,
      actualCovered: 2,
      missingExpected: 0,
      unexpectedActual: 0,
      valueMismatches: 0,
    })
    expect(report.diagnostics).toEqual([])
  })

  it('reports sidecar comparison value mismatches and unexpected entries', () => {
    const responseEntry = {
      kind: 'response-media-examples',
      pointer: '#/paths/~1users/get/responses/200/content/application~1json',
      target: {
        path: '/users',
        method: 'get',
        statusCode: '200',
        mediaType: 'application/json',
      },
      value: {
        examples: {
          default: { dataValue: { items: [] } },
        },
      },
    } satisfies TypeSpecCompatibilitySidecarEntry
    const expected: TypeSpecCompatibilitySidecar = {
      schemaVersion: 'oa-sdk.typespec-compat-sidecar.v1',
      counts: {
        entries: 1,
        parameterExamples: 0,
        responseMediaExamples: 1,
        securitySchemes: 0,
      },
      entries: [
        responseEntry,
      ],
    }
    const actual: TypeSpecCompatibilitySidecar = {
      schemaVersion: 'oa-sdk.typespec-compat-sidecar.v1',
      counts: {
        entries: 2,
        parameterExamples: 0,
        responseMediaExamples: 1,
        securitySchemes: 1,
      },
      entries: [
        {
          ...responseEntry,
          value: {
            examples: {
              default: { dataValue: { items: [{ id: 'unexpected' }] } },
            },
          },
        },
        {
          kind: 'security-scheme',
          pointer: '#/components/securitySchemes/oauth2',
          target: { name: 'oauth2' },
          value: { type: 'oauth2', flows: {} },
        },
      ],
    }

    const report = compareTypeSpecCompatibilitySidecars(expected, actual)

    expect(report.counts).toEqual({
      expectedEntries: 1,
      actualEntries: 2,
      expectedSatisfied: 0,
      actualCovered: 0,
      missingExpected: 0,
      unexpectedActual: 1,
      valueMismatches: 1,
    })
    expect(report.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'typespec-sidecar/value-mismatch',
      'typespec-sidecar/unexpected-actual-entry',
    ])
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
