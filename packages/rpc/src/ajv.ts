import Ajv2020 from 'ajv/dist/2020.js'
import type { ErrorObject } from 'ajv'
import type { OasSchema } from '@oa-sdk/parser'
import type { RpcContract, RpcSchemaCheck, RpcValidator } from './types.js'

/** Structural subset of an Ajv instance the validator compiles with. */
export type AjvLike = {
  compile(schema: object): {
    (value: unknown): boolean
    errors?: ErrorObject[] | null | undefined
  }
}

export type AjvValidatorOptions = {
  /**
   * Ajv instance to compile with, e.g. one with `ajv-formats` added. The default is an Ajv 2020-12
   * instance with `strict: false` (OpenAPI keywords such as `example` or `discriminator` are
   * ignored) and without format validation.
   */
  ajv?: AjvLike
}

/** Validates RPC input and output with Ajv (JSON Schema 2020-12, the OpenAPI 3.1+ dialect). */
export function createAjvValidator(options: AjvValidatorOptions = {}): RpcValidator {
  const ajv: AjvLike = options.ajv ?? new Ajv2020({ allErrors: true, strict: false, validateFormats: false })
  return (schema: OasSchema, contract: RpcContract): RpcSchemaCheck => {
    // `#/components/schemas/*` references resolve against the root of the compiled schema.
    const validate = ajv.compile({ ...schema, components: { schemas: contract.schemas } })
    return (value) => {
      if (validate(value)) return []
      return (validate.errors ?? []).map(error => ({
        path: error.instancePath === '' ? '/' : error.instancePath,
        message: describe(error),
      }))
    }
  }
}

function describe(error: ErrorObject): string {
  if (error.keyword === 'required') return `missing required property "${String(error.params.missingProperty)}"`
  if (error.keyword === 'additionalProperties') return `unknown property "${String(error.params.additionalProperty)}"`
  return error.message ?? error.keyword
}
