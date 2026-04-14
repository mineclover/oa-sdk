/**
 * @oa-sdk/typia-mock — type definitions
 *
 * typia ILlmApplication 호환 minimal type stub + 검증 파이프라인 타입.
 * 에러 응답은 @oa-sdk/mock-server의 MockErrorResponse 패턴을 따른다.
 */

// ─── Typia 호환 type stubs ─────────────────────────────────────────────────
// typia의 ILlmFunction/ILlmApplication 최소 인터페이스.
// 소비자가 typia AOT로 생성한 실제 객체와 구조적으로 호환된다.

export type ILlmParseResult =
  | { success: true; data: unknown }
  | { success: false; errors: unknown[] }

export type ILlmValidationSuccess = { success: true; data: unknown }
export type ILlmValidationFailure = {
  success: false
  data: unknown
  errors: Array<{ path: string; expected: string; value: unknown }>
}
export type ILlmValidation = ILlmValidationSuccess | ILlmValidationFailure

/** typia ILlmFunction 최소 형태 */
export type ILlmFunction = {
  name: string
  parameters: Record<string, unknown>
  output?: Record<string, unknown>
  description?: string
  deprecated?: boolean
  tags?: string[]
  parse?(input: string): ILlmParseResult
  coerce?(input: unknown): unknown
  validate?(input: unknown): ILlmValidation
}

/** typia ILlmApplication 최소 형태 */
export type ILlmApplication = {
  functions: ILlmFunction[]
  model?: string
}

// ─── Validation pipeline types ──────────────────────────────────────────────

/** 파이프라인 실패 단계 */
export type ValidationStage = 'parse' | 'coerce' | 'validate'

/** 단일 검증 에러 상세 — typia의 에러 구조를 그대로 전달 */
export type TypiaErrorDetail = {
  /** JSONPath-style 필드 경로 (e.g., "$input.email") */
  path: string
  /** 기대 타입/제약 — typia 원문 그대로 (e.g., "string & Format<\"email\">") */
  expected: string
  /** 실제 수신 값 */
  value: unknown
}

/** 3단계 검증 파이프라인 결과 (판별 유니온) */
export type ValidationResult =
  | { success: true; functionName: string; data: unknown; mock: unknown }
  | {
      success: false
      functionName: string
      stage: ValidationStage
      errors: TypiaErrorDetail[]
      raw?: string
    }

/** GET /functions 응답용 함수 정보 */
export type FunctionInfo = {
  name: string
  description: string | undefined
  parameters: Record<string, unknown>
  output: Record<string, unknown> | undefined
}

// ─── Server types ───────────────────────────────────────────────────────────

export type TypiaMockServerOptions = {
  port?: number
  host?: string
}

export type TypiaMockServer = {
  start(): Promise<void>
  stop(): Promise<void>
  readonly url: string
}

// ─── HTTP 응답 타입 (core ApiError 기반) ────────────────────────────────────

import type { ApiError } from '@oa-sdk/core'

export type TypiaErrorCode =
  | 'PARSE_ERROR'
  | 'COERCE_ERROR'
  | 'VALIDATION_ERROR'
  | 'FUNCTION_NOT_FOUND'
  | 'INVALID_REQUEST'

export type TypiaErrorResponse = ApiError<TypiaErrorCode>

export type TypiaSuccessResponse = {
  success: true
  functionName: string
  data: unknown
  /** output 스키마 기반 mock 응답 (output 스키마가 정의된 경우) */
  mock: unknown
}
