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

    if (options.path) {
      for (const [key, val] of Object.entries(options.path)) {
        resolvedUrl = resolvedUrl.replace(`{${key}}`, encodeURIComponent(String(val)))
      }
    }

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
