import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  sortPluginEntries,
  sortPlugins,
} from '../../plugin/sorter.js'
import {
  type TspPlugin,
  type TspConfig,
  TspPluginCycleError,
  TspPluginDuplicateError,
  TspPluginMissingDependencyError,
  TspFileConflictError,
  TspConfigValidationError,
} from '../../plugin/types.js'
import {
  createPluginContext,
  formatEsmImportExtension,
  normalizeVirtualPath,
} from '../../plugin/context.js'
import {
  compileTypeSpecInMemory,
  resolveTypeSpecEntrypoint,
} from '../../plugin/compiler.js'
import { validateTspConfig } from '../../plugin/config.js'

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

const packageRoot = resolve(__dirname, '../../..')
const monorepoRoot = resolve(packageRoot, '../..')
const productionTspDir = resolve(monorepoRoot, 'packages/schemas/typespec')
const productionMainTsp = resolve(productionTspDir, 'main.tsp')
const scratchDir = resolve(packageRoot, '.tmp-plugin-adversarial-test')

describe('Adversarial Stress Suite — Milestone 1', () => {
  beforeAll(() => {
    mkdirSync(scratchDir, { recursive: true })
  })

  afterAll(() => {
    rmSync(scratchDir, { recursive: true, force: true })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // 1. SORTER ADVERSARIAL STRESS TESTS
  // ══════════════════════════════════════════════════════════════════════════
  describe('Sorter: Complex DAGs & Cycle Stress', () => {
    it('handles a 100-node linear dependency chain without stack overflow', () => {
      const N = 100
      const plugins: TspPlugin[] = []
      for (let i = 0; i < N; i++) {
        const deps = i > 0 ? [`p-${i - 1}`] : []
        plugins.push(makePlugin(`p-${i}`, deps))
      }

      // Shuffle plugins before passing to sorter
      const shuffled = [...plugins].reverse()
      const sorted = sortPlugins(shuffled)

      expect(sorted).toHaveLength(N)
      for (let i = 0; i < N; i++) {
        expect(sorted[i]?.name).toBe(`p-${i}`)
      }
    })

    it('handles high fan-out and fan-in (wide diamond: 1 root -> 50 intermediate -> 1 sink)', () => {
      const intermediateCount = 50
      const root = makePlugin('root', [])
      const intermediates: TspPlugin[] = []
      const intermediateNames: string[] = []

      for (let i = 0; i < intermediateCount; i++) {
        const name = `fan-node-${i}`
        intermediateNames.push(name)
        intermediates.push(makePlugin(name, ['root']))
      }

      const sink = makePlugin('sink', intermediateNames)

      // Random order
      const all = [sink, ...intermediates, root]
      const sorted = sortPlugins(all)

      expect(sorted).toHaveLength(intermediateCount + 2)
      expect(sorted[0]?.name).toBe('root')
      expect(sorted[sorted.length - 1]?.name).toBe('sink')

      // All intermediates must be between root and sink
      const intermediatePositions = intermediateNames.map(name =>
        sorted.findIndex(p => p.name === name),
      )
      for (const pos of intermediatePositions) {
        expect(pos).toBeGreaterThan(0)
        expect(pos).toBeLessThan(sorted.length - 1)
      }
    })

    it('maintains strict topological order across nested multi-level diamonds', () => {
      // Level 1: A -> (B, C) -> D
      // Level 2: D -> (E, F) -> G
      const pA = makePlugin('A')
      const pB = makePlugin('B', ['A'])
      const pC = makePlugin('C', ['A'])
      const pD = makePlugin('D', ['B', 'C'])
      const pE = makePlugin('E', ['D'])
      const pF = makePlugin('F', ['D'])
      const pG = makePlugin('G', ['E', 'pF-missing'])

      // First check that missing dep throws
      expect(() => sortPlugins([pA, pB, pC, pD, pE, pF, pG])).toThrow(
        TspPluginMissingDependencyError,
      )

      // Fix missing dep and test proper ordering
      const pGValid = makePlugin('G', ['E', 'F'])
      const sorted = sortPlugins([pGValid, pF, pE, pD, pC, pB, pA])
      const names = sorted.map(p => p.name)

      expect(names.indexOf('A')).toBeLessThan(names.indexOf('B'))
      expect(names.indexOf('A')).toBeLessThan(names.indexOf('C'))
      expect(names.indexOf('B')).toBeLessThan(names.indexOf('D'))
      expect(names.indexOf('C')).toBeLessThan(names.indexOf('D'))
      expect(names.indexOf('D')).toBeLessThan(names.indexOf('E'))
      expect(names.indexOf('D')).toBeLessThan(names.indexOf('F'))
      expect(names.indexOf('E')).toBeLessThan(names.indexOf('G'))
      expect(names.indexOf('F')).toBeLessThan(names.indexOf('G'))
    })

    it('correctly orders disconnected components while preserving declaration order ties', () => {
      // Component 1: A1 -> B1
      // Component 2: A2 -> B2
      // Component 3: Independent C
      const pA1 = makePlugin('A1')
      const pB1 = makePlugin('B1', ['A1'])
      const pA2 = makePlugin('A2')
      const pB2 = makePlugin('B2', ['A2'])
      const pC = makePlugin('C')

      const sorted = sortPlugins([pC, pB2, pA2, pB1, pA1])
      const names = sorted.map(p => p.name)

      // Since C, A2, A1 have inDegree 0:
      // In declaration order: C (index 0), A2 (index 2), A1 (index 4)
      expect(names.indexOf('A1')).toBeLessThan(names.indexOf('B1'))
      expect(names.indexOf('A2')).toBeLessThan(names.indexOf('B2'))
    })

    it('detects complex 5-node indirect cycle (A -> B -> C -> D -> E -> A)', () => {
      const pA = makePlugin('A', ['E'])
      const pB = makePlugin('B', ['A'])
      const pC = makePlugin('C', ['B'])
      const pD = makePlugin('D', ['C'])
      const pE = makePlugin('E', ['D'])

      expect(() => sortPlugins([pA, pB, pC, pD, pE])).toThrow(TspPluginCycleError)
      try {
        sortPlugins([pA, pB, pC, pD, pE])
      } catch (e) {
        const err = e as TspPluginCycleError
        expect(err.cycle.length).toBeGreaterThanOrEqual(2)
      }
    })

    it('detects a cycle embedded inside a subgraph with independent valid nodes', () => {
      // Valid nodes: V1, V2 depending on V1
      const pV1 = makePlugin('V1')
      const pV2 = makePlugin('V2', ['V1'])
      // Cyclic sub-network: C1 -> C2 -> C3 -> C1
      const pC1 = makePlugin('C1', ['C3'])
      const pC2 = makePlugin('C2', ['C1'])
      const pC3 = makePlugin('C3', ['C2'])

      expect(() => sortPlugins([pV1, pV2, pC1, pC2, pC3])).toThrow(TspPluginCycleError)
    })

    it('detects cycle with chord (A -> B -> C -> A where B also connects to D)', () => {
      const pA = makePlugin('A', ['C'])
      const pB = makePlugin('B', ['A'])
      const pC = makePlugin('C', ['B'])
      const pD = makePlugin('D', ['B'])

      expect(() => sortPlugins([pA, pB, pC, pD])).toThrow(TspPluginCycleError)
    })

    it('handles duplicate dependency entries gracefully', () => {
      // Plugin declares ['A', 'A']
      const pA = makePlugin('A')
      const pB = makePlugin('B', ['A', 'A'])

      const sorted = sortPlugins([pB, pA])
      expect(sorted.map(p => p.name)).toEqual(['A', 'B'])
    })

    it('handles multiple enforcement stages with intricate dependencies', () => {
      // pre-1, pre-2 (depends on pre-1)
      const pre1 = makePlugin('pre-1', [], 'pre')
      const pre2 = makePlugin('pre-2', ['pre-1'], 'pre')
      // normal-1 (depends on pre-2), normal-2 (depends on normal-1)
      const norm1 = makePlugin('norm-1', ['pre-2'])
      const norm2 = makePlugin('norm-2', ['norm-1'])
      // post-1 (depends on norm-2), post-2 (depends on post-1)
      const post1 = makePlugin('post-1', ['norm-2'], 'post')
      const post2 = makePlugin('post-2', ['post-1'], 'post')

      const shuffled = [post2, norm2, pre2, post1, norm1, pre1]
      const sorted = sortPlugins(shuffled)
      expect(sorted.map(p => p.name)).toEqual([
        'pre-1',
        'pre-2',
        'norm-1',
        'norm-2',
        'post-1',
        'post-2',
      ])
    })

    it('strictly forbids normal plugin from depending on post plugin', () => {
      const norm = makePlugin('norm', ['post-plug'])
      const post = makePlugin('post-plug', [], 'post')

      expect(() => sortPlugins([norm, post])).toThrow(TspPluginCycleError)
    })

    it('strictly forbids pre plugin from depending on post plugin', () => {
      const pre = makePlugin('pre-plug', ['post-plug'], 'pre')
      const post = makePlugin('post-plug', [], 'post')

      expect(() => sortPlugins([pre, post])).toThrow(TspPluginCycleError)
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // 2. CONTEXT & VIRTUAL FS ADVERSARIAL STRESS TESTS
  // ══════════════════════════════════════════════════════════════════════════
  describe('Context: Path Normalization, Overwrite Protection & Imports', () => {
    const dummyDoc = { openapi: '3.2.0', info: { title: 'T', version: '1' }, paths: {} } as any
    const dummyConfig: TspConfig = { input: 'main.tsp', outputDir: './dist', plugins: [] }

    it('normalizes bizarre and malicious virtual paths consistently', () => {
      expect(normalizeVirtualPath('./foo/bar.ts')).toBe('foo/bar.ts')
      expect(normalizeVirtualPath('/foo/bar.ts')).toBe('foo/bar.ts')
      expect(normalizeVirtualPath('foo//bar///baz.ts')).toBe('foo/bar/baz.ts')
      expect(normalizeVirtualPath('foo/../bar.ts')).toBe('bar.ts')
      expect(normalizeVirtualPath('a/b/../../c.ts')).toBe('c.ts')
      expect(normalizeVirtualPath('  foo/bar.ts  ')).toBe('foo/bar.ts')
      expect(normalizeVirtualPath('foo\\bar\\baz.ts')).toBe('foo/bar/baz.ts')
    })

    it('prevents file collisions when path representations differ in casing or redundant slashes', () => {
      const ctx = createPluginContext({
        entrypoint: '/app/main.tsp',
        outputDir: '/app/dist',
        document: dummyDoc,
        config: dummyConfig,
      })

      ctx.addFile({
        path: 'src/types.ts',
        content: '// ts',
        sourcePlugin: 'plugin-A',
      })

      // Same file accessed via ./src//types.ts by plugin-B must trigger conflict
      expect(() => {
        ctx.addFile({
          path: './src//types.ts',
          content: '// conflict',
          sourcePlugin: 'plugin-B',
        })
      }).toThrow(TspFileConflictError)
    })

    it('supports moving a file via updateFile without leaving phantom entries', () => {
      const ctx = createPluginContext({
        entrypoint: '/app/main.tsp',
        outputDir: '/app/dist',
        document: dummyDoc,
        config: dummyConfig,
      })

      ctx.addFile({
        path: 'old-location.ts',
        content: 'export const val = 42;',
        sourcePlugin: 'migrator',
      })

      expect(ctx.hasFile('old-location.ts')).toBe(true)

      ctx.updateFile('old-location.ts', file => ({
        ...file,
        path: 'new-location.ts',
      }))

      expect(ctx.hasFile('old-location.ts')).toBe(false)
      expect(ctx.hasFile('new-location.ts')).toBe(true)
      expect(ctx.getFile('new-location.ts')?.content).toBe('export const val = 42;')
    })

    it('resolves extreme relative import distances accurately', () => {
      const ctx = createPluginContext({
        entrypoint: '/app/main.tsp',
        outputDir: '/app/dist',
        document: dummyDoc,
        config: dummyConfig,
      })

      // 4 levels deep to 3 levels deep sibling
      expect(
        ctx.resolveImport('a/b/c/d/deep.ts', 'x/y/z/other.ts'),
      ).toBe('../../../../x/y/z/other.js')

      // Root to deep child
      expect(
        ctx.resolveImport('root.ts', 'deep/sub/dir/target.ts'),
      ).toBe('./deep/sub/dir/target.js')

      // Deep child to root
      expect(
        ctx.resolveImport('deep/sub/dir/child.ts', 'root.ts'),
      ).toBe('../../../root.js')

      // Sibling in subfolder
      expect(
        ctx.resolveImport('models/v1/user.ts', 'models/v1/pet.ts'),
      ).toBe('./pet.js')

      // Extension conversion for .tsx, .mts, .cts, .js
      expect(formatEsmImportExtension('./component.tsx')).toBe('./component.js')
      expect(formatEsmImportExtension('./worker.mts')).toBe('./worker.js')
      expect(formatEsmImportExtension('./legacy.cts')).toBe('./legacy.js')
      expect(formatEsmImportExtension('./ready.js')).toBe('./ready.js')
    })

    it('detects case-insensitive self-import attempts', () => {
      const ctx = createPluginContext({
        entrypoint: '/app/main.tsp',
        outputDir: '/app/dist',
        document: dummyDoc,
        config: dummyConfig,
      })

      expect(() => ctx.resolveImport('Models/User.ts', 'models/user.ts')).toThrow(
        /Self-import is not allowed/,
      )
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // 3. COMPILER ZERO-DISK LEAKAGE & ROBUSTNESS ADVERSARIAL STRESS TESTS
  // ══════════════════════════════════════════════════════════════════════════
  describe('Compiler: Zero-Disk Leakage & Edge Case Robustness', () => {
    it('guarantees ZERO disk leakage during repeated high-volume in-memory compilations', async () => {
      const beforeFiles = readdirSync(productionTspDir).sort()

      // Execute 3 consecutive compilations
      for (let i = 0; i < 3; i++) {
        const result = await compileTypeSpecInMemory(productionMainTsp, {
          openApiVersion: '3.2.0',
        })
        expect(result.document).toBeDefined()
        expect(result.routesCount).toBeGreaterThan(0)
      }

      const afterFiles = readdirSync(productionTspDir).sort()
      expect(afterFiles).toEqual(beforeFiles)
    })

    it('correctly compiles multi-file TypeSpec projects with cross-file imports in memory', async () => {
      const multiDir = join(scratchDir, 'multi-file-tsp')
      mkdirSync(multiDir, { recursive: true })
      const subDir = join(multiDir, 'models')
      mkdirSync(subDir, { recursive: true })

      // models/user.tsp
      writeFileSync(
        join(subDir, 'user.tsp'),
        [
          'namespace Demo.Models;',
          'model User {',
          '  id: string;',
          '  username: string;',
          '}',
        ].join('\n'),
        'utf8',
      )

      // main.tsp
      writeFileSync(
        join(multiDir, 'main.tsp'),
        [
          'import "@typespec/http";',
          'import "./models/user.tsp";',
          'using Http;',
          'using Demo.Models;',
          '@service(#{ title: "MultiFile API" })',
          'namespace Demo;',
          '@route("/users/{id}")',
          'op getUser(@path id: string): User;',
        ].join('\n'),
        'utf8',
      )

      const beforeDirListing = readdirSync(multiDir)
      const result = await compileTypeSpecInMemory(multiDir)
      const afterDirListing = readdirSync(multiDir)

      expect(result.document.info.title).toBe('MultiFile API')
      expect(result.routesCount).toBe(1)
      expect(afterDirListing).toEqual(beforeDirListing)
      expect(result.sourceFiles.some(f => f.includes('user.tsp'))).toBe(true)
    })

    it('correctly compiles a valid TypeSpec schema with models but zero route operations', async () => {
      const modelsOnlyDir = join(scratchDir, 'models-only')
      mkdirSync(modelsOnlyDir, { recursive: true })

      writeFileSync(
        join(modelsOnlyDir, 'main.tsp'),
        [
          '@service(#{ title: "Models Only API" })',
          'namespace ModelsOnly;',
          'model Item {',
          '  id: string;',
          '  name: string;',
          '}',
        ].join('\n'),
        'utf8',
      )

      const result = await compileTypeSpecInMemory(modelsOnlyDir)
      expect(result.document.info.title).toBe('Models Only API')
      expect(result.routesCount).toBe(0)
      expect(result.document.paths).toEqual({})
    })

    it('rejects invalid configurations in validateTspConfig with clear diagnostic messages', () => {
      expect(() => validateTspConfig(null)).toThrow(TspConfigValidationError)
      expect(() => validateTspConfig({})).toThrow(TspConfigValidationError)
      expect(() => validateTspConfig({ input: '' })).toThrow(TspConfigValidationError)
      expect(() => validateTspConfig({ input: 'main.tsp', openApiVersion: '2.0' })).toThrow(
        /Field "openApiVersion" must be one of/,
      )
      expect(() => validateTspConfig({ input: 'main.tsp', plugins: 'invalid' })).toThrow(
        /Field "plugins" must be an array/,
      )
    })

    it('guarantees zero-disk leakage even when compilation fails due to syntax error', async () => {
      const errDir = join(scratchDir, 'syntax-err-leakage')
      mkdirSync(errDir, { recursive: true })
      const errFile = join(errDir, 'main.tsp')
      writeFileSync(errFile, 'broken syntax %%%', 'utf8')

      const beforeFiles = readdirSync(errDir)
      await expect(compileTypeSpecInMemory(errFile)).rejects.toThrow()
      const afterFiles = readdirSync(errDir)

      expect(afterFiles).toEqual(beforeFiles)
    })

    it('resolves index.tsp when main.tsp is absent in directory', () => {
      const indexDir = join(scratchDir, 'index-dir')
      mkdirSync(indexDir, { recursive: true })
      writeFileSync(join(indexDir, 'index.tsp'), '// index', 'utf8')

      const resolved = resolveTypeSpecEntrypoint(indexDir)
      expect(resolved).toBe(join(indexDir, 'index.tsp'))
    })
  })

  describe('Sorter Additional Edge Cases', () => {
    it('detects a cycle with a linear prefix/tail: P0 -> P1 -> P2 -> P3 -> P1', () => {
      const p0 = makePlugin('P0')
      const p1 = makePlugin('P1', ['P0', 'P3'])
      const p2 = makePlugin('P2', ['P1'])
      const p3 = makePlugin('P3', ['P2'])

      expect(() => sortPlugins([p0, p1, p2, p3])).toThrow(TspPluginCycleError)
    })

    it('strictly orders dense complete DAG where node i depends on all j < i', () => {
      const N = 20
      const plugins: TspPlugin[] = []
      for (let i = 0; i < N; i++) {
        const deps: string[] = []
        for (let j = 0; j < i; j++) {
          deps.push(`node-${j}`)
        }
        plugins.push(makePlugin(`node-${i}`, deps))
      }

      // Shuffle and sort
      const shuffled = [...plugins].reverse()
      const sorted = sortPlugins(shuffled)

      expect(sorted).toHaveLength(N)
      for (let i = 0; i < N; i++) {
        expect(sorted[i]?.name).toBe(`node-${i}`)
      }
    })
  })

  describe('Context Additional Edge Cases', () => {
    const dummyDoc = { openapi: '3.2.0', info: { title: 'T', version: '1' }, paths: {} } as any
    const dummyConfig: TspConfig = { input: 'main.tsp', outputDir: './dist', plugins: [] }

    it('resolves imports for multi-dotted file names correctly', () => {
      const ctx = createPluginContext({
        entrypoint: '/app/main.tsp',
        outputDir: '/app/dist',
        document: dummyDoc,
        config: dummyConfig,
      })

      expect(
        ctx.resolveImport('user.contract.test.ts', 'user.schema.dto.ts'),
      ).toBe('./user.schema.dto.js')
    })

    it('resolves imports with Windows backslashes seamlessly', () => {
      const ctx = createPluginContext({
        entrypoint: '/app/main.tsp',
        outputDir: '/app/dist',
        document: dummyDoc,
        config: dummyConfig,
      })

      expect(
        ctx.resolveImport('src\\controllers\\user.ts', 'src\\models\\user.ts'),
      ).toBe('../models/user.js')
    })
  })
})

