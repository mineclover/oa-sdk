import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import {
  sortPlugins,
  sortPluginEntries,
} from '../../plugin/sorter.js'
import {
  type TspPlugin,
  type TspPluginContext,
  type TspConfig,
  TspPluginCycleError,
  TspPluginDuplicateError,
  TspPluginMissingDependencyError,
  TspFileConflictError,
  TspConfigValidationError,
} from '../../plugin/types.js'
import {
  compileTypeSpecInMemory,
  resolveTypeSpecEntrypoint,
} from '../../plugin/compiler.js'
import {
  runTspPluginPipeline,
} from '../../plugin/runner.js'
import {
  renderOpenApiTsClient,
} from '../../plugin/client-renderer/openapi-ts-client.js'
import type { OasDocument } from '@oa-sdk/parser'

function makePlugin(
  name: string,
  dependencies: string[] = [],
  enforce?: 'pre' | 'post',
): TspPlugin {
  return {
    name,
    dependencies,
    ...(enforce ? { enforce } : {}),
  }
}

/**
 * Compiles generated client TypeScript code to ESM and dynamically imports it
 * to verify actual wire execution of the generated artifacts.
 */
async function loadGeneratedClientModule(tsCode: string, tempDir: string, suffix: string = 'fetch') {
  const transpiled = ts.transpileModule(tsCode, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText

  const filePath = resolve(tempDir, `generated-client-${suffix}.mjs`)
  writeFileSync(filePath, transpiled, 'utf8')
  return await import(`${pathToFileURL(filePath).href}?t=${Date.now()}_${Math.random()}`)
}

describe('Milestone 4 Adversarial Verification & Empirical Stress Suite', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'oa-sdk-adv-m4-'))
  })

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  // ══════════════════════════════════════════════════════════════════════════
  // AREA 1: KAHN TOPOLOGICAL SORTER & CYCLE DEFENSE ADVERSARIAL CHALLENGES
  // ══════════════════════════════════════════════════════════════════════════
  describe('Area 1: Kahn Topological Sorter & Graph Cycle Stress', () => {
    it('1.1: detects self-loop cycle (node depending on itself)', () => {
      const selfPlugin = makePlugin('self-node', ['self-node'])
      expect(() => sortPlugins([selfPlugin])).toThrow(TspPluginCycleError)

      try {
        sortPlugins([selfPlugin])
      } catch (err) {
        expect(err).toBeInstanceOf(TspPluginCycleError)
        const cycleErr = err as TspPluginCycleError
        expect(cycleErr.cycle).toContain('self-node')
        expect(cycleErr.message).toContain('self-node')
      }
    })

    it('1.2: detects direct 2-node cycle (A -> B and B -> A)', () => {
      const pA = makePlugin('A', ['B'])
      const pB = makePlugin('B', ['A'])
      expect(() => sortPlugins([pA, pB])).toThrow(TspPluginCycleError)
    })

    it('1.3: detects diamond graph with back-edge (Sink -> Root)', () => {
      // Root -> (Left, Right) -> Sink -> Root (closes cycle)
      const pRoot = makePlugin('root', ['sink'])
      const pLeft = makePlugin('left', ['root'])
      const pRight = makePlugin('right', ['root'])
      const pSink = makePlugin('sink', ['left', 'right'])

      expect(() => sortPlugins([pRoot, pLeft, pRight, pSink])).toThrow(TspPluginCycleError)
    })

    it('1.4: detects diamond graph with intermediate back-edge (Sink -> Left)', () => {
      // Root -> (Left, Right) -> Sink; Sink -> Left creates cycle between Left and Sink
      const pRoot = makePlugin('root', [])
      const pLeft = makePlugin('left', ['root', 'sink'])
      const pRight = makePlugin('right', ['root'])
      const pSink = makePlugin('sink', ['left', 'right'])

      expect(() => sortPlugins([pRoot, pLeft, pRight, pSink])).toThrow(TspPluginCycleError)
    })

    it('1.5: detects multiple disjoint cycles across independent subgraphs', () => {
      // Cycle 1: C1 <-> C2
      const pC1 = makePlugin('c1', ['c2'])
      const pC2 = makePlugin('c2', ['c1'])
      // Cycle 2: D1 <-> D2
      const pD1 = makePlugin('d1', ['d2'])
      const pD2 = makePlugin('d2', ['d1'])
      // Acyclic independent: OK1 -> OK2
      const pOK1 = makePlugin('ok1')
      const pOK2 = makePlugin('ok2', ['ok1'])

      expect(() => sortPlugins([pOK1, pOK2, pC1, pC2, pD1, pD2])).toThrow(TspPluginCycleError)
    })

    it('1.6: accurately resolves complex multi-branch diamond DAG without cycles', () => {
      // Root -> A, Root -> B
      // A -> C, B -> C
      // C -> D, C -> E
      // D -> Sink, E -> Sink
      const root = makePlugin('root')
      const a = makePlugin('a', ['root'])
      const b = makePlugin('b', ['root'])
      const c = makePlugin('c', ['a', 'b'])
      const d = makePlugin('d', ['c'])
      const e = makePlugin('e', ['c'])
      const sink = makePlugin('sink', ['d', 'e'])

      // Shuffled input
      const sorted = sortPlugins([sink, e, d, c, b, a, root])
      const names = sorted.map(p => p.name)

      expect(names.indexOf('root')).toBeLessThan(names.indexOf('a'))
      expect(names.indexOf('root')).toBeLessThan(names.indexOf('b'))
      expect(names.indexOf('a')).toBeLessThan(names.indexOf('c'))
      expect(names.indexOf('b')).toBeLessThan(names.indexOf('c'))
      expect(names.indexOf('c')).toBeLessThan(names.indexOf('d'))
      expect(names.indexOf('c')).toBeLessThan(names.indexOf('e'))
      expect(names.indexOf('d')).toBeLessThan(names.indexOf('sink'))
      expect(names.indexOf('e')).toBeLessThan(names.indexOf('sink'))
    })

    it('1.7: throws TspPluginMissingDependencyError with exact missing name in deep cascade', () => {
      const p1 = makePlugin('step1', ['missing-ancestor'])
      const p2 = makePlugin('step2', ['step1'])
      const p3 = makePlugin('step3', ['step2'])

      expect(() => sortPlugins([p3, p2, p1])).toThrow(TspPluginMissingDependencyError)
      try {
        sortPlugins([p3, p2, p1])
      } catch (err) {
        expect(err).toBeInstanceOf(TspPluginMissingDependencyError)
        const missErr = err as TspPluginMissingDependencyError
        expect(missErr.pluginName).toBe('step1')
        expect(missErr.missingDependency).toBe('missing-ancestor')
      }
    })

    it('1.8: identifies missing dependency when mixed with valid dependencies', () => {
      const pValid = makePlugin('valid-dep')
      const pTarget = makePlugin('target', ['valid-dep', 'non-existent-dep'])

      expect(() => sortPlugins([pValid, pTarget])).toThrow(TspPluginMissingDependencyError)
    })

    it('1.9: rejects duplicate plugin registrations immediately', () => {
      const p1 = makePlugin('dup-name')
      const p2 = makePlugin('dup-name')

      expect(() => sortPlugins([p1, p2])).toThrow(TspPluginDuplicateError)
    })

    it('1.10: enforces stage invariants (pre cannot depend on normal or post, normal cannot depend on post)', () => {
      const pre = makePlugin('pre-plug', ['norm-plug'], 'pre')
      const norm = makePlugin('norm-plug', [])
      expect(() => sortPlugins([pre, norm])).toThrow(TspPluginCycleError)

      const norm2 = makePlugin('norm-plug2', ['post-plug'])
      const post = makePlugin('post-plug', [], 'post')
      expect(() => sortPlugins([norm2, post])).toThrow(TspPluginCycleError)

      // Post depending on normal is valid
      const postValid = makePlugin('post-valid', ['norm-valid'], 'post')
      const normValid = makePlugin('norm-valid', [])
      const sorted = sortPlugins([postValid, normValid])
      expect(sorted.map(p => p.name)).toEqual(['norm-valid', 'post-valid'])
    })

    it('1.11: property-based stress oracle on randomly generated 50-node acyclic DAG', () => {
      const N = 50
      const plugins: TspPlugin[] = []
      const edges: [string, string][] = []

      for (let i = 0; i < N; i++) {
        const name = `node_${i}`
        const deps: string[] = []
        // Only depend on previous nodes (i > j) ensuring DAG is guaranteed acyclic
        for (let j = 0; j < i; j++) {
          if ((i * 37 + j * 17) % 7 === 0) {
            deps.push(`node_${j}`)
            edges.push([`node_${j}`, name])
          }
        }
        plugins.push(makePlugin(name, deps))
      }

      // Shuffle order
      const shuffled = [...plugins].sort(() => 0.5 - Math.random())
      const sorted = sortPlugins(shuffled)
      expect(sorted).toHaveLength(N)

      const positionMap = new Map<string, number>()
      sorted.forEach((p, idx) => positionMap.set(p.name, idx))

      // Verification oracle: Every edge (u -> v) must satisfy pos(u) < pos(v)
      for (const [from, to] of edges) {
        const fromPos = positionMap.get(from)!
        const toPos = positionMap.get(to)!
        expect(fromPos).toBeLessThan(toPos)
      }
    })

    it('1.12: property-based stress oracle on randomly generated DAG with injected back-edge', () => {
      const N = 30
      const plugins: TspPlugin[] = []

      for (let i = 0; i < N; i++) {
        const name = `node_${i}`
        const deps = i > 0 ? [`node_${i - 1}`] : []
        plugins.push(makePlugin(name, deps))
      }

      // Inject back-edge from node_0 to node_29 to form a cycle: 0 -> 29 -> 28 -> ... -> 1 -> 0
      plugins[0] = makePlugin('node_0', ['node_29'])

      expect(() => sortPlugins(plugins)).toThrow(TspPluginCycleError)
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // AREA 2: COMPILER DIAGNOSTIC HANDLING & INVALID TYPESPEC INPUTS
  // ══════════════════════════════════════════════════════════════════════════
  describe('Area 2: Compiler Diagnostics & Malformed TypeSpec', () => {
    it('2.1: rejects non-existent TypeSpec entrypoint with clean error', async () => {
      const nonExistent = resolve(tempDir, 'does-not-exist.tsp')
      await expect(compileTypeSpecInMemory(nonExistent)).rejects.toThrow(
        /TypeSpec input path does not exist/,
      )
    })

    it('2.2: rejects directory lacking main.tsp or index.tsp', async () => {
      await expect(compileTypeSpecInMemory(tempDir)).rejects.toThrow(
        /TypeSpec directory does not contain "main\.tsp" or "index\.tsp"/,
      )
    })

    it('2.3: captures syntax errors and propagates formatted diagnostics', async () => {
      const invalidTsp = resolve(tempDir, 'invalid.tsp')
      writeFileSync(invalidTsp, 'model Pet { id: ;;;; invalid syntax', 'utf8')

      await expect(compileTypeSpecInMemory(invalidTsp)).rejects.toThrow(
        /TypeSpec compilation failed:/,
      )

      try {
        await compileTypeSpecInMemory(invalidTsp)
      } catch (err: any) {
        expect(err.diagnostics).toBeDefined()
        expect(Array.isArray(err.diagnostics)).toBe(true)
        expect(err.diagnostics.length).toBeGreaterThan(0)
      }
    })

    it('2.4: captures semantic errors (unresolved model identifiers) cleanly', async () => {
      const semanticErrTsp = resolve(tempDir, 'semantic-error.tsp')
      writeFileSync(
        semanticErrTsp,
        `
        import "@typespec/http";
        using TypeSpec.Http;

        @service({ title: "Broken API" })
        namespace BrokenApi;

        @route("/items")
        op getItems(): NonExistentType;
        `,
        'utf8',
      )

      await expect(compileTypeSpecInMemory(semanticErrTsp)).rejects.toThrow(
        /TypeSpec compilation failed:/,
      )
    })

    it('2.5: pipeline runner captures error diagnostics and marks result.success = false', async () => {
      const dummyDoc = { openapi: '3.2.0', info: { title: 'T', version: '1' }, paths: {} } as OasDocument

      const failingPlugin: TspPlugin = {
        name: 'diagnostic-reporter',
        generate: (ctx: TspPluginContext) => {
          ctx.reportDiagnostic({
            severity: 'error',
            message: 'Custom synthetic plugin validation failure',
            plugin: 'diagnostic-reporter',
          })
        },
      }

      const result = await runTspPluginPipeline(
        {
          input: 'main.tsp',
          outputDir: tempDir,
          plugins: [failingPlugin],
          dryRun: true,
        },
        { document: dummyDoc },
      )

      expect(result.success).toBe(false)
      expect(result.diagnostics).toHaveLength(1)
      expect(result.diagnostics[0]?.severity).toBe('error')
      expect(result.diagnostics[0]?.message).toBe('Custom synthetic plugin validation failure')
    })

    it('2.6: pipeline runner preserves result.success = true for warnings and infos', async () => {
      const dummyDoc = { openapi: '3.2.0', info: { title: 'T', version: '1' }, paths: {} } as OasDocument

      const warningPlugin: TspPlugin = {
        name: 'warning-reporter',
        generate: (ctx: TspPluginContext) => {
          ctx.log('warn', 'Deprecated schema encountered')
          ctx.reportDiagnostic({
            message: 'Information log message',
            severity: 'info',
          })
        },
      }

      const result = await runTspPluginPipeline(
        {
          input: 'main.tsp',
          outputDir: tempDir,
          plugins: [warningPlugin],
          dryRun: true,
        },
        { document: dummyDoc },
      )

      expect(result.success).toBe(true)
      expect(result.diagnostics).toHaveLength(2)
      expect(result.diagnostics.some(d => d.severity === 'warning')).toBe(true)
      expect(result.diagnostics.some(d => d.severity === 'info')).toBe(true)
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // AREA 3: DRYRUN VS NON-DRYRUN VFS PERSISTENCE BOUNDARIES
  // ══════════════════════════════════════════════════════════════════════════
  describe('Area 3: DryRun vs Non-DryRun VFS Persistence Boundaries', () => {
    const dummyDoc = {
      openapi: '3.2.0',
      info: { title: 'Persistence Test', version: '1.0' },
      paths: {
        '/test': {
          get: {
            operationId: 'getTest',
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    } as unknown as OasDocument

    it('3.1: dryRun: true writes 0 bytes to disk and returns empty emittedFiles array', async () => {
      const outDir = join(tempDir, 'dry-run-output')

      const writingPlugin: TspPlugin = {
        name: 'writer',
        generate: (ctx: TspPluginContext) => {
          ctx.addFile({
            path: 'output.ts',
            content: 'export const hello = "world";',
            sourcePlugin: 'writer',
          })
          ctx.addFile({
            path: 'sub/nested.ts',
            content: 'export const nested = 42;',
            sourcePlugin: 'writer',
          })
        },
      }

      const result = await runTspPluginPipeline(
        {
          input: 'main.tsp',
          outputDir: outDir,
          plugins: [writingPlugin],
          dryRun: true,
        },
        { document: dummyDoc },
      )

      expect(result.success).toBe(true)
      expect(result.files).toHaveLength(2)
      expect(result.emittedFiles).toHaveLength(0)
      // Disk verification: output directory must NOT have been created
      expect(existsSync(outDir)).toBe(false)
    })

    it('3.2: non-dryRun writes non-virtual files and skips virtual files', async () => {
      const outDir = join(tempDir, 'actual-output')

      const hybridPlugin: TspPlugin = {
        name: 'hybrid',
        generate: (ctx: TspPluginContext) => {
          ctx.addFile({
            path: 'physical.ts',
            content: 'export const physical = true;',
            sourcePlugin: 'hybrid',
            isVirtual: false,
          })
          ctx.addFile({
            path: 'virtual-only.ts',
            content: 'export const virtual = true;',
            sourcePlugin: 'hybrid',
            isVirtual: true,
          })
        },
      }

      const result = await runTspPluginPipeline(
        {
          input: 'main.tsp',
          outputDir: outDir,
          plugins: [hybridPlugin],
          dryRun: false,
        },
        { document: dummyDoc },
      )

      expect(result.success).toBe(true)
      expect(result.files).toHaveLength(2)
      expect(result.emittedFiles).toHaveLength(1)
      expect(result.emittedFiles[0]).toBe(resolve(outDir, 'physical.ts'))

      // Disk inspection
      expect(existsSync(resolve(outDir, 'physical.ts'))).toBe(true)
      expect(existsSync(resolve(outDir, 'virtual-only.ts'))).toBe(false)

      const fileContent = readFileSync(resolve(outDir, 'physical.ts'), 'utf8')
      expect(fileContent).toContain('export const physical = true;')
      expect(fileContent).toContain('// @generated by @oa-sdk/codegen')
    })

    it('3.3: throws TspFileConflictError when two distinct plugins write to the same path', async () => {
      const pluginA: TspPlugin = {
        name: 'plugin-a',
        generate: (ctx: TspPluginContext) => {
          ctx.addFile({ path: 'shared.ts', content: 'const a = 1;', sourcePlugin: 'plugin-a' })
        },
      }

      const pluginB: TspPlugin = {
        name: 'plugin-b',
        dependencies: ['plugin-a'],
        generate: (ctx: TspPluginContext) => {
          ctx.addFile({ path: 'shared.ts', content: 'const b = 2;', sourcePlugin: 'plugin-b' })
        },
      }

      await expect(
        runTspPluginPipeline(
          {
            input: 'main.tsp',
            outputDir: tempDir,
            plugins: [pluginA, pluginB],
            dryRun: true,
          },
          { document: dummyDoc },
        ),
      ).rejects.toThrow(TspFileConflictError)
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // AREA 4: OPENAPI-TS CLIENT SDK CONTRACTS & DISCRIMINATED UNIONS
  // ══════════════════════════════════════════════════════════════════════════
  describe('Area 4: openapi-ts Client SDK Discriminated Unions & HTTP Edge Cases', () => {
    const fullSpecDoc: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/items/{itemId}': {
          get: {
            operationId: 'items_getItem',
            parameters: [
              { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } },
            ],
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { schema: { type: 'object' } } },
              },
              '404': {
                description: 'Not Found',
                content: { 'application/json': { schema: { type: 'object' } } },
              },
            },
          },
          delete: {
            operationId: 'items_deleteItem',
            parameters: [
              { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } },
            ],
            responses: {
              '204': { description: 'Deleted' },
            },
          },
        },
        '/items': {
          post: {
            operationId: 'items_createItem',
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { type: 'object' } } },
            },
            responses: {
              '201': {
                description: 'Created',
                content: { 'application/json': { schema: { type: 'object' } } },
              },
              '422': {
                description: 'Unprocessable',
                content: { 'application/json': { schema: { type: 'object' } } },
              },
            },
          },
        },
      },
    }

    it('4.1: discriminated union narrowing for 200 OK vs 422 Unprocessable vs 500 Crash', async () => {
      const { code } = renderOpenApiTsClient({
        document: fullSpecDoc,
        httpClient: 'fetch',
      })

      const clientModule = await loadGeneratedClientModule(code, tempDir, 'fetch-du')
      const { Client } = clientModule

      interface Item { id: string; name: string }
      interface ValidationError { message: string; fieldErrors: Record<string, string> }

      const mockFetch = vi.fn()
      const client = new Client({ baseUrl: 'https://api.example.com', fetch: mockFetch })

      // Case A: 200 OK -> narrows to data
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'item-1', name: 'Widget' }), { status: 200 }),
      )
      const res200 = await client.get({ url: '/items/item-1' })

      if (res200.error) {
        expect.fail('Expected 200 OK to narrow to data branch')
      } else {
        expect(res200.data.id).toBe('item-1')
        expect(res200.data.name).toBe('Widget')
        expect(res200.response.status).toBe(200)
      }

      // Case B: 422 Validation Error -> narrows to error
      const valErrorPayload = {
        message: 'Invalid input',
        fieldErrors: { name: 'Name is required' },
      }
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(valErrorPayload), { status: 422 }),
      )
      const res422 = await client.post({ url: '/items', body: { name: '' } })

      if (res422.error) {
        expect(res422.data).toBeUndefined()
        expect(res422.error.fieldErrors.name).toBe('Name is required')
        expect(res422.response.status).toBe(422)
      } else {
        expect.fail('Expected 422 to narrow to error branch')
      }

      // Case C: 500 Internal Error -> narrows to error
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Database connection failed' }), { status: 500 }),
      )
      const res500 = await client.get({ url: '/items/item-1' })

      if (res500.error) {
        expect(res500.data).toBeUndefined()
        expect(res500.error.message).toBe('Database connection failed')
        expect(res500.response.status).toBe(500)
      } else {
        expect.fail('Expected 500 to narrow to error branch')
      }
    })

    it('4.2: handles 204 No Content with undefined data and undefined error', async () => {
      const { code } = renderOpenApiTsClient({
        document: fullSpecDoc,
        httpClient: 'fetch',
      })
      const clientModule = await loadGeneratedClientModule(code, tempDir, 'fetch-204')
      const { Client } = clientModule

      const mockFetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }))
      const client = new Client({ baseUrl: 'https://api.example.com', fetch: mockFetch })

      const res = await client.delete({ url: '/items/item-1' })
      expect(res.data).toBeUndefined()
      expect(res.error).toBeUndefined()
      expect(res.response.status).toBe(204)
    })

    it('4.3: handles 304 Not Modified as non-2xx cached response (data undefined)', async () => {
      const { code } = renderOpenApiTsClient({
        document: fullSpecDoc,
        httpClient: 'fetch',
      })
      const clientModule = await loadGeneratedClientModule(code, tempDir, 'fetch-304')
      const { Client } = clientModule

      const mockFetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 304 }))
      const client = new Client({ baseUrl: 'https://api.example.com', fetch: mockFetch })

      const res = await client.get({ url: '/items/item-1' })
      expect(res.data).toBeUndefined()
      expect(res.response.status).toBe(304)
    })

    it('4.4: throwOnError throws error on 4xx/5xx responses when enabled', async () => {
      const { code } = renderOpenApiTsClient({
        document: fullSpecDoc,
        httpClient: 'fetch',
      })
      const clientModule = await loadGeneratedClientModule(code, tempDir, 'fetch-throw')
      const { Client } = clientModule

      const mockFetch = vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
      )
      const client = new Client({ baseUrl: 'https://api.example.com', fetch: mockFetch })

      await expect(
        client.get({ url: '/admin', throwOnError: true }),
      ).rejects.toThrow(/HTTP Error 403/)
    })

    it('4.5: rejects immediately when pre-aborted AbortSignal is provided', async () => {
      const { code } = renderOpenApiTsClient({
        document: fullSpecDoc,
        httpClient: 'fetch',
      })
      const clientModule = await loadGeneratedClientModule(code, tempDir, 'fetch-abort-pre')
      const { Client } = clientModule

      const mockFetch = vi.fn()
      const client = new Client({ baseUrl: 'https://api.example.com', fetch: mockFetch })

      const controller = new AbortController()
      controller.abort() // Pre-aborted

      await expect(
        client.get({ url: '/items', signal: controller.signal }),
      ).rejects.toThrow()

      // Fetch should never have been invoked
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('4.6: aborts in-flight request when signal is triggered mid-flight', async () => {
      const { code } = renderOpenApiTsClient({
        document: fullSpecDoc,
        httpClient: 'fetch',
      })
      const clientModule = await loadGeneratedClientModule(code, tempDir, 'fetch-abort-mid')
      const { Client } = clientModule

      const controller = new AbortController()

      const mockFetch = vi.fn().mockImplementation((_url, init) => {
        return new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('The user aborted a request.', 'AbortError'))
          })
        })
      })

      const client = new Client({ baseUrl: 'https://api.example.com', fetch: mockFetch })
      const requestPromise = client.get({ url: '/slow-operation', signal: controller.signal })

      // Trigger abort while request is in flight
      setTimeout(() => controller.abort(), 10)

      await expect(requestPromise).rejects.toThrow(/aborted/)
    })

    it('4.7: sanitizes signal from query parameters and preserves special path parameters', async () => {
      const { code } = renderOpenApiTsClient({
        document: fullSpecDoc,
        httpClient: 'fetch',
      })
      const clientModule = await loadGeneratedClientModule(code, tempDir, 'fetch-sanitize')
      const { Client } = clientModule

      let capturedUrl = ''
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        capturedUrl = url
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      })

      const client = new Client({ baseUrl: 'https://api.example.com/', fetch: mockFetch })

      await client.get({
        url: '/users/{userId}/docs/{docId}',
        path: {
          userId: 'user 123', // contains space -> should encode to 'user%20123'
          docId: 'doc#456',   // contains hash -> should encode to 'doc%23456'
        },
        query: {
          filter: 'active',
          tags: ['alpha', 'beta'],
          signal: 'should-be-omitted' as any, // ensure query does NOT leak signal parameter
          empty: '',
          skipNull: undefined,
        },
      })

      expect(capturedUrl).toContain('/users/user%20123/docs/doc%23456')
      expect(capturedUrl).toContain('filter=active')
      expect(capturedUrl).toContain('tags=alpha&tags=beta')
      expect(capturedUrl).toContain('empty=')
      expect(capturedUrl).not.toContain('skipNull')
      // Critical check: signal parameter is NOT in query string
      expect(capturedUrl).not.toContain('signal=')
    })

    it('4.8: axios transport parity for 204 No Content, 422, 500 and URL path encoding', async () => {
      const { code } = renderOpenApiTsClient({
        document: fullSpecDoc,
        httpClient: 'axios',
      })
      const clientModule = await loadGeneratedClientModule(code, tempDir, 'axios-parity')
      const { Client } = clientModule

      const mockAxiosInstance = {
        request: vi.fn(),
      }

      const client = new Client({
        baseUrl: 'https://axios.example.com',
        axios: mockAxiosInstance,
      })

      // 1. 204 No Content
      mockAxiosInstance.request.mockResolvedValueOnce({
        status: 204,
        data: undefined,
        headers: {},
      })
      const res204 = await client.delete({ url: '/items/{id}', path: { id: 'item 1' } })
      expect(res204.data).toBeUndefined()
      expect(res204.error).toBeUndefined()
      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://axios.example.com/items/item%201',
          method: 'DELETE',
        }),
      )

      // 2. 422 Validation Error
      mockAxiosInstance.request.mockResolvedValueOnce({
        status: 422,
        data: { error: 'Invalid name' },
        headers: {},
      })
      const res422 = await client.post({ url: '/items', body: { name: '' } })
      expect(res422.data).toBeUndefined()
      expect(res422.error).toEqual({ error: 'Invalid name' })

      // 3. throwOnError on Axios
      mockAxiosInstance.request.mockResolvedValueOnce({
        status: 500,
        data: { message: 'Database crash' },
        headers: {},
      })
      await expect(
        client.get({ url: '/crash', throwOnError: true }),
      ).rejects.toThrow(/HTTP Error 500/)
    })

    it('4.9: code generation matches openapi-ts Hey API conventions', () => {
      const { code, exports } = renderOpenApiTsClient({
        document: fullSpecDoc,
        httpClient: 'fetch',
        standalone: true,
        clientClass: true,
      })

      // Verification of emitted signatures (both primary short name and prefixed alias)
      expect(exports).toContain('getItem')
      expect(exports).toContain('itemsGetItem')
      expect(exports).toContain('GetItemData')
      expect(exports).toContain('ItemsGetItemData')
      expect(exports).toContain('Client')
      expect(exports).toContain('createClient')
      expect(exports).toContain('RequestOptions')
      expect(exports).toContain('ClientResult')

      // Check single-object parameter signature in generated code
      expect(code).toContain('export async function getItem(')
      expect(code).toContain('options: RequestOptions<GetItemData>')
      expect(code).toContain('export const itemsGetItem = getItem;')
      expect(code).toContain('Promise<ClientResult<ItemsGetItemResponse, ItemsGetItemError>>')
    })
  })
})
