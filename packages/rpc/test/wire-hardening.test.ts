import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { parseDocument, type OasDocument } from '@oa-sdk/parser'
import { buildRpcContract } from '@oa-sdk/surface-ir'
import {
  createHttpTransport,
  createJsonRpcFetchHandler,
  createJsonRpcTransport,
  createRestFetchHandler,
  createRpcCaller,
  createRpcClient,
  createRpcServer,
  isRpcError,
  RpcError,
  type RpcContract,
  type RpcTransport,
} from '../src/index.js'
import { createAjvValidator } from '../src/ajv.js'
import { petContract, type PetProcedures } from './fixture.js'

/** A fetch that answers from fetch handlers in memory and records the requests. */
function inMemoryFetch(...handlers: ((request: Request) => Promise<Response | undefined>)[]) {
  const requests: string[] = []
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const request = new Request(url, init)
    requests.push(`${request.method} ${request.url}`)
    for (const handler of handlers) {
      const response = await handler(request)
      if (response) return response
    }
    return new Response('not found', { status: 404 })
  })
  return { fetch, requests }
}

describe('REST path parameters never resolve to another route', () => {
  const users = (): RpcContract => buildRpcContract(parseDocument({
    openapi: '3.2.0',
    info: { title: 'Users', version: '1' },
    paths: {
      '/users': {
        get: { operationId: 'listUsers', responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array' } } } } } },
        delete: { operationId: 'deleteAllUsers', responses: { '204': { description: 'gone' } } },
      },
      '/users/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: {} }],
        get: { operationId: 'getUser', responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object' } } } } } },
        delete: { operationId: 'deleteUser', responses: { '204': { description: 'gone' } } },
      },
    },
  } as unknown as OasDocument))

  it.each([
    ['an empty string', ''],
    ['an empty array', []],
    ['an empty object', {}],
    ['a dot segment', '.'],
    ['a double dot segment', '..'],
  ])('rejects %s before sending, so deleteUser cannot run deleteAllUsers', async (_label, id) => {
    const deleteAllUsers = vi.fn()
    const server = createRpcServer(users(), {
      listUsers: () => [{ id: 'a' }],
      deleteAllUsers,
      getUser: () => ({ id: 'x' }),
      deleteUser: () => undefined,
    })
    const { fetch, requests } = inMemoryFetch(createRestFetchHandler(server))
    const client = createRpcCaller(server.contract, createHttpTransport({ baseUrl: 'https://t.test', fetch }))

    await expect(client.call('deleteUser', { id })).rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('"id"') })
    await expect(client.call('getUser', { id })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(requests).toEqual([])
    expect(deleteAllUsers).not.toHaveBeenCalled()
  })

  it('still sends non-empty values, including ones that look like dot segments only in part', async () => {
    const server = createRpcServer(users(), {
      listUsers: () => [],
      deleteAllUsers: () => undefined,
      getUser: (input: { id: string }) => input,
      deleteUser: () => undefined,
    })
    const { fetch, requests } = inMemoryFetch(createRestFetchHandler(server))
    const client = createRpcCaller(server.contract, createHttpTransport({ baseUrl: 'https://t.test', fetch }))

    await expect(client.call('getUser', { id: '...' })).resolves.toEqual({ id: '...' })
    await expect(client.call('getUser', { id: 'a/b' })).resolves.toEqual({ id: 'a/b' })
    expect(requests).toEqual(['GET https://t.test/users/...', 'GET https://t.test/users/a%2Fb'])
  })

  it('rejects an empty path value of the petstore contract without a validator', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const client = createRpcClient<PetProcedures>(petContract(), createHttpTransport({ baseUrl: 'https://pets.test', fetch }))

    await expect(client.pets.getPet({ petId: '' as never })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('responses JSON cannot represent', () => {
  function bigServer(mutations: string[]) {
    return createRpcServer(petContract(), {
      pets: {
        getPet: () => ({ id: 10n, name: 'big' }),
        createPet: (input: { name: string }) => {
          mutations.push(input.name)
          return { id: 2, name: input.name }
        },
        deletePet: () => {
          throw new RpcError('CONFLICT', 'Pet is busy', { data: { since: 5n } })
        },
      },
      health: () => 'ok',
    }, { allowPartial: true })
  }

  it('answers a JSON-RPC batch with an INTERNAL entry only for the call whose result failed to serialize', async () => {
    const mutations: string[] = []
    const handler = createJsonRpcFetchHandler(bigServer(mutations))
    const response = await handler(new Request('https://pets.test/rpc', {
      method: 'POST',
      body: JSON.stringify([
        { jsonrpc: '2.0', id: 1, method: 'pets.getPet', params: { petId: 1 } },
        { jsonrpc: '2.0', id: 2, method: 'pets.createPet', params: { name: 'Tom' } },
        { jsonrpc: '2.0', id: 3, method: 'pets.deletePet', params: { petId: 1 } },
      ]),
    }))

    expect(response?.status).toBe(200)
    await expect(response?.json()).resolves.toEqual([
      { jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Internal server error', data: { code: 'INTERNAL', status: 500 } } },
      { jsonrpc: '2.0', id: 2, result: { id: 2, name: 'Tom' } },
      { jsonrpc: '2.0', id: 3, error: { code: -32603, message: 'Internal server error', data: { code: 'INTERNAL', status: 500 } } },
    ])
    expect(mutations).toEqual(['Tom'])
  })

  it('answers a single JSON-RPC call and a failing createContext with a JSON-RPC error instead of rejecting', async () => {
    const handler = createJsonRpcFetchHandler(bigServer([]))
    const single = await handler(new Request('https://pets.test/rpc', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 'a', method: 'pets.getPet', params: { petId: 1 } }),
    }))
    await expect(single?.json()).resolves.toMatchObject({ id: 'a', error: { code: -32603 } })

    const failingContext = createJsonRpcFetchHandler(bigServer([]), {
      createContext: () => { throw new RpcError('UNAUTHORIZED', 'No', { data: { at: 1n } }) },
    })
    const rejected = await failingContext(new Request('https://pets.test/rpc', { method: 'POST', body: '{}' }))
    await expect(rejected?.json()).resolves.toMatchObject({ id: null, error: { code: -32603 } })
  })

  it('answers REST errors whose data JSON cannot represent with a 500 INTERNAL body', async () => {
    const handler = createRestFetchHandler(bigServer([]))
    const response = await handler(new Request('https://pets.test/pets/1', { method: 'DELETE' }))

    expect(response?.status).toBe(500)
    await expect(response?.json()).resolves.toEqual({ code: 'INTERNAL', message: 'Internal server error' })
    const result = await handler(new Request('https://pets.test/pets/1'))
    expect(result?.status).toBe(500)
  })
})

describe('createAjvValidator accepts the values binary bodies decode to', () => {
  const uploadDocument = {
    openapi: '3.0.3',
    info: { title: 'Files', version: '1' },
    paths: {
      '/upload': {
        post: {
          operationId: 'upload',
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['file'],
                  properties: {
                    file: { type: 'string', format: 'binary' },
                    thumbnails: { type: 'array', items: { $ref: '#/components/schemas/Binary' } },
                    note: { type: 'string', maxLength: 3 },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object' } } } } },
        },
      },
      '/blobs/{id}': {
        put: {
          operationId: 'putBlob',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/octet-stream': { schema: { type: ['string', 'null'], format: 'binary' } } },
          },
          responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object' } } } } },
        },
      },
    },
    components: { schemas: { Binary: { type: 'string', format: 'binary' } } },
  } as unknown as OasDocument

  function setup() {
    const contract = buildRpcContract(parseDocument(structuredClone(uploadDocument)))
    const pristine = structuredClone(contract)
    const server = createRpcServer(contract, {
      upload: (input: { file: Blob; note?: string; thumbnails?: Blob[] }) => ({ size: input.file.size, ...(input.note === undefined ? { thumbnails: input.thumbnails?.length ?? 0 } : { note: input.note }) }),
      putBlob: (input: { id: string; body: Uint8Array }) => ({ id: input.id, size: input.body.byteLength }),
    }, { validator: createAjvValidator() })
    const handler = createRestFetchHandler(server)
    return { contract, pristine, handler }
  }

  it('lets a multipart file part and an octet-stream body through the REST handler', async () => {
    const { handler } = setup()
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array([1, 2, 3])]), 'a.bin')
    form.append('note', 'hi')
    const upload = await handler(new Request('https://f.test/upload', { method: 'POST', body: form }))
    expect(upload?.status).toBe(200)
    await expect(upload?.json()).resolves.toEqual({ size: 3, note: 'hi' })

    const put = await handler(new Request('https://f.test/blobs/x', {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Uint8Array([1, 2, 3, 4]),
    }))
    expect(put?.status).toBe(200)
    await expect(put?.json()).resolves.toEqual({ id: 'x', size: 4 })
  })

  it('keeps required and the other keywords, and leaves the contract untouched', async () => {
    const { contract, pristine, handler } = setup()
    const missing = new FormData()
    missing.append('note', 'hi')
    const rejected = await handler(new Request('https://f.test/upload', { method: 'POST', body: missing }))
    expect(rejected?.status).toBe(400)
    await expect(rejected?.json()).resolves.toMatchObject({ code: 'INVALID_INPUT', issues: [{ path: '/', message: 'missing required property "file"' }] })

    const tooLong = new FormData()
    tooLong.append('file', new Blob(['x']), 'x.bin')
    tooLong.append('note', 'long note')
    const longNote = await handler(new Request('https://f.test/upload', { method: 'POST', body: tooLong }))
    expect(longNote?.status).toBe(400)

    expect(contract).toEqual(pristine)
  })

  it('lets Blob and Uint8Array input pass client-side validation', async () => {
    const { contract, handler } = setup()
    const { fetch } = inMemoryFetch(handler)
    const caller = createRpcCaller(contract, createHttpTransport({ baseUrl: 'https://f.test', fetch }), { validator: createAjvValidator() })

    await expect(caller.call('upload', { file: new Blob(['abcd']) })).resolves.toEqual({ size: 4, thumbnails: 0 })
    await expect(caller.call('putBlob', { id: 'y', body: new Uint8Array([9]) })).resolves.toEqual({ id: 'y', size: 1 })
    await expect(caller.call('upload', { note: 'x' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('decodes a repeated file field with one or more parts into an array', async () => {
    const { contract, handler } = setup()
    const { fetch } = inMemoryFetch(handler)
    const caller = createRpcCaller(contract, createHttpTransport({ baseUrl: 'https://f.test', fetch }), { validator: createAjvValidator() })

    await expect(caller.call('upload', { file: new Blob(['a']), thumbnails: [new Blob(['t'])] })).resolves.toEqual({ size: 1, thumbnails: 1 })
    await expect(caller.call('upload', { file: new Blob(['a']), thumbnails: [new Blob(['t']), new Blob(['u'])] })).resolves.toEqual({ size: 1, thumbnails: 2 })
  })
})

describe('transport failures', () => {
  /** A JSON response whose body errors with the signal's reason once the signal aborts. */
  function stallingResponse(signal: AbortSignal | null | undefined, status = 200): Response {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"jsonrpc":'))
        signal?.addEventListener('abort', () => controller.error(signal.reason))
      },
    })
    return new Response(body, { status, headers: { 'content-type': 'application/json' } })
  }

  it.each([
    ['REST', (fetch: typeof globalThis.fetch) => createHttpTransport({ baseUrl: 'https://pets.test', fetch })],
    ['JSON-RPC', (fetch: typeof globalThis.fetch) => createJsonRpcTransport({ url: 'https://pets.test/rpc', fetch })],
  ] as const)('%s: a call aborted while its body is read rejects with the abort reason, not RpcError', async (_label, transport) => {
    const controller = new AbortController()
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      setTimeout(() => controller.abort(), 0)
      return stallingResponse(init?.signal)
    })
    const client = createRpcClient<PetProcedures>(petContract(), transport(fetch))

    const error = await client.pets.getPet({ petId: 1 }, { signal: controller.signal }).catch((caught: unknown) => caught)
    expect(isRpcError(error)).toBe(false)
    expect(error).toBe(controller.signal.reason)
    expect(error).toMatchObject({ name: 'AbortError' })
  })

  it.each([
    ['an unreadable body', 200, '{'],
    ['a JSON body that is not JSON-RPC', 401, '{"message":"sign in"}'],
    ['an error object without a numeric code', 200, '{"jsonrpc":"2.0","id":1,"error":{"code":"x","message":"m"}}'],
    ['a response without result or error', 200, '{"jsonrpc":"2.0","id":1}'],
    ['a response whose only error is null', 200, '{"jsonrpc":"2.0","id":1,"error":null}'],
    ['a non-object error next to a result', 200, '{"jsonrpc":"2.0","id":1,"result":"ok","error":"boom"}'],
    ['a batch answer to a single call', 200, '[{"jsonrpc":"2.0","id":1,"result":"ok"}]'],
  ])('JSON-RPC: %s rejects as TRANSPORT with the response status', async (_label, status, body) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(body, { status, headers: { 'content-type': 'application/json' } }))
    const client = createRpcClient<PetProcedures>(petContract(), createJsonRpcTransport({ url: 'https://pets.test/rpc', fetch }))

    await expect(client.health()).rejects.toMatchObject({ code: 'TRANSPORT', status })
  })

  it('JSON-RPC: a result sent with "error": null resolves with the result', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ jsonrpc: '2.0', id: 1, result: 'ok', error: null }))
    const client = createRpcClient<PetProcedures>(petContract(), createJsonRpcTransport({ url: 'https://pets.test/rpc', fetch }))

    await expect(client.health()).resolves.toBe('ok')
  })

  it('JSON-RPC: restores errors of the matching id and of id null, keeping foreign error data', async () => {
    const answers = [
      { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'nope', data: 'foreign' } },
      { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'later', data: { code: 'UNAUTHORIZED', status: 401 } } },
      { jsonrpc: '2.0', id: 99, result: 'ok' },
    ]
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(answers.shift()))
    const client = createRpcClient<PetProcedures>(petContract(), createJsonRpcTransport({ url: 'https://pets.test/rpc', fetch }))

    await expect(client.health()).rejects.toMatchObject({ code: 'PROCEDURE_NOT_FOUND', message: 'nope', data: 'foreign' })
    await expect(client.health()).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401, message: 'later' })
    await expect(client.health()).rejects.toMatchObject({ code: 'TRANSPORT', message: expect.stringContaining('request 3') })
  })
})

describe('untyped procedures', () => {
  it('resolve unknown results until the caller narrows them', () => {
    const transport: RpcTransport = async () => null
    const caller = createRpcCaller(petContract(), transport)
    expectTypeOf(caller.call('health')).toEqualTypeOf<Promise<unknown>>()
    expectTypeOf(caller.call).parameter(1).toEqualTypeOf<unknown>()
  })
})
