import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import type { OasDocument } from '@oa-sdk/parser'
import {
  generateClient,
  BinaryCodecRegistry,
  MessagePackAdapter,
  messagePackAdapter,
  encodeMessagePack,
  decodeMessagePack,
  ProtobufAdapter,
  createProtobufAdapter,
  RawBinaryAdapter,
  createRawBinaryAdapter,
} from '../index.js'

const require = createRequire(import.meta.url)
const tscBin = require.resolve('typescript/bin/tsc')

function runTsc(cwd: string): void {
  execFileSync(process.execPath, [tscBin, '--noEmit'], {
    cwd,
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

async function importGeneratedClient(code: string): Promise<{ createClient: (config?: unknown) => Record<string, any> }> {
  const js = transpileModule(code, {
    compilerOptions: {
      module: ModuleKind.ES2022,
      target: ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  }).outputText
  const url = `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
  return await import(url) as { createClient: (config?: unknown) => Record<string, any> }
}

const tmpDir = resolve(__dirname, '../../.tmp-binary-codec-test')

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

describe('MessagePack pure TypeScript codec', () => {
  it('round-trips primitives (null, booleans, numbers)', () => {
    expect(decodeMessagePack(encodeMessagePack(null))).toBe(null)
    expect(decodeMessagePack(encodeMessagePack(undefined))).toBe(null)
    expect(decodeMessagePack(encodeMessagePack(true))).toBe(true)
    expect(decodeMessagePack(encodeMessagePack(false))).toBe(false)

    // Positive fixint [0, 127]
    expect(decodeMessagePack(encodeMessagePack(0))).toBe(0)
    expect(decodeMessagePack(encodeMessagePack(127))).toBe(127)

    // Uint8 [128, 255]
    expect(decodeMessagePack(encodeMessagePack(128))).toBe(128)
    expect(decodeMessagePack(encodeMessagePack(255))).toBe(255)

    // Uint16 [256, 65535]
    expect(decodeMessagePack(encodeMessagePack(256))).toBe(256)
    expect(decodeMessagePack(encodeMessagePack(65535))).toBe(65535)

    // Uint32 [65536, 4294967295]
    expect(decodeMessagePack(encodeMessagePack(65536))).toBe(65536)
    expect(decodeMessagePack(encodeMessagePack(1000000))).toBe(1000000)

    // Negative fixint [-32, -1]
    expect(decodeMessagePack(encodeMessagePack(-1))).toBe(-1)
    expect(decodeMessagePack(encodeMessagePack(-32))).toBe(-32)

    // Int8 [-128, -33]
    expect(decodeMessagePack(encodeMessagePack(-33))).toBe(-33)
    expect(decodeMessagePack(encodeMessagePack(-128))).toBe(-128)

    // Int16 [-32768, -129]
    expect(decodeMessagePack(encodeMessagePack(-129))).toBe(-129)
    expect(decodeMessagePack(encodeMessagePack(-32768))).toBe(-32768)

    // Int32 [-2147483648, -32769]
    expect(decodeMessagePack(encodeMessagePack(-32769))).toBe(-32769)
    expect(decodeMessagePack(encodeMessagePack(-1000000))).toBe(-1000000)

    // Floats
    expect(decodeMessagePack(encodeMessagePack(3.14159))).toBeCloseTo(3.14159)
    expect(decodeMessagePack(encodeMessagePack(-0.00042))).toBeCloseTo(-0.00042)
  })

  it('round-trips strings including multi-byte UTF-8', () => {
    // Empty string
    expect(decodeMessagePack(encodeMessagePack(''))).toBe('')

    // Short string (< 32 bytes)
    expect(decodeMessagePack(encodeMessagePack('hello world'))).toBe('hello world')

    // Medium string (32-255 bytes)
    const medStr = 'a'.repeat(100)
    expect(decodeMessagePack(encodeMessagePack(medStr))).toBe(medStr)

    // Large string (> 255 bytes)
    const largeStr = 'x'.repeat(1000)
    expect(decodeMessagePack(encodeMessagePack(largeStr))).toBe(largeStr)

    // Multi-byte UTF-8 (Korean, Japanese, emojis)
    const utf8Str = '안녕하세요 세계! 🚀 Multi-byte Protobuf & MsgPack ⚡️'
    expect(decodeMessagePack(encodeMessagePack(utf8Str))).toBe(utf8Str)
  })

  it('round-trips binary Uint8Array data', () => {
    const raw = new Uint8Array([0x00, 0xff, 0x42, 0x13, 0x37])
    const decoded = decodeMessagePack(encodeMessagePack(raw)) as Uint8Array
    expect(decoded).toBeInstanceOf(Uint8Array)
    expect(Array.from(decoded)).toEqual([0x00, 0xff, 0x42, 0x13, 0x37])
  })

  it('round-trips complex nested objects and arrays', () => {
    const complexData = {
      id: 1001,
      name: 'Agentic Pipeline',
      active: true,
      score: 98.75,
      tags: ['rpc', 'protobuf', 'codec'],
      meta: {
        version: 2,
        retries: 3,
        options: {
          compress: true,
          level: null,
        },
      },
    }

    const encoded = encodeMessagePack(complexData)
    expect(encoded).toBeInstanceOf(Uint8Array)
    expect(encoded.length).toBeGreaterThan(0)

    const decoded = decodeMessagePack(encoded)
    expect(decoded).toEqual(complexData)
  })

  it('MessagePackAdapter implements BinaryCodecAdapter interface', () => {
    const adapter = new MessagePackAdapter()
    expect(adapter.mediaTypes).toContain('application/msgpack')
    expect(adapter.mediaTypes).toContain('application/x-msgpack')

    const encoded = adapter.encode({ test: 'adapter' })
    expect(encoded).toBeInstanceOf(Uint8Array)

    const decoded = adapter.decode(encoded)
    expect(decoded).toEqual({ test: 'adapter' })

    // Decode from ArrayBuffer
    const bufferDecoded = adapter.decode(encoded.buffer)
    expect(bufferDecoded).toEqual({ test: 'adapter' })
  })

  it('throws on truncated or corrupted buffers', () => {
    expect(() => decodeMessagePack(new Uint8Array([]))).toThrow(RangeError)
    expect(() => decodeMessagePack(new Uint8Array([0xda, 0x00]))).toThrow(RangeError)
    expect(() => decodeMessagePack(new Uint8Array([0xc1]))).toThrow(TypeError)
  })
})

describe('ProtobufAdapter and createProtobufAdapter', () => {
  interface UserProfile {
    id: number
    name: string
  }

  it('wraps custom encoders and decoders into a BinaryCodecAdapter', async () => {
    const encoder = (data: UserProfile) => {
      // Mock wire serialization: JSON string as bytes
      return new TextEncoder().encode(JSON.stringify(data))
    }
    const decoder = (raw: Uint8Array | ArrayBuffer): UserProfile => {
      const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
      return JSON.parse(new TextDecoder().decode(bytes)) as UserProfile
    }

    const adapter = createProtobufAdapter<UserProfile>({
      encode: encoder,
      decode: decoder,
    })

    expect(adapter.mediaTypes).toContain('application/x-protobuf')
    expect(adapter.mediaTypes).toContain('application/protobuf')

    const encoded = await adapter.encode({ id: 42, name: 'Alice' })
    expect(encoded).toBeInstanceOf(Uint8Array)

    const decoded = await adapter.decode(encoded as Uint8Array)
    expect(decoded).toEqual({ id: 42, name: 'Alice' })
  })

  it('supports custom media types and async encoders/decoders', async () => {
    const adapter = new ProtobufAdapter({
      mediaTypes: ['application/vnd.my-proto'],
      encode: async (data: string) => new TextEncoder().encode(data),
      decode: async (raw) => new TextDecoder().decode(raw instanceof Uint8Array ? raw : new Uint8Array(raw)),
    })

    expect(adapter.mediaTypes).toEqual(['application/vnd.my-proto'])
    const encoded = await adapter.encode('async-test')
    const decoded = await adapter.decode(encoded as Uint8Array)
    expect(decoded).toBe('async-test')
  })
})

describe('RawBinaryAdapter and createRawBinaryAdapter', () => {
  it('passes binary payloads without alteration', () => {
    const adapter = createRawBinaryAdapter()
    expect(adapter.mediaTypes).toContain('application/octet-stream')

    const data = new Uint8Array([1, 2, 3, 4])
    const encoded = adapter.encode(data)
    expect(encoded).toBe(data)

    const decoded = adapter.decode(data)
    expect(decoded).toEqual(data)
  })

  it('throws on non-binary input', () => {
    const adapter = new RawBinaryAdapter()
    expect(() => adapter.encode('invalid' as unknown as Uint8Array)).toThrow(TypeError)
    expect(() => adapter.encode({ foo: 'bar' } as unknown as Uint8Array)).toThrow(TypeError)
  })
})

describe('BinaryCodecRegistry', () => {
  it('registers and resolves codecs with media type normalization', () => {
    const registry = new BinaryCodecRegistry([
      messagePackAdapter,
      createRawBinaryAdapter(),
    ])

    // Exact match
    expect(registry.resolve('application/msgpack')).toBe(messagePackAdapter)
    expect(registry.resolve('application/octet-stream')).toBeDefined()

    // Case-insensitive & parameter stripping
    expect(registry.resolve('Application/MsgPack; charset=utf-8')).toBe(messagePackAdapter)
    expect(registry.resolve('application/x-msgpack; profile=compact')).toBe(messagePackAdapter)

    // Unregistered type returns undefined
    expect(registry.resolve('application/json')).toBeUndefined()
    expect(registry.resolve(undefined)).toBeUndefined()
    expect(registry.resolve(null)).toBeUndefined()

    expect(registry.has('application/msgpack')).toBe(true)
    expect(registry.has('application/json')).toBe(false)
  })

  it('supports object map constructor', () => {
    const custom = createProtobufAdapter({
      encode: () => new Uint8Array(),
      decode: () => ({}),
    })

    const registry = new BinaryCodecRegistry({
      'application/x-protobuf': custom,
    })

    expect(registry.resolve('application/x-protobuf')).toBe(custom)
    expect(registry.toRecord()['application/x-protobuf']).toBe(custom)
  })
})

describe('Generated Client Codec Integration', () => {
  const binarySpec: OasDocument = {
    openapi: '3.1.0',
    info: { title: 'Wire Compression API', version: '1.0.0' },
    paths: {
      '/events': {
        post: {
          operationId: 'pushEvent',
          requestBody: {
            required: true,
            content: {
              'application/msgpack': {
                schema: {
                  type: 'object',
                  properties: {
                    event: { type: 'string' },
                    timestamp: { type: 'number' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Event processed',
              content: {
                'application/msgpack': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      eventId: { type: 'string' },
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

  it('emits BinaryCodecAdapter and ClientConfig.codecs in generated code', () => {
    const code = generateClient(binarySpec)

    expect(code).toContain('export type BinaryCodecAdapter<T = unknown>')
    expect(code).toContain('codecs?: Record<string, BinaryCodecAdapter> | readonly BinaryCodecAdapter[]')
    expect(code).toContain('const __codecs = new Map<string, BinaryCodecAdapter>()')
    expect(code).toContain('function __findCodec(')
    expect(code).toContain('__serializeOaRequestBody(')
    expect(code).toContain('__readOaBody<T>(')
  })

  it('passes strict TypeScript compiler diagnostics with 0 errors', () => {
    const code = generateClient(binarySpec)

    const tsconfig = {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
    }

    writeFileSync(resolve(tmpDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2))
    writeFileSync(resolve(tmpDir, 'client.ts'), code)

    // Consumer file instantiating createClient with codecs
    const consumerCode = `
      import { createClient, type BinaryCodecAdapter } from './client.js'

      const customCodec: BinaryCodecAdapter = {
        mediaTypes: ['application/msgpack'],
        encode: (payload) => new Uint8Array([1, 2, 3]),
        decode: (raw) => ({ success: true, eventId: '123' }),
      }

      const client = createClient({
        baseUrl: 'https://api.example.com',
        codecs: [customCodec],
      })

      async function run() {
        const res = await client.pushEvent({
          event: 'deploy',
          timestamp: Date.now(),
        })
        return res
      }
    `
    writeFileSync(resolve(tmpDir, 'consumer.ts'), consumerCode)

    expect(() => runTsc(tmpDir)).not.toThrow()
  })

  it('executes end-to-end with mock fetch and MessagePackAdapter', async () => {
    const code = generateClient(binarySpec)

    let capturedBody: unknown
    let capturedHeaders: unknown

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = (async (_input: unknown, init?: RequestInit): Promise<Response> => {
        capturedBody = init?.body
        capturedHeaders = init?.headers

        const responsePayload = { success: true, eventId: 'evt_998877' }
        const binaryResponse = encodeMessagePack(responsePayload)

        return new Response(binaryResponse, {
          status: 200,
          headers: {
            'Content-Type': 'application/msgpack',
          },
        })
      }) as typeof fetch

      const { createClient } = await importGeneratedClient(code)

      const client = createClient({
        baseUrl: 'https://api.example.com',
        codecs: [messagePackAdapter],
      })

      const requestPayload = { event: 'telemetry_ping', timestamp: 1700000000 }
      const result = await client.pushEvent(requestPayload)

      // Assert that the request body sent to fetch was binary encoded via MessagePack
      expect(capturedBody).toBeInstanceOf(Uint8Array)
      expect(decodeMessagePack(capturedBody as Uint8Array)).toEqual(requestPayload)

      // Assert that the response body returned by pushEvent was decoded via MessagePack
      expect(result).toEqual({ success: true, eventId: 'evt_998877' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
