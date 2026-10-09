/**
 * MessagePack Target Adapter
 *
 * Emits TypeScript MessagePack binary codec bindings for WireSchemaModel messages,
 * backed by @oa-sdk/client's zero-dependency pure TypeScript MessagePack implementation.
 *
 * @oa-sdk/codegen
 */

import type { TypeSpecWireTargetAdapter } from '../wire-adapter-types.js'
import type { WireSchemaModel } from '../wire-schema-model.js'

export interface MessagePackAdapterOptions {
  readonly typesImport?: string | undefined
}

export class MessagePackTargetAdapter implements TypeSpecWireTargetAdapter<string, MessagePackAdapterOptions> {
  public readonly id = 'messagepack'
  public readonly name = 'MessagePack Target Adapter'
  public readonly target = 'messagepack'
  public readonly fileExtension = '.ts'

  transform(model: WireSchemaModel, options: MessagePackAdapterOptions = {}): string {
    const lines: string[] = []

    lines.push('// Auto-generated MessagePack Binary Codecs from TypeSpec SSOT.')
    lines.push('// @oa-sdk/codegen MessagePackTargetAdapter')
    lines.push('')
    lines.push("import { messagePackAdapter, type BinaryCodecAdapter } from '@oa-sdk/client'")

    if (options.typesImport) {
      const typeNames = model.models.map(m => m.name)
      if (typeNames.length > 0) {
        lines.push(`import type { ${typeNames.join(', ')} } from '${options.typesImport}'`)
      }
    }
    lines.push('')

    for (const mdl of model.models) {
      const camel = mdl.name.replace(/^[A-Z]/, c => c.toLowerCase())
      lines.push(`/** MessagePack codec for ${mdl.name} */`)
      lines.push(`export const ${camel}MessagePackCodec: BinaryCodecAdapter<${mdl.name}> = messagePackAdapter as BinaryCodecAdapter<${mdl.name}>`)
      lines.push('')
    }

    lines.push('/** Collects all generated MessagePack codecs into a record */')
    lines.push('export function getGeneratedMessagePackCodecs(): Record<string, BinaryCodecAdapter<any>> {')
    lines.push('  return {')
    for (const mdl of model.models) {
      const camel = mdl.name.replace(/^[A-Z]/, c => c.toLowerCase())
      lines.push(`    ${JSON.stringify(mdl.name)}: ${camel}MessagePackCodec,`)
    }
    lines.push('  }')
    lines.push('}')

    return lines.join('\n').trimEnd() + '\n'
  }
}
