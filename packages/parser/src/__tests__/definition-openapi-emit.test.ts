import { describe, expect, it } from 'vitest'
import { createDefinitionNode } from '../definition-node.js'
import { createDefinitionRegistry } from '../definition-registry.js'
import { selectDefinitionTarget, type DefinitionTargetConfig } from '../definition-target.js'
import { emitDefinitionOpenApiDocument } from '../definition-openapi-emit.js'
import { validateDocument } from '../validate.js'

describe('definition OpenAPI document emit', () => {
  it('emits a valid OAS 3.2 document with rewritten refs and alias metadata', () => {
    const registry = createDefinitionRegistry(fixtureNodes())
    const selection = selectDefinitionTarget(registry, bookNotebookTarget())
    const emitted = emitDefinitionOpenApiDocument(selection, {
      info: {
        title: 'Book and Notebook Notes API',
        version: '1.0.0',
      },
    })
    const document = emitted.document as Record<string, unknown>

    expect(registry.valid).toBe(true)
    expect(selection.valid).toBe(true)
    expect(emitted.valid).toBe(true)
    expect(emitted.validation.valid).toBe(true)
    expect(validateDocument(emitted.document as Record<string, unknown>).valid).toBe(true)
    expect(document.openapi).toBe('3.2.0')
    expect(document.info).toEqual({
      title: 'Book and Notebook Notes API',
      version: '1.0.0',
    })
    expect(document.servers).toEqual([{ url: 'https://api.example.test' }])
    expect(Object.keys(document.paths as Record<string, unknown>).sort()).toEqual([
      '/books/{bookId}/notes',
      '/notebooks/{notebookId}/notes',
    ])
    expect(document.webhooks).toEqual({})

    expect(emitted.document.components?.schemas).toEqual({
      BookNote: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          notebookNote: { $ref: '#/components/schemas/NotebookNote' },
        },
      },
      NotebookNote: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          body: { type: 'string' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
        },
      },
    })

    const bookMediaType = (((emitted.document.paths?.['/books/{bookId}/notes'] as Record<string, unknown>)
      .get as Record<string, unknown>).responses as Record<string, unknown>)['200'] as {
        content: Record<string, { itemSchema?: unknown; examples?: unknown }>
      }
    expect(bookMediaType.content['application/x-ndjson']).toEqual({
      itemSchema: { $ref: '#/components/schemas/BookNote' },
      examples: {
        sample: {
          dataValue: { id: 'note-1', body: 'hello' },
          serializedValue: '{"id":"note-1","body":"hello"}\n',
        },
      },
    })

    expect(JSON.stringify(emitted.document)).not.toContain('oa://')
    expect(collectRefs(emitted.document).every(ref => ref.startsWith('#/'))).toBe(true)
    expect(document['x-oa-sdk-definition-aliases']).toEqual([
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
    expect(emitted.report.renamedAliases.map(alias => alias.outputName)).toEqual([
      'BookNote',
      'NotebookNote',
    ])
    expect(emitted.diagnostics).toHaveLength(0)
  })

  it('reports source refs that could not be rewritten', () => {
    const leakPath = definitionNode('path:public/book/LeakPath', {
      get: {
        summary: 'Leak',
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { $ref: 'oa://schema/admin/book/Note' },
              },
            },
          },
        },
      },
    }, { path: '/leak' })
    const adminNote = definitionNode('schema:admin/book/Note')
    const registry = createDefinitionRegistry([leakPath, adminNote])
    const selection = selectDefinitionTarget(registry, {
      name: 'public-api',
      scopes: ['public'],
      domains: ['book'],
      servers: [{ url: 'https://api.example.test' }],
      includePaths: ['/leak'],
    })

    const emitted = emitDefinitionOpenApiDocument(selection)

    expect(selection.valid).toBe(false)
    expect(emitted.valid).toBe(false)
    expect(emitted.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'definition-target/disallowed-ref',
      'definition-openapi-emit/unrewritten-ref',
    ])
    expect(JSON.stringify(emitted.document)).toContain('oa://schema/admin/book/Note')
  })
})

function bookNotebookTarget(): DefinitionTargetConfig {
  return {
    name: 'book-notebook-api',
    scopes: ['shared', 'public'],
    domains: ['common', 'book', 'notebook'],
    servers: [{ url: 'https://api.example.test' }],
    includePaths: ['/books/{bookId}/notes', '/notebooks/{notebookId}/notes'],
  }
}

function fixtureNodes() {
  return [
    definitionNode('path:public/book/BookNotesPath', {
      get: {
        operationId: 'listBookNotes',
        summary: 'List book notes',
        parameters: [
          {
            name: 'bookId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/x-ndjson': {
                itemSchema: { $ref: 'oa://schema/public/book/Note' },
                examples: {
                  sample: {
                    dataValue: { id: 'note-1', body: 'hello' },
                    serializedValue: '{"id":"note-1","body":"hello"}\n',
                  },
                },
              },
            },
          },
          default: {
            description: 'Error',
            content: {
              'application/json': {
                schema: { $ref: 'oa://schema/shared/common/Error' },
              },
            },
          },
        },
      },
    }, { path: '/books/{bookId}/notes' }),
    definitionNode('path:public/notebook/NotebookNotesPath', {
      get: {
        operationId: 'listNotebookNotes',
        summary: 'List notebook notes',
        parameters: [
          {
            name: 'notebookId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: 'oa://schema/public/notebook/Note' },
                },
              },
            },
          },
          default: {
            description: 'Error',
            content: {
              'application/json': {
                schema: { $ref: 'oa://schema/shared/common/Error' },
              },
            },
          },
        },
      },
    }, { path: '/notebooks/{notebookId}/notes' }),
    definitionNode('schema:public/book/Note', {
      type: 'object',
      properties: {
        id: { type: 'string' },
        notebookNote: { $ref: 'oa://schema/public/notebook/Note' },
      },
    }),
    definitionNode('schema:public/notebook/Note', {
      type: 'object',
      properties: {
        id: { type: 'string' },
        body: { type: 'string' },
      },
    }),
    definitionNode('schema:shared/common/Error', {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
      },
    }),
  ]
}

function definitionNode(id: string, content: unknown = { type: 'object' }, metadata?: Record<string, unknown>) {
  const [kind, path] = id.split(':')
  if (!kind || !path) throw new Error(`Invalid fixture id: ${id}`)
  const [scope, domain, name] = path.split('/')
  return createDefinitionNode({
    id,
    sourcePath: `/workspace/fragments/${kind}/${scope}/${domain}/${name}.yaml`,
    sourcePointer: '#/content',
    contentHash: `sha256:${id}`,
    content,
    ...(metadata ? { metadata } : {}),
  })
}

function collectRefs(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(collectRefs)

  const refs: string[] = []
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === '$ref' && typeof child === 'string') {
      refs.push(child)
    } else {
      refs.push(...collectRefs(child))
    }
  }
  return refs
}
