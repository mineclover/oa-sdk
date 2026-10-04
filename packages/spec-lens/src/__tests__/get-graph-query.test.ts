import { describe, expect, it, vi } from 'vitest'
import { GetGraphHandler } from '../application/queries/get-graph.query.js'
import type { CachePort } from '../application/ports/cache.port.js'
import type { SpecSnapshotStored } from '../domain/index.js'

function makeCache(snapshot: SpecSnapshotStored | null): CachePort {
  return {
    getSnapshotByRevision: vi.fn().mockResolvedValue(snapshot),
  } as unknown as CachePort
}

function makeStored(
  spec: Record<string, unknown>,
  provenance: Record<string, unknown>,
): SpecSnapshotStored {
  return {
    schemaVersion: 'spec-lens.snapshot.v2',
    projectKey: 'project-a',
    projectKind: 'definition-builder',
    sourceRoot: '/f',
    revision: { id: 'abc', shortId: 'abc', timestamp: 1000, message: 'test', source: 'local-git' },
    fragmentsDir: '/f',
    targetPath: '/t',
    targetConfigDigest: 'd',
    spec,
    provenance: { status: 'available', kind: 'definition-builder', entries: provenance } as never,
    composition: {} as never,
    diagnostics: [],
    builtAt: 1000,
    entryRefs: [],
  }
}

const QUERY = { revisionId: 'abc', projectKey: 'project-a', toolchainFingerprint: 'toolchain-a' }

describe('GetGraphHandler', () => {
  it('returns null when snapshot not cached', async () => {
    const handler = new GetGraphHandler(makeCache(null))
    expect(await handler.handle(QUERY)).toBeNull()
  })

  it('returns TypeSpec source-file evidence without manufacturing canonical nodes', async () => {
    const stored: SpecSnapshotStored = {
      schemaVersion: 'spec-lens.snapshot.v2',
      projectKey: 'project-a',
      projectKind: 'typespec-bundle',
      sourceRoot: 'typespec',
      manifestPath: 'typespec/bundle.json',
      revision: { id: 'abc', shortId: 'abc', timestamp: 1000, message: 'test', source: 'local-git' },
      spec: { openapi: '3.2.0', paths: {} },
      provenance: {
        status: 'unavailable',
        kind: 'typespec-source-files',
        reason: 'output-pointer-mapping-unavailable',
        sourceFiles: [{ relativePath: 'main.tsp', contentHash: 'h-main' }],
        observedInputs: [],
        compile: {} as never,
      },
      diagnostics: [],
      builtAt: 1000,
      entryRefs: [{ relativePath: 'main.tsp', contentHash: 'h-main' }],
    }
    const graph = await new GetGraphHandler(makeCache(stored)).handle(QUERY)
    expect(graph).toEqual({
      nodes: [{
        id: 'source-file:main.tsp',
        kind: 'source-file',
        scope: 'typespec',
        domain: 'unavailable',
        localName: 'main.tsp',
        sourcePath: 'main.tsp',
        contentHash: 'h-main',
      }],
      edges: [],
    })
  })

  it('builds a TypeSpec graph from available AST provenance', async () => {
    const stored: SpecSnapshotStored = {
      schemaVersion: 'spec-lens.snapshot.v2',
      projectKey: 'project-a',
      projectKind: 'typespec-bundle',
      sourceRoot: 'typespec',
      manifestPath: 'typespec/bundle.json',
      revision: { id: 'abc', shortId: 'abc', timestamp: 1000, message: 'test', source: 'local-git' },
      spec: { openapi: '3.2.0', paths: {} },
      provenance: {
        status: 'available',
        kind: 'typespec-source-ast',
        entries: {
          '#/components/schemas/User': {
            canonicalId: 'schema:typespec/main.tsp/User',
            kind: 'schema',
            sourcePath: 'main.tsp',
            sourcePointer: '#L1:C1',
            contentHash: 'h-main',
          },
        },
        sourceFiles: [{ relativePath: 'main.tsp', contentHash: 'h-main' }],
        observedInputs: [],
        compile: {} as never,
      },
      diagnostics: [],
      builtAt: 1000,
      entryRefs: [{ relativePath: 'main.tsp', contentHash: 'h-main' }],
    }
    const graph = await new GetGraphHandler(makeCache(stored)).handle(QUERY)
    expect(graph?.nodes).toEqual([expect.objectContaining({
      id: 'schema:typespec/main.tsp/User', sourcePath: 'main.tsp',
    })])
  })

  it('builds nodes from provenance', async () => {
    const stored = makeStored(
      { openapi: '3.1.0', paths: {}, components: {} },
      {
        '#/components/schemas/User': {
          canonicalId: 'schema:public/users/User',
          kind: 'schema',
          sourcePath: 'fragments/users/User.yaml',
          sourcePointer: '#',
          contentHash: 'h1',
        },
      },
    )
    const handler = new GetGraphHandler(makeCache(stored))
    const graph = await handler.handle(QUERY)
    expect(graph).not.toBeNull()
    expect(graph!.nodes).toHaveLength(1)
    expect(graph!.nodes[0]).toMatchObject({ id: 'schema:public/users/User', kind: 'schema', scope: 'public', domain: 'users', localName: 'User' })
  })

  it('deduplicates nodes by canonicalId', async () => {
    const entry = {
      canonicalId: 'schema:public/users/User',
      kind: 'schema',
      sourcePath: 'f.yaml',
      sourcePointer: '#',
      contentHash: 'h1',
    }
    const stored = makeStored(
      { openapi: '3.1.0', paths: {} },
      { '#/components/schemas/User': entry, '#/components/schemas/UserAlias': entry },
    )
    const handler = new GetGraphHandler(makeCache(stored))
    const graph = await handler.handle(QUERY)
    expect(graph!.nodes).toHaveLength(1)
  })

  it('skips provenance entries with non-string canonicalId', async () => {
    const stored = makeStored(
      { openapi: '3.1.0', paths: {} },
      { '#/components/schemas/X': { canonicalId: 42, kind: 'schema', sourcePath: 'f.yaml', sourcePointer: '#', contentHash: 'h' } },
    )
    const handler = new GetGraphHandler(makeCache(stored))
    const graph = await handler.handle(QUERY)
    expect(graph!.nodes).toHaveLength(0)
  })

  it('builds edges from $ref using provenance pointer resolution', async () => {
    const spec = {
      openapi: '3.1.0',
      paths: {
        '/users': {
          get: {
            responses: { '200': { $ref: '#/components/responses/UserList' } },
          },
        },
      },
      components: {
        responses: {
          UserList: {
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' },
              },
            },
          },
        },
        schemas: {
          User: { type: 'object' },
        },
      },
    }
    const provenance = {
      '#/paths/~1users': { canonicalId: 'path:public/users/Users', kind: 'path', sourcePath: 'f.yaml', sourcePointer: '#', contentHash: 'h1' },
      '#/components/responses/UserList': { canonicalId: 'response:public/users/UserList', kind: 'response', sourcePath: 'f.yaml', sourcePointer: '#', contentHash: 'h2' },
      '#/components/schemas/User': { canonicalId: 'schema:public/users/User', kind: 'schema', sourcePath: 'f.yaml', sourcePointer: '#', contentHash: 'h3' },
    }
    const stored = makeStored(spec, provenance)
    const handler = new GetGraphHandler(makeCache(stored))
    const graph = await handler.handle(QUERY)
    expect(graph!.edges.some(e => e.source === 'response:public/users/UserList' && e.target === 'schema:public/users/User')).toBe(true)
    // Path keys contain "/" and must be pointer-escaped to match provenance.
    expect(graph!.edges).toContainEqual({
      source: 'path:public/users/Users',
      target: 'response:public/users/UserList',
      refPointer: '#/paths/~1users/get/responses/200',
    })
  })

  it('excludes self-referencing edges', async () => {
    const spec = {
      openapi: '3.1.0',
      paths: {},
      components: {
        schemas: { Node: { properties: { children: { $ref: '#/components/schemas/Node' } } } },
      },
    }
    const provenance = {
      '#/components/schemas/Node': { canonicalId: 'schema:public/tree/Node', kind: 'schema', sourcePath: 'f.yaml', sourcePointer: '#', contentHash: 'h1' },
    }
    const stored = makeStored(spec, provenance)
    const handler = new GetGraphHandler(makeCache(stored))
    const graph = await handler.handle(QUERY)
    const selfEdges = graph!.edges.filter(e => e.source === e.target)
    expect(selfEdges).toHaveLength(0)
  })
})
