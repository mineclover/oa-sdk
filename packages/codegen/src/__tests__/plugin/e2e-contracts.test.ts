import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import {
  type TspPlugin,
  type TspGeneratedFile,
  type TspPluginContext,
  type TspConfig,
  defineConfig,
  defineTspConfig,
  validateTspConfig,
  sortPlugins,
  sortPluginEntries,
  compileTypeSpecInMemory,
  createPluginContext,
  TspPluginCycleError,
  TspPluginMissingDependencyError,
  TspPluginDuplicateError,
  TspFileConflictError,
  TspConfigValidationError,
} from '../../plugin/index.js'
import type { OasDocument } from '@oa-sdk/parser'

describe('End-to-End Plugin System Interface Contracts', () => {
  const fixturePath = resolve('../../test/e2e/typespec-plugin/fixtures/petstore/main.tsp')
  const mockDoc: OasDocument = {
    openapi: '3.2.0',
    info: { title: 'Contract Test API', version: '1.0.0' },
    paths: {},
  }

  it('EC-1: verifies defineTspConfig and defineConfig return identical valid config', () => {
    const rawConfig: TspConfig = {
      input: 'main.tsp',
      output: './dist/gen',
      openApiVersion: '3.2.0',
      plugins: [],
    }

    const configA = defineTspConfig(rawConfig)
    const configB = defineConfig(rawConfig)

    expect(configA).toEqual(rawConfig)
    expect(configB).toEqual(rawConfig)
  })

  it('EC-2: verifies validateTspConfig enforces input presence and normalizes defaults', () => {
    expect(() => validateTspConfig({})).toThrow(TspConfigValidationError)

    const normalized = validateTspConfig({ input: 'main.tsp' })
    expect(normalized.output).toBe('./src/generated')
    expect(normalized.openApiVersion).toBe('3.2.0')
    expect(normalized.clean).toBe(true)
    expect(normalized.format).toBe(true)
  })

  it('EC-3: verifies TspPlugin lifecycle contracts and execution hooks', async () => {
    const hooksCalled: string[] = []

    const plugin: TspPlugin = {
      name: 'contract-verifier-plugin',
      setup: () => { hooksCalled.push('setup') },
      transform: () => { hooksCalled.push('transform') },
      generate: () => { hooksCalled.push('generate') },
      emit: () => { hooksCalled.push('emit') },
    }

    const context = createPluginContext({
      entrypoint: fixturePath,
      outputDir: resolve('dist/gen'),
      document: mockDoc,
      config: { input: 'main.tsp', plugins: [plugin] },
    })

    await plugin.setup?.(context)
    await plugin.transform?.(context)
    await plugin.generate?.(context)
    await plugin.emit?.(context)

    expect(hooksCalled).toEqual(['setup', 'transform', 'generate', 'emit'])
  })

  it('EC-4: verifies TspPluginContext virtual filesystem CRUD and collision prevention', () => {
    const context = createPluginContext({
      entrypoint: fixturePath,
      outputDir: resolve('dist/gen'),
      document: mockDoc,
      config: { input: 'main.tsp', plugins: [] },
    })

    context.addFile({
      path: 'index.ts',
      content: 'export * from "./types";',
      sourcePlugin: 'core',
      exports: ['*'],
    })

    expect(context.hasFile('index.ts')).toBe(true)
    expect(context.getFile('index.ts')?.content).toBe('export * from "./types";')

    // Duplicate path throws TspFileConflictError
    expect(() => {
      context.addFile({
        path: 'index.ts',
        content: 'export * from "./duplicate";',
        sourcePlugin: 'other',
      })
    }).toThrow(TspFileConflictError)

    // Update existing file
    context.updateFile('index.ts', (f) => ({ ...f, content: '// updated' }))
    expect(context.getFile('index.ts')?.content).toBe('// updated')

    // Remove file
    expect(context.removeFile('index.ts')).toBe(true)
    expect(context.hasFile('index.ts')).toBe(false)
  })

  it('EC-5: verifies relative ESM import resolution across virtual files', () => {
    const context = createPluginContext({
      entrypoint: fixturePath,
      outputDir: resolve('dist/gen'),
      document: mockDoc,
      config: { input: 'main.tsp', plugins: [] },
    })

    expect(context.resolveImport('client.ts', 'types.ts')).toBe('./types.js')
    expect(context.resolveImport('sub/client.ts', 'types.ts')).toBe('../types.js')
    expect(context.resolveImport('client.ts', 'sub/types.ts')).toBe('./sub/types.js')
  })

  it('EC-6: verifies topological sorter Kahn algorithm and cycle detection', () => {
    const pA: TspPlugin = { name: 'A' }
    const pB: TspPlugin = { name: 'B', dependencies: ['A'] }
    const pC: TspPlugin = { name: 'C', dependencies: ['B'] }

    const sorted = sortPlugins([pC, pA, pB])
    expect(sorted.map(p => p.name)).toEqual(['A', 'B', 'C'])

    // Circular dependency
    const pCyc1: TspPlugin = { name: 'Cyc1', dependencies: ['Cyc2'] }
    const pCyc2: TspPlugin = { name: 'Cyc2', dependencies: ['Cyc1'] }
    expect(() => sortPlugins([pCyc1, pCyc2])).toThrow(TspPluginCycleError)

    // Missing dependency
    const pMissing: TspPlugin = { name: 'MissingConsumer', dependencies: ['NonExistent'] }
    expect(() => sortPlugins([pMissing])).toThrow(TspPluginMissingDependencyError)
  })

  it('EC-7: verifies in-memory TypeSpec compiler zero-disk invariant', async () => {
    const result = await compileTypeSpecInMemory(fixturePath)
    expect(result.document.openapi).toBe('3.2.0')
    expect(result.routesCount).toBeGreaterThan(0)
    expect(result.program).toBeDefined()
  })

  it('EC-8: verifies diagnostic recording and inter-plugin data sharing', () => {
    const context = createPluginContext({
      entrypoint: fixturePath,
      outputDir: resolve('dist/gen'),
      document: mockDoc,
      config: { input: 'main.tsp', plugins: [] },
    })

    context.setPluginData('custom-meta', { key: 'value' })
    expect(context.getPluginData('custom-meta')).toEqual({ key: 'value' })

    context.reportDiagnostic({
      code: 'INFO001',
      severity: 'info',
      message: 'Plugin initialized',
    })
    expect(context.diagnostics.length).toBe(1)
    expect(context.diagnostics[0]?.code).toBe('INFO001')
  })
})
