import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  assertParsedDocumentComplete,
  parseDocument,
  matchRoute,
  resolveServerUrl,
  type HttpMethod,
  type MatchResult,
  type OasDocument,
  type OasSchema,
  type OperationEntry,
  type RouteIndex,
} from '@oa-sdk/parser'
import { handleRequest } from '../core/handler.js'
import { isStreamingContentType, generateStreamChunks } from '../core/stream.js'
import { filterRouteIndex, type RouteFilter } from '../core/route-filter.js'
import { assertValidRequestSchemas, createMultipartBody, type MultipartPartMetadata } from '../core/request-validator.js'
import { serializeResponseBody } from '../core/body-serialization.js'
import { isXmlMediaType } from '../core/xml.js'
import type { CallbackObserver, CallbackPostAttempt } from '../core/callbacks.js'
import { pickResponse } from '../core/response-picker.js'

export type NodeMockServerOptions = {
  port?: number
  host?: string
  /** servers 배열에서 사용할 서버 인덱스 (기본: 0) */
  serverIndex?: number
  /** server variables 오버라이드 */
  serverVariables?: Record<string, string>
  /** 라우트 필터 — 조건에 맞는 라우트만 서빙 */
  include?: RouteFilter
  /** 요청 body/parameter 스키마를 서버 생성 시점에 미리 컴파일 (기본: true) */
  validateRequestSchemas?: boolean
  /** 성공 응답 후 simulated outbound callback POST 시도마다 호출되는 관찰 훅 */
  onCallback?: CallbackObserver
}

export type OverrideResponse = {
  status: number
  body?: unknown
  headers?: Record<string, string>
}

export type NodeMockServer = {
  start(): Promise<void>
  stop(): Promise<void>
  readonly url: string
  override(operationId: string, response: OverrideResponse): void
  clearOverride(operationId: string): void
  clearOverrides(): void
  /**
   * Hot-swap OpenAPI specification and recompile routing/validation state
   * without restarting the HTTP server or dropping port binding.
   */
  updateSpec(spec: OasDocument | Record<string, unknown>): { routesCount: number }
}

/** Pre-serialized response structure for static route responses */
type PrecomputedResponse = {
  status: number
  contentType: string
  payload: string
  headers: Record<string, string | number>
  originalBody: unknown
}

type ServerRoutingState = {
  parsed: ReturnType<typeof parseDocument>
  basePath: string
  index: RouteIndex
  precomputed: Map<OperationEntry, PrecomputedResponse>
  allowedHeadersCache: Map<string, string>
}

// ─── Pre-allocated Constants for Common Static Error Frames ─────────────────

const INTERNAL_ERROR_PAYLOAD = JSON.stringify({
  error: { code: 'CONSTRAINT_VIOLATION', message: 'Mock 처리 중 내부 오류가 발생했습니다', details: [] },
})
const INTERNAL_ERROR_HEADERS = {
  'Content-Type': 'application/json',
  'Content-Length': Buffer.byteLength(INTERNAL_ERROR_PAYLOAD),
}

/**
 * OpenAPI 스펙 기반 Node HTTP mock 서버 생성.
 * Playwright E2E, 네이티브 앱 등 실제 HTTP 서버가 필요한 환경용.
 *
 * @example
 * import spec from '@oa-sdk/schemas'
 * import { createNodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
 *
 * const server = createNodeMockServer(spec, { port: 4010 })
 * await server.start()
 * // ... tests ...
 * await server.stop()
 */
export function createNodeMockServer(
  spec: OasDocument | Record<string, unknown>,
  options: NodeMockServerOptions = {},
): NodeMockServer {
  const {
    port = 4010,
    host = '127.0.0.1',
    serverIndex = 0,
    serverVariables,
    include,
    validateRequestSchemas: shouldValidateRequestSchemas = true,
    onCallback,
  } = options

  function compileRoutingState(
    currentSpec: OasDocument | Record<string, unknown>,
    context: string,
  ): ServerRoutingState {
    const nextParsed = parseDocument(currentSpec as OasDocument)
    assertParsedDocumentComplete(nextParsed, context)
    if (!Number.isInteger(serverIndex) || serverIndex < 0 || (nextParsed.servers.length > 0 && serverIndex >= nextParsed.servers.length)) {
      throw new RangeError(`serverIndex must select a declared server (received ${serverIndex})`)
    }
    const nextSelectedServer = nextParsed.servers[serverIndex]
    const nextBasePath = nextSelectedServer ? extractPathname(resolveServerUrl(nextSelectedServer, serverVariables)) : ''
    const nextMergedRoutes = mergeWebhookRoutes(nextParsed.routes, nextParsed.webhooks)
    const nextIndex = filterRouteIndex(nextMergedRoutes, include)
    if (shouldValidateRequestSchemas) assertValidRequestSchemas(nextIndex)
    // Precalculate default static responses for all operation entries
    const precomputed = new Map<OperationEntry, PrecomputedResponse>()
    const allowedHeadersCache = new Map<string, string>()

    for (const [, methodMap] of nextIndex) {
      for (const [, entry] of methodMap) {
        if (entry.responses) {
          const picked = pickResponse(entry.responses)
          if (picked && !isStreamingContentType(picked.contentType)) {
            const payload = serializeResponseBody(picked.contentType, picked.body, picked.schema)
            const contentLength = Buffer.byteLength(payload)
            const headers: Record<string, string | number> = {
              ...picked.headers,
              'Content-Type': picked.contentType,
              'Content-Length': contentLength,
            }
            precomputed.set(entry, {
              status: picked.status,
              contentType: picked.contentType,
              payload,
              headers,
              originalBody: picked.body,
            })
          }
        }
      }
    }

    return {
      parsed: nextParsed,
      basePath: nextBasePath,
      index: nextIndex,
      precomputed,
      allowedHeadersCache,
    }
  }

  let state = compileRoutingState(spec, '@oa-sdk/mock-server createNodeMockServer')
  let httpServer: Server | null = null
  let actualPort = port // port: 0이면 listen 후 실제 포트로 갱신
  const formattedHost = formatHost(host)
  let requestOrigin = `http://${formattedHost}:${actualPort}`
  const overrides = new Map<string, OverrideResponse>()

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const currentState = state
    const method = (req.method ?? 'GET').toLowerCase() as HttpMethod
    const rawUrl = req.url ?? '/'

    // Fast-path URL parsing: bypass WHATWG URL parser for typical relative paths
    let urlPath: string
    let queryParams: Record<string, string | string[]> = {}
    let rawQueryString: string | undefined
    let requestUrl: string

    if (rawUrl.charCodeAt(0) === 47 /* '/' */) {
      const qIndex = rawUrl.indexOf('?')
      if (qIndex === -1) {
        const hIndex = rawUrl.indexOf('#')
        urlPath = stripBasePath(hIndex === -1 ? rawUrl : rawUrl.slice(0, hIndex), currentState.basePath)
      } else {
        urlPath = stripBasePath(rawUrl.slice(0, qIndex), currentState.basePath)
        const hIndex = rawUrl.indexOf('#', qIndex + 1)
        rawQueryString = rawUrl.slice(qIndex + 1, hIndex === -1 ? undefined : hIndex)
        const params = new URLSearchParams(rawQueryString)
        for (const [k, v] of params.entries()) {
          const existing = queryParams[k]
          if (existing !== undefined) {
            queryParams[k] = Array.isArray(existing) ? [...existing, v] : [existing, v]
          } else {
            queryParams[k] = v
          }
        }
      }
      requestUrl = `${requestOrigin}${rawUrl}`
    } else {
      // Fallback for full absolute URLs (e.g. forward proxy requests)
      const parsedUrl = new URL(rawUrl, requestOrigin)
      urlPath = stripBasePath(parsedUrl.pathname, currentState.basePath)
      rawQueryString = extractRawQueryString(rawUrl)
      for (const [k, v] of parsedUrl.searchParams.entries()) {
        const existing = queryParams[k]
        if (existing !== undefined) {
          queryParams[k] = Array.isArray(existing) ? [...existing, v] : [existing, v]
        } else {
          queryParams[k] = v
        }
      }
      requestUrl = parsedUrl.toString()
    }

    const matched: MatchResult = matchRoute(currentState.index, method, urlPath)

    if (matched.type === 'not_found') {
      writeJson(res, 404, {
        error: { code: 'NOT_FOUND', message: `${method.toUpperCase()} ${urlPath} 는 정의되지 않은 경로입니다`, details: [] },
      })
      return
    }

    if (matched.type === 'method_not_allowed') {
      let allow = currentState.allowedHeadersCache.get(urlPath)
      if (allow === undefined) {
        allow = matched.allowed.map((m: string) => m.toUpperCase()).join(', ')
        currentState.allowedHeadersCache.set(urlPath, allow)
      }
      res.writeHead(405, { Allow: allow, 'Content-Length': '0' })
      res.end()
      return
    }

    const { entry, pathParams } = matched

    // override 체크 — 해당 operationId에 오버라이드가 있으면 바로 반환
    const ov = entry.operationId ? overrides.get(entry.operationId) : undefined
    if (ov) {
      const ovHeaders = ov.headers ?? {}
      if (ov.body === undefined) {
        res.writeHead(ov.status, { ...ovHeaders, 'Content-Length': '0' })
        res.end()
      } else {
        writeBody(
          res,
          ov.status,
          ovHeaders['Content-Type'] ?? ovHeaders['content-type'] ?? 'application/json',
          ov.body,
          ovHeaders,
        )
      }
      return
    }

    // Fast-path headers extraction avoiding Object.entries array allocation
    const reqHeaders = req.headers
    const headers: Record<string, string> = {}
    for (const k in reqHeaders) {
      const v = reqHeaders[k]
      if (typeof v === 'string') headers[k] = v
      else if (Array.isArray(v)) headers[k] = v[0] ?? ''
    }

    const contentType = headers['content-type']
    const parsedBody = await readBody(req)

    const hr = handleRequest(
      {
        pathParams,
        queryParams,
        ...(rawQueryString !== undefined ? { rawQueryString } : {}),
        headers,
        body: parsedBody.body,
        ...(parsedBody.parseError ? { bodyParseError: parsedBody.parseError } : {}),
        contentType,
        url: requestUrl,
      },
      entry,
      currentState.parsed.securitySchemes,
    )

    if (hr.type === 'validation-error') { writeJson(res, hr.status, hr.body); return }
    if (hr.type === 'schema-error') { writeJson(res, hr.status, hr.body); return }
    if (hr.type === 'no-response') { writeJson(res, hr.status, hr.body); return }
    const picked = hr.picked
    await notifyCallbackAttempts(hr.callbacks, onCallback)

    // 스트리밍 응답 — SSE는 data:\n\n 포맷, NDJSON/JSONL은 <json>\n 포맷
    if (isStreamingContentType(picked.contentType)) {
      res.writeHead(picked.status, {
        ...picked.headers,
        'Content-Type': picked.contentType,
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      })
      for await (const chunk of generateStreamChunks(picked)) {
        res.write(chunk)
      }
      res.end()
      return
    }

    // Fast path: reuse pre-calculated serialized body and pre-allocated static headers
    const precalc = currentState.precomputed.get(entry)
    if (precalc && picked.status === precalc.status && picked.body === precalc.originalBody) {
      res.writeHead(precalc.status, precalc.headers)
      res.end(precalc.payload)
      return
    }

    writeBody(res, picked.status, picked.contentType, picked.body, picked.headers, picked.schema)
  }

  return {
    get url() { return `http://${formattedHost}:${actualPort}${state.basePath}` },

    start(): Promise<void> {
      return new Promise((resolve, reject) => {
        httpServer = createServer((req, res) => {
          handler(req, res).catch(() => {
            if (res.writableEnded) return
            if (res.headersSent) {
              res.destroy()
              return
            }
            res.writeHead(500, INTERNAL_ERROR_HEADERS)
            res.end(INTERNAL_ERROR_PAYLOAD)
          })
        })
        httpServer.listen(port, host, () => {
          const addr = httpServer!.address()
          if (addr && typeof addr === 'object') {
            actualPort = addr.port
            requestOrigin = `http://${formattedHost}:${actualPort}`
          }
          resolve()
        })
        httpServer.once('error', reject)
      })
    },

    stop(): Promise<void> {
      return new Promise((resolve, reject) => {
        if (!httpServer) return resolve()
        const srv = httpServer
        httpServer = null
        srv.closeAllConnections()
        srv.close(err => err ? reject(err) : resolve())
      })
    },

    override(operationId: string, response: OverrideResponse): void {
      overrides.set(operationId, response)
    },

    clearOverride(operationId: string): void {
      overrides.delete(operationId)
    },

    clearOverrides(): void {
      overrides.clear()
    },

    updateSpec(nextSpec: OasDocument | Record<string, unknown>): { routesCount: number } {
      const nextState = compileRoutingState(nextSpec, '@oa-sdk/mock-server updateSpec')
      state = nextState
      let routesCount = 0
      for (const methodMap of state.index.values()) {
        routesCount += methodMap.size
      }
      return { routesCount }
    },
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body) ?? ''
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function writeBody(
  res: ServerResponse,
  status: number,
  contentType: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
  schema?: OasSchema,
): void {
  const payload = serializeResponseBody(contentType, body, schema)
  const byteLength = Buffer.byteLength(payload)
  if (Object.keys(extraHeaders).length === 0) {
    res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': byteLength })
  } else {
    res.writeHead(status, { ...extraHeaders, 'Content-Type': contentType, 'Content-Length': byteLength })
  }
  res.end(payload)
}

async function notifyCallbackAttempts(attempts: readonly CallbackPostAttempt[], observer: CallbackObserver | undefined): Promise<void> {
  if (!observer) return
  for (const attempt of attempts) await observer(attempt)
}

type ParsedRequestBody = { body: unknown; parseError?: 'invalid-json' }

async function readBody(req: IncomingMessage): Promise<ParsedRequestBody> {
  const te = req.headers['transfer-encoding']
  const cl = req.headers['content-length']

  // Fast-path: bodiless requests (GET, HEAD, DELETE without body payload)
  if (te === undefined && (cl === undefined || cl === '0')) {
    req.resume()
    return { body: undefined }
  }

  const ct = (req.headers['content-type'] ?? '').split(';')[0]?.trim() ?? ''
  const raw = await readRaw(req)
  if (raw === '') return { body: undefined }

  if (ct === 'application/json') {
    try { return { body: JSON.parse(raw) } } catch { return { body: undefined, parseError: 'invalid-json' } }
  }

  // multipart/form-data — boundary 기반 간단 파싱 (외부 패키지 없이)
  if (ct === 'multipart/form-data') {
    const boundary = parseHeaderParameter(req.headers['content-type'] ?? '', 'boundary')
    if (!boundary) return { body: undefined }
    const parts = raw.split(`--${boundary}`).slice(1, -1) // 첫/마지막 빈 파트 제거
    const parsedParts: MultipartPartMetadata[] = []
    for (const part of parts) {
      const headerEnd = part.indexOf('\r\n\r\n')
      if (headerEnd === -1) continue
      const header = part.slice(0, headerEnd)
      const value = part.slice(headerEnd + 4).replace(/\r\n$/, '')
      const headers = parseMultipartHeaders(header)
      const disposition = headers['content-disposition'] ?? ''
      const name = parseHeaderParameter(disposition, 'name')
      if (!name) continue

      const parsedPart: MultipartPartMetadata = { name, value, headers }
      const partContentType = headers['content-type']
      const filename = parseHeaderParameter(disposition, 'filename')
      if (partContentType !== undefined) parsedPart.contentType = partContentType
      if (filename !== undefined) parsedPart.filename = filename
      parsedParts.push(parsedPart)
    }
    return { body: createMultipartBody(parsedParts) }
  }

  if (ct === 'application/x-www-form-urlencoded') {
    const params = new URLSearchParams(raw)
    const result: Record<string, string | string[]> = {}
    for (const [k, v] of params.entries()) {
      const existing = result[k]
      if (existing !== undefined) {
        result[k] = Array.isArray(existing) ? [...existing, v] : [existing, v]
      } else {
        result[k] = v
      }
    }
    return { body: result }
  }

  if (isXmlMediaType(ct)) return { body: raw }

  // text/* 및 알 수 없는 content-type → raw 문자열
  return { body: raw }
}

function extractPathname(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/$/, '')
  } catch {
    return url.replace(/\/$/, '')
  }
}

function stripBasePath(urlPath: string, basePath: string): string {
  if (!basePath) return urlPath
  if (urlPath === basePath) return '/'
  if (urlPath.startsWith(`${basePath}/`)) return urlPath.slice(basePath.length)
  return urlPath
}

function extractRawQueryString(url: string): string | undefined {
  const question = url.indexOf('?')
  if (question === -1) return undefined
  const hash = url.indexOf('#', question + 1)
  return url.slice(question + 1, hash === -1 ? undefined : hash)
}

function formatHost(host: string): string {
  if (host.startsWith('[') && host.endsWith(']')) return host
  return host.includes(':') ? `[${host}]` : host
}

function parseMultipartHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of raw.split('\r\n')) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const name = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()
    if (name) headers[name] = value
  }
  return headers
}

function parseHeaderParameter(headerValue: string, parameterName: string): string | undefined {
  const pattern = new RegExp(`(?:^|;)\\s*${escapeRegExp(parameterName)}=(?:"([^"]*)"|([^;]*))`, 'i')
  const match = headerValue.match(pattern)
  return match?.[1] ?? match?.[2]?.trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function readRaw(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => { raw += chunk.toString() })
    req.on('end', () => resolve(raw))
    req.on('error', reject)
  })
}

/** Merge webhook OperationEntries into an existing RouteIndex (non-mutating) */
function mergeWebhookRoutes(routes: RouteIndex, webhooks: OperationEntry[]): RouteIndex {
  if (webhooks.length === 0) return routes
  const merged: RouteIndex = new Map(routes)
  for (const op of webhooks) {
    let methodMap = merged.get(op.openApiPath)
    if (!methodMap) {
      methodMap = new Map()
      merged.set(op.openApiPath, methodMap)
    }
    methodMap.set(op.method, op)
  }
  return merged
}
