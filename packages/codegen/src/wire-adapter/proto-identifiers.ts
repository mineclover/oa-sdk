/**
 * Protobuf identifiers of a wire model, and the name of its empty message.
 *
 * @oa-sdk/codegen
 */

import type { WireSchemaModel } from './wire-schema-model.js'

/** A valid proto identifier: letters, digits, and underscores, not starting with a digit. */
export function protoIdentifier(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_')
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`
}

/** The parts of a wire model that hold names. */
export type WireNameScope = Pick<WireSchemaModel, 'models' | 'enums'> & {
  readonly services: readonly { readonly name: string; readonly serviceName?: string | undefined }[]
}

/**
 * Name of the empty message that stands for "no message" in `WireMethod.inputType` and
 * `outputType`: a method without a body or response message, or whose payload is not a message.
 *
 * It is `Empty` unless a model, enum, or service already has that name, as a component, a message
 * name, or a Protobuf identifier; then it is the first free name of `Empty2`, `Empty3`, ... So a
 * user model named `Empty` keeps its name, its fields, and its `messageName`, and `inputType` /
 * `outputType` never leave open which of the two they mean. Every adapter compares against this
 * name, never against the literal `Empty`.
 */
export function emptyMessageName(model: WireNameScope): string {
  const taken = new Set<string>()
  const take = (...names: readonly (string | undefined)[]): void => {
    for (const name of names) {
      if (name !== undefined) taken.add(name).add(protoIdentifier(name))
    }
  }
  for (const entity of model.models) take(entity.name, entity.messageName, entity.protobufMessageName)
  for (const entity of model.enums) take(entity.name)
  for (const service of model.services) take(service.name, service.serviceName)

  let name = 'Empty'
  for (let suffix = 2; taken.has(name); suffix++) name = `Empty${suffix}`
  return name
}
