import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createTspBuilder, TspProjectBuilder, type TspWatchEvent } from '../../plugin/builder.js'
import { pluginTypescript } from '../../plugin/plugins/typescript.js'
import { pluginClient } from '../../plugin/plugins/client.js'
import type { TspPlugin } from '../../plugin/types.js'

const scratchDirs: string[] = []

/**
 * Creates `<tmp>/project/main.tsp` with the given routes; `<tmp>/node_modules` links to this
 * package's dependencies so the TypeSpec libraries resolve (and stay outside the watched project).
 */
function createTspProject(routes: readonly string[]): { root: string; project: string; main: string; write(routes: readonly string[]): void } {
  const root = mkdtempSync(join(tmpdir(), 'tsp-builder-project-'))
  scratchDirs.push(root)
  symlinkSync(resolve(__dirname, '../../../node_modules'), join(root, 'node_modules'), 'junction')
  const project = join(root, 'project')
  mkdirSync(project)
  const main = join(project, 'main.tsp')
  const write = (nextRoutes: readonly string[]) => writeFileSync(main, [
    'import "@typespec/http";',
    'using Http;',
    '@service(#{ title: "Builder Probe" })',
    'namespace BuilderProbe;',
    ...nextRoutes.map((route, index) => `@route("${route}") @get op op${index}(): { @statusCode code: 204 };`),
  ].join('\n'))
  write(routes)
  return { root, project, main, write }
}

function pathRecorder(seen: string[][]): TspPlugin {
  return {
    name: 'path-recorder',
    generate(ctx) {
      seen.push(Object.keys(ctx.document.paths ?? {}).sort())
    },
  }
}

async function waitFor<T>(read: () => T | undefined, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error('timed out waiting for watch event')
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50))
  }
}

/**
 * `fs.watch` has no "ready" event. Rewrite a benign change until the watcher reports one, so a
 * test that writes immediately after `watch()` cannot race the OS watcher startup on a busy host.
 */
async function waitForWatcherReady(
  tsp: ReturnType<typeof createTspProject>,
  events: TspWatchEvent[],
): Promise<void> {
  const deadline = Date.now() + 5_000
  while (events.length === 0 && Date.now() < deadline) {
    tsp.write(['/a'])
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
  }
  if (events.length === 0) throw new Error('watcher did not become ready')
  events.length = 0
}

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

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
    expect(result.outputDir).toBe(resolve('dist/test-builder-output'))
    expect(result.files.length).toBeGreaterThanOrEqual(2)
    expect(result.files.some(f => f.path === 'types.ts')).toBe(true)
    expect(result.files.some(f => f.path === 'client.ts')).toBe(true)
  })

  it('honors an outputDir or output override in build()', async () => {
    const builder = createTspBuilder(petstoreFile)
    const absolute = resolve(tmpdir(), 'oa-sdk-builder-custom-out')
    expect((await builder.build({ dryRun: true, outputDir: absolute })).outputDir).toBe(absolute)
    expect((await builder.build({ dryRun: true, output: absolute })).outputDir).toBe(absolute)
    // `output` wins over `outputDir`, as in validateTspConfig.
    expect((await builder.build({ dryRun: true, output: absolute, outputDir: '/ignored' })).outputDir).toBe(absolute)

    const ctorBuilder = createTspBuilder({ input: petstoreFile, outputDir: absolute })
    expect((await ctorBuilder.build({ dryRun: true })).outputDir).toBe(absolute)
  })

  it('build() recompiles the TypeSpec sources after introspect() (no stale document)', async () => {
    const tsp = createTspProject(['/a'])
    const seen: string[][] = []
    const builder = createTspBuilder({ input: tsp.main, plugins: [pathRecorder(seen)] })

    const report = await builder.introspect()
    expect(report.operations.map(op => op.path)).toEqual(['/a'])

    tsp.write(['/a', '/b'])
    const result = await builder.build({ dryRun: true })
    expect(seen.at(-1)).toEqual(['/a', '/b'])
    expect(result.routesCount).toBe(2)

    // Config overrides apply to the compilation as well.
    const downgraded = await builder.build({ dryRun: true, openApiVersion: '3.1.0' })
    expect(downgraded.context.document.openapi).toBe('3.1.0')
  })

  it('resolves a relative input against options.cwd in build(), introspect() and watch()', async () => {
    const tsp = createTspProject(['/a'])
    const builder = createTspBuilder({ input: 'main.tsp' }, { cwd: tsp.project })

    const report = await builder.introspect()
    const result = await builder.build({ dryRun: true })
    expect(report.entrypoint).toBe(tsp.main)
    expect(result.entrypoint).toBe(tsp.main)

    const handle = builder.watch(() => {}, { buildOnChange: false })
    handle.unwatch()

    const objectInput = createTspBuilder({ input: { entrypoint: 'main.tsp', tspDir: 'project' } }, { cwd: tsp.root })
    expect((await objectInput.introspect()).entrypoint).toBe(tsp.main)
  })

  it('watch() rebuilds from the edited sources even after introspect()', async () => {
    const tsp = createTspProject(['/a'])
    const builder = createTspBuilder({ input: tsp.main })
    await builder.introspect()

    const events: TspWatchEvent[] = []
    const handle = builder.watch(event => { events.push(event) }, { debounceMs: 50 })
    try {
      await waitForWatcherReady(tsp, events)
      tsp.write(['/a', '/b'])
      const event = await waitFor(() => events.find(e => e.result?.routesCount === 2 || e.error !== undefined))
      expect(event.error).toBeUndefined()
      expect(Object.keys(event.result!.context.document.paths ?? {}).sort()).toEqual(['/a', '/b'])
      // The introspection cache was invalidated together with the compiled document.
      expect((await builder.introspect()).routesCount).toBe(2)
    } finally {
      handle.unwatch()
    }
  })

  it('watch() reports TypeSpec compilation failures as event.error', async () => {
    const tsp = createTspProject(['/a'])
    const builder = createTspBuilder({ input: tsp.main, dryRun: true })
    const events: TspWatchEvent[] = []
    const handle = builder.watch(event => { events.push(event) }, { debounceMs: 50 })
    try {
      await waitForWatcherReady(tsp, events)
      writeFileSync(tsp.main, 'this is not typespec {{{')
      // Readiness writes can still have a successful /a build in flight. Await the error from
      // the invalid edit instead of mistaking that earlier success for its compilation result.
      const event = await waitFor(() => events.find(e => e.error !== undefined))
      expect(event.result).toBeUndefined()
      expect(event.error).toBeInstanceOf(Error)
      expect(String((event.error as Error).message)).toContain('TypeSpec compilation failed')

      // The error must not stop the watcher or poison a later valid compilation.
      tsp.write(['/recovered'])
      const recovered = await waitFor(() => events.find(e =>
        e.result?.context.document.paths?.['/recovered'] !== undefined,
      ))
      expect(recovered.error).toBeUndefined()
      expect(recovered.result?.success).toBe(true)
    } finally {
      handle.unwatch()
    }
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
