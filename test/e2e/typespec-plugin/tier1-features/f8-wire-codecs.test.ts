import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { compileTypeSpecInMemory } from '../../../../packages/codegen/src/plugin/index.js'
import {
  extractWireSchemaFromOas,
  Proto3TargetAdapter,
  ProtobufCodecTargetAdapter,
  MessagePackTargetAdapter,
} from '../../../../packages/codegen/src/wire-adapter/index.js'
import { negotiateResponseMediaType } from '../../../../packages/router/src/index.js'

describe('Tier 1: F8 - Binary Wire Codecs Plugin', () => {
  const protobufFile = resolve('test/e2e/typespec-plugin/fixtures/protobuf/main.tsp')
  let doc: any
  let wireModel: any

  beforeAll(async () => {
    const result = await compileTypeSpecInMemory(protobufFile)
    doc = result.document
    wireModel = extractWireSchemaFromOas(doc)
  })

  it('F8.1: extracts WireSchemaModel from TypeSpec OpenAPI document with protobuf metadata', () => {
    expect(wireModel).toBeDefined()
    expect(wireModel.models.length).toBeGreaterThan(0)
    const modelNames = wireModel.models.map((m: any) => m.name)
    expect(modelNames).toContain('SensorReading')
    expect(modelNames).toContain('MetricBatch')

    const sensorModel = wireModel.models.find((m: any) => m.name === 'SensorReading')
    expect(sensorModel.fields.length).toBe(5)
    expect(sensorModel.fields[0].name).toBe('sensorId')
    expect(sensorModel.fields[0].index).toBe(1)
  })

  it('F8.2: generates pure Protocol Buffers v3 schema (.proto)', () => {
    const proto3 = new Proto3TargetAdapter().transform(wireModel)

    expect(proto3).toContain('syntax = "proto3";')
    expect(proto3).toContain('message SensorReading {')
    expect(proto3).toContain('string sensorId = 1;')
    expect(proto3).toContain('message MetricBatch {')
    expect(proto3).toContain('repeated SensorReading readings = 2;')
  })

  it('F8.3: generates zero-dependency Protobuf TypeScript binary codecs', () => {
    const codec = new ProtobufCodecTargetAdapter().transform(wireModel)

    expect(codec).toContain('ProtobufCodecTargetAdapter')
    expect(codec).toContain('encodeSensorReading')
    expect(codec).toContain('decodeSensorReading')
    expect(codec).toContain('encodeMetricBatch')
  })

  it('F8.4: generates MessagePack binary codec bindings', () => {
    const msgpack = new MessagePackTargetAdapter().transform(wireModel)

    expect(msgpack).toContain('MessagePackTargetAdapter')
    expect(msgpack).toContain('messagePackAdapter')
  })

  it('F8.5: supports HTTP Accept content negotiation and enforces CSP zero-eval safety', () => {
    const mediaType = negotiateResponseMediaType('application/x-protobuf, application/json', [
      'application/json',
      'application/x-protobuf',
    ])
    expect(mediaType).toBe('application/x-protobuf')

    const codec = new ProtobufCodecTargetAdapter().transform(wireModel)
    expect(codec).not.toContain('eval(')
    expect(codec).not.toContain('new Function(')
  })
})
