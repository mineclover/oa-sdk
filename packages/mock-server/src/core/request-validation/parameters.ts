import type { OasParameter, OasSchema } from '@oa-sdk/parser'
import type { MockErrorDetail } from '../../errors/types.js'
import { runSchemaValidation } from './schema-compiler.js'

/** Validates a deserialized parameter against its OpenAPI schema. */
export function validateParameterValue(param: OasParameter, value: unknown): MockErrorDetail[] {
  const path = `/${param.in}/${param.name}`
  if (value === undefined || value === null) {
    return param.required
      ? [{ path, code: 'MISSING_REQUIRED_FIELD', message: `필수 파라미터 누락: '${param.name}'`, stage: 'validate' }]
      : []
  }

  const schema = param.schema as OasSchema | undefined
  if (!schema) return []
  return runSchemaValidation(coerceParameterValue(value, schema), schema, path)
}

/** URL-derived parameter values are strings until their schema supplies a primitive type. */
export function coerceParameterValue(value: unknown, schema: OasSchema): unknown {
  if (typeof value !== 'string') return value
  switch (schema.type) {
    case 'integer': {
      const numeric = Number(value)
      return Number.isNaN(numeric) ? value : Number.isInteger(numeric) ? numeric : value
    }
    case 'number': return Number.isNaN(Number(value)) ? value : parseFloat(value)
    case 'boolean': return value === 'true' ? true : value === 'false' ? false : value
    default: return value
  }
}
