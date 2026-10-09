import type { DecoratorContext, Model, Interface, ModelProperty, Operation } from '@typespec/compiler'
import { setExtension } from '@typespec/openapi'
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

/**
 * Declares a Model or Interface for Protocol Buffers wire serialization.
 * Emits the `x-oa-sdk-protobuf` OpenAPI extension.
 */
export function $protobuf(
  context: DecoratorContext,
  target: Model | Interface,
  options?: Record<string, unknown>,
): void {
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
 */
export function $field(
  context: DecoratorContext,
  target: ModelProperty,
  index: number,
  options?: Record<string, unknown>,
): void {
  const numIndex = typeof index === 'number'
    ? index
    : typeof (index as any)?.asNumber === 'function'
      ? (index as any).asNumber()
      : typeof (index as any)?.value === 'number'
        ? (index as any).value
        : Number(String(index))

  if (typeof numIndex !== 'number' || !Number.isInteger(numIndex) || numIndex < 1 || numIndex > 536870911) {
    reportDiagnostic(context.program, {
      code: 'invalid-protobuf-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: `Field number must be a positive integer between 1 and 536,870,911 (received: ${numIndex}).`,
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
 * Declares an Operation or Interface as an RPC service method.
 * Emits the `x-oa-sdk-rpc` OpenAPI extension.
 */
export function $rpc(
  context: DecoratorContext,
  target: Operation | Interface,
  options?: Record<string, unknown>,
): void {
  const payload: Record<string, unknown> = {}

  if (options && typeof options === 'object') {
    if (typeof options.methodName === 'string') payload.methodName = options.methodName
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

  setExtension(context.program, target, RPC_EXTENSION, payload)
}

/**
 * Declares explicit wire format for communication compression.
 * Emits the `x-oa-sdk-wire-format` OpenAPI extension.
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

  setExtension(context.program, target, WIRE_FORMAT_EXTENSION, format.toLowerCase())
}
