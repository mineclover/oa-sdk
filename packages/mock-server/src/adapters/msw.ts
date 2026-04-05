import { http, HttpResponse, type RequestHandler } from 'msw'
import { parseDocument, HTTP_METHODS, type OasDocument } from '@oa-sdk/parser'
import { toColonPath } from '@oa-sdk/core'
import { validateRequest } from '../core/request-validator.js'
import { pickResponse } from '../core/response-picker.js'
import { streamer, formatSseChunk, formatNdjsonLine, isStreamingContentType } from '../core/stream.js'
import type { MockErrorResponse } from '../errors/types.js'

export type MswHandlerOptions = {
  /** 요청 수신 시 호출되는 관찰 훅 (로깅/추적용) */
  onRequest?: (info: { method: string; path: string; operationId?: string }) => void
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
  const parsed = parseDocument(spec as OasDocument)
  const index = parsed.routes
  const baseUrl = extractBaseUrl(spec as Record<string, unknown>)
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

        // headers
        const headers: Record<string, string> = {}
        request.headers.forEach((v: string, k: string) => { headers[k] = v })

        // body — content-type에 따라 파싱
        const contentType = request.headers.get('content-type') ?? undefined
        const body = request.body ? await parseBody(request, contentType) : undefined

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
              _meta: { ...(entry.operationId !== undefined && { operationId: entry.operationId }), method, path: openApiPath },
            },
          }
          return HttpResponse.json(errorBody, { status: 422 })
        }

        const picked = pickResponse(entry.responses)
        if (!picked) {
          return HttpResponse.json(
            { error: { code: 'NOT_FOUND', message: '응답 스키마가 정의되지 않았습니다', details: [] } },
            { status: 500 },
          )
        }

        // 스트리밍 응답 (text/event-stream 등) — ReadableStream으로 전달
        if (isStreamingContentType(picked.contentType)) {
          const schema = picked.stream
          const body = picked.body
          const isSse = picked.contentType === 'text/event-stream'
          const formatChunk = isSse ? formatSseChunk : formatNdjsonLine
          const readable = new ReadableStream({
            async start(controller) {
              const enc = new TextEncoder()
              if (schema) {
                // 스키마 기반 → StreamFolder로 다수 이벤트 생성
                for await (const item of streamer.generate(schema, { includeTerminator: isSse })) {
                  controller.enqueue(enc.encode(formatChunk(item)))
                }
              } else {
                // example body → 단일 이벤트
                controller.enqueue(enc.encode(formatChunk(body)))
              }
              controller.close()
            },
          })
          return new HttpResponse(readable, {
            status: picked.status,
            headers: { 'Content-Type': picked.contentType, 'Cache-Control': 'no-cache' },
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

  if (ct === 'application/x-www-form-urlencoded' || ct === 'multipart/form-data') {
    try {
      const formData = await request.formData()
      return formDataToObject(formData)
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

// ─── base URL 추출 ────────────────────────────────────────────────────────────

function extractBaseUrl(spec: Record<string, unknown>): string {
  const servers = spec['servers'] as Array<{ url?: string }> | undefined
  const first = servers?.[0]?.url ?? ''
  try {
    const u = new URL(first)
    return u.pathname.replace(/\/$/, '')
  } catch {
    return first.replace(/\/$/, '')
  }
}
