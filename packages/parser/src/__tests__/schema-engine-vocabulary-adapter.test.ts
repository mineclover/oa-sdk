import { describe, expect, it } from 'vitest'
import { createDefinitionNode } from '../definition-node.js'
import { createDefinitionRegistry, type DefinitionRegistry } from '../definition-registry.js'
import { emitDefinitionOpenApiDocument, type DefinitionOpenApiEmitResult } from '../definition-openapi-emit.js'
import { selectDefinitionTarget, type DefinitionTargetConfig } from '../definition-target.js'

type SharedSchemaSourceCoordinate =
  | {
      kind: 'file'
      filePath: string
      pointer: string
      line?: number
      column?: number
    }
  | {
      kind: 'db'
      entity: string
      id: string
      pointer: string
    }

type SharedSchemaDiagnostic = {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  source?: SharedSchemaSourceCoordinate
}

type SharedSchemaRefEdge = {
  from: string
  to?: string
  ref: string
  kind: string
  source: SharedSchemaSourceCoordinate
}

type SharedSchemaTypeTarget = {
  id: string
  name: string
  kind: string
  source?: SharedSchemaSourceCoordinate
}

type SharedSchemaProjectionEnvelope<TProjection> = {
  projection: TProjection
  refs: SharedSchemaRefEdge[]
  diagnostics: SharedSchemaDiagnostic[]
  sources: Record<string, SharedSchemaSourceCoordinate>
  versionHash: string
  typeTargets?: SharedSchemaTypeTarget[]
}

describe('shared schema engine vocabulary adapter', () => {
  it('maps OA definition builder artifacts to the shared projection envelope shape', () => {
    const registry = createDefinitionRegistry(fixtureNodes())
    const selection = selectDefinitionTarget(registry, targetConfig())
    const emitted = emitDefinitionOpenApiDocument(selection)

    const envelope = toSharedProjectionEnvelope(registry, emitted)

    expect(envelope.projection.openapi).toBe('3.2.0')
    expect(envelope.versionHash).toBe('path:public/book/NotesPath=sha256:path|schema:public/book/Note=sha256:note')
    expect(envelope.sources).toEqual({
      'path:public/book/NotesPath': {
        kind: 'file',
        filePath: '/workspace/fragments/path/public/book/NotesPath.yaml',
        pointer: '#/content',
      },
      'schema:public/book/Note': {
        kind: 'file',
        filePath: '/workspace/fragments/schema/public/book/Note.yaml',
        pointer: '#/content',
      },
    })
    expect(envelope.refs).toEqual([
      {
        from: 'path:public/book/NotesPath',
        to: 'schema:public/book/Note',
        ref: 'oa://schema/public/book/Note',
        kind: 'definition-ref',
        source: {
          kind: 'file',
          filePath: '/workspace/fragments/path/public/book/NotesPath.yaml',
          pointer: '#/content/get/responses/200/content/application~1json/schema/$ref',
        },
      },
    ])
    expect(envelope.diagnostics).toEqual([])
  })

  it('maps registry, target, emit, and validation diagnostics into the shared envelope', () => {
    const registry = createDefinitionRegistry(diagnosticFixtureNodes())
    const selection = selectDefinitionTarget(registry, diagnosticTargetConfig())
    const emitted = emitDefinitionOpenApiDocument(selection)

    const envelope = toSharedProjectionEnvelope(registry, emitted)
    const diagnosticCodes = envelope.diagnostics.map(diagnostic => diagnostic.code)

    expect(diagnosticCodes).toEqual(expect.arrayContaining([
      'definition-registry/missing-ref',
      'definition-target/disallowed-ref',
      'definition-openapi-emit/unrewritten-ref',
      'definition-openapi-emit/validation-error',
    ]))
    expect(envelope.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'definition-registry/missing-ref',
        source: {
          kind: 'file',
          filePath: '/workspace/fragments/schema/public/book/Broken.yaml',
          pointer: '#/content/$ref',
        },
      }),
    ]))
  })
})

function toSharedProjectionEnvelope(
  registry: DefinitionRegistry,
  emitted: DefinitionOpenApiEmitResult,
): SharedSchemaProjectionEnvelope<DefinitionOpenApiEmitResult['document']> {
  return {
    projection: emitted.document,
    refs: registry.refEdges.map(edge => {
      const record: SharedSchemaRefEdge = {
        from: edge.sourceId,
        ref: edge.ref,
        kind: 'definition-ref',
        source: {
          kind: 'file',
          filePath: edge.sourcePath,
          pointer: edge.sourcePointer,
        },
      }
      if (edge.targetId !== undefined) record.to = edge.targetId
      return record
    }),
    diagnostics: [
      ...registry.diagnostics.map(toSharedDiagnostic),
      ...emitted.diagnostics.map(toSharedDiagnostic),
    ],
    sources: Object.fromEntries(registry.nodes.map(node => [
      node.id,
      {
        kind: 'file',
        filePath: node.sourcePath,
        pointer: node.sourcePointer,
      },
    ])),
    versionHash: registry.nodes
      .map(node => `${node.id}=${node.contentHash}`)
      .sort((a, b) => a.localeCompare(b))
      .join('|'),
  }
}

function toSharedDiagnostic(diagnostic: {
  severity: SharedSchemaDiagnostic['severity']
  code: string
  message: string
  sourcePath?: string
  sourcePointer?: string
  line?: number
  column?: number
}): SharedSchemaDiagnostic {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.sourcePath
      ? {
          source: {
            kind: 'file' as const,
            filePath: diagnostic.sourcePath,
            pointer: diagnostic.sourcePointer ?? '#',
            ...(typeof diagnostic.line === 'number' ? { line: diagnostic.line } : {}),
            ...(typeof diagnostic.column === 'number' ? { column: diagnostic.column } : {}),
          },
        }
      : {}),
  }
}

function targetConfig(): DefinitionTargetConfig {
  return {
    name: 'public-api',
    scopes: ['public'],
    domains: ['book'],
    servers: [{ url: 'https://api.example.test' }],
    includePaths: ['/notes'],
  }
}

function fixtureNodes() {
  return [
    createDefinitionNode({
      id: 'path:public/book/NotesPath',
      sourcePath: '/workspace/fragments/path/public/book/NotesPath.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:path',
      metadata: { path: '/notes' },
      content: {
        get: {
          operationId: 'listNotes',
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { $ref: 'oa://schema/public/book/Note' },
                },
              },
            },
          },
        },
      },
    }),
    createDefinitionNode({
      id: 'schema:public/book/Note',
      sourcePath: '/workspace/fragments/schema/public/book/Note.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:note',
      content: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      },
    }),
  ]
}

function diagnosticTargetConfig(): DefinitionTargetConfig {
  return {
    name: 'public-api',
    scopes: ['public'],
    domains: ['book'],
    servers: [{ url: 'https://api.example.test' }],
    includePaths: ['/notes/{id}'],
  }
}

function diagnosticFixtureNodes() {
  return [
    createDefinitionNode({
      id: 'path:public/book/NotePath',
      sourcePath: '/workspace/fragments/path/public/book/NotePath.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:path-with-diagnostics',
      metadata: { path: '/notes/{id}' },
      content: {
        get: {
          operationId: 'getNote',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: false,
              schema: { type: 'string' },
            },
          ],
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { $ref: 'oa://schema/admin/book/Secret' },
                },
              },
            },
          },
        },
      },
    }),
    createDefinitionNode({
      id: 'schema:admin/book/Secret',
      sourcePath: '/workspace/fragments/schema/admin/book/Secret.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:secret',
      content: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      },
    }),
    createDefinitionNode({
      id: 'schema:public/book/Broken',
      sourcePath: '/workspace/fragments/schema/public/book/Broken.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:broken',
      content: {
        $ref: 'oa://schema/public/book/Missing',
      },
    }),
  ]
}
