import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { parseDocument, matchRoute, type HttpMethod, type MatchResult, type OasDocument, type OperationEntry, type RouteIndex } from '@oa-sdk/parser'
import { handleRequest } from '../core/handler.js'
import { isStreamingContentType, generateStreamChunks } from '../core/stream.js'
import { filterRouteIndex, type RouteFilter } from '../core/route-filter.js'
import { assertValidRequestSchemas } from '../core/request-validator.js'

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
  } = options
  const parsed = parseDocument(spec as OasDocument)
  const mergedRoutes = mergeWebhookRoutes(parsed.routes, parsed.webhooks)
  const index = filterRouteIndex(mergedRoutes, include)
  if (shouldValidateRequestSchemas) assertValidRequestSchemas(index)
  let httpServer: Server | null = null
  let actualPort = port  // port: 0이면 listen 후 실제 포트로 갱신
  const overrides = new Map<string, OverrideResponse>()

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = (req.method ?? 'GET').toLowerCase() as HttpMethod
    const rawUrl = req.url ?? '/'
    const parsedUrl = new URL(rawUrl, `http://${host}:${port}`)
    const urlPath = parsedUrl.pathname

    const matched: MatchResult = matchRoute(index, method, urlPath)

    if (matched.type === 'not_found') {
      writeJson(res, 404, {
        error: { code: 'NOT_FOUND', message: `${method.toUpperCase()} ${urlPath} 는 정의되지 않은 경로입니다`, details: [] },
      })
      return
    }

    if (matched.type === 'method_not_allowed') {
      const allow = matched.allowed.map((m: string) => m.toUpperCase()).join(', ')
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
        writeBody(res, ov.status, ovHeaders['Content-Type'] ?? ovHeaders['content-type'] ?? 'application/json', ov.body, ovHeaders)
      }
      return
    }

    // query params
    const queryParams: Record<string, string | string[]> = {}
    for (const [k, v] of parsedUrl.searchParams.entries()) {
      const existing = queryParams[k]
      if (existing !== undefined) {
        queryParams[k] = Array.isArray(existing) ? [...existing, v] : [existing, v]
      } else {
        queryParams[k] = v
      }
    }

    // headers — Node uses IncomingMessage.headers (object with string|string[]), unlike MSW's Fetch Headers
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers[k] = v
      else if (Array.isArray(v)) headers[k] = v[0] ?? ''
    }

    const contentType = headers['content-type']
    const body = await readBody(req)

    const hr = handleRequest(
      { pathParams, queryParams, headers, body, contentType },
      entry,
      parsed.securitySchemes,
    )

    if (hr.type === 'validation-error') { writeJson(res, hr.status, hr.body); return }
    if (hr.type === 'schema-error') { writeJson(res, hr.status, hr.body); return }
    if (hr.type === 'no-response') { writeJson(res, hr.status, hr.body); return }
    const picked = hr.picked

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

    writeBody(res, picked.status, picked.contentType, picked.body, picked.headers)
  }

  return {
    get url() { return `http://${host}:${actualPort}` },

    start(): Promise<void> {
      return new Promise((resolve, reject) => {
        httpServer = createServer((req, res) => {
          handler(req, res).catch(err => {
            writeJson(res, 500, { error: { code: 'CONSTRAINT_VIOLATION', message: String(err), details: [] } })
          })
        })
        httpServer.listen(port, host, () => {
          const addr = httpServer!.address()
          if (addr && typeof addr === 'object') actualPort = addr.port
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
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  writeBody(res, status, 'application/json', body)
}

function writeBody(res: ServerResponse, status: number, contentType: string, body: unknown, extraHeaders: Record<string, string> = {}): void {
  const payload = contentType.includes('application/json') || typeof body !== 'string'
    ? JSON.stringify(body)
    : body
  res.writeHead(status, { ...extraHeaders, 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const ct = (req.headers['content-type'] ?? '').split(';')[0]?.trim() ?? ''

  const raw = await readRaw(req)
  if (raw === '') return undefined

  if (ct === 'application/json') {
    try { return JSON.parse(raw) } catch { return undefined }
  }

  // multipart/form-data — boundary 기반 간단 파싱 (외부 패키지 없이)
  if (ct === 'multipart/form-data') {
    const boundary = (req.headers['content-type'] ?? '').match(/boundary=([^\s;]+)/)?.[1]
    if (!boundary) return undefined
    const parts = raw.split(`--${boundary}`).slice(1, -1) // 첫/마지막 빈 파트 제거
    const result: Record<string, string> = {}
    for (const part of parts) {
      const headerEnd = part.indexOf('\r\n\r\n')
      if (headerEnd === -1) continue
      const header = part.slice(0, headerEnd)
      const value = part.slice(headerEnd + 4).replace(/\r\n$/, '')
      const nameMatch = header.match(/name="([^"]+)"/)
      if (nameMatch) result[nameMatch[1]!] = value
    }
    return result
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
    return result
  }

  // text/* 및 알 수 없는 content-type → raw 문자열
  return raw
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
