/**
 * Proto3 Target Adapter
 *
 * Transforms canonical WireSchemaModel into a standard Protocol Buffers v3 (.proto) schema.
 *
 * @oa-sdk/codegen
 */

import { emptyMessageName, protoIdentifier } from '../proto-identifiers.js'
import type { TypeSpecWireTargetAdapter } from '../wire-adapter-types.js'
import { isProtobufMessage, type WireSchemaModel, type WireModel, type WireEnum, type WireField, type WireService } from '../wire-schema-model.js'

export interface Proto3AdapterOptions {
  readonly packageName?: string | undefined
  readonly javaPackage?: string | undefined
  readonly goPackage?: string | undefined
  readonly emitEmptyMessage?: boolean | undefined
  readonly includeServices?: boolean | undefined
}

export class Proto3TargetAdapter implements TypeSpecWireTargetAdapter<string, Proto3AdapterOptions> {
  public readonly id = 'proto3'
  public readonly name = 'Protocol Buffers v3 Target Adapter'
  public readonly target = 'protobuf'
  public readonly fileExtension = '.proto'

  constructor(private readonly defaultOptions: Proto3AdapterOptions = {}) {}

  transform(model: WireSchemaModel, options: Proto3AdapterOptions = {}): string {
    const opts = { ...this.defaultOptions, ...options }
    const lines: string[] = []
    const pkg = opts.packageName ?? model.package ?? 'api.v1'
    const includeServices = opts.includeServices !== false

    lines.push('// Auto-generated Protocol Buffers v3 schema from TypeSpec SSOT.')
    lines.push('// @oa-sdk/codegen Proto3TargetAdapter')
    lines.push('syntax = "proto3";')
    lines.push('')
    lines.push(`package ${pkg};`)
    lines.push('')

    if (opts.javaPackage) {
      lines.push(`option java_package = "${opts.javaPackage}";`)
    }
    if (opts.goPackage) {
      lines.push(`option go_package = "${opts.goPackage}";`)
    }
    if (opts.javaPackage || opts.goPackage) {
      lines.push('')
    }

    const names = new ProtoNames(model)

    // The empty message of methods without a message payload; named apart from user models.
    const needsEmpty = includeServices && model.services.some(svc =>
      svc.methods.some(m => m.inputType === names.empty || m.outputType === names.empty))
    if (needsEmpty || opts.emitEmptyMessage) {
      lines.push(`message ${names.empty} {}`)
      lines.push('')
    }

    // Enums
    for (const enm of model.enums) {
      lines.push(...this.renderEnum(enm, names))
      lines.push('')
    }

    // Messages; `object` models (maps, free-form objects) have none.
    for (const mdl of model.models.filter(isProtobufMessage)) {
      lines.push(...this.renderModel(mdl, names))
      lines.push('')
    }

    // Services
    if (includeServices) {
      for (const svc of model.services) {
        if (svc.methods.length > 0) {
          lines.push(...this.renderService(svc, names))
          lines.push('')
        }
      }
    }

    return lines.join('\n').trimEnd() + '\n'
  }

  private renderEnum(enm: WireEnum, names: ProtoNames): string[] {
    const lines: string[] = []
    if (enm.doc) lines.push(`// ${comment(enm.doc)}`)
    lines.push(`enum ${names.type(enm.name)} {`)
    for (const mem of enm.members) {
      const doc = mem.doc ? ` // ${comment(mem.doc)}` : ''
      lines.push(`  ${names.enumMember(enm, mem.name)} = ${mem.number};${doc}`)
    }
    lines.push('}')
    return lines
  }

  private renderModel(mdl: WireModel, names: ProtoNames): string[] {
    const lines: string[] = []
    if (mdl.doc) lines.push(`// ${comment(mdl.doc)}`)
    lines.push(`message ${names.message(mdl.name)} {`)
    for (const field of mdl.fields) {
      const repeated = field.repeated ? 'repeated ' : ''
      const fieldName = protoIdentifier(field.name)
      const jsonName = fieldName === field.name ? '' : ` [json_name = ${JSON.stringify(field.name)}]`
      const notes = [field.kind === 'json' ? 'JSON-encoded value' : undefined, field.doc ? comment(field.doc) : undefined]
        .filter(Boolean)
        .join(' — ')
      const doc = notes ? ` // ${notes}` : ''
      lines.push(`  ${repeated}${names.fieldType(field)} ${fieldName} = ${field.index}${jsonName};${doc}`)
    }
    lines.push('}')
    return lines
  }

  private renderService(svc: WireService, names: ProtoNames): string[] {
    const lines: string[] = []
    if (svc.doc) lines.push(`// ${comment(svc.doc)}`)
    lines.push(`service ${protoIdentifier(svc.serviceName ?? svc.name)} {`)
    for (const m of svc.methods) {
      const doc = m.doc ? `  // ${comment(m.doc)}\n` : ''
      const inputType = names.message(m.inputType)
      const outputType = names.message(m.outputType)
      const input = m.streaming === 'client' || m.streaming === 'bidirectional' ? `stream ${inputType}` : inputType
      const output = m.streaming === 'server' || m.streaming === 'bidirectional' ? `stream ${outputType}` : outputType
      lines.push(`${doc}  rpc ${protoIdentifier(m.name)} (${input}) returns (${output});`)
    }
    lines.push('}')
    return lines
  }
}

/** Keeps a comment on one line. */
function comment(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Resolves model, enum, and enum member names as they appear in the schema. */
class ProtoNames {
  /** Name of the empty message; see `emptyMessageName`. */
  readonly empty: string
  private readonly messages: ReadonlyMap<string, string>
  private readonly enumNames: ReadonlySet<string>
  /** Enum member names used by more than one enum; proto3 enum values share the package scope. */
  private readonly sharedMembers: ReadonlySet<string>

  constructor(model: WireSchemaModel) {
    this.empty = emptyMessageName(model)
    this.messages = new Map(model.models.filter(isProtobufMessage).map(m => [m.name, protoIdentifier(m.messageName ?? m.name)]))
    this.enumNames = new Set(model.enums.map(e => e.name))
    const seen = new Map<string, number>()
    for (const enm of model.enums) {
      for (const member of new Set(enm.members.map(m => memberIdentifier(m.name)))) {
        seen.set(member, (seen.get(member) ?? 0) + 1)
      }
    }
    this.sharedMembers = new Set([...seen].filter(([, count]) => count > 1).map(([name]) => name))
  }

  type(name: string): string {
    return this.messages.get(name) ?? protoIdentifier(name)
  }

  /** A method's input or output message: a model's message, or the empty message. */
  message(name: string): string {
    return name === this.empty ? this.empty : this.type(name)
  }

  enumMember(enm: WireEnum, member: string): string {
    const identifier = memberIdentifier(member)
    if (!this.sharedMembers.has(identifier)) return identifier
    return `${memberIdentifier(enm.name)}_${identifier}`
  }

  fieldType(field: WireField): string {
    const kind = field.kind ?? 'scalar'
    if (kind === 'json') return 'string'
    if (kind === 'map') {
      const value = field.mapValue!
      return `map<string, ${value.kind === 'scalar' ? value.type : this.type(value.type)}>`
    }
    if (kind === 'scalar' && !this.enumNames.has(field.type) && !this.messages.has(field.type)) return field.type
    return this.type(field.type)
  }
}

function memberIdentifier(name: string): string {
  return protoIdentifier(name).toUpperCase()
}
