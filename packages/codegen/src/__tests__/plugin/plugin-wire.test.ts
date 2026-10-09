import { describe, expect, it } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import { createPluginContext } from '../../plugin/context.js'
import { pluginWire } from '../../plugin/plugins/wire.js'

function createSampleOasDoc(): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Telemetry Wire Service', version: '1.0.0' },
    paths: {
      '/telemetry/submit': {
        post: {
          operationId: 'submitTelemetry',
          tags: ['telemetry'],
          summary: 'Submit binary telemetry payload',
          requestBody: {
            required: true,
            content: {
              'application/x-protobuf': {
                schema: {
                  $ref: '#/components/schemas/TelemetryMetric',
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Submission acknowledgment',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/TelemetryAck',
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        TelemetryMetric: {
          type: 'object',
          'x-oa-sdk-protobuf': { messageName: 'TelemetryMetric', package: 'telemetry.v1' },
          required: ['sensorId', 'timestamp', 'value'],
          properties: {
            sensorId: {
              type: 'string',
              'x-oa-sdk-field': { index: 1, type: 'string' },
            },
            timestamp: {
              type: 'integer',
              'x-oa-sdk-field': { index: 2, type: 'int64' },
            },
            value: {
              type: 'number',
              'x-oa-sdk-field': { index: 3, type: 'double' },
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              'x-oa-sdk-field': { index: 4, type: 'string', repeated: true },
            },
          },
        },
        TelemetryAck: {
          type: 'object',
          'x-oa-sdk-protobuf': { messageName: 'TelemetryAck', package: 'telemetry.v1' },
          required: ['success', 'processedCount'],
          properties: {
            success: {
              type: 'boolean',
              'x-oa-sdk-field': { index: 1, type: 'bool' },
            },
            processedCount: {
              type: 'integer',
              'x-oa-sdk-field': { index: 2, type: 'int32' },
            },
          },
        },
      },
    },
  }
}

describe('pluginWire', () => {
  it('declares correct metadata and dependencies', () => {
    const plugin = pluginWire()
    expect(plugin.name).toBe('wire')
    expect(plugin.dependencies).toEqual(['typescript'])
    expect(typeof plugin.generate).toBe('function')
  })

  it('generates wire.ts containing Protobuf and MessagePack codecs by default', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginWire()
    await plugin.generate!(context)

    expect(context.hasFile('wire.ts')).toBe(true)
    const file = context.getFile('wire.ts')
    expect(file?.kind).toBe('wire')
    expect(file?.sourcePlugin).toBe('wire')

    const content = file!.content

    // Protobuf section
    expect(content).toContain('getGeneratedProtobufCodecs')
    expect(content).toContain('telemetryMetricProtobufCodec')
    expect(content).toContain('telemetryAckProtobufCodec')
    expect(content).toContain('BinaryCodecAdapter')

    // MessagePack section
    expect(content).toContain('getGeneratedMessagePackCodecs')
    expect(content).toContain('telemetryMetricMessagePackCodec')
    expect(content).toContain('messagePackAdapter')

    // Media type resolution helper
    expect(content).toContain('resolveBinaryCodec')
    expect(content).toContain('application/x-protobuf')
    expect(content).toContain('application/msgpack')

    // Zero-eval CSP check: ensure neither eval nor new Function is emitted
    expect(content).not.toMatch(/\beval\s*\(/)
    expect(content).not.toMatch(/\bnew\s+Function\s*\(/)
  })

  it('generates Protocol Buffers v3 schema (.proto) when requested', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginWire({
      codecs: ['protobuf', 'proto3'],
      proto3Output: 'proto/telemetry.proto',
    })
    await plugin.generate!(context)

    expect(context.hasFile('wire.ts')).toBe(true)
    expect(context.hasFile('proto/telemetry.proto')).toBe(true)

    const protoFile = context.getFile('proto/telemetry.proto')
    expect(protoFile?.kind).toBe('proto-schema')

    const protoContent = protoFile!.content
    expect(protoContent).toContain('syntax = "proto3";')
    expect(protoContent).toContain('message TelemetryMetric {')
    expect(protoContent).toContain('string sensorId = 1;')
    expect(protoContent).toContain('double value = 3;')
    expect(protoContent).toContain('repeated string tags = 4;')
    expect(protoContent).toContain('message TelemetryAck {')
  })

  it('generates RPC service contracts and clients when rpc-contract codec is selected', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginWire({
      codecs: ['protobuf', 'rpc-contract'],
    })
    await plugin.generate!(context)

    const file = context.getFile('wire.ts')
    expect(file).toBeDefined()
    expect(file?.content).toContain('ServerHandlers')
    expect(file?.content).toContain('Client')
  })

  it('supports custom output path and resolves relative imports to types file', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    context.addFile({
      path: 'src/types/models.ts',
      content: 'export interface TelemetryMetric {}',
      sourcePlugin: 'typescript',
      kind: 'models',
    })

    const plugin = pluginWire({
      output: 'src/codecs/wire.ts',
    })
    await plugin.generate!(context)

    const file = context.getFile('src/codecs/wire.ts')
    expect(file).toBeDefined()
    // Relative import from src/codecs/wire.ts to src/types/models.ts should be ../types/models.js
    expect(file?.content).toContain('../types/models.js')
  })

  it('supports single codec selection: msgpack only', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginWire({
      codecs: ['msgpack'],
    })
    await plugin.generate!(context)

    const file = context.getFile('wire.ts')
    expect(file).toBeDefined()
    expect(file?.content).toContain('getGeneratedMessagePackCodecs')
    expect(file?.content).not.toContain('getGeneratedProtobufCodecs')
  })

  it('handles empty OpenAPI schemas gracefully without throwing', async () => {
    const emptyDoc: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Empty API', version: '1.0.0' },
      paths: {},
      components: { schemas: {} },
    }
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: emptyDoc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginWire()
    await expect(plugin.generate!(context)).resolves.not.toThrow()
    expect(context.hasFile('wire.ts')).toBe(true)
  })
})
