import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import {
  type TspPlugin,
  type TspGeneratedFile,
  TspPluginContextImpl,
  createPluginContext,
} from '../../../../packages/codegen/src/plugin/index.js'
import type { OasDocument } from '@oa-sdk/parser'

const mockDoc: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Test API', version: '1.0.0' },
  paths: {},
}

describe('Tier 1: F1 - Core Plugin Engine Interfaces', () => {
  it('F1.1: executes lifecycle hooks in strict sequence (setup -> transform -> generate -> emit)', async () => {
    const executionOrder: string[] = []

    const testPlugin: TspPlugin = {
      name: 'lifecycle-probe',
      setup: (ctx) => {
        executionOrder.push('setup')
      },
      transform: (ctx) => {
        executionOrder.push('transform')
      },
      generate: (ctx) => {
        executionOrder.push('generate')
      },
      emit: (ctx) => {
        executionOrder.push('emit')
      },
    }

    const context = createPluginContext({
      entrypoint: resolve('test/e2e/typespec-plugin/fixtures/petstore/main.tsp'),
      outputDir: resolve('dist/generated'),
      document: mockDoc,
      config: { input: 'main.tsp', output: 'dist/generated', plugins: [testPlugin] },
    })

    await testPlugin.setup?.(context)
    await testPlugin.transform?.(context)
    await testPlugin.generate?.(context)
    await testPlugin.emit?.(context)

    expect(executionOrder).toEqual(['setup', 'transform', 'generate', 'emit'])
  })

  it('F1.2: supports virtual file CRUD and path normalization in context', () => {
    const context = createPluginContext({
      entrypoint: resolve('test/e2e/typespec-plugin/fixtures/petstore/main.tsp'),
      outputDir: resolve('dist/generated'),
      document: mockDoc,
      config: { input: 'main.tsp', output: 'dist/generated', plugins: [] },
    })

    const fileA: TspGeneratedFile = {
      path: './models/user.ts',
      content: 'export interface User { id: string; }',
      sourcePlugin: 'test-plugin',
      exports: ['User'],
    }

    context.addFile(fileA)

    expect(context.hasFile('models/user.ts')).toBe(true)
    expect(context.getFile('models/user.ts')?.content).toBe('export interface User { id: string; }')
    expect(context.getFiles().length).toBe(1)
  })

  it('F1.3: updates and removes virtual files via context updater', () => {
    const context = createPluginContext({
      entrypoint: resolve('test/e2e/typespec-plugin/fixtures/petstore/main.tsp'),
      outputDir: resolve('dist/generated'),
      document: mockDoc,
      config: { input: 'main.tsp', output: 'dist/generated', plugins: [] },
    })

    context.addFile({
      path: 'types.ts',
      content: 'export type Id = string;',
      sourcePlugin: 'typegen',
    })

    context.updateFile('types.ts', (existing) => ({
      ...existing,
      content: `${existing.content}\nexport type Name = string;`,
      exports: ['Id', 'Name'],
    }))

    const updated = context.getFile('types.ts')
    expect(updated?.content).toContain('export type Name = string;')
    expect(updated?.exports).toEqual(['Id', 'Name'])

    const removed = context.removeFile('types.ts')
    expect(removed).toBe(true)
    expect(context.hasFile('types.ts')).toBe(false)
  })

  it('F1.4: facilitates inter-plugin state transfer via sharedData', () => {
    const context = createPluginContext({
      entrypoint: resolve('test/e2e/typespec-plugin/fixtures/petstore/main.tsp'),
      outputDir: resolve('dist/generated'),
      document: mockDoc,
      config: { input: 'main.tsp', output: 'dist/generated', plugins: [] },
    })

    context.setPluginData('auth-strategy', { type: 'bearer', tokenHeader: 'Authorization' })
    const retrieved = context.getPluginData<{ type: string; tokenHeader: string }>('auth-strategy')

    expect(retrieved).toEqual({ type: 'bearer', tokenHeader: 'Authorization' })
    expect(context.sharedData.get('auth-strategy')).toEqual(retrieved)
  })

  it('F1.5: records and tracks diagnostic entries during plugin execution', () => {
    const context = createPluginContext({
      entrypoint: resolve('test/e2e/typespec-plugin/fixtures/petstore/main.tsp'),
      outputDir: resolve('dist/generated'),
      document: mockDoc,
      config: { input: 'main.tsp', output: 'dist/generated', plugins: [] },
    })

    context.reportDiagnostic({
      code: 'DEP001',
      severity: 'warning',
      message: 'Field "legacyId" is marked deprecated in TypeSpec source',
      file: 'main.tsp',
      line: 42,
    })

    context.reportDiagnostic({
      code: 'SCHEMA002',
      severity: 'error',
      message: 'Missing discriminator mapping for PolymorphicBase',
    })

    expect(context.diagnostics.length).toBe(2)
    expect(context.diagnostics[0].severity).toBe('warning')
    expect(context.diagnostics[1].code).toBe('SCHEMA002')
  })
})
