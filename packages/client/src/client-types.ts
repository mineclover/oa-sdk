/**
 * Client runtime types, options, middleware, and standard authentication helpers.
 *
 * @oa-sdk/client
 */

export type ClientMethodOptions = {
  signal?: AbortSignal | null
  headers?: Record<string, string>
}

export type ClientMiddleware = {
  onRequest?: (url: string, init: RequestInit) => RequestInit | Promise<RequestInit>
  onResponse?: (response: Response) => Response | Promise<Response>
  onError?: (error: Error) => void
}

export type ClientResponse<TBody = unknown, THeaders extends object = Record<string, never>> = {
  body: TBody
  headers: THeaders
  response: Response
}

export type ClientConfig = {
  baseUrl?: string
  headers?: Record<string, string>
  middleware?: ClientMiddleware[]
  timeout?: number
  retry?: {
    maxRetries?: number
    baseDelay?: number
  }
  validate?: boolean
}

/** Auth middleware — HTTP Bearer token */
export function bearerAuth(token: string): ClientMiddleware {
  return {
    onRequest: (_url, init) => {
      const headers = new Headers(init.headers)
      headers.set('Authorization', `Bearer ${token}`)
      return { ...init, headers }
    },
  }
}

/** Auth middleware — HTTP Basic Auth */
export function basicAuth(username: string, password: string): ClientMiddleware {
  return {
    onRequest: (_url, init) => {
      const headers = new Headers(init.headers)
      const encoded = typeof btoa !== 'undefined'
        ? btoa(`${username}:${password}`)
        : Buffer.from(`${username}:${password}`).toString('base64')
      headers.set('Authorization', `Basic ${encoded}`)
      return { ...init, headers }
    },
  }
}

/** Auth middleware — API Key (header or cookie) */
export function apiKeyAuth(
  nameOrKey: string,
  keyOrLocation?: string,
  location: 'header' | 'cookie' = 'header'
): ClientMiddleware {
  let name: string
  let key: string
  let loc: 'header' | 'cookie' = location

  if (!keyOrLocation) {
    name = 'X-API-Key'
    key = nameOrKey
  } else if (keyOrLocation === 'header' || keyOrLocation === 'cookie') {
    name = 'X-API-Key'
    key = nameOrKey
    loc = keyOrLocation
  } else {
    name = nameOrKey
    key = keyOrLocation
  }

  return {
    onRequest: (_url, init) => {
      const headers = new Headers(init.headers)
      if (loc === 'cookie') {
        const existing = headers.get('Cookie') ?? ''
        headers.set('Cookie', existing ? `${existing}; ${name}=${key}` : `${name}=${key}`)
      } else {
        headers.set(name, key)
      }
      return { ...init, headers }
    },
  }
}
