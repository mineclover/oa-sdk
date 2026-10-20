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

/**
 * Reads a numeric decorator option. TypeSpec passes `valueof unknown` numbers
 * either as plain numbers or as `Numeric` values (`asNumber()`); a numeric
 * literal type carries a `value` number. A `Numeric` without an exact
 * JavaScript number (`asNumber()` returns `null` or throws for out-of-range
 * values) yields `NaN`, so validation rejects it instead of silently falling
 * back to a default. Any other shape yields `undefined`.
 */
function toNumericOption(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value !== 'object' || value === null) return undefined
  if ('asNumber' in value && typeof value.asNumber === 'function') {
    let resolved: unknown
    try {
      resolved = value.asNumber()
    } catch {
      return Number.NaN
    }
    return typeof resolved === 'number' ? resolved : Number.NaN
  }
  if ('value' in value && typeof value.value === 'number') return value.value
  return undefined
}

type ChunkStreamTarget = Model | Operation | Interface

function reportInvalidRule(context: DecoratorContext, target: ChunkStreamTarget, message: string): void {
  reportDiagnostic(context.program, {
    code: 'invalid-chunk-stream-rule',
    target: context.getArgumentTarget(0) ?? target,
    format: { message },
  })
}

/**
 * Renders a received option value for a diagnostic. Strings are quoted so that
 * `"1024"` is distinguishable from the number `1024`; values without a usable
 * string conversion (e.g. null-prototype objects) fall back to their tag.
 */
function describeOptionValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  try {
    return String(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

/**
 * `options` is declared `valueof unknown` in `lib/chunk-stream.tsp`, so TypeSpec
 * may pass any value (`@chunkStream("x")`, `@chunkStream(null)`, `#[...]`);
 * only a non-array object is an options record.
 */
function isOptionsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface StringOptionRule {
  readonly key: string
  readonly fallback: string
  /** Accepted values with the diagnostic label for an unknown one; any string is accepted when absent. */
  readonly choices?: { readonly label: string; readonly values: ReadonlySet<string> }
}

/**
 * Resolves a string option: the fallback when the option is absent, the value
 * when it is a string (and one of `choices`, when given). Any other value —
 * including `null` or a number — reports `invalid-chunk-stream-rule` and
 * returns `undefined`, so a mistyped option is never silently replaced by its
 * default.
 */
function resolveStringOption(
  context: DecoratorContext,
  target: ChunkStreamTarget,
  options: Record<string, unknown> | undefined,
  rule: StringOptionRule,
): string | undefined {
  const raw = options?.[rule.key]
  if (raw === undefined) return rule.fallback
  const choices = rule.choices
  const expected = choices ? `one of: ${[...choices.values].join(', ')}` : 'a string'
  if (typeof raw !== 'string') {
    reportInvalidRule(context, target, `${rule.key} must be ${expected} (received: ${describeOptionValue(raw)}).`)
    return undefined
  }
  if (choices && !choices.values.has(raw)) {
    reportInvalidRule(context, target, `Unknown ${choices.label} "${raw}". Expected ${expected}.`)
    return undefined
  }
  return raw
}

interface IntegerOptionRule {
  readonly key: string
  readonly min: number
  readonly expected: string
  readonly fallback: number
}

/**
 * Resolves an integer option: the fallback when the option is absent, the value
 * when it is a safe integer of at least `min`. Anything else reports
 * `invalid-chunk-stream-rule` and returns `undefined`, so an override is never
 * silently replaced by the preset value.
 */
function resolveIntegerOption(
  context: DecoratorContext,
  target: ChunkStreamTarget,
  options: Record<string, unknown> | undefined,
  rule: IntegerOptionRule,
): number | undefined {
  const raw = options?.[rule.key]
  if (raw === undefined) return rule.fallback
  const value = toNumericOption(raw)
  if (value !== undefined && Number.isSafeInteger(value) && value >= rule.min) return value
  reportInvalidRule(context, target, `${rule.key} must be ${rule.expected} (received: ${describeOptionValue(raw)}).`)
  return undefined
}

/**
 * Declares Chunk Stream transmission parameters, presets, and memory residency policies
 * on a Model, Operation, or Interface.
 * Emits the `x-oa-sdk-chunk-stream` OpenAPI extension with the same resolved shape as the
 * runtime `defineChunkStreamConfig` (`@oa-sdk/chunk-stream`): explicit `targetChunkBytes`,
 * `maxResidentBytes`, and `maxL1MemoryBytes` override the preset values, and
 * `maxL1MemoryBytes` defaults to half of `maxResidentBytes`. Only an absent option takes its
 * default: an options argument that is not an object, a value of the wrong type (including
 * `null`), an unknown `preset`, `memoryPreset` or `mode`, or a numeric option outside its
 * integer range is reported as an `invalid-chunk-stream-rule` diagnostic and no extension is
 * emitted, instead of being clamped or replaced by the default.
 */
export function $chunkStream(
  context: DecoratorContext,
  target: ChunkStreamTarget,
  options?: Record<string, unknown>,
): void {
  if (options !== undefined && !isOptionsRecord(options)) {
    reportInvalidRule(
      context,
      target,
      `@chunkStream options must be an object (received: ${describeOptionValue(options)}).`,
    )
    return
  }

  const preset = resolveStringOption(context, target, options, {
    key: 'preset',
    fallback: 'optimal-web',
    choices: { label: 'chunk stream preset', values: VALID_CHUNK_STREAM_PRESETS },
  })
  if (preset === undefined) return

  const memoryPreset = resolveStringOption(context, target, options, {
    key: 'memoryPreset',
    fallback: 'standard',
    choices: { label: 'chunk memory preset', values: VALID_CHUNK_MEMORY_PRESETS },
  })
  if (memoryPreset === undefined) return

  const mode = resolveStringOption(context, target, options, {
    key: 'mode',
    fallback: 'adaptive',
    choices: { label: 'chunk stream mode', values: VALID_CHUNK_STREAM_MODES },
  })
  if (mode === undefined) return

  const payloadFormat = resolveStringOption(context, target, options, {
    key: 'payloadFormat',
    fallback: 'ui-action@v1',
  })
  if (payloadFormat === undefined) return

  const positive = 'a positive integer'
  const targetChunkBytes = resolveIntegerOption(context, target, options, {
    key: 'targetChunkBytes',
    min: 1,
    expected: positive,
    fallback: CHUNK_STREAM_PRESET_BYTES[preset] ?? 7168,
  })
  if (targetChunkBytes === undefined) return

  const maxResidentBytes = resolveIntegerOption(context, target, options, {
    key: 'maxResidentBytes',
    min: 1,
    expected: positive,
    fallback: CHUNK_MEMORY_PRESET_BYTES[memoryPreset] ?? 128 * 1024 * 1024,
  })
  if (maxResidentBytes === undefined) return

  const maxL1MemoryBytes = resolveIntegerOption(context, target, options, {
    key: 'maxL1MemoryBytes',
    min: 1,
    expected: positive,
    fallback: Math.round(maxResidentBytes * 0.5),
  })
  if (maxL1MemoryBytes === undefined) return

  const fps = resolveIntegerOption(context, target, options, {
    key: 'fps',
    min: 1,
    expected: positive,
    fallback: 30,
  })
  if (fps === undefined) return

  const chunkFrames = resolveIntegerOption(context, target, options, {
    key: 'chunkFrames',
    min: 1,
    expected: positive,
    fallback: fps,
  })
  if (chunkFrames === undefined) return

  const lookaheadFrames = resolveIntegerOption(context, target, options, {
    key: 'lookaheadFrames',
    min: 1,
    expected: positive,
    fallback: fps * 2,
  })
  if (lookaheadFrames === undefined) return

  const retentionFrames = resolveIntegerOption(context, target, options, {
    key: 'retentionFrames',
    min: 0,
    expected: 'a non-negative integer',
    fallback: fps,
  })
  if (retentionFrames === undefined) return

  const payload: Record<string, unknown> = {
    schemaVersion: 1,
    preset,
    targetChunkBytes,
    memoryPreset,
    maxResidentBytes,
    maxL1MemoryBytes,
    payloadFormat,
    fps,
    chunkFrames,
    mode,
    lookaheadFrames,
    retentionFrames,
  }

  setExtension(context.program, target, CHUNK_STREAM_EXTENSION, payload)
}
