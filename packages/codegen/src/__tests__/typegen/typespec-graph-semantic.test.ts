import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import { generateTypesFromSpec, type GeneratedTypeDeclaration } from '../../typegen/generate-types.js'
import {
  buildTypeSpecGeneratedGraphSemanticIndex,
  TYPESPEC_TS_GRAPH_SEMANTIC_SCHEMA,
  type TypeSpecGraphProvenance,
} from '../../typegen/typespec-graph-semantic.js'
import { typeSpecRestoredOpenApiSha256 } from '../../typespec-restored-openapi-digest.js'

const document: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Graph origin', version: '1.0.0' },
  paths: {
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        responses: { '200': { description: 'ok' } },
      },
    },
  },
  components: {
    schemas: {
      User: { type: 'object', properties: { id: { type: 'string' } } },
    },
  },
}

function generate(spec: OasDocument): { source: string; declarations: GeneratedTypeDeclaration[] } {
  const declarations: GeneratedTypeDeclaration[] = []
  const source = generateTypesFromSpec(spec, { declarations })
  return { source, declarations }
}

describe('buildTypeSpecGeneratedGraphSemanticIndex', () => {
  it('binds generated declarations to TypeSpec source evidence without changing TypeScript', () => {
    const { source, declarations } = generate(document)
    expect(generateTypesFromSpec(document)).toBe(source)
    const index = buildTypeSpecGeneratedGraphSemanticIndex({
      document,
      generatedTypeScript: source,
      declarations,
      generatedFile: 'src/generated/api.ts',
      typeSpecProvenance: provenance(document),
    })

    expect(index).toMatchObject({
      version: 1,
      originSchemaVersion: TYPESPEC_TS_GRAPH_SEMANTIC_SCHEMA,
      inputs: {
        generatedTypesSha256: sha256(source),
        restoredOpenApiSha256: typeSpecRestoredOpenApiSha256(document),
      },
    })
    expect(index.hosts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        host: { publicName: 'User', symbol: 'type', declaration: { file: 'src/generated/api.ts', line: lineOf(source, 'User') } },
        semanticTags: ['oa-sdk-typespec'],
        evidence: [expect.objectContaining({
          target: 'oa-sdk-typespec:model:user:#/components/schemas/User',
          source: { file: 'main.tsp', line: 12 },
        })],
      }),
      expect.objectContaining({
        host: expect.objectContaining({ publicName: 'GetUserOp' }),
        evidence: [expect.objectContaining({
          target: 'oa-sdk-typespec:operation:get-user:#/paths/~1users~1{id}/get',
          source: { file: 'main.tsp', line: 3 },
        })],
      }),
    ]))
  })

  it('rejects provenance generated for another restored OpenAPI document', () => {
    const { source, declarations } = generate(document)
    expect(() => buildTypeSpecGeneratedGraphSemanticIndex({
      document,
      generatedTypeScript: source,
      declarations,
      generatedFile: 'src/generated/api.ts',
      typeSpecProvenance: {
        ...provenance(document),
        inputs: { restoredOpenApiSha256: '0'.repeat(64) },
      },
    })).toThrow('restoredOpenApiSha256')
  })

  it('prefers an operation emit over an extension restore for the same operation', () => {
    const { source, declarations } = generate(document)
    const base = provenance(document)
    const index = buildTypeSpecGeneratedGraphSemanticIndex({
      document,
      generatedTypeScript: source,
      declarations,
      generatedFile: 'src/generated/api.ts',
      typeSpecProvenance: {
        ...base,
        declarations: [
          ...base.declarations,
          { id: 'extension:get-user:examples', source: { file: 'main.tsp', start: { line: 30, column: 1 } } },
        ],
        edges: [
          { kind: 'restores', declarationId: 'extension:get-user:examples', outputPointer: '#/paths/~1users~1{id}/get' },
          ...base.edges,
        ],
      },
    })

    expect(index.hosts.find(host => host.host.publicName === 'GetUserOp')?.evidence[0]?.target)
      .toBe('oa-sdk-typespec:operation:get-user:#/paths/~1users~1{id}/get')
  })

  it('names the schema declaration typegen emitted for a component key that is not an identifier', () => {
    const spec: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Keys', version: '1.0.0' },
      paths: {},
      components: { schemas: { 'user-profile': { type: 'object', properties: { id: { type: 'string' } } } } },
    }
    const { source, declarations } = generate(spec)
    const index = buildTypeSpecGeneratedGraphSemanticIndex({
      document: spec,
      generatedTypeScript: source,
      declarations,
      generatedFile: 'api.ts',
      typeSpecProvenance: ownedBy(spec, [['model:profile', '#/components/schemas/user-profile']]),
    })

    expect(index.hosts.map(host => [host.host.publicName, host.evidence[0]?.target])).toEqual([
      ['UserProfile', 'oa-sdk-typespec:model:profile:#/components/schemas/user-profile'],
    ])
  })

  it('binds webhook operation types to the webhook, not to a path operation with a common name prefix', () => {
    const json = { 'application/json': { schema: { type: 'string' as const } } }
    const spec: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Webhooks', version: '1.0.0' },
      paths: { '/users': { get: { operationId: 'getUser', responses: { '200': { description: 'ok', content: json } } } } },
      webhooks: { userChanged: { post: { operationId: 'getUserChanged', responses: { '200': { description: 'ok', content: json } } } } },
    }
    const { source, declarations } = generate(spec)

    expect(() => buildTypeSpecGeneratedGraphSemanticIndex({
      document: spec,
      generatedTypeScript: source,
      declarations,
      generatedFile: 'api.ts',
      typeSpecProvenance: ownedBy(spec, [['operation:get-user', '#/paths/~1users/get']]),
    })).toThrow('GetUserChangedResponse has no TypeSpec provenance owner for #/webhooks/userChanged/post')

    const index = buildTypeSpecGeneratedGraphSemanticIndex({
      document: spec,
      generatedTypeScript: source,
      declarations,
      generatedFile: 'api.ts',
      typeSpecProvenance: ownedBy(spec, [
        ['operation:get-user', '#/paths/~1users/get'],
        ['operation:user-changed', '#/webhooks/userChanged/post'],
      ]),
    })
    expect(Object.fromEntries(index.hosts.map(host => [host.host.publicName, host.evidence[0]?.target]))).toEqual({
      GetUserChangedOp: 'oa-sdk-typespec:operation:user-changed:#/webhooks/userChanged/post',
      GetUserChangedResponse: 'oa-sdk-typespec:operation:user-changed:#/webhooks/userChanged/post',
      GetUserOp: 'oa-sdk-typespec:operation:get-user:#/paths/~1users/get',
      GetUserResponse: 'oa-sdk-typespec:operation:get-user:#/paths/~1users/get',
    })
  })

  it('gives a nested schema alias the owner of its enclosing component schema', () => {
    const spec: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Nested', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          User: {
            type: 'object',
            properties: { address: { type: 'object', properties: { city: { type: 'string' } } } },
          },
          Shipment: {
            type: 'object',
            properties: { to: { $ref: '#/components/schemas/User/properties/address' } },
          },
        },
      },
    }
    const { source, declarations } = generate(spec)
    const index = buildTypeSpecGeneratedGraphSemanticIndex({
      document: spec,
      generatedTypeScript: source,
      declarations,
      generatedFile: 'api.ts',
      typeSpecProvenance: ownedBy(spec, [
        ['model:user', '#/components/schemas/User'],
        ['model:shipment', '#/components/schemas/Shipment'],
      ]),
    })

    const nested = declarations.find(declaration =>
      declaration.origin.kind === 'pointer' && declaration.origin.pointer === '#/components/schemas/User/properties/address')
    expect(nested).toBeDefined()
    expect(index.hosts.find(host => host.host.publicName === nested!.name)?.evidence[0]?.target)
      .toBe('oa-sdk-typespec:model:user:#/components/schemas/User')
  })

  it('reports each declaration at the line that declares it, for both declaration styles', () => {
    for (const style of ['type', 'interface'] as const) {
      const declarations: GeneratedTypeDeclaration[] = []
      const source = generateTypesFromSpec(document, { style, declarations })
      const lines = source.split('\n')
      expect(declarations.map(declaration => declaration.name).sort()).toEqual(
        [...source.matchAll(/^export (?:type|interface) (\w+)/gm)].map(match => match[1]).sort(),
      )
      for (const declaration of declarations) {
        expect(lines[declaration.line - 1]).toMatch(new RegExp(`^export (?:type|interface) ${declaration.name}\\b`))
      }
    }
  })

  it('rejects an absolute graph file path', () => {
    const { source, declarations } = generate(document)
    expect(() => buildTypeSpecGeneratedGraphSemanticIndex({
      document,
      generatedTypeScript: source,
      declarations,
      generatedFile: '/abs/api.ts',
      typeSpecProvenance: provenance(document),
    })).toThrow('project-relative')
  })
})

function provenance(restoredDocument: OasDocument): TypeSpecGraphProvenance {
  return {
    schemaVersion: 'oa-sdk.typespec-ref-provenance.v1',
    inputs: { restoredOpenApiSha256: typeSpecRestoredOpenApiSha256(restoredDocument) },
    declarations: [
      { id: 'model:user', source: { file: 'main.tsp', start: { line: 12, column: 1 } } },
      { id: 'operation:get-user', source: { file: 'main.tsp', start: { line: 3, column: 1 } } },
    ],
    edges: [
      { kind: 'emits', declarationId: 'model:user', outputPointer: '#/components/schemas/User' },
      { kind: 'emits', declarationId: 'operation:get-user', outputPointer: '#/paths/~1users~1{id}/get' },
    ],
  }
}

/** Provenance in which each declaration id emits the paired pointer. */
function ownedBy(restoredDocument: OasDocument, owners: ReadonlyArray<readonly [string, string]>): TypeSpecGraphProvenance {
  return {
    schemaVersion: 'oa-sdk.typespec-ref-provenance.v1',
    inputs: { restoredOpenApiSha256: typeSpecRestoredOpenApiSha256(restoredDocument) },
    declarations: owners.map(([id], index) => ({ id, source: { file: 'main.tsp', start: { line: index + 1, column: 1 } } })),
    edges: owners.map(([id, pointer]) => ({ kind: 'emits' as const, declarationId: id, outputPointer: pointer })),
  }
}

function lineOf(source: string, name: string): number {
  return source.split('\n').findIndex(line => line.startsWith(`export type ${name} `)) + 1
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
