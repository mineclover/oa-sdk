import { describe, expect, it } from 'vitest'
import { createDefinitionNode } from '../definition-node.js'
import { createDefinitionRegistry } from '../definition-registry.js'
import { selectDefinitionTarget, type DefinitionTargetConfig } from '../definition-target.js'

describe('definition target selection', () => {
  it('selects public versus admin paths and recursively includes referenced components', () => {
    const registry = createDefinitionRegistry(fixtureNodes())

    const publicTarget = selectDefinitionTarget(registry, publicConfig())
    const adminTarget = selectDefinitionTarget(registry, adminConfig())

    expect(registry.valid).toBe(true)
    expect(publicTarget.valid).toBe(true)
    expect(adminTarget.valid).toBe(true)
    expect(publicTarget.target.servers).toEqual([{ url: 'https://api.example.test' }])
    expect(adminTarget.target.servers).toEqual([{ url: 'https://admin.example.test' }])
    expect(publicTarget.directPathIds).toEqual(['path:public/book/BookNotesPath'])
    expect(publicTarget.directDefinitionIds).toEqual([])
    expect(adminTarget.directPathIds).toEqual(['path:admin/book/BookNotesPath'])
    expect(adminTarget.directDefinitionIds).toEqual([])
    expect(sortedIds(publicTarget.nodes)).toEqual([
      'parameter:public/book/BookIdParameter',
      'path:public/book/BookNotesPath',
      'requestBody:public/book/SearchNotesBody',
      'response:public/book/NoteListResponse',
      'response:shared/common/ErrorResponse',
      'schema:public/book/Note',
      'schema:public/notebook/Note',
      'schema:shared/common/Error',
      'schema:shared/common/Id',
    ])
    expect(sortedIds(adminTarget.nodes)).toEqual([
      'parameter:admin/book/BookIdParameter',
      'path:admin/book/BookNotesPath',
      'requestBody:admin/book/SearchNotesBody',
      'response:admin/book/NoteListResponse',
      'response:shared/common/ErrorResponse',
      'schema:admin/book/Note',
      'schema:admin/notebook/Note',
      'schema:shared/common/Error',
      'schema:shared/common/Id',
    ])
    expect(publicTarget.nodeById.has('schema:admin/book/Note')).toBe(false)
    expect(adminTarget.nodeById.has('schema:public/book/Note')).toBe(false)
    expect(publicTarget.outputNameAllocation.outputNames.get('schema:public/book/Note')).toBe('BookNote')
    expect(publicTarget.outputNameAllocation.outputNames.get('schema:public/notebook/Note')).toBe('NotebookNote')
    expect(publicTarget.outputNameAllocation.outputNames.get('schema:shared/common/Error')).toBe('Error')
    expect(adminTarget.outputNameAllocation.outputNames.get('schema:admin/book/Note')).toBe('BookNote')
    expect(adminTarget.outputNameAllocation.outputNames.get('schema:admin/notebook/Note')).toBe('NotebookNote')
    expect(adminTarget.outputNameAllocation.outputNames.get('schema:shared/common/Error')).toBe('Error')
  })

  it('applies naming policy aliases only inside the selected target allocation', () => {
    const registry = createDefinitionRegistry(fixtureNodes())
    const publicTarget = selectDefinitionTarget(registry, {
      ...publicConfig(),
      namingPolicy: {
        aliases: {
          'schema:public/book/Note': 'PublicBookNote',
        },
      },
    })
    const adminTarget = selectDefinitionTarget(registry, adminConfig())

    expect(publicTarget.valid).toBe(true)
    expect(publicTarget.outputNameAllocation.outputNames.get('schema:public/book/Note')).toBe('PublicBookNote')
    expect(publicTarget.outputNameAllocation.outputNames.get('schema:public/notebook/Note')).toBe('Note')
    expect(publicTarget.outputNameAllocation.aliasById.get('schema:public/book/Note')?.reason)
      .toBe('explicit-alias')
    expect(adminTarget.outputNameAllocation.outputNames.get('schema:admin/book/Note')).toBe('BookNote')
    expect(adminTarget.outputNameAllocation.outputNames.get('schema:admin/notebook/Note')).toBe('NotebookNote')
  })

  it('rejects recursive refs outside configured scopes and domains', () => {
    const path = definitionNode('path:public/book/AdminLeakPath', {
      get: {
        responses: {
          200: { $ref: 'oa://schema/admin/book/Note' },
        },
      },
    }, { path: '/leak' })
    const adminNote = definitionNode('schema:admin/book/Note')
    const registry = createDefinitionRegistry([path, adminNote])

    const target = selectDefinitionTarget(registry, {
      name: 'public-api',
      scopes: ['shared', 'public'],
      domains: ['common', 'book'],
      servers: [{ url: 'https://api.example.test' }],
      includePaths: ['/leak'],
    })

    expect(target.valid).toBe(false)
    expect(sortedIds(target.nodes)).toEqual(['path:public/book/AdminLeakPath'])
    expect(target.diagnostics).toEqual([
      {
        code: 'definition-target/disallowed-ref',
        severity: 'error',
        targetName: 'public-api',
        id: 'schema:admin/book/Note',
        sourceId: 'path:public/book/AdminLeakPath',
        targetId: 'schema:admin/book/Note',
        ref: 'oa://schema/admin/book/Note',
        sourcePath: '/workspace/fragments/path/public/book/AdminLeakPath.yaml',
        sourcePointer: '#/content/get/responses/200/$ref',
        message: 'Target "public-api" cannot include referenced definition "schema:admin/book/Note" because scope "admin" or domain "book" is outside configured scopes/domains.',
      },
    ])
  })

  it('includes explicit retained definitions without requiring a path ref', () => {
    const registry = createDefinitionRegistry([
      ...fixtureNodes(),
      definitionNode('securityScheme:shared/common/OAuth2', {
        type: 'oauth2',
        flows: {},
      }),
    ])

    const target = selectDefinitionTarget(registry, {
      ...publicConfig(),
      includeDefinitions: ['securityScheme:shared/common/OAuth2'],
    })

    expect(target.valid).toBe(true)
    expect(target.directDefinitionIds).toEqual(['securityScheme:shared/common/OAuth2'])
    expect(sortedIds(target.nodes)).toContain('securityScheme:shared/common/OAuth2')
  })

  it('rejects explicit retained definitions that are missing or outside the target boundary', () => {
    const registry = createDefinitionRegistry([
      ...fixtureNodes(),
      definitionNode('schema:internal/book/AuditOnly'),
    ])

    const target = selectDefinitionTarget(registry, {
      ...publicConfig(),
      includeDefinitions: [
        'schema:shared/common/Missing',
        'schema:internal/book/AuditOnly',
      ],
    })

    expect(target.valid).toBe(false)
    expect(target.directDefinitionIds).toEqual([])
    expect(target.diagnostics).toEqual([
      expect.objectContaining({
        code: 'definition-target/definition-not-found',
        id: 'schema:shared/common/Missing',
      }),
      expect.objectContaining({
        code: 'definition-target/disallowed-definition',
        id: 'schema:internal/book/AuditOnly',
      }),
    ])
  })
})

function publicConfig(): DefinitionTargetConfig {
  return {
    name: 'public-api',
    scopes: ['shared', 'public'],
    domains: ['common', 'book', 'notebook'],
    servers: [{ url: 'https://api.example.test' }],
    includePaths: ['/books/{bookId}/notes'],
  }
}

function adminConfig(): DefinitionTargetConfig {
  return {
    name: 'admin-api',
    scopes: ['shared', 'admin'],
    domains: ['common', 'book', 'notebook'],
    servers: [{ url: 'https://admin.example.test' }],
    includePaths: ['/admin/books/{bookId}/notes'],
  }
}

function fixtureNodes() {
  return [
    definitionNode('schema:shared/common/Id', { type: 'string', format: 'uuid' }),
    definitionNode('schema:shared/common/Error', {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
      },
    }),
    definitionNode('response:shared/common/ErrorResponse', {
      description: 'Error',
      content: {
        'application/json': {
          schema: { $ref: 'oa://schema/shared/common/Error' },
        },
      },
    }),
    definitionNode('path:public/book/BookNotesPath', {
      get: {
        parameters: [
          { $ref: 'oa://parameter/public/book/BookIdParameter' },
        ],
        requestBody: { $ref: 'oa://requestBody/public/book/SearchNotesBody' },
        responses: {
          200: { $ref: 'oa://response/public/book/NoteListResponse' },
          default: { $ref: 'oa://response/shared/common/ErrorResponse' },
        },
      },
    }, { path: '/books/{bookId}/notes' }),
    definitionNode('parameter:public/book/BookIdParameter', {
      name: 'bookId',
      in: 'path',
      required: true,
      schema: { $ref: 'oa://schema/shared/common/Id' },
    }),
    definitionNode('requestBody:public/book/SearchNotesBody', {
      content: {
        'application/json': {
          schema: { $ref: 'oa://schema/public/book/Note' },
        },
      },
    }),
    definitionNode('response:public/book/NoteListResponse', {
      description: 'OK',
      content: {
        'application/json': {
          schema: {
            type: 'array',
            items: { $ref: 'oa://schema/public/book/Note' },
          },
        },
      },
    }),
    definitionNode('schema:public/book/Note', {
      type: 'object',
      properties: {
        related: { $ref: 'oa://schema/public/notebook/Note' },
        error: { $ref: 'oa://schema/shared/common/Error' },
      },
    }),
    definitionNode('schema:public/notebook/Note', { type: 'object' }),
    definitionNode('path:admin/book/BookNotesPath', {
      get: {
        parameters: [
          { $ref: 'oa://parameter/admin/book/BookIdParameter' },
        ],
        requestBody: { $ref: 'oa://requestBody/admin/book/SearchNotesBody' },
        responses: {
          200: { $ref: 'oa://response/admin/book/NoteListResponse' },
          default: { $ref: 'oa://response/shared/common/ErrorResponse' },
        },
      },
    }, { path: '/admin/books/{bookId}/notes' }),
    definitionNode('parameter:admin/book/BookIdParameter', {
      name: 'bookId',
      in: 'path',
      required: true,
      schema: { $ref: 'oa://schema/shared/common/Id' },
    }),
    definitionNode('requestBody:admin/book/SearchNotesBody', {
      content: {
        'application/json': {
          schema: { $ref: 'oa://schema/admin/book/Note' },
        },
      },
    }),
    definitionNode('response:admin/book/NoteListResponse', {
      description: 'OK',
      content: {
        'application/json': {
          schema: {
            type: 'array',
            items: { $ref: 'oa://schema/admin/book/Note' },
          },
        },
      },
    }),
    definitionNode('schema:admin/book/Note', {
      type: 'object',
      properties: {
        related: { $ref: 'oa://schema/admin/notebook/Note' },
        error: { $ref: 'oa://schema/shared/common/Error' },
      },
    }),
    definitionNode('schema:admin/notebook/Note', { type: 'object' }),
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

function sortedIds(nodes: readonly { id: string }[]): string[] {
  return nodes.map(node => node.id).sort()
}
