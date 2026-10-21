import type { OasSchema } from '@oa-sdk/parser'
import { codeForStatus, RpcError, toRpcError } from './errors.js'
import {
  buildHttpRequestParts,
  deserializeCookieParameter,
  deserializeHeaderParameter,
  deserializePathParameter,
  deserializeQueryParameter,
  deserializeQuerystringParameter,
  encodeResponseBody,
  parseCookies,
  parsePairs,
  readBody,
  SchemaResolver,
  setOwn,
} from './http-codec.js'
import { invokeServer, type RpcServer } from './server.js'
import type { RpcHeadersInit, RpcProcedure, RpcTransport } from './types.js'

export type HttpTransportOptions = {
  /** Base URL the procedure routes are resolved against, e.g. `https://api.example.com/v1`. */
  baseUrl: string
  fetch?: typeof globalThis.fetch
  /** Headers sent with every call, or a function computing them per call (e.g. an auth token). */
  headers?: RpcHeadersInit
}

/**
 * Calls each procedure through the REST route it was declared with: path, query, header and
 * cookie parameters, and the request body, are split out of the input as the contract binds them.
 */
export function createHttpTransport(options: HttpTransportOptions): RpcTransport {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const baseUrl = options.baseUrl.replace(/\/+$/, '')

  return async ({ procedure, input, signal, headers: callHeaders }) => {
    const parts = buildHttpRequestParts(procedure, input)
    const headers = new Headers(await resolveHeaders(options.headers))
    for (const [name, value] of Object.entries(parts.headers)) headers.set(name, value)
    if (parts.body?.contentType !== undefined) headers.set('content-type', parts.body.contentType)
    if (procedure.http.success.mediaType !== undefined && !headers.has('accept')) {
      headers.set('accept', procedure.http.success.mediaType)
    }
    for (const [name, value] of Object.entries(callHeaders ?? {})) headers.set(name, value)

    const url = `${baseUrl}${parts.path}${parts.query === '' ? '' : `?${parts.query}`}`
    let response: Response
    try {
      response = await fetchImpl(url, {
        method: procedure.http.method.toUpperCase(),
        headers,
        ...(parts.body === undefined ? {} : { body: parts.body.body }),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new RpcError('TRANSPORT', `Request for ${procedure.name} failed.`, { cause: error })
    }

    const body = procedure.http.method === 'head' ? undefined : await readBody(response).catch((error: unknown) => {
      // A call cancelled while its body was read rejects with the abort error, as a cancelled fetch does.
      if (signal?.aborted) throw error
      throw new RpcError('TRANSPORT', `Could not read the ${procedure.name} response.`, { status: response.status, cause: error })
    })
    if (!response.ok) throw errorFromHttpResponse(response, body)
    return procedure.output === null ? undefined : body
  }
}

/**
 * Builds an `RpcError` from a non-2xx response. A string `code` and a `message` (or `detail` /
 * `title`) in the body are used when present; the body is kept as `data`.
 */
export function errorFromHttpResponse(response: Response, body: unknown): RpcError {
  const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
  const code = typeof record.code === 'string' ? record.code : codeForStatus(response.status)
  const messageField = [record.message, record.detail, record.title].find(value => typeof value === 'string')
  const message = (messageField as string | undefined) ?? (response.statusText || `HTTP ${response.status}`)
  return new RpcError(code, message, { status: response.status, data: body })
}

async function resolveHeaders(headers: RpcHeadersInit | undefined): Promise<HeadersInit | undefined> {
  return typeof headers === 'function' ? await headers() : headers
}

export type RestFetchHandlerOptions<TContext> = {
  /** Path prefix the procedure routes are mounted under, e.g. `/v1`. */
  basePath?: string
  /** Builds the handler context of a request. */
  createContext?: (request: Request) => TContext | Promise<TContext>
}

/** Answers a request, or resolves `undefined` when it does not belong to the handler. */
export type RpcFetchHandler = (request: Request) => Promise<Response | undefined>

type CompiledRoute = {
  procedure: RpcProcedure
  pattern: RegExp
  fields: string[]
  specificity: number
}

/**
 * Serves the contract's REST routes from the server's handlers: the HTTP request is decoded back
 * into the call input, so one set of handlers answers both REST and JSON-RPC callers.
 * Resolves `undefined` for paths outside the contract so the handler composes with other routes.
 */
export function createRestFetchHandler<TContext = undefined>(
  server: RpcServer<TContext>,
  options: RestFetchHandlerOptions<TContext> = {},
): RpcFetchHandler {
  const basePath = (options.basePath ?? '').replace(/\/+$/, '')
  const resolver = new SchemaResolver(server.contract.schemas)
  const routes = Object.values(server.contract.procedures)
    .map(compileRoute)
    .sort((left, right) => right.specificity - left.specificity)

  return async (request) => {
    const url = new URL(request.url)
    if (basePath !== '' && url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) return undefined
    const pathname = url.pathname.slice(basePath.length) || '/'
    const method = request.method.toLowerCase()

    const allowed = new Set<string>()
    let matched: { route: CompiledRoute; values: string[] } | undefined
    for (const route of routes) {
      const match = route.pattern.exec(pathname)
      if (!match) continue
      allowed.add(route.procedure.http.method.toUpperCase())
      if (route.procedure.http.method === method) {
        matched = { route, values: match.slice(1) }
        break
      }
    }
    if (!matched) {
      if (allowed.size === 0) return undefined
      return errorResponse(new RpcError('METHOD_NOT_ALLOWED', `Method ${request.method} is not allowed.`), {
        allow: [...allowed].join(', '),
      })
    }

    const { procedure } = matched.route
    try {
      const input = await decodeInput(procedure, matched, url, request, resolver)
      const context = await options.createContext?.(request)
      const output = await invokeServer(server, procedure.name, input, { context, request, signal: request.signal })
      const encoded = procedure.output === null ? undefined : encodeResponseBody(output, procedure.http.success.mediaType)
      const headers = new Headers()
      if (encoded?.contentType !== undefined) headers.set('content-type', encoded.contentType)
      return new Response(encoded?.body ?? null, { status: procedure.http.success.status, headers })
    } catch (error) {
      return errorResponse(toRpcError(error))
    }
  }
}

function compileRoute(procedure: RpcProcedure): CompiledRoute {
  const fields: string[] = []
  let literalLength = 0
  const source = procedure.http.path.split(/(\{[^}]+\})/).map(piece => {
    const field = piece.match(/^\{([^}]+)\}$/)?.[1]
    if (field !== undefined) {
      fields.push(field)
      return '([^/]+)'
    }
    literalLength += piece.length
    return piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }).join('')
  return {
    procedure,
    pattern: new RegExp(`^${source}/?$`),
    fields,
    specificity: literalLength * 100 - fields.length,
  }
}

async function decodeInput(
  procedure: RpcProcedure,
  matched: { route: CompiledRoute; values: string[] },
  url: URL,
  request: Request,
  resolver: SchemaResolver,
): Promise<Record<string, unknown>> {
  const input: Record<string, unknown> = {}
  const fieldSchema = (field: string): OasSchema | undefined => procedure.input.properties?.[field]
  const pathValues = new Map(matched.route.fields.map((field, index) => [field, matched.values[index] ?? '']))
  const queryPairs = parsePairs(url.search)
  const cookies = parseCookies(request.headers.get('cookie'))

  const bodyBinding = procedure.http.body
  const body = bodyBinding === undefined ? undefined : await readBody(request)
  if (bodyBinding?.mode === 'spread' && body !== undefined) {
    if (typeof body !== 'object' || body === null || Array.isArray(body) || body instanceof Uint8Array) {
      throw new RpcError('INVALID_INPUT', `The ${procedure.name} request body must be an object.`)
    }
    const fields = isFormRecord(body, bodyBinding.mediaType) ? resolver.coerceObject(body, procedure.input) : body
    for (const [key, value] of Object.entries(fields)) setOwn(input, key, value)
  } else if (bodyBinding?.mode === 'field' && body !== undefined) {
    const schema = fieldSchema(bodyBinding.field)
    setOwn(input, bodyBinding.field, isFormRecord(body, bodyBinding.mediaType) ? resolver.coerceObject(body, schema) : body)
  }

  // Names an exploded object parameter must not take as its own additional properties.
  const claimedQuery = new Set(procedure.http.parameters.filter(binding => binding.in === 'query').map(binding => binding.field))
  const claimedCookies = new Set(procedure.http.parameters.filter(binding => binding.in === 'cookie').map(binding => binding.field))

  // Parameters are assigned last: a body property never overrides a declared parameter.
  for (const binding of procedure.http.parameters) {
    const schema = fieldSchema(binding.field)
    let value: unknown
    if (binding.in === 'path') value = deserializePathParameter(binding, pathValues.get(binding.field) ?? '', schema, resolver)
    else if (binding.in === 'query') value = deserializeQueryParameter(binding, queryPairs, schema, resolver, claimedQuery)
    else if (binding.in === 'querystring') value = deserializeQuerystringParameter(binding, url.search, schema, resolver)
    else if (binding.in === 'header') value = deserializeHeaderParameter(binding, request.headers.get(binding.field), schema, resolver)
    else value = deserializeCookieParameter(binding, cookies, schema, resolver, claimedCookies)
    if (value === undefined) delete input[binding.field]
    else setOwn(input, binding.field, value)
  }
  return input
}

function isFormRecord(body: unknown, mediaType: string): body is Record<string, unknown> {
  const essence = mediaType.split(';')[0]!.trim().toLowerCase()
  return (essence === 'application/x-www-form-urlencoded' || essence === 'multipart/form-data')
    && typeof body === 'object' && body !== null && !Array.isArray(body)
}

function errorResponse(error: RpcError, extraHeaders: Record<string, string> = {}): Response {
  const payload = error.data !== undefined ? error.data : { code: error.code, message: error.message }
  let body: string
  let status = error.status
  try {
    body = JSON.stringify(payload)
  } catch {
    // Error data JSON cannot represent (a bigint, a cycle) must not turn the answer into a rejection.
    body = JSON.stringify({ code: 'INTERNAL', message: 'Internal server error' })
    status = 500
  }
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  })
}
