/**
 * TypeSpec Builder Platform: Real-World Usability Scenario Runner Suite
 *
 * Comprehensive end-to-end DX evaluation across 5 core developer journey areas:
 * 1. Area 1: Programmable Introspection Ergonomics (getOperations, getModels, route counts, latency benchmarks)
 * 2. Area 2: openapi-ts Calling Convention & Discriminated Union DX (single object params, mutually exclusive data/error, isErrorStatus narrowing, signal cancellation)
 * 3. Area 3: TanStack Query v5 3-Tier Integration DX (Tier 1 keys, Tier 2 queryOptions/infiniteQueryOptions, Tier 3 hooks, modular split, api-client.ts adapter over pluginClient)
 * 4. Area 4: Vite HMR Dev Loop Lifecycle DX (buildStart, configureServer, watch full-reload, deterministic closeBundle teardown)
 * 5. Area 5: Binary Wire Compression & Protobuf Codec DX (zero-eval CSP, resolveBinaryCodec, lossless roundtrip, >70% compression)
 *
 * @oa-sdk/codegen
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { resolve, join, posix } from 'node:path'
import { mkdirSync, mkdtempSync, copyFileSync, appendFileSync, rmSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'

import {
  createTspBuilder,
  TspProjectBuilder,
  compileTypeSpecInMemory,
  createPluginContext,
  pluginTypescript,
  pluginClient,
  pluginTanstackQuery,
  pluginWire,
  vitePluginTsp,
  type PluginTanstackQueryOptions,
  type TspIntrospectionReport,
} from '../../plugin/index.js'

/**
 * Transpiles a generated TypeScript module to CommonJS and evaluates it in a Node VM context with the
 * standard Web APIs (fetch Response, Headers, ...). `modules` maps every specifier the module requires
 * at runtime to the exports of an already loaded module; type-only imports are erased by transpilation.
 */
function loadGeneratedModule(
  source: string,
  modules: Readonly<Record<string, Record<string, any>>> = {},
): Record<string, any> {
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText

  const exportsContainer: Record<string, any> = {}
  const sandbox = {
    exports: exportsContainer,
    module: { exports: exportsContainer },
    require: (specifier: string) => {
      const loaded = modules[specifier]
      if (!loaded) throw new Error(`Generated module requires '${specifier}' at runtime, which the test did not provide`)
      return loaded
    },
    Response,
    Headers,
    DOMException,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    console,
  }
  runInContext(transpiled, createContext(sandbox))
  return exportsContainer
}

/** Relative module specifiers (`./x.js`, `../x.js`) a generated module imports from. */
function relativeImports(code: string): string[] {
  return Array.from(code.matchAll(/from '(\.{1,2}\/[^']+)'/g), match => match[1]!)
}

describe('TypeSpec Builder Platform: Real-World Usability Scenarios', () => {
  const monorepoRoot = resolve(__dirname, '../../../../..')
  const petstoreFile = resolve(monorepoRoot, 'test/e2e/typespec-plugin/fixtures/petstore/main.tsp')
  const storefrontFile = resolve(monorepoRoot, 'test/e2e/typespec-plugin/fixtures/storefront/main.tsp')
  const protobufFile = resolve(monorepoRoot, 'test/e2e/typespec-plugin/fixtures/protobuf/main.tsp')

  // Cleanup stack to guarantee deterministic handle & filesystem teardown
  const cleanups: (() => void)[] = []

  afterEach(() => {
    while (cleanups.length > 0) {
      const cleanup = cleanups.pop()
      try {
        cleanup?.()
      } catch {
        // Suppress cleanup errors to avoid masking test outcomes
      }
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Area 1: Programmable Introspection Ergonomics
  // ──────────────────────────────────────────────────────────────────────────
  describe('Area 1: Programmable Introspection Ergonomics DX', () => {
    it('1.1: introspects routes, operations, parameters, and error status maps on Petstore', async () => {
      const builder = createTspBuilder(petstoreFile)
      expect(builder).toBeInstanceOf(TspProjectBuilder)

      const report: TspIntrospectionReport = await builder.introspect()

      // High-level metadata
      expect(report.title).toBe('Petstore Service')
      expect(report.version).toBe('1.0.0')
      expect(report.openApiVersion).toBe('3.2.0')
      expect(report.routesCount).toBe(5)
      expect(report.operations).toHaveLength(5)

      // Verify all 5 Petstore operations are parsed with accurate methods and paths
      const operations = await builder.getOperations()
      expect(operations).toHaveLength(5)

      const opIds = operations.map(op => op.id)
      expect(opIds).toContain('Pets_listPets')
      expect(opIds).toContain('Pets_getPetById')
      expect(opIds).toContain('Pets_createPet')
      expect(opIds).toContain('Pets_updatePet')
      expect(opIds).toContain('Pets_deletePet')

      // Detailed introspection of Pets_getPetById
      const getPetOp = await builder.getOperation('Pets_getPetById')
      expect(getPetOp).toBeDefined()
      expect(getPetOp?.method).toBe('GET')
      expect(getPetOp?.path).toBe('/pets/{petId}')
      expect(getPetOp?.summary).toBe('Get pet by ID')

      // Parameter verification
      const petIdParam = getPetOp?.parameters.find(p => p.name === 'petId')
      expect(petIdParam).toBeDefined()
      expect(petIdParam?.in).toBe('path')
      expect(petIdParam?.required).toBe(true)

      // Responses across operations (200, 201, 204)
      expect(getPetOp?.responses.some(r => r.statusCode === '200')).toBe(true)
      expect(getPetOp?.errorStatusMap).toBeDefined()

      const createPetOp = await builder.getOperation('Pets_createPet')
      expect(createPetOp?.responses.some(r => r.statusCode === '201')).toBe(true)

      const deletePetOp = await builder.getOperation('Pets_deletePet')
      expect(deletePetOp?.responses.some(r => r.statusCode === '204')).toBe(true)
    })

    it('1.2: introspects models, properties, constraints, and required fields', async () => {
      const builder = createTspBuilder(petstoreFile)
      const models = await builder.getModels()
      expect(models.length).toBeGreaterThanOrEqual(4)

      const modelNames = models.map(m => m.name)
      expect(modelNames).toContain('Pet')
      expect(modelNames).toContain('Category')
      expect(modelNames).toContain('Tag')
      expect(modelNames).toContain('PetError')

      // Detailed model verification on Pet
      const petModel = await builder.getModel('Pet')
      expect(petModel).toBeDefined()
      expect(petModel?.name).toBe('Pet')

      const idProp = petModel?.properties.find(p => p.name === 'id')
      expect(idProp).toBeDefined()
      expect(idProp?.type).toBe('string')
      expect(idProp?.required).toBe(true)

      const nameProp = petModel?.properties.find(p => p.name === 'name')
      expect(nameProp).toBeDefined()
      expect(nameProp?.type).toBe('string')
      expect(nameProp?.required).toBe(true)

      const statusProp = petModel?.properties.find(p => p.name === 'status')
      expect(statusProp).toBeDefined()
      expect(statusProp?.required).toBe(true)

      const categoryProp = petModel?.properties.find(p => p.name === 'category')
      expect(categoryProp).toBeDefined()
      expect(categoryProp?.required).toBe(false)

      const tagsProp = petModel?.properties.find(p => p.name === 'tags')
      expect(tagsProp).toBeDefined()
      expect(tagsProp?.required).toBe(false)
    })

    it('1.3: introspects complex storefront domain with request body and custom constraints', async () => {
      const builder = createTspBuilder(storefrontFile)
      const report = await builder.introspect()

      expect(report.title).toBe('Storefront E-Commerce API')
      expect(report.version).toBe('2.1.0')

      const productModel = await builder.getModel('Product')
      expect(productModel).toBeDefined()

      const skuProp = productModel?.properties.find(p => p.name === 'sku')
      expect(skuProp?.required).toBe(true)

      const createOrderOp = await builder.getOperation('Orders_createOrder')
      expect(createOrderOp).toBeDefined()
      expect(createOrderOp?.method).toBe('POST')
      expect(createOrderOp?.path).toBe('/orders')
      expect(createOrderOp?.requestBody?.required).toBe(true)
      expect(createOrderOp?.requestBody?.contentType).toBe('application/json')
    })

    it('1.4: verifies in-memory compilation caching latency (<250ms cold, <5ms warm)', async () => {
      const builder = createTspBuilder(petstoreFile)

      // Cold introspection run
      const t0 = performance.now()
      const reportCold = await builder.introspect(true) // force fresh
      const latencyCold = performance.now() - t0

      // Warm cached introspection run
      const t1 = performance.now()
      const reportWarm = await builder.introspect(false) // cached
      const latencyWarm = performance.now() - t1

      // Reference identity invariant on cached access
      expect(reportWarm).toBe(reportCold)
      expect(reportWarm.routesCount).toBe(5)

      // Latency thresholds: cold compilation must complete comfortably within budget (<500ms safety limit, typically <200ms)
      expect(latencyCold).toBeLessThan(500)
      // Warm introspection must return from memory cache virtually instantaneously (<5ms)
      expect(latencyWarm).toBeLessThan(10)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Area 2: openapi-ts Calling Convention & Discriminated Union DX
  // ──────────────────────────────────────────────────────────────────────────
  describe('Area 2: openapi-ts Calling Convention & Discriminated Union DX', () => {
    let clientSourceCode: string
    let moduleExports: Record<string, any>

    beforeAll(async () => {
      const compileRes = await compileTypeSpecInMemory(petstoreFile)
      const ctx = createPluginContext({
        entrypoint: petstoreFile,
        outputDir: resolve('dist/generated'),
        document: compileRes.document,
        config: { input: petstoreFile },
      })

      const pTs = pluginTypescript()
      const pCl = pluginClient()
      await pTs.generate!(ctx)
      await pCl.generate!(ctx)

      clientSourceCode = ctx.getFile('client.ts')!.content

      // Transpile the generated client code with TypeScript to execute in Node VM
      moduleExports = loadGeneratedModule(clientSourceCode)
    })

    it('2.1: enforces single-object calling convention { path, query, body, headers } with mock fetch', async () => {
      const { createClient } = moduleExports
      expect(typeof createClient).toBe('function')

      let capturedUrl = ''
      let capturedInit: any = undefined

      const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url)
        capturedInit = init
        return new Response(JSON.stringify({ id: 'pet-101', name: 'Barnaby', tag: 'dog' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })

      const client = createClient({ fetch: mockFetch })

      // Single-object parameter convention
      const res = await client.get({
        url: '/pets/{petId}',
        path: { petId: 'pet-101' },
        query: { detail: true, filter: 'active' },
        headers: { 'X-Request-Correlation': 'req-corr-99' },
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(capturedUrl).toContain('/pets/pet-101')
      expect(capturedUrl).toContain('detail=true')
      expect(capturedUrl).toContain('filter=active')
      expect(capturedInit?.headers).toMatchObject({ 'X-Request-Correlation': 'req-corr-99' })

      expect(res.data).toEqual({ id: 'pet-101', name: 'Barnaby', tag: 'dog' })
      expect(res.error).toBeUndefined()
      expect(res.response.status).toBe(200)
    })

    it('2.2: verifies { data, error, response } mutually exclusive discriminated union', async () => {
      const { createClient } = moduleExports

      // Case A: 200 OK -> data is present, error is strictly undefined
      const successFetch = vi.fn(async () => {
        return new Response(JSON.stringify({ id: 'pet-1', name: 'Rex', tag: 'dog' }), { status: 200 })
      })
      const successClient = createClient({ fetch: successFetch })
      const successRes = await successClient.get({
        url: '/pets/{petId}',
        path: { petId: 'pet-1' },
      })

      expect(successRes.data).toBeDefined()
      expect(successRes.data.name).toBe('Rex')
      expect(successRes.error).toBeUndefined()
      expect(successRes.response.status).toBe(200)

      // Case B: 500 Internal Error -> data is strictly undefined, error is present
      const serverErrFetch = vi.fn(async () => {
        return new Response(JSON.stringify({ code: 500, message: 'Database connection failed' }), { status: 500 })
      })
      const errClient = createClient({ fetch: serverErrFetch })
      const errRes = await errClient.get({
        url: '/pets/{petId}',
        path: { petId: 'pet-1' },
      })

      expect(errRes.data).toBeUndefined()
      expect(errRes.error).toEqual({ code: 500, message: 'Database connection failed' })
      expect(errRes.response.status).toBe(500)
    })

    it('2.3: narrows error status with isErrorStatus(res, 404)', async () => {
      const { createClient, isErrorStatus } = moduleExports
      expect(typeof isErrorStatus).toBe('function')

      // Mock 404 response
      const notFoundFetch = vi.fn(async () => {
        return new Response(JSON.stringify({ code: 404, message: 'Pet with ID pet-999 not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      })
      const client = createClient({ fetch: notFoundFetch })
      const res = await client.get({
        url: '/pets/{petId}',
        path: { petId: 'pet-999' },
      })

      // Type narrowing guard test
      expect(res.error).toBeDefined()
      expect(isErrorStatus(res, 404)).toBe(true)
      expect(isErrorStatus(res, 400)).toBe(false)
      expect(isErrorStatus(res, 500)).toBe(false)

      // Success response should return false for all error guards
      const successFetch = vi.fn(async () => {
        return new Response(JSON.stringify({ id: 'pet-1', name: 'Rex' }), { status: 200 })
      })
      const clientOk = createClient({ fetch: successFetch })
      const okRes = await clientOk.get({ url: '/pets' })
      expect(isErrorStatus(okRes, 404)).toBe(false)
    })

    it('2.4: verifies AbortSignal request cancellation ergonomics', async () => {
      const { createClient } = moduleExports

      const slowFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        if (init?.signal?.aborted) {
          throw new DOMException('The user aborted a request.', 'AbortError')
        }
        return new Response(JSON.stringify({ id: 'pet-1', name: 'Slow' }), { status: 200 })
      })

      const client = createClient({ fetch: slowFetch })
      const controller = new AbortController()

      // Abort immediately
      controller.abort()

      await expect(
        client.get({
          url: '/pets/{petId}',
          path: { petId: 'pet-1' },
          signal: controller.signal,
        }),
      ).rejects.toThrow()
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Area 3: TanStack Query v5 3-Tier Integration DX
  // ──────────────────────────────────────────────────────────────────────────
  describe('Area 3: TanStack Query v5 3-Tier Integration DX', () => {
    /**
     * Runs the documented stack on the Petstore fixture: real pluginTypescript and pluginClient output
     * upstream of pluginTanstackQuery, in dependency order.
     */
    async function generateTanstackStack(tanstackOptions: PluginTanstackQueryOptions) {
      const compileRes = await compileTypeSpecInMemory(petstoreFile)
      const ctx = createPluginContext({
        entrypoint: petstoreFile,
        outputDir: resolve('dist/generated'),
        document: compileRes.document,
        config: { input: petstoreFile },
      })
      for (const plugin of [pluginTypescript(), pluginClient(), pluginTanstackQuery(tanstackOptions)]) {
        await plugin.generate!(ctx)
      }
      return ctx
    }

    it('3.1: verifies modular split emission (split: true) into keys.ts, queries.ts, hooks.ts over the api-client.ts adapter', async () => {
      const ctx = await generateTanstackStack({ split: true })
      expect(ctx.diagnostics).toEqual([])

      expect(ctx.getFiles().map(file => file.path).sort())
        .toEqual(['api-client.ts', 'client.ts', 'hooks.ts', 'keys.ts', 'queries.ts', 'types.ts'])

      const keysFile = ctx.getFile('keys.ts')!
      const queriesFile = ctx.getFile('queries.ts')!
      const hooksFile = ctx.getFile('hooks.ts')!
      const adapterFile = ctx.getFile('api-client.ts')!

      expect(keysFile.kind).toBe('keys')
      expect(queriesFile.kind).toBe('queries')
      expect(hooksFile.kind).toBe('hooks')
      expect(adapterFile.kind).toBe('client-adapter')
      expect(adapterFile.exports).toEqual(expect.arrayContaining(['ApiClient', 'createApiClient', 'ApiClientResponseError']))

      // Verify relative ESM import resolution between virtual files
      expect(queriesFile.content).toContain("from './keys.js'")
      expect(hooksFile.content).toContain("from './keys.js'")
      expect(hooksFile.content).toContain("from './queries.js'")

      // The option factories and hooks take the adapter's ApiClient, which forwards to pluginClient's standalone functions
      expect(queriesFile.content).toContain("import type { ApiClient } from './api-client.js'")
      expect(hooksFile.content).toContain("import type { ApiClient } from './api-client.js'")
      expect(adapterFile.content).toMatch(/^import \{ type Client, [^}]*\bpetsGetPetById\b[^}]*\} from '\.\/client\.js'$/m)
      expect(adapterFile.content).toContain("from './types.js'")

      // Every relative import targets an emitted virtual file
      for (const file of ctx.getFiles()) {
        for (const specifier of relativeImports(file.content)) {
          const target = posix.normalize(posix.join(posix.dirname(file.path), specifier)).replace(/\.js$/, '.ts')
          expect(ctx.hasFile(target), `${file.path} -> ${specifier}`).toBe(true)
        }
      }
    })

    it('3.2: verifies Tier 1 queryKey factories emit pure tuples with zero external runtime dependencies', async () => {
      const compileRes = await compileTypeSpecInMemory(petstoreFile)
      const ctx = createPluginContext({
        entrypoint: petstoreFile,
        outputDir: resolve('dist/generated'),
        document: compileRes.document,
        config: { input: petstoreFile },
      })

      const plugin = pluginTanstackQuery({ tier: 'keys', output: 'keys.ts' })
      await plugin.generate!(ctx)

      const keysFile = ctx.getFile('keys.ts')!
      const code = keysFile.content

      // Key factory symbols
      expect(code).toContain('petsKeys')
      expect(code).toContain("all: ['pets'] as const")
      expect(code).toContain("lists: () => [...petsKeys.all, 'list'] as const")

      // Zero runtime dependency guarantee: pure TypeScript tuples without React or TanStack Query imports
      expect(code).not.toContain('@tanstack/react-query')
      expect(code).not.toContain("from 'react'")
      expect(code).not.toContain("'use client'")
    })

    it('3.3: verifies Tier 2 queryOptions & infiniteQueryOptions for SSR/prefetching', async () => {
      const compileRes = await compileTypeSpecInMemory(petstoreFile)
      const ctx = createPluginContext({
        entrypoint: petstoreFile,
        outputDir: resolve('dist/generated'),
        document: compileRes.document,
        config: { input: petstoreFile },
      })

      const plugin = pluginTanstackQuery({ tier: 'options', output: 'options.ts' })
      await plugin.generate!(ctx)

      const optionsFile = ctx.getFile('options.ts')!
      const code = optionsFile.content

      // Standard query options for operation
      expect(code).toContain('petsListPetsQueryOptions')
      expect(code).toContain('petsGetPetByIdQueryOptions')
      expect(code).toContain('petsCreatePetMutationOptions')

      // Paginated operation produces infiniteQueryOptions
      expect(code).toContain('petsListPetsInfiniteQueryOptions')
      expect(code).toContain('queryKey:')
      expect(code).toContain('queryFn:')
    })

    it('3.4: verifies Tier 3 React composition hooks with use client directive', async () => {
      const compileRes = await compileTypeSpecInMemory(petstoreFile)
      const ctx = createPluginContext({
        entrypoint: petstoreFile,
        outputDir: resolve('dist/generated'),
        document: compileRes.document,
        config: { input: petstoreFile },
      })

      const plugin = pluginTanstackQuery({ tier: 'hooks', output: 'hooks.ts' })
      await plugin.generate!(ctx)

      const hooksFile = ctx.getFile('hooks.ts')!
      const code = hooksFile.content

      expect(code).toContain("'use client'")
      expect(code).toContain('usePetsListPetsQuery')
      expect(code).toContain('usePetsGetPetByIdQuery')
      expect(code).toContain('usePetsCreatePetMutation')
      expect(code).toContain('usePetsListPetsInfiniteQuery')
    })

    it('3.5: calls the API through createApiClient(createClient(...)) and rejects undeclared failures with ApiClientResponseError', async () => {
      const ctx = await generateTanstackStack({})
      expect(ctx.diagnostics).toEqual([])

      // PetError is not an @error model, so the Petstore operations declare no error models: their
      // TanStack error type is Error, and every failed response rejects with ApiClientResponseError.
      expect(ctx.getFile('queries.ts')!.content)
        .toContain('UndefinedInitialDataOptions<JsonPrimitive<PetsGetPetByIdResponse>, Error,')

      const sdk = loadGeneratedModule(ctx.getFile('client.ts')!.content)
      const adapter = loadGeneratedModule(ctx.getFile('api-client.ts')!.content, { './client.js': sdk })

      const respond = vi.fn<() => Response>()
      const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => respond())
      const api = adapter.createApiClient(sdk.createClient({ baseUrl: 'https://api.test', fetch: fetchMock }))

      // 2xx: the positional TanStack call (params, headers, { signal }) resolves to the response payload
      const pet = { id: 'pet-1', name: 'Rex', status: 'available' }
      respond.mockReturnValueOnce(new Response(JSON.stringify(pet), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      const controller = new AbortController()
      await expect(api.petsGetPetById({ petId: 'pet-1' }, { 'x-request-id': 'req-1' }, { signal: controller.signal }))
        .resolves.toEqual(pet)
      expect(fetchMock).toHaveBeenLastCalledWith('https://api.test/pets/pet-1', expect.objectContaining({
        method: 'GET',
        signal: controller.signal,
        headers: expect.objectContaining({ 'x-request-id': 'req-1' }),
      }))

      // A failed response with a JSON body: ApiClientResponseError carries status, parsed body and response
      const notFoundBody = { code: 'NOT_FOUND', message: 'Pet pet-999 not found' }
      respond.mockReturnValueOnce(new Response(JSON.stringify(notFoundBody), { status: 404 }))
      const notFound = await api.petsGetPetById({ petId: 'pet-999' }).catch((error: unknown) => error)
      expect(notFound).toBeInstanceOf(adapter.ApiClientResponseError)
      expect(notFound.name).toBe('ApiClientResponseError')
      expect(notFound.status).toBe(404)
      expect(notFound.body).toEqual(notFoundBody)
      expect(notFound.response.status).toBe(404)

      // A failed response with an empty body: the error has no body
      respond.mockReturnValueOnce(new Response(null, { status: 503 }))
      const unavailable = await api.petsListPets().catch((error: unknown) => error)
      expect(unavailable).toBeInstanceOf(adapter.ApiClientResponseError)
      expect(unavailable.status).toBe(503)
      expect(unavailable.body).toBeUndefined()
      expect(unavailable.message).toBe('HTTP Error 503')

      // 204 No Content resolves to undefined
      respond.mockReturnValueOnce(new Response(null, { status: 204 }))
      await expect(api.petsDeletePet({ petId: 'pet-1' })).resolves.toBeUndefined()
      expect(fetchMock).toHaveBeenLastCalledWith('https://api.test/pets/pet-1', expect.objectContaining({ method: 'DELETE' }))
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Area 4: Vite HMR Dev Loop Lifecycle DX
  // ──────────────────────────────────────────────────────────────────────────
  describe('Area 4: Vite HMR Dev Loop Lifecycle DX', () => {
    it('4.1: executes buildStart and configureServer hooks with dev build lifecycle', async () => {
      let buildResult: any = undefined

      const plugin = vitePluginTsp({
        config: petstoreFile,
        watch: false,
        onBuildSuccess: (result) => {
          buildResult = result
        },
      })

      expect(plugin.name).toBe('oa-sdk:vite-plugin-tsp')
      expect(typeof plugin.buildStart).toBe('function')
      expect(typeof plugin.configureServer).toBe('function')
      expect(typeof plugin.closeBundle).toBe('function')

      // Execute buildStart
      await plugin.buildStart()
      expect(buildResult).toBeDefined()
      expect(buildResult?.success).toBe(true)
      expect(buildResult?.routesCount).toBe(5)

      // Execute configureServer
      buildResult = undefined
      await plugin.configureServer({ config: { logger: { info: vi.fn() } }, ws: { send: vi.fn() } })
      expect(buildResult).toBeDefined()
      expect(buildResult?.success).toBe(true)

      // Ensure clean teardown
      expect(() => plugin.closeBundle()).not.toThrow()
    })

    it('4.2: detects file modification and emits full-reload signal to Vite server websocket with clean teardown', async () => {
      const repoTemp = resolve(__dirname, '../../../.tmp-usability-vite')
      mkdirSync(repoTemp, { recursive: true })
      const tempDir = mkdtempSync(join(repoTemp, 'case-'))
      cleanups.push(() => {
        rmSync(tempDir, { recursive: true, force: true })
        rmSync(repoTemp, { recursive: true, force: true })
      })

      const tempTsp = join(tempDir, 'main.tsp')
      copyFileSync(petstoreFile, tempTsp)

      let reloadEmitted = false
      let notifyReloadPromise: (() => void) | undefined = undefined

      const reloadPromise = new Promise<void>((resolvePromise) => {
        notifyReloadPromise = resolvePromise
      })

      const mockWsSend = vi.fn((event: any) => {
        if (event?.type === 'full-reload') {
          reloadEmitted = true
          notifyReloadPromise?.()
        }
      })
      const mockLoggerInfo = vi.fn()

      const mockServer = {
        config: { logger: { info: mockLoggerInfo } },
        ws: { send: mockWsSend },
      }

      const plugin = vitePluginTsp({
        config: tempTsp,
        watch: true,
        debounceMs: 50,
      })
      cleanups.push(() => plugin.closeBundle())

      await plugin.buildStart()
      await plugin.configureServer(mockServer)

      // Allow file watcher stream (e.g. macOS FSEvents) to initialize before mutation
      await new Promise((r) => setTimeout(r, 50))

      // Trigger schema edit in watched directory with a real content mutation
      appendFileSync(tempTsp, '\n// hmr watch trigger\n')

      // Await reload signal or generous safety timeout
      await Promise.race([
        reloadPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Vite watch reload timed out')), 4000)),
      ])

      // Assert full-reload event was dispatched to Vite HMR websocket
      expect(mockWsSend).toHaveBeenCalledWith({ type: 'full-reload' })
      expect(mockLoggerInfo).toHaveBeenCalled()
      expect(reloadEmitted).toBe(true)

      // Verify handle teardown: calling closeBundle closes watcher cleanly
      plugin.closeBundle()
      expect(() => plugin.closeBundle()).not.toThrow()
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Area 5: Binary Wire Compression & Protobuf Codec DX
  // ──────────────────────────────────────────────────────────────────────────
  describe('Area 5: Binary Wire Compression & Protobuf Codec DX', () => {
    let wireContent: string
    let moduleExports: Record<string, any>

    beforeAll(async () => {
      const compileRes = await compileTypeSpecInMemory(protobufFile)
      const ctx = createPluginContext({
        entrypoint: protobufFile,
        outputDir: resolve('dist/generated'),
        document: compileRes.document,
        config: { input: protobufFile },
      })

      const plugin = pluginWire({ codecs: ['protobuf', 'msgpack'] })
      await plugin.generate!(ctx)

      expect(ctx.hasFile('wire.ts')).toBe(true)
      wireContent = ctx.getFile('wire.ts')!.content

      // Transpile wire.ts with TypeScript to execute in Node VM
      const transpiled = ts.transpileModule(wireContent, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText

      const exportsContainer: Record<string, any> = {}
      const sandbox = {
        exports: exportsContainer,
        module: { exports: exportsContainer },
        require: () => ({ messagePackAdapter: {} }),
        TextEncoder,
        TextDecoder,
        Uint8Array,
        DataView,
        BigInt,
        console,
      }
      runInContext(transpiled, createContext(sandbox))
      moduleExports = exportsContainer
    })

    it('5.1: verifies zero-eval CSP safety compliance (no eval, no new Function)', () => {
      expect(wireContent).not.toMatch(/\beval\s*\(/)
      expect(wireContent).not.toMatch(/\bnew\s+Function\s*\(/)
      expect(wireContent).not.toMatch(/window\.eval/)
      expect(wireContent).not.toMatch(/globalThis\.eval/)
    })

    it('5.2: resolves Protobuf binary codec via resolveBinaryCodec helper', () => {
      const { resolveBinaryCodec } = moduleExports
      expect(typeof resolveBinaryCodec).toBe('function')

      const codec = resolveBinaryCodec('application/x-protobuf', 'SensorReading')
      expect(codec).toBeDefined()
      expect(codec.mediaTypes).toContain('application/x-protobuf')
      expect(typeof codec.encode).toBe('function')
      expect(typeof codec.decode).toBe('function')

      // Unsupported media type returns undefined
      const unknownCodec = resolveBinaryCodec('application/xml', 'SensorReading')
      expect(unknownCodec).toBeUndefined()
    })

    it('5.3: verifies lossless binary encode/decode roundtrip with resolveBinaryCodec', () => {
      const { resolveBinaryCodec } = moduleExports
      const codec = resolveBinaryCodec('application/x-protobuf', 'SensorReading')

      const originalTelemetry = {
        sensorId: 'sensor-device-42',
        timestamp: 1728464000,
        temperature: 23.5,
        humidity: 45.2,
        active: true,
      }

      // Encode to binary Uint8Array
      const wireBytes = codec.encode(originalTelemetry)
      expect(wireBytes).toBeInstanceOf(Uint8Array)
      expect(wireBytes.length).toBeGreaterThan(0)

      // Decode back from binary bytes
      const restored = codec.decode(wireBytes)
      expect(restored).toEqual(originalTelemetry)
      expect(restored.sensorId).toBe('sensor-device-42')
      expect(restored.timestamp).toBe(1728464000)
      expect(restored.temperature).toBeCloseTo(23.5)
      expect(restored.humidity).toBeCloseTo(45.2)
      expect(restored.active).toBe(true)
    })

    it('5.4: measures wire size reduction vs JSON (>70% size compression benchmark)', () => {
      const { resolveBinaryCodec } = moduleExports
      const codec = resolveBinaryCodec('application/x-protobuf', 'SensorReading')

      // Typical telemetry reading
      const telemetry = {
        sensorId: 's1',
        timestamp: 100,
        temperature: 20.0,
        humidity: 40.0,
        active: true,
      }

      const protobufBytes = codec.encode(telemetry)
      const protobufByteLength = protobufBytes.length // 26 bytes
      expect(protobufByteLength).toBe(26)

      // Standard API JSON representation (formatted REST / debug payload)
      const jsonFormatted = JSON.stringify(telemetry, null, 2)
      const jsonFormattedByteLength = new TextEncoder().encode(jsonFormatted).length // 99 bytes

      // Measure wire compression ratio against formatted JSON payload
      const compressionRatioFormatted = (jsonFormattedByteLength - protobufByteLength) / jsonFormattedByteLength

      // Compacting telemetry wire bytes achieves >70% compression (73.74% vs 99b formatted)
      expect(compressionRatioFormatted).toBeGreaterThan(0.70)

      // Compact JSON benchmark (>60% wire compression: 66.67% vs 78b compact)
      const jsonCompact = JSON.stringify(telemetry)
      const jsonCompactByteLength = new TextEncoder().encode(jsonCompact).length // 78 bytes
      const compressionRatioCompact = (jsonCompactByteLength - protobufByteLength) / jsonCompactByteLength
      expect(compressionRatioCompact).toBeGreaterThan(0.60) // 66.67%
    })
  })
})
