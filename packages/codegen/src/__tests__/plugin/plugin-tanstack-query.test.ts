import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { OasDocument } from '@oa-sdk/parser'
import { createPluginContext } from '../../plugin/context.js'
import { runTspPluginPipeline } from '../../plugin/runner.js'
import { pluginClient } from '../../plugin/plugins/client.js'
import { pluginTanstackQuery, type PluginTanstackQueryOptions } from '../../plugin/plugins/tanstack-query.js'
import { pluginTypescript } from '../../plugin/plugins/typescript.js'
import { toFileRecord, typecheckGeneratedFiles } from './helpers/typecheck-generated.js'

const petstoreFile = resolve(__dirname, '../../../../../test/e2e/typespec-plugin/fixtures/petstore/main.tsp')
const reservedNamesFile = resolve(__dirname, '../../../../../test/e2e/typespec-plugin/fixtures/reserved-names/main.tsp')

/** Runs the documented stack (pluginTypescript + pluginClient + pluginTanstackQuery) through the pipeline. */
async function generateStack(
  tanstackOptions: PluginTanstackQueryOptions = {},
  source: { document: OasDocument } | { input: string } = { document: createSampleOasDoc() },
  clientOptions: Parameters<typeof pluginClient>[0] = {},
) {
  const plugins = [pluginTypescript(), pluginClient(clientOptions), pluginTanstackQuery(tanstackOptions)]
  return 'document' in source
    ? runTspPluginPipeline({ input: 'main.tsp', dryRun: true, plugins }, { document: source.document })
    : runTspPluginPipeline({ input: source.input, dryRun: true, plugins })
}

/** Writes the generated types/client/adapter modules to a temporary directory and imports them. */
async function importAdapter(files: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-tanstack-adapter-'))
  for (const name of ['types.ts', 'client.ts', 'api-client.ts']) writeFileSync(join(directory, name), files[name]!)
  const sdk = await import(join(directory, 'client.ts'))
  const adapter = await import(join(directory, 'api-client.ts'))
  return { sdk, adapter, cleanup: () => rmSync(directory, { recursive: true, force: true }) }
}

/**
 * Minimal stand-in for an axios instance (`request` with `validateStatus: () => true`). Like axios, it
 * returns the raw text for `responseType: 'text'`; otherwise it applies axios's default JSON parsing,
 * which keeps text that is not JSON, so an empty body arrives as `''`.
 */
function fakeAxios(respond: () => { status: number; body: string }) {
  return {
    request: vi.fn(async (config: { responseType?: string }) => {
      const { status, body } = respond()
      let data: unknown = body
      if (config.responseType !== 'text' && body) {
        try {
          data = JSON.parse(body)
        } catch {
          data = body
        }
      }
      return { status, statusText: '', headers: {}, data }
    }),
  }
}

function relativeImports(code: string): string[] {
  return Array.from(code.matchAll(/from '(\.{1,2}\/[^']+)'/g), match => match[1]!)
}

function createSampleOasDoc(): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Test Petstore', version: '1.0.0' },
    paths: {
      '/pets': {
        get: {
          operationId: 'listPets',
          tags: ['pets'],
          summary: 'List all pets',
          parameters: [
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer' },
            },
            {
              name: 'offset',
              in: 'query',
              required: false,
              schema: { type: 'integer' },
            },
          ],
          responses: {
            '200': {
              description: 'A paged array of pets',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      $ref: '#/components/schemas/Pet',
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: 'createPet',
          tags: ['pets'],
          summary: 'Create a pet',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/NewPet',
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Created pet',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/Pet',
                  },
                },
              },
            },
          },
        },
      },
      '/pets/{id}': {
        get: {
          operationId: 'getPetById',
          tags: ['pets'],
          summary: 'Info for a specific pet',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Expected response to a valid request',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/Pet',
                  },
                },
              },
            },
            '404': {
              description: 'Pet not found',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/Error',
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Pet: {
          type: 'object',
          required: ['id', 'name'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            tag: { type: 'string' },
          },
        },
        NewPet: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            tag: { type: 'string' },
          },
        },
        Error: {
          type: 'object',
          required: ['code', 'message'],
          properties: {
            code: { type: 'integer' },
            message: { type: 'string' },
          },
        },
      },
    },
  }
}

describe('pluginTanstackQuery', () => {
  it('declares correct metadata and dependencies', () => {
    const plugin = pluginTanstackQuery()
    expect(plugin.name).toBe('tanstack-query')
    expect(plugin.dependencies).toEqual(['typescript', 'client'])
    expect(typeof plugin.generate).toBe('function')
  })

  it('generates unified single-file queries.ts by default', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginTanstackQuery()
    await plugin.generate!(context)

    const file = context.getFile('queries.ts')
    expect(file).toBeDefined()
    expect(file?.sourcePlugin).toBe('tanstack-query')
    expect(file?.kind).toBe('queries')

    const content = file!.content
    // Check Tier 1: Key Factories
    expect(content).toContain('petsKeys')
    // Check Tier 2: Options
    expect(content).toContain('listPetsQueryOptions')
    expect(content).toContain('createPetMutationOptions')
    expect(content).toContain('getPetByIdQueryOptions')
    // Check Tier 3: React Hooks
    expect(content).toContain('useListPetsQuery')
    expect(content).toContain('useCreatePetMutation')
    expect(content).toContain('useGetPetByIdQuery')
    expect(content).toContain("'use client'")
  })

  it('generates infiniteQueryOptions for paginated endpoints', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginTanstackQuery()
    await plugin.generate!(context)

    const file = context.getFile('queries.ts')
    expect(file?.content).toContain('listPetsInfiniteQueryOptions')
  })

  it('supports custom output path and custom clientName', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginTanstackQuery({
      output: 'src/custom-queries.ts',
      clientName: 'CustomClient',
    })
    await plugin.generate!(context)

    expect(context.hasFile('src/custom-queries.ts')).toBe(true)
    const file = context.getFile('src/custom-queries.ts')
    expect(file?.content).toContain('client: CustomClient')
  })

  it('supports selective tier filtering: keys only', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginTanstackQuery({
      tier: 'keys',
      output: 'keys.ts',
    })
    await plugin.generate!(context)

    const file = context.getFile('keys.ts')
    expect(file).toBeDefined()
    expect(file?.content).toContain('petsKeys')
    expect(file?.content).not.toContain('useListPetsQuery')
    expect(file?.content).not.toContain('listPetsQueryOptions')
  })

  it('supports selective tier filtering: options only', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginTanstackQuery({
      tier: 'options',
      output: 'options.ts',
    })
    await plugin.generate!(context)

    const file = context.getFile('options.ts')
    expect(file).toBeDefined()
    expect(file?.content).toContain('listPetsQueryOptions')
    expect(file?.content).not.toContain('useListPetsQuery')
    // The key factories are inlined; no split-mode sibling module is imported.
    expect(file?.content).toContain('export const petsKeys')
    expect(file?.content).not.toContain("from './keys.js'")
    expect(file?.content).not.toContain("from './queries.js'")
  })

  it('supports selective tier filtering: hooks only', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginTanstackQuery({
      tier: 'hooks',
      output: 'hooks.ts',
    })
    await plugin.generate!(context)

    const file = context.getFile('hooks.ts')
    expect(file).toBeDefined()
    expect(file?.content).toContain('useListPetsQuery')
    expect(file?.content).toContain("'use client'")
    // Keys and option factories the hooks use are in the same module.
    expect(file?.content).toContain('export function listPetsQueryOptions')
    expect(file?.content).not.toContain("from './keys.js'")
    expect(file?.content).not.toContain("from './queries.js'")
  })

  it('supports split emission (split: true) into keys.ts, queries.ts, hooks.ts', async () => {
    const result = await generateStack({ split: true })
    expect(result.success).toBe(true)
    const files = toFileRecord(result.files)

    expect(Object.keys(files).sort()).toEqual(['api-client.ts', 'client.ts', 'hooks.ts', 'keys.ts', 'queries.ts', 'types.ts'])
    const kinds = Object.fromEntries(result.files.map(file => [file.path, file.kind]))
    expect(kinds).toMatchObject({ 'keys.ts': 'keys', 'queries.ts': 'queries', 'hooks.ts': 'hooks', 'api-client.ts': 'client-adapter' })

    // Verify inter-file imports: every relative import targets an emitted module.
    expect(files['queries.ts']).toContain("from './keys.js'")
    expect(files['hooks.ts']).toContain("from './keys.js'")
    expect(files['hooks.ts']).toContain("from './queries.js'")
    expect(files['queries.ts']).toContain("import type { ApiClient } from './api-client.js'")
    for (const [path, code] of Object.entries(files)) {
      for (const specifier of relativeImports(code)) {
        expect(files[specifier.replace(/^\.\//, '').replace(/\.js$/, '.ts')], `${path} -> ${specifier}`).toBeDefined()
      }
    }
  })

  it('emits queries that type-check against the pluginClient SDK through the generated adapter', async () => {
    for (const split of [false, true]) {
      const result = await generateStack({ split })
      expect(result.success).toBe(true)
      const files = toFileRecord(result.files)
      expect(files['api-client.ts']).toContain('export function createApiClient(client?: Client): ApiClient')

      // queries.ts holds the option factories in both modes (combined: together with keys and hooks).
      const usage = [
        "import { QueryClient } from '@tanstack/react-query'",
        "import { createClient } from './client.js'",
        "import { createApiClient } from './api-client.js'",
        "import { getPetByIdQueryOptions, createPetMutationOptions, listPetsInfiniteQueryOptions } from './queries.js'",
        "const api = createApiClient(createClient({ baseUrl: 'https://api.test' }))",
        'const queryClient = new QueryClient()',
        "export const pet = queryClient.fetchQuery(getPetByIdQueryOptions(api, { id: 'p1' }))",
        "export const created = createPetMutationOptions(api).mutationFn?.({ body: { name: 'Rex' } }, {} as never)",
        'export const pages = listPetsInfiniteQueryOptions(api, { limit: 10 })',
        'export async function petName(): Promise<string> { return (await pet).name }',
      ].join('\n')
      expect(typecheckGeneratedFiles({ files: { ...files, 'usage.ts': usage }, packages: ['@tanstack/react-query'] }), `split=${split}`)
        .toEqual([])
    }

    // The TypeSpec petstore fixture as well (operationIds with namespace prefixes).
    const petstore = await generateStack({ split: true }, { input: petstoreFile })
    expect(petstore.success).toBe(true)
    expect(typecheckGeneratedFiles({ files: toFileRecord(petstore.files), packages: ['@tanstack/react-query'] })).toEqual([])
  })

  it('adapter methods forward to the SDK functions and resolve to the response payload', async () => {
    const result = await generateStack()
    const { sdk, adapter, cleanup } = await importAdapter(toFileRecord(result.files))
    try {
      const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ id: 'p1', name: 'Rex' }), { status: 200 }))
      const api = adapter.createApiClient(sdk.createClient({ baseUrl: 'https://api.test', fetch: fetchMock }))

      const controller = new AbortController()
      await expect(api.getPetById({ id: 'p1' }, { signal: controller.signal })).resolves.toEqual({ id: 'p1', name: 'Rex' })
      expect(fetchMock).toHaveBeenLastCalledWith('https://api.test/pets/p1', expect.objectContaining({ method: 'GET', signal: controller.signal }))

      await api.listPets({ limit: 5 })
      expect(fetchMock).toHaveBeenLastCalledWith('https://api.test/pets?limit=5', expect.anything())

      await api.createPet({ name: 'Rex' })
      expect(fetchMock).toHaveBeenLastCalledWith('https://api.test/pets', expect.objectContaining({ method: 'POST', body: '{"name":"Rex"}' }))
    } finally {
      cleanup()
    }
  })

  it('adapter rejections match the error type the TanStack code declares', async () => {
    const result = await generateStack()
    const files = toFileRecord(result.files)
    // getPetById declares a 404 Error model, so its TanStack error type is GetPetByIdError; listPets declares none (Error).
    expect(files['queries.ts']).toContain('QueryObserverOptions<JsonPrimitive<GetPetByIdResponse>, GetPetByIdError | Error,')
    expect(files['queries.ts']).toContain('QueryObserverOptions<JsonPrimitive<ListPetsResponse>, Error,')
    expect(files['api-client.ts']).toContain('return settleSdkResult(result, status => status === 404) as JsonPrimitive<GetPetByIdResponse>')

    const { sdk, adapter, cleanup } = await importAdapter(files)
    try {
      const respond = vi.fn<(url: string) => Response>()
      // throwOnError: true in the client configuration must not change what the adapter rejects with.
      const client = sdk.createClient({ baseUrl: 'https://api.test', fetch: async (url: string) => respond(url), throwOnError: true })
      const api = adapter.createApiClient(client)

      // A declared error status rejects with the parsed body (GetPetByIdError).
      respond.mockReturnValueOnce(new Response(JSON.stringify({ code: 404, message: 'nope' }), { status: 404 }))
      await expect(api.getPetById({ id: 'missing' })).rejects.toEqual({ code: 404, message: 'nope' })

      // An undeclared status rejects with an ApiClientResponseError carrying status, body and response.
      respond.mockReturnValueOnce(new Response(JSON.stringify({ reason: 'down' }), { status: 503 }))
      const undeclared = await api.getPetById({ id: 'p1' }).catch((error: unknown) => error)
      expect(undeclared).toBeInstanceOf(adapter.ApiClientResponseError)
      expect(undeclared).toBeInstanceOf(Error)
      expect(undeclared).toMatchObject({ name: 'ApiClientResponseError', status: 503, body: { reason: 'down' }, message: 'HTTP Error 503: {"reason":"down"}' })
      expect(undeclared.response.status).toBe(503)

      // A declared status without a body has nothing to reject with but the Error.
      respond.mockReturnValueOnce(new Response(null, { status: 404 }))
      await expect(api.getPetById({ id: 'missing' })).rejects.toMatchObject({ status: 404, body: undefined, message: 'HTTP Error 404' })

      // An operation without error models (TanStack error type Error) always rejects with the Error.
      respond.mockReturnValueOnce(new Response(JSON.stringify({ code: 500, message: 'boom' }), { status: 500 }))
      const untyped = await api.listPets().catch((error: unknown) => error)
      expect(untyped).toBeInstanceOf(adapter.ApiClientResponseError)
      expect(untyped).toMatchObject({ status: 500, body: { code: 500, message: 'boom' } })
    } finally {
      cleanup()
    }
  })

  it('selects the declared error body by the response entry OpenAPI matches (explicit status, NXX range, default)', async () => {
    const doc = createSampleOasDoc()
    const errorBody = { content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
    const petById = doc.paths?.['/pets/{id}']
    if (!petById || '$ref' in petById) throw new Error('the sample document declares /pets/{id} inline')
    petById.delete = {
      operationId: 'deletePet',
      tags: ['pets'],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        '204': { description: 'Deleted' },
        '401': { description: 'Unauthorized (no declared body)' },
        '404': { description: 'Not found', ...errorBody },
        '5XX': { description: 'Server error (ranges are not part of DeletePetError)', ...errorBody },
        default: { description: 'Unexpected error', ...errorBody },
      },
    }
    const result = await generateStack({}, { document: doc })
    expect(result.success).toBe(true)
    const files = toFileRecord(result.files)
    expect(files['queries.ts']).toContain('MutationObserverOptions<JsonPrimitive<unknown>, DeletePetError | Error,')
    expect(files['api-client.ts']).toContain('settleSdkResult(result, status => status === 404 || (status !== 401 && Math.trunc(status / 100) !== 5))')
    expect(typecheckGeneratedFiles({ files, packages: ['@tanstack/react-query'] })).toEqual([])

    const { sdk, adapter, cleanup } = await importAdapter(files)
    try {
      const respond = vi.fn<(url: string) => Response>()
      const api = adapter.createApiClient(sdk.createClient({ baseUrl: 'https://api.test', fetch: async (url: string) => respond(url) }))
      const body = (status: number) => new Response(JSON.stringify({ code: status, message: `status ${status}` }), { status })

      respond.mockReturnValueOnce(new Response(null, { status: 204 }))
      await expect(api.deletePet({ id: 'p1' })).resolves.toBeUndefined()
      for (const status of [404, 418]) {
        respond.mockReturnValueOnce(body(status))
        await expect(api.deletePet({ id: 'p1' }), `status ${status}`).rejects.toEqual({ code: status, message: `status ${status}` })
      }
      for (const status of [401, 503]) {
        respond.mockReturnValueOnce(body(status))
        await expect(api.deletePet({ id: 'p1' }), `status ${status}`).rejects.toBeInstanceOf(adapter.ApiClientResponseError)
      }
    } finally {
      cleanup()
    }
  })

  it('adapter rejections over the axios transport match the fetch transport (empty bodies reject with ApiClientResponseError)', async () => {
    const doc = createSampleOasDoc()
    const errorBody = { content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
    const petById = doc.paths?.['/pets/{id}']
    if (!petById || '$ref' in petById) throw new Error('the sample document declares /pets/{id} inline')
    petById.delete = {
      operationId: 'deletePet',
      tags: ['pets'],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        '204': { description: 'Deleted' },
        default: { description: 'Unexpected error', ...errorBody },
      },
    }

    for (const httpClient of ['axios', 'fetch'] as const) {
      const result = await generateStack({}, { document: doc }, { httpClient })
      expect(result.success).toBe(true)
      const files = toFileRecord(result.files)
      expect(files['api-client.ts']).toContain('settleSdkResult(result, () => true)')
      const { sdk, adapter, cleanup } = await importAdapter(files)
      try {
        let next = { status: 200, body: '' }
        const client = httpClient === 'axios'
          ? sdk.createClient({ baseUrl: 'https://api.test', axios: fakeAxios(() => next) })
          : sdk.createClient({ baseUrl: 'https://api.test', fetch: async () => new Response(next.status === 204 ? null : next.body, { status: next.status }) })
        const api = adapter.createApiClient(client)
        const call = async (status: number, body: string, run: () => Promise<unknown>) => {
          next = { status, body }
          return run().then(value => ({ resolved: value }), (error: unknown) => ({ rejected: error }))
        }

        // A declared status (404) and a `default`-covered one (500 on deletePet) with an empty body.
        for (const [status, run] of [[404, () => api.getPetById({ id: 'p1' })], [500, () => api.deletePet({ id: 'p1' })]] as const) {
          const empty = await call(status, '', run)
          expect('rejected' in empty && empty.rejected, `${httpClient} ${status} empty`).toBeInstanceOf(adapter.ApiClientResponseError)
          expect(empty, `${httpClient} ${status} empty`).toMatchObject({ rejected: { status, body: undefined, message: `HTTP Error ${status}` } })

          const declared = await call(status, JSON.stringify({ code: status, message: 'nope' }), run)
          expect(declared, `${httpClient} ${status} JSON`).toEqual({ rejected: { code: status, message: 'nope' } })
        }

        const ok = await call(200, JSON.stringify({ id: 'p1', name: 'Rex' }), () => api.getPetById({ id: 'p1' }))
        expect(ok, `${httpClient} 200`).toEqual({ resolved: { id: 'p1', name: 'Rex' } })
        const noContent = await call(204, '', () => api.deletePet({ id: 'p1' }))
        expect(noContent, `${httpClient} 204`).toEqual({ resolved: undefined })
      } finally {
        cleanup()
      }
    }
  })

  it('compiles and calls the documented stack for operations named with reserved words (TypeSpec fixture)', async () => {
    for (const split of [false, true]) {
      const result = await generateStack({ split }, { input: reservedNamesFile })
      expect(result.diagnostics).toEqual([])
      const files = toFileRecord(result.files)
      // Root-level `delete` / `import` / `new` / `createClient` / `fetch` / `client` get escaped function names;
      // the reserved short names of `Pets.delete` and `Orders.export` fall back to the prefixed names.
      expect(files['client.ts']).toContain('export async function delete_(')
      expect(files['client.ts']).toContain('export async function import_(')
      expect(files['client.ts']).toContain('export async function new_(')
      expect(files['client.ts']).toContain('export async function createClient_(')
      expect(files['client.ts']).toContain('export async function fetch_(')
      expect(files['client.ts']).toContain('export async function client_(')
      expect(files['client.ts']).toContain('export async function petsDelete(')
      expect(files['client.ts']).toContain('export async function ordersExport(')
      expect(files['client.ts']).toContain('export function createClient(config?: ClientConfig): Client {')
      expect(files['api-client.ts']).toContain(
        "import { type Client, delete_, import_, createClient_, new_, fetch_, client_, petsDelete, ordersExport } from './client.js'",
      )
      // Reserved member names are quoted in the interface and in the object, so `new` is a method
      // (unquoted, `new(...)` would be a construct signature of ApiClient).
      expect(files['api-client.ts']).toContain("  'new'(body: Resolved<NewBody>, options?: ApiClientCallOptions | undefined): Promise<JsonPrimitive<NewResponse>>")
      expect(files['api-client.ts']).toContain("    async 'new'(body, options) {")
      expect(files['api-client.ts']).toContain("    async 'delete'(params, options) {")
      expect(files['api-client.ts']).toContain('    async petsDelete(params, options) {')
      expect(files[split ? 'hooks.ts' : 'queries.ts']).toContain('export function useNewMutation<TContext = unknown>(')
      expect(typecheckGeneratedFiles({ files, packages: ['@tanstack/react-query'] }), `split=${split}`).toEqual([])
    }

    const { sdk, adapter, cleanup } = await importAdapter(toFileRecord((await generateStack({}, { input: reservedNamesFile })).files))
    try {
      const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }))
      const api = adapter.createApiClient(sdk.createClient({ baseUrl: 'https://api.test', fetch: fetchMock }))
      await expect(api.delete({ id: 'a' })).resolves.toBeUndefined()
      expect(fetchMock).toHaveBeenLastCalledWith('https://api.test/things/a', expect.objectContaining({ method: 'DELETE' }))
      await api.petsDelete({ id: 'b' })
      expect(fetchMock).toHaveBeenLastCalledWith('https://api.test/pets/b', expect.objectContaining({ method: 'DELETE' }))
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'o1', total: 3 }]), { status: 200 }))
      await expect(api.ordersExport()).resolves.toEqual([{ id: 'o1', total: 3 }])
      expect(fetchMock).toHaveBeenLastCalledWith('https://api.test/orders/export', expect.objectContaining({ method: 'GET' }))
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'p1', name: 'Rex' }), { status: 200 }))
      await expect(api.new({ id: 'p1', name: 'Rex' })).resolves.toEqual({ id: 'p1', name: 'Rex' })
      expect(fetchMock).toHaveBeenLastCalledWith('https://api.test/new-pets', expect.objectContaining({ method: 'POST', body: '{"id":"p1","name":"Rex"}' }))
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'p2', name: 'Ada' }), { status: 200 }))
      await expect(api.fetch({ id: 'p2' })).resolves.toEqual({ id: 'p2', name: 'Ada' })
      expect(fetchMock).toHaveBeenLastCalledWith('https://api.test/fetch/p2', expect.objectContaining({ method: 'GET' }))
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'p3', name: 'Bo' }), { status: 200 }))
      await expect(api.client({ id: 'p3' })).resolves.toEqual({ id: 'p3', name: 'Bo' })
      expect(fetchMock).toHaveBeenLastCalledWith('https://api.test/client/p3', expect.objectContaining({ method: 'GET' }))
    } finally {
      cleanup()
    }
  })

  it('keeps the legacy client import when clientFile is set or no pluginClient ran', async () => {
    const withClientFile = toFileRecord((await generateStack({ clientFile: './legacy-client.js' })).files)
    expect(withClientFile['api-client.ts']).toBeUndefined()
    expect(withClientFile['queries.ts']).toContain("import type { ApiClient } from './legacy-client.js'")

    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: createSampleOasDoc(),
      config: { input: 'main.tsp' },
    })
    await pluginTanstackQuery().generate!(context)
    expect(context.hasFile('api-client.ts')).toBe(false)
    expect(context.getFile('queries.ts')?.content).toContain("import type { ApiClient } from './client.js'")
  })

  it('reports an error when pluginClient emits no standalone functions for the adapter to call', async () => {
    const result = await generateStack({}, { document: createSampleOasDoc() }, { standalone: false })
    expect(result.success).toBe(false)
    expect(result.diagnostics.map(d => d.code)).toContain('TANSTACK_CLIENT_ADAPTER_NO_STANDALONE')
  })

  it('binds the adapter to the module-private transport when pluginClient({ clientClass: false })', async () => {
    const result = await generateStack({}, { document: createSampleOasDoc() }, { clientClass: false })
    expect(result.success).toBe(true)
    const files = toFileRecord(result.files)
    expect(files['api-client.ts']).toContain('export function createApiClient(): ApiClient')
    expect(files['api-client.ts']).not.toContain('client,')
    expect(typecheckGeneratedFiles({ files, packages: ['@tanstack/react-query'] })).toEqual([])
  })

  it('rejects calls the SDK cannot send and reports them (querystring parameters)', async () => {
    const doc = createSampleOasDoc()
    doc.paths!['/search'] = {
      get: {
        operationId: 'searchPets',
        tags: ['pets'],
        parameters: [{ name: 'q', in: 'querystring', required: false, content: { 'application/x-www-form-urlencoded': { schema: { type: 'object' } } } }],
        responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } } } } } },
      },
    }
    const result = await generateStack({}, { document: doc })
    expect(result.success).toBe(true)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'TANSTACK_CLIENT_ADAPTER_UNSUPPORTED',
      severity: 'warning',
      message: `[tanstack-query] pluginClient cannot send 'querystring' parameters for operation "searchPets"; its ApiClient method rejects when that argument is passed.`,
    }))
    const files = toFileRecord(result.files)
    expect(files['api-client.ts']).toContain(`if (querystring !== undefined) throw new Error("pluginClient cannot send 'querystring' parameters for operation \\"searchPets\\"")`)
    expect(typecheckGeneratedFiles({ files, packages: ['@tanstack/react-query'] })).toEqual([])
  })

  it('reports that a method always rejects when the SDK cannot send a required argument (non-JSON body)', async () => {
    const doc = createSampleOasDoc()
    const binary = { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } }
    doc.paths!['/uploads'] = {
      post: { operationId: 'uploadPhoto', tags: ['pets'], requestBody: { required: true, content: binary }, responses: { '204': { description: 'Stored' } } },
      put: { operationId: 'replacePhoto', tags: ['pets'], requestBody: { required: false, content: binary }, responses: { '204': { description: 'Stored' } } },
    }
    const result = await generateStack({}, { document: doc })
    expect(result.success).toBe(true)
    const issues = result.diagnostics.filter(d => d.code === 'TANSTACK_CLIENT_ADAPTER_UNSUPPORTED')
    expect(issues.map(d => [d.severity, d.message])).toEqual([
      ['warning', '[tanstack-query] pluginClient cannot send non-JSON request bodies for operation "uploadPhoto", which the operation requires; its ApiClient method always rejects.'],
      ['warning', '[tanstack-query] pluginClient cannot send non-JSON request bodies for operation "replacePhoto"; its ApiClient method rejects when that argument is passed.'],
    ])

    const files = toFileRecord(result.files)
    expect(files['api-client.ts']).toContain('async uploadPhoto(body, options) {\n      throw new Error("pluginClient cannot send non-JSON request bodies for operation \\"uploadPhoto\\"")\n    },')
    expect(typecheckGeneratedFiles({ files, packages: ['@tanstack/react-query'] })).toEqual([])

    const { sdk, adapter, cleanup } = await importAdapter(files)
    try {
      const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
      const api = adapter.createApiClient(sdk.createClient({ baseUrl: 'https://api.test', fetch: fetchMock }))
      await expect(api.uploadPhoto(new Uint8Array([1]))).rejects.toThrow('pluginClient cannot send non-JSON request bodies')
      await expect(api.replacePhoto(new Uint8Array([1]))).rejects.toThrow('pluginClient cannot send non-JSON request bodies')
      await expect(api.replacePhoto()).resolves.toBeUndefined()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      cleanup()
    }
  })

  it('emits self-contained modules for every tier (no imports of modules that are not emitted)', async () => {
    for (const tier of ['keys', 'options', 'hooks', 'all'] as const) {
      for (const split of [false, true]) {
        const result = await generateStack({ tier, split })
        expect(result.success).toBe(true)
        const files = toFileRecord(result.files)
        for (const [path, code] of Object.entries(files)) {
          for (const specifier of relativeImports(code)) {
            const target = specifier.replace(/^\.\//, '').replace(/\.js$/, '.ts')
            expect(target, `${tier}/${split ? 'split' : 'combined'}: ${path} imports ${specifier}`).not.toBe(path)
            expect(files[target], `${tier}/${split ? 'split' : 'combined'}: ${path} imports ${specifier}`).toBeDefined()
          }
        }
        expect(typecheckGeneratedFiles({ files, packages: ['@tanstack/react-query'] }), `${tier}/${split}`).toEqual([])
      }
    }
  })

  it('supports custom split output file locations', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginTanstackQuery({
      split: true,
      keysOutput: 'api/keys.ts',
      optionsOutput: 'api/options.ts',
      hooksOutput: 'api/hooks.ts',
    })
    await plugin.generate!(context)

    expect(context.hasFile('api/keys.ts')).toBe(true)
    expect(context.hasFile('api/options.ts')).toBe(true)
    expect(context.hasFile('api/hooks.ts')).toBe(true)

    const optionsFile = context.getFile('api/options.ts')
    expect(optionsFile?.content).toContain('./keys.js')
    expect(optionsFile?.content).toContain('GetPetByIdError')
    expect(optionsFile?.content).not.toContain('ClientError')
  })

  it('resolves relative keysImport and queriesImport when hooksOutput is in a separate subdirectory with explicit typesFile and clientFile', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginTanstackQuery({
      split: true,
      typesFile: '@app/types',
      clientFile: '@app/client',
      keysOutput: 'api/keys.ts',
      optionsOutput: 'api/options.ts',
      hooksOutput: 'api/react/hooks.ts',
    })
    await plugin.generate!(context)

    const hooksFile = context.getFile('api/react/hooks.ts')
    expect(hooksFile).toBeDefined()
    expect(hooksFile?.content).toContain("from '../keys.js'")
    expect(hooksFile?.content).toContain("from '../options.js'")
    expect(hooksFile?.content).toContain('GetPetByIdError')
    expect(hooksFile?.content).not.toContain('ClientError')
  })

  it('resolves relative imports between custom subdirectories correctly', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    context.addFile({
      path: 'models/types.ts',
      content: 'export interface Pet {}',
      sourcePlugin: 'typescript',
    })

    const plugin = pluginTanstackQuery({
      output: 'features/pets/queries.ts',
    })
    await plugin.generate!(context)

    const file = context.getFile('features/pets/queries.ts')
    expect(file).toBeDefined()
    // Relative import from features/pets/queries.ts to models/types.ts should be ../../models/types.js
    expect(file?.content).toContain('../../models/types.js')
  })

  it('handles empty document gracefully without throwing', async () => {
    const emptyDoc: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Empty API', version: '1.0.0' },
      paths: {},
    }
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: emptyDoc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginTanstackQuery()
    await expect(plugin.generate!(context)).resolves.not.toThrow()
    expect(context.hasFile('queries.ts')).toBe(true)
  })
})
