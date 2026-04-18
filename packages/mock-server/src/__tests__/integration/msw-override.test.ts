/**
 * adapters/msw.ts — createMswMockServer override 통합 테스트
 * msw/node setupServer + override/clearOverride/clearOverrides 검증
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { setupServer } from 'msw/node'
import { createMswMockServer } from '../../adapters/msw.js'
import { createOverrideSpec } from '../fixtures/specs.js'

const spec = createOverrideSpec()

const BASE = 'http://localhost'
const mock = createMswMockServer(spec)
let server: ReturnType<typeof setupServer>

beforeAll(() => {
  server = setupServer(...mock.handlers)
  server.listen({ onUnhandledRequest: 'bypass' })
})
afterEach(() => {
  mock.clearOverrides()
  server.resetHandlers()
})
afterAll(() => server.close())

describe('createMswMockServer override API', () => {
  it('override -> 해당 operation만 오버라이드 응답 반환', async () => {
    mock.override('listUsers', { status: 200, body: { items: [{ id: '1' }], total: 1 } })

    const res = await fetch(`${BASE}/users`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ items: [{ id: '1' }], total: 1 })
  })

  it('다른 operation은 영향 없음', async () => {
    mock.override('listUsers', { status: 200, body: { overridden: true } })

    // listUsers는 오버라이드
    const res1 = await fetch(`${BASE}/users`)
    expect(res1.status).toBe(200)
    const body1 = await res1.json()
    expect(body1).toEqual({ overridden: true })

    // healthCheck는 원래 spec 기반 응답
    const res2 = await fetch(`${BASE}/health`)
    expect(res2.status).toBe(200)
    const body2 = await res2.json()
    expect(body2).toEqual({ status: 'ok' })
  })

  it('clearOverride -> 원래 spec 기반 응답으로 복귀', async () => {
    mock.override('listUsers', { status: 503, body: { error: 'Down' } })

    const res1 = await fetch(`${BASE}/users`)
    expect(res1.status).toBe(503)

    mock.clearOverride('listUsers')

    const res2 = await fetch(`${BASE}/users`)
    expect(res2.status).toBe(200)
    const body2 = await res2.json()
    expect(body2).toEqual({ items: [], total: 0 })
  })

  it('clearOverrides -> 모든 오버라이드 제거', async () => {
    mock.override('listUsers', { status: 503, body: { error: 'Down' } })
    mock.override('healthCheck', { status: 503, body: { error: 'Down' } })

    const res1 = await fetch(`${BASE}/users`)
    expect(res1.status).toBe(503)
    const res2 = await fetch(`${BASE}/health`)
    expect(res2.status).toBe(503)

    mock.clearOverrides()

    const res3 = await fetch(`${BASE}/users`)
    expect(res3.status).toBe(200)
    const body3 = await res3.json()
    expect(body3).toEqual({ items: [], total: 0 })

    const res4 = await fetch(`${BASE}/health`)
    expect(res4.status).toBe(200)
    const body4 = await res4.json()
    expect(body4).toEqual({ status: 'ok' })
  })

  it('404 에러 시나리오 오버라이드', async () => {
    mock.override('getUserById', { status: 404, body: { error: 'Not Found' } })

    const res = await fetch(`${BASE}/users/123e4567-e89b-12d3-a456-426614174000`)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ error: 'Not Found' })
  })

  it('커스텀 헤더 오버라이드', async () => {
    mock.override('listUsers', {
      status: 200,
      body: { items: [] },
      headers: { 'X-Custom-Header': 'test-value', 'X-Request-Id': 'abc-123' },
    })

    const res = await fetch(`${BASE}/users`)
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Custom-Header')).toBe('test-value')
    expect(res.headers.get('X-Request-Id')).toBe('abc-123')
    const body = await res.json()
    expect(body).toEqual({ items: [] })
  })
})
