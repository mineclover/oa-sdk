import { describe, it, expect } from 'vitest'
import {
  RouterCodecRegistry,
  negotiateResponseMediaType,
  type RouterCodecAdapter,
} from '../codec/router-codec.js'
import { buildBodyParseLine, isBinaryContentType } from '../common/body-parser.js'

describe('Router Binary Codec and Compression Support', () => {
  const dummyProtobufCodec: RouterCodecAdapter<{ message: string }> = {
    mediaTypes: ['application/x-protobuf', 'application/protobuf'],
    encode: (data) => new TextEncoder().encode(JSON.stringify(data)),
    decode: (raw) => {
      const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
      return JSON.parse(new TextDecoder().decode(bytes))
    },
  }

  const dummyMsgPackCodec: RouterCodecAdapter<any> = {
    mediaTypes: ['application/x-msgpack', 'application/msgpack'],
    encode: (data) => new Uint8Array([0x90]), // dummy msgpack header
    decode: () => ({ decoded: true }),
  }

  describe('RouterCodecRegistry', () => {
    it('registers codecs and normalizes media types with charset parameters', () => {
      const registry = new RouterCodecRegistry()
      registry.register(dummyProtobufCodec)

      expect(registry.has('application/x-protobuf')).toBe(true)
      expect(registry.has('application/protobuf')).toBe(true)
      expect(registry.has('APPLICATION/X-PROTOBUF; charset=utf-8')).toBe(true)

      const resolved = registry.resolve('application/x-protobuf; proto=Order')
      expect(resolved).toBe(dummyProtobufCodec)

      expect(registry.resolve('application/json')).toBeUndefined()
    })

    it('initializes registry from array or record of codecs', () => {
      const fromArray = new RouterCodecRegistry([dummyProtobufCodec, dummyMsgPackCodec])
      expect(fromArray.registeredMediaTypes).toContain('application/x-protobuf')
      expect(fromArray.registeredMediaTypes).toContain('application/x-msgpack')

      const fromRecord = new RouterCodecRegistry({
        'application/x-protobuf': dummyProtobufCodec,
      })
      expect(fromRecord.has('application/x-protobuf')).toBe(true)
    })

    it('encodes and decodes payloads via registered adapter', async () => {
      const registry = new RouterCodecRegistry([dummyProtobufCodec])
      const codec = registry.resolve('application/x-protobuf')!
      expect(codec).toBeDefined()

      const original = { message: 'hello protobuf' }
      const encoded = await codec.encode(original)
      expect(encoded).toBeInstanceOf(Uint8Array)

      const decoded = await codec.decode(encoded)
      expect(decoded).toEqual(original)
    })
  })

  describe('negotiateResponseMediaType', () => {
    const registry = new RouterCodecRegistry([dummyProtobufCodec, dummyMsgPackCodec])

    it('returns declared type or application/json when Accept header is missing or wildcard', () => {
      expect(negotiateResponseMediaType(null, ['application/x-protobuf'])).toBe('application/x-protobuf')
      expect(negotiateResponseMediaType(undefined, [])).toBe('application/json')
      expect(negotiateResponseMediaType('*/*', ['application/xml'])).toBe('application/xml')
    })

    it('negotiates requested media type matching declared types', () => {
      const declared = ['application/json', 'application/x-protobuf']
      const negotiated = negotiateResponseMediaType('application/x-protobuf, application/json;q=0.9', declared)
      expect(negotiated).toBe('application/x-protobuf')
    })

    it('negotiates supported binary codec when requested in Accept header', () => {
      const negotiated = negotiateResponseMediaType('application/x-msgpack, */*;q=0.1', ['application/json'], registry)
      expect(negotiated).toBe('application/x-msgpack')
    })
  })

  describe('body-parser binary content type detection and generation', () => {
    it('detects binary and protobuf content types', () => {
      expect(isBinaryContentType('application/x-protobuf')).toBe(true)
      expect(isBinaryContentType('application/protobuf')).toBe(true)
      expect(isBinaryContentType('application/vnd.google.protobuf')).toBe(true)
      expect(isBinaryContentType('application/x-msgpack')).toBe(true)
      expect(isBinaryContentType('application/msgpack')).toBe(true)
      expect(isBinaryContentType('application/octet-stream')).toBe(true)
      expect(isBinaryContentType('application/json')).toBe(false)
      expect(isBinaryContentType(undefined)).toBe(false)
    })

    it('generates binary arrayBuffer parse lines for Hono target', () => {
      const binaryLine = buildBodyParseLine('hono', ['application/x-protobuf'], 'Order', true, true)
      expect(binaryLine).toBe('  const body = await c.req.arrayBuffer() // OrderBody (raw application/x-protobuf bytes)')
      // The stub's module-level app has no `options` binding to read codecs from.
      expect(binaryLine).not.toContain('options')

      const jsonLine = buildBodyParseLine('hono', ['application/json'], 'Order', true, true)
      expect(jsonLine).toBe('  const body = await c.req.json<OrderBody>()')
    })

    it('generates raw buffer or parsed body line for Express target', () => {
      const binaryLine = buildBodyParseLine('express', ['application/x-protobuf'], 'Order', true, true)
      expect(binaryLine).toBe('  const body = req.body as Uint8Array // OrderBody (raw application/x-protobuf bytes; use express.raw() middleware)')
      expect(binaryLine).not.toContain('options')

      const jsonLine = buildBodyParseLine('express', ['application/json'], 'Order', true, true)
      expect(jsonLine).toBe('  const body = req.body as OrderBody')
    })
  })
})
