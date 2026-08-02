import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boolean, integer, pgTable, text } from 'drizzle-orm/pg-core'
import {
  OPENAPI_PROJECTION_PROFILE_EXTENSION,
  OPENAPI_PROJECTION_REFS_EXTENSION,
  OPENAPI_PROJECTION_SOURCES_EXTENSION,
  OPENAPI_PROJECTION_VERSION_HASH_EXTENSION,
  type OpenApiProjectionResult,
} from '@oa-sdk/openapi-projection-contract'
import { defaultNaming } from '../drizzle/naming.js'
import { extractTablesFromModule } from '../drizzle/extractor.js'
import {
  adaptDrizzleTables,
  adaptOpenApiProjectionEnvelope,
  adaptPythonContractSpecSnapshot,
  adaptZodSchemas,
  CodegenSourceAdapterRegistry,
  createBuiltInCodegenSourceAdapterRegistry,
} from '../cli/lib/source-adapters.js'
import { createOpenApiSourceContentHash } from '../cli/lib/openapi-source-fragments.js'

describe('codegen source adapters', () => {
  it('composes maintained and application-owned adapters through an explicit registry', async () => {
    const registry = createBuiltInCodegenSourceAdapterRegistry()
    expect(registry.list().map(adapter => adapter.id)).toEqual([
      'drizzle',
      'openapi-projection-envelope',
      'python-contract-spec-snapshot',
      'zod',
    ])

    registry.register({
      id: 'fixture-source',
      adapt: (input: { name: string }) => ({
        fragments: [{
          id: `fixture:${input.name}`,
          kind: 'schema',
          content: { type: 'string' },
          contentHash: 'fixture',
          metadata: { sourceAdapter: 'fixture-source' },
        }],
        diagnostics: [],
      }),
    })
    expect((await registry.adapt('fixture-source', { name: 'Widget' })).fragments[0]?.id).toBe('fixture:Widget')
    expect(() => registry.register({ id: 'fixture-source', adapt: () => ({ fragments: [], diagnostics: [] }) })).toThrow(/already registered/)
    expect(() => new CodegenSourceAdapterRegistry().register({ id: 'Bad_Name', adapt: () => ({ fragments: [], diagnostics: [] }) })).toThrow(/invalid source adapter id/)
  })

  it('adapts Zod schemas into normalized schema fragments', () => {
    const schemas = {
      User: z.object({
        id: z.string(),
        email: z.string().email(),
      }),
      UserRole: z.enum(['admin', 'user']),
    }

    const result = adaptZodSchemas(schemas, {
      sourcePath: '/virtual/src/contracts.ts',
      metadata: { domain: 'users' },
    })

    expect(result.diagnostics).toEqual([])
    expect(result.fragments.map(fragment => [fragment.kind, fragment.sourcePointer])).toEqual([
      ['schema', '#/schemas/User'],
      ['schema', '#/schemas/UserRole'],
    ])
    expect(result.fragments[0]).toEqual(expect.objectContaining({
      sourcePath: '/virtual/src/contracts.ts',
      metadata: {
        sourceAdapter: 'zod',
        schemaName: 'User',
        domain: 'users',
      },
    }))
    expect(result.fragments[0]?.content).toEqual(expect.objectContaining({
      type: 'object',
      required: ['id', 'email'],
    }))
    expect(result.fragments[0]?.contentHash).toBe(createOpenApiSourceContentHash(result.fragments[0]?.content))
  })

  it('adapts Drizzle table schemas without changing the existing conversion boundary', async () => {
    const widgets = pgTable('widgets', {
      id: integer('id').primaryKey(),
      name: text('name').notNull(),
      active: boolean('active').default(true),
    })
    const tables = extractTablesFromModule({ widgets })

    const result = await adaptDrizzleTables(tables, ['select', 'insert'], defaultNaming, {
      sourcePath: '/virtual/src/db/schema.ts',
    })

    expect(result.diagnostics).toEqual([])
    expect(result.fragments.map(fragment => [fragment.kind, fragment.sourcePointer])).toEqual([
      ['schema', '#/tables/widgets/schemas/insert'],
      ['schema', '#/tables/widgets/schemas/select'],
    ])
    expect(result.fragments.map(fragment => fragment.metadata)).toEqual([
      expect.objectContaining({
        sourceAdapter: 'drizzle',
        table: 'widgets',
        schemaType: 'insert',
        componentName: 'InsertWidget',
        dialect: 'pg',
      }),
      expect.objectContaining({
        sourceAdapter: 'drizzle',
        table: 'widgets',
        schemaType: 'select',
        componentName: 'Widget',
        dialect: 'pg',
      }),
    ])
    expect(result.fragments[1]?.content).toEqual(expect.objectContaining({
      type: 'object',
      properties: expect.objectContaining({
        id: expect.any(Object),
        name: expect.any(Object),
      }),
    }))
  })

  it('adapts OpenAPI Projection envelopes and preserves envelope metadata', () => {
    const projectionDocument = {
      openapi: '3.2.0',
      info: { title: 'Projection fixture', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          Widget: {
            type: 'object',
            properties: {
              id: { type: 'string' },
            },
          },
        },
      },
      [OPENAPI_PROJECTION_PROFILE_EXTENSION]: 'component-bundle',
      [OPENAPI_PROJECTION_VERSION_HASH_EXTENSION]: 'sha256:projection',
      [OPENAPI_PROJECTION_SOURCES_EXTENSION]: {
        Widget: { kind: 'file', filePath: '/schema/widget.json', pointer: '#' },
      },
      [OPENAPI_PROJECTION_REFS_EXTENSION]: [],
    }
    const envelope = {
      profile: 'component-bundle',
      projection: projectionDocument,
      refs: [],
      diagnostics: [],
      sources: {
        Widget: { kind: 'file', filePath: '/schema/widget.json', pointer: '#' },
      },
      versionHash: 'sha256:projection',
      typeTargets: [
        { id: 'schema:public/widgets/Widget', name: 'Widget', kind: 'schema' },
      ],
    } satisfies OpenApiProjectionResult<Record<string, unknown>>

    const result = adaptOpenApiProjectionEnvelope(envelope, {
      sourcePath: '/snapshots/widget-projection.json',
    })

    expect(result.diagnostics).toEqual([])
    expect(result.fragments.map(fragment => [fragment.kind, fragment.sourcePointer])).toEqual([
      ['openapi-projection', '#/projection'],
      ['schema', '#/projection/components/schemas/Widget'],
    ])
    expect(result.fragments[0]?.metadata).toEqual(expect.objectContaining({
      sourceAdapter: 'openapi-projection-envelope',
      profile: 'component-bundle',
      versionHash: 'sha256:projection',
      sources: envelope.sources,
      refs: [],
      typeTargets: envelope.typeTargets,
      projectionExtensions: {
        [OPENAPI_PROJECTION_PROFILE_EXTENSION]: 'component-bundle',
        [OPENAPI_PROJECTION_VERSION_HASH_EXTENSION]: 'sha256:projection',
        [OPENAPI_PROJECTION_SOURCES_EXTENSION]: {
          Widget: { kind: 'file', filePath: '/schema/widget.json', pointer: '#' },
        },
        [OPENAPI_PROJECTION_REFS_EXTENSION]: [],
      },
    }))
    expect(result.fragments[1]?.metadata).toEqual(expect.objectContaining({
      sourceAdapter: 'openapi-projection-envelope',
      profile: 'component-bundle',
      versionHash: 'sha256:projection',
      componentSection: 'schemas',
      name: 'Widget',
    }))
  })

  it('adapts Python ContractSpec snapshots from JSON without Python runtime dependencies', () => {
    const snapshot = {
      format: 'oa-contract-snapshot',
      snapshot_version: 1,
      toolkit: {
        'oa-interface-contracts': '0.1.0',
      },
      contract: {
        name: 'Widget API',
        version: '2026.04',
        schemas: {
          Widget: {
            type: 'object',
            properties: {
              id: { type: 'string' },
            },
          },
        },
        endpoints: [
          {
            method: 'get',
            path: '/widgets/{id}',
            operation_id: 'get_widget',
            response_model: 'Widget',
            success_responses: [
              {
                status_code: '200',
                description: 'OK',
                model: 'Widget',
              },
            ],
          },
        ],
        security_schemes: {
          ApiKey: {
            type: 'apiKey',
            name: 'x-api-key',
            location: 'header',
          },
        },
        standard_error_responses: {
          Unauthorized: {
            status_code: '401',
            description: 'Unauthorized',
          },
        },
        examples: {
          WidgetExample: {
            value: { id: 'w_1' },
          },
        },
        targets: [
          {
            name: 'public',
            public: true,
          },
        ],
      },
    }

    const result = adaptPythonContractSpecSnapshot(snapshot, {
      sourcePath: '/contracts/widget.contract.json',
    })
    const schemaFragment = result.fragments.find(fragment => fragment.sourcePointer === '#/contract/schemas/Widget')
    const operationFragment = result.fragments.find(fragment => fragment.sourcePointer === '#/contract/endpoints/0')

    expect(result.diagnostics).toEqual([])
    expect(result.fragments.map(fragment => [fragment.kind, fragment.sourcePointer])).toEqual([
      ['operation', '#/contract/endpoints/0'],
      ['response', '#/contract/endpoints/0/success_responses/0'],
      ['example', '#/contract/examples/WidgetExample'],
      ['schema', '#/contract/schemas/Widget'],
      ['securityScheme', '#/contract/security_schemes/ApiKey'],
      ['response', '#/contract/standard_error_responses/Unauthorized'],
      ['target', '#/contract/targets/0'],
    ])
    expect(schemaFragment?.metadata).toEqual(expect.objectContaining({
      sourceAdapter: 'python-contract-spec-snapshot',
      snapshotFormat: 'oa-contract-snapshot',
      snapshotVersion: 1,
      toolkit: { 'oa-interface-contracts': '0.1.0' },
      contractName: 'Widget API',
      contractVersion: '2026.04',
      schemaName: 'Widget',
    }))
    expect(operationFragment?.metadata).toEqual(expect.objectContaining({
      operationId: 'get_widget',
      method: 'get',
      path: '/widgets/{id}',
    }))
  })
})
