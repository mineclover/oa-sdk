import { describe, it, expect, afterEach } from 'vitest'
import { createNodeMockServer, type NodeMockServer } from '../../adapters/node-http.js'
import {
  parseThrottle,
  parseNonNegativeInt,
  parsePacketLoss,
  parseLossMode,
  parseCliArgs,
} from '../../cli/main.js'
import type { OasDocument } from '@oa-sdk/parser'

const simpleSpec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Chaos Test', version: '1.0.0' },
  paths: {
    '/ping': {
      get: {
        operationId: 'getPing',
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    pong: { type: 'string', default: 'pong' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/large': {
      get: {
        operationId: 'getLarge',
        responses: {
          '200': {
            description: 'Large response',
            content: {
              'application/json': {
                example: {
                  data: 'X'.repeat(2000),
                },
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'string',
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
}

describe('Network Chaos CLI Parsers', () => {
  it('parseThrottle converts rates and units correctly', () => {
    expect(parseThrottle(undefined)).toBeUndefined()
    expect(parseThrottle('1000')).toBe(1000)
    expect(parseThrottle('1mbps')).toBe(125_000)
    expect(parseThrottle('500kbps')).toBe(62_500)
    expect(parseThrottle('2mb/s')).toBe(2_000_000)
    expect(parseThrottle('50kb/s')).toBe(50_000)
    expect(parseThrottle('300bps')).toBe(300)
    expect(() => parseThrottle('0')).toThrow('--throttle은 양수여야 합니다')
    expect(() => parseThrottle('-100')).toThrow('--throttle은 양수여야 합니다')
    expect(() => parseThrottle('invalid')).toThrow('--throttle은 양수여야 합니다')
  })

  it('parseNonNegativeInt validates integer values', () => {
    expect(parseNonNegativeInt(undefined, '--ttfb')).toBeUndefined()
    expect(parseNonNegativeInt('0', '--ttfb')).toBe(0)
    expect(parseNonNegativeInt('150', '--ttfb')).toBe(150)
    expect(() => parseNonNegativeInt('-5', '--ttfb')).toThrow('--ttfb는 0 이상의 정수여야 합니다')
    expect(() => parseNonNegativeInt('abc', '--jitter')).toThrow('--jitter는 0 이상의 정수여야 합니다')
    expect(() => parseNonNegativeInt('12.5', '--jitter')).toThrow('--jitter는 0 이상의 정수여야 합니다')
  })

  it('parsePacketLoss validates percentage and decimal rates', () => {
    expect(parsePacketLoss(undefined)).toBeUndefined()
    expect(parsePacketLoss('0')).toBe(0)
    expect(parsePacketLoss('1')).toBe(1)
    expect(parsePacketLoss('0.25')).toBe(0.25)
    expect(parsePacketLoss('10%')).toBe(0.1)
    expect(parsePacketLoss('100%')).toBe(1)
    expect(parsePacketLoss('0%')).toBe(0)
    expect(() => parsePacketLoss('-0.1')).toThrow('--packet-loss는 0.0과 1.0 (또는 0%~100%) 사이여야 합니다')
    expect(() => parsePacketLoss('1.5')).toThrow('--packet-loss는 0.0과 1.0 (또는 0%~100%) 사이여야 합니다')
    expect(() => parsePacketLoss('105%')).toThrow('--packet-loss는 0.0과 1.0 (또는 0%~100%) 사이여야 합니다')
  })

  it('parseLossMode validates drop and status modes', () => {
    expect(parseLossMode(undefined)).toBeUndefined()
    expect(parseLossMode('drop')).toBe('drop')
    expect(parseLossMode('status')).toBe('status')
    expect(parseLossMode('DROP')).toBe('drop')
    expect(parseLossMode(' STATUS ')).toBe('status')
    expect(() => parseLossMode('invalid')).toThrow("--loss-mode는 'drop' 또는 'status'여야 합니다")
  })

  it('parseCliArgs correctly extracts chaos arguments', () => {
    const parsed = parseCliArgs([
      '--spec', 'openapi.json',
      '--port', '8080',
      '--ttfb', '100',
      '--jitter', '20',
      '--packet-loss', '5%',
      '--loss-mode', 'status',
      '--throttle', '1mbps',
    ])

    expect(parsed.port).toBe(8080)
    expect(parsed.chaos).toEqual({
      ttfbMs: 100,
      jitterMs: 20,
      packetLoss: 0.05,
      lossMode: 'status',
      throttleBytesPerSec: 125_000,
    })
  })
})

describe('Network Chaos Engine Runtime', () => {
  let activeServer: NodeMockServer | null = null

  afterEach(async () => {
    if (activeServer) {
      await activeServer.stop()
      activeServer = null
    }
  })

  it('injects TTFB latency delay into response generation', async () => {
    activeServer = createNodeMockServer(simpleSpec, {
      port: 0,
      chaos: { ttfbMs: 120 },
    })
    await activeServer.start()

    const start = Date.now()
    const res = await fetch(`${activeServer.url}/ping`)
    const elapsed = Date.now() - start

    expect(res.status).toBe(200)
    expect(elapsed).toBeGreaterThanOrEqual(100)
  })

  it('injects TTFB latency with jitter', async () => {
    activeServer = createNodeMockServer(simpleSpec, {
      port: 0,
      chaos: { ttfbMs: 100, jitterMs: 20 },
    })
    await activeServer.start()

    const start = Date.now()
    const res = await fetch(`${activeServer.url}/ping`)
    const elapsed = Date.now() - start

    expect(res.status).toBe(200)
    expect(elapsed).toBeGreaterThanOrEqual(70)
  })

  it('injects packet loss with lossMode: status (503)', async () => {
    activeServer = createNodeMockServer(simpleSpec, {
      port: 0,
      chaos: { packetLoss: 1.0, lossMode: 'status' },
    })
    await activeServer.start()

    const res = await fetch(`${activeServer.url}/ping`)
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toEqual({ error: { code: 'SERVICE_UNAVAILABLE' } })
  })

  it('injects packet loss with lossMode: drop (socket destruction)', async () => {
    activeServer = createNodeMockServer(simpleSpec, {
      port: 0,
      chaos: { packetLoss: 1.0, lossMode: 'drop' },
    })
    await activeServer.start()

    await expect(fetch(`${activeServer.url}/ping`)).rejects.toThrow()
  })

  it('throttles bandwidth transfer rate', async () => {
    // 2000 bytes payload at 4000 bytes/sec should take ~500ms
    activeServer = createNodeMockServer(simpleSpec, {
      port: 0,
      chaos: { throttleBytesPerSec: 4000 },
    })
    await activeServer.start()

    const start = Date.now()
    const res = await fetch(`${activeServer.url}/large`)
    const data = (await res.json()) as { data: string }
    const elapsed = Date.now() - start

    expect(res.status).toBe(200)
    expect(data.data.length).toBe(2000)
    expect(elapsed).toBeGreaterThanOrEqual(300)
  })
})
