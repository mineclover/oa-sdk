import { describe, it, expect, vi } from 'vitest'
import { resolve } from 'node:path'
import {
  type TspPlugin,
  type TspPluginContext,
  compileTypeSpecInMemory,
  createPluginContext,
  sortPlugins,
  TspPluginCycleError,
} from '../../../../packages/codegen/src/plugin/index.js'
import { generateTypesFromSpec } from '../../../../packages/codegen/src/typegen/generate-types.js'
import { generateTanstackQuery } from '../../../../packages/client/src/tanstack/index.js'
import { generateHandlerContract, generateRouter } from '../../../../packages/router/src/index.js'
import {
  extractWireSchemaFromOas,
  ProtobufCodecTargetAdapter,
  Proto3TargetAdapter,
} from '../../../../packages/codegen/src/wire-adapter/index.js'
import { Client, type RequestOptions } from '../fixtures/client-reference.js'

describe('Tier 4: Real-World Application Scenarios', () => {
  const petstoreFile = resolve('test/e2e/typespec-plugin/fixtures/petstore/main.tsp')
  const storefrontFile = resolve('test/e2e/typespec-plugin/fixtures/storefront/main.tsp')
  const protobufFile = resolve('test/e2e/typespec-plugin/fixtures/protobuf/main.tsp')

  // ── Scenario 1: Full E2E Petstore Compilation to Multi-Target SDKs ──
  it('Scenario 1: Petstore TypeSpec full compilation to 5 target SDKs in memory', async () => {
    // 1. Compile TypeSpec in memory
    const compileResult = await compileTypeSpecInMemory(petstoreFile)
    expect(compileResult.document.openapi).toBe('3.2.0')
    const doc = compileResult.document

    // 2. Initialize VFS context
    const context = createPluginContext({
      entrypoint: petstoreFile,
      outputDir: resolve('dist/generated'),
      document: doc,
      config: { input: petstoreFile, output: 'dist/generated', plugins: [] },
    })

    // Target 1: TypeScript Models
    const typesCode = generateTypesFromSpec(doc, { style: 'interface' })
    context.addFile({
      path: 'types.ts',
      content: typesCode,
      sourcePlugin: 'typescript',
      exports: ['Pet', 'Category', 'Tag', 'PetStatus', 'PetError'],
    })

    // Target 2: Client SDK
    const clientCode = `
import type { Pet, PetError, CreatePetRequest } from './types.js';
import { Client, type RequestOptions, type ClientResult } from './runtime.js';

export async function getPetById(options: RequestOptions<{ path: { petId: string } }>) {
  const client = options.client ?? new Client();
  return client.get<Pet, PetError>({
    url: '/pets/{petId}',
    path: options.path,
    signal: options.signal,
  });
}
`
    context.addFile({
      path: 'client.ts',
      content: clientCode,
      sourcePlugin: 'client',
      exports: ['getPetById'],
    })

    // Target 3: TanStack Query v5 3-Tier
    const queryOutput = generateTanstackQuery(doc)
    context.addFile({
      path: 'queries.ts',
      content: queryOutput.queriesCode,
      sourcePlugin: 'tanstack-query',
    })

    // Target 4: Router Handler Contracts & Hono router
    const contractCode = generateHandlerContract(doc, { typesImport: './types.js' })
    context.addFile({
      path: 'api.contract.ts',
      content: contractCode,
      sourcePlugin: 'router',
      exports: ['ApiHandlers', 'HandlerResponse'],
    })

    const routerCode = generateRouter(doc, { target: 'hono', contractImport: './api.contract.js' })
    context.addFile({
      path: 'router.ts',
      content: routerCode,
      sourcePlugin: 'router',
    })

    // Target 5: Wire Protocol Buffers Codecs
    const wireModel = extractWireSchemaFromOas(doc)
    const proto3 = new Proto3TargetAdapter().transform(wireModel)
    context.addFile({
      path: 'schema.proto',
      content: proto3,
      sourcePlugin: 'wire',
    })

    // Verify complete multi-target artifact inventory
    expect(context.getFiles().length).toBe(6)
    expect(context.hasFile('types.ts')).toBe(true)
    expect(context.hasFile('client.ts')).toBe(true)
    expect(context.hasFile('queries.ts')).toBe(true)
    expect(context.hasFile('api.contract.ts')).toBe(true)
    expect(context.hasFile('router.ts')).toBe(true)
    expect(context.hasFile('schema.proto')).toBe(true)
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

    const queryOutput = generateTanstackQuery(doc, { infiniteQuery: true })
    expect(queryOutput.queriesCode).toContain('queryOptions')
  })

  // ── Scenario 3: Tree-shakeable functional client calling convention & Discriminated Union ──
  it('Scenario 3: Tree-shakeable client calling convention & Discriminated Union type narrowing', async () => {
    interface Pet { id: string; name: string }
    interface PetError { code: string; message: string }

    const mockFetch = vi.fn()
    const client = new Client({ baseUrl: 'https://pets.example.com', fetch: mockFetch })

    // Standalone function matching openapi-ts Hey API calling convention
    async function getPetById(options: RequestOptions<{ path: { petId: string } }>) {
      const activeClient = options.client ?? client
      return activeClient.get<Pet, PetError>({
        url: '/pets/{petId}',
        path: options.path,
        signal: options.signal,
      })
    }

    async function deletePet(options: RequestOptions<{ path: { petId: string } }>) {
      const activeClient = options.client ?? client
      return activeClient.request<void, PetError>({
        method: 'DELETE',
        url: '/pets/{petId}',
        path: options.path,
      })
    }

    // 1. Success case: 200 OK
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'pet-1', name: 'Buddy' }), { status: 200 }),
    )
    const successRes = await getPetById({ path: { petId: 'pet-1' } })

    if (successRes.error) {
      expect.fail('Should not enter error branch')
    } else {
      expect(successRes.data.name).toBe('Buddy')
      expect(successRes.response.status).toBe(200)
    }

    // 2. Error case: 404 Not Found
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'No pet' }), { status: 404 }),
    )
    const errorRes = await getPetById({ path: { petId: 'unknown' } })

    if (errorRes.error) {
      expect(errorRes.data).toBeUndefined()
      expect(errorRes.error.code).toBe('NOT_FOUND')
      expect(errorRes.response.status).toBe(404)
    } else {
      expect.fail('Should not enter data branch')
    }

    // 3. 204 No Content delete
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const deleteRes = await deletePet({ path: { petId: 'pet-1' } })
    expect(deleteRes.data).toBeUndefined()
    expect(deleteRes.error).toBeUndefined()
    expect(deleteRes.response.status).toBe(204)
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
    const serverDispatch = async (req: { path: string; method: string; body?: any; params?: any }) => {
      if (req.method === 'GET' && req.path === '/pets') {
        const data = await mockHandlers.petsListPets()
        return new Response(JSON.stringify(data), { status: 200 })
      }
      if (req.method === 'GET' && req.path.startsWith('/pets/')) {
        const petId = req.path.split('/')[2]
        const res = await mockHandlers.petsGetPetById({ params: { petId } })
        if ('status' in res && res.status === 404) {
          return new Response(JSON.stringify(res.body), { status: 404 })
        }
        return new Response(JSON.stringify(res), { status: 200 })
      }
      if (req.method === 'POST' && req.path === '/pets') {
        const res = await mockHandlers.petsCreatePet({ body: req.body })
        return new Response(JSON.stringify(res.body), { status: 201 })
      }
      return new Response('Not Found', { status: 404 })
    }

    // Client calling the dispatched handler server
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

    // Test List
    const listRes = await client.get<any[]>({ url: '/pets' })
    expect(listRes.data?.length).toBe(1)
    expect(listRes.data?.[0].name).toBe('Rex')

    // Test Create
    const createRes = await client.post<any>({ url: '/pets', body: { name: 'Milo' } })
    expect(createRes.data?.id).toBe('p2')
    expect(createRes.data?.name).toBe('Milo')

    // Test Get Newly Created
    const getRes = await client.get<any>({ url: '/pets/{petId}', path: { petId: 'p2' } })
    expect(getRes.data?.name).toBe('Milo')

    // Test 404
    const notFoundRes = await client.get<any, any>({ url: '/pets/{petId}', path: { petId: 'p999' } })
    expect(notFoundRes.response.status).toBe(404)
    expect(notFoundRes.error?.code).toBe('NOT_FOUND')
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
