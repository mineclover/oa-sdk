/**
 * 테스트 헬퍼 — mock server와 함께 사용하는 유틸리티
 *
 * 사용 예시:
 *   const server = createNodeMockServer(spec, { port: 0 })
 *   await server.start()
 *   const client = createTestClient(server)
 *   const res = await client.get('/users')
 *   expect(res.status).toBe(200)
 *   expect(res.json.items).toHaveLength(1)
 */

import type { NodeMockServer } from './adapters/node-http.js'

export type TestResponse = {
  status: number
  headers: Record<string, string>
  body: string
  json: unknown
  ok: boolean
}

export type TestClient = {
  get(path: string, options?: RequestOptions): Promise<TestResponse>
  post(path: string, body?: unknown, options?: RequestOptions): Promise<TestResponse>
  put(path: string, body?: unknown, options?: RequestOptions): Promise<TestResponse>
  patch(path: string, body?: unknown, options?: RequestOptions): Promise<TestResponse>
  delete(path: string, options?: RequestOptions): Promise<TestResponse>
}

type RequestOptions = {
  headers?: Record<string, string>
  query?: Record<string, string | number>
}

/**
 * mock server에 대한 typed test client를 생성합니다.
 * fetch 래핑 + 응답 파싱 + 편의 메서드 제공.
 */
export function createTestClient(server: NodeMockServer): TestClient {
  async function request(method: string, path: string, body?: unknown, options?: RequestOptions): Promise<TestResponse> {
    const url = new URL(path, server.url)
    if (options?.query) {
      for (const [k, v] of Object.entries(options.query)) {
        url.searchParams.set(k, String(v))
      }
    }

    const headers: Record<string, string> = { ...options?.headers }
    if (body !== undefined && !headers['content-type']) {
      headers['content-type'] = 'application/json'
    }

    const init: RequestInit = { method, headers }
    if (body !== undefined) init.body = JSON.stringify(body)
    const res = await fetch(url.toString(), init)

    const text = await res.text()
    let json: unknown = null
    try { json = JSON.parse(text) } catch { /* text response */ }

    const responseHeaders: Record<string, string> = {}
    res.headers.forEach((v, k) => { responseHeaders[k] = v })

    return {
      status: res.status,
      headers: responseHeaders,
      body: text,
      json,
      ok: res.ok,
    }
  }

  return {
    get: (path, opts) => request('GET', path, undefined, opts),
    post: (path, body, opts) => request('POST', path, body, opts),
    put: (path, body, opts) => request('PUT', path, body, opts),
    patch: (path, body, opts) => request('PATCH', path, body, opts),
    delete: (path, opts) => request('DELETE', path, undefined, opts),
  }
}

/**
 * Spec coverage 추적기.
 * onRequest 훅을 통해 어떤 오퍼레이션이 호출되었는지 추적.
 */
export type CoverageTracker = {
  /** 호출된 operationId 목록 */
  readonly called: ReadonlySet<string>
  /** 호출되지 않은 operationId 목록 */
  uncalled(allOperationIds: string[]): string[]
  /** 커버리지 비율 (0~1) */
  coverage(allOperationIds: string[]): number
  /** onRequest 훅 (mock server 옵션에 전달) */
  onRequest: (info: { operationId?: string }) => void
  /** 리셋 */
  reset(): void
}

export function createCoverageTracker(): CoverageTracker {
  const called = new Set<string>()

  return {
    get called() { return called as ReadonlySet<string> },
    uncalled(all) { return all.filter(id => !called.has(id)) },
    coverage(all) { return all.length === 0 ? 1 : called.size / all.length },
    onRequest(info) { if (info.operationId) called.add(info.operationId) },
    reset() { called.clear() },
  }
}
