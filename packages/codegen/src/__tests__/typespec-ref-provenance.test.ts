import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import { createTypeSpecCompatibilitySidecarFromEntries } from '../cli/lib/typespec-sidecar.js'
import { buildTypeSpecRefProvenance, type TypeSpecRefProvenanceEdge } from '../cli/lib/typespec-ref-provenance.js'
import { buildSpecTraceabilityGraph } from '../traceability/index.js'

const workspaces: string[] = []

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true })
})

describe('TypeSpec declaration-to-reference provenance', () => {
  it('maps native model and operation declarations to public pointers and $ref sources', () => {
    const sourceRoot = makeSource(`
@operationId("createWidget")
@route("/widgets")
@post
op createWidget(): Widget;

model Widget {
  id: string;
}
`)
    const result = buildTypeSpecRefProvenance({
      sourceRoot,
      restoredDocument: document({
        paths: {
          '/widgets': {
            post: {
              operationId: 'createWidget',
              responses: {
                '200': {
                  description: 'ok',
                  content: { 'application/json': { schema: { $ref: '#/components/schemas/Widget' } } },
                },
              },
            },
          },
        },
        components: { schemas: { Widget: { type: 'object' } } },
      }),
      sidecar: createTypeSpecCompatibilitySidecarFromEntries([]),
    })

    expect(result.report).toMatchObject({
      valid: true,
      counts: { publicPointers: 2, coveredPublicPointers: 2, refNodes: 1, coveredRefNodes: 1 },
    })
    expect(result.artifact.provenanceKind).toBe('typespec-source-ast')
    expect(result.artifact.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'emits', outputPointer: '#/components/schemas/Widget' }),
      expect.objectContaining({ kind: 'emits', outputPointer: '#/paths/~1widgets/post' }),
      expect.objectContaining({ kind: 'references', outputPointer: '#/paths/~1widgets/post/responses/200/content/application~1json/schema/$ref', targetRef: '#/components/schemas/Widget' }),
    ]))
  })

  it('attributes emitted alias and scalar components to their TypeSpec declarations', () => {
    const sourceRoot = makeSource(`
alias Status = "open" | "closed";
scalar TicketCode extends string;
`)
    const result = buildTypeSpecRefProvenance({
      sourceRoot,
      restoredDocument: document({
        components: {
          schemas: {
            Status: { type: 'string', enum: ['open', 'closed'] },
            TicketCode: { type: 'string' },
          },
        },
      }),
      sidecar: createTypeSpecCompatibilitySidecarFromEntries([]),
    })

    expect(result.report).toMatchObject({
      valid: true,
      counts: { publicPointers: 2, coveredPublicPointers: 2 },
    })
    expect(result.artifact.declarations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'alias:main.tsp:Status', kind: 'model', symbol: 'Status' }),
      expect.objectContaining({ id: 'scalar:main.tsp:TicketCode', kind: 'model', symbol: 'TicketCode' }),
    ]))
  })

  it('attributes emitted enum components to their TypeSpec declarations', () => {
    const sourceRoot = makeSource('enum GroundingRole { surface: "surface", control: "control" }')
    const result = buildTypeSpecRefProvenance({
      sourceRoot,
      restoredDocument: document({ components: { schemas: { GroundingRole: { type: 'string', enum: ['surface', 'control'] } } } }),
      sidecar: createTypeSpecCompatibilitySidecarFromEntries([]),
    })
    expect(result.report.valid).toBe(true)
    expect(result.artifact.declarations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'enum:main.tsp:GroundingRole', kind: 'model', symbol: 'GroundingRole' }),
    ]))
  })

  it('attributes emitted event unions to their TypeSpec declaration and nested refs', () => {
    const sourceRoot = makeSource(`
model HealthEvent {
  status: "ok" | "degraded" | "down";
}

@events
union HealthEvents {
  health: HealthEvent;
}
`)
    const result = buildTypeSpecRefProvenance({
      sourceRoot,
      restoredDocument: document({
        components: {
          schemas: {
            HealthEvent: { type: 'object' },
            HealthEvents: { $ref: '#/components/schemas/HealthEvent' },
          },
        },
      }),
      sidecar: createTypeSpecCompatibilitySidecarFromEntries([]),
    })

    expect(result.report).toMatchObject({
      valid: true,
      counts: { publicPointers: 2, coveredPublicPointers: 2, refNodes: 1, coveredRefNodes: 1 },
    })
    expect(result.artifact.declarations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'union:main.tsp:HealthEvents', kind: 'model', symbol: 'HealthEvents' }),
    ]))
    expect(result.artifact.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'emits', outputPointer: '#/components/schemas/HealthEvents' }),
      expect.objectContaining({ kind: 'references', outputPointer: '#/components/schemas/HealthEvents/$ref', targetRef: '#/components/schemas/HealthEvent' }),
    ]))
  })

  it('attributes restored reusable components to their root extension and rejects an unowned component', () => {
    const sourceRoot = makeSource(`
@extension("x-oa-sdk-components", #{})
namespace Demo;

model Error {
  message: string;
}
`)
    const sidecar = createTypeSpecCompatibilitySidecarFromEntries([{
      kind: 'component-response',
      pointer: '#/x-oa-sdk-components/responses/0',
      target: { name: 'BadRequest' },
      value: {
        description: 'bad',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    }])
    const result = buildTypeSpecRefProvenance({
      sourceRoot,
      restoredDocument: document({
        components: {
          schemas: { Error: { type: 'object' } },
          responses: {
            BadRequest: {
              description: 'bad',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
          },
        },
      }),
      sidecar,
    })

    expect(result.report.valid).toBe(true)
    expect(result.artifact.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'restores', outputPointer: '#/components/responses/BadRequest', restoreFamily: 'x-oa-sdk-components' }),
      expect.objectContaining({ kind: 'references', outputPointer: '#/components/responses/BadRequest/content/application~1json/schema/$ref' }),
    ]))

    const mutated = buildTypeSpecRefProvenance({
      sourceRoot,
      restoredDocument: document({ components: { schemas: { Ghost: { type: 'object' } } } }),
      sidecar: createTypeSpecCompatibilitySidecarFromEntries([]),
    })
    expect(mutated.report.valid).toBe(false)
    expect(mutated.report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'typespec-provenance/missing-public-owner', pointer: '#/components/schemas/Ghost' }),
    ]))
  })

  it('attributes an emitted security scheme to its native TypeSpec auth model', () => {
    const sourceRoot = makeSource(`
using Http;
model bearerAuth is BearerAuth;
`)
    const result = buildTypeSpecRefProvenance({
      sourceRoot,
      restoredDocument: document({
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer' },
          },
        },
      }),
      sidecar: createTypeSpecCompatibilitySidecarFromEntries([]),
    })

    expect(result.report).toMatchObject({
      valid: true,
      counts: { publicPointers: 1, coveredPublicPointers: 1 },
    })
    expect(result.artifact.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'emits',
        outputPointer: '#/components/securitySchemes/bearerAuth',
      }),
    ]))
  })

  it('attributes hoisted path item parameter refs to every operation of the path', () => {
    const sourceRoot = makeSource(BOARD_SOURCE)
    const result = buildTypeSpecRefProvenance({
      sourceRoot,
      restoredDocument: boardDocument({
        get: { operationId: 'getBoard', responses: { '204': { description: 'ok' } } },
        delete: { operationId: 'removeBoard', responses: { '204': { description: 'ok' } } },
      }),
      sidecar: createTypeSpecCompatibilitySidecarFromEntries([]),
    })

    expect(result.report).toMatchObject({
      valid: true,
      counts: { publicPointers: 3, coveredPublicPointers: 3, refNodes: 1, coveredRefNodes: 1, references: 2 },
    })
    expect(referenceOwners(result.artifact.edges, BOARD_ID_PARAMETER_REF)).toEqual([
      'operation:main.tsp:getBoard',
      'operation:main.tsp:removeBoard',
    ])
  })

  it('keeps a hoisted parameter ref unowned when an operation of the path has no TypeSpec owner', () => {
    const sourceRoot = makeSource(BOARD_SOURCE)
    const result = buildTypeSpecRefProvenance({
      sourceRoot,
      restoredDocument: boardDocument({
        get: { operationId: 'getBoard', responses: { '204': { description: 'ok' } } },
        delete: { operationId: 'purgeBoard', responses: { '204': { description: 'ok' } } },
      }),
      sidecar: createTypeSpecCompatibilitySidecarFromEntries([]),
    })

    expect(result.report).toMatchObject({
      valid: false,
      counts: { refNodes: 1, coveredRefNodes: 0, references: 0 },
    })
    expect(result.report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'typespec-provenance/missing-public-owner', pointer: '#/paths/~1boards~1{boardId}/delete' }),
      expect.objectContaining({ code: 'typespec-provenance/missing-ref-owner', pointer: BOARD_ID_PARAMETER_REF }),
    ]))
    expect(referenceOwners(result.artifact.edges, BOARD_ID_PARAMETER_REF)).toEqual([])
  })

  it('attributes a hoisted parameter ref of a single-operation path to that operation', () => {
    const sourceRoot = makeSource(BOARD_SOURCE)
    const result = buildTypeSpecRefProvenance({
      sourceRoot,
      restoredDocument: boardDocument({
        get: { operationId: 'getBoard', responses: { '204': { description: 'ok' } } },
      }),
      sidecar: createTypeSpecCompatibilitySidecarFromEntries([]),
    })

    expect(result.report).toMatchObject({
      valid: true,
      counts: { refNodes: 1, coveredRefNodes: 1, references: 1 },
    })
    expect(referenceOwners(result.artifact.edges, BOARD_ID_PARAMETER_REF)).toEqual(['operation:main.tsp:getBoard'])
  })

  it('keeps the operation declaration as hoisted parameter owner when a sidecar restore targets the operation pointer', () => {
    const sourceRoot = makeSource(`
scalar BoardId extends string;

@route("/boards/{boardId}")
@get
@extension("x-oa-sdk-operation-examples", #{})
op getBoard(@path boardId: BoardId): void;
`)
    const sidecar = createTypeSpecCompatibilitySidecarFromEntries([{
      kind: 'parameter-examples',
      pointer: '#/paths/~1boards~1{boardId}/get/x-oa-sdk-operation-examples/parameters/boardId',
      target: { path: '/boards/{boardId}', method: 'get', name: 'boardId', in: 'path' },
      value: { example: 'board-1' },
    }])
    const result = buildTypeSpecRefProvenance({
      sourceRoot,
      restoredDocument: boardDocument({
        get: { operationId: 'getBoard', responses: { '204': { description: 'ok' } } },
      }),
      sidecar,
    })

    expect(result.report.valid).toBe(true)
    expect(result.artifact.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'restores', outputPointer: '#/paths/~1boards~1{boardId}/get', restoreFamily: 'x-oa-sdk-operation-examples' }),
    ]))
    expect(referenceOwners(result.artifact.edges, BOARD_ID_PARAMETER_REF)).toEqual(['operation:main.tsp:getBoard'])
  })

  it('attributes declarations nested inside braced namespaces and interfaces', () => {
    const sourceRoot = makeSource(`
namespace Demo {
  model User {
    id: string;
  }

  @route("/users")
  interface UsersApi {
    @get list(): User[];
  }
}
`)
    const result = buildTypeSpecRefProvenance({
      sourceRoot,
      restoredDocument: document({
        paths: {
          '/users': {
            get: {
              operationId: 'UsersApi_list',
              responses: {
                '200': {
                  description: 'ok',
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
          },
        },
        components: { schemas: { User: { type: 'object' } } },
      }),
      sidecar: createTypeSpecCompatibilitySidecarFromEntries([]),
    })

    expect(result.report.valid).toBe(true)
    expect(result.artifact.declarations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'model:main.tsp:User', kind: 'model', symbol: 'User' }),
      expect.objectContaining({ id: 'operation:main.tsp:UsersApi.list', kind: 'operation', symbol: 'list' }),
    ]))
    expect(result.artifact.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'emits', declarationId: 'model:main.tsp:User', outputPointer: '#/components/schemas/User' }),
      expect.objectContaining({ kind: 'emits', declarationId: 'operation:main.tsp:UsersApi.list', outputPointer: '#/paths/~1users/get' }),
    ]))
  })

  it('keeps same-named operations of different interfaces apart, down to their trace source lines', () => {
    const sourceRoot = makeSource(`namespace Demo;
model User { id: string; }
model Order { id: string; }

@route("/users")
interface Users {
  @get list(): User[];
}

@route("/orders")
interface Orders {
  @get list(): Order[];
}
`)
    const listOf = (operationId: string, schema: string) => ({
      get: {
        operationId,
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: `#/components/schemas/${schema}` } } } },
          },
        },
      },
    })
    const restored = document({
      paths: { '/users': listOf('Users_list', 'User'), '/orders': listOf('Orders_list', 'Order') },
      components: { schemas: { User: { type: 'object' }, Order: { type: 'object' } } },
    })
    const result = buildTypeSpecRefProvenance({
      sourceRoot,
      restoredDocument: restored,
      sidecar: createTypeSpecCompatibilitySidecarFromEntries([]),
    })

    expect(result.report.valid).toBe(true)
    const operationIds = result.artifact.declarations.filter(declaration => declaration.kind === 'operation').map(declaration => declaration.id)
    expect(operationIds).toEqual(['operation:main.tsp:Orders.list', 'operation:main.tsp:Users.list'])
    expect(result.artifact.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'emits', declarationId: 'operation:main.tsp:Users.list', outputPointer: '#/paths/~1users/get' }),
      expect.objectContaining({ kind: 'emits', declarationId: 'operation:main.tsp:Orders.list', outputPointer: '#/paths/~1orders/get' }),
    ]))

    const graph = buildSpecTraceabilityGraph({ spec: restored, typespecProvenance: result.artifact })
    expect(graph.nodes['#/paths/~1users/get']?.source).toMatchObject({ origin: 'typespec-ast', filePath: 'main.tsp', line: 7 })
    expect(graph.nodes['#/paths/~1orders/get']?.source).toMatchObject({ origin: 'typespec-ast', filePath: 'main.tsp', line: 12 })
  })

  it('reports declarations that share an id instead of letting one overwrite the other', () => {
    const sourceRoot = makeSource(`namespace A {
  model User { id: string; }
}
namespace B {
  model User { name: string; }
}
`)
    const result = buildTypeSpecRefProvenance({
      sourceRoot,
      restoredDocument: document({ components: { schemas: { User: { type: 'object' } } } }),
      sidecar: createTypeSpecCompatibilitySidecarFromEntries([]),
    })

    expect(result.report.valid).toBe(false)
    expect(result.report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'typespec-provenance/duplicate-declaration-id', pointer: 'model:main.tsp:User' }),
    ]))
  })
})

const BOARD_SOURCE = `
scalar BoardId extends string;

@route("/boards/{boardId}")
@get
op getBoard(@path boardId: BoardId): void;

@route("/boards/{boardId}")
@delete
op removeBoard(@path boardId: BoardId): void;
`

const BOARD_ID_PARAMETER_REF = '#/paths/~1boards~1{boardId}/parameters/0/schema/$ref'

/** A restored document whose `/boards/{boardId}` path item carries the hoisted `boardId` parameter. */
function boardDocument(operations: Record<string, unknown>): OasDocument {
  return document({
    paths: {
      '/boards/{boardId}': {
        parameters: [{ name: 'boardId', in: 'path', required: true, schema: { $ref: '#/components/schemas/BoardId' } }],
        ...operations,
      },
    },
    components: { schemas: { BoardId: { type: 'string' } } },
  })
}

function referenceOwners(edges: TypeSpecRefProvenanceEdge[], outputPointer: string): string[] {
  return edges
    .filter(edge => edge.kind === 'references' && edge.outputPointer === outputPointer)
    .map(edge => edge.declarationId)
    .sort()
}

function makeSource(content: string): string {
  const workspace = mkdtempSync(join(tmpdir(), 'oa-sdk-typespec-ref-provenance-'))
  workspaces.push(workspace)
  writeFileSync(join(workspace, 'main.tsp'), content)
  return workspace
}

function document(value: Record<string, unknown>): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Test', version: '1.0.0' },
    paths: {},
    ...value,
  } as OasDocument
}
