import { describe, expect, it } from 'vitest'
import { createHttpServer, writeJson } from '../http.js'

describe('createHttpServer', () => {
  it('start를 여러 번 호출해도 같은 listener를 재사용한다', async () => {
    const server = createHttpServer(async (_req, res) => writeJson(res, 200, { ok: true }))
    await server.start()
    const url = server.url
    await server.start()

    expect(server.url).toBe(url)
    await server.stop()
    await expect(fetch(url)).rejects.toThrow()
  })
})

describe('writeJson', () => {
  it('undefined body는 유효한 JSON null로 전송한다', async () => {
    const server = createHttpServer(async (_req, res) => writeJson(res, 200, undefined))
    await server.start()
    try {
      const response = await fetch(server.url)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('null')
    } finally {
      await server.stop()
    }
  })
})
