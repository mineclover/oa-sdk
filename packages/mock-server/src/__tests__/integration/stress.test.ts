/**
 * 부하 테스트 — mock-server 동시 요청 처리 검증
 *
 * 동시 요청, 대량 요청, 큰 바디, 다양한 경로 혼합.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createNodeMockServer } from '../../adapters/node-http.js'
import { createTestClient } from '../../testing.js'
import { createSimpleItemsSpec } from '../fixtures/specs.js'

const spec = createSimpleItemsSpec()

let server: ReturnType<typeof createNodeMockServer>
let client: ReturnType<typeof createTestClient>

beforeAll(async () => {
  server = createNodeMockServer(spec, { port: 0 })
  await server.start()
  client = createTestClient(server)
})

afterAll(async () => { await server.stop() })

describe('동시 요청', () => {
  it('10개 동시 GET 요청 → 전부 200', async () => {
    const requests = Array.from({ length: 10 }, () => client.get('/items'))
    const results = await Promise.all(requests)
    expect(results.every(r => r.status === 200)).toBe(true)
  })

  it('50개 동시 GET 요청', async () => {
    const requests = Array.from({ length: 50 }, () => client.get('/items'))
    const results = await Promise.all(requests)
    expect(results.every(r => r.status === 200)).toBe(true)
  })

  it('20개 동시 혼합 (GET + POST)', async () => {
    const requests = Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0
        ? client.get('/items')
        : client.post('/items', { name: `item-${i}` })
    )
    const results = await Promise.all(requests)
    const statuses = results.map(r => r.status)
    expect(statuses.filter(s => s === 200).length).toBe(10) // GET
    expect(statuses.filter(s => s === 201).length).toBe(10) // POST
  })
})

describe('대량 순차 요청', () => {
  it('100개 순차 GET', async () => {
    for (let i = 0; i < 100; i++) {
      const res = await client.get('/items')
      expect(res.status).toBe(200)
    }
  })

  it('50개 순차 POST (유효)', async () => {
    for (let i = 0; i < 50; i++) {
      const res = await client.post('/items', { name: `item-${i}` })
      expect(res.status).toBe(201)
    }
  })

  it('50개 순차 POST (무효) → 전부 422', async () => {
    for (let i = 0; i < 50; i++) {
      const res = await client.post('/items', {}) // name 누락
      expect(res.status).toBe(422)
    }
  })
})

describe('큰 바디', () => {
  it('1KB body → 정상', async () => {
    const name = 'x'.repeat(1024)
    const res = await client.post('/items', { name })
    expect(res.status).toBe(201)
  })

  it('100KB body → 정상', async () => {
    const name = 'x'.repeat(100 * 1024)
    const res = await client.post('/items', { name })
    expect(res.status).toBe(201)
  })
})

describe('경로 혼합', () => {
  it('GET /items + GET /items/:id + POST /items 동시', async () => {
    const requests = [
      client.get('/items'),
      client.get('/items/1'),
      client.get('/items/2'),
      client.post('/items', { name: 'a' }),
      client.post('/items', { name: 'b' }),
    ]
    const results = await Promise.all(requests)
    expect(results[0]!.status).toBe(200)
    expect(results[1]!.status).toBe(200)
    expect(results[2]!.status).toBe(200)
    expect(results[3]!.status).toBe(201)
    expect(results[4]!.status).toBe(201)
  })

  it('404 + 405 + 200 동시', async () => {
    const results = await Promise.all([
      client.get('/nonexistent'),
      client.put('/items', {}),
      client.get('/items'),
    ])
    expect(results[0]!.status).toBe(404)
    expect(results[1]!.status).toBe(405)
    expect(results[2]!.status).toBe(200)
  })
})

describe('성능', () => {
  it('100개 동시 요청 < 2초', async () => {
    const start = performance.now()
    const requests = Array.from({ length: 100 }, (_, i) =>
      i % 3 === 0 ? client.get('/items')
      : i % 3 === 1 ? client.get(`/items/${i}`)
      : client.post('/items', { name: `perf-${i}` })
    )
    await Promise.all(requests)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(2000)
  })
})
