import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  detectSpecFormat,
  buildDocumentFromOperations,
  parseSpecDocument,
  watchSpec,
  collectDirectoriesRecursively,
  IGNORED_DIRS,
} from '../cli/lib/spec-watcher.js'
import type { ExtractedOperation } from '@oa-sdk/parser'

const tmpBase = resolve(__dirname, '../../.tmp-spec-watcher-test')
let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpBase, `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

describe('detectSpecFormat', () => {
  it('identifies YAML formats (.yaml, .yml)', () => {
    expect(detectSpecFormat('openapi.yaml')).toBe('yaml')
    expect(detectSpecFormat('/path/to/spec.yml')).toBe('yaml')
    expect(detectSpecFormat('UPPER.YAML')).toBe('yaml')
  })

  it('identifies JSON format (.json)', () => {
    expect(detectSpecFormat('openapi.json')).toBe('json')
    expect(detectSpecFormat('/var/tmp/doc.JSON')).toBe('json')
  })

  it('identifies TypeScript formats (.ts, .tsx)', () => {
    expect(detectSpecFormat('routes.ts')).toBe('typescript')
    expect(detectSpecFormat('handlers.tsx')).toBe('typescript')
  })

  it('identifies TypeSpec format (.tsp)', () => {
    expect(detectSpecFormat('main.tsp')).toBe('typespec')
  })

  it('throws descriptive error on unsupported extensions', () => {
    expect(() => detectSpecFormat('schema.proto')).toThrow(/Unsupported specification file extension: \.proto/)
    expect(() => detectSpecFormat('README.md')).toThrow(/Unsupported specification file extension: \.md/)
    expect(() => detectSpecFormat('no-extension')).toThrow(/Unsupported specification file extension/)
  })
})

describe('buildDocumentFromOperations', () => {
  it('assembles a valid OpenAPI 3.2.0 document from ExtractedOperations with synthesized 200 mock response', () => {
    const mockOp = {
      method: 'get',
      path: '/api/v1/users/{id}',
      declarationName: 'getUserById',
      declarationKind: 'function',
      file: '/src/routes/users.ts',
      line: 10,
      column: 1,
      outputPointer: '#/paths/~1api~1v1~1users~1{id}/get',
      summary: 'Get user by ID',
      description: 'Fetch user details',
      deprecated: false,
      operationEntry: {
        operationId: 'getUserById',
        summary: 'Get user by ID',
        description: 'Fetch user details',
        tags: ['Users'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {},
        callbacks: {},
      },
    } as unknown as ExtractedOperation

    const doc = buildDocumentFromOperations([mockOp], '/src/routes/users.ts')

    expect(doc.openapi).toBe('3.2.0')
    expect(doc.info.title).toBe('Mock from /src/routes/users.ts')
    expect(doc.paths).toBeDefined()
    expect(doc.paths!['/api/v1/users/{id}']).toBeDefined()

    const getOp = (doc.paths!['/api/v1/users/{id}'] as any).get
    expect(getOp).toBeDefined()
    expect(getOp.operationId).toBe('getUserById')
    expect(getOp.summary).toBe('Get user by ID')
    expect(getOp.description).toBe('Fetch user details')
    expect(getOp.tags).toEqual(['Users'])
    expect(getOp.parameters).toHaveLength(1)
    expect(getOp.parameters[0].name).toBe('id')

    // Synthesized default 200 response
    expect(getOp.responses['200']).toBeDefined()
    expect(getOp.responses['200'].content['application/json'].example).toEqual({
      status: 'ok',
      operationId: 'getUserById',
      method: 'GET',
      path: '/api/v1/users/{id}',
    })
  })

  it('preserves user-defined responses when specified in operationEntry', () => {
    const mockOp = {
      method: 'post',
      path: '/api/v1/tasks',
      declarationName: 'createTask',
      declarationKind: 'function',
      file: '/src/routes/tasks.ts',
      line: 25,
      column: 1,
      outputPointer: '#/paths/~1api~1v1~1tasks/post',
      operationEntry: {
        operationId: 'createTask',
        tags: ['Tasks'],
        parameters: [],
        responses: {
          '201': {
            description: 'Task created',
            content: {
              'application/json': {
                schema: { type: 'object' },
                example: { id: 'task-123', done: false },
              },
            },
          },
        },
        callbacks: {},
      },
    } as unknown as ExtractedOperation

    const doc = buildDocumentFromOperations([mockOp])
    const postOp = (doc.paths!['/api/v1/tasks'] as any).post
    expect(postOp.responses['201']).toBeDefined()
    expect(postOp.responses['200']).toBeUndefined()
  })

  it('supports multiple operations on the same path with different HTTP methods', () => {
    const getOp = {
      method: 'get',
      path: '/items',
      declarationName: 'getItems',
      declarationKind: 'function',
      file: '/src/items.ts',
      line: 1,
      column: 1,
      outputPointer: '#/paths/~1items/get',
      operationEntry: { tags: [], parameters: [], responses: {}, callbacks: {} },
    } as unknown as ExtractedOperation
    const postOp = {
      method: 'post',
      path: '/items',
      declarationName: 'createItem',
      declarationKind: 'function',
      file: '/src/items.ts',
      line: 10,
      column: 1,
      outputPointer: '#/paths/~1items/post',
      operationEntry: { tags: [], parameters: [], responses: {}, callbacks: {} },
    } as unknown as ExtractedOperation

    const doc = buildDocumentFromOperations([getOp, postOp])
    expect(doc.paths).toBeDefined()
    expect(doc.paths!['/items']).toBeDefined()
    expect((doc.paths!['/items'] as any).get).toBeDefined()
    expect((doc.paths!['/items'] as any).post).toBeDefined()
  })
})

describe('parseSpecDocument', () => {
  it('parses valid OpenAPI YAML document', async () => {
    const yamlPath = join(tmpDir, 'spec.yaml')
    writeFileSync(
      yamlPath,
      `
openapi: "3.2.0"
info:
  title: YAML API
  version: "1.0.0"
paths:
  /ping:
    get:
      operationId: ping
      responses:
        "200":
          description: OK
`,
    )

    const result = await parseSpecDocument(yamlPath)
    expect(result.format).toBe('yaml')
    expect(result.document.openapi).toBe('3.2.0')
    expect(result.document.info.title).toBe('YAML API')
    expect((result.document.paths?.['/ping'] as any)?.get?.operationId).toBe('ping')
  })

  it('parses valid OpenAPI JSON document', async () => {
    const jsonPath = join(tmpDir, 'spec.json')
    writeFileSync(
      jsonPath,
      JSON.stringify({
        openapi: '3.2.0',
        info: { title: 'JSON API', version: '1.0.0' },
        paths: {
          '/status': {
            get: {
              operationId: 'getStatus',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      }),
    )

    const result = await parseSpecDocument(jsonPath)
    expect(result.format).toBe('json')
    expect(result.document.openapi).toBe('3.2.0')
    expect((result.document.paths?.['/status'] as any)?.get?.operationId).toBe('getStatus')
  })

  it('extracts @oaOperation JSDoc annotations from TypeScript source file', async () => {
    const tsPath = join(tmpDir, 'routes.ts')
    writeFileSync(
      tsPath,
      `
/**
 * Get all projects.
 * @summary List projects
 * @oaOperation GET /api/v2/projects
 */
export function listProjects() {
  return []
}

/**
 * Create a new project.
 * @oaOperation POST /api/v2/projects
 */
export function createProject() {
  return {}
}
`,
    )

    const result = await parseSpecDocument(tsPath)
    expect(result.format).toBe('typescript')
    expect(result.document.openapi).toBe('3.2.0')
    expect((result.document.paths?.['/api/v2/projects'] as any)?.get).toBeDefined()
    expect((result.document.paths?.['/api/v2/projects'] as any)?.post).toBeDefined()
    expect((result.document.paths?.['/api/v2/projects'] as any)?.get?.operationId).toBe('listProjects')
    expect((result.document.paths?.['/api/v2/projects'] as any)?.get?.summary).toBe('List projects')
  })

  it('throws descriptive error on malformed YAML syntax', async () => {
    const brokenYaml = join(tmpDir, 'broken.yaml')
    writeFileSync(brokenYaml, 'openapi: "3.2.0"\n  paths:\n\tinvalid tab indentation')

    await expect(parseSpecDocument(brokenYaml)).rejects.toThrow(/Failed to parse OpenAPI YAML/)
  })

  it('throws descriptive error on malformed JSON syntax', async () => {
    const brokenJson = join(tmpDir, 'broken.json')
    writeFileSync(brokenJson, '{ openapi: "3.2.0", paths: { invalid json }')

    await expect(parseSpecDocument(brokenJson)).rejects.toThrow(/Failed to parse OpenAPI JSON/)
  })

  it('throws descriptive error on malformed @oaOperation annotations in TypeScript source', async () => {
    const brokenTs = join(tmpDir, 'broken-routes.ts')
    writeFileSync(
      brokenTs,
      `
/**
 * Missing leading slash
 * @oaOperation GET api/no-slash
 */
export function invalidRoute() {}
`,
    )

    await expect(parseSpecDocument(brokenTs)).rejects.toThrow(/Failed to extract @oaOperation annotations/)
  })
})

describe('watchSpec', () => {
  it('monitors target file, debounces rapid writes, and triggers onChange callback', async () => {
    const specPath = join(tmpDir, 'watch-spec.json')
    writeFileSync(
      specPath,
      JSON.stringify({
        openapi: '3.2.0',
        info: { title: 'Watch Initial', version: '1.0.0' },
        paths: { '/initial': { get: { operationId: 'getInitial', responses: {} } } },
      }),
    )

    let changeCount = 0
    let lastDoc: any = null

    await new Promise<void>((resolvePromise) => {
      const watcher = watchSpec(specPath, {
        debounceMs: 50,
        onChange: (doc) => {
          changeCount++
          lastDoc = doc
          watcher.close()
          resolvePromise()
        },
      })

      expect(watcher.targetFiles).toEqual([resolve(specPath)])
      expect(watcher.watchedDirs.length).toBeGreaterThan(0)

      // Rapidly write twice to test debouncing
      setTimeout(() => {
        writeFileSync(
          specPath,
          JSON.stringify({
            openapi: '3.2.0',
            info: { title: 'Watch Intermediate', version: '1.0.0' },
            paths: { '/intermediate': { get: { operationId: 'getIntermediate', responses: {} } } },
          }),
        )
      }, 20)

      setTimeout(() => {
        writeFileSync(
          specPath,
          JSON.stringify({
            openapi: '3.2.0',
            info: { title: 'Watch Final', version: '1.0.0' },
            paths: { '/final': { get: { operationId: 'getFinal', responses: {} } } },
          }),
        )
      }, 40)
    })

    expect(changeCount).toBe(1)
    expect(lastDoc?.info?.title).toBe('Watch Final')
    expect(lastDoc?.paths?.['/final']).toBeDefined()
  })

  it('isolates syntax errors and triggers onError without crashing or terminating watcher', async () => {
    const specPath = join(tmpDir, 'resilient-spec.yaml')
    writeFileSync(
      specPath,
      `
openapi: "3.2.0"
info:
  title: Resilient API
  version: "1.0.0"
paths:
  /alive:
    get:
      operationId: getAlive
      responses:
        "200":
          description: OK
`,
    )

    let errorReported = false
    let recovered = false

    await new Promise<void>((resolvePromise) => {
      const watcher = watchSpec(specPath, {
        debounceMs: 40,
        onChange: (doc) => {
          if (doc.paths?.['/recovered']) {
            recovered = true
            watcher.close()
            resolvePromise()
          }
        },
        onError: (err) => {
          expect(err).toBeDefined()
          errorReported = true
          // After error is isolated, write valid content to verify watcher is still active
          setTimeout(() => {
            writeFileSync(
              specPath,
              `
openapi: "3.2.0"
info:
  title: Resilient API Recovered
  version: "1.0.0"
paths:
  /recovered:
    get:
      operationId: getRecovered
      responses:
        "200":
          description: OK
`,
            )
          }, 30)
        },
      })

      // Step 1: Write broken syntax
      setTimeout(() => {
        writeFileSync(specPath, `openapi: "3.2.0"\n  paths:\n\tbroken tabs indentation`)
      }, 20)
    })

    expect(errorReported).toBe(true)
    expect(recovered).toBe(true)
  })

  it('cleans up watchers and pending timers on close()', async () => {
    const specPath = join(tmpDir, 'close-test.json')
    writeFileSync(
      specPath,
      JSON.stringify({
        openapi: '3.2.0',
        info: { title: 'Close Test', version: '1.0.0' },
        paths: {},
      }),
    )

    let changedAfterClose = false
    const watcher = watchSpec(specPath, {
      debounceMs: 50,
      onChange: () => {
        changedAfterClose = true
      },
    })

    // Immediately trigger a write and then close before debounce timer expires
    writeFileSync(
      specPath,
      JSON.stringify({
        openapi: '3.2.0',
        info: { title: 'Close Test Modified', version: '1.0.0' },
        paths: { '/modified': { get: { operationId: 'getModified', responses: {} } } },
      }),
    )

    watcher.close()

    // Wait past debounce duration to ensure no callback was fired
    await new Promise<void>((r) => setTimeout(r, 120))
    expect(changedAfterClose).toBe(false)
  })

  describe('Linux-Compatible File Watching Fallback & Directory Walker (R9)', () => {
    it('collectDirectoriesRecursively collects nested folders and ignores node_modules, .git, dist, .turbo, .next', () => {
      // Create nested directory tree
      const srcDir = join(tmpDir, 'src')
      const routesDir = join(srcDir, 'routes')
      const v1Dir = join(routesDir, 'v1')
      const nodeModulesDir = join(tmpDir, 'node_modules', 'some-pkg')
      const gitDir = join(tmpDir, '.git', 'objects')
      const distDir = join(tmpDir, 'dist', 'esm')
      const turboDir = join(tmpDir, '.turbo')
      const nextDir = join(tmpDir, '.next')

      mkdirSync(v1Dir, { recursive: true })
      mkdirSync(nodeModulesDir, { recursive: true })
      mkdirSync(gitDir, { recursive: true })
      mkdirSync(distDir, { recursive: true })
      mkdirSync(turboDir, { recursive: true })
      mkdirSync(nextDir, { recursive: true })

      const dirs = collectDirectoriesRecursively(tmpDir)

      expect(dirs).toContain(tmpDir)
      expect(dirs).toContain(srcDir)
      expect(dirs).toContain(routesDir)
      expect(dirs).toContain(v1Dir)

      // Ensure ignored directories are filtered out
      for (const d of dirs) {
        expect(d).not.toContain('node_modules')
        expect(d).not.toContain('.git')
        expect(d).not.toContain('dist')
        expect(d).not.toContain('.turbo')
        expect(d).not.toContain('.next')
      }
    })

    it('attaches individual watchers to each directory level when forceLinuxFallback is enabled', () => {
      const routesDir = join(tmpDir, 'routes')
      const v1Dir = join(routesDir, 'v1')
      mkdirSync(v1Dir, { recursive: true })

      const specFile = join(v1Dir, 'api.yaml')
      writeFileSync(
        specFile,
        `
openapi: "3.2.0"
info:
  title: Nested Linux API
  version: "1.0.0"
paths: {}
`,
      )

      const watcher = watchSpec(tmpDir, {
        forceLinuxFallback: true,
        debounceMs: 50,
        onChange: () => {},
      })

      try {
        expect(watcher.watchedDirs).toContain(tmpDir)
        expect(watcher.watchedDirs).toContain(routesDir)
        expect(watcher.watchedDirs).toContain(v1Dir)
      } finally {
        watcher.close()
      }
    })

    it('detects nested file modifications in subdirectories under Linux fallback mode', async () => {
      const routesDir = join(tmpDir, 'routes')
      const v1Dir = join(routesDir, 'v1')
      mkdirSync(v1Dir, { recursive: true })

      const specFile = join(v1Dir, 'api.yaml')
      writeFileSync(
        specFile,
        `
openapi: "3.2.0"
info:
  title: Linux Nested Test
  version: "1.0.0"
paths: {}
`,
      )

      let notified = false

      await new Promise<void>((resolvePromise) => {
        const watcher = watchSpec(tmpDir, {
          forceLinuxFallback: true,
          debounceMs: 50,
          onChange: (doc) => {
            if (doc.paths?.['/linux-nested']) {
              notified = true
              watcher.close()
              resolvePromise()
            }
          },
        })

        setTimeout(() => {
          writeFileSync(
            specFile,
            `
openapi: "3.2.0"
info:
  title: Linux Nested Test Modified
  version: "1.0.0"
paths:
  /linux-nested:
    get:
      operationId: getLinuxNested
      responses:
        "200":
          description: OK
`,
          )
        }, 50)
      })

      expect(notified).toBe(true)
    })

    it('dynamically attaches watcher to newly created subdirectories on rename event without throwing', () => {
      const watcher = watchSpec(tmpDir, {
        forceLinuxFallback: true,
        debounceMs: 50,
        onChange: () => {},
      })

      try {
        // Create a new subdirectory dynamically while watcher is active
        const newSubDir = join(tmpDir, 'newly-created-sub')
        mkdirSync(newSubDir, { recursive: true })

        // The watcher should remain active and clean up without errors
        expect(watcher.watchedDirs).toContain(tmpDir)
      } finally {
        watcher.close()
      }
    })
  })
})
