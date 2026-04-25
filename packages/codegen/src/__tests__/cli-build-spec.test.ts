import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
  validateOpenApiProjection,
  type OpenApiProjectionResult,
} from '@oa-sdk/openapi-projection-contract'
import { loadSqliteDriver } from '../sqlite-workspace-index.js'

const pkgDir = resolve(__dirname, '../..')
const cliPath = resolve(pkgDir, 'dist/cli/index.js')
const tmpBase = resolve(pkgDir, '.tmp-cli-build-spec-test')

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpBase, `run-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

describe('oa-gen build-spec', () => {
  it('documents the build-spec command and scoped options in help', () => {
    const result = runCli(['--help'])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('oa-gen build-spec --target, -t <target>')
    expect(result.stdout).toContain('[build-spec] target config 파일 경로')
    expect(result.stdout).toContain('[build-spec] 빌드된 OpenAPI YAML 출력 파일 경로')
    expect(result.stdout).toContain('--composition-report')
    expect(result.stdout).toContain('machine-readable target composition report JSON 출력 파일 경로')
    expect(result.stdout).toContain('--provenance')
    expect(result.stdout).toContain('machine-readable output pointer provenance map JSON 출력 파일 경로')
    expect(result.stdout).toContain('--metadata-registry')
    expect(result.stdout).toContain('machine-readable internal metadata registry JSON 출력 파일 경로')
    expect(result.stdout).toContain('--behavior-log')
    expect(result.stdout).toContain('append-only behavior JSONL 출력 파일 경로')
  })

  it('builds a target OpenAPI document and writes sidecar reports', () => {
    writeTarget('public-api.yaml', targetConfig(['/books']))
    writeFragment('path/public/book/BooksPath.yaml', {
      id: 'path:public/book/BooksPath',
      metadata: {
        path: '/books',
        tracking: { id: 'trk_books_path' },
        operations: {
          get: {
            trackingId: 'trk_books_list',
            owner: 'catalog',
          },
        },
      },
      content: {
        get: {
          summary: 'List books',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: 'oa://schema/public/book/Book' },
                  },
                  example: [
                    { id: 'book-1' },
                  ],
                },
              },
            },
          },
        },
      },
    })
    writeFragment('schema/public/book/Book.yaml', {
      id: 'schema:public/book/Book',
      content: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
    })

    const outputPath = join(tmpDir, 'out', 'public-api.yaml')
    const diagnosticsPath = join(tmpDir, 'out', 'diagnostics.json')
    const collisionReportPath = join(tmpDir, 'out', 'collisions.json')
    const compositionReportPath = join(tmpDir, 'out', 'composition.json')
    const provenancePath = join(tmpDir, 'out', 'provenance.json')
    const metadataRegistryPath = join(tmpDir, 'out', 'metadata-registry.json')
    const result = runCli([
      'build-spec',
      '--target',
      join(tmpDir, 'targets', 'public-api.yaml'),
      '--output',
      outputPath,
      '--diagnostics',
      diagnosticsPath,
      '--collision-report',
      collisionReportPath,
      '--composition-report',
      compositionReportPath,
      '--provenance',
      provenancePath,
      '--metadata-registry',
      metadataRegistryPath,
    ])

    expect(result.status).toBe(0)
    expect(result.stderr).toContain('build-spec: built "public-api"')
    expect(existsSync(outputPath)).toBe(true)

    const document = parseYaml(readFileSync(outputPath, 'utf8')) as {
      openapi?: string
      paths?: Record<string, unknown>
      components?: { schemas?: Record<string, unknown> }
    }
    expect(document.openapi).toBe('3.2.0')
    expect(document.paths?.['/books']).toBeDefined()
    expect(document.components?.schemas?.Book).toBeDefined()
    expect(JSON.stringify(document)).not.toContain('oa://')
    expect(validateOpenApiProjection({
      profile: 'full-api-document',
      projection: document,
      refs: [],
      diagnostics: [],
      sources: {},
      versionHash: 'sha256:cli-build-spec-output',
    } satisfies OpenApiProjectionResult<Record<string, unknown>>)).toEqual({
      valid: true,
      diagnostics: [],
    })

    const diagnostics = readJson(diagnosticsPath) as {
      valid?: boolean
      summary?: { errors?: number }
      diagnostics?: unknown[]
    }
    expect(diagnostics.valid).toBe(true)
    expect(diagnostics.summary?.errors).toBe(0)
    expect(diagnostics.diagnostics).toEqual([])

    const collisionReport = readJson(collisionReportPath) as Array<{
      canonicalId?: string
      outputName?: string
      severity?: string
    }>
    expect(collisionReport).toContainEqual(expect.objectContaining({
      canonicalId: 'schema:public/book/Book',
      outputName: 'Book',
      severity: 'info',
    }))

    const compositionReport = readJson(compositionReportPath) as {
      schemaVersion?: string
      summary?: {
        selectedNodeCount?: number
        directPathCount?: number
        transitiveComponentCount?: number
        omittedNodeCount?: number
      }
      selected?: {
        directPathIds?: string[]
        transitiveComponentIds?: string[]
      }
      output?: {
        paths?: Array<{ canonicalId?: string; openApiPath?: string }>
        components?: Array<{ canonicalId?: string; outputPointer?: string }>
      }
      sourceRefs?: Array<{ sourceId?: string; targetId?: string; ref?: string }>
    }
    expect(compositionReport.schemaVersion).toBe('oa-gen.composition-report.v1')
    expect(compositionReport.summary).toEqual(expect.objectContaining({
      selectedNodeCount: 2,
      directPathCount: 1,
      transitiveComponentCount: 1,
      omittedNodeCount: 0,
    }))
    expect(compositionReport.selected?.directPathIds).toEqual(['path:public/book/BooksPath'])
    expect(compositionReport.selected?.transitiveComponentIds).toEqual(['schema:public/book/Book'])
    expect(compositionReport.output?.paths).toContainEqual(expect.objectContaining({
      canonicalId: 'path:public/book/BooksPath',
      openApiPath: '/books',
    }))
    expect(compositionReport.output?.components).toContainEqual(expect.objectContaining({
      canonicalId: 'schema:public/book/Book',
      outputPointer: '#/components/schemas/Book',
    }))
    expect(compositionReport.sourceRefs).toContainEqual(expect.objectContaining({
      sourceId: 'path:public/book/BooksPath',
      targetId: 'schema:public/book/Book',
      ref: 'oa://schema/public/book/Book',
    }))

    const provenance = readJson(provenancePath) as Record<string, {
      canonicalId?: string
      sourcePath?: string
      sourcePointer?: string
      contentHash?: string
    }>
    expect(Object.keys(provenance)).toEqual([
      '#/components/schemas/Book',
      '#/paths/~1books',
      '#/paths/~1books/get',
    ])
    expect(provenance['#/paths/~1books']).toEqual(expect.objectContaining({
      canonicalId: 'path:public/book/BooksPath',
      sourcePointer: '#/content',
      contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    }))
    expect(provenance['#/paths/~1books/get']).toEqual(expect.objectContaining({
      canonicalId: 'path:public/book/BooksPath',
      sourcePointer: '#/content/get',
    }))
    expect(provenance['#/components/schemas/Book']).toEqual(expect.objectContaining({
      canonicalId: 'schema:public/book/Book',
      sourcePointer: '#/content',
      contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    }))

    const metadataRegistry = readJson(metadataRegistryPath) as {
      schemaVersion?: string
      targetName?: string
      summary?: {
        entryCount?: number
        explicitTrackingIdCount?: number
        generatedTrackingIdCount?: number
        invalidTrackingIdCount?: number
        duplicateTrackingIdCount?: number
        duplicateStableKeyCount?: number
        duplicateOutputPointerCount?: number
      }
      duplicates?: {
        trackingIds?: unknown[]
        stableKeys?: unknown[]
        outputPointers?: unknown[]
      }
      entries?: Record<string, {
        pointer?: string
        canonicalId?: string
        kind?: string
        trackingId?: string
        trackingIdSource?: string
        identityKey?: string
        identitySource?: string
        stableKey?: string
        openApiPath?: string
        method?: string
        sourcePointer?: string
        refs?: Array<{ ref?: string; targetId?: string; sourcePointer?: string }>
        examples?: Array<{ sourcePointer?: string }>
        metadata?: Record<string, unknown>
      }>
    }
    expect(metadataRegistry.schemaVersion).toBe('oa-gen.metadata-registry.v1')
    expect(metadataRegistry.targetName).toBe('public-api')
    expect(metadataRegistry.summary).toEqual({
      entryCount: 3,
      explicitTrackingIdCount: 2,
      generatedTrackingIdCount: 1,
      invalidTrackingIdCount: 0,
      duplicateTrackingIdCount: 0,
      duplicateStableKeyCount: 0,
      duplicateOutputPointerCount: 0,
    })
    expect(metadataRegistry.duplicates).toEqual({
      trackingIds: [],
      stableKeys: [],
      outputPointers: [],
    })
    expect(Object.keys(metadataRegistry.entries ?? {})).toEqual([
      '#/components/schemas/Book',
      '#/paths/~1books',
      '#/paths/~1books/get',
    ])
    expect(metadataRegistry.entries?.['#/paths/~1books']).toEqual(expect.objectContaining({
      pointer: '#/paths/~1books',
      canonicalId: 'path:public/book/BooksPath',
      kind: 'path',
      openApiPath: '/books',
      sourcePointer: '#/content',
      trackingId: 'trk_books_path',
      trackingIdSource: 'explicit',
      identityKey: 'definition:path:public/book/BooksPath',
      identitySource: 'canonical',
      stableKey: expectedStableKey('definition:path:public/book/BooksPath'),
    }))
    expect(metadataRegistry.entries?.['#/paths/~1books/get']).toEqual(expect.objectContaining({
      pointer: '#/paths/~1books/get',
      canonicalId: 'path:public/book/BooksPath',
      kind: 'operation',
      openApiPath: '/books',
      method: 'get',
      sourcePointer: '#/content/get',
      trackingId: 'trk_books_list',
      trackingIdSource: 'explicit',
      identityKey: 'operation:path:public/book/BooksPath:get',
      identitySource: 'canonical',
      stableKey: expectedStableKey('operation:path:public/book/BooksPath:get'),
      metadata: { trackingId: 'trk_books_list', owner: 'catalog' },
    }))
    expect(metadataRegistry.entries?.['#/paths/~1books/get']?.refs).toContainEqual(expect.objectContaining({
      ref: 'oa://schema/public/book/Book',
      targetId: 'schema:public/book/Book',
      sourcePointer: '#/content/get/responses/200/content/application~1json/schema/items/$ref',
    }))
    expect(metadataRegistry.entries?.['#/paths/~1books/get']?.examples).toContainEqual({
      sourcePointer: '#/content/get/responses/200/content/application~1json/example',
    })
    expect(metadataRegistry.entries?.['#/components/schemas/Book']).toEqual(expect.objectContaining({
      pointer: '#/components/schemas/Book',
      canonicalId: 'schema:public/book/Book',
      kind: 'schema',
      trackingId: expectedGeneratedTrackingId(expectedStableKey('definition:schema:public/book/Book')),
      trackingIdSource: 'generated',
      identityKey: 'definition:schema:public/book/Book',
      identitySource: 'canonical',
      stableKey: expectedStableKey('definition:schema:public/book/Book'),
      componentSection: 'schemas',
      outputName: 'Book',
    }))
  })

  it('appends a succeeded behavior record when behavior logging is enabled', () => {
    writeTarget('public-api.yaml', targetConfig(['/books']))
    writeFragment('path/public/book/BooksPath.yaml', pathRefFixture('/books', 'oa://schema/public/book/Book'))
    writeFragment('schema/public/book/Book.yaml', bookFixture())

    const behaviorLogPath = join(tmpDir, 'out', 'behavior.jsonl')
    const result = runCli([
      'build-spec',
      '--target',
      join(tmpDir, 'targets', 'public-api.yaml'),
      '--behavior-log',
      behaviorLogPath,
    ])

    expect(result.status).toBe(0)
    expect(existsSync(behaviorLogPath)).toBe(true)

    const records = readJsonl(behaviorLogPath) as Array<{
      schemaVersion?: string
      behaviorType?: string
      status?: string
      components?: {
        actor?: { actorType?: string; actorId?: string }
        target?: { targetType?: string; targetName?: string }
        context?: { command?: string }
        decision?: { primarySignal?: string }
        result?: { valid?: boolean; errors?: number; errorCodes?: string[] }
        metrics?: { durationMs?: number }
      }
    }>

    expect(records).toHaveLength(1)
    expect(records[0]).toEqual(expect.objectContaining({
      schemaVersion: 'oa-gen.behavior-record.v1',
      behaviorType: 'build_openapi_target',
      status: 'succeeded',
      components: expect.objectContaining({
        actor: { actorType: 'system', actorId: 'oa-gen' },
        target: expect.objectContaining({ targetType: 'definition-target', targetName: 'public-api' }),
        context: expect.objectContaining({ command: 'build-spec' }),
        decision: expect.objectContaining({ primarySignal: 'build-valid' }),
        result: expect.objectContaining({ valid: true, errors: 0, errorCodes: [] }),
        metrics: expect.objectContaining({ durationMs: expect.any(Number) }),
      }),
    }))
  })

  it('appends a failed behavior record when build-spec returns diagnostics errors', () => {
    writeTarget('public-api.yaml', targetConfig(['/books']))
    writeFragment('path/public/book/BooksPath.yaml', pathRefFixture('/books', 'oa://schema/public/book/MissingBook'))

    const behaviorLogPath = join(tmpDir, 'out', 'behavior.jsonl')
    const result = runCli([
      'build-spec',
      '--target',
      join(tmpDir, 'targets', 'public-api.yaml'),
      '--behavior-log',
      behaviorLogPath,
    ])

    expect(result.status).toBe(1)
    expect(existsSync(behaviorLogPath)).toBe(true)

    const records = readJsonl(behaviorLogPath) as Array<{
      behaviorType?: string
      status?: string
      components?: {
        decision?: { primarySignal?: string }
        result?: { valid?: boolean; errorCodes?: string[] }
      }
    }>

    expect(records).toHaveLength(1)
    expect(records[0]).toEqual(expect.objectContaining({
      behaviorType: 'build_openapi_target',
      status: 'failed',
      components: expect.objectContaining({
        decision: expect.objectContaining({
          primarySignal: 'build-invalid',
        }),
        result: expect.objectContaining({
          valid: false,
          errorCodes: expect.arrayContaining(['definition-registry/missing-ref']),
        }),
      }),
    }))
  })

  it('persists a succeeded behavior record to SQLite when behavior-db is enabled', () => {
    writeTarget('public-api.yaml', targetConfig(['/books']))
    writeFragment('path/public/book/BooksPath.yaml', pathRefFixture('/books', 'oa://schema/public/book/Book'))
    writeFragment('schema/public/book/Book.yaml', bookFixture())

    const behaviorDbPath = join(tmpDir, 'out', 'behavior.sqlite')
    const result = runCli([
      'build-spec',
      '--target',
      join(tmpDir, 'targets', 'public-api.yaml'),
      '--behavior-db',
      behaviorDbPath,
    ])

    expect(result.status).toBe(0)
    expect(existsSync(behaviorDbPath)).toBe(true)

    const sqlite = loadSqliteDriver().open(behaviorDbPath)
    try {
      const rows = sqlite.prepare(`
        SELECT behavior_type, status
        FROM behavior_records
        ORDER BY occurred_at
      `).all()
      expect(rows).toEqual([
        expect.objectContaining({
          behavior_type: 'build_openapi_target',
          status: 'succeeded',
        }),
      ])
    } finally {
      sqlite.close()
    }
  })

  it('keeps generated metadata identity stable when output component aliases change', () => {
    writeTarget('public-api.yaml', targetConfig(['/books']))
    writeTarget('renamed-api.yaml', {
      ...targetConfig(['/books']),
      namingPolicy: {
        aliases: {
          'schema:public/book/Book': 'CatalogBook',
        },
      },
    })
    writeFragment('path/public/book/BooksPath.yaml', pathRefFixture('/books', 'oa://schema/public/book/Book'))
    writeFragment('schema/public/book/Book.yaml', bookFixture())

    const publicMetadataPath = join(tmpDir, 'out', 'public.metadata.json')
    const renamedMetadataPath = join(tmpDir, 'out', 'renamed.metadata.json')

    const publicResult = runCli([
      'build-spec',
      '--target',
      join(tmpDir, 'targets', 'public-api.yaml'),
      '--metadata-registry',
      publicMetadataPath,
    ])
    const renamedResult = runCli([
      'build-spec',
      '--target',
      join(tmpDir, 'targets', 'renamed-api.yaml'),
      '--metadata-registry',
      renamedMetadataPath,
    ])

    expect(publicResult.status).toBe(0)
    expect(renamedResult.status).toBe(0)

    const publicRegistry = readJson(publicMetadataPath) as {
      entries?: Record<string, { identityKey?: string; stableKey?: string; trackingId?: string; outputName?: string }>
    }
    const renamedRegistry = readJson(renamedMetadataPath) as {
      entries?: Record<string, { identityKey?: string; stableKey?: string; trackingId?: string; outputName?: string }>
    }

    const publicEntry = publicRegistry.entries?.['#/components/schemas/Book']
    const renamedEntry = renamedRegistry.entries?.['#/components/schemas/CatalogBook']
    expect(publicEntry).toEqual(expect.objectContaining({
      outputName: 'Book',
      identityKey: 'definition:schema:public/book/Book',
      stableKey: expectedStableKey('definition:schema:public/book/Book'),
      trackingId: expectedGeneratedTrackingId(expectedStableKey('definition:schema:public/book/Book')),
    }))
    expect(renamedEntry).toEqual(expect.objectContaining({
      outputName: 'CatalogBook',
      identityKey: publicEntry?.identityKey,
      stableKey: publicEntry?.stableKey,
      trackingId: publicEntry?.trackingId,
    }))
  })

  it('keeps generated metadata identity stable when path and schema content change', () => {
    writeTarget('public-api.yaml', targetConfig(['/books']))
    writeFragment('path/public/book/BooksPath.yaml', pathRefFixture('/books', 'oa://schema/public/book/Book'))
    writeFragment('schema/public/book/Book.yaml', bookFixture())

    const beforeMetadataPath = join(tmpDir, 'out', 'before.metadata.json')
    const beforeResult = runCli([
      'build-spec',
      '--target',
      join(tmpDir, 'targets', 'public-api.yaml'),
      '--metadata-registry',
      beforeMetadataPath,
    ])
    expect(beforeResult.status).toBe(0)

    writeTarget('public-api.yaml', targetConfig(['/catalog/books']))
    writeFragment('path/public/book/BooksPath.yaml', {
      id: 'path:public/book/BooksPath',
      metadata: { path: '/catalog/books' },
      content: {
        get: {
          summary: 'List catalog books',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: 'oa://schema/public/book/Book' },
                  },
                  example: [{ id: 'book-2', title: 'Changed' }],
                },
              },
            },
          },
        },
      },
    })
    writeFragment('schema/public/book/Book.yaml', {
      id: 'schema:public/book/Book',
      content: {
        type: 'object',
        required: ['id', 'title'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
        },
      },
    })

    const afterMetadataPath = join(tmpDir, 'out', 'after.metadata.json')
    const afterResult = runCli([
      'build-spec',
      '--target',
      join(tmpDir, 'targets', 'public-api.yaml'),
      '--metadata-registry',
      afterMetadataPath,
    ])
    expect(afterResult.status).toBe(0)

    const beforeRegistry = readJson(beforeMetadataPath) as {
      entries?: Record<string, {
        identityKey?: string
        stableKey?: string
        trackingId?: string
        contentHash?: string
        openApiPath?: string
        examples?: Array<{ sourcePointer?: string }>
      }>
    }
    const afterRegistry = readJson(afterMetadataPath) as typeof beforeRegistry

    const beforePath = beforeRegistry.entries?.['#/paths/~1books']
    const afterPath = afterRegistry.entries?.['#/paths/~1catalog~1books']
    expect(afterPath).toEqual(expect.objectContaining({
      openApiPath: '/catalog/books',
      identityKey: beforePath?.identityKey,
      stableKey: beforePath?.stableKey,
      trackingId: beforePath?.trackingId,
    }))
    expect(afterPath?.contentHash).not.toBe(beforePath?.contentHash)

    const beforeOperation = beforeRegistry.entries?.['#/paths/~1books/get']
    const afterOperation = afterRegistry.entries?.['#/paths/~1catalog~1books/get']
    expect(afterOperation).toEqual(expect.objectContaining({
      openApiPath: '/catalog/books',
      identityKey: beforeOperation?.identityKey,
      stableKey: beforeOperation?.stableKey,
      trackingId: beforeOperation?.trackingId,
    }))
    expect(afterOperation?.contentHash).not.toBe(beforeOperation?.contentHash)
    expect(afterOperation?.examples).toContainEqual({
      sourcePointer: '#/content/get/responses/200/content/application~1json/example',
    })

    const beforeSchema = beforeRegistry.entries?.['#/components/schemas/Book']
    const afterSchema = afterRegistry.entries?.['#/components/schemas/Book']
    expect(afterSchema).toEqual(expect.objectContaining({
      identityKey: beforeSchema?.identityKey,
      stableKey: beforeSchema?.stableKey,
      trackingId: beforeSchema?.trackingId,
    }))
    expect(afterSchema?.contentHash).not.toBe(beforeSchema?.contentHash)
  })

  it('keeps generated metadata identity stable across canonical id renames with metadata.replaces', () => {
    writeTarget('public-api.yaml', targetConfig(['/books']))
    writeFragment('path/public/book/BooksPath.yaml', pathRefFixture('/books', 'oa://schema/public/book/Book'))
    writeFragment('schema/public/book/Book.yaml', bookFixture())

    const beforeMetadataPath = join(tmpDir, 'out', 'before-rename.metadata.json')
    const beforeResult = runCli([
      'build-spec',
      '--target',
      join(tmpDir, 'targets', 'public-api.yaml'),
      '--metadata-registry',
      beforeMetadataPath,
    ])
    expect(beforeResult.status).toBe(0)

    writeFragment('path/public/book/BooksPath.yaml', pathRefFixture('/books', 'oa://schema/public/book/CatalogBook'))
    writeFragment('schema/public/book/Book.yaml', {
      id: 'schema:public/book/CatalogBook',
      metadata: {
        replaces: 'schema:public/book/Book',
      },
      content: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
        },
      },
    })

    const afterMetadataPath = join(tmpDir, 'out', 'after-rename.metadata.json')
    const afterResult = runCli([
      'build-spec',
      '--target',
      join(tmpDir, 'targets', 'public-api.yaml'),
      '--metadata-registry',
      afterMetadataPath,
    ])
    expect(afterResult.status).toBe(0)

    const beforeRegistry = readJson(beforeMetadataPath) as {
      entries?: Record<string, { identityKey?: string; identitySource?: string; stableKey?: string; trackingId?: string }>
    }
    const afterRegistry = readJson(afterMetadataPath) as {
      entries?: Record<string, {
        identityKey?: string
        identitySource?: string
        stableKey?: string
        trackingId?: string
        replaces?: string[]
      }>
    }
    const beforeSchema = beforeRegistry.entries?.['#/components/schemas/Book']
    const afterSchema = afterRegistry.entries?.['#/components/schemas/CatalogBook']
    expect(beforeSchema).toEqual(expect.objectContaining({
      identityKey: 'definition:schema:public/book/Book',
      identitySource: 'canonical',
    }))
    expect(afterSchema).toEqual(expect.objectContaining({
      identityKey: 'definition:schema:public/book/Book',
      identitySource: 'replacement',
      stableKey: beforeSchema?.stableKey,
      trackingId: beforeSchema?.trackingId,
      replaces: ['schema:public/book/Book'],
    }))
  })

  it('inherits path-level replacement identity for operation metadata entries', () => {
    writeTarget('public-api.yaml', targetConfig(['/books']))
    writeFragment('path/public/book/BooksPath.yaml', {
      id: 'path:public/book/BooksPath',
      metadata: { path: '/books' },
      content: {
        get: {
          operationId: 'listBooks',
          responses: {
            '200': {
              description: 'OK',
            },
          },
        },
      },
    })

    const beforeMetadataPath = join(tmpDir, 'out', 'before-path-rename.metadata.json')
    const beforeResult = runCli([
      'build-spec',
      '--target',
      join(tmpDir, 'targets', 'public-api.yaml'),
      '--metadata-registry',
      beforeMetadataPath,
    ])
    expect(beforeResult.status).toBe(0)

    writeFragment('path/public/book/BooksPath.yaml', {
      id: 'path:public/book/CatalogBooksPath',
      metadata: {
        path: '/books',
        replaces: 'path:public/book/BooksPath',
      },
      content: {
        get: {
          operationId: 'listBooks',
          responses: {
            '200': {
              description: 'OK',
            },
          },
        },
      },
    })

    const afterMetadataPath = join(tmpDir, 'out', 'after-path-rename.metadata.json')
    const afterResult = runCli([
      'build-spec',
      '--target',
      join(tmpDir, 'targets', 'public-api.yaml'),
      '--metadata-registry',
      afterMetadataPath,
    ])
    expect(afterResult.status).toBe(0)

    const beforeRegistry = readJson(beforeMetadataPath) as {
      entries?: Record<string, {
        identityKey?: string
        identitySource?: string
        stableKey?: string
        trackingId?: string
      }>
    }
    const afterRegistry = readJson(afterMetadataPath) as {
      entries?: Record<string, {
        canonicalId?: string
        identityKey?: string
        identitySource?: string
        stableKey?: string
        trackingId?: string
        replaces?: string[]
      }>
    }

    const beforePath = beforeRegistry.entries?.['#/paths/~1books']
    const beforeOperation = beforeRegistry.entries?.['#/paths/~1books/get']
    const afterPath = afterRegistry.entries?.['#/paths/~1books']
    const afterOperation = afterRegistry.entries?.['#/paths/~1books/get']

    expect(beforePath).toEqual(expect.objectContaining({
      identityKey: 'definition:path:public/book/BooksPath',
      identitySource: 'canonical',
    }))
    expect(beforeOperation).toEqual(expect.objectContaining({
      identityKey: 'operation:path:public/book/BooksPath:get',
      identitySource: 'canonical',
    }))
    expect(afterPath).toEqual(expect.objectContaining({
      canonicalId: 'path:public/book/CatalogBooksPath',
      identityKey: beforePath?.identityKey,
      identitySource: 'replacement',
      stableKey: beforePath?.stableKey,
      trackingId: beforePath?.trackingId,
      replaces: ['path:public/book/BooksPath'],
    }))
    expect(afterOperation).toEqual(expect.objectContaining({
      canonicalId: 'path:public/book/CatalogBooksPath',
      identityKey: beforeOperation?.identityKey,
      identitySource: 'replacement',
      stableKey: beforeOperation?.stableKey,
      trackingId: beforeOperation?.trackingId,
      replaces: ['path:public/book/BooksPath'],
    }))
  })

  it('reports duplicate tracking IDs as metadata registry diagnostics', () => {
    writeTarget('public-api.yaml', targetConfig(['/books']))
    writeFragment('path/public/book/BooksPath.yaml', {
      id: 'path:public/book/BooksPath',
      metadata: {
        path: '/books',
        trackingId: 'trk_duplicate_books',
        operations: {
          get: {
            trackingId: 'trk_duplicate_books',
          },
        },
      },
      content: {
        get: {
          responses: {
            '200': { description: 'OK' },
          },
        },
      },
    })

    const outputPath = join(tmpDir, 'out', 'public-api.yaml')
    const diagnosticsPath = join(tmpDir, 'out', 'diagnostics.json')
    const metadataRegistryPath = join(tmpDir, 'out', 'metadata-registry.json')
    const result = runCli([
      'build-spec',
      '--target',
      join(tmpDir, 'targets', 'public-api.yaml'),
      '--output',
      outputPath,
      '--diagnostics',
      diagnosticsPath,
      '--metadata-registry',
      metadataRegistryPath,
    ])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('metadata-registry/duplicate-tracking-id')
    expect(existsSync(outputPath)).toBe(false)

    const diagnostics = readJson(diagnosticsPath) as {
      valid?: boolean
      summary?: { errors?: number }
      diagnostics?: Array<{ code?: string; trackingId?: string; pointers?: string[] }>
    }
    expect(diagnostics.valid).toBe(false)
    expect(diagnostics.summary?.errors).toBe(1)
    expect(diagnostics.diagnostics).toContainEqual(expect.objectContaining({
      code: 'metadata-registry/duplicate-tracking-id',
      trackingId: 'trk_duplicate_books',
      pointers: ['#/paths/~1books', '#/paths/~1books/get'],
    }))

    const metadataRegistry = readJson(metadataRegistryPath) as {
      summary?: {
        duplicateTrackingIdCount?: number
        duplicateStableKeyCount?: number
      }
      duplicates?: {
        trackingIds?: Array<{ trackingId?: string; entries?: Array<{ pointer?: string }> }>
        stableKeys?: unknown[]
      }
    }
    expect(metadataRegistry.summary).toEqual(expect.objectContaining({
      duplicateTrackingIdCount: 1,
      duplicateStableKeyCount: 0,
    }))
    expect(metadataRegistry.duplicates?.trackingIds).toEqual([
      {
        trackingId: 'trk_duplicate_books',
        entries: [
          expect.objectContaining({ pointer: '#/paths/~1books' }),
          expect.objectContaining({ pointer: '#/paths/~1books/get' }),
        ],
      },
    ])
    expect(metadataRegistry.duplicates?.stableKeys).toEqual([])
  })

  it('normalizes and validates explicit tracking IDs before duplicate checks', () => {
    writeTarget('public-api.yaml', targetConfig(['/books']))
    writeFragment('path/public/book/BooksPath.yaml', {
      id: 'path:public/book/BooksPath',
      metadata: {
        path: '/books',
        trackingId: ' trk_books_path ',
        operations: {
          get: {
            trackingId: 'TRK_BAD_OPERATION',
          },
        },
      },
      content: {
        get: {
          responses: {
            '200': { description: 'OK' },
          },
        },
      },
    })

    const outputPath = join(tmpDir, 'out', 'public-api.yaml')
    const diagnosticsPath = join(tmpDir, 'out', 'diagnostics.json')
    const metadataRegistryPath = join(tmpDir, 'out', 'metadata-registry.json')
    const result = runCli([
      'build-spec',
      '--target',
      join(tmpDir, 'targets', 'public-api.yaml'),
      '--output',
      outputPath,
      '--diagnostics',
      diagnosticsPath,
      '--metadata-registry',
      metadataRegistryPath,
    ])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('metadata-registry/invalid-tracking-id')
    expect(existsSync(outputPath)).toBe(false)

    const diagnostics = readJson(diagnosticsPath) as {
      diagnostics?: Array<{ code?: string; pointer?: string; value?: unknown }>
    }
    expect(diagnostics.diagnostics).toContainEqual(expect.objectContaining({
      code: 'metadata-registry/invalid-tracking-id',
      pointer: '#/paths/~1books/get',
      value: 'TRK_BAD_OPERATION',
    }))

    const metadataRegistry = readJson(metadataRegistryPath) as {
      summary?: { invalidTrackingIdCount?: number }
      entries?: Record<string, {
        trackingId?: string
        trackingIdSource?: string
        invalidTrackingId?: { value?: unknown; reason?: string }
      }>
    }
    expect(metadataRegistry.summary?.invalidTrackingIdCount).toBe(1)
    expect(metadataRegistry.entries?.['#/paths/~1books']).toEqual(expect.objectContaining({
      trackingId: 'trk_books_path',
      trackingIdSource: 'explicit',
    }))
    expect(metadataRegistry.entries?.['#/paths/~1books/get']?.invalidTrackingId).toEqual(expect.objectContaining({
      value: 'TRK_BAD_OPERATION',
    }))
  })

  it('preserves output pointer collisions in metadata registry diagnostics', () => {
    writeTarget('public-api.yaml', {
      name: 'public-api',
      scopes: ['public'],
      domains: ['book', 'catalog'],
      servers: [{ url: 'https://api.example.test' }],
      includePaths: ['/books'],
      namingPolicy: { aliases: {} },
    })
    writeFragment('path/public/book/BooksPath.yaml', {
      id: 'path:public/book/BooksPath',
      metadata: { path: '/books' },
      content: {
        get: {
          responses: { '200': { description: 'OK' } },
        },
      },
    })
    writeFragment('path/public/catalog/CatalogBooksPath.yaml', {
      id: 'path:public/catalog/CatalogBooksPath',
      metadata: { path: '/books' },
      content: {
        get: {
          responses: { '200': { description: 'OK' } },
        },
      },
    })

    const outputPath = join(tmpDir, 'out', 'public-api.yaml')
    const diagnosticsPath = join(tmpDir, 'out', 'diagnostics.json')
    const metadataRegistryPath = join(tmpDir, 'out', 'metadata-registry.json')
    const result = runCli([
      'build-spec',
      '--target',
      join(tmpDir, 'targets', 'public-api.yaml'),
      '--output',
      outputPath,
      '--diagnostics',
      diagnosticsPath,
      '--metadata-registry',
      metadataRegistryPath,
    ])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('definition-openapi-emit/path-collision')
    expect(result.stderr).toContain('metadata-registry/duplicate-output-pointer')
    expect(existsSync(outputPath)).toBe(false)

    const diagnostics = readJson(diagnosticsPath) as {
      diagnostics?: Array<{ code?: string; outputPointer?: string }>
    }
    expect(diagnostics.diagnostics).toContainEqual(expect.objectContaining({
      code: 'metadata-registry/duplicate-output-pointer',
      outputPointer: '#/paths/~1books',
    }))
    expect(diagnostics.diagnostics).toContainEqual(expect.objectContaining({
      code: 'metadata-registry/duplicate-output-pointer',
      outputPointer: '#/paths/~1books/get',
    }))

    const metadataRegistry = readJson(metadataRegistryPath) as {
      summary?: { duplicateOutputPointerCount?: number }
      duplicates?: {
        outputPointers?: Array<{ pointer?: string; entries?: Array<{ canonicalId?: string }> }>
      }
    }
    expect(metadataRegistry.summary?.duplicateOutputPointerCount).toBe(2)
    expect(metadataRegistry.duplicates?.outputPointers).toContainEqual(expect.objectContaining({
      pointer: '#/paths/~1books',
      entries: [
        expect.objectContaining({ canonicalId: 'path:public/book/BooksPath' }),
        expect.objectContaining({ canonicalId: 'path:public/catalog/CatalogBooksPath' }),
      ],
    }))
  })

  it('loads supplemental fragment refs for non-$ref dependency edges', () => {
    writeTarget('public-api.yaml', {
      name: 'public-api',
      scopes: ['shared', 'public'],
      domains: ['common', 'book'],
      servers: [{ url: 'https://api.example.test' }],
      includePaths: ['/books'],
      namingPolicy: {
        aliases: {
          'securityScheme:shared/common/BearerAuth': 'bearerAuth',
        },
      },
    })
    writeFragment('path/public/book/BooksPath.yaml', {
      id: 'path:public/book/BooksPath',
      metadata: { path: '/books' },
      refs: [
        {
          ref: 'oa://securityScheme/shared/common/BearerAuth',
          sourcePointer: '#/content/get/security/0/bearerAuth',
        },
      ],
      content: {
        get: {
          summary: 'List books',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': { description: 'OK' },
          },
        },
      },
    })
    writeFragment('securityScheme/shared/common/BearerAuth.yaml', {
      id: 'securityScheme:shared/common/BearerAuth',
      content: {
        type: 'http',
        scheme: 'bearer',
      },
    })

    const outputPath = join(tmpDir, 'out', 'public-api.yaml')
    const result = runCli([
      'build-spec',
      '--target',
      join(tmpDir, 'targets', 'public-api.yaml'),
      '--output',
      outputPath,
    ])

    expect(result.status).toBe(0)

    const document = parseYaml(readFileSync(outputPath, 'utf8')) as {
      paths?: Record<string, { get?: { security?: unknown } }>
      components?: { securitySchemes?: Record<string, unknown> }
    }
    expect(document.paths?.['/books']?.get?.security).toEqual([{ bearerAuth: [] }])
    expect(document.components?.securitySchemes).toEqual({
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
      },
    })
  })

  it('exits non-zero and reports duplicate canonical IDs', () => {
    writeTarget('public-api.yaml', targetConfig(['/books']))
    writeFragment('path/public/book/BooksPath.yaml', pathRefFixture('/books', 'oa://schema/public/book/Book'))
    writeFragment('schema/public/book/Book.yaml', bookFixture())
    writeFragment('schema/public/book/BookDuplicate.yaml', bookFixture())

    const outputPath = join(tmpDir, 'out', 'public-api.yaml')
    const diagnosticsPath = join(tmpDir, 'out', 'diagnostics.json')
    const result = runCli([
      'build-spec',
      '--target',
      join(tmpDir, 'targets', 'public-api.yaml'),
      '--output',
      outputPath,
      '--diagnostics',
      diagnosticsPath,
    ])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('definition-registry/duplicate-id')
    expect(existsSync(outputPath)).toBe(false)

    const diagnostics = readJson(diagnosticsPath) as { diagnostics?: Array<{ code?: string }> }
    expect(diagnostics.diagnostics?.some(diagnostic => diagnostic.code === 'definition-registry/duplicate-id'))
      .toBe(true)
  })

  it('exits non-zero and reports unresolved required refs', () => {
    writeTarget('public-api.yaml', targetConfig(['/books']))
    writeFragment('path/public/book/BooksPath.yaml', pathRefFixture('/books', 'oa://schema/public/book/Missing'))

    const diagnosticsPath = join(tmpDir, 'out', 'diagnostics.json')
    const result = runCli([
      'build-spec',
      '--target',
      join(tmpDir, 'targets', 'public-api.yaml'),
      '--diagnostics',
      diagnosticsPath,
    ])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('definition-registry/missing-ref')

    const diagnostics = readJson(diagnosticsPath) as { diagnostics?: Array<{ code?: string }> }
    expect(diagnostics.diagnostics?.some(diagnostic => diagnostic.code === 'definition-registry/missing-ref'))
      .toBe(true)
  })
})

function runCli(args: string[]): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: pkgDir,
    encoding: 'utf8',
    timeout: 15_000,
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  }
}

function targetConfig(includePaths: string[]) {
  return {
    name: 'public-api',
    scopes: ['public'],
    domains: ['book'],
    servers: [{ url: 'https://api.example.test' }],
    includePaths,
    namingPolicy: { aliases: {} },
  }
}

function pathRefFixture(path: string, ref: string) {
  return {
    id: 'path:public/book/BooksPath',
    metadata: { path },
    content: {
      get: {
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { $ref: ref },
              },
            },
          },
        },
      },
    },
  }
}

function bookFixture() {
  return {
    id: 'schema:public/book/Book',
    content: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
    },
  }
}

function writeTarget(relativePath: string, value: unknown): void {
  writeYaml(join(tmpDir, 'targets', relativePath), value)
}

function writeFragment(relativePath: string, value: unknown): void {
  writeYaml(join(tmpDir, 'fragments', relativePath), value)
}

function writeYaml(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, stringifyYaml(value), 'utf8')
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function readJsonl(filePath: string): unknown[] {
  return readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line))
}

function expectedStableKey(identityKey: string): string {
  const digest = createHash('sha256')
    .update('oa-gen.metadata-registry.stable-key.v1')
    .update('\0')
    .update(identityKey)
    .digest('hex')
  return `oa-meta:v1:${digest.slice(0, 32)}`
}

function expectedGeneratedTrackingId(stableKey: string): string {
  const digest = createHash('sha256')
    .update('oa-gen.metadata-registry.tracking-id.v1')
    .update('\0')
    .update(stableKey)
    .digest('hex')
  return `trk_${digest.slice(0, 16)}`
}
