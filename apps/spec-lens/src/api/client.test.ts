import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './client.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('spec-lens API client', () => {
  it('validates a successful response through the shared wire guard', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ nodes: [], edges: [] })))

    await expect(api.graph()).resolves.toEqual({ nodes: [], edges: [] })
  })

  it('rejects a successful response with an invalid wire shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ nodes: [] })))

    await expect(api.graph()).rejects.toThrow('invalid JSON response or response shape')
  })

  it('surfaces structured API errors instead of the raw JSON envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: 'cache unavailable' }),
    } as Response))

    await expect(api.config()).rejects.toThrow('API /api/config → 500: cache unavailable')
  })
})

function jsonResponse(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => value,
    text: async () => JSON.stringify(value),
  } as Response
}
