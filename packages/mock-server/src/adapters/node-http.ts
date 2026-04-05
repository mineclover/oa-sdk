import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { parseDocument, matchRoute, type HttpMethod, type MatchResult, type OasDocument } from '@oa-sdk/parser'
import { validateRequest } from '../core/request-validator.js'
import { pickResponse } from '../core/response-picker.js'
import { streamer, formatSseChunk, formatNdjsonLine, isStreamingContentType } from '../core/stream.js'
import type { MockErrorResponse } from '../errors/types.js'

export type NodeMockServerOptions = {
  port?: number
  host?: string
  /** servers 배열에서 사용할 서버 인덱스 (기본: 0) */
  serverIndex?: number
  /** server variables 오버라이드 */
  serverVariables?: Record<string, string>
}

export type NodeMockServer = {
  start(): Promise<void>
  stop(): Promise<void>
  readonly url: string
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
  const { port = 4010, host = '127.0.0.1', serverIndex = 0, serverVariables } = options
  const parsed = parseDocument(spec as OasDocument)
  const index = parsed.routes
  let httpServer: Server | null = null
  let actualPort = port  // port: 0이면 listen 후 실제 포트로 갱신

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

    // headers
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers[k] = v
      else if (Array.isArray(v)) headers[k] = v[0] ?? ''
    }

    const contentType = headers['content-type']
    const body = await readBody(req)

    const result = validateRequest(
      { pathParams, queryParams, headers, body, contentType },
      entry.parameters,
      entry.requestBody,
      { requirements: entry.security, schemes: parsed.securitySchemes },
    )

    if (!result.valid) {
      const errorBody: MockErrorResponse = {
        error: {
          code: 'CONSTRAINT_VIOLATION',
          message: '요청 검증 실패',
          details: result.errors,
          _meta: { ...(entry.operationId !== undefined && { operationId: entry.operationId }), method, path: entry.openApiPath },
        },
      }
      writeJson(res, 422, errorBody)
      return
    }

    const picked = pickResponse(entry.responses)
    if (!picked) {
      writeJson(res, 500, { error: { code: 'NOT_FOUND', message: '응답 스키마가 정의되지 않았습니다', details: [] } })
      return
    }

    // 스트리밍 응답 — SSE는 data:\n\n 포맷, NDJSON/JSONL은 <json>\n 포맷
    if (isStreamingContentType(picked.contentType)) {
      const isSse = picked.contentType === 'text/event-stream'
      const formatChunk = isSse ? formatSseChunk : formatNdjsonLine
      res.writeHead(picked.status, {
        ...picked.headers,
        'Content-Type': picked.contentType,
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      })
      if (picked.stream) {
        // 스키마 기반 → StreamFolder로 다수 이벤트 생성
        for await (const item of streamer.generate(picked.stream, { includeTerminator: isSse })) {
          res.write(formatChunk(item))
        }
      } else {
        // example body → 단일 이벤트
        res.write(formatChunk(picked.body))
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
