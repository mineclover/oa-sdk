/**
 * Core validation pipeline for LLM function call arguments.
 *
 * 3단계 파이프라인:
 *   1. parse   — lenient JSON parse (LLM 출력 quirk 처리)
 *   2. coerce  — 타입 교정 (string "42" → number 42)
 *   3. validate — 스키마 검증
 */

import type {
  ILlmApplication,
  ValidationResult,
  TypiaErrorDetail,
} from '../types.js'
import { getFunction } from './function-registry.js'
import { generateFromSchema } from './generate.js'

/**
 * 전체 3단계 파이프라인: parse → coerce → validate.
 * LLM이 생성한 raw JSON string을 검증할 때 사용한다.
 */
export function validateRawArgs(
  app: ILlmApplication,
  functionName: string,
  rawJson: string,
): ValidationResult {
  const fn = getFunction(app, functionName)
  if (!fn) {
    return {
      success: false,
      functionName,
      stage: 'parse',
      errors: [{ path: '$input', expected: `function "${functionName}"`, value: undefined }],
    }
  }

  // Stage 1: Parse
  if (fn.parse) {
    const parseResult = fn.parse(rawJson)
    if (!parseResult.success) {
      return {
        success: false,
        functionName,
        stage: 'parse',
        errors: [{ path: '$input', expected: 'valid JSON', value: rawJson }],
        raw: rawJson,
      }
    }
    return validateParsedArgs(app, functionName, parseResult.data)
  }

  // parse 함수가 없으면 표준 JSON.parse 폴백
  try {
    return functionArgumentsSchema(app, functionName).safeParse(JSON.parse(rawJson))
  } catch (error) {
    // Only malformed JSON is a parse-stage failure; validator errors propagate as before.
    if (!(error instanceof SyntaxError)) throw error
    return {
      success: false,
      functionName,
      stage: 'parse',
      errors: [{ path: '$input', expected: 'valid JSON', value: rawJson }],
      raw: rawJson,
    }
  }
}

/** The coerce → validate pipeline of one function, shaped as a safeParse validator. */
function functionArgumentsSchema(
  app: ILlmApplication,
  functionName: string,
): { safeParse(data: unknown): ValidationResult } {
  return { safeParse: data => validateParsedArgs(app, functionName, data) }
}

/**
 * coerce → validate 파이프라인.
 * 이미 파싱된 JSON 객체를 검증할 때 사용한다.
 */
export function validateParsedArgs(
  app: ILlmApplication,
  functionName: string,
  data: unknown,
): ValidationResult {
  const fn = getFunction(app, functionName)
  if (!fn) {
    return {
      success: false,
      functionName,
      stage: 'validate',
      errors: [{ path: '$input', expected: `function "${functionName}"`, value: undefined }],
    }
  }

  // Stage 2: Coerce
  let coerced = data
  if (fn.coerce) {
    try {
      coerced = fn.coerce(data)
    } catch {
      return {
        success: false,
        functionName,
        stage: 'coerce',
        errors: [{ path: '$input', expected: 'coercible data', value: data }],
      }
    }
  }

  // Stage 3: Validate
  if (fn.validate) {
    const result = fn.validate(coerced)
    if (result.success) {
      return { success: true, functionName, data: result.data, mock: generateFromSchema(fn.output) }
    }
    const errors: TypiaErrorDetail[] = result.errors.map((e) => ({
      path: e.path,
      expected: e.expected,
      value: e.value,
    }))
    return { success: false, functionName, stage: 'validate', errors }
  }

  // validate 함수 없음 — 통과
  return { success: true, functionName, data: coerced, mock: generateFromSchema(fn.output) }
}
