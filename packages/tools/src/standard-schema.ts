/**
 * @oa-sdk/tools — StandardSchemaV1 + StandardJSONSchemaV1 Bridge (`toStandardSchemaWithJson`)
 *
 * Bridges TypeSpec-emitted JSON Schema Draft 2020-12 / OpenAPI 3.1/3.2 schemas and
 * standalone type guards directly into `@standard-schema/spec` v1 (`StandardSchemaWithJSON`),
 * enabling `mcp-use` v2 `MCPServer.tool({ schema, outputSchema })` without duplicate Zod definitions.
 */
import {
  normalizeJsonSchema,
  validateToolInput,
  type JsonSchemaObject,
} from './schema.js'
import type { ToolSchema } from './types.js'

export interface StandardSchemaIssue {
  readonly message: string
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined
}

export type StandardSchemaResult<TOutput> =
  | { readonly value: TOutput; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardSchemaIssue> }

export interface StandardJsonSchemaOptions {
  readonly target?: string | undefined
  readonly libraryOptions?: Record<string, unknown> | undefined
}

export interface StandardSchemaV1Props<TInput = unknown, TOutput = TInput> {
  readonly version: 1
  readonly vendor: string
  readonly validate: (
    value: unknown,
  ) => StandardSchemaResult<TOutput> | Promise<StandardSchemaResult<TOutput>>
  readonly jsonSchema: {
    readonly input: (options?: StandardJsonSchemaOptions) => Record<string, unknown>
    readonly output: (options?: StandardJsonSchemaOptions) => Record<string, unknown>
  }
  readonly types?: {
    readonly input: TInput
    readonly output: TOutput
  } | undefined
}

export interface StandardSchemaWithJson<TInput = unknown, TOutput = TInput>
  extends JsonSchemaObject {
  readonly '~standard': StandardSchemaV1Props<TInput, TOutput>
  readonly jsonSchema: JsonSchemaObject
  parse(value: unknown): TOutput
  safeParse(
    value: unknown,
  ): { success: true; data: TOutput } | { success: false; error: { message: string; issues: StandardSchemaIssue[] } }
  validate(value: unknown): value is TOutput
}

/**
 * Wraps any `ToolSchema` (JSON Schema Draft 2020-12, OpenAPI 3.1/3.2 schema object,
 * standalone guard, or Zod schema) into a `StandardSchemaWithJson` object accepted
 * by `mcp-use` v2 (`MCPServer.tool({ schema, outputSchema })`) and `@oa-sdk/tools`.
 * Runtime validation delegates to the original parser, preserving refinements
 * and transformations. An optional guard adds a constraint on the parsed output.
 */
export function toStandardSchemaWithJson<TInput = unknown, TOutput = TInput>(
  schema: ToolSchema<TInput>,
  components?: Record<string, JsonSchemaObject>,
  customGuard?: (value: unknown) => value is TOutput,
): StandardSchemaWithJson<TInput, TOutput> {
  const normalized = normalizeJsonSchema(schema, components)

  const runValidation = (
    value: unknown,
  ): { ok: true; data: TOutput } | { ok: false; message: string; issues: StandardSchemaIssue[] } => {
    const result = validateToolInput<TOutput>(
      schema as unknown as ToolSchema<TOutput>,
      value,
      components,
    )
    if (result.success) {
      if (customGuard && !customGuard(result.data)) {
        const message = 'Validation failed against custom output guard'
        return { ok: false, message, issues: [{ message }] }
      }
      return { ok: true, data: result.data }
    }
    const issues: StandardSchemaIssue[] = result.error
      .split(', ')
      .filter(Boolean)
      .map(msg => ({ message: msg }))
    return {
      ok: false,
      message: result.error,
      issues: issues.length > 0 ? issues : [{ message: 'Validation failed' }],
    }
  }

  const standardProps: StandardSchemaV1Props<TInput, TOutput> = {
    version: 1,
    vendor: '@oa-sdk/tools',
    validate(value: unknown): StandardSchemaResult<TOutput> {
      const res = runValidation(value)
      if (res.ok) {
        return { value: res.data }
      }
      return { issues: res.issues }
    },
    jsonSchema: {
      input: () => ({ ...normalized }),
      output: () => ({ ...normalized }),
    },
  }

  const wrapper: StandardSchemaWithJson<TInput, TOutput> = {
    ...normalized,
    jsonSchema: normalized,
    '~standard': standardProps,
    parse(value: unknown): TOutput {
      const res = runValidation(value)
      if (!res.ok) {
        throw new Error(res.message)
      }
      return res.data
    },
    safeParse(value: unknown) {
      const res = runValidation(value)
      if (res.ok) {
        return { success: true as const, data: res.data }
      }
      return {
        success: false as const,
        error: { message: res.message, issues: res.issues },
      }
    },
    validate(value: unknown): value is TOutput {
      return runValidation(value).ok
    },
  }

  return wrapper
}
