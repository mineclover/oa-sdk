import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createNodeMockServer, type NodeMockServer } from '../../adapters/node-http.js'
import { createCallbackTracker } from '../../testing.js'
import type { OasDocument } from '@oa-sdk/parser'

const callbackTracker = createCallbackTracker()

const spec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Webhook callback loop', version: '1.0.0' },
  paths: {
    '/subscriptions/{eventType}': {
      parameters: [
        { name: 'eventType', in: 'path', required: true, schema: { type: 'string' } },
      ],
      post: {
        operationId: 'createSubscription',
        parameters: [
          { name: 'callbackUrl', in: 'query', required: true, schema: { type: 'string', format: 'uri' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['subscriberId'],
                properties: {
                  subscriberId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Subscription created.',
            content: {
              'application/json': {
                example: { subscriptionId: 'sub_123' },
              },
            },
          },
        },
        callbacks: {
          onDelivery: {
            '{$request.query.callbackUrl}': {
              post: {
                operationId: 'receiveDeliveryCallback',
                requestBody: {
                  required: true,
                  content: {
                    'application/json': {
                      examples: {
                        default: {
                          dataValue: {
                            deliveryId: 'del_123',
                            eventType: 'order.created',
                          },
                        },
                      },
                      schema: {
                        type: 'object',
                        required: ['deliveryId', 'eventType'],
                        properties: {
                          deliveryId: { type: 'string' },
                          eventType: { type: 'string' },
                        },
                      },
                    },
                  },
                },
                responses: {
                  '202': {
                    description: 'Delivery accepted.',
                    content: {
                      'application/json': {
                        example: { received: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  webhooks: {
    delivery: {
      post: {
        operationId: 'receiveDeliveryWebhook',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['deliveryId', 'eventType'],
                properties: {
                  deliveryId: { type: 'string' },
                  eventType: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '202': {
            description: 'Accepted.',
            content: {
              'application/json': {
                example: { received: true },
              },
            },
          },
        },
      },
    },
  },
}

let server: NodeMockServer

beforeAll(async () => {
  server = createNodeMockServer(spec, {
    port: 0,
    onCallback: callbackTracker.onCallback,
  })
  await server.start()
})

afterAll(async () => {
  await server.stop()
})

describe('webhook + callback full loop', () => {
  it('records an outbound callback attempt and accepts the same payload on the inbound webhook route', async () => {
    callbackTracker.reset()

    const subscribeResponse = await fetch(`${server.url}/subscriptions/order.created?callbackUrl=${encodeURIComponent(`${server.url}/webhooks/delivery`)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscriberId: 'sub_user_1' }),
    })
    expect(subscribeResponse.status).toBe(201)
    await expect(subscribeResponse.json()).resolves.toEqual({ subscriptionId: 'sub_123' })

    expect(callbackTracker.attempts).toHaveLength(1)
    const attempt = callbackTracker.attempts[0]!
    expect(attempt).toMatchObject({
      callbackName: 'onDelivery',
      callbackOperationId: 'receiveDeliveryCallback',
      sourceOperationId: 'createSubscription',
      resolved: true,
      url: `${server.url}/webhooks/delivery`,
      body: {
        deliveryId: 'del_123',
        eventType: 'order.created',
      },
    })

    const webhookResponse = await fetch(attempt.url!, {
      method: 'POST',
      headers: attempt.headers,
      body: JSON.stringify(attempt.body),
    })
    expect(webhookResponse.status).toBe(202)
    await expect(webhookResponse.json()).resolves.toEqual({ received: true })
  })
})
