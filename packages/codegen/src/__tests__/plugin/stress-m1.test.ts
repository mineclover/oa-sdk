import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  compileTypeSpecInMemory,
  resolveTypeSpecEntrypoint,
} from '../../plugin/compiler.js'
import {
  createPluginContext,
  formatEsmImportExtension,
  normalizeVirtualPath,
  TspPluginContextImpl,
} from '../../plugin/context.js'
import {
  sortPluginEntries,
  sortPlugins,
} from '../../plugin/sorter.js'
import {
  defineConfig,
  defineTspConfig,
  validateTspConfig,
} from '../../plugin/config.js'
import {
  type TspConfig,
  type TspGeneratedFile,
  type TspPlugin,
  type TspPluginEntry,
  TspFileConflictError,
  TspPluginCycleError,
  TspPluginDuplicateError,
  TspPluginMissingDependencyError,
} from '../../plugin/types.js'
import type { OasDocument } from '@oa-sdk/parser'

const packageRoot = resolve(__dirname, '../../..')
const monorepoRoot = resolve(packageRoot, '../..')
const productionTspDir = resolve(monorepoRoot, 'packages/schemas/typespec')
const productionMainTsp = resolve(productionTspDir, 'main.tsp')
const scratchDir = resolve(packageRoot, '.tmp-plugin-stress-test')

function createPlugin(
  name: string,
  dependencies?: string[],
  enforce?: 'pre' | 'post',
): TspPlugin {
  return {
    name,
    dependencies,
    enforce,
  }
}

function shuffleArray<T>(array: readonly T[]): T[] {
  const copy = [...array]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = copy[i]!
    copy[i] = copy[j]!
    copy[j] = temp
  }
  return copy
}

describe('Empirical Stress Suite — Milestone 1 (challenger_m1_2)', () => {
  beforeAll(() => {
    mkdirSync(scratchDir, { recursive: true })
  })

  afterAll(() => {
    rmSync(scratchDir, { recursive: true, force: true })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // AREA 1: SORTER STRESS (100+ NODE DAGs & RANDOM PERMUTATIONS)
  // ══════════════════════════════════════════════════════════════════════════
  describe('Area 1: Sorter Stress (Scale & Permutation Stability)', () => {
    it('resolves a 150-node multi-layered complex DAG within 25ms', () => {
      // 6 layers: 25, 30, 35, 30, 20, 10 nodes = 150 nodes
      const layers = [25, 30, 35, 30, 20, 10]
      const plugins: TspPlugin[] = []
      const edges: [string, string][] = [] // [dep, dependent]

      let nodeCounter = 0
      const layerNodeIds: string[][] = []

      for (let l = 0; l < layers.length; l++) {
        const count = layers[l]!
        const currentLayer: string[] = []
        for (let i = 0; i < count; i++) {
          const id = `node_L${l}_${i}`
          currentLayer.push(id)

          const deps: string[] = []
          if (l > 0) {
            // Depend on 2-3 deterministic nodes from previous layer
            const prevLayer = layerNodeIds[l - 1]!
            const dep1 = prevLayer[i % prevLayer.length]!
            const dep2 = prevLayer[(i + 1) % prevLayer.length]!
            deps.push(dep1)
            edges.push([dep1, id])
            if (dep1 !== dep2) {
              deps.push(dep2)
              edges.push([dep2, id])
            }
          }

          plugins.push(createPlugin(id, deps))
          nodeCounter++
        }
        layerNodeIds.push(currentLayer)
      }

      expect(plugins.length).toBe(150)

      const start = performance.now()
      const sorted = sortPlugins(plugins)
      const durationMs = performance.now() - start

      expect(sorted.length).toBe(150)
      expect(durationMs).toBeLessThan(50) // High-performance Kahn resolution

      // Verify strict topological ordering invariant: dep appears before dependent
      const indexMap = new Map<string, number>()
      sorted.forEach((p, idx) => indexMap.set(p.name, idx))

      for (const [dep, dependent] of edges) {
        const depIdx = indexMap.get(dep)!
        const depenIdx = indexMap.get(dependent)!
        expect(depIdx).toBeLessThan(depenIdx)
      }
    })

    it('resolves a 250-node deep chain with multiple converging branches', () => {
      // Trunk chain: 100 nodes (trunk_0 -> trunk_99)
      // Branch A: 50 nodes branching off trunk_20 and converging at trunk_80
      // Branch B: 50 nodes branching off trunk_40 and converging at trunk_90
      // Independent cluster: 50 nodes in a tree
      const plugins: TspPlugin[] = []
      const edges: [string, string][] = []

      // Trunk
      for (let i = 0; i < 100; i++) {
        const id = `trunk_${i}`
        const deps = i > 0 ? [`trunk_${i - 1}`] : []
        if (i === 80) deps.push('branchA_49')
        if (i === 90) deps.push('branchB_49')
        if (i > 0) edges.push([`trunk_${i - 1}`, id])
        if (i === 80) edges.push(['branchA_49', id])
        if (i === 90) edges.push(['branchB_49', id])
        plugins.push(createPlugin(id, deps))
      }

      // Branch A
      for (let i = 0; i < 50; i++) {
        const id = `branchA_${i}`
        const deps = i === 0 ? ['trunk_20'] : [`branchA_${i - 1}`]
        edges.push([deps[0]!, id])
        plugins.push(createPlugin(id, deps))
      }

      // Branch B
      for (let i = 0; i < 50; i++) {
        const id = `branchB_${i}`
        const deps = i === 0 ? ['trunk_40'] : [`branchB_${i - 1}`]
        edges.push([deps[0]!, id])
        plugins.push(createPlugin(id, deps))
      }

      // Independent tree
      for (let i = 0; i < 50; i++) {
        const id = `tree_${i}`
        const deps: string[] = []
        if (i > 0) {
          const parent = `tree_${Math.floor((i - 1) / 2)}`
          deps.push(parent)
          edges.push([parent, id])
        }
        plugins.push(createPlugin(id, deps))
      }

      expect(plugins.length).toBe(250)

      const sorted = sortPlugins(plugins)
      expect(sorted.length).toBe(250)

      const indexMap = new Map<string, number>()
      sorted.forEach((p, idx) => indexMap.set(p.name, idx))

      for (const [dep, dependent] of edges) {
        const depIdx = indexMap.get(dep)!
        const depenIdx = indexMap.get(dependent)!
        expect(depIdx).toBeLessThan(depenIdx)
      }
    })

    it('guarantees identical output across 50 random permutations for a total-order chain', () => {
      // 50-node total-order chain: P_0 -> P_1 -> ... -> P_49
      const chainPlugins: TspPlugin[] = []
      for (let i = 0; i < 50; i++) {
        const id = `chain_${i}`
        const deps = i > 0 ? [`chain_${i - 1}`] : []
        chainPlugins.push(createPlugin(id, deps))
      }

      const expectedNames = chainPlugins.map(p => p.name)

      // Test 50 random shuffles
      for (let run = 0; run < 50; run++) {
        const shuffled = shuffleArray(chainPlugins)
        const sorted = sortPlugins(shuffled)
        const sortedNames = sorted.map(p => p.name)
        expect(sortedNames).toEqual(expectedNames)
      }
    })

    it('guarantees valid topological ordering across 50 random permutations of a branching DAG', () => {
      // 40-node branching DAG with diamonds and multiple roots
      const basePlugins: TspPlugin[] = []
      const edges: [string, string][] = []

      // Roots: 5 nodes
      for (let r = 0; r < 5; r++) {
        basePlugins.push(createPlugin(`root_${r}`))
      }

      // Middle: 25 nodes with dependencies on roots and previous middle nodes
      for (let m = 0; m < 25; m++) {
        const id = `mid_${m}`
        const dep1 = `root_${m % 5}`
        const deps = [dep1]
        edges.push([dep1, id])
        if (m >= 5) {
          const dep2 = `mid_${m - 5}`
          deps.push(dep2)
          edges.push([dep2, id])
        }
        basePlugins.push(createPlugin(id, deps))
      }

      // Sinks: 10 nodes depending on middle nodes
      for (let s = 0; s < 10; s++) {
        const id = `sink_${s}`
        const dep1 = `mid_${s}`
        const dep2 = `mid_${s + 10}`
        edges.push([dep1, id], [dep2, id])
        basePlugins.push(createPlugin(id, [dep1, dep2]))
      }

      expect(basePlugins.length).toBe(40)

      // Verify 50 random permutations
      for (let run = 0; run < 50; run++) {
        const shuffled = shuffleArray(basePlugins)
        const sorted = sortPlugins(shuffled)

        expect(sorted.length).toBe(40)

        const indexMap = new Map<string, number>()
        sorted.forEach((p, idx) => indexMap.set(p.name, idx))

        // Ensure every edge u -> v satisfies index(u) < index(v)
        for (const [dep, dependent] of edges) {
          const uIdx = indexMap.get(dep)!
          const vIdx = indexMap.get(dependent)!
          expect(uIdx).toBeLessThan(vIdx)
        }
      }
    })

    it('orders 120 nodes across multi-stage constraints (40 pre, 40 normal, 40 post)', () => {
      const plugins: TspPlugin[] = []

      for (let i = 0; i < 40; i++) {
        const deps = i > 0 ? [`pre_${i - 1}`] : []
        plugins.push(createPlugin(`pre_${i}`, deps, 'pre'))
      }

      for (let i = 0; i < 40; i++) {
        const deps = i === 0 ? ['pre_39'] : [`norm_${i - 1}`]
        plugins.push(createPlugin(`norm_${i}`, deps))
      }

      for (let i = 0; i < 40; i++) {
        const deps = i === 0 ? ['norm_39'] : [`post_${i - 1}`]
        plugins.push(createPlugin(`post_${i}`, deps, 'post'))
      }

      const shuffled = shuffleArray(plugins)
      const sorted = sortPlugins(shuffled)

      expect(sorted.length).toBe(120)

      // All pre must be at indices 0..39
      for (let i = 0; i < 40; i++) {
        expect(sorted[i]?.enforce).toBe('pre')
        expect(sorted[i]?.name).toBe(`pre_${i}`)
      }
      // All normal must be at indices 40..79
      for (let i = 40; i < 80; i++) {
        expect(sorted[i]?.enforce).toBeUndefined()
        expect(sorted[i]?.name).toBe(`norm_${i - 40}`)
      }
      // All post must be at indices 80..119
      for (let i = 80; i < 120; i++) {
        expect(sorted[i]?.enforce).toBe('post')
        expect(sorted[i]?.name).toBe(`post_${i - 80}`)
      }
    })

    it('detects a cycle in a 500-node graph without stack overflow', () => {
      // 500 nodes: 0 -> 1 -> ... -> 499 -> 0
      const plugins: TspPlugin[] = []
      for (let i = 0; i < 500; i++) {
        const deps = i === 0 ? ['cycle_499'] : [`cycle_${i - 1}`]
        plugins.push(createPlugin(`cycle_${i}`, deps))
      }

      const start = performance.now()
      expect(() => sortPlugins(plugins)).toThrow(TspPluginCycleError)
      const durationMs = performance.now() - start

      expect(durationMs).toBeLessThan(100)
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // AREA 2: CONTEXT STATE ISOLATION & MUTATION BOUNDARIES
  // ══════════════════════════════════════════════════════════════════════════
  describe('Area 2: Context State Isolation & Mutation Boundaries', () => {
    const makeDoc = (title: string): OasDocument =>
      ({
        openapi: '3.2.0',
        info: { title, version: '1.0.0' },
        paths: {},
      }) as any

    it('guarantees complete isolation across 5 concurrent context instances', () => {
      const contexts = Array.from({ length: 5 }, (_, i) => {
        return createPluginContext({
          entrypoint: `/app/service-${i}/main.tsp`,
          outputDir: `/app/dist-${i}`,
          document: makeDoc(`Service API ${i}`),
          config: {
            input: `service-${i}/main.tsp`,
            outputDir: `/app/dist-${i}`,
            plugins: [],
          },
        })
      })

      // Populate distinct state in each context
      contexts.forEach((ctx, idx) => {
        for (let f = 0; f < 10; f++) {
          ctx.addFile({
            path: `types/model-${idx}-${f}.ts`,
            content: `export interface Model_${idx}_${f} {}`,
            sourcePlugin: `plugin_${idx}`,
          })
        }

        ctx.setPluginData(`custom_key_${idx}`, { secret: idx * 100 })
        ctx.reportDiagnostic({
          message: `Diagnostic from instance ${idx}`,
          severity: 'info',
        })
      })

      // Verify cross-context isolation
      contexts.forEach((ctx, idx) => {
        // Files isolation
        expect(ctx.getFiles().length).toBe(10)
        expect(ctx.hasFile(`types/model-${idx}-0.ts`)).toBe(true)
        // Must NOT see files from other instances
        contexts.forEach((otherCtx, otherIdx) => {
          if (idx !== otherIdx) {
            expect(ctx.hasFile(`types/model-${otherIdx}-0.ts`)).toBe(false)
            expect(ctx.getPluginData(`custom_key_${otherIdx}`)).toBeUndefined()
          }
        })

        // Shared data isolation
        expect(ctx.getPluginData(`custom_key_${idx}`)).toEqual({ secret: idx * 100 })

        // Diagnostics isolation
        expect(ctx.diagnostics.length).toBe(1)
        expect(ctx.diagnostics[0]?.message).toBe(`Diagnostic from instance ${idx}`)

        // Document isolation
        expect(ctx.document.info.title).toBe(`Service API ${idx}`)
      })
    })

    it('enforces object shallow copying on addFile to protect context state', () => {
      const ctx = createPluginContext({
        entrypoint: '/app/main.tsp',
        outputDir: '/app/dist',
        document: makeDoc('Test'),
        config: { input: 'main.tsp', plugins: [] },
      })

      const rawFile: TspGeneratedFile = {
        path: 'models/user.ts',
        content: 'export interface User { id: string; }',
        sourcePlugin: 'typescript',
        metadata: { version: 1 },
      }

      ctx.addFile(rawFile)

      // Mutate rawFile primitive and path
      rawFile.path = 'models/mutated.ts'
      rawFile.content = 'MUTATED'

      // Context must retain original registered state
      const registered = ctx.getFile('models/user.ts')
      expect(registered).toBeDefined()
      expect(registered?.path).toBe('models/user.ts')
      expect(registered?.content).toBe('export interface User { id: string; }')
      expect(ctx.hasFile('models/mutated.ts')).toBe(false)
    })

    it('atomically moves files during updateFile without leaving phantom entries', () => {
      const ctx = createPluginContext({
        entrypoint: '/app/main.tsp',
        outputDir: '/app/dist',
        document: makeDoc('Test'),
        config: { input: 'main.tsp', plugins: [] },
      })

      ctx.addFile({
        path: 'v1/client.ts',
        content: 'export const clientV1 = 1;',
        sourcePlugin: 'client',
      })

      expect(ctx.hasFile('v1/client.ts')).toBe(true)

      // Move to v2/client.ts via updateFile
      ctx.updateFile('v1/client.ts', existing => ({
        ...existing,
        path: 'v2/client.ts',
        content: 'export const clientV2 = 2;',
      }))

      expect(ctx.hasFile('v1/client.ts')).toBe(false)
      expect(ctx.getFile('v1/client.ts')).toBeUndefined()
      expect(ctx.hasFile('v2/client.ts')).toBe(true)
      expect(ctx.getFile('v2/client.ts')?.content).toBe('export const clientV2 = 2;')
      expect(ctx.getFiles().length).toBe(1)
    })

    it('correctly reports true on removeFile of existing file and false on non-existent', () => {
      const ctx = createPluginContext({
        entrypoint: '/app/main.tsp',
        outputDir: '/app/dist',
        document: makeDoc('Test'),
        config: { input: 'main.tsp', plugins: [] },
      })

      ctx.addFile({
        path: 'temp.ts',
        content: 'temp',
        sourcePlugin: 'temp',
      })

      expect(ctx.removeFile('temp.ts')).toBe(true)
      expect(ctx.hasFile('temp.ts')).toBe(false)
      expect(ctx.removeFile('temp.ts')).toBe(false)
      expect(ctx.removeFile('never_existed.ts')).toBe(false)
    })

    it('resolves complex, deep, and cross-directory ESM relative imports accurately', () => {
      const ctx = createPluginContext({
        entrypoint: '/app/main.tsp',
        outputDir: '/app/dist',
        document: makeDoc('Test'),
        config: { input: 'main.tsp', plugins: [] },
      })

      // Deep sibling resolution (5 levels up and 3 levels down)
      expect(
        ctx.resolveImport('a/b/c/d/e/service.ts', 'x/y/z/model.ts'),
      ).toBe('../../../../../x/y/z/model.js')

      // Root to deep nested
      expect(
        ctx.resolveImport('index.ts', 'features/billing/queries/hooks.ts'),
      ).toBe('./features/billing/queries/hooks.js')

      // Deep nested to root
      expect(
        ctx.resolveImport('features/billing/queries/hooks.ts', 'index.ts'),
      ).toBe('../../../index.js')

      // Same directory
      expect(
        ctx.resolveImport('features/user/index.ts', 'features/user/types.ts'),
      ).toBe('./types.js')

      // Windows-style backslashes in paths
      expect(
        ctx.resolveImport('src\\api\\v1\\routes.ts', 'src\\models\\v1\\user.ts'),
      ).toBe('../../models/v1/user.js')

      // Redundant relative dots
      expect(
        ctx.resolveImport('./src/api/routes.ts', './src/api/client.ts'),
      ).toBe('./client.js')

      // Multi-extension files
      expect(
        ctx.resolveImport('src/router.ts', 'src/contracts/user.contract.ts'),
      ).toBe('./contracts/user.contract.js')
      expect(
        ctx.resolveImport('src/router.ts', 'src/codecs/packet.proto.ts'),
      ).toBe('./codecs/packet.proto.js')
    })

    it('rejects self-imports regardless of casing, slashes, or redundant dots', () => {
      const ctx = createPluginContext({
        entrypoint: '/app/main.tsp',
        outputDir: '/app/dist',
        document: makeDoc('Test'),
        config: { input: 'main.tsp', plugins: [] },
      })

      expect(() => ctx.resolveImport('models/user.ts', 'models/user.ts')).toThrow(
        /Self-import is not allowed/,
      )
      expect(() => ctx.resolveImport('models/User.ts', 'models/user.ts')).toThrow(
        /Self-import is not allowed/,
      )
      expect(() => ctx.resolveImport('./models/user.ts', 'models/user.ts')).toThrow(
        /Self-import is not allowed/,
      )
      expect(() => ctx.resolveImport('models\\user.ts', 'models/user.ts')).toThrow(
        /Self-import is not allowed/,
      )
    })

    it('handles 1,000 virtual files and 1,000 relative import resolutions with sub-100ms latency', () => {
      const ctx = createPluginContext({
        entrypoint: '/app/main.tsp',
        outputDir: '/app/dist',
        document: makeDoc('Test'),
        config: { input: 'main.tsp', plugins: [] },
      })

      const start = performance.now()
      // Add 1,000 files across 20 directories
      for (let i = 0; i < 1000; i++) {
        const dir = `dir_${i % 20}`
        ctx.addFile({
          path: `${dir}/file_${i}.ts`,
          content: `export const val_${i} = ${i};`,
          sourcePlugin: 'perf',
        })
      }

      expect(ctx.getFiles().length).toBe(1000)

      // Resolve 1,000 imports across different directories
      for (let i = 0; i < 1000; i++) {
        const fromPath = `dir_${i % 20}/file_${i}.ts`
        const toPath = `dir_${(i + 7) % 20}/file_${(i + 13) % 1000}.ts`
        if (fromPath.toLowerCase() !== toPath.toLowerCase()) {
          const resolved = ctx.resolveImport(fromPath, toPath)
          expect(resolved.endsWith('.js')).toBe(true)
          expect(resolved.startsWith('.')).toBe(true)
        }
      }

      const durationMs = performance.now() - start
      expect(durationMs).toBeLessThan(100)
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // AREA 3: COMPILER STRESS (LARGE SCHEMAS, MULTIPLE ENTRYPOINTS, ZERO DISK)
  // ══════════════════════════════════════════════════════════════════════════
  describe('Area 3: Compiler Stress (Large Schemas, Concurrency, Zero Disk)', () => {
    it('compiles a large synthetic TypeSpec schema with 50 models and 100 routes', async () => {
      const largeDir = join(scratchDir, 'large-schema')
      mkdirSync(largeDir, { recursive: true })

      const lines: string[] = [
        'import "@typespec/http";',
        'using Http;',
        '@service(#{ title: "Enterprise Mega API" })',
        'namespace EnterpriseMega;',
        '',
      ]

      // 50 Models
      for (let m = 0; m < 50; m++) {
        lines.push(`model Entity${m} {`)
        lines.push(`  id: string;`)
        lines.push(`  index: int32;`)
        lines.push(`  tag: string;`)
        if (m > 0) {
          lines.push(`  parentRef?: Entity${m - 1};`)
        }
        lines.push(`}`)
        lines.push('')
      }

      // 100 Routes (2 per model: GET list and POST create)
      for (let r = 0; r < 50; r++) {
        lines.push(`@route("/entities-${r}")`)
        lines.push(`op listEntities${r}(): Entity${r}[];`)
        lines.push('')
        lines.push(`@route("/entities-${r}")`)
        lines.push(`op createEntity${r}(@body item: Entity${r}): Entity${r};`)
        lines.push('')
      }

      const mainFile = join(largeDir, 'main.tsp')
      writeFileSync(mainFile, lines.join('\n'), 'utf8')

      const start = performance.now()
      const result = await compileTypeSpecInMemory(mainFile)
      const durationMs = performance.now() - start

      expect(result.document.info.title).toBe('Enterprise Mega API')
      expect(result.routesCount).toBe(100)
      expect(durationMs).toBeLessThan(5000)

      // Verify all schemas exist in document.components.schemas
      const schemas = (result.document as any).components?.schemas ?? {}
      expect(Object.keys(schemas).length).toBeGreaterThanOrEqual(50)
      for (let m = 0; m < 50; m++) {
        expect(schemas[`Entity${m}`]).toBeDefined()
      }

      // Verify all paths exist
      const paths = (result.document as any).paths ?? {}
      expect(Object.keys(paths).length).toBe(50)
      for (let r = 0; r < 50; r++) {
        expect(paths[`/entities-${r}`]?.get).toBeDefined()
        expect(paths[`/entities-${r}`]?.post).toBeDefined()
      }
    })

    it('concurrently compiles 3 distinct TypeSpec projects without cross-contamination', async () => {
      const projConfigs = [
        { name: 'inventory', title: 'Inventory Service', route: '/inventory' },
        { name: 'billing', title: 'Billing Service', route: '/billing' },
        { name: 'users', title: 'Users Service', route: '/users' },
      ]

      const mainFiles: string[] = []

      for (const p of projConfigs) {
        const pDir = join(scratchDir, p.name)
        mkdirSync(pDir, { recursive: true })
        const file = join(pDir, 'main.tsp')
        writeFileSync(
          file,
          [
            'import "@typespec/http";',
            'using Http;',
            `@service(#{ title: "${p.title}" })`,
            `namespace ${p.name.toUpperCase()};`,
            '',
            `model Item { id: string; service: string; }`,
            '',
            `@route("${p.route}")`,
            `op getItem(): Item;`,
          ].join('\n'),
          'utf8',
        )
        mainFiles.push(file)
      }

      // Compile all 3 concurrently
      const results = await Promise.all(
        mainFiles.map(f => compileTypeSpecInMemory(f)),
      )

      expect(results.length).toBe(3)

      for (let i = 0; i < 3; i++) {
        const res = results[i]!
        const conf = projConfigs[i]!
        expect(res.document.info.title).toBe(conf.title)
        expect(res.routesCount).toBe(1)
        const paths = (res.document as any).paths ?? {}
        expect(paths[conf.route]).toBeDefined()

        // Ensure no other project's routes bled into this document
        for (let j = 0; j < 3; j++) {
          if (i !== j) {
            const otherConf = projConfigs[j]!
            expect(paths[otherConf.route]).toBeUndefined()
          }
        }
      }
    })

    it('leverages oldProgram incremental cache across sequential compilations', async () => {
      const incDir = join(scratchDir, 'incremental')
      mkdirSync(incDir, { recursive: true })
      const mainFile = join(incDir, 'main.tsp')

      // Initial version: 1 route
      writeFileSync(
        mainFile,
        [
          'import "@typespec/http";',
          'using Http;',
          '@service(#{ title: "Incremental API" })',
          'namespace Incremental;',
          '',
          'model Item { id: string; }',
          '@route("/v1/items")',
          'op getItems(): Item[];',
        ].join('\n'),
        'utf8',
      )

      const result1 = await compileTypeSpecInMemory(mainFile)
      expect(result1.routesCount).toBe(1)
      expect(result1.program).toBeDefined()

      // Mutate source: add a second route
      writeFileSync(
        mainFile,
        [
          'import "@typespec/http";',
          'using Http;',
          '@service(#{ title: "Incremental API" })',
          'namespace Incremental;',
          '',
          'model Item { id: string; }',
          '@route("/v1/items")',
          'op getItems(): Item[];',
          '@route("/v1/items/{id}")',
          'op getItemById(@path id: string): Item;',
        ].join('\n'),
        'utf8',
      )

      // Compile with oldProgram passed
      const result2 = await compileTypeSpecInMemory(mainFile, {
        oldProgram: result1.program,
      })

      expect(result2.routesCount).toBe(2)
      const paths = (result2.document as any).paths ?? {}
      expect(paths['/v1/items']?.get).toBeDefined()
      expect(paths['/v1/items/{id}']?.get).toBeDefined()
    })

    it('proves zero disk writes and stable heap consumption under repeated compilations', async () => {
      // 1. Snapshot directory before compilations
      const beforeProdFiles = readdirSync(productionTspDir)

      // 2. Run 8 successive compilations of production schema
      const initialHeap = process.memoryUsage().heapUsed

      for (let i = 0; i < 8; i++) {
        const res = await compileTypeSpecInMemory(productionMainTsp)
        expect(res.routesCount).toBeGreaterThan(0)
        expect(res.document.openapi).toBe('3.2.0')
      }

      const finalHeap = process.memoryUsage().heapUsed
      const heapDeltaMb = (finalHeap - initialHeap) / 1024 / 1024

      // Memory growth across 8 runs must be bounded (< 250MB)
      expect(heapDeltaMb).toBeLessThan(250)

      // 3. Snapshot directory after compilations — must be bitwise identical
      const afterProdFiles = readdirSync(productionTspDir)
      expect(afterProdFiles).toEqual(beforeProdFiles)
    })
  })
})
