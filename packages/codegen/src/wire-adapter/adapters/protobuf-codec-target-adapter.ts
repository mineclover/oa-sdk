/**
 * Protobuf Codec Target Adapter
 *
 * Emits pure TypeScript, zero-dependency BinaryCodecAdapter implementations
 * for WireSchemaModel messages, ready for use in @oa-sdk/client and @oa-sdk/router.
 *
 * The bytes follow the Protocol Buffers wire format of the schema that `Proto3TargetAdapter`
 * emits for the same model, so any Protobuf implementation can read and write them:
 * - scalars use their own wire types (varint, zigzag, fixed32/64, length-delimited)
 * - component objects are nested messages (with their `allOf` members' fields), component enums
 *   are member numbers
 * - `additionalProperties`-only objects, inline or referenced, are `map<string, V>`
 * - other values (unions, anonymous or free-form objects, nested arrays) are JSON text in a string field
 * - repeated numeric fields are written packed; both packed and unpacked forms are read
 * - required scalar and enum fields a foreign encoder omitted (proto3 implicit presence) decode to
 *   their proto3 default, as required repeated and map fields decode to empty ones
 *
 * TypeScript declarations use the names `types.ts` declares (`Inventory.Widget` is `InventoryWidget`);
 * `getGeneratedProtobufCodecs()` is keyed by component name.
 *
 * 100% Zero-eval CSP compliant, operates in all JS/TS runtimes.
 *
 * @oa-sdk/codegen
 */

import { quoteTypeScriptString, toTypeScriptIdentifier } from '@oa-sdk/core/browser'
import { formatJSDoc } from '../../typegen/jsdoc.js'
import type { TypeSpecWireTargetAdapter } from '../wire-adapter-types.js'
import { isProtobufMessage, type WireEnum, type WireField, type WireFieldKind, type WireModel, type WireSchemaModel } from '../wire-schema-model.js'
import { lowerFirst, wireTypeNames } from '../wire-type-names.js'

export interface ProtobufCodecAdapterOptions {
  readonly typesImport?: string | undefined
  readonly emitStandaloneRuntime?: boolean | undefined
}

/** Wire type per Protobuf scalar type. */
const SCALAR_WIRE_TYPES: Readonly<Record<string, 0 | 1 | 2 | 5>> = {
  int32: 0, int64: 0, uint32: 0, uint64: 0, sint32: 0, sint64: 0, bool: 0,
  fixed64: 1, sfixed64: 1, double: 1,
  string: 2, bytes: 2,
  fixed32: 5, sfixed32: 5, float: 5,
}

const SIXTY_FOUR_BIT = new Set(['int64', 'uint64', 'sint64', 'fixed64', 'sfixed64'])

/** Runtime shared by every generated codec. */
const RUNTIME = String.raw`// ── Protobuf wire runtime ──
const __textEncoder = new TextEncoder()
const __textDecoder = new TextDecoder('utf-8', { fatal: true })

interface __Reader {
  readonly bytes: Uint8Array
  readonly view: DataView
  offset: number
}

function __reader(raw: ArrayBufferLike | Uint8Array): __Reader {
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
  return { bytes, view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset: 0 }
}

function __writeVarint(out: number[], value: bigint): void {
  let rest = BigInt.asUintN(64, value)
  while (rest >= 0x80n) {
    out.push(Number(rest & 0x7fn) | 0x80)
    rest >>= 7n
  }
  out.push(Number(rest))
}

function __writeTag(out: number[], field: number, wireType: number): void {
  __writeVarint(out, BigInt(field) * 8n + BigInt(wireType))
}

function __writeLengthDelimited(out: number[], field: number, bytes: Uint8Array | readonly number[]): void {
  __writeTag(out, field, 2)
  __writeVarint(out, BigInt(bytes.length))
  for (let index = 0; index < bytes.length; index++) out.push(bytes[index]!)
}

function __integer(value: unknown, type: string, min: bigint, max: bigint): bigint {
  let result: bigint
  if (typeof value === 'bigint') result = value
  else if (typeof value === 'number' && Number.isInteger(value)) result = BigInt(value)
  else if (typeof value === 'string' && /^-?\d+$/.test(value)) result = BigInt(value)
  else throw new TypeError('Expected an integer for protobuf ' + type + ', got ' + String(value))
  if (result < min || result > max) throw new RangeError('Value ' + result + ' is out of range for protobuf ' + type)
  return result
}

const __INT32 = [-(2n ** 31n), 2n ** 31n - 1n] as const
const __UINT32 = [0n, 2n ** 32n - 1n] as const
const __INT64 = [-(2n ** 63n), 2n ** 63n - 1n] as const
const __UINT64 = [0n, 2n ** 64n - 1n] as const

function __fixed(out: number[], size: 4 | 8, write: (view: DataView) => void): void {
  const view = new DataView(new ArrayBuffer(size))
  write(view)
  for (let index = 0; index < size; index++) out.push(view.getUint8(index))
}

function __base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function __bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

/** Writes a scalar value without its tag. */
function __writeScalarValue(out: number[], type: string, value: unknown): void {
  switch (type) {
    case 'int32': return __writeVarint(out, __integer(value, type, __INT32[0], __INT32[1]))
    case 'uint32': return __writeVarint(out, __integer(value, type, __UINT32[0], __UINT32[1]))
    case 'int64': return __writeVarint(out, __integer(value, type, __INT64[0], __INT64[1]))
    case 'uint64': return __writeVarint(out, __integer(value, type, __UINT64[0], __UINT64[1]))
    case 'sint32': {
      const n = __integer(value, type, __INT32[0], __INT32[1])
      return __writeVarint(out, BigInt.asUintN(32, (n << 1n) ^ (n >> 31n)))
    }
    case 'sint64': {
      const n = __integer(value, type, __INT64[0], __INT64[1])
      return __writeVarint(out, BigInt.asUintN(64, (n << 1n) ^ (n >> 63n)))
    }
    case 'bool': return __writeVarint(out, value ? 1n : 0n)
    case 'fixed32': return __fixed(out, 4, view => view.setUint32(0, Number(__integer(value, type, __UINT32[0], __UINT32[1])), true))
    case 'sfixed32': return __fixed(out, 4, view => view.setInt32(0, Number(__integer(value, type, __INT32[0], __INT32[1])), true))
    case 'float': return __fixed(out, 4, view => view.setFloat32(0, Number(value), true))
    case 'fixed64': return __fixed(out, 8, view => view.setBigUint64(0, __integer(value, type, __UINT64[0], __UINT64[1]), true))
    case 'sfixed64': return __fixed(out, 8, view => view.setBigInt64(0, __integer(value, type, __INT64[0], __INT64[1]), true))
    case 'double': return __fixed(out, 8, view => view.setFloat64(0, Number(value), true))
    default: throw new TypeError('Unsupported protobuf scalar type ' + type)
  }
}

function __wireType(type: string): number {
  switch (type) {
    case 'fixed64': case 'sfixed64': case 'double': return 1
    case 'fixed32': case 'sfixed32': case 'float': return 5
    case 'string': case 'bytes': case 'bytes-base64': return 2
    default: return 0
  }
}

/** Writes one tagged scalar. 'bytes-base64' carries a base64 string as bytes. */
function __writeScalar(out: number[], field: number, type: string, value: unknown): void {
  if (type === 'string') return __writeLengthDelimited(out, field, __textEncoder.encode(String(value)))
  if (type === 'bytes') return __writeLengthDelimited(out, field, value as Uint8Array)
  if (type === 'bytes-base64') return __writeLengthDelimited(out, field, __base64ToBytes(String(value)))
  __writeTag(out, field, __wireType(type))
  __writeScalarValue(out, type, value)
}

/** Writes a repeated numeric scalar as one packed field. */
function __writePacked(out: number[], field: number, type: string, values: readonly unknown[]): void {
  if (values.length === 0) return
  const packed: number[] = []
  for (const value of values) __writeScalarValue(packed, type, value)
  __writeLengthDelimited(out, field, packed)
}

function __readVarint(reader: __Reader): bigint {
  let result = 0n
  let shift = 0n
  for (;;) {
    if (reader.offset >= reader.bytes.length) throw new RangeError('Truncated protobuf varint')
    const byte = reader.bytes[reader.offset++]!
    result |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return BigInt.asUintN(64, result)
    shift += 7n
    if (shift >= 70n) throw new RangeError('Protobuf varint is longer than 10 bytes')
  }
}

function __take(reader: __Reader, size: number): number {
  const start = reader.offset
  if (start + size > reader.bytes.length) throw new RangeError('Truncated protobuf field')
  reader.offset += size
  return start
}

function __readLengthDelimited(reader: __Reader): Uint8Array {
  const length = Number(__readVarint(reader))
  const start = __take(reader, length)
  return reader.bytes.subarray(start, start + length)
}

function __safe(value: bigint): number | bigint {
  return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value
}

function __readScalar(reader: __Reader, type: string): unknown {
  switch (type) {
    case 'int32': return Number(BigInt.asIntN(32, __readVarint(reader)))
    case 'uint32': return Number(BigInt.asUintN(32, __readVarint(reader)))
    case 'int64': return __safe(BigInt.asIntN(64, __readVarint(reader)))
    case 'uint64': return __safe(__readVarint(reader))
    case 'sint32': case 'sint64': {
      const n = __readVarint(reader)
      const decoded = (n >> 1n) ^ -(n & 1n)
      return type === 'sint32' ? Number(BigInt.asIntN(32, decoded)) : __safe(BigInt.asIntN(64, decoded))
    }
    case 'bool': return __readVarint(reader) !== 0n
    case 'fixed32': return reader.view.getUint32(__take(reader, 4), true)
    case 'sfixed32': return reader.view.getInt32(__take(reader, 4), true)
    case 'float': return reader.view.getFloat32(__take(reader, 4), true)
    case 'fixed64': return __safe(reader.view.getBigUint64(__take(reader, 8), true))
    case 'sfixed64': return __safe(reader.view.getBigInt64(__take(reader, 8), true))
    case 'double': return reader.view.getFloat64(__take(reader, 8), true)
    case 'string': return __textDecoder.decode(__readLengthDelimited(reader))
    case 'bytes': return __readLengthDelimited(reader).slice()
    case 'bytes-base64': return __bytesToBase64(__readLengthDelimited(reader))
    default: throw new TypeError('Unsupported protobuf scalar type ' + type)
  }
}

/** Reads a numeric scalar field that may arrive packed (wire type 2) or as single values. */
function __readRepeatedScalar(reader: __Reader, type: string, wireType: number, into: unknown[]): void {
  if (wireType === 2 && __wireType(type) !== 2) {
    const packed = __readLengthDelimited(reader)
    const inner = __reader(packed)
    while (inner.offset < packed.length) into.push(__readScalar(inner, type))
    return
  }
  into.push(__readScalar(reader, type))
}

function __skip(reader: __Reader, wireType: number): void {
  switch (wireType) {
    case 0: __readVarint(reader); return
    case 1: __take(reader, 8); return
    case 2: __readLengthDelimited(reader); return
    case 5: __take(reader, 4); return
    default: throw new RangeError('Unsupported protobuf wire type ' + wireType)
  }
}

function __readTag(reader: __Reader): { field: number; wireType: number } {
  const tag = __readVarint(reader)
  return { field: Number(tag >> 3n), wireType: Number(tag & 7n) }
}

function __enumNumber(literals: readonly unknown[], value: unknown, name: string): number {
  const index = literals.indexOf(value)
  if (index === -1) throw new TypeError('Value ' + String(value) + ' is not a member of enum ' + name)
  return index
}

function __enumLiteral(literals: readonly unknown[], number: number): unknown {
  // Open enums: numbers this version does not know are kept as numbers.
  return number >= 0 && number < literals.length ? literals[number] : number
}

function __setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}`

type FieldCodec = {
  /** Statements writing `value` (a variable) as field `field`. */
  write(value: string, field: number): string
  /** Expression reading one value; `reader` and `wireType` are in scope. */
  read: string
  /** The `__wireType` of the field when it is not packed. */
  wireType: number
  packable: boolean
  tsType: string
  /** Proto3 default of a value that a foreign encoder may omit (map values, required singular fields). */
  defaultValue: string
}

export class ProtobufCodecTargetAdapter implements TypeSpecWireTargetAdapter<string, ProtobufCodecAdapterOptions> {
  public readonly id = 'protobuf-codec'
  public readonly name = 'Protobuf TypeScript Codec Target Adapter'
  public readonly target = 'typescript'
  public readonly fileExtension = '.ts'

  transform(model: WireSchemaModel, options: ProtobufCodecAdapterOptions = {}): string {
    const context = new CodecContext(model)
    const lines: string[] = []
    // `object` models (maps, free-form objects) are no Protobuf message and get no codec.
    const messages = model.models.filter(isProtobufMessage)

    lines.push('// Auto-generated Protobuf Binary Codecs from TypeSpec SSOT.')
    lines.push('// @oa-sdk/codegen ProtobufCodecTargetAdapter')
    lines.push('')
    lines.push("import type { BinaryCodecAdapter } from '@oa-sdk/client'")

    if (options.typesImport) {
      const typeNames = messages.map(m => context.typeName(m.name))
      if (typeNames.length > 0) {
        lines.push(`import type { ${typeNames.join(', ')} } from ${quoteTypeScriptString(options.typesImport)}`)
      }
    } else {
      for (const mdl of messages) {
        lines.push(...this.renderModelInterface(mdl, context))
        lines.push('')
      }
    }
    lines.push('')
    lines.push(RUNTIME)
    lines.push('')

    for (const enm of model.enums) {
      lines.push(`const ${context.enumTable(enm.name)}: readonly unknown[] = ${JSON.stringify(enumLiterals(enm))}`)
    }
    if (model.enums.length > 0) lines.push('')

    for (const mdl of messages) {
      lines.push(...this.renderModelCodec(mdl, context))
      lines.push('')
    }

    lines.push('/** Collects all generated protobuf codecs into a record */')
    lines.push('export function getGeneratedProtobufCodecs(): Record<string, BinaryCodecAdapter<any>> {')
    lines.push('  return {')
    for (const mdl of messages) {
      lines.push(`    ${JSON.stringify(mdl.name)}: ${context.codecName(mdl.name)},`)
    }
    lines.push('  }')
    lines.push('}')

    return lines.join('\n').trimEnd() + '\n'
  }

  private renderModelInterface(mdl: WireModel, context: CodecContext): string[] {
    const lines: string[] = []
    if (mdl.doc) lines.push(formatJSDoc(mdl.doc))
    lines.push(`export interface ${context.typeName(mdl.name)} {`)
    for (const f of mdl.fields) {
      if (f.doc) lines.push(formatJSDoc(f.doc, '  '))
      lines.push(`  ${quoteTypeScriptString(f.name)}${f.optional ? '?' : ''}: ${context.fieldTsType(f)}`)
    }
    lines.push('}')
    return lines
  }

  private renderModelCodec(mdl: WireModel, context: CodecContext): string[] {
    const lines: string[] = []
    const name = mdl.name
    const ident = context.typeName(name)

    lines.push(formatJSDoc(`Encodes ${name} into Protobuf wire format bytes`))
    lines.push(`export function encode${ident}(payload: ${ident}): Uint8Array {`)
    lines.push('  const out: number[] = []')
    lines.push('  const source = payload as unknown as Record<string, unknown>')
    for (const f of mdl.fields) {
      const value = `source[${quoteTypeScriptString(f.name)}]`
      lines.push(`  { const value = ${value}`)
      lines.push('    if (value !== undefined && value !== null) {')
      lines.push(...context.writeField(f, 'value').map(line => `      ${line}`))
      lines.push('    }')
      lines.push('  }')
    }
    lines.push('  return new Uint8Array(out)')
    lines.push('}')
    lines.push('')

    lines.push(formatJSDoc(`Decodes Protobuf wire format bytes into ${name}`))
    lines.push(`export function decode${ident}(raw: ArrayBufferLike | Uint8Array): ${ident} {`)
    lines.push('  const reader = __reader(raw)')
    lines.push('  const res: Record<string, unknown> = {}')
    for (const f of mdl.fields) {
      // proto3 implicit presence: encoders leave out empty lists and maps and singular scalars and
      // enums equal to their default, so required ones come back as those defaults. Messages have
      // explicit presence, and JSON fields have no default.
      if (!f.required) continue
      const kind = kindOf(f)
      if (f.repeated || kind === 'map') {
        lines.push(`  __setOwn(res, ${quoteTypeScriptString(f.name)}, ${f.repeated ? '[]' : '{}'})`)
      } else if (kind === 'scalar' || kind === 'enum') {
        lines.push(`  __setOwn(res, ${quoteTypeScriptString(f.name)}, ${context.defaultValue(f)})`)
      }
    }
    lines.push('  while (reader.offset < reader.bytes.length) {')
    lines.push('    const { field, wireType } = __readTag(reader)')
    lines.push('    switch (field) {')
    for (const f of mdl.fields) {
      lines.push(`      case ${f.index}: {`)
      lines.push(...context.readField(f).map(line => `        ${line}`))
      lines.push('        break')
      lines.push('      }')
    }
    lines.push('      default:')
    lines.push('        __skip(reader, wireType)')
    lines.push('    }')
    lines.push('  }')
    lines.push(`  return res as unknown as ${ident}`)
    lines.push('}')
    lines.push('')

    lines.push(formatJSDoc(`BinaryCodecAdapter instance for ${name}`))
    lines.push(`export const ${context.codecName(name)}: BinaryCodecAdapter<${ident}> = {`)
    lines.push("  mediaTypes: ['application/x-protobuf', 'application/protobuf', 'application/vnd.google.protobuf'],")
    lines.push(`  encode: (payload) => encode${ident}(payload),`)
    lines.push(`  decode: (raw) => decode${ident}(raw),`)
    lines.push('}')

    return lines
  }
}

function kindOf(field: WireField): WireFieldKind {
  return field.kind ?? 'scalar'
}

function enumLiterals(enm: WireEnum): readonly unknown[] {
  return enm.literals ?? enm.values ?? enm.members.map(member => member.name)
}

class CodecContext {
  private readonly models: ReadonlyMap<string, WireModel>
  private readonly enums: ReadonlyMap<string, WireEnum>
  private readonly typeNames: ReadonlyMap<string, string>

  constructor(model: WireSchemaModel) {
    this.models = new Map(model.models.filter(isProtobufMessage).map(m => [m.name, m]))
    this.enums = new Map(model.enums.map(e => [e.name, e]))
    this.typeNames = wireTypeNames(model)
  }

  /** TypeScript name of a model or enum; also the stem of its codec function names. */
  typeName(name: string): string {
    return this.typeNames.get(name) ?? toTypeScriptIdentifier(name)
  }

  codecName(name: string): string {
    return `${lowerFirst(this.typeName(name))}ProtobufCodec`
  }

  enumTable(name: string): string {
    return `__enum_${this.typeName(name)}`
  }

  private scalarCodec(type: string, format: string | undefined): FieldCodec {
    const wireType = SCALAR_WIRE_TYPES[type]
    if (wireType === undefined) throw new Error(`Unsupported protobuf scalar type "${type}"`)
    const runtimeType = type === 'bytes' && format === 'byte' ? 'bytes-base64' : type
    const quoted = quoteTypeScriptString(runtimeType)
    return {
      write: (value, field) => `__writeScalar(out, ${field}, ${quoted}, ${value})`,
      read: `__readScalar(reader, ${quoted})`,
      wireType,
      packable: wireType !== 2,
      tsType: type === 'string' || runtimeType === 'bytes-base64'
        ? 'string'
        : type === 'bytes'
          ? 'Uint8Array'
          : type === 'bool'
            ? 'boolean'
            : SIXTY_FOUR_BIT.has(type) ? 'number | bigint' : 'number',
      defaultValue: type === 'string' || runtimeType === 'bytes-base64'
        ? "''"
        : type === 'bytes' ? 'new Uint8Array()' : type === 'bool' ? 'false' : '0',
    }
  }

  private valueCodec(kind: Exclude<WireFieldKind, 'map'>, type: string, format: string | undefined): FieldCodec {
    if (kind === 'scalar') return this.scalarCodec(type, format)
    if (kind === 'enum') {
      const table = this.enumTable(type)
      const enm = this.enums.get(type)
      return {
        write: (value, field) => `__writeScalar(out, ${field}, 'int32', __enumNumber(${table}, ${value}, ${quoteTypeScriptString(type)}))`,
        read: `__enumLiteral(${table}, __readScalar(reader, 'int32') as number)`,
        wireType: 0,
        packable: true,
        tsType: enm ? enumLiterals(enm).map(literal => JSON.stringify(literal)).join(' | ') || 'never' : 'unknown',
        defaultValue: `__enumLiteral(${table}, 0)`,
      }
    }
    if (kind === 'message') {
      const target = this.models.get(type)
      if (!target) return this.valueCodec('json', 'string', undefined)
      const ident = this.typeName(type)
      return {
        write: (value, field) => `__writeLengthDelimited(out, ${field}, encode${ident}(${value} as ${ident}))`,
        read: `decode${ident}(__readLengthDelimited(reader))`,
        wireType: 2,
        packable: false,
        tsType: ident,
        defaultValue: `decode${ident}(new Uint8Array())`,
      }
    }
    return {
      write: (value, field) => `__writeScalar(out, ${field}, 'string', JSON.stringify(${value}))`,
      read: "JSON.parse(__readScalar(reader, 'string') as string)",
      wireType: 2,
      packable: false,
      tsType: 'unknown',
      defaultValue: 'undefined',
    }
  }

  private fieldCodec(field: WireField): FieldCodec {
    const kind = kindOf(field)
    if (kind === 'map') throw new Error('map fields have no single value codec')
    return this.valueCodec(kind, field.type, field.format)
  }

  /** Expression for the proto3 default of one value of a non-map field. */
  defaultValue(field: WireField): string {
    return this.fieldCodec(field).defaultValue
  }

  fieldTsType(field: WireField): string {
    if (kindOf(field) === 'map') {
      const value = field.mapValue!
      return `Record<string, ${this.valueCodec(value.kind, value.type, undefined).tsType}>`
    }
    const tsType = this.fieldCodec(field).tsType
    return field.repeated ? `Array<${tsType}>` : tsType
  }

  writeField(field: WireField, value: string): string[] {
    if (kindOf(field) === 'map') {
      const codec = this.valueCodec(field.mapValue!.kind, field.mapValue!.type, undefined)
      return [
        `for (const [key, entryValue] of Object.entries(${value} as Record<string, unknown>)) {`,
        '  if (entryValue === undefined) continue',
        '  const entry: number[] = []',
        "  __writeScalar(entry, 1, 'string', key)",
        '  {',
        '    const out = entry',
        `    ${codec.write('entryValue', 2)}`,
        '  }',
        `  __writeLengthDelimited(out, ${field.index}, entry)`,
        '}',
      ]
    }
    const codec = this.fieldCodec(field)
    if (!field.repeated) return [codec.write(value, field.index)]
    if (codec.packable && kindOf(field) === 'enum') {
      const numbers = `(${value} as readonly unknown[]).map(item => __enumNumber(${this.enumTable(field.type)}, item, ${quoteTypeScriptString(field.type)}))`
      return [`__writePacked(out, ${field.index}, 'int32', ${numbers})`]
    }
    if (codec.packable) return [`__writePacked(out, ${field.index}, ${packedType(field)}, ${value} as readonly unknown[])`]
    return [
      `for (const item of ${value} as readonly unknown[]) {`,
      `  ${codec.write('item', field.index)}`,
      '}',
    ]
  }

  readField(field: WireField): string[] {
    const key = quoteTypeScriptString(field.name)
    if (kindOf(field) === 'map') {
      const codec = this.valueCodec(field.mapValue!.kind, field.mapValue!.type, undefined)
      return [
        'if (wireType !== 2) { __skip(reader, wireType); break }',
        `const map = (Object.hasOwn(res, ${key}) ? res[${key}] : {}) as Record<string, unknown>`,
        'const entryBytes = __readLengthDelimited(reader)',
        '{',
        '  // Shadows the message reader so the value codec reads from the entry.',
        '  const reader = __reader(entryBytes)',
        "  let key = ''",
        `  let value: unknown = ${codec.defaultValue}`,
        '  while (reader.offset < reader.bytes.length) {',
        '    const { field: entryField, wireType } = __readTag(reader)',
        `    if (entryField === 1 && wireType === 2) key = __readScalar(reader, 'string') as string`,
        `    else if (entryField === 2 && wireType === ${codec.wireType}) value = ${codec.read}`,
        '    else __skip(reader, wireType)',
        '  }',
        '  __setOwn(map, key, value)',
        '}',
        `__setOwn(res, ${key}, map)`,
      ]
    }
    const codec = this.fieldCodec(field)
    if (field.repeated) {
      const lines = [`const list = (Object.hasOwn(res, ${key}) ? res[${key}] : []) as unknown[]`]
      if (codec.packable) {
        const type = packedType(field)
        if (kindOf(field) === 'enum') {
          lines.push(
            `if (wireType !== 0 && wireType !== 2) { __skip(reader, wireType); break }`,
            'const numbers: unknown[] = []',
            `__readRepeatedScalar(reader, ${type}, wireType, numbers)`,
            `for (const number of numbers) list.push(__enumLiteral(${this.enumTable(field.type)}, number as number))`,
          )
        } else {
          lines.push(
            `if (wireType !== ${codec.wireType} && wireType !== 2) { __skip(reader, wireType); break }`,
            `__readRepeatedScalar(reader, ${type}, wireType, list)`,
          )
        }
      } else {
        lines.push(
          `if (wireType !== ${codec.wireType}) { __skip(reader, wireType); break }`,
          `list.push(${codec.read})`,
        )
      }
      lines.push(`__setOwn(res, ${key}, list)`)
      return lines
    }
    return [
      `if (wireType !== ${codec.wireType}) { __skip(reader, wireType); break }`,
      `__setOwn(res, ${key}, ${codec.read})`,
    ]
  }
}

/** Runtime scalar type of a packable repeated field (enums travel as int32). */
function packedType(field: WireField): string {
  return quoteTypeScriptString(kindOf(field) === 'enum' ? 'int32' : field.type)
}
