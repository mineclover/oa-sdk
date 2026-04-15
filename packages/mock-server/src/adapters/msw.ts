import { http, HttpResponse, type RequestHandler } from 'msw'
import { parseDocument, HTTP_METHODS, resolveServerUrl, type OasDocument, type OperationEntry, type RouteIndex } from '@oa-sdk/parser'
import { toColonPath } from '@oa-sdk/core'
import { handleRequest } from '../core/handler.js'
import { isStreamingContentType, generateStreamChunks } from '../core/stream.js'
import { filterRouteIndex, type RouteFilter } from '../core/route-filter.js'
import { assertValidRequestSchemas, createMultipartBody, type MultipartPartMetadata } from '../core/request-validator.js'
import type { OverrideResponse } from './node-http.js'

export type MswHandlerOptions = {
  /** 요청 수신 시 호출되는 관찰 훅 (로깅/추적용) */
  onRequest?: (info: { method: string; path: string; operationId?: string }) => void
  /** 라우트 필터 — 조건에 맞는 라우트만 핸들러 생성 */
  include?: RouteFilter
  /** 요청 body/parameter 스키마를 핸들러 생성 시점에 미리 컴파일 (기본: true) */
  validateRequestSchemas?: boolean
}

export type MswMockServer = {
  handlers: RequestHandler[]
  override(operationId: string, response: OverrideResponse): void
  clearOverride(operationId: string): void
  clearOverrides(): void
}

/**
 * OpenAPI 스펙으로부터 MSW RequestHandler 목록을 생성.
 *
 * @example
 * import spec from '@oa-sdk/schemas'
 * import { createMswHandlers } from '@oa-sdk/mock-server/adapters/msw'
 *
 * export const handlers = createMswHandlers(spec)
 * // setupServer(...handlers) 또는 setupWorker(...handlers)
 */
export function createMswHandlers(
  spec: OasDocument | Record<string, unknown>,
  options: MswHandlerOptions = {},
): RequestHandler[] {
  return buildMswHandlers(spec, options, new Map())
}

/**
 * OpenAPI 스펙 기반 MSW mock 서버 생성 (override 지원).
 *
 * @example
 * import spec from '@oa-sdk/schemas'
 * import { createMswMockServer } from '@oa-sdk/mock-server/adapters/msw'
 * import { setupServer } from 'msw/node'
 *
 * const mock = createMswMockServer(spec)
 * const server = setupServer(...mock.handlers)
 * server.listen()
 *
 * mock.override('listUsers', { status: 200, body: { overridden: true } })
 * // ... tests ...
 * mock.clearOverrides()
 */
export function createMswMockServer(
  spec: OasDocument | Record<string, unknown>,
  options: MswHandlerOptions = {},
): MswMockServer {
  const overrides = new Map<string, OverrideResponse>()
  const handlers = buildMswHandlers(spec, options, overrides)

  return {
    handlers,
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

/** 내부: 핸들러 목록 생성 (overrides Map 공유) */
function buildMswHandlers(
  spec: OasDocument | Record<string, unknown>,
  options: MswHandlerOptions,
  overrides: Map<string, OverrideResponse>,
): RequestHandler[] {
  const parsed = parseDocument(spec as OasDocument)
  const mergedRoutes = mergeWebhookRoutes(parsed.routes, parsed.webhooks)
  const index = filterRouteIndex(mergedRoutes, options.include)
  if (options.validateRequestSchemas !== false) assertValidRequestSchemas(index)
  const server = parsed.servers[0]
  const baseUrl = server ? extractPathname(resolveServerUrl(server)) : ''
  const handlers: RequestHandler[] = []

  for (const [openApiPath, methodMap] of index) {
    // MSW Node.js 환경에서는 상대 경로가 동작하지 않음 → http://* 와일드카드 사용
    const mswPath = `http://*${baseUrl}${toColonPath(openApiPath)}`

    for (const method of HTTP_METHODS) {
      const entry = methodMap.get(method)
      if (!entry) continue

      const httpMethod = http[method as keyof typeof http] as typeof http.get
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler = httpMethod(mswPath, async ({ request, params }: any) => {
        options.onRequest?.({
          method,
          path: openApiPath,
          ...(entry.operationId !== undefined && { operationId: entry.operationId }),
        })

        // override 체크 — 해당 operationId에 오버라이드가 있으면 바로 반환
        const ov = entry.operationId ? overrides.get(entry.operationId) : undefined
        if (ov) {
          const ovHeaders = ov.headers ?? {}
          if (ov.body === undefined) {
            return new HttpResponse(null, {
              status: ov.status,
              headers: ovHeaders,
            })
          }
          const ct = ovHeaders['Content-Type'] ?? ovHeaders['content-type'] ?? 'application/json'
          if (ct.includes('application/json')) {
            return HttpResponse.json(ov.body as Record<string, unknown>, {
              status: ov.status,
              headers: ovHeaders,
            })
          }
          return new HttpResponse(
            typeof ov.body === 'string' ? ov.body : JSON.stringify(ov.body),
            { status: ov.status, headers: { ...ovHeaders, 'Content-Type': ct } },
          )
        }

        // path params (MSW가 이미 파싱)
        const pathParams: Record<string, string> = {}
        for (const [k, v] of Object.entries(params)) {
          pathParams[k] = Array.isArray(v) ? v[0]! : v
        }

        // query params
        const url = new URL(request.url)
        const queryParams: Record<string, string | string[]> = {}
        for (const [k, v] of url.searchParams.entries()) {
          const existing = queryParams[k]
          if (existing !== undefined) {
            queryParams[k] = Array.isArray(existing) ? [...existing, v] : [existing, v]
          } else {
            queryParams[k] = v
          }
        }

        // headers — MSW uses Fetch API Headers (forEach), unlike Node's IncomingMessage.headers (object)
        const headers: Record<string, string> = {}
        request.headers.forEach((v: string, k: string) => { headers[k] = v })

        // body — content-type에 따라 파싱
        const contentType = request.headers.get('content-type') ?? undefined
        const body = request.body ? await parseBody(request, contentType) : undefined

        const hr = handleRequest(
          { pathParams, queryParams, headers, body, contentType },
          { ...entry, openApiPath },
          parsed.securitySchemes,
        )

        if (hr.type === 'validation-error') return HttpResponse.json(hr.body, { status: hr.status })
        if (hr.type === 'schema-error') return HttpResponse.json(hr.body, { status: hr.status })
        if (hr.type === 'no-response') return HttpResponse.json(hr.body, { status: hr.status })
        const picked = hr.picked

        // 스트리밍 응답 (text/event-stream 등) — ReadableStream으로 전달
        if (isStreamingContentType(picked.contentType)) {
          const readable = new ReadableStream({
            async start(controller) {
              const enc = new TextEncoder()
              for await (const chunk of generateStreamChunks(picked)) {
                controller.enqueue(enc.encode(chunk))
              }
              controller.close()
            },
          })
          return new HttpResponse(readable, {
            status: picked.status,
            headers: { ...picked.headers, 'Content-Type': picked.contentType, 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
          })
        }

        if (picked.contentType.includes('application/json')) {
          return HttpResponse.json(picked.body as Record<string, unknown>, {
            status: picked.status,
            headers: picked.headers,
          })
        }
        return new HttpResponse(
          typeof picked.body === 'string' ? picked.body : JSON.stringify(picked.body),
          { status: picked.status, headers: { ...picked.headers, 'Content-Type': picked.contentType } },
        )
      })

      handlers.push(handler)
    }

    // 경로는 일치하지만 정의되지 않은 메서드 → 405
    const allowed = [...methodMap.keys()].map(m => m.toUpperCase()).join(', ')
    handlers.push(
      http.all(mswPath, () =>
        new HttpResponse(null, { status: 405, headers: { Allow: allowed } }),
      ),
    )
  }

  return handlers
}

// ─── body 파싱 ───────────────────────────────────────────────────────────────

async function parseBody(request: Request, contentType: string | undefined): Promise<unknown> {
  const ct = contentType?.split(';')[0]?.trim() ?? ''

  if (ct === 'application/json') {
    try { return await request.json() } catch { return undefined }
  }

  if (ct === 'application/x-www-form-urlencoded') {
    try {
      const formData = await request.formData()
      return formDataToObject(formData)
    } catch { return undefined }
  }

  if (ct === 'multipart/form-data') {
    try {
      const formData = await request.formData()
      return formDataToMultipartBody(formData)
    } catch { return undefined }
  }

  if (ct.startsWith('text/')) {
    try { return await request.text() } catch { return undefined }
  }

  // 알 수 없는 content-type — raw text로 폴백
  try { return await request.text() } catch { return undefined }
}

/** FormData → 일반 객체 (같은 키 다중 값은 배열로) */
function formDataToObject(formData: FormData): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {}
  for (const [key, value] of formData.entries()) {
    if (typeof value !== 'string') continue  // File 엔트리 무시
    const existing = result[key]
    if (existing !== undefined) {
      result[key] = Array.isArray(existing) ? [...existing, value] : [existing, value]
    } else {
      result[key] = value
    }
  }
  return result
}

async function formDataToMultipartBody(formData: FormData): Promise<Record<string, unknown>> {
  const parts: MultipartPartMetadata[] = []

  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') {
      parts.push({ name: key, value })
      continue
    }

    const blob = value as Blob & { name?: string }
    const part: MultipartPartMetadata = {
      name: key,
      value: await blob.text(),
      headers: {},
    }
    if (blob.type) part.contentType = blob.type
    if (blob.name) part.filename = blob.name
    parts.push(part)
  }

  return createMultipartBody(parts)
}

// ─── base URL 추출 ────────────────────────────────────────────────────────────

function extractPathname(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/$/, '')
  } catch {
    return url.replace(/\/$/, '')
  }
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
