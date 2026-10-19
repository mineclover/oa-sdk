/**
 * MessagePack Target Adapter
 *
 * Emits TypeScript MessagePack binary codec bindings for WireSchemaModel messages,
 * backed by @oa-sdk/client's zero-dependency pure TypeScript MessagePack implementation.
 * Type positions use the names `types.ts` declares; `getGeneratedMessagePackCodecs()` is keyed by
 * component name.
 *
 * @oa-sdk/codegen
 */

import { quoteTypeScriptString } from '@oa-sdk/core/browser'
import { formatJSDoc } from '../../typegen/jsdoc.js'
import type { TypeSpecWireTargetAdapter } from '../wire-adapter-types.js'
import type { WireSchemaModel } from '../wire-schema-model.js'
import { lowerFirst, wireTypeNames } from '../wire-type-names.js'

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
    const typeNames = wireTypeNames(model)
    const typeName = (name: string): string => typeNames.get(name) ?? name
    const codecName = (name: string): string => `${lowerFirst(typeName(name))}MessagePackCodec`

    lines.push('// Auto-generated MessagePack Binary Codecs from TypeSpec SSOT.')
    lines.push('// @oa-sdk/codegen MessagePackTargetAdapter')
    lines.push('')
    lines.push("import { messagePackAdapter, type BinaryCodecAdapter } from '@oa-sdk/client'")

    if (options.typesImport) {
      const importNames = model.models.map(m => typeName(m.name))
      if (importNames.length > 0) {
        lines.push(`import type { ${importNames.join(', ')} } from ${quoteTypeScriptString(options.typesImport)}`)
      }
    }
    lines.push('')

    for (const mdl of model.models) {
      const type = typeName(mdl.name)
      lines.push(formatJSDoc(`MessagePack codec for ${mdl.name}`))
      lines.push(`export const ${codecName(mdl.name)}: BinaryCodecAdapter<${type}> = messagePackAdapter as BinaryCodecAdapter<${type}>`)
      lines.push('')
    }

    lines.push('/** Collects all generated MessagePack codecs into a record */')
    lines.push('export function getGeneratedMessagePackCodecs(): Record<string, BinaryCodecAdapter<any>> {')
    lines.push('  return {')
    for (const mdl of model.models) {
      lines.push(`    ${JSON.stringify(mdl.name)}: ${codecName(mdl.name)},`)
    }
    lines.push('  }')
    lines.push('}')

    return lines.join('\n').trimEnd() + '\n'
  }
}
