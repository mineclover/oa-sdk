import { describe, expect, it } from 'vitest'
import {
  OPENAPI_PROJECTION_PROFILE_EXTENSION,
  OPENAPI_PROJECTION_REFS_EXTENSION,
  OPENAPI_PROJECTION_SOURCES_EXTENSION,
  OPENAPI_PROJECTION_VERSION_HASH_EXTENSION,
  validateOpenApiProjection,
} from '@oa-sdk/openapi-projection-contract'
import { createDefinitionNode } from '../definition-node.js'
import { createDefinitionRegistry } from '../definition-registry.js'
import { emitDefinitionOpenApiDocument } from '../definition-openapi-emit.js'
import {
  DEFINITION_PROJECTION_COLLISION_REPORT_EXTENSION,
  DEFINITION_PROJECTION_OUTPUT_NAMES_EXTENSION,
  toDefinitionOpenApiProjectionResult,
} from '../definition-openapi-projection.js'
import { selectDefinitionTarget, type DefinitionTargetConfig } from '../definition-target.js'

describe('definition OpenAPI projection adapter', () => {
  it('maps a successful target document to the shared OpenApiProjectionResult contract', () => {
    const registry = createDefinitionRegistry(fixtureNodes())
    const selection = selectDefinitionTarget(registry, targetConfig())
    const emitted = emitDefinitionOpenApiDocument(selection)

    const projection = toDefinitionOpenApiProjectionResult({ registry, selection, emitted }, {
      lookupSourceLocation: fixtureSourceLocation,
    })
    const secondProjection = toDefinitionOpenApiProjectionResult({ registry, selection, emitted }, {
      lookupSourceLocation: fixtureSourceLocation,
    })

    expect(projection.profile).toBe('full-api-document')
    expect(projection.projection.openapi).toBe('3.2.0')
    expect((projection.projection.paths?.['/notes'] as Record<string, unknown>).get).toEqual(
      (emitted.document.paths?.['/notes'] as Record<string, unknown>).get,
    )
    expect(validateOpenApiProjection(projection)).toEqual({
      valid: true,
      diagnostics: [],
    })
    expect(projection.versionHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(projection.versionHash).toBe(secondProjection.versionHash)

    expect(projection.sources['path:public/book/NotesPath']).toEqual({
      kind: 'file',
      filePath: '/workspace/fragments/path/public/book/NotesPath.yaml',
      pointer: '#/content',
      line: 2,
      column: 1,
    })
    expect(projection.refs).toEqual([
      {
        from: 'path:public/book/NotesPath',
        to: 'schema:public/book/Note',
        ref: 'oa://schema/public/book/Note',
        kind: 'definition-ref',
        source: {
          kind: 'file',
          filePath: '/workspace/fragments/path/public/book/NotesPath.yaml',
          pointer: '#/content/get/responses/200/content/application~1json/schema/$ref',
          line: 12,
          column: 23,
        },
      },
      {
        from: 'schema:public/book/Note',
        to: 'schema:public/notebook/Note',
        ref: 'oa://schema/public/notebook/Note',
        kind: 'definition-ref',
        source: {
          kind: 'file',
          filePath: '/workspace/fragments/schema/public/book/Note.yaml',
          pointer: '#/content/properties/related/$ref',
          line: 5,
          column: 18,
        },
      },
    ])
    expect(projection.typeTargets?.map(target => [target.id, target.name, target.kind])).toEqual([
      ['schema:public/book/Note', 'BookNote', 'schema'],
      ['schema:public/notebook/Note', 'NotebookNote', 'schema'],
    ])

    expect(projection.projection[OPENAPI_PROJECTION_PROFILE_EXTENSION]).toBe('full-api-document')
    expect(projection.projection[OPENAPI_PROJECTION_VERSION_HASH_EXTENSION]).toBe(projection.versionHash)
    expect(projection.projection[OPENAPI_PROJECTION_SOURCES_EXTENSION]).toEqual(projection.sources)
    expect(projection.projection[OPENAPI_PROJECTION_REFS_EXTENSION]).toEqual(projection.refs)
    expect(projection.projection[DEFINITION_PROJECTION_OUTPUT_NAMES_EXTENSION]).toEqual([
      {
        id: 'schema:public/book/Note',
        kind: 'schema',
        scope: 'public',
        domain: 'book',
        localName: 'Note',
        outputName: 'BookNote',
        reason: 'domain-prefix',
      },
      {
        id: 'schema:public/notebook/Note',
        kind: 'schema',
        scope: 'public',
        domain: 'notebook',
        localName: 'Note',
        outputName: 'NotebookNote',
        reason: 'domain-prefix',
      },
    ])
    expect(projection.projection[DEFINITION_PROJECTION_COLLISION_REPORT_EXTENSION]).toEqual([
      {
        canonicalId: 'schema:public/book/Note',
        targetName: 'public-api',
        kind: 'schema',
        scope: 'public',
        domain: 'book',
        localName: 'Note',
        outputName: 'BookNote',
        reason: 'domain-prefix',
        severity: 'warning',
      },
      {
        canonicalId: 'schema:public/notebook/Note',
        targetName: 'public-api',
        kind: 'schema',
        scope: 'public',
        domain: 'notebook',
        localName: 'Note',
        outputName: 'NotebookNote',
        reason: 'domain-prefix',
        severity: 'warning',
      },
    ])
  })

  it('preserves registry diagnostics in the shared diagnostic envelope', () => {
    const registry = createDefinitionRegistry(diagnosticFixtureNodes(), {
      lookupSourceLocation: (sourcePath, pointer) => {
        if (sourcePath.endsWith('/Broken.yaml') && pointer === '#/content/$ref') {
          return { line: 31, column: 9 }
        }
        return undefined
      },
    })
    const selection = selectDefinitionTarget(registry, diagnosticTargetConfig())
    const emitted = emitDefinitionOpenApiDocument(selection)

    const projection = toDefinitionOpenApiProjectionResult({ registry, selection, emitted })
    const diagnosticCodes = projection.diagnostics.map(diagnostic => diagnostic.code)

    expect(validateOpenApiProjection(projection).valid).toBe(false)
    expect(diagnosticCodes).toEqual(expect.arrayContaining([
      'definition-registry/missing-ref',
      'definition-target/disallowed-ref',
      'definition-openapi-emit/unrewritten-ref',
      'definition-openapi-emit/validation-error',
    ]))
    expect(projection.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'definition-registry/missing-ref',
        source: {
          kind: 'file',
          filePath: '/workspace/fragments/schema/public/book/Broken.yaml',
          pointer: '#/content/$ref',
          line: 31,
          column: 9,
        },
      }),
    ]))
  })
})

function targetConfig(): DefinitionTargetConfig {
  return {
    name: 'public-api',
    scopes: ['public'],
    domains: ['book', 'notebook'],
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
      contentHash: 'sha256:book-note',
      content: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          related: { $ref: 'oa://schema/public/notebook/Note' },
        },
      },
    }),
    createDefinitionNode({
      id: 'schema:public/notebook/Note',
      sourcePath: '/workspace/fragments/schema/public/notebook/Note.yaml',
      sourcePointer: '#/content',
      contentHash: 'sha256:notebook-note',
      content: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          body: { type: 'string' },
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

function fixtureSourceLocation(sourcePath: string, pointer: string) {
  if (sourcePath.endsWith('/NotesPath.yaml') && pointer === '#/content') {
    return { line: 2, column: 1 }
  }
  if (
    sourcePath.endsWith('/NotesPath.yaml')
    && pointer === '#/content/get/responses/200/content/application~1json/schema/$ref'
  ) {
    return { line: 12, column: 23 }
  }
  if (sourcePath.endsWith('/Note.yaml') && pointer === '#/content/properties/related/$ref') {
    return { line: 5, column: 18 }
  }
  return undefined
}
