import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import type { OasSchema } from '@oa-sdk/parser'
import { classifyAjvErrors } from '../../errors/classifier.js'
import type { MockErrorDetail } from '../../errors/types.js'

const ajv = new Ajv({ allErrors: true, strict: false, verbose: true, discriminator: true })
addFormats(ajv)

const validatorCache = new WeakMap<object, ReturnType<typeof ajv.compile>>()

export type CompileResult =
  | { ok: true; validator: ReturnType<typeof ajv.compile> }
  | { ok: false; error: MockErrorDetail }

export function runSchemaValidation(data: unknown, schema: OasSchema, basePath: string): MockErrorDetail[] {
  const compiled = compileSchema(schema, basePath)
  if (!compiled.ok) return [compiled.error]

  const valid = compiled.validator(data)
  if (valid) return []

  return classifyAjvErrors(compiled.validator.errors ?? []).map(error => ({
    ...error,
    path: error.path === '/' ? basePath : `${basePath}${error.path}`,
  }))
}

export function compileSchema(schema: OasSchema, basePath: string): CompileResult {
  const cached = validatorCache.get(schema)
  if (cached) return { ok: true, validator: cached }

  try {
    const validator = ajv.compile(schema)
    validatorCache.set(schema, validator)
    return { ok: true, validator }
  } catch (error) {
    return {
      ok: false,
      error: schemaCompileError(basePath, error instanceof Error ? error.message : String(error)),
    }
  }
}

export function schemaCompileError(path: string, expected: string): MockErrorDetail {
  return {
    path,
    code: 'SCHEMA_COMPILE_ERROR',
    message: '요청 검증 스키마를 컴파일할 수 없습니다',
    expected,
    stage: 'validate',
  }
}
