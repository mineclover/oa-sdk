import type { DecoratorContext, Interface, Model, Operation } from '@typespec/compiler'
import { setExtension } from '@typespec/openapi'
import { reportDiagnostic } from './lib.js'
import {
  CHUNK_MEMORY_PRESET_BYTES,
  CHUNK_STREAM_EXTENSION,
  CHUNK_STREAM_PRESET_BYTES,
  VALID_CHUNK_MEMORY_PRESETS,
  VALID_CHUNK_STREAM_MODES,
  VALID_CHUNK_STREAM_PRESETS,
  namespace,
} from './constants.js'

export {
  CHUNK_MEMORY_PRESET_BYTES,
  CHUNK_STREAM_EXTENSION,
  CHUNK_STREAM_PRESET_BYTES,
  VALID_CHUNK_MEMORY_PRESETS,
  VALID_CHUNK_STREAM_MODES,
  VALID_CHUNK_STREAM_PRESETS,
  namespace,
}

function toNumericOption(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (typeof (value as any)?.asNumber === 'function') return (value as any).asNumber()
  if (typeof (value as any)?.value === 'number') return (value as any).value
  return undefined
}

/**
 * Declares Chunk Stream transmission parameters, presets, and memory residency policies
 * on a Model, Operation, or Interface.
 * Emits the `x-oa-sdk-chunk-stream` OpenAPI extension.
 */
export function $chunkStream(
  context: DecoratorContext,
  target: Model | Operation | Interface,
  options?: Record<string, unknown>,
): void {
  const preset = typeof options?.preset === 'string' ? options.preset : 'optimal-web'
  if (!VALID_CHUNK_STREAM_PRESETS.has(preset)) {
    reportDiagnostic(context.program, {
      code: 'invalid-chunk-stream-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: `Unknown chunk stream preset "${preset}". Expected one of: ${[...VALID_CHUNK_STREAM_PRESETS].join(', ')}.`,
      },
    })
    return
  }

  const memoryPreset = typeof options?.memoryPreset === 'string' ? options.memoryPreset : 'standard'
  if (!VALID_CHUNK_MEMORY_PRESETS.has(memoryPreset)) {
    reportDiagnostic(context.program, {
      code: 'invalid-chunk-stream-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: `Unknown chunk memory preset "${memoryPreset}". Expected one of: ${[...VALID_CHUNK_MEMORY_PRESETS].join(', ')}.`,
      },
    })
    return
  }

  const mode = typeof options?.mode === 'string' ? options.mode : 'adaptive'
  if (!VALID_CHUNK_STREAM_MODES.has(mode)) {
    reportDiagnostic(context.program, {
      code: 'invalid-chunk-stream-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: `Invalid chunk stream mode "${mode}". Expected one of: ${[...VALID_CHUNK_STREAM_MODES].join(', ')}.`,
      },
    })
    return
  }

  const fps = toNumericOption(options?.fps) ?? 30
  if (!Number.isInteger(fps) || fps < 1) {
    reportDiagnostic(context.program, {
      code: 'invalid-chunk-stream-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: `fps must be a positive integer (received: ${options?.fps}).`,
      },
    })
    return
  }

  const chunkFrames = toNumericOption(options?.chunkFrames) ?? fps
  if (!Number.isInteger(chunkFrames) || chunkFrames < 1) {
    reportDiagnostic(context.program, {
      code: 'invalid-chunk-stream-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: `chunkFrames must be a positive integer (received: ${options?.chunkFrames}).`,
      },
    })
    return
  }

  const payloadFormat = typeof options?.payloadFormat === 'string' ? options.payloadFormat : 'ui-action@v1'
  const lookaheadFrames = toNumericOption(options?.lookaheadFrames) ?? fps * 2
  const retentionFrames = toNumericOption(options?.retentionFrames) ?? fps

  const payload: Record<string, unknown> = {
    schemaVersion: 1,
    preset,
    targetChunkBytes: CHUNK_STREAM_PRESET_BYTES[preset] ?? 7168,
    memoryPreset,
    maxResidentBytes: CHUNK_MEMORY_PRESET_BYTES[memoryPreset] ?? 128 * 1024 * 1024,
    payloadFormat,
    fps,
    chunkFrames,
    mode,
    lookaheadFrames,
    retentionFrames,
  }

  setExtension(context.program, target, CHUNK_STREAM_EXTENSION, payload)
}
