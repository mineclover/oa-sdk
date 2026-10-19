import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, it, expect } from 'vitest'
import {
  TypeSpecWirePipeline,
  typeSpecWirePipeline,
  extractWireSchemaFromOas,
  Proto3TargetAdapter,
  ProtobufCodecTargetAdapter,
  RpcContractTargetAdapter,
  MessagePackTargetAdapter,
} from '../../wire-adapter/index.js'
import type { TypeSpecWireTargetAdapter } from '../../wire-adapter/wire-adapter-types.js'

describe('TypeSpec Wire Adapter Pipeline', () => {
  const sampleOas = {
    openapi: '3.1.0',
    info: { title: 'Order Service', version: '1.0.0' },
    paths: {
      '/orders/{orderId}': {
        get: {
          operationId: 'getOrder',
          summary: 'Get order by ID',
          'x-oa-sdk-rpc': {
            service: 'OrderService',
            method: 'GetOrder',
            clientStreaming: false,
            serverStreaming: false,
          },
          responses: {
            '200': {
              description: 'Order found',
              content: {
                'application/x-protobuf': {
                  schema: { $ref: '#/components/schemas/Order' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        OrderStatus: {
          type: 'string',
          enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED'],
        },
        Order: {
          type: 'object',
          'x-oa-sdk-protobuf': {
            messageName: 'OrderMessage',
          },
          properties: {
            id: {
              type: 'string',
              'x-oa-sdk-field': { index: 1 },
            },
            amount: {
              type: 'integer',
              format: 'int32',
              'x-oa-sdk-field': { index: 2, protoType: 'int32' },
            },
            status: {
              $ref: '#/components/schemas/OrderStatus',
              'x-oa-sdk-field': { index: 3 },
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              'x-oa-sdk-field': { index: 4 },
            },
            notes: {
              type: 'string',
              // no explicit field index -> auto-indexing fallback should assign tag 5
            },
          },
          required: ['id', 'amount'],
        },
        EmptyRequest: {
          type: 'object',
          properties: {},
        },
      },
    },
  }

  describe('extractWireSchemaFromOas', () => {
    it('extracts wire models, fields, auto-indexing, enums, and RPC services', () => {
      const model = extractWireSchemaFromOas(sampleOas)

      expect(model.title).toBe('Order Service')
      expect(model.version).toBe('1.0.0')

      // Check OrderStatus enum
      const orderStatusEnum = model.enums.find(e => e.name === 'OrderStatus')
      expect(orderStatusEnum).toBeDefined()
      expect(orderStatusEnum?.values).toEqual(['PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED'])

      // Check Order model
      const orderModel = model.models.find(m => m.name === 'Order')
      expect(orderModel).toBeDefined()
      expect(orderModel?.protobufMessageName).toBe('OrderMessage')

      // Check fields and indexing
      const fields = orderModel!.fields
      expect(fields.length).toBe(5)

      const idField = fields.find(f => f.name === 'id')
      expect(idField?.index).toBe(1)
      expect(idField?.protoType).toBe('string')
      expect(idField?.required).toBe(true)

      const amountField = fields.find(f => f.name === 'amount')
      expect(amountField?.index).toBe(2)
      expect(amountField?.protoType).toBe('int32')

      const statusField = fields.find(f => f.name === 'status')
      expect(statusField?.index).toBe(3)
      expect(statusField?.isEnum).toBe(true)
      expect(statusField?.enumRef).toBe('OrderStatus')

      const tagsField = fields.find(f => f.name === 'tags')
      expect(tagsField?.index).toBe(4)
      expect(tagsField?.repeated).toBe(true)
      expect(tagsField?.protoType).toBe('string')

      // Auto-indexed field
      const notesField = fields.find(f => f.name === 'notes')
      expect(notesField?.index).toBe(5) // next available tag index
      expect(notesField?.required).toBe(false)

      // Check RPC service extraction
      expect(model.services.length).toBe(1)
      const service = model.services[0]!
      expect(service.name).toBe('OrderService')
      expect(service.methods.length).toBe(1)
      const method = service.methods[0]!
      expect(method.name).toBe('GetOrder')
      expect(method.outputType).toBe('Order')
      expect(method.clientStreaming).toBe(false)
      expect(method.serverStreaming).toBe(false)
    })
  })

  describe('Proto3TargetAdapter', () => {
    it('generates standard proto3 file with messages, enums, and RPC services', () => {
      const model = extractWireSchemaFromOas(sampleOas)
      const adapter = new Proto3TargetAdapter({ packageName: 'commerce.order.v1' })
      const code = adapter.transform(model)

      expect(adapter.id).toBe('proto3')
      expect(adapter.fileExtension).toBe('.proto')
      expect(code).toContain('syntax = "proto3";')
      expect(code).toContain('package commerce.order.v1;')

      // Enum rendering
      expect(code).toContain('enum OrderStatus {')
      expect(code).toContain('PENDING = 0;')
      expect(code).toContain('PROCESSING = 1;')

      // Message rendering
      expect(code).toContain('message OrderMessage {')
      expect(code).toContain('string id = 1;')
      expect(code).toContain('int32 amount = 2;')
      expect(code).toContain('OrderStatus status = 3;')
      expect(code).toContain('repeated string tags = 4;')
      expect(code).toContain('string notes = 5;')

      // Service rendering
      expect(code).toContain('service OrderService {')
      // Services reference the emitted message name, not the schema name.
      expect(code).toContain('rpc GetOrder (Empty) returns (OrderMessage);')
    })
  })

  describe('ProtobufCodecTargetAdapter', () => {
    it('generates zero-eval TypeScript binary codecs for protobuf encoding and decoding', () => {
      const model = extractWireSchemaFromOas(sampleOas)
      const adapter = new ProtobufCodecTargetAdapter()
      const code = adapter.transform(model)

      expect(adapter.id).toBe('protobuf-codec')
      expect(adapter.fileExtension).toBe('.ts')

      // Pure TypeScript binary encoders/decoders
      expect(code).toContain('function __writeVarint')
      expect(code).toContain('function __readVarint')
      expect(code).toContain('export const orderProtobufCodec: BinaryCodecAdapter<Order>')
      expect(code).toContain('export function encodeOrder(payload: Order): Uint8Array')
      expect(code).toContain('export function decodeOrder(raw: ArrayBufferLike | Uint8Array): Order')
    })
  })

  describe('RpcContractTargetAdapter', () => {
    it('generates server handler contracts and client SDK interfaces', () => {
      const model = extractWireSchemaFromOas(sampleOas)
      const adapter = new RpcContractTargetAdapter()
      const code = adapter.transform(model, { typesImport: './types.js' })

      expect(adapter.id).toBe('rpc-contract')
      expect(adapter.fileExtension).toBe('.ts')

      // Server contract
      expect(code).toContain('export interface OrderServiceServerHandlers')
      expect(code).toContain('export type OrderServiceHandler')
      // The undeclared {orderId} route variable still becomes a required parameter.
      expect(code).toContain('export interface OrderServiceGetOrderParams {')
      expect(code).toContain('getOrder(request: void, context: TContext, params: OrderServiceGetOrderParams): Promise<Order> | Order')

      // Client interface
      expect(code).toContain('export class OrderServiceRpcClient')
      expect(code).toContain('async getOrder(params: OrderServiceGetOrderParams, options?: WireRpcCallOptions): Promise<Order>')
    })
  })

  describe('MessagePackTargetAdapter', () => {
    it('generates MessagePack codec adapters for compact binary wire format', () => {
      const model = extractWireSchemaFromOas(sampleOas)
      const adapter = new MessagePackTargetAdapter()
      const code = adapter.transform(model)

      expect(adapter.id).toBe('messagepack')
      expect(adapter.fileExtension).toBe('.ts')
      expect(code).toContain('export const orderMessagePackCodec: BinaryCodecAdapter<Order>')
      expect(code).toContain('getGeneratedMessagePackCodecs()')
    })
  })

  describe('TypeSpecWirePipeline (Pluggable Target Adapter Pattern)', () => {
    it('executes transformations across all registered targets', async () => {
      const pipeline = new TypeSpecWirePipeline()
      expect(pipeline.hasAdapter('proto3')).toBe(true)
      expect(pipeline.hasAdapter('protobuf-codec')).toBe(true)
      expect(pipeline.hasAdapter('rpc-contract')).toBe(true)
      expect(pipeline.hasAdapter('messagepack')).toBe(true)

      const bundle = await pipeline.transformAll(sampleOas)
      expect(bundle.proto3).toBeDefined()
      expect(bundle.protobufCodec).toBeDefined()
      expect(bundle.rpcContract).toBeDefined()
      expect(bundle.messagepack).toBeDefined()

      expect(bundle.proto3).toContain('syntax = "proto3";')
      expect(bundle.protobufCodec).toContain('orderProtobufCodec')
      expect(bundle.rpcContract).toContain('OrderServiceHandler')
      expect(bundle.messagepack).toContain('orderMessagePackCodec')
    })

    it('supports custom pluggable adapters', async () => {
      const customAdapter: TypeSpecWireTargetAdapter<string> = {
        id: 'custom-summary',
        name: 'custom-summary',
        target: 'summary',
        fileExtension: '.json',
        transform: (model) => JSON.stringify({
          modelCount: model.models.length,
          serviceCount: model.services.length,
        }),
      }

      const pipeline = new TypeSpecWirePipeline()
      pipeline.registerAdapter(customAdapter)

      expect(pipeline.hasAdapter('custom-summary')).toBe(true)

      const result = await pipeline.transform<string>(sampleOas, 'custom-summary')
      const parsed = JSON.parse(result)
      expect(parsed.modelCount).toBe(2)
      expect(parsed.serviceCount).toBe(1)
    })
  })
})

describe('Default wire service and method names', () => {
  // TypeSpec names interface operations `Interface_op` and gives them no tag.
  const interfaceOas = {
    openapi: '3.1.0',
    info: { title: 'Order Service', version: '1.0.0' },
    paths: {
      '/widgets': { get: { operationId: 'Widgets_list', responses: { '200': { description: 'ok' } } } },
      '/widgets/{id}': { get: { operationId: 'Widgets_read', responses: { '200': { description: 'ok' } } } },
      '/items': { get: { operationId: 'listItems', tags: ['order_items'], responses: { '200': { description: 'ok' } } } },
    },
    components: { schemas: {} },
  }

  it('PascalCases operationIds, tags, and the title across underscores', () => {
    const model = extractWireSchemaFromOas(interfaceOas)
    expect(model.services.map(service => [service.name, service.methods.map(method => method.name)])).toEqual([
      ['OrderServiceService', ['WidgetsList', 'WidgetsRead']],
      ['OrderItemsService', ['ListItems']],
    ])

    const proto = new Proto3TargetAdapter().transform(model)
    expect(proto).toContain('rpc WidgetsList (Empty) returns (Empty);')
    const rpc = new RpcContractTargetAdapter().transform(model)
    expect(rpc).toContain('async widgetsList(options?: WireRpcCallOptions): Promise<void>')
    expect(rpc).toContain("const method = 'OrderServiceService.WidgetsList'")
  })
})

describe('Proto3TargetAdapter constructor options', () => {
  it('honors emitEmptyMessage given to the constructor', () => {
    const model = { name: 'x', package: 'x.v1', models: [], enums: [], services: [] }
    expect(new Proto3TargetAdapter({ emitEmptyMessage: true }).transform(model)).toContain('message Empty {}')
    expect(new Proto3TargetAdapter().transform(model, { emitEmptyMessage: true })).toContain('message Empty {}')
    expect(new Proto3TargetAdapter().transform(model)).not.toContain('message Empty {}')
  })
})

describe('TypeSpecWirePipeline TypeSpec input', () => {
  const workspaceRoot = resolve(import.meta.dirname, '../../../../..')
  const root = mkdtempSync(join(tmpdir(), 'oa-sdk-wire-pipeline-input-'))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(workspaceRoot, 'node_modules', '@typespec'), join(root, 'node_modules', '@typespec'), 'dir')

  afterAll(() => rmSync(root, { recursive: true, force: true }))

  const source = `import "@typespec/http";
using Http;

@service(#{ title: "Shop" })
namespace Shop;

model Resource { id: string; createdAt: utcDateTime; }
model Order extends Resource { amount: int32; }

interface Orders {
  @get @route("/orders/{id}") read(@path id: string): Order;
}
`

  /** Writes `main.tsp` under a directory whose name holds a word the old source check looked for. */
  const fixture = (directory: string): string => {
    mkdirSync(join(root, directory), { recursive: true })
    const path = join(root, directory, 'main.tsp')
    writeFileSync(path, source)
    return path
  }

  it.each(['models', 'order-service', 'namespace'])('compiles a path under %s/ as a file', async directory => {
    const model = await new TypeSpecWirePipeline().extractModel(fixture(directory))
    // `extends` keeps the inherited fields in the wire message.
    expect(model.models.find(m => m.name === 'Order')?.fields.map(f => f.name)).toEqual(['id', 'createdAt', 'amount'])
    expect(model.services.flatMap(service => service.methods.map(method => [method.name, method.outputType]))).toEqual([['OrdersRead', 'Order']])
  }, 120_000)

  it('compiles one-line source without a model, namespace, or service keyword', async () => {
    const model = await new TypeSpecWirePipeline().extractModel('op ping(): void;')
    expect(model.services.flatMap(service => service.methods.map(method => method.name))).toEqual(['Ping'])
  }, 120_000)

  it('takes the input kind as given with the explicit methods', async () => {
    const pipeline = new TypeSpecWirePipeline()
    const fromFile = await pipeline.extractModelFromFile(fixture('explicit'))
    expect(fromFile.models.map(m => m.name)).toEqual(['Resource', 'Order'])
    const fromSource = await pipeline.extractModelFromSource('model Pet { name: string; }')
    expect(fromSource.models.map(m => m.name)).toEqual(['Pet'])
  }, 120_000)
})
