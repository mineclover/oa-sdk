import { describe, expect, it } from 'vitest'
import { matchRoute, parseDocument, type OasDocument, type OasMediaType } from '@oa-sdk/parser'
import { handleRequest } from '../../core/handler.js'

function createCallbackSpec(expression: string, callbackMedia: OasMediaType): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Callback Test', version: '1.0.0' },
    paths: {
      '/subscriptions/{eventType}': {
        parameters: [
          { name: 'eventType', in: 'path', required: true, schema: { type: 'string' } },
        ],
        post: {
          operationId: 'createSubscription',
          parameters: [
            { name: 'callbackUrl', in: 'query', required: false, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id'],
                  properties: {
                    id: { type: 'string' },
                    callbackUrl: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Created',
              content: {
                'application/json': {
                  example: { subscriptionId: 'sub_123' },
                },
              },
            },
          },
          callbacks: {
            onData: {
              [expression]: {
                post: {
                  operationId: 'receiveSubscriptionData',
                  requestBody: {
                    required: true,
                    content: {
                      'application/json': callbackMedia,
                    },
                  },
                  responses: { '202': { description: 'Accepted' } },
                },
              },
            },
          },
        },
      },
    },
  }
}

function callSubscription(
  spec: OasDocument,
  overrides: {
    path?: string
    queryParams?: Record<string, string | string[]>
    headers?: Record<string, string>
    body?: Record<string, unknown>
    url?: string
  } = {},
) {
  const parsed = parseDocument(spec)
  const path = overrides.path ?? '/subscriptions/order.created'
  const matched = matchRoute(parsed.routes, 'post', path)
  if (matched.type !== 'found') throw new Error(`Expected route match for ${path}`)

  return handleRequest(
    {
      pathParams: matched.pathParams,
      queryParams: overrides.queryParams ?? {},
      headers: overrides.headers ?? {},
      body: overrides.body ?? { id: 'evt_123' },
      contentType: 'application/json',
      url: overrides.url ?? `https://api.test${path}`,
    },
    matched.entry,
    parsed.securitySchemes,
  )
}

describe('callback simulation', () => {
  it('simulates a callback POST using a query URL expression and example payload', () => {
    const result = callSubscription(
      createCallbackSpec('{$request.query.callbackUrl}/data', {
        examples: {
          default: { dataValue: { eventId: 'evt_1', kind: 'created' } },
        },
      }),
      { queryParams: { callbackUrl: 'https://client.test/hooks' } },
    )

    expect(result.type).toBe('success')
    if (result.type !== 'success') return
    expect(result.callbacks).toHaveLength(1)
    expect(result.callbacks[0]).toMatchObject({
      callbackName: 'onData',
      callbackOperationId: 'receiveSubscriptionData',
      contentType: 'application/json',
      expression: '{$request.query.callbackUrl}/data',
      method: 'post',
      resolved: true,
      sourceOperationId: 'createSubscription',
      url: 'https://client.test/hooks/data',
      body: { eventId: 'evt_1', kind: 'created' },
    })
  })

  it('supports templated request path, header, body, method, and status expressions', () => {
    const result = callSubscription(
      createCallbackSpec(
        'https://notify.test/{$request.path.eventType}?id={$request.body#/id}&client={$request.header.x-client}&method={$method}&status={$statusCode}',
        {
          schema: {
            type: 'object',
            required: ['deliveredAt'],
            properties: {
              deliveredAt: { type: 'string', format: 'date-time' },
              optional: { type: 'boolean' },
            },
          },
        },
      ),
      {
        headers: { 'x-client': 'local-test' },
        body: { id: 'txn_123' },
      },
    )

    expect(result.type).toBe('success')
    if (result.type !== 'success') return
    expect(result.callbacks[0]?.url).toBe('https://notify.test/order.created?id=txn_123&client=local-test&method=POST&status=201')
    expect(result.callbacks[0]?.body).toEqual({ deliveredAt: '1970-01-01T00:00:00.000Z' })
  })

  it('supports whole $url callback expressions', () => {
    const result = callSubscription(
      createCallbackSpec('$url', { example: { ok: true } }),
      { url: 'https://client.test/direct-callback' },
    )

    expect(result.type).toBe('success')
    if (result.type !== 'success') return
    expect(result.callbacks[0]?.resolved).toBe(true)
    expect(result.callbacks[0]?.url).toBe('https://client.test/direct-callback')
  })

  it('records an unresolved callback URL expression without failing the inbound response', () => {
    const result = callSubscription(
      createCallbackSpec('{$request.body#/callbackUrl}', { example: { ok: true } }),
      { body: { id: 'evt_123' } },
    )

    expect(result.type).toBe('success')
    if (result.type !== 'success') return
    expect(result.picked.status).toBe(201)
    expect(result.callbacks[0]).toMatchObject({
      resolved: false,
      url: null,
      error: { code: 'CALLBACK_URL_UNRESOLVED' },
    })
  })

  it('records an invalid callback URL expression without failing the inbound response', () => {
    const result = callSubscription(
      createCallbackSpec('{$request.body#/callbackUrl}', { example: { ok: true } }),
      { body: { id: 'evt_123', callbackUrl: 'not a url' } },
    )

    expect(result.type).toBe('success')
    if (result.type !== 'success') return
    expect(result.picked.status).toBe(201)
    expect(result.callbacks[0]).toMatchObject({
      resolved: false,
      url: null,
      error: { code: 'CALLBACK_URL_INVALID' },
    })
  })
})
