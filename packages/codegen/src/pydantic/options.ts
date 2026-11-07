/**
 * S0 — build options. Resolved exactly once; every later stage reads only the resolved object
 * (passes read only the keys they declare, see `passes/index.ts`).
 *
 * Phase 1 exposes nine build options. Settings deferred to a later phase are fixed and listed in
 * `PYDANTIC_FIXED_SETTINGS`; they are not options and nothing reads them from user input.
 */
import type { CodegenPreflightOptions } from '../schema-graph/index.js'

export interface PydanticSemanticOptions {
  /** Open models (no `additionalProperties`/`unevaluatedProperties`). Closed models are always `forbid`. */
  extra: 'ignore' | 'allow' | 'forbid'
  /** `x?: T` (non-nullable optional): `reject-null` adds a validator rejecting explicit `null`. */
  optionalStyle: 'reject-null' | 'plain'
  /** `snake-alias`: snake_case attribute + explicit per-field alias. `preserve`: wire name as attribute. */
  naming: 'snake-alias' | 'preserve'
  /**
   * `ecma`: translate ECMA-262 classes, Rust engine, per-model `python-re` fallback.
   * `raw`: pattern as is. `python-re`: every model uses Python `re`.
   */
  regex: 'ecma' | 'raw' | 'python-re'
  /** Named string enums: `StrEnum` class or `Literal[...]` alias. */
  enumStyle: 'str-enum' | 'literal'
  /** `format: date-time`: `AwareDatetime` or `datetime`. */
  datetime: 'aware' | 'naive'
  /** `format: uri|url`: `str` (round-trip safe) or `AnyUrl` (normalizes values). */
  uri: 'str' | 'any-url'
  /** Integer width formats (`int8`…`uint64`, `int32`, `int64`) become `ge`/`le` bounds, or are ignored. */
  intBounds: 'format' | 'none'
}

export interface PydanticOutputOptions {
  /** Path of the generated module, relative to the output directory. */
  output: string
  /** Also emit the final IR as `<output>.ir.json`. */
  emitIr: boolean
}

export type PydanticPreset = 'default' | 'strict' | 'passthrough'

export type PydanticBuildOptions = Partial<PydanticSemanticOptions> & Partial<PydanticOutputOptions> & {
  preset?: PydanticPreset | undefined
  /** Preflight behaviour; same meaning as `generate-zod`. */
  preflight?: (CodegenPreflightOptions & { force?: boolean | undefined }) | undefined
}

export type ResolvedPydanticBuildOptions = Readonly<PydanticSemanticOptions & PydanticOutputOptions & {
  preset: PydanticPreset
  preflight: Readonly<CodegenPreflightOptions & { force: boolean }>
}>

export const PYDANTIC_DEFAULT_OPTIONS: Readonly<PydanticSemanticOptions & PydanticOutputOptions> = Object.freeze({
  extra: 'ignore',
  optionalStyle: 'reject-null',
  naming: 'snake-alias',
  regex: 'ecma',
  enumStyle: 'str-enum',
  datetime: 'aware',
  uri: 'str',
  intBounds: 'format',
  output: 'models.py',
  emitIr: false,
})

type PresetTable = Readonly<Record<PydanticPreset, Readonly<Partial<PydanticSemanticOptions>>>>

export const PYDANTIC_PRESETS: PresetTable = Object.freeze({
  default: Object.freeze({}),
  strict: Object.freeze({ extra: 'forbid', datetime: 'aware' }),
  passthrough: Object.freeze({ extra: 'allow', naming: 'preserve', uri: 'str' }),
})

/** Settings deferred past Phase 1. Fixed values; they become options only in a later phase. */
export const PYDANTIC_FIXED_SETTINGS = Object.freeze({
  pydanticFloor: '2.11',
  pythonFloor: '3.11',
  unionMode: 'smart',
  frozen: false,
  layout: 'single',
  docstrings: true,
  extensions: 'preserve',
} as const)

const ALLOWED_VALUES: { readonly [K in keyof PydanticSemanticOptions]: readonly PydanticSemanticOptions[K][] } = {
  extra: ['ignore', 'allow', 'forbid'],
  optionalStyle: ['reject-null', 'plain'],
  naming: ['snake-alias', 'preserve'],
  regex: ['ecma', 'raw', 'python-re'],
  enumStyle: ['str-enum', 'literal'],
  datetime: ['aware', 'naive'],
  uri: ['str', 'any-url'],
  intBounds: ['format', 'none'],
}

export const PYDANTIC_SEMANTIC_OPTION_KEYS = Object.freeze(
  Object.keys(ALLOWED_VALUES),
) as readonly (keyof PydanticSemanticOptions)[]

/** Every value each semantic option accepts, for CLI help and option-isolation tests. */
export function pydanticOptionValues<K extends keyof PydanticSemanticOptions>(
  key: K,
): readonly PydanticSemanticOptions[K][] {
  return ALLOWED_VALUES[key]
}

/** Precedence: fixed defaults < preset < explicit options. Throws on an unknown preset or option value. */
export function resolvePydanticBuildOptions(input: PydanticBuildOptions = {}): ResolvedPydanticBuildOptions {
  const preset = input.preset ?? 'default'
  if (!Object.hasOwn(PYDANTIC_PRESETS, preset)) {
    const expected = Object.keys(PYDANTIC_PRESETS).join(', ')
    throw new Error(`Unknown Pydantic preset "${String(preset)}" (expected ${expected})`)
  }

  const semantic: Record<string, unknown> = { ...PYDANTIC_DEFAULT_OPTIONS, ...PYDANTIC_PRESETS[preset] }
  for (const key of PYDANTIC_SEMANTIC_OPTION_KEYS) {
    const value = input[key]
    if (value === undefined) continue
    if (!(ALLOWED_VALUES[key] as readonly unknown[]).includes(value)) {
      throw new Error(`Invalid Pydantic option ${key}="${String(value)}" (expected ${ALLOWED_VALUES[key].join(', ')})`)
    }
    semantic[key] = value
  }

  const output = input.output ?? PYDANTIC_DEFAULT_OPTIONS.output
  if (typeof output !== 'string' || output.length === 0 || !output.endsWith('.py')) {
    throw new Error(`Invalid Pydantic option output="${String(output)}" (expected a relative path ending in .py)`)
  }

  const { force, ...preflight } = input.preflight ?? {}
  return Object.freeze({
    ...(semantic as unknown as PydanticSemanticOptions),
    output,
    emitIr: input.emitIr ?? PYDANTIC_DEFAULT_OPTIONS.emitIr,
    preset,
    preflight: Object.freeze({ ...preflight, force: force ?? false }),
  })
}
