import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import type { ValidateFunction } from 'ajv'
import type { OasSchema } from '@oa-sdk/parser'
import { classifyAjvErrors } from '../../errors/classifier.js'
import type { MockErrorDetail } from '../../errors/types.js'

/**
 * OAS 3.2 Schema Object는 JSON Schema Draft 2020-12를 기반으로 한다.
 * 요청과 응답이 같은 dialect 및 format registry를 사용하도록 한 인스턴스를 공유한다.
 */
const ajv = new Ajv2020({ allErrors: true, strict: false, verbose: true, discriminator: true })
addFormats(ajv)

const validatorCache = new WeakMap<object, ValidateFunction<unknown>>()

export type CompileResult =
  | { ok: true; validator: ValidateFunction<unknown> }
  | { ok: false; error: MockErrorDetail }

export type SchemaValidationSubject = '요청' | '응답'

export function runSchemaValidation(
  data: unknown,
  schema: OasSchema,
  basePath: string,
  subject: SchemaValidationSubject = '요청',
): MockErrorDetail[] {
  const compiled = compileSchema(schema, basePath, subject)
  if (!compiled.ok) return [compiled.error]

  const valid = compiled.validator(data)
  if (valid) return []

  return classifyAjvErrors(compiled.validator.errors ?? []).map(error => ({
    ...error,
    path: error.path === '/' ? basePath : `${basePath}${error.path}`,
  }))
}

/**
 * The validator of `schema`, compiled once per schema object.
 *
 * A failure is not remembered, and the next compile of the same object may
 * succeed: Ajv keeps a schema that fails its meta-schema check, so compiling
 * that object again skips the check. Callers that reuse a validation result
 * must not reuse one that reports SCHEMA_COMPILE_ERROR.
 */
export function compileSchema(
  schema: OasSchema,
  basePath: string,
  subject: SchemaValidationSubject = '요청',
): CompileResult {
  const cached = validatorCache.get(schema)
  if (cached) return { ok: true, validator: cached }

  try {
    const validator = ajv.compile(schema)
    validatorCache.set(schema, validator)
    return { ok: true, validator }
  } catch (error) {
    return {
      ok: false,
      error: schemaCompileError(basePath, error instanceof Error ? error.message : String(error), subject),
    }
  }
}

export function schemaCompileError(
  path: string,
  expected: string,
  subject: SchemaValidationSubject = '요청',
): MockErrorDetail {
  return {
    path,
    code: 'SCHEMA_COMPILE_ERROR',
    message: `${subject} 검증 스키마를 컴파일할 수 없습니다`,
    expected,
    stage: 'validate',
  }
}
