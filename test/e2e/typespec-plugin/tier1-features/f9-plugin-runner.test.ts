import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import {
  type TspPlugin,
  TspFileConflictError,
  createPluginContext,
  runTspPluginPipeline,
} from '../../../../packages/codegen/src/plugin/index.js'
import type { OasDocument } from '@oa-sdk/parser'

const mockDoc: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Pipeline Test API', version: '1.0.0' },
  paths: {},
}

describe('Tier 1: F9 - Plugin Runner & Virtual File Flusher', () => {
  it('F9.1: executes complete plugin pipeline lifecycle in topological order', async () => {
    const trace: string[] = []

    const pluginA: TspPlugin = {
      name: 'alpha',
      setup: () => { trace.push('A:setup') },
      transform: () => { trace.push('A:transform') },
      generate: (ctx) => {
        trace.push('A:generate')
        ctx.addFile({
          path: 'alpha.ts',
          content: 'export const alpha = 1;',
          sourcePlugin: 'alpha',
        })
      },
      emit: () => { trace.push('A:emit') },
    }

    const pluginB: TspPlugin = {
      name: 'beta',
      dependencies: ['alpha'],
      setup: () => { trace.push('B:setup') },
      transform: () => { trace.push('B:transform') },
      generate: (ctx) => {
        trace.push('B:generate')
        ctx.addFile({
          path: 'beta.ts',
          content: 'export const beta = 2;',
          sourcePlugin: 'beta',
        })
      },
      emit: () => { trace.push('B:emit') },
    }

    // The real runner orders the plugins (beta depends on alpha) and drives every lifecycle phase.
    const result = await runTspPluginPipeline(
      { input: 'main.tsp', dryRun: true, plugins: [pluginB, pluginA] },
      { document: mockDoc },
    )

    expect(trace).toEqual([
      'A:setup', 'B:setup',
      'A:transform', 'B:transform',
      'A:generate', 'B:generate',
      'A:emit', 'B:emit',
    ])
    expect(result.success).toBe(true)
    expect(result.files.map(file => file.path)).toEqual(['alpha.ts', 'beta.ts'])
    expect(result.emittedFiles).toEqual([])
  })

  it('F9.2: accurately computes relative ESM import specifiers between virtual files', () => {
    const context = createPluginContext({
      entrypoint: resolve('test/e2e/typespec-plugin/fixtures/petstore/main.tsp'),
      outputDir: resolve('dist/generated'),
      document: mockDoc,
      config: { input: 'main.tsp', output: 'dist/generated', plugins: [] },
    })

    // Same folder
    expect(context.resolveImport('client.ts', 'types.ts')).toBe('./types.js')
    // Subfolder importing from root
    expect(context.resolveImport('nested/client.ts', 'types.ts')).toBe('../types.js')
    // Root importing from subfolder
    expect(context.resolveImport('index.ts', 'nested/helper.ts')).toBe('./nested/helper.js')
  })

  it('F9.3: dryRun mode preserves virtual files in memory without disk emission', () => {
    const context = createPluginContext({
      entrypoint: resolve('test/e2e/typespec-plugin/fixtures/petstore/main.tsp'),
      outputDir: resolve('dist/generated'),
      document: mockDoc,
      config: { input: 'main.tsp', output: 'dist/generated', dryRun: true, plugins: [] },
    })

    context.addFile({
      path: 'memory-only.ts',
      content: '// In memory',
      sourcePlugin: 'tester',
      isVirtual: true,
    })

    expect(context.config.dryRun).toBe(true)
    expect(context.hasFile('memory-only.ts')).toBe(true)
    expect(context.getFile('memory-only.ts')?.isVirtual).toBe(true)
  })

  it('F9.4: throws TspFileConflictError when two plugins attempt to author the same path', () => {
    const context = createPluginContext({
      entrypoint: resolve('test/e2e/typespec-plugin/fixtures/petstore/main.tsp'),
      outputDir: resolve('dist/generated'),
      document: mockDoc,
      config: { input: 'main.tsp', output: 'dist/generated', plugins: [] },
    })

    context.addFile({
      path: 'duplicate.ts',
      content: '// from A',
      sourcePlugin: 'pluginA',
    })

    expect(() => {
      context.addFile({
        path: 'duplicate.ts',
        content: '// from B',
        sourcePlugin: 'pluginB',
      })
    }).toThrow(TspFileConflictError)
  })

  it('F9.5: retains and formats generated file header banners and metadata', () => {
    const context = createPluginContext({
      entrypoint: resolve('test/e2e/typespec-plugin/fixtures/petstore/main.tsp'),
      outputDir: resolve('dist/generated'),
      document: mockDoc,
      config: { input: 'main.tsp', output: 'dist/generated', plugins: [] },
    })

    context.addFile({
      path: 'banner-test.ts',
      content: 'export const X = 1;',
      sourcePlugin: 'pluginX',
      banner: '// Custom Banner for E2E Test',
      metadata: { kind: 'models', tag: 'pets' },
    })

    const file = context.getFile('banner-test.ts')
    expect(file?.banner).toBe('// Custom Banner for E2E Test')
    expect(file?.metadata).toEqual({ kind: 'models', tag: 'pets' })
  })
})
