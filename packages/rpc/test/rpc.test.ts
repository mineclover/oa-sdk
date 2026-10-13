import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  createHttpTransport,
  createJsonRpcFetchHandler,
  createJsonRpcTransport,
  createLocalTransport,
  createRestFetchHandler,
  createRpcCaller,
  createRpcClient,
  createRpcServer,
  handleJsonRpc,
  RpcError,
  type RpcClient,
  type RpcHandlers,
  type RpcServerOptions,
  type RpcTransport,
} from '../src/index.js'
import { createAjvValidator } from '../src/ajv.js'
import { petContract, type Pet, type PetProcedures } from './fixture.js'

type Context = { user: string }

function createPetServer(options: RpcServerOptions = {}) {
  const pets = new Map<number, Pet>([[1, { id: 1, name: 'Rex', tag: 'dog' }]])
  const received: unknown[] = []
  const handlers: RpcHandlers<PetProcedures, Context> = {
    pets: {
      listPets: (input) => {
        received.push(input)
        return [...pets.values()].slice(0, input.limit ?? Infinity)
      },
      createPet: (input, { context }) => {
        if ([...pets.values()].some(pet => pet.name === input.name)) {
          throw new RpcError('CONFLICT', 'Pet exists', { data: { code: 'CONFLICT', message: `${input.name} exists` } })
        }
        const pet: Pet = { id: pets.size + 1, name: input.name, ...(input.tag === undefined ? {} : { tag: `${input.tag}:${context.user}` }) }
        pets.set(pet.id, pet)
        return pet
      },
      getPet: (input) => {
        received.push(input)
        const pet = pets.get(input.petId)
        if (!pet) throw new RpcError('NOT_FOUND', 'No such pet', { data: { code: 'NOT_FOUND', message: `pet ${input.petId}` } })
        return pet
      },
      updatePet: (input) => {
        received.push(input)
        return { prototypeIsObject: Object.getPrototypeOf(input) === Object.prototype, tenant: input['X-Tenant'] ?? null }
      },
      deletePet: (input) => {
        pets.delete(input.petId)
      },
      replacePhotos: (input) => input.body.map(photo => `${input.petId}/${photo}`),
    },
    geo: {
      echoPoint: (input) => input.point,
    },
    health: () => 'ok',
  }
  const server = createRpcServer<PetProcedures, Context>(petContract(), handlers, {
    validator: createAjvValidator(),
    ...options,
  })
  return { server, pets, received }
}

/** A fetch that answers from fetch handlers in memory instead of the network. */
function inMemoryFetch(...handlers: ((request: Request) => Promise<Response | undefined>)[]): typeof fetch {
  return async (url, init) => {
    const request = new Request(url, init)
    for (const handler of handlers) {
      const response = await handler(request)
      if (response) return response
    }
    return new Response('not found', { status: 404 })
  }
}

function transports() {
  const setup = createPetServer()
  const createContext = () => ({ user: 'alice' })
  const fetch = inMemoryFetch(
    createJsonRpcFetchHandler(setup.server, { path: '/rpc', createContext }),
    createRestFetchHandler(setup.server, { basePath: '/v1', createContext }),
  )
  return {
    ...setup,
    variants: {
      rest: createHttpTransport({ baseUrl: 'https://pets.test/v1', fetch }),
      jsonRpc: createJsonRpcTransport({ url: 'https://pets.test/rpc', fetch }),
      local: createLocalTransport(setup.server, { context: { user: 'alice' } }),
    } satisfies Record<string, RpcTransport>,
  }
}

describe.each(['rest', 'jsonRpc', 'local'] as const)('round trip over the %s transport', (variant) => {
  function connect() {
    const setup = transports()
    return { ...setup, client: createRpcClient<PetProcedures>(setup.server.contract, setup.variants[variant]) }
  }

  it('calls query and mutation procedures with typed results', async () => {
    const { client } = connect()

    await expect(client.pets.getPet({ petId: 1 })).resolves.toEqual({ id: 1, name: 'Rex', tag: 'dog' })
    await expect(client.pets.createPet({ name: 'Tom', tag: 'cat' })).resolves.toEqual({ id: 2, name: 'Tom', tag: 'cat:alice' })
    await expect(client.pets.listPets({ limit: 1 })).resolves.toEqual([{ id: 1, name: 'Rex', tag: 'dog' }])
    await expect(client.pets.replacePhotos({ petId: 1, body: ['a.png', 'b.png'] })).resolves.toEqual(['1/a.png', '1/b.png'])
    await expect(client.health()).resolves.toBe('ok')
  })

  it('resolves undefined for procedures without output', async () => {
    const { client, pets } = connect()

    await expect(client.pets.deletePet({ petId: 1 })).resolves.toBeUndefined()
    expect(pets.has(1)).toBe(false)
  })

  it('carries handler errors with their code, status and data', async () => {
    const { client } = connect()
    const error = await client.pets.getPet({ petId: 99 }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(RpcError)
    expect(error).toMatchObject({ code: 'NOT_FOUND', status: 404, data: { code: 'NOT_FOUND', message: 'pet 99' } })
  })

  it('rejects invalid input with the validation issues', async () => {
    const { client } = connect()
    const error = await client.pets.createPet({ name: '', extra: true } as never).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: 'INVALID_INPUT', status: 400 })
    expect((error as RpcError).data).toMatchObject({
      issues: expect.arrayContaining([
        { path: '/name', message: expect.stringContaining('fewer than 1') },
        { path: '/', message: 'unknown property "extra"' },
      ]),
    })
  })
})

describe('REST binding', () => {
  it('serializes and decodes query, deepObject, cookie, header and matrix parameters', async () => {
    const { variants, received } = transports()
    const client = createRpcClient<PetProcedures>(petContract(), variants.rest)

    await client.pets.listPets({
      limit: 5,
      tags: ['a b', 'c&d'],
      ids: [1, 2],
      filter: { minAge: 2, vaccinated: true },
      tenant: 'acme corp',
    })
    await client.pets.getPet({ petId: 1, 'X-Trace': 'trace-1' })

    expect(received).toEqual([
      { limit: 5, tags: ['a b', 'c&d'], ids: [1, 2], filter: { minAge: 2, vaccinated: true }, tenant: 'acme corp' },
      { petId: 1, 'X-Trace': 'trace-1' },
    ])
    await expect(client.geo.echoPoint({ point: { x: 1.5, y: -2 } })).resolves.toEqual({ x: 1.5, y: -2 })
  })

  it('keeps encoded delimiters inside items and decodes maps and union-typed values', async () => {
    const { variants, received } = transports()
    const client = createRpcClient<PetProcedures>(petContract(), variants.rest)

    await client.pets.listPets({ names: ['a,b', 'c d'], maxAge: 5, meta: { color: 'red', size: 'L' }, limit: 2 })

    expect(received).toEqual([{ names: ['a,b', 'c d'], maxAge: 5, meta: { color: 'red', size: 'L' }, limit: 2 }])
  })

  it('never lets a body key replace a declared parameter or the input prototype', async () => {
    const { server } = createPetServer()
    const handler = createRestFetchHandler(server, { createContext: () => ({ user: 'bob' }) })
    const response = await handler(new Request('https://pets.test/pets/1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{"__proto__":{"X-Tenant":"evil"},"name":"n"}',
    }))

    await expect(response?.json()).resolves.toEqual({ prototypeIsObject: true, tenant: null })
  })

  it('rejects path values that would resolve to another route', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const client = createRpcClient<PetProcedures>(petContract(), createHttpTransport({ baseUrl: 'https://pets.test', fetch }))

    await expect(client.pets.getPet({ petId: '..' as never })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('builds the declared route, status and headers', async () => {
    const requests: Request[] = []
    const { server } = createPetServer()
    const handler = createRestFetchHandler(server, { createContext: () => ({ user: 'bob' }) })
    const fetch = inMemoryFetch(async (request) => {
      requests.push(request.clone())
      return handler(request)
    })
    const client = createRpcClient<PetProcedures>(server.contract, createHttpTransport({
      baseUrl: 'https://pets.test/',
      fetch,
      headers: () => ({ authorization: 'Bearer token' }),
    }))

    await client.pets.listPets({ tags: ['x', 'y'], ids: [3, 4], filter: { minAge: 1 } }, { headers: { 'x-call': '1' } })
    await client.pets.createPet({ name: 'Kit' })

    const [list, create] = requests
    expect(list?.method).toBe('GET')
    expect(list?.url).toBe('https://pets.test/pets?tags=x&tags=y&ids=3,4&filter%5BminAge%5D=1')
    expect(list?.headers.get('authorization')).toBe('Bearer token')
    expect(list?.headers.get('x-call')).toBe('1')
    expect(create?.method).toBe('POST')
    expect(create?.headers.get('content-type')).toBe('application/json')
    await expect(create?.json()).resolves.toEqual({ name: 'Kit' })

    const response = await handler(new Request('https://pets.test/pets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Leo' }),
    }))
    expect(response?.status).toBe(201)
    const deleted = await handler(new Request('https://pets.test/pets/1', { method: 'DELETE' }))
    expect(deleted?.status).toBe(204)
    expect(await deleted?.text()).toBe('')
  })

  it('answers 405 for a known path with another method and ignores unknown paths', async () => {
    const { server } = createPetServer()
    const handler = createRestFetchHandler(server, { basePath: '/v1' })

    const response = await handler(new Request('https://pets.test/v1/pets/1', { method: 'PUT' }))
    expect(response?.status).toBe(405)
    expect(response?.headers.get('allow')).toBe('GET, PATCH, DELETE')
    await expect(handler(new Request('https://pets.test/v1/unknown'))).resolves.toBeUndefined()
    await expect(handler(new Request('https://pets.test/pets'))).resolves.toBeUndefined()
  })

  it('answers malformed JSON bodies with 400', async () => {
    const { server } = createPetServer()
    const handler = createRestFetchHandler(server)
    const response = await handler(new Request('https://pets.test/pets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    }))

    expect(response?.status).toBe(400)
    await expect(response?.json()).resolves.toMatchObject({ code: 'PARSE_ERROR' })
  })
})

describe('JSON-RPC 2.0', () => {
  it('answers batches, skips notifications and maps protocol errors', async () => {
    const { server } = createPetServer()
    const context = { user: 'alice' }

    await expect(handleJsonRpc(server, '{', { context })).resolves.toMatchObject({
      id: null, error: { code: -32700 },
    })
    await expect(handleJsonRpc(server, [], { context })).resolves.toMatchObject({ error: { code: -32600 } })
    await expect(handleJsonRpc(server, { jsonrpc: '2.0', method: 'health' }, { context })).resolves.toBeUndefined()

    const batch = await handleJsonRpc(server, [
      { jsonrpc: '2.0', id: 1, method: 'health' },
      { jsonrpc: '2.0', id: 2, method: 'pets.getPet', params: { petId: 1 } },
      { jsonrpc: '2.0', id: 3, method: 'pets.nope' },
      { jsonrpc: '2.0', id: 4, method: 'pets.getPet', params: [1] },
      { jsonrpc: '2.0', id: 5, method: 'pets.getPet', params: { petId: 'x' } },
      { jsonrpc: '2.0', method: 'health' },
      { id: 6, method: 'health' },
    ], { context })

    expect(batch).toEqual([
      { jsonrpc: '2.0', id: 1, result: 'ok' },
      { jsonrpc: '2.0', id: 2, result: { id: 1, name: 'Rex', tag: 'dog' } },
      { jsonrpc: '2.0', id: 3, error: { code: -32601, message: 'Unknown procedure: pets.nope', data: { code: 'PROCEDURE_NOT_FOUND', status: 404 } } },
      { jsonrpc: '2.0', id: 4, error: expect.objectContaining({ code: -32602 }) },
      { jsonrpc: '2.0', id: 5, error: expect.objectContaining({ code: -32602, data: expect.objectContaining({ code: 'INVALID_INPUT' }) }) },
      { jsonrpc: '2.0', id: 6, error: expect.objectContaining({ code: -32600 }) },
    ])
  })

  it('returns createContext failures as JSON-RPC errors', async () => {
    const { server } = createPetServer()
    const handler = createJsonRpcFetchHandler(server, {
      createContext: () => { throw new RpcError('UNAUTHORIZED', 'Sign in first') },
    })
    const client = createRpcClient<PetProcedures>(server.contract, createJsonRpcTransport({
      url: 'https://pets.test/rpc',
      fetch: inMemoryFetch(handler),
    }))

    await expect(client.health()).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401, message: 'Sign in first' })
  })

  it('only answers POST on its endpoint', async () => {
    const { server } = createPetServer()
    const handler = createJsonRpcFetchHandler(server)

    await expect(handler(new Request('https://pets.test/other', { method: 'POST' }))).resolves.toBeUndefined()
    expect((await handler(new Request('https://pets.test/rpc')))?.status).toBe(405)
  })
})

describe('server', () => {
  it('hides unexpected handler errors and reports them to onError', async () => {
    const onError = vi.fn()
    const { server } = createPetServer({ onError })
    const failing = createRpcServer(server.contract, {
      pets: { getPet: () => { throw new Error('database password leaked') } },
    }, { allowPartial: true, onError })
    const client = createRpcClient<PetProcedures>(failing.contract, createLocalTransport(failing))

    const error = await client.pets.getPet({ petId: 1 }).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'INTERNAL', message: 'Internal server error', status: 500 })
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'database password leaked' }), expect.objectContaining({ name: 'pets.getPet' }))
    await expect(client.health()).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED', status: 501 })
  })

  it('rejects input that is not an object even without a validator', async () => {
    const server = createRpcServer(petContract(), { health: () => 'ok' }, { allowPartial: true })

    await expect(server.call('health', ['x'])).rejects.toMatchObject({ code: 'INVALID_INPUT', status: 400 })
    await expect(server.call('health', undefined)).resolves.toBe('ok')
  })

  it('requires a handler for every procedure unless partial serving is allowed', () => {
    expect(() => createRpcServer(petContract(), { health: () => 'ok' })).toThrow(/Missing RPC handlers: .*pets\.listPets/)
  })

  it('validates handler output when asked to', async () => {
    const contract = petContract()
    const server = createRpcServer(contract, { pets: { getPet: () => ({ id: 'one' }) } }, {
      allowPartial: true,
      validator: createAjvValidator(),
      validateOutput: true,
    })

    await expect(server.call('pets.getPet', { petId: 1 })).rejects.toMatchObject({ code: 'INVALID_OUTPUT', status: 500 })
  })

  it('isolates values passed through the local transport', async () => {
    const shared = { id: 1, name: 'Rex' }
    const server = createRpcServer(petContract(), { pets: { getPet: () => shared } }, { allowPartial: true })
    const client = createRpcClient<PetProcedures>(server.contract, createLocalTransport(server))

    const pet = await client.pets.getPet({ petId: 1 })
    pet.name = 'changed'
    expect(shared.name).toBe('Rex')
  })
})

describe('client', () => {
  it('validates input before calling the transport', async () => {
    const transport = vi.fn<RpcTransport>()
    const client = createRpcClient<PetProcedures>(petContract(), transport, { validator: createAjvValidator() })

    await expect(client.pets.getPet({} as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(transport).not.toHaveBeenCalled()
  })

  it('calls procedures by dotted name', async () => {
    const transport = vi.fn<RpcTransport>(async ({ procedure, input }) => ({ procedure: procedure.name, input }))
    const caller = createRpcCaller<PetProcedures>(petContract(), transport)

    await expect(caller.call('health')).resolves.toEqual({ procedure: 'health', input: {} })
    await expect(caller.call('nope' as never)).rejects.toMatchObject({ code: 'PROCEDURE_NOT_FOUND' })
  })

  it('types methods from the procedure map', () => {
    type Client = RpcClient<PetProcedures>
    expectTypeOf<Client['pets']['getPet']>().parameter(0).toEqualTypeOf<{ petId: number; 'X-Trace'?: string }>()
    expectTypeOf<ReturnType<Client['pets']['getPet']>>().toEqualTypeOf<Promise<Pet>>()
    expectTypeOf<Client['health']>().parameter(0).toEqualTypeOf<Record<string, never> | undefined>()
    expectTypeOf<RpcHandlers<PetProcedures, Context>['pets']['deletePet']>().returns.toEqualTypeOf<void | Promise<void>>()
  })
})
