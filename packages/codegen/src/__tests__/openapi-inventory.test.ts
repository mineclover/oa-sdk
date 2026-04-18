import { describe, expect, it } from 'vitest'
import {
  createOpenApiInventory,
  formatOpenApiInventoryMarkdown,
} from '../cli/lib/openapi-inventory.js'

describe('OpenAPI inventory', () => {
  it('summarizes paths, operations, components, tags, domains, security, and unused candidates', () => {
    const inventory = createOpenApiInventory(inventoryFixture())

    expect(inventory.schemaVersion).toBe('oa-gen.inventory.v1')
    expect(inventory.totals).toEqual({
      paths: 2,
      operations: 3,
      components: 6,
      unusedComponentCandidates: 2,
    })
    expect(inventory.operationCounts).toEqual({ get: 2, post: 1 })
    expect(inventory.componentCounts.schemas).toBe(3)
    expect(inventory.componentCounts.securitySchemes).toBe(3)
    expect(inventory.tagGroups).toEqual([
      expect.objectContaining({ name: 'Users', operationCount: 2, paths: ['/users'] }),
      expect.objectContaining({ name: 'Admin', operationCount: 1, paths: ['/admin/jobs'] }),
    ])
    expect(inventory.domainGroups).toEqual([
      expect.objectContaining({ name: 'users', operationCount: 2, paths: ['/users'] }),
      expect.objectContaining({ name: 'admin', operationCount: 1, paths: ['/admin/jobs'] }),
    ])
    expect(inventory.securitySchemes).toEqual([
      expect.objectContaining({
        name: 'ApiKeyAuth',
        type: 'apiKey',
        used: true,
        usedByOperations: 1,
        usedGlobally: false,
      }),
      expect.objectContaining({
        name: 'BearerAuth',
        type: 'http',
        scheme: 'bearer',
        used: true,
        usedByOperations: 1,
        usedGlobally: true,
      }),
      expect.objectContaining({
        name: 'OrphanAuth',
        used: false,
        usedByOperations: 0,
        usedGlobally: false,
      }),
    ])
    expect(inventory.unusedComponents).toEqual([
      { section: 'schemas', name: 'Unused', pointer: '#/components/schemas/Unused' },
      { section: 'securitySchemes', name: 'OrphanAuth', pointer: '#/components/securitySchemes/OrphanAuth' },
    ])
  })

  it('summarizes projection source metadata when target artifact extensions exist', () => {
    const inventory = createOpenApiInventory({
      ...inventoryFixture(),
      'x-schema-engine-profile': 'full-api-document',
      'x-schema-engine-version-hash': 'sha256:123',
      'x-schema-engine-sources': {
        'path:public/users/UsersPath': {
          kind: 'file',
          filePath: 'packages/schemas/src/fragments/path/public/users/UsersPath.yaml',
          pointer: '#/content',
        },
        'schema:public/users/User': {
          kind: 'file',
          filePath: 'packages/schemas/src/fragments/schema/public/users/User.yaml',
          pointer: '#/content',
        },
      },
      'x-schema-engine-refs': [
        {
          from: 'path:public/users/UsersPath',
          to: 'schema:public/users/User',
          ref: 'oa://schema/public/users/User',
          kind: 'definition-ref',
          source: {
            kind: 'file',
            filePath: 'packages/schemas/src/fragments/path/public/users/UsersPath.yaml',
            pointer: '#/content/get/responses/200/content/application~1json/schema/$ref',
          },
        },
      ],
      'x-oa-sdk-definition-output-names': [
        {
          canonicalId: 'schema:public/users/User',
          kind: 'schema',
          scope: 'public',
          domain: 'users',
          localName: 'User',
          outputName: 'PublicUser',
          reason: 'explicit-alias',
        },
      ],
      'x-oa-sdk-definition-collision-report': [
        {
          canonicalId: 'schema:public/users/User',
          targetName: 'public-api',
          kind: 'schema',
          scope: 'public',
          domain: 'users',
          localName: 'User',
          outputName: 'PublicUser',
          reason: 'explicit-alias',
          severity: 'warning',
        },
      ],
    })

    expect(inventory.sourceSummary).toEqual({
      profile: 'full-api-document',
      versionHash: 'sha256:123',
      sourceCount: 2,
      refCount: 1,
      fileCount: 2,
      sourceKinds: { file: 2 },
      definitionKinds: { path: 1, schema: 1 },
      outputAliasCount: 1,
      renamedOutputAliasCount: 1,
      collisionReportCount: 1,
      collisionSeverities: { warning: 1 },
    })
  })

  it('formats a compact markdown report for PR comments', () => {
    const markdown = formatOpenApiInventoryMarkdown(createOpenApiInventory(inventoryFixture()))

    expect(markdown).toContain('## OpenAPI Inventory')
    expect(markdown).toContain('- Paths: 2')
    expect(markdown).toContain('| Users | 2 | /users |')
    expect(markdown).toContain('| BearerAuth | http bearer | yes | 1 |')
    expect(markdown).toContain('| schemas | Unused | #/components/schemas/Unused |')
  })
})

function inventoryFixture(): Record<string, unknown> {
  return {
    openapi: '3.2.0',
    info: { title: 'Inventory API', version: '1.0.0' },
    security: [{ BearerAuth: [] }],
    paths: {
      '/admin/jobs': {
        get: {
          operationId: 'listJobs',
          tags: ['Admin'],
          security: [{ ApiKeyAuth: [] }],
          responses: { '204': { description: 'No content' } },
        },
      },
      '/users': {
        get: {
          operationId: 'listUsers',
          tags: ['Users'],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/User' },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: 'createUser',
          tags: ['Users'],
          security: [],
          requestBody: {
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
          properties: { name: { type: 'string' } },
        },
        Unused: {
          type: 'object',
          properties: { stale: { type: 'string' } },
        },
        User: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
      },
      securitySchemes: {
        ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' },
        BearerAuth: { type: 'http', scheme: 'bearer' },
        OrphanAuth: { type: 'http', scheme: 'basic' },
      },
    },
  }
}
