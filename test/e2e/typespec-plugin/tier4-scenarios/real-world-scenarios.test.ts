import { describe, it, expect, vi } from 'vitest'
import { resolve } from 'node:path'
import {
  type TspPlugin,
  compileTypeSpecInMemory,
  sortPlugins,
  TspPluginCycleError,
  pluginClient,
  pluginRouter,
  pluginTanstackQuery,
  pluginTypescript,
  pluginWire,
} from '../../../../packages/codegen/src/plugin/index.js'
import { generateTypesFromSpec } from '../../../../packages/codegen/src/typegen/generate-types.js'
import {
  extractWireSchemaFromOas,
  ProtobufCodecTargetAdapter,
  Proto3TargetAdapter,
} from '../../../../packages/codegen/src/wire-adapter/index.js'
import { typecheckGeneratedFiles } from '../../../../packages/codegen/src/__tests__/plugin/helpers/typecheck-generated.js'
import { emittedFiles, loadGeneratedPetstoreSdk, runFixturePipeline } from '../fixtures/generated-sdk.js'

// pluginClient's real petstore SDK (client.ts) and pluginTanstackQuery's adapter (api-client.ts).
const generated = await loadGeneratedPetstoreSdk()
const { Client } = generated.client

describe('Tier 4: Real-World Application Scenarios', () => {
  const storefrontFile = resolve('test/e2e/typespec-plugin/fixtures/storefront/main.tsp')
  const protobufFile = resolve('test/e2e/typespec-plugin/fixtures/protobuf/main.tsp')

  // ── Scenario 1: Full E2E Petstore Compilation to Multi-Target SDKs ──
  it('Scenario 1: Petstore TypeSpec full compilation to 5 target SDKs through the shipped plugins', async () => {
    const result = await runFixturePipeline('petstore', [
      pluginTypescript(),
      pluginClient(),
      pluginTanstackQuery({ split: true }),
      pluginRouter({ target: 'hono' }),
      pluginWire({ codecs: ['proto3'] }),
    ])
    expect(result.success).toBe(true)
    expect(result.context.document.openapi).toBe('3.2.0')

    // Verify complete multi-target artifact inventory
    const files = emittedFiles(result)
    expect(Object.keys(files).sort()).toEqual([
      'api-client.ts',
      'api.contract.ts',
      'client.ts',
      'hooks.ts',
      'keys.ts',
      'queries.ts',
      'router.ts',
      'schema.proto',
      'types.ts',
      'wire.ts',
    ])
    expect(files['client.ts']).toContain('export async function getPetById(')
    expect(files['api.contract.ts']).toContain('export interface ApiHandlers')
    expect(files['schema.proto']).toContain('syntax = "proto3";')

    // ... and every TypeScript artifact compiles together with its real dependencies.
    expect(typecheckGeneratedFiles({ files, packages: ['@tanstack/react-query', 'hono'] })).toEqual([])
  })

  // ── Scenario 2: Storefront E-Commerce Compilation & Complex Pagination ──
  it('Scenario 2: Storefront E-Commerce TypeSpec compilation with pagination & nested models', async () => {
    const compileResult = await compileTypeSpecInMemory(storefrontFile)
    const doc = compileResult.document

    expect(doc.info.title).toBe('Storefront E-Commerce API')
    expect(doc.paths['/products']).toBeDefined()
    expect(doc.paths['/orders']).toBeDefined()

    const typesCode = generateTypesFromSpec(doc)
    expect(typesCode).toContain('Product')
    expect(typesCode).toContain('Money')
    expect(typesCode).toContain('Order')
    expect(typesCode).toContain('PaginatedProductsResponse')

    const result = await runFixturePipeline('storefront', [pluginTypescript(), pluginClient(), pluginTanstackQuery()])
    expect(result.success).toBe(true)
    const queries = emittedFiles(result)['queries.ts']!
    // page/pageSize query parameters are detected as page-based pagination.
    expect(queries).toContain('export function productsListProductsInfiniteQueryOptions<')
    expect(queries).toContain('"page": pageParam')
    expect(queries).toContain('initialPageParam: 1 as unknown as TPageParam')
  })

  // ── Scenario 3: Tree-shakeable functional client calling convention & Discriminated Union ──
  it('Scenario 3: Tree-shakeable client calling convention & Discriminated Union type narrowing', async () => {
    const mockFetch = vi.fn()
    const client = new Client({ baseUrl: 'https://pets.example.com', fetch: mockFetch })
    const { getPetById, deletePet } = generated.client

    // 1. Success case: 200 OK
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'pet-1', name: 'Buddy' }), { status: 200 }),
    )
    const successRes = await getPetById({ client, path: { petId: 'pet-1' } })

    if (successRes.error) {
      expect.fail('Should not enter error branch')
    } else {
      expect(successRes.data?.name).toBe('Buddy')
      expect(successRes.response.status).toBe(200)
    }

    // 2. Error case: 404 Not Found
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'No pet' }), { status: 404 }),
    )
    const errorRes = await getPetById({ client, path: { petId: 'unknown' } })

    if (errorRes.error) {
      expect(errorRes.data).toBeUndefined()
      expect(errorRes.error.code).toBe('NOT_FOUND')
      expect(errorRes.response.status).toBe(404)
    } else {
      expect.fail('Should not enter data branch')
    }

    // 3. 204 No Content delete
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const deleteRes = await deletePet({ client, path: { petId: 'pet-1' } })
    expect(deleteRes.data).toBeUndefined()
    expect(deleteRes.error).toBeUndefined()
    expect(deleteRes.response.status).toBe(204)
    expect(mockFetch).toHaveBeenLastCalledWith('https://pets.example.com/pets/pet-1', expect.objectContaining({ method: 'DELETE' }))
  })

  // ── Scenario 4: Server Handler Contract implementation & roundtrip ──
  it('Scenario 4: Server Handler Contract implementation and client request roundtrip', async () => {
    // Concrete in-memory handler implementation conforming to ApiHandlers contract
    const petDatabase = new Map<string, { id: string; name: string }>()
    petDatabase.set('p1', { id: 'p1', name: 'Rex' })

    const mockHandlers = {
      petsListPets: async () => {
        return Array.from(petDatabase.values())
      },
      petsGetPetById: async (ctx: { params: { petId: string } }) => {
        const pet = petDatabase.get(ctx.params.petId)
        if (!pet) {
          return { status: 404, body: { code: 'NOT_FOUND', message: 'Pet not found' } }
        }
        return pet
      },
      petsCreatePet: async (ctx: { body: { name: string } }) => {
        const newPet = { id: `p${petDatabase.size + 1}`, name: ctx.body.name }
        petDatabase.set(newPet.id, newPet)
        return { status: 201, body: newPet }
      },
    }

    // Server dispatch adapter simulating router invocation
    const serverDispatch = async (req: { path: string; method: string; body?: { name: string } }) => {
      if (req.method === 'GET' && req.path === '/pets') {
        const data = await mockHandlers.petsListPets()
        return new Response(JSON.stringify(data), { status: 200 })
      }
      if (req.method === 'GET' && req.path.startsWith('/pets/')) {
        const petId = req.path.split('/')[2] ?? ''
        const res = await mockHandlers.petsGetPetById({ params: { petId } })
        if ('status' in res && res.status === 404) {
          return new Response(JSON.stringify(res.body), { status: 404 })
        }
        return new Response(JSON.stringify(res), { status: 200 })
      }
      if (req.method === 'POST' && req.path === '/pets' && req.body) {
        const res = await mockHandlers.petsCreatePet({ body: req.body })
        return new Response(JSON.stringify(res.body), { status: 201 })
      }
      return new Response('Not Found', { status: 404 })
    }

    // Generated client calling the dispatched handler server
    const client = new Client({
      fetch: (url, init) => {
        const u = new URL(String(url), 'http://localhost')
        return serverDispatch({
          path: u.pathname,
          method: init?.method ?? 'GET',
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        })
      },
    })
    const { listPets, createPet, getPetById } = generated.client

    // Test List
    const listRes = await listPets({ client })
    expect(listRes.data?.length).toBe(1)
    expect(listRes.data?.[0]?.name).toBe('Rex')

    // Test Create
    const createRes = await createPet({ client, body: { name: 'Milo' } })
    expect(createRes.data?.id).toBe('p2')
    expect(createRes.data?.name).toBe('Milo')

    // Test Get Newly Created (through the TanStack adapter, which resolves to the payload)
    const api = generated.adapter.createApiClient(client)
    await expect(api.petsGetPetById({ petId: 'p2' })).resolves.toMatchObject({ name: 'Milo' })

    // Test 404
    const notFoundRes = await getPetById({ client, path: { petId: 'p999' } })
    expect(notFoundRes.response.status).toBe(404)
    expect(notFoundRes.error?.code).toBe('NOT_FOUND')
    // PetError is not an @error model with a status code, so the TanStack error type of this operation is
    // Error and the adapter rejects with an ApiClientResponseError carrying the status and the parsed body.
    const rejection = await api.petsGetPetById({ petId: 'p999' }).catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(generated.adapter.ApiClientResponseError)
    expect(rejection).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' }, message: expect.stringContaining('HTTP Error 404') })
  })

  // ── Scenario 5: Protobuf wire codec serialization/deserialization with generated SDK ──
  it('Scenario 5: Protobuf wire codec extraction and codec transformation roundtrip', async () => {
    const compileResult = await compileTypeSpecInMemory(protobufFile)
    const doc = compileResult.document

    const wireModel = extractWireSchemaFromOas(doc)
    expect(wireModel.models.length).toBe(2)

    const proto3Schema = new Proto3TargetAdapter().transform(wireModel)
    expect(proto3Schema).toContain('message SensorReading')
    expect(proto3Schema).toContain('double temperature = 3;')
    expect(proto3Schema).toContain('double humidity = 4;')

    const tsCodecs = new ProtobufCodecTargetAdapter().transform(wireModel)
    expect(tsCodecs).toContain('ProtobufCodecTargetAdapter')
    expect(tsCodecs).toContain('encodeSensorReading')
    expect(tsCodecs).toContain('decodeSensorReading')
  })

  // ── Scenario 6: Complex Cyclic Dependency graph detection & topological resolution ──
  it('Scenario 6: Complex multi-branch cyclic dependency graph detection and topological resolution', () => {
    const pRoot: TspPlugin = { name: 'root' }
    const pBranchA: TspPlugin = { name: 'branch-a', dependencies: ['root'] }
    const pBranchB: TspPlugin = { name: 'branch-b', dependencies: ['root'] }
    const pDeepA: TspPlugin = { name: 'deep-a', dependencies: ['branch-a'] }
    const pDeepB: TspPlugin = { name: 'deep-b', dependencies: ['branch-b'] }

    // Introduce a cross-branch cycle: deep-a -> cycle-node -> deep-a
    const pCycleNode: TspPlugin = { name: 'cycle-node', dependencies: ['deep-a'] }
    const pDeepACyclic: TspPlugin = { name: 'deep-a', dependencies: ['branch-a', 'cycle-node'] }

    // 1. Detection of cycle
    expect(() => {
      sortPlugins([pRoot, pBranchA, pBranchB, pDeepACyclic, pDeepB, pCycleNode])
    }).toThrow(TspPluginCycleError)

    // 2. Removal of cycle edge yields correct topological sort
    const sorted = sortPlugins([pRoot, pBranchA, pBranchB, pDeepA, pDeepB])
    const names = sorted.map(p => p.name)

    expect(names[0]).toBe('root')
    expect(names.indexOf('branch-a')).toBeGreaterThan(names.indexOf('root'))
    expect(names.indexOf('branch-b')).toBeGreaterThan(names.indexOf('root'))
    expect(names.indexOf('deep-a')).toBeGreaterThan(names.indexOf('branch-a'))
    expect(names.indexOf('deep-b')).toBeGreaterThan(names.indexOf('branch-b'))
  })
})
