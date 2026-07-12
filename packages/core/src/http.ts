/**
 * HTTP 서버 공통 유틸리티.
 *
 * mock-server, typia-mock 등 HTTP 서버를 제공하는 패키지에서 공유.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

// ─── Types ──────────────────────────────────────────────────────────────────

export type HttpServerOptions = {
  port?: number
  host?: string
}

export type HttpServerHandle = {
  start(): Promise<void>
  stop(): Promise<void>
  readonly url: string
}

export type HttpHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

/** 공통 에러 상세 항목 — mock-server, typia-mock 등에서 공유 */
export type ApiErrorDetail = {
  path: string
  expected?: string
  value?: unknown
  code?: string
  message?: string
  constraint?: Record<string, unknown>
}

/** 공통 에러 응답 envelope */
export type ApiError<Code extends string = string> = {
  error: {
    code: Code
    message: string
    details: ApiErrorDetail[]
    _meta?: Record<string, unknown>
  }
}

/** @deprecated ApiError를 사용 */
export type ErrorEnvelope<Code extends string> = ApiError<Code>

// ─── Server factory ─────────────────────────────────────────────────────────

/**
 * Node HTTP 서버 생성 팩토리.
 * port: 0이면 OS가 빈 포트를 할당한다.
 */
export function createHttpServer(
  handler: HttpHandler,
  options: HttpServerOptions = {},
): HttpServerHandle {
  const { port = 0, host = '127.0.0.1' } = options
  let httpServer: Server | null = null
  let startPromise: Promise<void> | null = null
  let actualPort = port

  return {
    get url() {
      return `http://${host}:${actualPort}`
    },

    start(): Promise<void> {
      if (httpServer) return startPromise ?? Promise.resolve()

      const server = createServer((req, res) => {
          handler(req, res).catch((err) => {
            writeJson(res, 500, { error: { code: 'INTERNAL_ERROR', message: String(err), details: [] } })
          })
      })
      httpServer = server
      startPromise = new Promise((resolve, reject) => {
        const onError = (error: Error) => {
          if (httpServer === server) httpServer = null
          startPromise = null
          reject(error)
        }
        server.once('error', onError)
        server.listen(port, host, () => {
          server.off('error', onError)
          const addr = server.address()
          if (addr && typeof addr === 'object') actualPort = addr.port
          startPromise = null
          resolve()
        })
      })
      return startPromise
    },

    async stop(): Promise<void> {
      if (startPromise) {
        try {
          await startPromise
        } catch {
          return
        }
      }
      return new Promise((resolve, reject) => {
        if (!httpServer) return resolve()
        const srv = httpServer
        httpServer = null
        srv.closeAllConnections()
        srv.close((err) => (err ? reject(err) : resolve()))
      })
    },
  }
}

// ─── Response helpers ───────────────────────────────────────────────────────

/** JSON 응답 쓰기 */
export function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body) ?? 'null'
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
  })
  res.end(payload)
}

/** raw body 읽기 */
export function readRaw(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString()
    })
    req.on('end', () => resolve(raw))
    req.on('error', reject)
  })
}

/** JSON body 읽기 (실패 시 undefined) */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = await readRaw(req)
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}
