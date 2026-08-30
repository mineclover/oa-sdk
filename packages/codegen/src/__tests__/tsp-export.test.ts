import { describe, expect, it } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import { exportOpenApiToTypeSpec } from '../cli/lib/tsp-export.js'

describe('TypeSpec export spike', () => {
  it('exports core OpenAPI structure to compilable-looking TypeSpec with diagnostics', () => {
    const document: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'OA SDK API', version: '0.1.0' },
      servers: [{ url: 'http://localhost:4010', description: 'Mock server' }],
      tags: [{ name: 'users', description: 'User management' }],
      paths: {
        '/users/{id}': {
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          get: {
            operationId: 'getUser',
            summary: 'Get user',
            description: 'Load one user by id.',
            tags: ['users'],
            security: [{ bearerAuth: [] }],
            parameters: [
              { $ref: '#/components/parameters/Page' },
            ],
            responses: {
              '200': {
                description: 'User response',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/User' },
                    examples: {
                      default: { value: { id: '00000000-0000-0000-0000-000000000001' } },
                    },
                  },
                },
              },
              '401': { $ref: '#/components/responses/Unauthorized' },
              '429': {
                description: 'Rate limited',
                headers: {
                  'Retry-After': {
                    description: 'Retry after seconds.',
                    required: true,
                    schema: { type: 'string', example: '30' },
                  },
                },
              },
            },
          },
        },
        '/users': {
          post: {
            operationId: 'createUser',
            tags: ['users'],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CreateUserRequest' },
                  examples: {
                    default: {
                      value: {
                        email: 'bob@example.com',
                      },
                    },
                  },
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
        parameters: {
          Page: {
            name: 'page',
            in: 'query',
            schema: { type: 'integer', minimum: 1, default: 1 },
            examples: { default: { value: 1 } },
          },
        },
        responses: {
          Unauthorized: {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
        },
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
        },
        schemas: {
          User: {
            type: 'object',
            required: ['id', 'email', 'role', 'createdAt'],
            additionalProperties: false,
            example: {
              id: '00000000-0000-0000-0000-000000000001',
              email: 'alice@example.com',
              role: 'user',
              createdAt: '2024-01-01T00:00:00.000Z',
            },
            properties: {
              id: {
                type: 'string',
                format: 'uuid',
                description: 'Stable user id.',
                example: '00000000-0000-0000-0000-000000000001',
              },
              email: { type: 'string', format: 'email' },
              name: { type: 'string', minLength: 1, maxLength: 100, default: 'Anonymous' },
              role: { type: 'string', enum: ['admin', 'user'], default: 'user' },
              tags: { type: 'array', items: { type: 'string' }, default: ['new'] },
              preferences: {
                type: 'object',
                properties: {
                  emailNotifications: { type: 'boolean' },
                },
                default: { emailNotifications: true },
              },
              oldNickname: { type: 'string', deprecated: true },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
          CreateUserRequest: {
            type: 'object',
            required: ['email'],
            properties: {
              email: { type: 'string', format: 'email' },
            },
          },
          Error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    }

    const result = exportOpenApiToTypeSpec(document, { namespace: 'OaSdkApi' })

    expect(result.source).toContain('import "@typespec/http";')
    expect(result.source).toContain('@server("http://localhost:4010", "Mock server")')
    expect(result.source).toContain('@service(#{ title: "OA SDK API" })')
    expect(result.source).toContain('@info(#{ version: "0.1.0" })')
    expect(result.source).toContain('@tagMetadata("users", #{ description: "User management" })')
    expect(result.source).toContain('namespace OaSdkApi;')
    expect(result.source).toContain('model bearerAuth is BearerAuth;')
    expect(result.source).toContain('model User {')
    expect(result.source).toContain('@example(#{ id: "00000000-0000-0000-0000-000000000001", email: "alice@example.com", role: "user", createdAt: utcDateTime.fromISO("2024-01-01T00:00:00.000Z") })')
    expect(result.source).toContain('@example("00000000-0000-0000-0000-000000000001")')
    expect(result.source).toContain('@doc("Stable user id.")')
    expect(result.source).toContain('@format("uuid")')
    expect(result.source).toContain('id: string;')
    expect(result.source).toContain('@format("email")')
    expect(result.source).toContain('name?: string = "Anonymous";')
    expect(result.source).toContain('tags?: string[] = #["new"];')
    expect(result.source).toContain('preferences?: UserPreferences = #{ emailNotifications: true };')
    expect(result.source).toContain('createdAt: utcDateTime;')
    expect(result.source).toContain('role: "admin" | "user" = "user";')
    expect(result.source).toContain('#deprecated "Deprecated"')
    expect(result.source).toContain('oldNickname?: string;')
    expect(result.source).toContain('...Record<never>;')
    expect(result.source).toContain('@operationId("getUser")')
    expect(result.source).toContain('@useAuth(bearerAuth)')
    expect(result.source).toContain('@route("/users/{id}")')
    expect(result.source).toContain('@get')
    expect(result.source).toContain('@path @format("uuid") id: string')
    expect(result.source).toContain('@query @minValue(1) page?: integer = 1')
    expect(result.source).toContain('model GetUser200Response {')
    expect(result.source).toContain('@statusCode statusCode: 200;')
    expect(result.source).toContain('@body body: User;')
    expect(result.source).toContain('model GetUser429Response {')
    expect(result.source).toContain('@doc("Retry after seconds.")')
    expect(result.source).toContain('@header("Retry-After")')
    expect(result.source).toContain('retryAfter: string;')
    expect(result.source).toContain('@post')
    expect(result.source).toContain('@body body: CreateUserRequest')

    expect(result.report.counts.componentSchemas).toBe(3)
    expect(result.report.counts.operations).toBe(2)
    const diagnosticCodes = result.report.diagnostics.map(diagnostic => diagnostic.code)
    expect(diagnosticCodes).toEqual(
      expect.arrayContaining([
        'parameter/examples-dropped',
        'request-body/examples-dropped',
        'response/examples-dropped',
      ]),
    )
    expect(diagnosticCodes).not.toContain('schema/default-dropped')
    expect(diagnosticCodes).not.toContain('schema/deprecated-dropped')
    expect(diagnosticCodes).not.toContain('response/headers-dropped')
    expect(diagnosticCodes).not.toContain('tags/metadata-dropped')
    expect(diagnosticCodes).not.toContain('components/security-schemes-dropped')
    expect(diagnosticCodes).not.toContain('operation/security-dropped')
  })

  it('preserves OpenAPI object maps as TypeSpec Record types', () => {
    const document: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Maps', version: '0.1.0' },
      paths: {},
      components: {
        schemas: {
          RoleBindings: {
            type: 'object',
            unevaluatedProperties: { type: 'string' },
          },
          FlexiblePayload: {
            type: 'object',
            unevaluatedProperties: {},
          },
          SealedPayload: {
            type: 'object',
            unevaluatedProperties: { not: {} },
          },
          LegacyMap: {
            type: 'object',
            additionalProperties: { type: 'boolean' },
          },
          FixedAndMap: {
            type: 'object',
            properties: {
              id: { type: 'string' },
            },
            unevaluatedProperties: { type: 'integer' },
          },
          CombinedMap: {
            type: 'object',
            additionalProperties: false,
            unevaluatedProperties: { type: 'string' },
          },
          RequiredMap: {
            type: 'object',
            required: ['dynamic'],
            unevaluatedProperties: { type: 'string' },
          },
          ComposedMap: {
            type: 'object',
            allOf: [{ properties: { id: { type: 'string' } } }],
            unevaluatedProperties: { type: 'string' },
          },
          SubmitActionRequest: {
            type: 'object',
            properties: {
              roles: {
                type: 'object',
                unevaluatedProperties: { type: 'string' },
              },
              parameters: {
                type: 'object',
                unevaluatedProperties: {},
              },
            },
          },
        },
      },
    }

    const result = exportOpenApiToTypeSpec(document, { namespace: 'MapsApi' })

    expect(result.source).toContain('model RoleBindings {\n  ...Record<string>;\n}')
    expect(result.source).toContain('model FlexiblePayload {\n  ...Record<unknown>;\n}')
    expect(result.source).toContain('model SealedPayload {\n  ...Record<never>;\n}')
    expect(result.source).toContain('model LegacyMap {\n  ...Record<boolean>;\n}')
    expect(result.source).toContain('model FixedAndMap {\n  id?: string;\n  ...Record<integer>;\n}')
    expect(result.source).toContain('roles?: Record<string>;')
    expect(result.source).toContain('parameters?: Record<unknown>;')
    expect(result.source).not.toContain('model SubmitActionRequestRoles {')
    expect(result.source).not.toContain('model SubmitActionRequestParameters {')
    expect(result.source).toContain('model CombinedMap {\n}')
    expect(result.source).toContain('model RequiredMap {\n}')
    expect(result.source).toContain('model ComposedMap {\n}')
    expect(result.report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'schema/unevaluated-properties-dropped',
        pointer: '#/components/schemas/CombinedMap/unevaluatedProperties',
      }),
      expect.objectContaining({
        code: 'schema/unevaluated-properties-dropped',
        pointer: '#/components/schemas/RequiredMap/unevaluatedProperties',
      }),
      expect.objectContaining({
        code: 'schema/unevaluated-properties-dropped',
        pointer: '#/components/schemas/ComposedMap/unevaluatedProperties',
      }),
    ]))
  })

  it('exports a named formatted string as a native scalar', () => {
    const document: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'UUID scalar', version: '0.1.0' },
      paths: {},
      components: {
        schemas: {
          ActiveEntityId: {
            type: 'string',
            format: 'uuid',
            description: 'Action role binding entity UUID.',
          },
        },
      },
    }

    const result = exportOpenApiToTypeSpec(document, { namespace: 'ScalarApi' })

    expect(result.source).toContain('@doc("Action role binding entity UUID.")\n@format("uuid")\nscalar ActiveEntityId extends string;')
  })

  it('diagnoses OAS 3.2 querystring parameters instead of rewriting them as @query', () => {
    const document: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Querystring', version: '0.1.0' },
      paths: {
        '/search': {
          get: {
            operationId: 'search',
            parameters: [{
              name: 'rawQuery',
              in: 'querystring',
              required: true,
              schema: { type: 'string' },
            }],
            responses: { '204': { description: 'No content' } },
          },
        },
      },
    }

    const result = exportOpenApiToTypeSpec(document, { namespace: 'QuerystringApi' })

    expect(result.source).toContain('op search(): Search204Response;')
    expect(result.source).not.toContain('@query rawQuery')
    expect(result.source).not.toContain('rawQuery: string')
    expect(result.report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'parameter/querystring-unsupported',
      pointer: '#/paths/~1search/get/parameters/0',
      message: expect.stringContaining('whole-query semantics'),
    }))
  })

  it('exports the strict OpenAPI 3.2 SSE itemSchema shape as native TypeSpec events', () => {
    const document: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'SSE', version: '0.1.0' },
      paths: {
        '/health/stream': {
          get: {
            operationId: 'streamHealthEvents',
            responses: {
              '200': {
                description: 'Health stream',
                content: {
                  'text/event-stream': {
                    itemSchema: {
                      type: 'object',
                      properties: {
                        event: { type: 'string' },
                        data: { type: 'string' },
                      },
                      required: ['event'],
                      oneOf: [{
                        properties: {
                          event: { const: 'health' },
                          data: {
                            contentMediaType: 'application/json',
                            contentSchema: { $ref: '#/components/schemas/HealthEvent' },
                          },
                        },
                      }],
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          HealthEvent: {
            type: 'object',
            properties: {
              status: { type: 'string' },
            },
          },
        },
      },
    }

    const result = exportOpenApiToTypeSpec(document, { namespace: 'SseApi' })

    expect(result.source).toContain('import "@typespec/events";')
    expect(result.source).toContain('import "@typespec/sse";')
    expect(result.source).toContain('import "@typespec/streams";')
    expect(result.source).toContain('using TypeSpec.Events;')
    expect(result.source).toContain('using TypeSpec.SSE;')
    expect(result.source).toContain('@events\nunion StreamHealthEvents200Events {\n  health: HealthEvent;\n}')
    expect(result.source).toContain('model StreamHealthEvents200Response is SSEStream<StreamHealthEvents200Events> {')
    expect(result.report.diagnostics.map(diagnostic => diagnostic.code)).not.toEqual(expect.arrayContaining([
      'response/media-type-dropped',
      'response/schema-missing',
    ]))
  })

  it('retains diagnostics instead of guessing unsupported SSE itemSchema forms', () => {
    const document: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Unsupported SSE', version: '0.1.0' },
      paths: {
        '/events': {
          get: {
            operationId: 'streamEvents',
            responses: {
              '200': {
                description: 'Unsupported stream',
                content: {
                  'text/event-stream': {
                    itemSchema: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
    }

    const result = exportOpenApiToTypeSpec(document, { namespace: 'UnsupportedSseApi' })

    expect(result.source).not.toContain('import "@typespec/sse";')
    expect(result.report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'response/media-type-dropped' }),
      expect.objectContaining({ code: 'response/schema-missing' }),
    ]))
  })

  it('diagnoses defaults that cannot be represented as TypeSpec value literals', () => {
    const document: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Defaults', version: '0.1.0' },
      paths: {},
      components: {
        schemas: {
          Request: {
            type: 'object',
            properties: {
              metadata: {
                type: 'object',
                properties: {
                  'x-enabled': { type: 'boolean' },
                },
                default: { 'x-enabled': true },
                example: { 'x-enabled': true },
              },
            },
          },
        },
      },
    }

    const result = exportOpenApiToTypeSpec(document, { namespace: 'DefaultsApi' })

    expect(result.source).not.toContain('#{ "x-enabled": true }')
    expect(result.report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'schema/default-unsupported',
      pointer: '#/components/schemas/Request/properties/metadata/default',
    }))
    expect(result.report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'schema/examples-unsupported',
      pointer: '#/components/schemas/Request/properties/metadata/examples/0',
    }))
  })

  it('accepts the validation received summary field as an intentional unknown escape hatch', () => {
    const document: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Validation Error', version: '0.1.0' },
      paths: {},
      components: {
        schemas: {
          ValidationError: {
            type: 'object',
            properties: {
              received: {
                description: 'Content-free validation summary.',
              },
            },
          },
        },
      },
    }

    const result = exportOpenApiToTypeSpec(document, { namespace: 'ValidationErrorApi' })

    expect(result.source).toContain('@doc("Content-free validation summary.")')
    expect(result.source).toContain('received?: unknown;')
    expect(result.report.diagnostics).not.toContainEqual(expect.objectContaining({
      code: 'schema/type-unknown',
      pointer: '#/components/schemas/ValidationError/properties/received',
    }))
  })

  it('accepts model-declared projection values as intentional unknown escape hatches', () => {
    const document: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'World projections', version: '0.1.0' },
      paths: {},
      components: {
        schemas: {
          ProjectionEnvelope: {
            type: 'object',
            properties: { value: { description: 'Published model projection value.' } },
          },
          ProjectionBundleItem: {
            type: 'object',
            properties: { value: { description: 'Published model projection value.' } },
          },
        },
      },
    }

    const result = exportOpenApiToTypeSpec(document, { namespace: 'WorldProjectionApi' })

    expect(result.report.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'schema/type-unknown',
        pointer: '#/components/schemas/ProjectionEnvelope/properties/value',
      }),
      expect.objectContaining({
        code: 'schema/type-unknown',
        pointer: '#/components/schemas/ProjectionBundleItem/properties/value',
      }),
    ]))
  })

  it('diagnoses untyped schemas outside the accepted validation received field', () => {
    const document: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Unknown Schema', version: '0.1.0' },
      paths: {},
      components: {
        schemas: {
          Request: {
            type: 'object',
            properties: {
              raw: {
                description: 'Raw value.',
              },
            },
          },
        },
      },
    }

    const result = exportOpenApiToTypeSpec(document, { namespace: 'UnknownSchemaApi' })

    expect(result.source).toContain('raw?: unknown;')
    expect(result.report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'schema/type-unknown',
      pointer: '#/components/schemas/Request/properties/raw',
    }))
  })
})
