import { describe, it, expect, vi } from 'vitest'
import { resolve } from 'node:path'
import { createTspBuilder, TspProjectBuilder } from '../../plugin/builder.js'
import { pluginTypescript } from '../../plugin/plugins/typescript.js'
import { pluginClient } from '../../plugin/plugins/client.js'

describe('TypeSpec Builder Platform: TspProjectBuilder & createTspBuilder', () => {
  const monorepoRoot = resolve(__dirname, '../../../../..')
  const petstoreFile = resolve(monorepoRoot, 'test/e2e/typespec-plugin/fixtures/petstore/main.tsp')
  const storefrontFile = resolve(monorepoRoot, 'test/e2e/typespec-plugin/fixtures/storefront/main.tsp')

  it('initializes TspProjectBuilder with string path or TspConfig', () => {
    const builder1 = createTspBuilder(petstoreFile)
    expect(builder1).toBeInstanceOf(TspProjectBuilder)
    expect(builder1.getConfig().input).toBe(petstoreFile)

    const builder2 = createTspBuilder({
      input: petstoreFile,
      openApiVersion: '3.2.0',
    })
    expect(builder2.getConfig().openApiVersion).toBe('3.2.0')
  })

  it('supports fluent plugin chaining via .use()', () => {
    const pTs = pluginTypescript()
    const pCl = pluginClient()

    const builder = createTspBuilder(petstoreFile)
      .use(pTs)
      .use(pCl)

    expect(builder.getPlugins()).toHaveLength(2)
    expect(builder.getPlugins()[0]).toBe(pTs)
    expect(builder.getPlugins()[1]).toBe(pCl)
  })

  it('introspects Petstore TypeSpec declarations transparently', async () => {
    const builder = createTspBuilder(petstoreFile)
    const report = await builder.introspect()

    expect(report.title).toBe('Petstore Service')
    expect(report.version).toBe('1.0.0')
    expect(report.openApiVersion).toBe('3.2.0')
    expect(report.routesCount).toBe(5)
    expect(report.operations.length).toBe(5)

    // Check specific operation
    const getPetOp = await builder.getOperation('Pets_getPetById')
    expect(getPetOp).toBeDefined()
    expect(getPetOp?.method).toBe('GET')
    expect(getPetOp?.path).toBe('/pets/{petId}')
    expect(getPetOp?.summary).toBe('Get pet by ID')

    // Parameters
    const pathParam = getPetOp?.parameters.find(p => p.name === 'petId')
    expect(pathParam).toBeDefined()
    expect(pathParam?.in).toBe('path')
    expect(pathParam?.required).toBe(true)

    // Models
    const models = await builder.getModels()
    expect(models.length).toBeGreaterThanOrEqual(4)

    const petModel = await builder.getModel('Pet')
    expect(petModel).toBeDefined()
    expect(petModel?.name).toBe('Pet')
    const idProp = petModel?.properties.find(p => p.name === 'id')
    expect(idProp).toBeDefined()
    expect(idProp?.required).toBe(true)
  })

  it('introspects Storefront models, constraints, and operations', async () => {
    const builder = createTspBuilder(storefrontFile)
    const report = await builder.introspect()

    expect(report.title).toBe('Storefront E-Commerce API')
    expect(report.version).toBe('2.1.0')

    const productModel = await builder.getModel('Product')
    expect(productModel).toBeDefined()
    expect(productModel?.properties.length).toBeGreaterThanOrEqual(5)

    const skuProp = productModel?.properties.find(p => p.name === 'sku')
    expect(skuProp?.required).toBe(true)

    // Operations
    const createOrderOp = await builder.getOperation('Orders_createOrder')
    expect(createOrderOp).toBeDefined()
    expect(createOrderOp?.method).toBe('POST')
    expect(createOrderOp?.path).toBe('/orders')
    expect(createOrderOp?.requestBody?.required).toBe(true)
  })

  it('caches introspection report unless forceFresh is specified', async () => {
    const builder = createTspBuilder(petstoreFile)
    const report1 = await builder.introspect()
    const report2 = await builder.introspect()
    expect(report1).toBe(report2) // Reference identity check (cached)

    const report3 = await builder.introspect(true) // Force fresh
    expect(report3).not.toBe(report1)
    expect(report3.title).toBe(report1.title)
  })

  it('builds full plugin pipeline in memory with dryRun', async () => {
    const builder = createTspBuilder(petstoreFile)
      .use(pluginTypescript())
      .use(pluginClient())

    const result = await builder.build({
      dryRun: true,
      outputDir: 'dist/test-builder-output',
    })

    expect(result.success).toBe(true)
    expect(result.files.length).toBeGreaterThanOrEqual(2)
    expect(result.files.some(f => f.path === 'types.ts')).toBe(true)
    expect(result.files.some(f => f.path === 'client.ts')).toBe(true)
  })

  it('supports watcher lifecycle with graceful unwatch', () => {
    const builder = createTspBuilder(petstoreFile)
    const listener = vi.fn()

    const handle = builder.watch(listener, { debounceMs: 50, buildOnChange: false })
    expect(typeof handle.unwatch).toBe('function')

    handle.unwatch()
    // Unwatch must not throw
    expect(() => handle.unwatch()).not.toThrow()
  })
})
