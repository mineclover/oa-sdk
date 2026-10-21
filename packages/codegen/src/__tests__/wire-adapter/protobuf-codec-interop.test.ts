import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import protobuf from 'protobufjs'
import ts from 'typescript'
import { parse as parseYaml } from 'yaml'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import {
  emptyMessageName,
  extractWireSchemaFromOas,
  MessagePackTargetAdapter,
  Proto3TargetAdapter,
  ProtobufCodecTargetAdapter,
  RpcContractTargetAdapter,
  type WireModel,
  type WireNameScope,
} from '../../wire-adapter/index.js'

const workspaceRoot = resolve(import.meta.dirname, '../../../../..')
const tmpDirs: string[] = []

afterAll(() => {
  for (const directory of tmpDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const field = (index: number, type?: string) => ({ 'x-oa-sdk-protobuf-field': { index, ...(type ? { type } : {}) } })
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })

/** Every wire shape the codec supports. */
const shapesDocument = {
  openapi: '3.1.0',
  info: { title: 'Shapes', version: '1.0.0' },
  paths: {},
  components: {
    schemas: {
      Color: { type: 'string', enum: ['red', 'green', 'blue'] },
      Priority: { type: 'integer', enum: [10, 20, 30] },
      Point: {
        type: 'object',
        required: ['x', 'y'],
        properties: { x: { type: 'number', format: 'double', ...field(1) }, y: { type: 'number', format: 'double', ...field(2) } },
      },
      Tree: {
        type: 'object',
        required: ['label', 'children'],
        properties: {
          label: { type: 'string', ...field(1) },
          children: { type: 'array', items: ref('Tree'), ...field(2) },
        },
      },
      Everything: {
        type: 'object',
        required: ['name', 'tags', 'scores'],
        properties: {
          name: { type: 'string', ...field(1) },
          int32: { type: 'integer', format: 'int32', ...field(2) },
          int64: { type: 'integer', format: 'int64', ...field(3) },
          uint32: { type: 'integer', format: 'uint32', ...field(4) },
          uint64: { type: 'integer', format: 'uint64', ...field(5) },
          sint32: { type: 'integer', ...field(6, 'sint32') },
          sint64: { type: 'integer', ...field(7, 'sint64') },
          fixed32: { type: 'integer', ...field(8, 'fixed32') },
          fixed64: { type: 'integer', ...field(9, 'fixed64') },
          sfixed32: { type: 'integer', ...field(10, 'sfixed32') },
          sfixed64: { type: 'integer', ...field(11, 'sfixed64') },
          float: { type: 'number', format: 'float', ...field(12) },
          double: { type: 'number', ...field(13) },
          flag: { type: 'boolean', ...field(14) },
          raw: { type: 'string', format: 'binary', ...field(15) },
          encoded: { type: 'string', format: 'byte', ...field(16) },
          color: { ...ref('Color'), ...field(17) },
          priority: { ...ref('Priority'), ...field(18) },
          origin: { ...ref('Point'), ...field(19) },
          path: { type: 'array', items: ref('Point'), ...field(20) },
          tags: { type: 'array', items: { type: 'string' }, ...field(21) },
          scores: { type: 'array', items: { type: 'integer', format: 'int32' }, ...field(22) },
          colors: { type: 'array', items: ref('Color'), ...field(23) },
          counts: { type: 'object', additionalProperties: { type: 'integer', format: 'int64' }, ...field(24) },
          places: { type: 'object', additionalProperties: ref('Point'), ...field(25) },
          attributes: { type: 'object', properties: { a: { type: 'string' } }, ...field(26) },
          choice: { oneOf: [{ type: 'string' }, { type: 'integer' }], ...field(27) },
          matrix: { type: 'array', items: { type: 'array', items: { type: 'number' } }, ...field(28) },
          tree: { ...ref('Tree'), ...field(29) },
          nothing: { type: 'array', items: { type: 'string' }, ...field(30) },
        },
      },
    },
  },
} as unknown as OasDocument

const everything = {
  name: 'héllo ✓ 世界',
  int32: -2147483648,
  int64: 9007199254740993n,
  uint32: 4294967295,
  uint64: 18446744073709551615n,
  sint32: -123456,
  sint64: -9007199254740991,
  fixed32: 4000000000,
  fixed64: 123,
  sfixed32: -5,
  sfixed64: -6,
  float: 1.5,
  double: Math.PI,
  flag: false,
  raw: new Uint8Array([0, 1, 254, 255]),
  encoded: 'AAH+/w==',
  color: 'blue',
  priority: 20,
  origin: { x: 0, y: -1.25 },
  path: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
  tags: ['a', '', 'c'],
  scores: [1, -1, 300, 0],
  colors: ['green', 'red'],
  counts: { apples: 3, huge: -9007199254740991 },
  places: { home: { x: 1, y: 1 } },
  attributes: { a: 'x', nested: { deep: [1, null] } },
  choice: 42,
  matrix: [[1, 2], [], [3.5]],
  tree: { label: 'root', children: [{ label: 'leaf', children: [] }] },
}

type Codecs = Record<string, any>

/** Generates the codec module and the .proto schema for a document. */
async function generate(document: OasDocument): Promise<{ codecs: Codecs; root: protobuf.Root; packageName: string }> {
  const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-protobuf-interop-'))
  tmpDirs.push(directory)
  const model = extractWireSchemaFromOas(document)
  const source = new ProtobufCodecTargetAdapter().transform(model)
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const file = join(directory, 'codecs.mjs')
  writeFileSync(file, output)
  const packageName = 'interop.v1'
  const proto = new Proto3TargetAdapter({ packageName, includeServices: false }).transform(model)
  return {
    codecs: await import(pathToFileURL(file).href),
    root: protobuf.parse(proto, { keepCase: true }).root,
    packageName,
  }
}

describe('ProtobufCodecTargetAdapter wire compatibility', () => {
  let codecs: Codecs
  let root: protobuf.Root
  let Everything: protobuf.Type

  beforeAll(async () => {
    const generated = await generate(shapesDocument)
    codecs = generated.codecs
    root = generated.root
    Everything = root.lookupType(`${generated.packageName}.Everything`)
  })

  it('round-trips every supported shape', () => {
    const bytes = codecs.encodeEverything(everything)
    expect(codecs.decodeEverything(bytes)).toEqual(everything)
  })

  it('writes bytes that protobufjs decodes with the generated .proto', () => {
    const decoded = Everything.toObject(Everything.decode(codecs.encodeEverything(everything)), {
      longs: String,
      enums: Number,
      bytes: Array,
    })

    expect(decoded).toMatchObject({
      name: everything.name,
      int32: everything.int32,
      int64: '9007199254740993',
      uint32: everything.uint32,
      uint64: '18446744073709551615',
      sint32: everything.sint32,
      sint64: '-9007199254740991',
      fixed32: everything.fixed32,
      fixed64: '123',
      sfixed32: -5,
      sfixed64: '-6',
      float: 1.5,
      double: Math.PI,
      raw: [0, 1, 254, 255],
      encoded: [0, 1, 254, 255],
      color: 2,
      priority: 1,
      origin: { x: 0, y: -1.25 },
      path: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
      tags: ['a', '', 'c'],
      scores: [1, -1, 300, 0],
      colors: [1, 0],
      counts: { apples: '3', huge: '-9007199254740991' },
      places: { home: { x: 1, y: 1 } },
      tree: { label: 'root', children: [{ label: 'leaf' }] },
    })
    expect(JSON.parse(decoded.attributes)).toEqual(everything.attributes)
    expect(JSON.parse(decoded.choice)).toBe(42)
    expect(JSON.parse(decoded.matrix)).toEqual(everything.matrix)
  })

  it('reads bytes that protobufjs writes, packed or not', () => {
    const message = Everything.fromObject({
      name: 'from protobufjs',
      int64: '-42',
      uint64: '18446744073709551615',
      sint32: -7,
      fixed64: '99',
      flag: true,
      color: 1,
      origin: { x: 5, y: 6 },
      tags: ['x'],
      scores: [5, -5],
      colors: [2, 2],
      counts: { a: '1' },
      places: { p: { x: 9, y: 8 } },
      tree: { label: 't', children: [] },
    })
    const bytes = Everything.encode(message).finish()
    expect(codecs.decodeEverything(bytes)).toEqual({
      name: 'from protobufjs',
      int64: -42,
      uint64: 18446744073709551615n,
      sint32: -7,
      fixed64: 99,
      flag: true,
      color: 'green',
      origin: { x: 5, y: 6 },
      tags: ['x'],
      scores: [5, -5],
      colors: ['blue', 'blue'],
      counts: { a: 1 },
      places: { p: { x: 9, y: 8 } },
      // A message protobufjs omits its empty repeated field from comes back with it, because it is required.
      tree: { label: 't', children: [] },
    })

    // Unpacked repeated scalars, as proto2 writers and some proto3 writers send them.
    // Field 22, wire type 0: the tag 176 is the two-byte varint 0xb0 0x01.
    const unpacked: number[] = []
    for (const score of [7, 8]) unpacked.push(0xb0, 0x01, score)
    expect(codecs.decodeEverything(new Uint8Array(unpacked)).scores).toEqual([7, 8])
  })

  it('skips unknown fields and rejects malformed input', () => {
    const known = codecs.encodePoint({ x: 1, y: 2 })
    const withUnknown = new Uint8Array([...known, (99 << 3) | 2, 2, 0xff, 0xff, (100 << 3) | 0, 1])
    expect(codecs.decodePoint(withUnknown)).toEqual({ x: 1, y: 2 })

    expect(() => codecs.decodePoint(new Uint8Array([(1 << 3) | 1, 0, 0]))).toThrow(RangeError)
    expect(() => codecs.encodeEverything({ ...everything, int32: 2 ** 31 })).toThrow(RangeError)
    expect(() => codecs.encodeEverything({ ...everything, int32: 1.5 })).toThrow(TypeError)
    expect(() => codecs.encodeEverything({ ...everything, color: 'purple' })).toThrow('not a member of enum Color')
  })

  it('does not let decoded map keys change object prototypes', () => {
    // A map entry keyed "__proto__", as a hostile peer could send it.
    const bytes = codecs.encodeEverything({ name: 'n', tags: [], scores: [], counts: JSON.parse('{"__proto__":1}') })
    const decoded = codecs.decodeEverything(bytes)

    expect(Object.getPrototypeOf(decoded.counts)).toBe(Object.prototype)
    expect(Object.hasOwn(decoded.counts, '__proto__')).toBe(true)
  })
})

describe('ProtobufCodecTargetAdapter generated source', () => {
  it('type-checks under strict settings, including its inline model interfaces', () => {
    const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-protobuf-types-'))
    tmpDirs.push(directory)
    const codecTypes = join(workspaceRoot, 'packages', 'client', 'src', 'codec', 'codec-types')
    const source = new ProtobufCodecTargetAdapter()
      .transform(extractWireSchemaFromOas(shapesDocument))
      .replace("from '@oa-sdk/client'", `from ${JSON.stringify(codecTypes)}`)
    writeFileSync(join(directory, 'codecs.ts'), source)
    const program = ts.createProgram([join(directory, 'codecs.ts')], {
      strict: true,
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
      noEmit: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
      types: [],
    })
    const diagnostics = ts.getPreEmitDiagnostics(program, program.getSourceFile(join(directory, 'codecs.ts')))
      .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))

    expect(diagnostics).toEqual([])
    expect(source).toContain("export interface Everything {")
    expect(source).toContain("'color'?: \"red\" | \"green\" | \"blue\"")
    expect(source).toContain("'counts'?: Record<string, number | bigint>")
  })
})

describe('ProtobufCodecTargetAdapter on the production contract', () => {
  it('round-trips every schema example and stays smaller than JSON', async () => {
    const specPath = join(workspaceRoot, 'packages', 'schemas', 'src', '.merged.yaml')
    const document = parseYaml(readFileSync(specPath, 'utf8')) as OasDocument & { components: { schemas: Record<string, any> } }
    const { codecs, root, packageName } = await generate(document)

    const examples = Object.entries(document.components.schemas)
      .map(([name, schema]) => [name, schema.examples?.[0] ?? schema.example] as const)
      .filter(([name, example]) => example && typeof example === 'object' && !Array.isArray(example) && typeof codecs[`encode${name}`] === 'function')
    expect(examples.length).toBeGreaterThanOrEqual(15)

    const failures: string[] = []
    let jsonBytes = 0
    let protobufBytes = 0
    for (const [name, example] of examples) {
      const bytes = codecs[`encode${name}`](example) as Uint8Array
      if (!isDeepStrictEqual(codecs[`decode${name}`](bytes), example)) failures.push(name)
      // The generated .proto must describe the same bytes.
      root.lookupType(`${packageName}.${name}`).decode(bytes)
      jsonBytes += new TextEncoder().encode(JSON.stringify(example)).length
      protobufBytes += bytes.length
    }

    expect(failures).toEqual([])
    expect(protobufBytes).toBeLessThan(jsonBytes)
  })
})

describe('Wire messages built from allOf (TypeSpec `extends`)', () => {
  const inheritanceDocument = {
    openapi: '3.1.0',
    info: { title: 'Orders', version: '1.0.0' },
    paths: {},
    components: {
      schemas: {
        Resource: {
          type: 'object',
          required: ['id', 'createdAt'],
          properties: { id: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } },
        },
        // TypeSpec: model Order extends Resource { amount: int32 }
        Order: {
          type: 'object',
          required: ['amount'],
          properties: { amount: { type: 'integer', format: 'int32' } },
          allOf: [ref('Resource')],
        },
        // Two levels, an inline member, an overriding own property, and an explicit number.
        Audited: {
          type: 'object',
          required: ['auditor'],
          properties: { auditor: { type: 'string', ...field(1) }, amount: { type: 'integer', format: 'int64' } },
          allOf: [ref('Order'), { type: 'object', properties: { note: { type: 'string' } } }],
        },
        Holder: { type: 'object', properties: { order: ref('Order') } },
        // A cyclic allOf terminates and keeps both sides' fields.
        Loop: { type: 'object', properties: { a: { type: 'string' } }, allOf: [ref('Pool')] },
        Pool: { type: 'object', properties: { b: { type: 'string' } }, allOf: [ref('Loop')] },
        // A member that is not an object cannot be a message; the value travels as JSON.
        Mixed: { type: 'object', properties: { c: { type: 'string' } }, allOf: [{ oneOf: [{ type: 'string' }, { type: 'integer' }] }] },
      },
    },
  } as unknown as OasDocument

  it('includes inherited fields, base fields first, in the model, the .proto, and the codec', async () => {
    const model = extractWireSchemaFromOas(inheritanceDocument)
    const fieldsOf = (name: string) => model.models.find(m => m.name === name)?.fields.map(f => [f.name, f.index, f.required])

    expect(fieldsOf('Order')).toEqual([['id', 1, true], ['createdAt', 2, true], ['amount', 3, true]])
    // `auditor` keeps its explicit number 1; the rest take free numbers in flattened order.
    expect(fieldsOf('Audited')).toEqual([
      ['auditor', 1, true], ['id', 2, true], ['createdAt', 3, true], ['amount', 4, true], ['note', 5, false],
    ])
    expect(model.models.find(m => m.name === 'Audited')?.fields.find(f => f.name === 'amount')?.type).toBe('int64')
    expect(fieldsOf('Loop')).toEqual([['b', 1, false], ['a', 2, false]])
    expect(model.models.find(m => m.name === 'Mixed')).toMatchObject({ kind: 'object', fields: [] })
    expect(model.models.find(m => m.name === 'Holder')?.fields[0]).toMatchObject({ kind: 'message', type: 'Order' })

    const { codecs, root, packageName } = await generate(inheritanceDocument)
    const order = { id: 'o-1', createdAt: '2026-10-19T00:00:00Z', amount: 7 }
    expect(codecs.decodeOrder(codecs.encodeOrder(order))).toEqual(order)
    expect(codecs.decodeHolder(codecs.encodeHolder({ order }))).toEqual({ order })

    const Order = root.lookupType(`${packageName}.Order`)
    expect(Object.keys(Order.fields)).toEqual(['id', 'createdAt', 'amount'])
    expect(Order.toObject(Order.decode(codecs.encodeOrder(order)))).toEqual(order)
    expect(codecs.decodeOrder(Order.encode(Order.fromObject(order)).finish())).toEqual(order)
  })

  it('rejects explicit field numbers that collide, including across inheritance', () => {
    const withFields = (schemas: Record<string, unknown>) => ({ ...inheritanceDocument, components: { schemas } }) as unknown as OasDocument
    expect(() => extractWireSchemaFromOas(withFields({
      Widget: { type: 'object', properties: { id: { type: 'integer', ...field(1) }, name: { type: 'string', ...field(1) } } },
    }))).toThrow('Duplicate protobuf field number 1 in Widget: "id" and "name" both use it.')
    expect(() => extractWireSchemaFromOas(withFields({
      Base: { type: 'object', properties: { id: { type: 'string', ...field(2) } } },
      Child: { type: 'object', properties: { code: { type: 'string', ...field(2) } }, allOf: [ref('Base')] },
    }))).toThrow('Duplicate protobuf field number 2 in Child: "id" and "code" both use it.')
    for (const index of [0, 1.5, 19000, 536870912]) {
      expect(() => extractWireSchemaFromOas(withFields({
        Widget: { type: 'object', properties: { id: { type: 'string', ...field(index) } } },
      }))).toThrow(`Invalid protobuf field number ${index} for "id" in Widget`)
    }
  })
})

describe('Map-only and free-form object components', () => {
  const recordsDocument = {
    openapi: '3.1.0',
    info: { title: 'Records', version: '1.0.0' },
    paths: {
      '/labels': {
        post: {
          operationId: 'setLabels',
          requestBody: { required: true, content: { 'application/x-protobuf': { schema: ref('Labels') } } },
          responses: { '200': { description: 'ok', content: { 'application/x-protobuf': { schema: ref('Labels') } } } },
        },
      },
      '/color': {
        put: {
          operationId: 'setColor',
          requestBody: { required: true, content: { 'application/x-protobuf': { schema: ref('Color') } } },
          responses: { '204': { description: 'set' } },
        },
      },
      '/priority': {
        put: {
          operationId: 'setPriority',
          requestBody: { required: true, content: { 'application/x-protobuf': { schema: ref('Priority') } } },
          responses: { '204': { description: 'set' } },
        },
      },
    },
    components: {
      schemas: {
        Color: { type: 'string', enum: ['red', 'green'] },
        Priority: { type: 'integer', enum: [10, 20] },
        // TypeSpec: model Attributes is Record<unknown>; model Labels is Record<string>
        Attributes: { type: 'object', additionalProperties: {} },
        Open: { type: 'object', additionalProperties: true },
        Labels: { type: 'object', additionalProperties: { type: 'string' } },
        Blank: { type: 'object' },
        Item: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            attributes: ref('Attributes'),
            open: ref('Open'),
            labels: ref('Labels'),
            blank: ref('Blank'),
          },
        },
      },
    },
  } as unknown as OasDocument

  it('sends a referenced map-only component as a map and a free-form one as JSON', async () => {
    const model = extractWireSchemaFromOas(recordsDocument)
    expect(model.models.map(m => [m.name, m.kind])).toEqual([
      ['Attributes', 'object'], ['Open', 'object'], ['Labels', 'object'], ['Blank', 'message'], ['Item', 'message'],
    ])
    expect(model.models.find(m => m.name === 'Item')?.fields.map(f => [f.name, f.kind, f.mapValue?.type ?? f.type])).toEqual([
      ['name', 'scalar', 'string'],
      ['attributes', 'json', 'string'],
      ['open', 'json', 'string'],
      ['labels', 'map', 'string'],
      ['blank', 'message', 'Blank'],
    ])

    const { codecs, root, packageName } = await generate(recordsDocument)
    const item = { name: 'n', attributes: { color: 'red', size: 3 }, open: { nested: [true] }, labels: { a: 'b', c: '' }, blank: {} }
    expect(codecs.decodeItem(codecs.encodeItem(item))).toEqual(item)
    const Item = root.lookupType(`${packageName}.Item`)
    expect(Item.toObject(Item.decode(codecs.encodeItem(item))).labels).toEqual({ a: 'b', c: '' })
    expect(Object.keys(codecs.getGeneratedProtobufCodecs())).toEqual(['Blank', 'Item'])
  })

  it('emits no empty message or Protobuf codec for them and names no undefined message in the service', () => {
    const model = extractWireSchemaFromOas(recordsDocument)
    const proto = new Proto3TargetAdapter({ packageName: 'records.v1' }).transform(model)
    const method = model.services[0]!.methods[0]!

    expect(proto).not.toMatch(/message (Labels|Attributes|Open) \{/)
    expect(proto).toContain('map<string, string> labels = 4;')
    expect(method).toMatchObject({ inputType: 'Empty', outputType: 'Empty', requestBody: { typeName: 'Labels' } })
    expect(proto).toContain('rpc SetLabels (Empty) returns (Empty);')
    expect(() => protobuf.parse(proto)).not.toThrow()

    // They keep their TypeScript type and their schema-less MessagePack codec.
    expect(new ProtobufCodecTargetAdapter().transform(model)).not.toContain('labelsProtobufCodec')
    expect(new MessagePackTargetAdapter().transform(model)).toContain('export const labelsMessagePackCodec: BinaryCodecAdapter<Labels>')
    expect(new RpcContractTargetAdapter().transform(model, { typesImport: './types.js' }))
      .toContain('async setLabels(request: Labels, options?: WireRpcCallOptions): Promise<Labels>')
  })

  it('fails a Protobuf call with such a body for want of a codec instead of sending nothing', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-protobuf-records-rpc-'))
    tmpDirs.push(directory)
    const model = extractWireSchemaFromOas(recordsDocument)
    const file = join(directory, 'rpc.mjs')
    const source = new RpcContractTargetAdapter().transform(model)
    writeFileSync(file, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
    const rpc = await import(pathToFileURL(file).href)
    const { codecs } = await generate(recordsDocument)
    const sent: unknown[] = []
    const client = new rpc.RecordsServiceRpcClient({
      baseUrl: 'https://records.test',
      codecs: codecs.getGeneratedProtobufCodecs(),
      fetch: async (...args: unknown[]) => { sent.push(args); return new Response(null, { status: 204 }) },
    })

    await expect(client.setLabels({ a: 'b' })).rejects.toThrow('needs a codec for Labels (application/x-protobuf)')
    // No codec takes a bare enum or scalar either; only a string body goes out, as its text.
    await expect(client.setPriority(10)).rejects.toThrow('RPC call RecordsService.SetPriority needs a codec for its request (application/x-protobuf)')
    expect(sent).toEqual([])
    await client.setColor('red')
    const [url, init] = sent[0] as [string, RequestInit]
    expect([url, init.body]).toEqual(['https://records.test/color', 'red'])
  })
})

describe('Required fields a standard proto3 encoder leaves off the wire', () => {
  const todoDocument = {
    openapi: '3.1.0',
    info: { title: 'Todos', version: '1.0.0' },
    paths: {},
    components: {
      schemas: {
        Status: { type: 'string', enum: ['active', 'archived'] },
        Todo: {
          type: 'object',
          required: ['id', 'title', 'done', 'status', 'count', 'raw', 'encoded', 'tags'],
          properties: {
            id: { type: 'integer', format: 'int32' },
            title: { type: 'string' },
            done: { type: 'boolean' },
            status: ref('Status'),
            count: { type: 'integer', format: 'int64' },
            raw: { type: 'string', format: 'binary' },
            encoded: { type: 'string', format: 'byte' },
            tags: { type: 'array', items: { type: 'string' } },
            note: { type: 'string' },
          },
        },
      },
    },
  } as unknown as OasDocument

  const defaults = { id: 0, title: '', done: false, status: 'active', count: 0, raw: new Uint8Array(), encoded: '', tags: [] }

  it('decodes them to their proto3 defaults and leaves optional ones absent', async () => {
    const { codecs, root, packageName } = await generate(todoDocument)
    const Todo = root.lookupType(`${packageName}.Todo`)

    // A message holding only defaults is zero bytes from protoc, Go, Java, protobuf-es, ...
    expect(codecs.decodeTodo(new Uint8Array())).toEqual(defaults)
    expect(codecs.decodeTodo(Todo.encode(Todo.create({})).finish())).toEqual(defaults)
    // id: 7, done: true; title and status stay at their defaults, so they are not on the wire.
    expect(codecs.decodeTodo(new Uint8Array([0x08, 0x07, 0x18, 0x01]))).toEqual({ ...defaults, id: 7, done: true })
    // Values on the wire still win over the defaults.
    const todo = { ...defaults, id: -1, title: 't', status: 'archived', count: 2n ** 60n, raw: new Uint8Array([1]), encoded: 'AQ==', tags: ['x'], note: 'n' }
    expect(codecs.decodeTodo(codecs.encodeTodo(todo))).toEqual(todo)
  })
})

describe('A user model named Empty', () => {
  /** A bodiless `ping` and an `echo` whose body and response are the user's `Empty`. */
  const notesDocument = (schemas: Record<string, unknown>) => ({
    openapi: '3.1.0',
    info: { title: 'Notes', version: '1.0.0' },
    paths: {
      '/ping': { get: { operationId: 'ping', responses: { '204': { description: 'pong' } } } },
      '/echo': {
        post: {
          operationId: 'echo',
          requestBody: { required: true, content: { 'application/x-protobuf': { schema: ref('Empty') } } },
          responses: { '200': { description: 'ok', content: { 'application/x-protobuf': { schema: ref('Empty') } } } },
        },
      },
    },
    components: { schemas },
  }) as unknown as OasDocument

  const cases = [
    { label: 'with fields', schemas: { Empty: { type: 'object', properties: { note: { type: 'string' } } } }, message: 'Empty', synthetic: 'Empty2', fields: ['note'] },
    // TypeSpec: model Empty {}
    { label: 'as a closed `type: object`', schemas: { Empty: { type: 'object' } }, message: 'Empty', synthetic: 'Empty2', fields: [] },
    {
      label: 'renamed by messageName, next to a model named Empty2',
      schemas: {
        Empty: { type: 'object', properties: { note: { type: 'string' } }, 'x-oa-sdk-protobuf': { messageName: 'Note' } },
        Empty2: { type: 'object', properties: { id: { type: 'string' } } },
      },
      message: 'Note',
      synthetic: 'Empty3',
      fields: ['note'],
    },
  ]

  it.each(cases)('keeps it apart from the empty message of bodiless methods ($label)', ({ schemas, message, synthetic, fields }) => {
    const model = extractWireSchemaFromOas(notesDocument(schemas))
    const methods = Object.fromEntries(model.services.flatMap(service => service.methods).map(method => [method.name, method]))
    expect(emptyMessageName(model)).toBe(synthetic)
    expect(methods.Ping).toMatchObject({ inputType: synthetic, outputType: synthetic })
    expect(methods.Echo).toMatchObject({ inputType: 'Empty', outputType: 'Empty' })

    const proto = new Proto3TargetAdapter({ packageName: 'notes.v1' }).transform(model)
    expect(proto).toContain(`message ${synthetic} {}`)
    const root = protobuf.parse(proto, { keepCase: true }).root
    const service = root.lookupService('notes.v1.NotesService')
    expect([service.methods.Ping?.requestType, service.methods.Ping?.responseType]).toEqual([synthetic, synthetic])
    expect([service.methods.Echo?.requestType, service.methods.Echo?.responseType]).toEqual([message, message])
    expect(Object.keys(root.lookupType(`notes.v1.${message}`).fields)).toEqual(fields)
    expect(Object.keys(root.lookupType(`notes.v1.${synthetic}`).fields)).toEqual([])

    const rpc = new RpcContractTargetAdapter().transform(model, { typesImport: './types.js' })
    expect(rpc).toContain('async ping(options?: WireRpcCallOptions): Promise<void> {')
    expect(rpc).toContain('ping(request: void, context: TContext): Promise<void> | void')
    expect(rpc).toContain('async echo(request: Empty, options?: WireRpcCallOptions): Promise<Empty> {')
  })

  it('encodes the user model with its own fields', async () => {
    const { codecs, root, packageName } = await generate(notesDocument(cases[0]!.schemas))
    const Empty = root.lookupType(`${packageName}.Empty`)
    expect(codecs.decodeEmpty(codecs.encodeEmpty({ note: 'hi' }))).toEqual({ note: 'hi' })
    expect(codecs.decodeEmpty(Empty.encode(Empty.fromObject({ note: 'hi' })).finish())).toEqual({ note: 'hi' })
  })

  it('names the empty message apart from every model, message, enum, and service name', () => {
    const scope = (names: { models?: Omit<WireModel, 'fields'>[]; enums?: string[]; services?: string[] }): WireNameScope => ({
      models: (names.models ?? []).map(entity => ({ ...entity, fields: [] })),
      enums: (names.enums ?? []).map(name => ({ name, members: [] })),
      services: (names.services ?? []).map(name => ({ name })),
    })
    expect(emptyMessageName(scope({}))).toBe('Empty')
    expect(emptyMessageName(scope({ models: [{ name: 'Inventory.Empty' }], enums: ['EmptyKind'], services: ['EmptyService'] }))).toBe('Empty')
    expect(emptyMessageName(scope({ enums: ['Empty'] }))).toBe('Empty2')
    expect(emptyMessageName(scope({ services: ['Empty'] }))).toBe('Empty2')
    expect(emptyMessageName(scope({ models: [{ name: 'Thing', messageName: 'Empty' }] }))).toBe('Empty2')
    expect(emptyMessageName(scope({ models: [{ name: 'Empty', kind: 'object' }, { name: 'Empty2' }] }))).toBe('Empty3')
  })
})
