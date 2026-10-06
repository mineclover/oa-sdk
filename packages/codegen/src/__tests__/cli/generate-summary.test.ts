import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseDocument, type OasDocument } from '@oa-sdk/parser'
import { generate } from '../../cli/commands/generate.js'
import type { CompanionCommandContext } from '../../cli/lib/companion-packages.js'
import { projectTargetSpec } from '../../spec-projector.js'
import { executeSchemaPipeline } from '../../schema-pipeline/index.js'
import { importerWithout } from '../helpers/companion-packages.js'

const response = { '200': { description: 'ok' } }

/**
 * OAS 3.2 document with 2 paths, 5 operations under them (a fixed-field
 * `query` operation and an `additionalOperations` entry among them, one Path
 * Item reached through `$ref`) and a webhook, which is not an operation of the
 * described server.
 */
const oas32Document = {
  openapi: '3.2.0',
  info: { title: 'Library API', version: '1.0.0' },
  paths: {
    '/books': {
      get: { operationId: 'listBooks', responses: response },
      post: { operationId: 'createBook', responses: response },
      query: { operationId: 'searchBooks', responses: response },
    },
    '/books/{id}': { $ref: '#/components/pathItems/Book' },
  },
  webhooks: {
    bookAdded: { post: { operationId: 'onBookAdded', responses: response } },
  },
  components: {
    pathItems: {
      Book: {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: { operationId: 'getBook', responses: response },
        additionalOperations: {
          COPY: { operationId: 'copyBook', responses: response },
        },
      },
    },
    schemas: {
      Book: { type: 'object', properties: { id: { type: 'string' } } },
    },
  },
}

/**
 * A document whose `tags` hold a `null` entry, which the `parseDocument` IR
 * cannot index, and whose `paths` hold values that are not Path Items or
 * Operations. Only `GET /books` and the `COPY` additional operation of
 * `/books` are operations.
 */
const malformedDocument = {
  openapi: '3.1.0',
  info: { title: 'Malformed API', version: '1.0.0' },
  tags: [null],
  paths: {
    '/books': {
      parameters: [null, 'id'],
      get: { operationId: 'listBooks', responses: response },
      post: null,
      additionalOperations: {
        COPY: { operationId: 'copyBooks', responses: response },
        LINK: 'not an operation',
      },
    },
    '/null': null,
    '/array': [{ get: { operationId: 'inArray', responses: response } }],
    '/non-string-ref': { $ref: 42 },
    '/missing-ref': { $ref: '#/components/pathItems/Missing' },
    '/cyclic-ref': { $ref: '#/paths/~1cyclic-ref' },
    '/invalid-pointer': { $ref: '#/paths/%E0%A4%A' },
  },
}

/**
 * An API in three files (written by `writeMultiFileDocument`): `/users/{id}`
 * is a Path Item `$ref` to `user-path.json`, which holds its two operations and
 * refers to a schema in `schemas.json`. Three operations in all.
 */
const multiFileDocuments = {
  'contract.json': {
    openapi: '3.2.0',
    info: { title: 'Multi-file API', version: '1.0.0' },
    paths: {
      '/health': { get: { operationId: 'getHealth', responses: response } },
      '/users/{id}': {
        $ref: './user-path.json',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      },
    },
  },
  'user-path.json': {
    get: {
      operationId: 'getUser',
      responses: {
        '200': { description: 'ok', content: { 'application/json': { schema: { $ref: './schemas.json#/User' } } } },
      },
    },
    delete: { operationId: 'deleteUser', responses: { '204': { description: 'deleted' } } },
  },
  'schemas.json': {
    User: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
  },
}

describe('oa-gen generate summary', () => {
  let tmpDir: string
  let logs: string[]

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-generate-summary-'))
    logs = []
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => { logs.push(parts.map(String).join(' ')) })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const writeDocument = (name: string, document: Record<string, unknown>) => {
    const filePath = path.join(tmpDir, name)
    fs.writeFileSync(filePath, JSON.stringify(document, null, 2))
    return filePath
  }

  const runGenerate = (specPath: string) => {
    // Without companions the summary still reports the projected documents.
    const context: CompanionCommandContext = {
      cwd: tmpDir,
      projectRoot: tmpDir,
      importCompanion: importerWithout('@oa-sdk/router', '@oa-sdk/client'),
    }
    return generate.run({ spec: specPath, 'out-dir': path.join(tmpDir, 'generated') }, context)
  }

  it('counts operations, not paths, including query and additionalOperations, and prints the document version', async () => {
    await runGenerate(writeDocument('library.json', oas32Document))

    const summary = logs.join('\n')
    expect(summary).toMatch(/library\s+\[full-api-document\s*\] -> 5 ops, 1 schemas/)
    expect(summary).toContain(`- OpenAPI 3.2.0: ${path.join('generated', 'library.openapi.json')}`)
    expect(summary).not.toContain('OpenAPI 3.1')
  })

  it('prints the version a 3.1 document declares', async () => {
    await runGenerate(writeDocument('legacy.json', { ...oas32Document, openapi: '3.1.1', webhooks: {} }))

    expect(logs.join('\n')).toContain(`- OpenAPI 3.1.1: ${path.join('generated', 'legacy.openapi.json')}`)
  })

  it('reports the operation count of a projected target', async () => {
    const specPath = writeDocument('library.json', oas32Document)

    const result = await projectTargetSpec({ id: 'library', profile: 'full-api-document', schemaEntry: specPath, outDir: 'generated' }, tmpDir)

    expect(result.operationCount).toBe(5)
  })

  describe('a spec that spans several files', () => {
    const writeMultiFileDocument = () => {
      for (const [name, document] of Object.entries(multiFileDocuments)) writeDocument(name, document)
      return path.join(tmpDir, 'contract.json')
    }

    it('counts the operations of a Path Item in another file in the summary', async () => {
      await runGenerate(writeMultiFileDocument())

      expect(logs.join('\n')).toMatch(/contract\s+\[full-api-document\s*\] -> 3 ops, 0 schemas/)
    })

    it('is projected as written, its operation count leaving out the Path Item in another file', async () => {
      const specPath = writeMultiFileDocument()

      const result = await projectTargetSpec({ id: 'contract', profile: 'full-api-document', schemaEntry: specPath, outDir: 'generated' }, tmpDir)

      expect(result.operationCount).toBe(1)
      expect((result.openApiDoc['paths'] as Record<string, unknown>)['/users/{id}']).toMatchObject({ $ref: './user-path.json' })
    })
  })

  describe('a document the parseDocument IR cannot index', () => {
    it('is the document this suite means', () => {
      // Precondition: the full IR fails on the `null` tag, so counting through it would fail
      // projection, and the parse the generate summary counts in fails too.
      expect(() => parseDocument(malformedDocument as unknown as OasDocument, [])).toThrow(TypeError)
      const specPath = writeDocument('malformed.json', malformedDocument)
      expect(() => parseDocument(malformedDocument as unknown as OasDocument, { basePath: specPath })).toThrow(TypeError)
    })

    it('is still projected, with the operations its paths hold counted', async () => {
      const specPath = writeDocument('malformed.json', malformedDocument)

      const result = await projectTargetSpec({ id: 'malformed', profile: 'full-api-document', schemaEntry: specPath, outDir: 'generated' }, tmpDir)

      expect(result.operationCount).toBe(2)
      expect(result.openApiDoc['tags']).toEqual([null])
    })

    it('is still generated, with the operation count in the summary', async () => {
      await runGenerate(writeDocument('malformed.json', malformedDocument))

      expect(logs.join('\n')).toMatch(/malformed\s+\[full-api-document\s*\] -> 2 ops, 0 schemas/)
      expect(fs.existsSync(path.join(tmpDir, 'generated', 'malformed.openapi.json'))).toBe(true)
    })
  })

  it('reports operations and the document version in the schema pipeline report', async () => {
    const specPath = writeDocument('library.json', oas32Document)

    const { manifest, reportTable } = await executeSchemaPipeline({
      specs: [{ id: 'library', profile: 'full-api-document', schemaEntry: specPath, outDir: path.join(tmpDir, 'generated') }],
    }, { rootDir: tmpDir, writeFiles: false })

    const stage3 = manifest.stages.stage3_openApi31.specs[0]!
    expect(stage3.operationCount).toBe(5)
    expect(stage3.specVersion).toBe('3.2.0')
    expect(manifest.stages.stage3_openApi31.specVersion).toBe('3.2.0')
    expect(reportTable).toContain('[Stage 3: OAS 3.2.0]')
    expect(reportTable).toContain('Stage 3 (OpenAPI 3.2.0)')
    expect(reportTable).toContain('(5 ops,')
    expect(reportTable).not.toContain('OAS 3.1')
    expect(reportTable).not.toContain('OpenAPI 3.1')
  })

  it('reports the distinct versions of the documents in the schema pipeline report when targets differ', async () => {
    const outDir = path.join(tmpDir, 'generated')
    const specs = [
      { id: 'library', profile: 'full-api-document' as const, schemaEntry: writeDocument('library.json', oas32Document), outDir },
      { id: 'legacy', profile: 'full-api-document' as const, schemaEntry: writeDocument('legacy.json', { ...oas32Document, openapi: '3.1.1', webhooks: {} }), outDir },
      { id: 'catalog', profile: 'full-api-document' as const, schemaEntry: writeDocument('catalog.json', oas32Document), outDir },
    ]

    const { manifest, reportTable } = await executeSchemaPipeline({ specs }, { rootDir: tmpDir, writeFiles: false })

    expect(manifest.stages.stage3_openApi31.specs.map(spec => spec.specVersion)).toEqual(['3.2.0', '3.1.1', '3.2.0'])
    expect(manifest.stages.stage3_openApi31.specVersion).toBe('3.2.0, 3.1.1')
    expect(reportTable).toContain('[Stage 3: OAS 3.2.0, 3.1.1]')
    expect(reportTable).toContain('Stage 3 (OpenAPI 3.1.1)')
  })
})
