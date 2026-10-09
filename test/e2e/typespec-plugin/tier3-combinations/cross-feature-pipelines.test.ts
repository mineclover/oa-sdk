import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import {
  type TspPlugin,
  type TspGeneratedFile,
  compileTypeSpecInMemory,
  createPluginContext,
  sortPlugins,
} from '../../../../packages/codegen/src/plugin/index.js'
import { generateTypesFromSpec } from '../../../../packages/codegen/src/typegen/generate-types.js'
import { generateTanstackQuery } from '../../../../packages/client/src/tanstack/index.js'
import { generateHandlerContract, generateRouter } from '../../../../packages/router/src/index.js'
import {
  extractWireSchemaFromOas,
  ProtobufCodecTargetAdapter,
} from '../../../../packages/codegen/src/wire-adapter/index.js'

describe('Tier 3: Cross-Feature Combinations — Multi-Plugin Pipeline', () => {
  const petstoreFile = resolve('test/e2e/typespec-plugin/fixtures/petstore/main.tsp')
  const protobufFile = resolve('test/e2e/typespec-plugin/fixtures/protobuf/main.tsp')
  let petstoreDoc: any
  let protobufDoc: any

  beforeAll(async () => {
    const petstoreRes = await compileTypeSpecInMemory(petstoreFile)
    petstoreDoc = petstoreRes.document

    const protoRes = await compileTypeSpecInMemory(protobufFile)
    protobufDoc = protoRes.document
  })

  it('C3.1: TypeSpec -> Typescript -> Client SDK pipeline combination', () => {
    const typesCode = generateTypesFromSpec(petstoreDoc, { style: 'interface' })
    expect(typesCode).toContain('export type Pet')

    const context = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: petstoreDoc,
      config: { input: petstoreFile, plugins: [] },
    })

    context.addFile({
      path: 'types.ts',
      content: typesCode,
      sourcePlugin: 'typescript',
      exports: ['Pet', 'PetStatus', 'CreatePetRequest'],
    })

    const importPath = context.resolveImport('client.ts', 'types.ts')
    expect(importPath).toBe('./types.js')

    const clientCode = `import type { Pet, PetError } from '${importPath}';\nexport const getPet = () => {};`
    context.addFile({
      path: 'client.ts',
      content: clientCode,
      sourcePlugin: 'client',
      exports: ['getPet'],
    })

    expect(context.hasFile('types.ts')).toBe(true)
    expect(context.hasFile('client.ts')).toBe(true)
    expect(context.getFile('client.ts')?.content).toContain("from './types.js'")
  })

  it('C3.2: TypeSpec -> Typescript -> Client -> TanStack Query pipeline combination', () => {
    const queryOutput = generateTanstackQuery(petstoreDoc)
    expect(queryOutput.keysCode).toBeDefined()
    expect(queryOutput.queriesCode).toBeDefined()

    const context = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: petstoreDoc,
      config: { input: petstoreFile, plugins: [] },
    })

    context.addFile({
      path: 'keys.ts',
      content: queryOutput.keysCode,
      sourcePlugin: 'tanstack-query',
    })
    context.addFile({
      path: 'queries.ts',
      content: queryOutput.queriesCode,
      sourcePlugin: 'tanstack-query',
    })

    expect(context.hasFile('keys.ts')).toBe(true)
    expect(context.hasFile('queries.ts')).toBe(true)
  })

  it('C3.3: TypeSpec -> Typescript -> Router contract pipeline combination', () => {
    const typesCode = generateTypesFromSpec(petstoreDoc)
    const contractCode = generateHandlerContract(petstoreDoc, { typesImport: './types.js' })
    const routerCode = generateRouter(petstoreDoc, {
      target: 'hono',
      contractImport: './api.contract.js',
    })

    expect(contractCode).toContain("from './types.js'")
    expect(routerCode).toContain("from './api.contract.js'")
    expect(contractCode).toContain('ApiHandlers')
  })

  it('C3.4: TypeSpec -> Typescript -> Wire Protobuf Codecs pipeline combination', () => {
    const wireModel = extractWireSchemaFromOas(protobufDoc)
    const codecCode = new ProtobufCodecTargetAdapter().transform(wireModel)

    expect(codecCode).toContain('encodeSensorReading')
    expect(codecCode).toContain('encodeMetricBatch')
  })

  it('C3.5: All 5 Target Plugins Full DAG topological resolution and execution', async () => {
    const executionTrace: string[] = []

    const pTypescript: TspPlugin = {
      name: 'typescript',
      generate: (ctx) => {
        executionTrace.push('typescript')
        ctx.addFile({
          path: 'types.ts',
          content: generateTypesFromSpec(ctx.document),
          sourcePlugin: 'typescript',
        })
      },
    }

    const pClient: TspPlugin = {
      name: 'client',
      dependencies: ['typescript'],
      generate: (ctx) => {
        executionTrace.push('client')
        ctx.addFile({
          path: 'client.ts',
          content: '// client sdk',
          sourcePlugin: 'client',
        })
      },
    }

    const pTanstack: TspPlugin = {
      name: 'tanstack-query',
      dependencies: ['typescript', 'client'],
      generate: (ctx) => {
        executionTrace.push('tanstack-query')
        ctx.addFile({
          path: 'queries.ts',
          content: '// tanstack query',
          sourcePlugin: 'tanstack-query',
        })
      },
    }

    const pRouter: TspPlugin = {
      name: 'router',
      dependencies: ['typescript'],
      generate: (ctx) => {
        executionTrace.push('router')
        ctx.addFile({
          path: 'api.contract.ts',
          content: '// server router contract',
          sourcePlugin: 'router',
        })
      },
    }

    const pWire: TspPlugin = {
      name: 'wire',
      dependencies: ['typescript'],
      generate: (ctx) => {
        executionTrace.push('wire')
        ctx.addFile({
          path: 'wire.ts',
          content: '// wire protobuf codec',
          sourcePlugin: 'wire',
        })
      },
    }

    // Deliberately unsorted input
    const plugins = [pTanstack, pWire, pClient, pRouter, pTypescript]
    const sorted = sortPlugins(plugins)

    const context = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: petstoreDoc,
      config: { input: petstoreFile, plugins: sorted },
    })

    for (const p of sorted) {
      await p.generate?.(context)
    }

    // Typescript must execute first
    expect(executionTrace[0]).toBe('typescript')
    // Client must execute before Tanstack
    expect(executionTrace.indexOf('client')).toBeLessThan(executionTrace.indexOf('tanstack-query'))
    // All 5 files registered in VFS
    expect(context.getFiles().length).toBe(5)
  })

  it('C3.6: Virtual import resolution across complex tree (types, client, queries, router, wire)', () => {
    const context = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: petstoreDoc,
      config: { input: petstoreFile, plugins: [] },
    })

    expect(context.resolveImport('client/index.ts', 'models/types.ts')).toBe('../models/types.js')
    expect(context.resolveImport('tanstack/hooks.ts', 'client/index.ts')).toBe('../client/index.js')
    expect(context.resolveImport('server/router.ts', 'server/api.contract.ts')).toBe('./api.contract.js')
    expect(context.resolveImport('wire/codecs.ts', 'models/types.ts')).toBe('../models/types.js')
  })

  it('C3.7: Inter-plugin shared data bus passing metadata across lifecycle hooks', async () => {
    let capturedData: any = undefined

    const upstream: TspPlugin = {
      name: 'upstream-metadata',
      setup: (ctx) => {
        ctx.setPluginData('authSchemes', ['bearer', 'apiKey'])
      },
    }

    const downstream: TspPlugin = {
      name: 'downstream-consumer',
      dependencies: ['upstream-metadata'],
      generate: (ctx) => {
        capturedData = ctx.getPluginData('authSchemes')
      },
    }

    const sorted = sortPlugins([downstream, upstream])
    const context = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: petstoreDoc,
      config: { input: petstoreFile, plugins: sorted },
    })

    for (const p of sorted) await p.setup?.(context)
    for (const p of sorted) await p.generate?.(context)

    expect(capturedData).toEqual(['bearer', 'apiKey'])
  })

  it('C3.8: Transform hook document mutation observed by downstream generators', async () => {
    let observedTitle = ''

    const mutator: TspPlugin = {
      name: 'spec-mutator',
      enforce: 'pre',
      transform: (ctx) => {
        ctx.document.info.title = 'Mutated Petstore Service Title'
      },
    }

    const reader: TspPlugin = {
      name: 'spec-reader',
      dependencies: ['spec-mutator'],
      generate: (ctx) => {
        observedTitle = ctx.document.info.title
      },
    }

    const sorted = sortPlugins([reader, mutator])
    const clonedDoc = JSON.parse(JSON.stringify(petstoreDoc))
    const context = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: clonedDoc,
      config: { input: petstoreFile, plugins: sorted },
    })

    for (const p of sorted) await p.transform?.(context)
    for (const p of sorted) await p.generate?.(context)

    expect(observedTitle).toBe('Mutated Petstore Service Title')
  })

  it('C3.9: Pre-plugin and Post-plugin sandwiching around multi-target adapters', async () => {
    const trace: string[] = []

    const prePlugin: TspPlugin = {
      name: 'pre-auditor',
      enforce: 'pre',
      generate: () => { trace.push('pre') },
    }

    const mainPlugin: TspPlugin = {
      name: 'main-adapter',
      generate: () => { trace.push('main') },
    }

    const postPlugin: TspPlugin = {
      name: 'post-formatter',
      enforce: 'post',
      generate: () => { trace.push('post') },
    }

    const sorted = sortPlugins([postPlugin, mainPlugin, prePlugin])
    const context = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: petstoreDoc,
      config: { input: petstoreFile, plugins: sorted },
    })

    for (const p of sorted) await p.generate?.(context)

    expect(trace).toEqual(['pre', 'main', 'post'])
  })

  it('C3.10: DryRun execution preserves complete 5-plugin VFS without disk emission', async () => {
    const context = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/dry-run-generated'),
      document: petstoreDoc,
      config: { input: petstoreFile, output: 'dist/dry-run-generated', dryRun: true, plugins: [] },
    })

    const files = ['types.ts', 'client.ts', 'queries.ts', 'api.contract.ts', 'wire.ts']
    for (const f of files) {
      context.addFile({
        path: f,
        content: `// generated ${f}`,
        sourcePlugin: 'mock-pipeline',
        isVirtual: true,
      })
    }

    expect(context.config.dryRun).toBe(true)
    expect(context.getFiles().length).toBe(5)
    for (const f of files) {
      expect(context.hasFile(f)).toBe(true)
      expect(context.getFile(f)?.content).toContain(`// generated ${f}`)
    }
  })
})
