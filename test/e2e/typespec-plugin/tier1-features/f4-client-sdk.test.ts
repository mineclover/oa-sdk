import { describe, it, expect, vi } from 'vitest'

/**
 * openapi-ts Client Contract Definitions & Reference Harness
 * Grounded in ORIGINAL_REQUEST §R2 and PROJECT.md §M2.
 */
export interface RequestParameters<
  TPath = unknown,
  TQuery = unknown,
  TBody = unknown,
  THeaders = unknown,
> {
  path?: TPath
  query?: TQuery
  body?: TBody
  headers?: THeaders
}

export type RequestOptions<TData = unknown> = TData & {
  client?: Client
  signal?: AbortSignal | null
  throwOnError?: boolean
}

export type ClientResult<TData = unknown, TError = unknown> =
  | {
      data: TData
      error: undefined
      response: Response
    }
  | {
      data: undefined
      error: TError
      response: Response
    }

export interface ClientConfig {
  baseUrl?: string
  headers?: Record<string, string>
  fetch?: typeof fetch
}

export class Client {
  public readonly config: ClientConfig

  constructor(config?: ClientConfig) {
    this.config = { baseUrl: '', ...config }
  }

  async request<TData = unknown, TError = unknown>(options: {
    method: string
    url: string
    path?: Record<string, unknown>
    query?: Record<string, unknown>
    body?: unknown
    headers?: Record<string, string>
    signal?: AbortSignal | null
    throwOnError?: boolean
  }): Promise<ClientResult<TData, TError>> {
    let resolvedUrl = options.url

    // 1. Path interpolation
    if (options.path) {
      for (const [key, val] of Object.entries(options.path)) {
        resolvedUrl = resolvedUrl.replace(`{${key}}`, encodeURIComponent(String(val)))
      }
    }

    // 2. Query string formatting (strict signal/undefined exclusion)
    if (options.query) {
      const searchParams = new URLSearchParams()
      for (const [key, val] of Object.entries(options.query)) {
        if (val !== undefined && key !== 'signal') {
          searchParams.append(key, String(val))
        }
      }
      const qs = searchParams.toString()
      if (qs.length > 0) {
        resolvedUrl += `?${qs}`
      }
    }

    const fullUrl = this.config.baseUrl ? `${this.config.baseUrl}${resolvedUrl}` : resolvedUrl
    const fetchFn = this.config.fetch ?? globalThis.fetch

    const init: RequestInit = {
      method: options.method,
      headers: { ...this.config.headers, ...options.headers },
      signal: options.signal,
    }

    if (options.body !== undefined) {
      (init.headers as Record<string, string>)['content-type'] = 'application/json'
      init.body = JSON.stringify(options.body)
    }

    const response = await fetchFn(fullUrl, init)

    if (response.status === 204) {
      return {
        data: undefined as unknown as TData,
        error: undefined,
        response,
      }
    }

    let payload: unknown = undefined
    try {
      payload = await response.json()
    } catch {
      // empty or non-json body
    }

    if (response.ok) {
      return {
        data: payload as TData,
        error: undefined,
        response,
      }
    }

    if (options.throwOnError) {
      throw new Error(`HTTP Error ${response.status}: ${JSON.stringify(payload)}`)
    }

    return {
      data: undefined,
      error: payload as TError,
      response,
    }
  }

  get<TData = unknown, TError = unknown>(opts: Omit<Parameters<Client['request']>[0], 'method'>) {
    return this.request<TData, TError>({ ...opts, method: 'GET' })
  }

  post<TData = unknown, TError = unknown>(opts: Omit<Parameters<Client['request']>[0], 'method'>) {
    return this.request<TData, TError>({ ...opts, method: 'POST' })
  }
}

describe('Tier 1: F4 - openapi-ts Style Client SDK', () => {
  it('F4.1: accepts single-object parameter convention { path, query, body, headers }', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'pet-123', name: 'Fluffy' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const client = new Client({ baseUrl: 'https://api.example.com', fetch: mockFetch })

    const result = await client.request<{ id: string; name: string }, { message: string }>({
      method: 'POST',
      url: '/pets/{petId}',
      path: { petId: 'pet-123' },
      query: { notify: true },
      body: { name: 'Fluffy' },
      headers: { 'x-correlation-id': 'corr-abc' },
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [calledUrl, calledInit] = mockFetch.mock.calls[0]
    expect(calledUrl).toBe('https://api.example.com/pets/pet-123?notify=true')
    expect(calledInit.headers['x-correlation-id']).toBe('corr-abc')
    expect(calledInit.body).toBe(JSON.stringify({ name: 'Fluffy' }))
  })

  it('F4.2: narrows return types cleanly via { data, error, response } discriminated union', async () => {
    // 1. Success response
    const successFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'pet-1', name: 'Barky' }), { status: 200 }),
    )
    const clientSuccess = new Client({ fetch: successFetch })
    const successRes = await clientSuccess.get<{ id: string; name: string }, { code: string }>({
      url: '/pets/1',
    })

    if (successRes.error) {
      throw new Error('Should not have error on 200')
    }
    // TypeScript & runtime check
    expect(successRes.data).toEqual({ id: 'pet-1', name: 'Barky' })
    expect(successRes.error).toBeUndefined()
    expect(successRes.response.status).toBe(200)

    // 2. Error response
    const errorFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'Pet not found' }), { status: 404 }),
    )
    const clientError = new Client({ fetch: errorFetch })
    const errorRes = await clientError.get<{ id: string; name: string }, { code: string; message: string }>({
      url: '/pets/999',
    })

    if (!errorRes.error) {
      throw new Error('Should have error on 404')
    }
    expect(errorRes.data).toBeUndefined()
    expect(errorRes.error.code).toBe('NOT_FOUND')
    expect(errorRes.response.status).toBe(404)
  })

  it('F4.3: supports standalone endpoint calling function with custom client binding', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'p1', name: 'Fido' }), { status: 200 }),
    )
    const client = new Client({ baseUrl: 'https://pets.io', fetch: mockFetch })

    // Standalone function implementation matching openapi-ts style
    async function getPetById(options: RequestOptions<{ path: { petId: string } }>) {
      const activeClient = options.client ?? client
      return activeClient.get<{ id: string; name: string }, { error: string }>({
        url: '/pets/{petId}',
        path: options.path,
        signal: options.signal,
      })
    }

    const res = await getPetById({ path: { petId: 'p1' }, client })
    expect(res.data?.name).toBe('Fido')
    expect(mockFetch).toHaveBeenCalledWith('https://pets.io/pets/p1', expect.anything())
  })

  it('F4.4: supports central Client class instance with request routing and verb methods', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    const client = new Client({ baseUrl: 'https://api.test', fetch: mockFetch })

    await client.get({ url: '/items' })
    expect(mockFetch.mock.calls[0][1].method).toBe('GET')

    await client.post({ url: '/items', body: { a: 1 } })
    expect(mockFetch.mock.calls[1][1].method).toBe('POST')
  })

  it('F4.5: passes AbortSignal transparently without polluting query parameters', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }))
    const client = new Client({ baseUrl: 'https://api.test', fetch: mockFetch })

    const controller = new AbortController()
    await client.get({
      url: '/pets',
      query: { limit: 10 },
      signal: controller.signal,
    })

    const [calledUrl, calledInit] = mockFetch.mock.calls[0]
    expect(calledUrl).toBe('https://api.test/pets?limit=10')
    expect(calledUrl).not.toContain('signal')
    expect(calledInit.signal).toBe(controller.signal)
  })
})
