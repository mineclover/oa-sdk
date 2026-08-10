import { describe, expect, it } from 'vitest'
import { convertTypeSpecSidecarToExtensions } from '../cli/lib/typespec-sidecar-to-extensions.js'
import { parseTypeSpecCompatibilitySidecar } from '../cli/lib/typespec-sidecar.js'

describe('TypeSpec sidecar-to-extension migration', () => {
  it('converts supported sidecar entries into TypeSpec extension snippets', () => {
    const sidecar = parseTypeSpecCompatibilitySidecar({
      schemaVersion: 'oa-sdk.typespec-compat-sidecar.v1',
      counts: {
        entries: 5,
        parameterExamples: 2,
        requestMediaExamples: 1,
        responseMediaExamples: 1,
        securitySchemes: 1,
      },
      entries: [
        {
          kind: 'security-scheme',
          pointer: '#/components/securitySchemes/oauth2',
          target: { name: 'oauth2' },
          value: {
            type: 'oauth2',
            flows: {
              authorizationCode: {
                authorizationUrl: 'https://auth.example.com/authorize',
                tokenUrl: 'https://auth.example.com/token',
                scopes: {
                  'read:users': 'Read users',
                },
              },
            },
          },
        },
        {
          kind: 'parameter-examples',
          pointer: '#/paths/~1users/get/parameters/0',
          target: { path: '/users', method: 'get', name: 'page', in: 'query' },
          value: {
            examples: {
              default: {
                dataValue: 1,
                serializedValue: 'page=1',
              },
            },
          },
        },
        {
          kind: 'parameter-examples',
          pointer: '#/paths/~1users/parameters/0',
          target: { path: '/users', name: 'tenant', in: 'header' },
          value: {
            example: 'tenant-a',
          },
        },
        {
          kind: 'request-media-examples',
          pointer: '#/paths/~1users/post/requestBody/content/application~1json',
          target: { path: '/users', method: 'post', mediaType: 'application/json' },
          value: {
            examples: {
              default: {
                dataValue: { name: 'Bob' },
                serializedValue: '{"name":"Bob"}',
              },
            },
          },
        },
        {
          kind: 'response-media-examples',
          pointer: '#/paths/~1users/post/responses/201/content/application~1json',
          target: { path: '/users', method: 'post', statusCode: '201', mediaType: 'application/json' },
          value: {
            examples: {
              default: {
                dataValue: { id: 'usr_1' },
              },
            },
          },
        },
      ],
    })

    const result = convertTypeSpecSidecarToExtensions(sidecar)

    expect(result.report.counts).toEqual({
      sourceEntries: 5,
      convertedEntries: 4,
      remainingEntries: 1,
      operationExtensionGroups: 2,
      componentParameters: 0,
      componentResponses: 0,
      securitySchemes: 1,
    })
    expect(result.report.converted.map(entry => entry.kind)).toEqual([
      'security-scheme',
      'parameter-examples',
      'request-media-examples',
      'response-media-examples',
    ])
    expect(result.report.remaining).toEqual([
      expect.objectContaining({
        kind: 'parameter-examples',
        pointer: '#/paths/~1users/parameters/0',
        reason: expect.stringContaining('path-level parameter examples'),
      }),
    ])
    expect(result.remainingSidecar.counts).toEqual({
      entries: 1,
      parameterExamples: 1,
      responseMediaExamples: 0,
      securitySchemes: 0,
    })
    expect(result.snippets).toContain('@extension("x-oa-sdk-security-schemes", #{')
    expect(result.snippets).toContain('scopes: #[')
    expect(result.snippets).toContain('name: "read:users"')
    expect(result.snippets).toContain('// GET /users')
    expect(result.snippets).toContain('parameters: #{')
    expect(result.snippets).toContain('name: "page"')
    expect(result.snippets).toContain('// POST /users')
    expect(result.snippets).toContain('requestBody: #{')
    expect(result.snippets).toContain('responses: #{')
    expect(result.snippets).not.toContain('tenant-a')
  })

  it('converts reusable component catalog entries when targeting v5 extensions', () => {
    const sidecar = parseTypeSpecCompatibilitySidecar({
      schemaVersion: 'oa-sdk.typespec-compat-sidecar.v1',
      counts: {
        entries: 2,
        componentParameters: 1,
        componentResponses: 1,
        parameterExamples: 0,
        responseMediaExamples: 0,
        securitySchemes: 0,
      },
      entries: [
        {
          kind: 'component-parameter',
          pointer: '#/components/parameters/Page',
          target: { name: 'Page' },
          value: {
            name: 'page',
            in: 'query',
            schema: { type: 'integer', default: 1 },
          },
        },
        {
          kind: 'component-response',
          pointer: '#/components/responses/TooManyRequests',
          target: { name: 'TooManyRequests' },
          value: {
            description: 'Rate limited',
            headers: {
              'Retry-After': {
                description: 'Retry delay',
                schema: { type: 'string' },
              },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
        },
      ],
    })

    const result = convertTypeSpecSidecarToExtensions(sidecar, {
      extensionSchemaVersion: 'oa-sdk.typespec-extensions.v5',
    })

    expect(result.report.counts).toEqual({
      sourceEntries: 2,
      convertedEntries: 2,
      remainingEntries: 0,
      operationExtensionGroups: 0,
      componentParameters: 1,
      componentResponses: 1,
      securitySchemes: 0,
    })
    expect(result.report.converted.map(entry => entry.extension)).toEqual([
      'x-oa-sdk-components',
      'x-oa-sdk-components',
    ])
    expect(result.snippets).toContain('@extension("x-oa-sdk-components", #{')
    expect(result.snippets).toContain('parameters: #[')
    expect(result.snippets).toContain('name: "Page"')
    expect(result.snippets).toContain('responses: #[')
    expect(result.snippets).toContain('mediaType: "application/json"')
    expect(result.snippets).toContain('ref: "#/components/schemas/Error"')
    expect(result.remainingSidecar.entries).toEqual([])
  })

  it('converts operation component refs when targeting v5 extensions', () => {
    const sidecar = parseTypeSpecCompatibilitySidecar({
      schemaVersion: 'oa-sdk.typespec-compat-sidecar.v1',
      counts: {
        entries: 2,
        operationParameterRefs: 1,
        operationResponseRefs: 1,
        parameterExamples: 0,
        responseMediaExamples: 0,
        securitySchemes: 0,
      },
      entries: [
        {
          kind: 'operation-parameter-ref',
          pointer: '#/paths/~1users/get/parameters/0',
          target: { path: '/users', method: 'get', index: 0 },
          value: { $ref: '#/components/parameters/Page' },
        },
        {
          kind: 'operation-response-ref',
          pointer: '#/paths/~1users/get/responses/401',
          target: { path: '/users', method: 'get', statusCode: '401' },
          value: { $ref: '#/components/responses/Unauthorized' },
        },
      ],
    })

    const result = convertTypeSpecSidecarToExtensions(sidecar, {
      extensionSchemaVersion: 'oa-sdk.typespec-extensions.v5',
    })

    expect(result.report.counts).toEqual({
      sourceEntries: 2,
      convertedEntries: 2,
      remainingEntries: 0,
      operationExtensionGroups: 1,
      componentParameters: 0,
      componentResponses: 0,
      securitySchemes: 0,
    })
    expect(result.report.converted.map(entry => entry.extension)).toEqual([
      'x-oa-sdk-operation-component-refs',
      'x-oa-sdk-operation-component-refs',
    ])
    expect(result.snippets).toContain('// GET /users')
    expect(result.snippets).toContain('@extension("x-oa-sdk-operation-component-refs", #{')
    expect(result.snippets).toContain('parameters: #[')
    expect(result.snippets).toContain('index: 0')
    expect(result.snippets).toContain('responses: #[')
    expect(result.snippets).toContain('statusCode: "401"')
    expect(result.snippets).toContain('ref: "#/components/responses/Unauthorized"')
  })

  it('converts request media examples with the default v5 extensions', () => {
    const sidecar = parseTypeSpecCompatibilitySidecar({
      schemaVersion: 'oa-sdk.typespec-compat-sidecar.v1',
      counts: {
        entries: 1,
        parameterExamples: 0,
        requestMediaExamples: 1,
        responseMediaExamples: 0,
        securitySchemes: 0,
      },
      entries: [
        {
          kind: 'request-media-examples',
          pointer: '#/paths/~1users/post/requestBody/content/application~1json',
          target: { path: '/users', method: 'post', mediaType: 'application/json' },
          value: { example: { name: 'Bob' } },
        },
      ],
    })

    const result = convertTypeSpecSidecarToExtensions(sidecar)

    expect(result.report.counts.convertedEntries).toBe(1)
    expect(result.report.counts.remainingEntries).toBe(0)
    expect(result.remainingSidecar.counts).toEqual({
      entries: 0,
      parameterExamples: 0,
      responseMediaExamples: 0,
      securitySchemes: 0,
    })
    expect(result.snippets).toContain('requestBody: #{')
  })

  it('keeps non-renderable example values in the sidecar instead of comments', () => {
    const sidecar = parseTypeSpecCompatibilitySidecar({
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
          target: { path: '/users', method: 'get', name: 'filter', in: 'query' },
          value: {
            example: {
              'x-invalid-key': true,
            },
          },
        },
      ],
    })

    const result = convertTypeSpecSidecarToExtensions(sidecar)

    expect(result.report.counts.convertedEntries).toBe(0)
    expect(result.report.counts.remainingEntries).toBe(1)
    expect(result.report.remaining[0]?.reason).toContain('cannot be rendered as TypeSpec value literals')
    expect(result.snippets).not.toContain('x-invalid-key')
  })

  it('does not rename security scheme targets that are not stable TypeSpec object keys', () => {
    const sidecar = parseTypeSpecCompatibilitySidecar({
      schemaVersion: 'oa-sdk.typespec-compat-sidecar.v1',
      counts: {
        entries: 1,
        parameterExamples: 0,
        responseMediaExamples: 0,
        securitySchemes: 1,
      },
      entries: [
        {
          kind: 'security-scheme',
          pointer: '#/components/securitySchemes/oauth-2',
          target: { name: 'oauth-2' },
          value: {
            type: 'oauth2',
            flows: {},
          },
        },
      ],
    })

    const result = convertTypeSpecSidecarToExtensions(sidecar)

    expect(result.report.counts.convertedEntries).toBe(0)
    expect(result.report.counts.remainingEntries).toBe(1)
    expect(result.report.remaining[0]?.reason).toContain('security scheme name cannot be rendered')
    expect(result.remainingSidecar.entries[0]?.target).toEqual({ name: 'oauth-2' })
    expect(result.snippets).not.toContain('oauth_2')
  })

  it('keeps security schemes with malformed OAuth scope descriptions in the sidecar', () => {
    const sidecar = parseTypeSpecCompatibilitySidecar({
      schemaVersion: 'oa-sdk.typespec-compat-sidecar.v1',
      counts: {
        entries: 1,
        parameterExamples: 0,
        responseMediaExamples: 0,
        securitySchemes: 1,
      },
      entries: [
        {
          kind: 'security-scheme',
          pointer: '#/components/securitySchemes/oauth2',
          target: { name: 'oauth2' },
          value: {
            type: 'oauth2',
            flows: {
              authorizationCode: {
                authorizationUrl: 'https://auth.example.com/authorize',
                tokenUrl: 'https://auth.example.com/token',
                scopes: {
                  read: { description: 'Read users' },
                },
              },
            },
          },
        },
      ],
    })

    const result = convertTypeSpecSidecarToExtensions(sidecar)

    expect(result.report.counts.convertedEntries).toBe(0)
    expect(result.report.counts.remainingEntries).toBe(1)
    expect(result.report.remaining[0]?.reason).toContain('security scheme scope descriptions must be strings')
    expect(result.remainingSidecar.entries[0]?.value).toEqual(sidecar.entries[0]?.value)
    expect(result.snippets).not.toContain('[object Object]')
  })
})
