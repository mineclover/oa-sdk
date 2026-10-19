import {
  isNumeric,
  navigateProgram,
  type DecoratorContext,
  type Interface,
  type Model,
  type ModelProperty,
  type Numeric,
  type Operation,
  type Program,
} from '@typespec/compiler'
import { getExtensions, setExtension } from '@typespec/openapi'
import { reportDiagnostic } from './lib.js'
import {
  PROTOBUF_EXTENSION,
  PROTOBUF_FIELD_EXTENSION,
  RPC_EXTENSION,
  WIRE_FORMAT_EXTENSION,
  VALID_WIRE_FORMATS,
  VALID_RPC_STREAMING,
  VALID_PROTOBUF_SCALAR_TYPES,
  namespace,
} from './constants.js'

export {
  PROTOBUF_EXTENSION,
  PROTOBUF_FIELD_EXTENSION,
  RPC_EXTENSION,
  WIRE_FORMAT_EXTENSION,
  VALID_WIRE_FORMATS,
  VALID_RPC_STREAMING,
  VALID_PROTOBUF_SCALAR_TYPES,
  namespace,
}

/** Highest field number Protocol Buffers allows (2^29 - 1). */
const MAX_FIELD_NUMBER = 536_870_911

/**
 * Declares a Model for Protocol Buffers wire serialization.
 * Emits the `x-oa-sdk-protobuf` OpenAPI extension.
 *
 * On an Interface it reports `invalid-protobuf-rule`: OpenAPI has no place for interface-level
 * extensions, so the options would be lost. Set the package on each message model, and the
 * service name with `@rpc(#{ serviceName })` on the interface.
 */
export function $protobuf(
  context: DecoratorContext,
  target: Model | Interface,
  options?: Record<string, unknown>,
): void {
  if (target.kind === 'Interface') {
    reportDiagnostic(context.program, {
      code: 'invalid-protobuf-rule',
      target: context.decoratorTarget,
      format: {
        message: `@protobuf applies to models, not to interface "${target.name}". Put @protobuf on each message model, and @rpc(#{ serviceName }) on the interface.`,
      },
    })
    return
  }

  const payload: Record<string, unknown> = {}
  if (options && typeof options === 'object') {
    if (typeof options.messageName === 'string') payload.messageName = options.messageName
    if (typeof options.package === 'string') payload.package = options.package
  }

  setExtension(context.program, target, PROTOBUF_EXTENSION, payload)
}

/**
 * Declares a field tag number and optional scalar wire type for Protobuf serialization.
 * Emits the `x-oa-sdk-protobuf-field` OpenAPI extension.
 *
 * A number already used by another field of the same model (including inherited fields) is
 * reported by `$onValidate`, once every decorator has run.
 */
export function $field(
  context: DecoratorContext,
  target: ModelProperty,
  index: number | Numeric,
  options?: Record<string, unknown>,
): void {
  const numIndex = fieldNumber(index)

  if (numIndex === undefined || !Number.isInteger(numIndex) || numIndex < 1 || numIndex > MAX_FIELD_NUMBER) {
    reportDiagnostic(context.program, {
      code: 'invalid-protobuf-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: `Field number must be a positive integer between 1 and 536,870,911 (received: ${numIndex ?? String(index)}).`,
      },
    })
    return
  }

  // Reserved field numbers in protobuf: 19000 to 19999
  if (numIndex >= 19000 && numIndex <= 19999) {
    reportDiagnostic(context.program, {
      code: 'invalid-protobuf-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: `Field numbers 19000-19999 are reserved for Protocol Buffers implementation (received: ${numIndex}).`,
      },
    })
    return
  }

  const payload: Record<string, unknown> = {
    index: numIndex,
  }

  if (options && typeof options === 'object') {
    if (typeof options.type === 'string') {
      const scalarType = options.type.toLowerCase()
      if (!VALID_PROTOBUF_SCALAR_TYPES.has(scalarType)) {
        reportDiagnostic(context.program, {
          code: 'invalid-protobuf-rule',
          target: context.getArgumentTarget(1) ?? target,
          format: {
            message: `Invalid Protobuf scalar type "${options.type}". Expected one of: ${[...VALID_PROTOBUF_SCALAR_TYPES].join(', ')}.`,
          },
        })
        return
      }
      payload.type = scalarType
    }
    if (typeof options.repeated === 'boolean') payload.repeated = options.repeated
    if (typeof options.packed === 'boolean') payload.packed = options.packed
  }

  setExtension(context.program, target, PROTOBUF_FIELD_EXTENSION, payload)
}

/**
 * `valueof integer` arrives as a JS number when it fits, otherwise as a `Numeric`. Undefined when
 * the value is not a number or cannot be represented as one without losing precision.
 */
function fieldNumber(index: unknown): number | undefined {
  if (typeof index === 'number') return index
  if (isNumeric(index)) return index.asNumber() ?? undefined
  return undefined
}

/**
 * Declares an Operation, or every operation of an Interface, as an RPC service method.
 * Emits the `x-oa-sdk-rpc` OpenAPI extension on each operation.
 *
 * On an Interface, `serviceName` and `streaming` apply to all of its operations; an operation's
 * own `@rpc` values win. `methodName` names one operation, so on an Interface it reports
 * `invalid-rpc-rule`.
 */
export function $rpc(
  context: DecoratorContext,
  target: Operation | Interface,
  options?: Record<string, unknown>,
): void {
  const payload: Record<string, unknown> = {}

  if (options && typeof options === 'object') {
    if (typeof options.methodName === 'string') {
      if (target.kind === 'Interface') {
        reportDiagnostic(context.program, {
          code: 'invalid-rpc-rule',
          target: context.getArgumentTarget(0) ?? target,
          format: {
            message: `methodName names a single operation; set it with @rpc on an operation of interface "${target.name}", not on the interface.`,
          },
        })
        return
      }
      payload.methodName = options.methodName
    }
    if (typeof options.serviceName === 'string') payload.serviceName = options.serviceName
    if (typeof options.streaming === 'string') {
      const streaming = options.streaming.toLowerCase()
      if (!VALID_RPC_STREAMING.has(streaming)) {
        reportDiagnostic(context.program, {
          code: 'invalid-rpc-rule',
          target: context.getArgumentTarget(0) ?? target,
          format: {
            message: `Invalid RPC streaming mode "${options.streaming}". Expected one of: ${[...VALID_RPC_STREAMING].join(', ')}.`,
          },
        })
        return
      }
      payload.streaming = streaming
    }
  }

  if (target.kind === 'Operation') {
    // Interface values the operation does not set itself; empty unless the interface's @rpc ran first.
    const inherited = target.interface ? extensionRecord(context.program, target.interface, RPC_EXTENSION) : undefined
    setExtension(context.program, target, RPC_EXTENSION, { ...inherited, ...payload })
    return
  }

  // Kept on the interface so an operation decorated later can still inherit it.
  setExtension(context.program, target, RPC_EXTENSION, payload)
  for (const operation of target.operations.values()) {
    const own = extensionRecord(context.program, operation, RPC_EXTENSION)
    setExtension(context.program, operation, RPC_EXTENSION, { ...payload, ...own })
  }
}

/**
 * Declares explicit wire format for communication compression.
 * Emits the `x-oa-sdk-wire-format` OpenAPI extension.
 *
 * On an Interface it sets the format of every operation that does not declare its own.
 */
export function $wireFormat(
  context: DecoratorContext,
  target: Model | Operation | Interface,
  format: string,
): void {
  if (typeof format !== 'string' || !VALID_WIRE_FORMATS.has(format.toLowerCase())) {
    reportDiagnostic(context.program, {
      code: 'invalid-wire-format',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: `Invalid wire format "${format}". Expected one of: ${[...VALID_WIRE_FORMATS].join(', ')}.`,
      },
    })
    return
  }

  const wireFormat = format.toLowerCase()
  setExtension(context.program, target, WIRE_FORMAT_EXTENSION, wireFormat)
  if (target.kind !== 'Interface') return
  for (const operation of target.operations.values()) {
    if (!getExtensions(context.program, operation).has(WIRE_FORMAT_EXTENSION)) {
      setExtension(context.program, operation, WIRE_FORMAT_EXTENSION, wireFormat)
    }
  }
}

/**
 * Library validation, run by the TypeSpec compiler after every decorator: reports a Protobuf field
 * number that a model already uses for another of its fields, own or inherited. The generated
 * schema and codecs could not tell those fields apart. A property that redeclares an inherited one
 * replaces it, as in the wire message, so it may keep the inherited number or free it.
 */
export function $onValidate(program: Program): void {
  const reported = new Map<unknown, Set<string>>()
  navigateProgram(program, {
    model(model) {
      validateFieldNumbers(program, model, reported)
    },
  })
}

function validateFieldNumbers(program: Program, model: Model, reported: Map<unknown, Set<string>>): void {
  for (const { index, target, other } of fieldNumberConflicts(program, model)) {
    // Template instances and `model is` copies share the declaration's syntax node and repeat its
    // conflicts; report each conflict of a declaration once.
    const key = target.node ?? target
    const conflicts = reported.get(key) ?? new Set<string>()
    const conflict = `${index}\0${other.name}`
    if (conflicts.has(conflict)) continue
    reported.set(key, conflicts.add(conflict))
    reportDiagnostic(program, {
      code: 'invalid-protobuf-rule',
      target,
      format: {
        message: `Field number ${index} is already used by "${other.name}" in model ${model.name}.`,
      },
    })
  }
}

interface WireMessageField {
  readonly property: ModelProperty
  /** Declared by the model itself (spread and `model is` members included), not inherited. */
  readonly own: boolean
}

interface FieldNumberConflict {
  readonly index: number
  /** The model's own property of the conflict, which the diagnostic points at. */
  readonly target: ModelProperty
  readonly other: ModelProperty
}

/**
 * Field numbers used twice among the fields of the model's wire message. Those are the fields the
 * wire extractor merges: base models first, and a property that redeclares an inherited one (a
 * discriminator narrowed to a literal, for example) replacing it, so its number frees the
 * inherited one. A conflict between two inherited fields belongs to the base model that brings
 * them together, which reports it itself.
 */
function fieldNumberConflicts(program: Program, model: Model): FieldNumberConflict[] {
  const lineage: Model[] = []
  for (let current = model.baseModel; current && !lineage.includes(current); current = current.baseModel) lineage.unshift(current)
  const fields = new Map<string, WireMessageField>()
  for (const base of lineage) {
    for (const property of base.properties.values()) fields.set(property.name, { property, own: false })
  }
  for (const property of model.properties.values()) fields.set(property.name, { property, own: true })

  const owners = new Map<number, WireMessageField>()
  const conflicts: FieldNumberConflict[] = []
  for (const field of fields.values()) {
    const index = fieldIndex(program, field.property)
    if (index === undefined) continue
    const owner = owners.get(index)
    if (owner === undefined) {
      owners.set(index, field)
    } else if (field.own) {
      conflicts.push({ index, target: field.property, other: owner.property })
    } else if (owner.own) {
      conflicts.push({ index, target: owner.property, other: field.property })
    }
  }
  return conflicts
}

function fieldIndex(program: Program, property: ModelProperty): number | undefined {
  const index = extensionRecord(program, property, PROTOBUF_FIELD_EXTENSION)?.index
  return typeof index === 'number' ? index : undefined
}

/** An object-valued OpenAPI extension of a type, such as `x-oa-sdk-rpc`. */
function extensionRecord(
  program: Program,
  type: Operation | Interface | ModelProperty,
  key: `x-${string}`,
): Readonly<Record<string, unknown>> | undefined {
  const value: unknown = getExtensions(program, type).get(key)
  return isRecord(value) ? value : undefined
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
