/**
 * Standard Schema v1 Adapter for TypeSpec emitted JSON Schema
 * Compatible with XState v6 `setup({ schemas })` and Standard Schema ecosystem.
 */

import { createJsonSchemaValidator, type JsonSchemaObject } from '../../../../packages/tools/src/index.js'

export interface StandardIssue {
  readonly message: string
  readonly path?: readonly (string | number | symbol)[]
}

export type StandardResult<T> =
  | { readonly value: T; readonly issues?: undefined }
  | { readonly issues: readonly StandardIssue[]; readonly value?: undefined }

export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (
      value: unknown,
    ) => StandardResult<Output>
    readonly types?: {
      readonly input: Input
      readonly output: Output
    }
  }
}

/**
 * Creates a Standard Schema v1 validator from a JSON Schema Draft 2020-12 definition.
 */
export function createStandardSchema<T = unknown>(
  schema: JsonSchemaObject,
  components?: Record<string, JsonSchemaObject>,
  vendor = 'oa-sdk-typespec',
): StandardSchemaV1<unknown, T> {
  const validator = createJsonSchemaValidator<T>(schema, components)

  return {
    '~standard': {
      version: 1,
      vendor,
      validate(value: unknown): StandardResult<T> {
        const result = validator.validate(value)
        if (result.success) {
          return { value: result.data }
        }
        return {
          issues: [
            {
              message: result.error,
            },
          ],
        }
      },
    },
  }
}
