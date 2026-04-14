import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTypiaMockServer } from '../../server/node-http.js'
import { createMockApplication } from '../fixtures/mock-application.js'
import type { TypiaMockServer, TypiaErrorResponse, TypiaSuccessResponse } from '../../types.js'

const app = createMockApplication()
let server: TypiaMockServer

beforeAll(async () => {
  server = createTypiaMockServer(app, { port: 0 })
  await server.start()
})

afterAll(async () => {
  await server.stop()
})

// ─── GET /functions ─────────────────────────────────────────────────────────

describe('GET /functions', () => {
  it('함수 목록을 반환한다', async () => {
    const res = await fetch(`${server.url}/functions`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { functions: Array<{ name: string }> }
    expect(body.functions).toHaveLength(3)
    expect(body.functions.map((f) => f.name)).toContain('createUser')
    expect(body.functions.map((f) => f.name)).toContain('getUsers')
  })
})

// ─── POST /validate/:functionName ───────────────────────────────────────────

describe('POST /validate/:functionName', () => {
  it('유효한 raw JSON → 200 성공 + mock 응답 포함', async () => {
    const res = await fetch(`${server.url}/validate/createUser`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ email: 'alice@example.com', name: 'Alice' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as TypiaSuccessResponse
    expect(body.success).toBe(true)
    expect(body.functionName).toBe('createUser')
    expect(body.mock).toBeDefined()
    const mock = body.mock as Record<string, unknown>
    expect(mock).toHaveProperty('id')
    expect(mock).toHaveProperty('email')
  })

  it('잘못된 JSON → 422 PARSE_ERROR', async () => {
    const res = await fetch(`${server.url}/validate/createUser`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{not valid json',
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as TypiaErrorResponse
    expect(body.error.code).toBe('PARSE_ERROR')
    expect(body.error._meta?.stage).toBe('parse')
  })

  it('유효한 JSON + 잘못된 데이터 → 422 VALIDATION_ERROR', async () => {
    const res = await fetch(`${server.url}/validate/createUser`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ email: 'not-email', name: '' }),
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as TypiaErrorResponse
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.details.length).toBeGreaterThan(0)
  })

  it('존재하지 않는 함수 → 404', async () => {
    const res = await fetch(`${server.url}/validate/nonExistent`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as TypiaErrorResponse
    expect(body.error.code).toBe('FUNCTION_NOT_FOUND')
  })

  it('빈 body → 400 INVALID_REQUEST', async () => {
    const res = await fetch(`${server.url}/validate/createUser`, {
      method: 'POST',
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as TypiaErrorResponse
    expect(body.error.code).toBe('INVALID_REQUEST')
  })

  it('coerce: age 문자열 → 성공', async () => {
    const res = await fetch(`${server.url}/validate/createUser`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ email: 'a@b.com', name: 'Bob', age: '30' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as TypiaSuccessResponse
    expect((body.data as Record<string, unknown>)['age']).toBe(30)
  })
})

// ─── POST /call/:functionName ───────────────────────────────────────────────

describe('POST /call/:functionName', () => {
  it('유효한 JSON 객체 → 200 성공 + mock 응답 포함', async () => {
    const res = await fetch(`${server.url}/call/createUser`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bob@example.com', name: 'Bob', age: 25 }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as TypiaSuccessResponse
    expect(body.success).toBe(true)
    expect(body.functionName).toBe('createUser')
    expect(body.mock).toBeDefined()
  })

  it('잘못된 데이터 → 422 VALIDATION_ERROR', async () => {
    const res = await fetch(`${server.url}/call/createUser`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 123, name: null }),
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as TypiaErrorResponse
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.details.some((d) => d.path.includes('email'))).toBe(true)
    expect(body.error.details.some((d) => d.path.includes('name'))).toBe(true)
  })

  it('존재하지 않는 함수 → 404', async () => {
    const res = await fetch(`${server.url}/call/nonExistent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(404)
  })

  it('빈 body → 400', async () => {
    const res = await fetch(`${server.url}/call/createUser`, {
      method: 'POST',
    })
    expect(res.status).toBe(400)
  })

  it('coerce: 문자열 숫자 → 정수 변환 후 성공', async () => {
    const res = await fetch(`${server.url}/call/getUsers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: '10', offset: '0' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as TypiaSuccessResponse
    expect((body.data as Record<string, unknown>)['limit']).toBe(10)
  })
})

// ─── 404 fallback ───────────────────────────────────────────────────────────

describe('unknown routes', () => {
  it('정의되지 않은 경로 → 404', async () => {
    const res = await fetch(`${server.url}/unknown/path`)
    expect(res.status).toBe(404)
  })
})
