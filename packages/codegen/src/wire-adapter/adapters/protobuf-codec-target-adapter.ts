/**
 * Protobuf Codec Target Adapter
 *
 * Emits pure TypeScript, zero-dependency BinaryCodecAdapter implementations
 * for WireSchemaModel messages, ready for use in @oa-sdk/client and @oa-sdk/router.
 *
 * 100% Zero-eval CSP compliant, operates in all JS/TS runtimes.
 *
 * @oa-sdk/codegen
 */

import type { TypeSpecWireTargetAdapter } from '../wire-adapter-types.js'
import type { WireSchemaModel, WireModel, WireField } from '../wire-schema-model.js'

export interface ProtobufCodecAdapterOptions {
  readonly typesImport?: string | undefined
  readonly emitStandaloneRuntime?: boolean | undefined
}

export class ProtobufCodecTargetAdapter implements TypeSpecWireTargetAdapter<string, ProtobufCodecAdapterOptions> {
  public readonly id = 'protobuf-codec'
  public readonly name = 'Protobuf TypeScript Codec Target Adapter'
  public readonly target = 'typescript'
  public readonly fileExtension = '.ts'

  transform(model: WireSchemaModel, options: ProtobufCodecAdapterOptions = {}): string {
    const lines: string[] = []

    lines.push('// Auto-generated Protobuf Binary Codecs from TypeSpec SSOT.')
    lines.push('// @oa-sdk/codegen ProtobufCodecTargetAdapter')
    lines.push('')
    lines.push("import type { BinaryCodecAdapter } from '@oa-sdk/client'")

    if (options.typesImport) {
      const typeNames = model.models.map(m => m.name)
      if (typeNames.length > 0) {
        lines.push(`import type { ${typeNames.join(', ')} } from '${options.typesImport}'`)
      }
    } else {
      // Inline TypeScript interfaces for the models
      for (const mdl of model.models) {
        lines.push(...this.renderModelInterface(mdl))
        lines.push('')
      }
    }
    lines.push('')

    // Render runtime helper functions (varint encode/decode, tag helpers)
    lines.push(...this.renderProtobufRuntimeHelpers())
    lines.push('')

    // Render codec instances and factories for each model
    for (const mdl of model.models) {
      lines.push(...this.renderModelCodec(mdl))
      lines.push('')
    }

    // Registry helper
    lines.push('/** Collects all generated protobuf codecs into a record */')
    lines.push('export function getGeneratedProtobufCodecs(): Record<string, BinaryCodecAdapter<any>> {')
    lines.push('  return {')
    for (const mdl of model.models) {
      lines.push(`    ${JSON.stringify(mdl.name)}: ${toCamelCase(mdl.name)}ProtobufCodec,`)
    }
    lines.push('  }')
    lines.push('}')

    return lines.join('\n').trimEnd() + '\n'
  }

  private renderModelInterface(mdl: WireModel): string[] {
    const lines: string[] = []
    if (mdl.doc) lines.push(`/** ${mdl.doc} */`)
    lines.push(`export interface ${mdl.name} {`)
    for (const f of mdl.fields) {
      const opt = f.optional ? '?' : ''
      const tsType = this.wireTypeToTsType(f)
      const doc = f.doc ? ` /** ${f.doc} */` : ''
      lines.push(`  ${f.name}${opt}: ${tsType}${doc}`)
    }
    lines.push('}')
    return lines
  }

  private wireTypeToTsType(f: WireField): string {
    let t = 'string'
    if (f.type === 'int32' || f.type === 'uint32' || f.type === 'sint32' || f.type === 'fixed32' || f.type === 'float' || f.type === 'double') {
      t = 'number'
    } else if (f.type === 'int64' || f.type === 'uint64' || f.type === 'sint64' || f.type === 'fixed64') {
      t = 'number | bigint'
    } else if (f.type === 'bool') {
      t = 'boolean'
    } else if (f.type === 'bytes') {
      t = 'Uint8Array'
    } else if (f.type) {
      t = f.type
    }
    return f.repeated ? `${t}[]` : t
  }

  private renderProtobufRuntimeHelpers(): string[] {
    return [
      '// ── Pure TS Protobuf Wire Helpers ──',
      'const __textEncoder = new TextEncoder()',
      'const __textDecoder = new TextDecoder()',
      '',
      'function __encodeVarint(value: number | bigint, out: number[]): void {',
      '  let v = BigInt(value)',
      '  while (v >= 0x80n) {',
      '    out.push(Number(v & 0x7fn) | 0x80)',
      '    v >>= 7n',
      '  }',
      '  out.push(Number(v & 0x7fn))',
      '}',
      '',
      'function __decodeVarint(bytes: Uint8Array, offsetRef: { offset: number }): number {',
      '  let res = 0',
      '  let shift = 0',
      '  while (offsetRef.offset < bytes.length) {',
      '    const byte = bytes[offsetRef.offset++]!',
      '    res |= (byte & 0x7f) << shift',
      '    if ((byte & 0x80) === 0) break',
      '    shift += 7',
      '  }',
      '  return res',
      '}',
      '',
      'function __encodeTag(fieldNumber: number, wireType: number, out: number[]): void {',
      '  __encodeVarint((fieldNumber << 3) | wireType, out)',
      '}',
      '',
      'function __encodeString(fieldNumber: number, val: string, out: number[]): void {',
      '  const buf = __textEncoder.encode(val)',
      '  __encodeTag(fieldNumber, 2, out)',
      '  __encodeVarint(buf.length, out)',
      '  for (let i = 0; i < buf.length; i++) out.push(buf[i]!)',
      '}',
      '',
      'function __encodeDouble(fieldNumber: number, val: number, out: number[]): void {',
      '  __encodeTag(fieldNumber, 1, out)',
      '  const buf = new Uint8Array(8)',
      '  new DataView(buf.buffer).setFloat64(0, val, true)',
      '  for (let i = 0; i < 8; i++) out.push(buf[i]!)',
      '}',
      '',
      'function __encodeInt32(fieldNumber: number, val: number, out: number[]): void {',
      '  __encodeTag(fieldNumber, 0, out)',
      '  __encodeVarint(val, out)',
      '}',
      '',
      'function __encodeBool(fieldNumber: number, val: boolean, out: number[]): void {',
      '  __encodeTag(fieldNumber, 0, out)',
      '  out.push(val ? 1 : 0)',
      '}',
    ]
  }

  private renderModelCodec(mdl: WireModel): string[] {
    const lines: string[] = []
    const name = mdl.name
    const camel = toCamelCase(name)

    lines.push(`/** Encodes ${name} into Protobuf wire format bytes */`)
    lines.push(`export function encode${name}(payload: ${name}): Uint8Array {`)
    lines.push('  const out: number[] = []')
    for (const f of mdl.fields) {
      const prop = `payload.${f.name}`
      lines.push(`  if (${prop} !== undefined && ${prop} !== null) {`)
      if (f.repeated) {
        lines.push(`    for (const item of ${prop}) {`)
        if (f.type === 'string') {
          lines.push(`      __encodeString(${f.index}, String(item), out)`)
        } else if (f.type === 'double' || f.type === 'float') {
          lines.push(`      __encodeDouble(${f.index}, Number(item), out)`)
        } else if (f.type === 'bool') {
          lines.push(`      __encodeBool(${f.index}, Boolean(item), out)`)
        } else {
          lines.push(`      __encodeInt32(${f.index}, Number(item), out)`)
        }
        lines.push('    }')
      } else {
        if (f.type === 'string') {
          lines.push(`    __encodeString(${f.index}, String(${prop}), out)`)
        } else if (f.type === 'double' || f.type === 'float') {
          lines.push(`    __encodeDouble(${f.index}, Number(${prop}), out)`)
        } else if (f.type === 'bool') {
          lines.push(`    __encodeBool(${f.index}, Boolean(${prop}), out)`)
        } else {
          lines.push(`    __encodeInt32(${f.index}, Number(${prop}), out)`)
        }
      }
      lines.push('  }')
    }
    lines.push('  return new Uint8Array(out)')
    lines.push('}')
    lines.push('')

    lines.push(`/** Decodes Protobuf wire format bytes into ${name} */`)
    lines.push(`export function decode${name}(raw: ArrayBufferLike | Uint8Array): ${name} {`)
    lines.push('  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw)')
    lines.push('  const offsetRef = { offset: 0 }')
    lines.push(`  const res: Partial<${name}> = {}`)
    lines.push('  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)')
    lines.push('')
    lines.push('  while (offsetRef.offset < bytes.length) {')
    lines.push('    const tag = __decodeVarint(bytes, offsetRef)')
    lines.push('    const fieldNumber = tag >>> 3')
    lines.push('    const wireType = tag & 0x07')
    lines.push('')
    lines.push('    switch (fieldNumber) {')
    for (const f of mdl.fields) {
      lines.push(`      case ${f.index}: {`)
      if (f.type === 'string') {
        lines.push('        const len = __decodeVarint(bytes, offsetRef)')
        lines.push('        const strBytes = bytes.subarray(offsetRef.offset, offsetRef.offset + len)')
        lines.push('        offsetRef.offset += len')
        lines.push('        const val = __textDecoder.decode(strBytes)')
        if (f.repeated) {
          lines.push(`        if (!res.${f.name}) res.${f.name} = []`)
          lines.push(`        res.${f.name}.push(val)`)
        } else {
          lines.push(`        res.${f.name} = val`)
        }
      } else if (f.type === 'double') {
        lines.push('        const val = view.getFloat64(offsetRef.offset, true)')
        lines.push('        offsetRef.offset += 8')
        if (f.repeated) {
          lines.push(`        if (!res.${f.name}) res.${f.name} = []`)
          lines.push(`        res.${f.name}.push(val)`)
        } else {
          lines.push(`        res.${f.name} = val`)
        }
      } else if (f.type === 'bool') {
        lines.push('        const val = __decodeVarint(bytes, offsetRef) !== 0')
        if (f.repeated) {
          lines.push(`        if (!res.${f.name}) res.${f.name} = []`)
          lines.push(`        res.${f.name}.push(val)`)
        } else {
          lines.push(`        res.${f.name} = val`)
        }
      } else {
        lines.push('        const val = __decodeVarint(bytes, offsetRef)')
        if (f.repeated) {
          lines.push(`        if (!res.${f.name}) res.${f.name} = []`)
          lines.push(`        res.${f.name}.push(val)`)
        } else {
          lines.push(`        res.${f.name} = val`)
        }
      }
      lines.push('        break')
      lines.push('      }')
    }
    lines.push('      default:')
    lines.push('        // Skip unknown field according to wireType')
    lines.push('        if (wireType === 0) __decodeVarint(bytes, offsetRef)')
    lines.push('        else if (wireType === 1) offsetRef.offset += 8')
    lines.push('        else if (wireType === 2) {')
    lines.push('          const len = __decodeVarint(bytes, offsetRef)')
    lines.push('          offsetRef.offset += len')
    lines.push('        } else if (wireType === 5) offsetRef.offset += 4')
    lines.push('        break')
    lines.push('    }')
    lines.push('  }')
    lines.push(`  return res as ${name}`)
    lines.push('}')
    lines.push('')

    lines.push(`/** BinaryCodecAdapter instance for ${name} */`)
    lines.push(`export const ${camel}ProtobufCodec: BinaryCodecAdapter<${name}> = {`)
    lines.push("  mediaTypes: ['application/x-protobuf', 'application/protobuf', 'application/vnd.google.protobuf'],")
    lines.push(`  encode: (payload) => encode${name}(payload),`)
    lines.push(`  decode: (raw) => decode${name}(raw),`)
    lines.push('}')

    return lines
  }
}

function toCamelCase(str: string): string {
  return str.replace(/^[A-Z]/, c => c.toLowerCase())
}
