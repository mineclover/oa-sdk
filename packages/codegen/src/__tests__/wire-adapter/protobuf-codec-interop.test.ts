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
  extractWireSchemaFromOas,
  Proto3TargetAdapter,
  ProtobufCodecTargetAdapter,
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
