/**
 * Proto3 Target Adapter
 *
 * Transforms canonical WireSchemaModel into a standard Protocol Buffers v3 (.proto) schema.
 *
 * @oa-sdk/codegen
 */

import type { TypeSpecWireTargetAdapter } from '../wire-adapter-types.js'
import type { WireSchemaModel, WireModel, WireEnum, WireService } from '../wire-schema-model.js'

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

    // Track if Empty message is needed
    let needsEmpty = false
    if (includeServices) {
      for (const svc of model.services) {
        for (const m of svc.methods) {
          if (m.inputType === 'Empty' || m.outputType === 'Empty') {
            needsEmpty = true
            break
          }
        }
      }
    }

    if (needsEmpty || options.emitEmptyMessage) {
      lines.push('message Empty {}')
      lines.push('')
    }

    // Enums
    for (const enm of model.enums) {
      lines.push(...this.renderEnum(enm))
      lines.push('')
    }

    // Messages
    for (const mdl of model.models) {
      lines.push(...this.renderModel(mdl))
      lines.push('')
    }

    // Services
    if (includeServices) {
      for (const svc of model.services) {
        if (svc.methods.length > 0) {
          lines.push(...this.renderService(svc))
          lines.push('')
        }
      }
    }

    return lines.join('\n').trimEnd() + '\n'
  }

  private renderEnum(enm: WireEnum): string[] {
    const lines: string[] = []
    if (enm.doc) lines.push(`// ${enm.doc}`)
    lines.push(`enum ${enm.name} {`)
    for (const mem of enm.members) {
      const doc = mem.doc ? ` // ${mem.doc}` : ''
      lines.push(`  ${mem.name} = ${mem.number};${doc}`)
    }
    lines.push('}')
    return lines
  }

  private renderModel(mdl: WireModel): string[] {
    const lines: string[] = []
    if (mdl.doc) lines.push(`// ${mdl.doc}`)
    lines.push(`message ${mdl.messageName ?? mdl.name} {`)
    for (const field of mdl.fields) {
      const repeated = field.repeated ? 'repeated ' : ''
      const doc = field.doc ? ` // ${field.doc}` : ''
      lines.push(`  ${repeated}${field.type} ${field.name} = ${field.index};${doc}`)
    }
    lines.push('}')
    return lines
  }

  private renderService(svc: WireService): string[] {
    const lines: string[] = []
    if (svc.doc) lines.push(`// ${svc.doc}`)
    lines.push(`service ${svc.serviceName ?? svc.name} {`)
    for (const m of svc.methods) {
      const doc = m.doc ? `  // ${m.doc}\n` : ''
      const input = m.streaming === 'client' || m.streaming === 'bidirectional' ? `stream ${m.inputType}` : m.inputType
      const output = m.streaming === 'server' || m.streaming === 'bidirectional' ? `stream ${m.outputType}` : m.outputType
      lines.push(`${doc}  rpc ${m.name} (${input}) returns (${output});`)
    }
    lines.push('}')
    return lines
  }
}
