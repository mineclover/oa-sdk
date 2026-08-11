import { afterEach, describe, expect, it } from 'vitest'
import { generateClient } from '@oa-sdk/client'
import { generateTypesFromSpec } from '@oa-sdk/codegen/typegen'
import { createNodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
import type { NodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
import type { OasDocument } from '@oa-sdk/parser'
import { validateDocument } from '@oa-sdk/parser'
import {
  attachOpenApiProjectionExtensions,
  validateOpenApiProjection,
  type OpenApiProjectionResult,
} from '@oa-sdk/openapi-projection-contract'

const servers: NodeMockServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.stop()))
})

describe('bun-graph-db OpenAPI projection consumption', () => {
  it('runs GET /api/openapi and table projection documents through OA SDK validators, typegen, client, and mock server', async () => {
    const apiDocument = buildBunGraphDbOpenApiDocument()
    const componentProjection = tableComponentProjection()
    const operationProjection = tableOperationProjection()
    const projectionRestBody = { success: true, data: componentProjection }

    expect(validateDocument(apiDocument).valid).toBe(true)
    expect(validateOpenApiProjection(projectionRestBody.data)).toEqual({ valid: true, diagnostics: [] })
    expect(validateOpenApiProjection(operationProjection)).toEqual({ valid: true, diagnostics: [] })
    expect({
      rootPaths: Object.keys(apiDocument.paths ?? {}).sort(),
      tableProjection: {
        profile: componentProjection.profile,
        schemaNames: Object.keys(componentProjection.projection.components?.schemas ?? {}).sort(),
        sourceKinds: [...new Set(Object.values(componentProjection.sources).map(source => source.kind))],
      },
      operationProjection: {
        profile: operationProjection.profile,
        operationIds: collectOperationIds(operationProjection.projection as unknown as OasDocument),
      },
    }).toEqual({
      rootPaths: [
        '/api/openapi',
        '/api/tables/{tableId}/openapi-projection',
        '/mcp',
        '/sub/{tableId}/mcp',
      ],
      tableProjection: {
        profile: 'component-bundle',
        schemaNames: [
          'AttributeType_Age',
          'AttributeType_Email',
          'Attribute_Age',
          'Attribute_Email',
          'NodeAttributes_UserProfiles',
          'NodeInput_UserProfiles',
          'Table_UserProfiles',
        ],
        sourceKinds: ['db'],
      },
      operationProjection: {
        profile: 'operation-contract',
        operationIds: ['createUserProfilesNode', 'updateUserProfilesNode'],
      },
    })

    const rootTypes = generateTypesFromSpec(apiDocument)
    const rootClient = generateClient(apiDocument)
    const tableTypes = generateTypesFromSpec(componentProjection.projection as unknown as OasDocument)
    const tableClient = generateClient(operationProjection.projection as unknown as OasDocument)

    expect(rootTypes).toContain('export type OpenApiProjectionResult')
    expect(rootClient).toContain('getOpenApiDocument')
    expect(rootClient).toContain('getTableOpenApiProjection')
    expect(tableTypes).toContain('export type NodeInput_UserProfiles')
    expect(tableTypes).toContain('email')
    expect(tableClient).toContain('createUserProfilesNode')
    expect(tableClient).toContain('updateUserProfilesNode')

    const rootServer = createNodeMockServer(apiDocument, { port: 0 })
    servers.push(rootServer)
    await rootServer.start()
    const rootResponse = await fetch(`${rootServer.url}/api/openapi`)
    const rootBody = await rootResponse.json()
    expect(rootResponse.status, JSON.stringify(rootBody)).toBe(200)
    expect(rootBody).toEqual(expect.objectContaining({
      openapi: '3.2.0',
      paths: expect.any(Object),
      components: expect.any(Object),
    }))

    const tableServer = createNodeMockServer(operationProjection.projection as unknown as OasDocument, { port: 0 })
    servers.push(tableServer)
    await tableServer.start()
    const createResponse = await fetch(`${tableServer.url}/schema-engine/tables/user-profiles/nodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'Alice',
        attributes: {
          email: 'alice@example.test',
          age: 32,
        },
      }),
    })
    expect(createResponse.status).toBe(201)

    const invalidResponse = await fetch(`${tableServer.url}/schema-engine/tables/user-profiles/nodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'Alice',
        attributes: {},
      }),
    })
    expect(invalidResponse.status).toBe(422)
    await expect(invalidResponse.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: 'CONSTRAINT_VIOLATION',
      }),
    }))
  })
})

function collectOperationIds(document: OasDocument): string[] {
  const ids: string[] = []
  for (const pathItem of Object.values(document.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue
    for (const operation of Object.values(pathItem)) {
      if (operation && typeof operation === 'object' && 'operationId' in operation) {
        ids.push(String((operation as { operationId: unknown }).operationId))
      }
    }
  }
  return ids.sort()
}

function buildBunGraphDbOpenApiDocument(): OasDocument {
  return {
    openapi: '3.2.0',
    info: {
      title: 'bun-graph-db API',
      version: '1.0.0',
      description: 'Stable REST and MCP API surface for bun-graph-db.',
    },
    paths: {
      '/api/openapi': {
        get: {
          operationId: 'getOpenApiDocument',
          summary: 'Fetch the static OpenAPI document',
          responses: {
            '200': jsonResponse('#/components/schemas/BunGraphDbFullOpenApiDocument'),
          },
        },
      },
      '/api/tables/{tableId}/openapi-projection': {
        get: {
          operationId: 'getTableOpenApiProjection',
          summary: 'Export a table OpenAPI projection',
          parameters: [
            {
              name: 'tableId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'profile',
              in: 'query',
              required: false,
              schema: { $ref: '#/components/schemas/TableOpenApiProjectionProfile' },
            },
          ],
          responses: {
            '200': jsonResponse('#/components/schemas/OpenApiProjectionRestResponse'),
            '400': jsonResponse('#/components/schemas/ApiErrorResponse'),
          },
        },
      },
      '/mcp': {
        post: {
          operationId: 'callRootMcpJsonRpc',
          summary: 'Call the root MCP JSON-RPC endpoint',
          requestBody: jsonRequestBody('#/components/schemas/McpJsonRpcRequest'),
          responses: {
            '200': jsonResponse('#/components/schemas/McpJsonRpcResponse'),
          },
        },
      },
      '/sub/{tableId}/mcp': {
        post: {
          operationId: 'callTableMcpJsonRpc',
          summary: 'Call a table-scoped MCP JSON-RPC endpoint',
          parameters: [
            {
              name: 'tableId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          requestBody: jsonRequestBody('#/components/schemas/McpJsonRpcRequest'),
          responses: {
            '200': jsonResponse('#/components/schemas/McpJsonRpcResponse'),
          },
        },
      },
    },
    components: {
      schemas: {
        BunGraphDbFullOpenApiDocument: {
          type: 'object',
          required: ['openapi', 'info', 'paths', 'components'],
          properties: {
            openapi: { type: 'string', const: '3.2.0' },
            info: { type: 'object', additionalProperties: true },
            paths: { type: 'object', additionalProperties: true },
            components: { type: 'object', additionalProperties: true },
          },
          additionalProperties: true,
        },
        TableOpenApiProjectionProfile: {
          type: 'string',
          enum: ['component-bundle', 'operation-contract'],
        },
        OpenApiProjectionRestResponse: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', const: true },
            data: { $ref: '#/components/schemas/OpenApiProjectionResult' },
          },
        },
        OpenApiProjectionResult: {
          type: 'object',
          required: ['profile', 'projection', 'refs', 'diagnostics', 'sources', 'versionHash'],
          properties: {
            profile: { $ref: '#/components/schemas/TableOpenApiProjectionProfile' },
            projection: { type: 'object', additionalProperties: true },
            refs: { type: 'array', items: { type: 'object', additionalProperties: true } },
            diagnostics: { type: 'array', items: { type: 'object', additionalProperties: true } },
            sources: { type: 'object', additionalProperties: true },
            versionHash: { type: 'string' },
          },
        },
        ApiErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', const: false },
            error: { type: 'string' },
          },
        },
        McpJsonRpcRequest: {
          type: 'object',
          required: ['jsonrpc', 'method'],
          properties: {
            jsonrpc: { type: 'string', const: '2.0' },
            method: { type: 'string' },
            params: { type: 'object', additionalProperties: true },
          },
        },
        McpJsonRpcResponse: {
          type: 'object',
          required: ['jsonrpc'],
          properties: {
            jsonrpc: { type: 'string', const: '2.0' },
            result: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
  } as OasDocument
}

function tableComponentProjection(): OpenApiProjectionResult<OasDocument> {
  const base = {
    profile: 'component-bundle',
    projection: {
      openapi: '3.2.0',
      info: {
        title: 'Table schema components for user-profiles',
        version: 'sha256:user-profiles-v1',
      },
      paths: {},
      components: {
        schemas: tableSchemas(),
      },
    } as OasDocument,
    refs: [
      {
        from: '#/components/schemas/NodeInput_UserProfiles/properties/attributes',
        to: '#/components/schemas/NodeAttributes_UserProfiles',
        ref: '#/components/schemas/NodeAttributes_UserProfiles',
        kind: 'tableAttributes',
        source: dbSource('table', 'tbl_user_profiles', '#'),
      },
    ],
    diagnostics: [],
    sources: {
      '#/components/schemas/Table_UserProfiles': dbSource('table', 'tbl_user_profiles', '#'),
      '#/components/schemas/NodeAttributes_UserProfiles/properties/email': dbSource('attribute', 'attr_email', '#'),
      '#/components/schemas/NodeAttributes_UserProfiles/properties/age': dbSource('attribute', 'attr_age', '#'),
    },
    versionHash: 'sha256:user-profiles-v1',
    typeTargets: Object.keys(tableSchemas()).map(name => ({
      id: `#/components/schemas/${name}`,
      name,
      kind: 'schema',
    })),
  } satisfies OpenApiProjectionResult<OasDocument>

  return {
    ...base,
    projection: attachOpenApiProjectionExtensions(base),
  }
}

function tableOperationProjection(): OpenApiProjectionResult<OasDocument> {
  const schemas = {
    ...tableSchemas(),
    NodeCreateInput_UserProfiles: {
      type: 'object',
      required: ['content', 'attributes'],
      properties: {
        content: { type: 'string' },
        attributes: { $ref: '#/components/schemas/NodeAttributes_UserProfiles' },
      },
      additionalProperties: false,
    },
    NodeUpdateAttributes_UserProfiles: {
      type: 'object',
      properties: {
        email: { $ref: '#/components/schemas/AttributeType_Email' },
        age: { $ref: '#/components/schemas/AttributeType_Age' },
      },
      additionalProperties: false,
    },
    NodeUpdateInput_UserProfiles: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        attributes: { $ref: '#/components/schemas/NodeUpdateAttributes_UserProfiles' },
      },
      additionalProperties: false,
    },
  }
  const base = {
    profile: 'operation-contract',
    projection: {
      openapi: '3.2.0',
      info: {
        title: 'Table node operation contracts for user-profiles',
        version: 'sha256:user-profiles-v1',
      },
      paths: {
        '/schema-engine/tables/user-profiles/nodes': {
          post: {
            operationId: 'createUserProfilesNode',
            summary: 'Create user-profiles node',
            requestBody: jsonRequestBody('#/components/schemas/NodeCreateInput_UserProfiles'),
            responses: {
              '201': { description: 'Node created.' },
              '400': { description: 'Request payload failed validation.' },
            },
          },
        },
        '/schema-engine/tables/user-profiles/nodes/{nodeId}': {
          patch: {
            operationId: 'updateUserProfilesNode',
            summary: 'Update user-profiles node',
            parameters: [
              {
                name: 'nodeId',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            requestBody: jsonRequestBody('#/components/schemas/NodeUpdateInput_UserProfiles'),
            responses: {
              '200': { description: 'Node updated.' },
              '400': { description: 'Request payload failed validation.' },
              '404': { description: 'Node not found.' },
            },
          },
        },
      },
      components: {
        schemas,
      },
    } as OasDocument,
    refs: [],
    diagnostics: [],
    sources: {
      '#/components/schemas/Table_UserProfiles': dbSource('table', 'tbl_user_profiles', '#'),
    },
    versionHash: 'sha256:user-profiles-v1',
    typeTargets: Object.keys(schemas).map(name => ({
      id: `#/components/schemas/${name}`,
      name,
      kind: 'schema',
    })),
  } satisfies OpenApiProjectionResult<OasDocument>

  return {
    ...base,
    projection: attachOpenApiProjectionExtensions(base),
  }
}

function tableSchemas(): Record<string, Record<string, unknown>> {
  return {
    AttributeType_Age: {
      type: 'integer',
      minimum: 0,
    },
    AttributeType_Email: {
      type: 'string',
      format: 'email',
      minLength: 3,
    },
    Attribute_Age: {
      type: 'object',
      required: ['identifier', 'value'],
      properties: {
        identifier: { const: 'age' },
        value: { $ref: '#/components/schemas/AttributeType_Age' },
      },
      additionalProperties: false,
    },
    Attribute_Email: {
      type: 'object',
      required: ['identifier', 'value'],
      properties: {
        identifier: { const: 'email' },
        value: { $ref: '#/components/schemas/AttributeType_Email' },
      },
      additionalProperties: false,
    },
    NodeAttributes_UserProfiles: {
      type: 'object',
      properties: {
        email: { $ref: '#/components/schemas/AttributeType_Email' },
        age: { $ref: '#/components/schemas/AttributeType_Age' },
      },
      required: ['email'],
      additionalProperties: false,
    },
    NodeInput_UserProfiles: {
      type: 'object',
      required: ['tableId', 'content', 'attributes'],
      properties: {
        tableId: { const: 'tbl_user_profiles' },
        tableIdentifier: { const: 'user-profiles' },
        content: { type: 'string' },
        attributes: { $ref: '#/components/schemas/NodeAttributes_UserProfiles' },
      },
      additionalProperties: false,
    },
    Table_UserProfiles: {
      type: 'object',
      description: 'User profile table exposed by bun-graph-db.',
      required: ['id', 'identifier', 'attributes'],
      properties: {
        id: { const: 'tbl_user_profiles' },
        identifier: { const: 'user-profiles' },
        attributes: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
        },
      },
    },
  }
}

function jsonResponse(schemaRef: string) {
  return {
    description: 'OK',
    content: {
      'application/json': {
        schema: { $ref: schemaRef },
      },
    },
  }
}

function jsonRequestBody(schemaRef: string) {
  return {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: schemaRef },
      },
    },
  }
}

function dbSource(entity: 'table' | 'attribute' | 'attributeType', id: string, pointer: string) {
  return {
    kind: 'db' as const,
    entity,
    id,
    pointer,
  }
}
