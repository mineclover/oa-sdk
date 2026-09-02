import { describe, it, expect } from 'vitest'
import {
  projectDiscriminatedUnion,
  projectDiscriminatedUnionDocument,
  validateOpenApiProjection,
  type DiscriminatedUnionProjectionOptions,
} from './index.js'

describe('projectDiscriminatedUnion — Core Functionality', () => {
  it('projects single-stream RPC operations (NativeRpcRequest) into canonical OpenAPI 3.1 discriminator + oneOf models', () => {
    const options: DiscriminatedUnionProjectionOptions = {
      discriminatorProperty: 'method',
      unionSchemaId: 'NativeRpcRequest',
      description: 'Polymorphic RPC request envelope',
      baseProperties: {
        id: { type: 'string' },
        params: { type: 'object' },
      },
      baseRequired: ['id', 'params'],
      variants: {
        'session.hello': {
          title: 'SessionHelloRequest',
          type: 'object',
          properties: {
            id: { type: 'string' },
            method: { type: 'string', const: 'session.hello' },
            params: {
              type: 'object',
              properties: {
                clientName: { type: 'string' },
                protocolVersion: { type: 'string' },
              },
              required: ['clientName'],
            },
          },
          required: ['id', 'method', 'params'],
        },
        'workspace.snapshot.save': {
          title: 'WorkspaceSnapshotSaveRequest',
          type: 'object',
          properties: {
            id: { type: 'string' },
            method: { type: 'string', const: 'workspace.snapshot.save' },
            params: {
              type: 'object',
              properties: {
                snapshotId: { type: 'string' },
                content: { type: 'string' },
              },
              required: ['snapshotId'],
            },
          },
          required: ['id', 'method', 'params'],
        },
        'materialize.css': {
          title: 'MaterializeCssRequest',
          type: 'object',
          properties: {
            id: { type: 'string' },
            method: { type: 'string', const: 'materialize.css' },
            params: { type: 'object' },
          },
          required: ['id', 'method', 'params'],
        },
        'lease.acquire': {
          title: 'LeaseAcquireRequest',
          type: 'object',
          properties: {
            id: { type: 'string' },
            method: { type: 'string', const: 'lease.acquire' },
            params: {
              type: 'object',
              properties: {
                resource: { type: 'string' },
                ttlSeconds: { type: 'number' },
              },
              required: ['resource'],
            },
          },
          required: ['id', 'method', 'params'],
        },
      },
    }

    const result = projectDiscriminatedUnion(options)

    expect(result.unionSchema).toEqual({
      type: 'object',
      description: 'Polymorphic RPC request envelope',
      required: ['id', 'params', 'method'],
      properties: {
        id: { type: 'string' },
        params: { type: 'object' },
        method: { type: 'string' },
      },
      discriminator: {
        propertyName: 'method',
        mapping: {
          'session.hello': '#/components/schemas/SessionHelloRequest',
          'workspace.snapshot.save': '#/components/schemas/WorkspaceSnapshotSaveRequest',
          'materialize.css': '#/components/schemas/MaterializeCssRequest',
          'lease.acquire': '#/components/schemas/LeaseAcquireRequest',
        },
      },
      oneOf: [
        { $ref: '#/components/schemas/SessionHelloRequest' },
        { $ref: '#/components/schemas/WorkspaceSnapshotSaveRequest' },
        { $ref: '#/components/schemas/MaterializeCssRequest' },
        { $ref: '#/components/schemas/LeaseAcquireRequest' },
      ],
    })

    expect(Object.keys(result.variantSchemas)).toEqual([
      'SessionHelloRequest',
      'WorkspaceSnapshotSaveRequest',
      'MaterializeCssRequest',
      'LeaseAcquireRequest',
    ])

    expect(result.variantSchemas['SessionHelloRequest']!.properties).toHaveProperty('method')
  })

  it('automatically derives variant schema names when titles/names are omitted', () => {
    const result = projectDiscriminatedUnion({
      discriminatorProperty: 'method',
      unionSchemaId: 'NativeRpcRequest',
      variants: {
        'session.hello': {
          type: 'object',
          properties: {
            data: { type: 'string' },
          },
        },
        'workspace.save': {
          type: 'object',
          properties: {
            snapshot: { type: 'string' },
          },
        },
      },
    })

    expect(result.variantSchemas).toHaveProperty('NativeRpcRequestSessionHello')
    expect(result.variantSchemas).toHaveProperty('NativeRpcRequestWorkspaceSave')
    expect(result.unionSchema.discriminator).toEqual({
      propertyName: 'method',
      mapping: {
        'session.hello': '#/components/schemas/NativeRpcRequestSessionHello',
        'workspace.save': '#/components/schemas/NativeRpcRequestWorkspaceSave',
      },
    })
  })

  it('injects missing discriminator property const and required into variant schema', () => {
    const result = projectDiscriminatedUnion({
      discriminatorProperty: 'op',
      unionSchemaId: 'CommandPayload',
      variants: {
        ping: {
          type: 'object',
          properties: {
            timestamp: { type: 'number' },
          },
        },
      },
    })

    const pingSchema = result.variantSchemas['CommandPayloadPing']!
    expect(pingSchema.properties).toEqual({
      timestamp: { type: 'number' },
      op: { type: 'string', const: 'ping' },
    })
    expect(pingSchema.required).toContain('op')
  })

  it('projects MCP stdio operations into OpenAPI operation-contract profile with paths', () => {
    const result = projectDiscriminatedUnion({
      discriminatorProperty: 'operation',
      unionSchemaId: 'DevLinkMcpControlRequestV1',
      profile: 'operation-contract',
      pathPrefix: '/mcp',
      variants: {
        'session.status': {
          name: 'McpSessionStatusRequest',
          summary: 'Query active DevLink session status',
          description: 'Canonical DevLink MCP stdio operation for session.status.',
          operationId: 'mcpSessionStatus',
          schema: {
            type: 'object',
            properties: {
              operation: { type: 'string', const: 'session.status' },
              sessionId: { type: 'string' },
            },
            required: ['operation', 'sessionId'],
          },
        },
        'lease.acquire': {
          name: 'McpLeaseAcquireRequest',
          summary: 'Acquire editing lease lock',
          schema: {
            type: 'object',
            properties: {
              operation: { type: 'string', const: 'lease.acquire' },
              scope: { type: 'string' },
            },
            required: ['operation', 'scope'],
          },
        },
      },
      defaultResponseSchemaRef: '#/components/schemas/DevLinkMcpControlResultV1',
    })

    expect(result.paths).toBeDefined()
    expect(result.paths).toHaveProperty('/mcp/session.status')
    expect(result.paths).toHaveProperty('/mcp/lease.acquire')

    const sessionStatusPost = (result.paths!['/mcp/session.status'] as Record<string, any>).post
    expect(sessionStatusPost.operationId).toBe('mcpSessionStatus')
    expect(sessionStatusPost.summary).toBe('Query active DevLink session status')
    expect(sessionStatusPost.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/McpSessionStatusRequest',
    })
    expect(sessionStatusPost.responses['200'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/DevLinkMcpControlResultV1',
    })
    expect(sessionStatusPost.responses).toHaveProperty('422')
    expect(sessionStatusPost.responses).toHaveProperty('500')
  })

  it('supports custom componentRefPrefix such as #/$defs', () => {
    const result = projectDiscriminatedUnion({
      discriminatorProperty: 'kind',
      unionSchemaId: 'EventEnvelope',
      componentRefPrefix: '#/$defs',
      variants: {
        created: {
          title: 'EventCreated',
          type: 'object',
        },
      },
    })

    expect(result.unionSchema.discriminator).toEqual({
      propertyName: 'kind',
      mapping: {
        created: '#/$defs/EventCreated',
      },
    })
    expect(result.unionSchema.oneOf).toEqual([{ $ref: '#/$defs/EventCreated' }])
  })
})

describe('projectDiscriminatedUnion — Validation & Error Cases', () => {
  it('throws when variants is empty', () => {
    expect(() =>
      projectDiscriminatedUnion({
        discriminatorProperty: 'type',
        unionSchemaId: 'EmptyUnion',
        variants: {},
      }),
    ).toThrow('Discriminated union must contain at least one variant')
  })

  it('throws when discriminatorProperty is missing or empty', () => {
    expect(() =>
      projectDiscriminatedUnion({
        discriminatorProperty: '',
        unionSchemaId: 'SomeUnion',
        variants: { a: { type: 'object' } },
      }),
    ).toThrow('discriminatorProperty must be a non-empty string')
  })

  it('throws when unionSchemaId is missing or empty', () => {
    expect(() =>
      projectDiscriminatedUnion({
        discriminatorProperty: 'type',
        unionSchemaId: '  ',
        variants: { a: { type: 'object' } },
      }),
    ).toThrow('unionSchemaId must be a non-empty string')
  })

  it('throws when variant schema has mismatched const discriminator property', () => {
    expect(() =>
      projectDiscriminatedUnion({
        discriminatorProperty: 'type',
        unionSchemaId: 'MismatchUnion',
        variants: {
          dog: {
            title: 'DogSchema',
            type: 'object',
            properties: {
              type: { type: 'string', const: 'cat' },
            },
          },
        },
      }),
    ).toThrow('mismatched const value')
  })

  it('throws when variant schema has mismatched enum discriminator property', () => {
    expect(() =>
      projectDiscriminatedUnion({
        discriminatorProperty: 'type',
        unionSchemaId: 'MismatchEnumUnion',
        variants: {
          dog: {
            title: 'DogSchema',
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['cat', 'bird'] },
            },
          },
        },
      }),
    ).toThrow('mismatched enum value')
  })
})

describe('projectDiscriminatedUnionDocument & validateOpenApiProjection integration', () => {
  it('creates a fully valid component-bundle projection document', () => {
    const docResult = projectDiscriminatedUnionDocument({
      discriminatorProperty: 'kind',
      unionSchemaId: 'ShapeUnion',
      profile: 'component-bundle',
      variants: {
        circle: {
          title: 'Circle',
          type: 'object',
          properties: {
            radius: { type: 'number' },
          },
        },
        square: {
          title: 'Square',
          type: 'object',
          properties: {
            size: { type: 'number' },
          },
        },
      },
    })

    const validation = validateOpenApiProjection(docResult)
    expect(validation.valid).toBe(true)
    expect(validation.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0)
    expect(docResult.profile).toBe('component-bundle')
    expect(docResult.projection.components.schemas).toHaveProperty('ShapeUnion')
    expect(docResult.projection.components.schemas).toHaveProperty('Circle')
    expect(docResult.projection.components.schemas).toHaveProperty('Square')
  })

  it('creates a fully valid operation-contract projection document', () => {
    const docResult = projectDiscriminatedUnionDocument({
      discriminatorProperty: 'method',
      unionSchemaId: 'NativeRpcRequest',
      profile: 'operation-contract',
      pathPrefix: '/rpc',
      variants: {
        'user.get': {
          title: 'UserGetRequest',
          type: 'object',
          properties: {
            userId: { type: 'string' },
          },
        },
      },
    })

    const validation = validateOpenApiProjection(docResult)
    expect(validation.valid).toBe(true)
    expect(validation.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0)
    expect(docResult.profile).toBe('operation-contract')
    expect(docResult.projection.paths).toHaveProperty('/rpc/user.get')
  })
})

describe('projectDiscriminatedUnion — Remediation & Canonical Invariants', () => {
  it('consistently retains unionSchemaId prefix and avoids suffix scope loss', () => {
    const result = projectDiscriminatedUnion({
      discriminatorProperty: 'method',
      unionSchemaId: 'McpRequest',
      variants: {
        'tools/list': { type: 'object', properties: { method: { const: 'tools/list' } } },
        'tools/call': { type: 'object', properties: { method: { const: 'tools/call' } } },
        'a/b/c': { type: 'object', properties: { method: { const: 'a/b/c' } } },
      },
    })

    expect(result.variantSchemas).toHaveProperty('McpRequestToolsList')
    expect(result.variantSchemas).toHaveProperty('McpRequestToolsCall')
    expect(result.variantSchemas).toHaveProperty('McpRequestABC')
    expect(result.unionSchema.discriminator).toEqual({
      propertyName: 'method',
      mapping: {
        'tools/list': '#/components/schemas/McpRequestToolsList',
        'tools/call': '#/components/schemas/McpRequestToolsCall',
        'a/b/c': '#/components/schemas/McpRequestABC',
      },
    })
  })

  it('normalizes pathPrefix with leading and trailing slashes correctly', () => {
    const result1 = projectDiscriminatedUnion({
      discriminatorProperty: 'method',
      unionSchemaId: 'RpcRequest',
      pathPrefix: '/rpc/',
      variants: { ping: { type: 'object' } },
    })
    expect(result1.paths).toHaveProperty('/rpc/ping')
    expect((result1.paths as Record<string, unknown>)['/rpc//ping']).toBeUndefined()

    const result2 = projectDiscriminatedUnion({
      discriminatorProperty: 'method',
      unionSchemaId: 'RpcRequest',
      pathPrefix: 'rpc/v1',
      variants: { '/ping': { type: 'object' } },
    })
    expect(result2.paths).toHaveProperty('/rpc/v1/ping')

    const result3 = projectDiscriminatedUnion({
      discriminatorProperty: 'method',
      unionSchemaId: 'RpcRequest',
      pathPrefix: '/',
      variants: { ping: { type: 'object' } },
    })
    expect(result3.paths).toHaveProperty('/ping')
  })

  it('disambiguates colliding variant schema names deterministically with suffixes', () => {
    const result = projectDiscriminatedUnion({
      discriminatorProperty: 'method',
      unionSchemaId: 'Msg',
      variants: {
        'user.get': { type: 'object', properties: { method: { const: 'user.get' } } },
        'user_get': { type: 'object', properties: { method: { const: 'user_get' } } },
        'user-get': { type: 'object', properties: { method: { const: 'user-get' } } },
      },
    })

    const schemaKeys = Object.keys(result.variantSchemas)
    expect(schemaKeys).toHaveLength(3)
    expect(schemaKeys).toEqual(['MsgUserGet', 'MsgUserGet_2', 'MsgUserGet_3'])
    expect(result.unionSchema.discriminator).toEqual({
      propertyName: 'method',
      mapping: {
        'user.get': '#/components/schemas/MsgUserGet',
        'user_get': '#/components/schemas/MsgUserGet_2',
        'user-get': '#/components/schemas/MsgUserGet_3',
      },
    })
  })
})

