import { describe, expect, it } from 'vitest'
import { fetchRuntimeOpenApi, type RuntimeOpenApiFetch } from '../cli/commands/drift.js'

describe('runtime OpenAPI URL fetch', () => {
  it('captures redirect metadata on successful URL fetches', async () => {
    const fetcher: RuntimeOpenApiFetch = async () => response({
      ok: true,
      redirected: true,
      url: 'https://api.example.test/redirected.json',
      status: 200,
      statusText: 'OK',
      contentType: 'application/json',
      body: {
        openapi: '3.2.0',
        info: { title: 'Runtime API', version: '1.0.0' },
        paths: {},
      },
    })

    const result = await fetchRuntimeOpenApi('https://api.example.test/openapi.json', fetcher)

    expect('failure' in result).toBe(false)
    expect(result.fetch).toEqual(expect.objectContaining({
      url: 'https://api.example.test/openapi.json',
      redirected: true,
      finalUrl: 'https://api.example.test/redirected.json',
      status: 200,
      statusText: 'OK',
      contentType: 'application/json',
    }))
  })

  it('reports non-2xx responses as drift-check-failed with HTTP metadata', async () => {
    const fetcher: RuntimeOpenApiFetch = async () => response({
      ok: false,
      redirected: false,
      url: 'https://api.example.test/openapi.json',
      status: 503,
      statusText: 'Service Unavailable',
      contentType: 'application/json',
      body: { error: 'unavailable' },
    })

    const result = await fetchRuntimeOpenApi('https://api.example.test/openapi.json', fetcher)

    expect('failure' in result).toBe(true)
    if (!('failure' in result)) return
    expect(result.failure.code).toBe('drift-check-failed')
    expect(result.failure.message).toContain('HTTP 503 Service Unavailable')
    expect(result.fetch).toEqual(expect.objectContaining({
      redirected: false,
      finalUrl: 'https://api.example.test/openapi.json',
      status: 503,
      statusText: 'Service Unavailable',
    }))
  })
})

function response(options: {
  ok: boolean
  redirected: boolean
  url: string
  status: number
  statusText: string
  contentType: string
  body: unknown
}): Response {
  return {
    ok: options.ok,
    redirected: options.redirected,
    url: options.url,
    status: options.status,
    statusText: options.statusText,
    headers: new Headers({ 'content-type': options.contentType }),
    text: async () => JSON.stringify(options.body),
  } as Response
}
