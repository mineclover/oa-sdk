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
            properties: {
              id: { type: 'string', format: 'uuid', description: 'Stable user id.' },
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
    expect(result.source).toContain('namespace OaSdkApi;')
    expect(result.source).toContain('model User {')
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
    expect(result.source).toContain('@route("/users/{id}")')
    expect(result.source).toContain('@get')
    expect(result.source).toContain('@path @format("uuid") id: string')
    expect(result.source).toContain('@query @minValue(1) page?: int32 = 1')
    expect(result.source).toContain('model GetUser200Response {')
    expect(result.source).toContain('@statusCode statusCode: 200;')
    expect(result.source).toContain('@body body: User;')
    expect(result.source).toContain('@post')
    expect(result.source).toContain('@body body: CreateUserRequest')

    expect(result.report.counts.componentSchemas).toBe(3)
    expect(result.report.counts.operations).toBe(2)
    const diagnosticCodes = result.report.diagnostics.map(diagnostic => diagnostic.code)
    expect(diagnosticCodes).toEqual(
      expect.arrayContaining([
        'components/security-schemes-dropped',
        'parameter/examples-dropped',
        'response/examples-dropped',
        'tags/metadata-dropped',
      ]),
    )
    expect(diagnosticCodes).not.toContain('schema/default-dropped')
    expect(diagnosticCodes).not.toContain('schema/deprecated-dropped')
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
  })
})
