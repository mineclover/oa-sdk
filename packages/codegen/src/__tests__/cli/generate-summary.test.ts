import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('reports operations and the document version in the schema pipeline report', async () => {
    const specPath = writeDocument('library.json', oas32Document)

    const { manifest, reportTable } = await executeSchemaPipeline({
      specs: [{ id: 'library', profile: 'full-api-document', schemaEntry: specPath, outDir: path.join(tmpDir, 'generated') }],
    }, { rootDir: tmpDir, writeFiles: false })

    const stage3 = manifest.stages.stage3_openApi31.specs[0]!
    expect(stage3.operationCount).toBe(5)
    expect(stage3.specVersion).toBe('3.2.0')
    expect(reportTable).toContain('Stage 3 (OpenAPI 3.2.0)')
    expect(reportTable).toContain('(5 ops,')
  })
})
