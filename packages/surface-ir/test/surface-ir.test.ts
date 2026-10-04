import { describe, expect, it } from 'vitest'
import type { ParsedDocument } from '@oa-sdk/parser'
import { buildSurfaceIr, emitForgeOverlay, toForgeProjection } from '../src/index.js'

function documentWithOperations(
  operations: ParsedDocument['operations'],
  tags: ParsedDocument['tags'] = new Map(),
): ParsedDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Surface fixture', version: '1.0.0' },
    servers: [],
    tags,
    operations,
    routes: new Map(),
    schemas: {},
    securitySchemes: {},
    security: [],
    components: {
      responses: {},
      parameters: {},
      requestBodies: {},
      examples: {},
      headers: {},
      links: {},
      callbacks: {},
      pathItems: {},
      mediaTypes: {},
    },
    webhooks: [],
    raw: {
      openapi: '3.2.0',
      info: { title: 'Surface fixture', version: '1.0.0' },
      paths: {},
      components: { schemas: {} },
    },
    resolution: { status: 'complete', scope: 'internal', diagnostics: [] },
  }
}

function operation(operationId: string, path = '/users') {
  return {
    operationId,
    openApiPath: path,
    method: 'get' as const,
    tags: ['users'],
    summary: `Summary for ${operationId}`,
    description: `Description for ${operationId}`,
    deprecated: false,
    parameters: [],
    responses: {},
    security: [],
    servers: [],
    callbacks: {},
  }
}

describe('@oa-sdk/surface-ir', () => {
  it('builds a deterministic target-neutral operation surface', () => {
    const ir = buildSurfaceIr(documentWithOperations([operation('listUsers')]))

    expect(ir.schemaVersion).toBe('oa-sdk.surface-ir.v1')
    expect(ir.source.operationCount).toBe(1)
    expect(ir.operations.listUsers?.projection).toEqual({
      groupPath: ['users'],
      methodName: 'listUsers',
      availability: 'generally-available',
      visibility: {},
      aliases: [],
    })
    expect(ir.diagnostics).toEqual([])
    expect(ir.versionHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('reports method collisions instead of silently renaming target methods', () => {
    const ir = buildSurfaceIr(documentWithOperations([
      operation('getUser'),
      operation('getUsers'),
    ]), {
      operationOverrides: {
        getUser: { methodName: 'get' },
        getUsers: { methodName: 'get' },
      },
    })

    expect(ir.diagnostics).toEqual([
      expect.objectContaining({
        code: 'surface-ir/method-collision',
        operationId: 'getUsers',
        severity: 'error',
      }),
    ])
  })

  it('projects operations into Forge metadata and an overlay', () => {
    const document = documentWithOperations([operation('listUsers')], new Map([
      ['users', { name: 'users', description: 'Manage users' }],
    ]))
    const ir = buildSurfaceIr(document, { target: 'forge' })
    const projection = toForgeProjection(ir, document)
    const overlay = emitForgeOverlay(ir, document, { name: 'users' })

    expect(projection.operations).toEqual([{
      operationId: 'listUsers',
      'x-fern-sdk-group-name': 'users',
      'x-fern-sdk-method-name': 'listUsers',
      'x-fern-availability': 'generally-available',
    }])
    expect(projection.commands.users?.description).toBe('Manage users')
    expect(overlay.name).toBe('users')
    expect(overlay.overlay.actions[0]).toMatchObject({
      target: '$.paths.*[?@.operationId=="listUsers"]',
      update: projection.operations[0],
    })
  })

  it('carries explicit CLI surface overrides into Forge metadata', () => {
    const document = documentWithOperations([operation('listUsers')])
    const ir = buildSurfaceIr(document, {
      target: 'forge',
      operationOverrides: {
        listUsers: {
          cli: {
            args: [{ name: 'format', type: 'enum', values: ['json', 'csv'], required: true }],
          },
          visibility: { hidden: true },
        },
      },
    })
    const projection = toForgeProjection(ir, document)

    expect(projection.operations[0]).toMatchObject({
      'x-forge-hidden': true,
      'x-forge-args': [{ name: 'format', type: 'enum' }],
    })
  })
})
