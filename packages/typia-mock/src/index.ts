/**
 * @oa-sdk/typia-mock — typia ILlmApplication 기반 LLM 함수 호출 검증 목 서버
 *
 * typia의 3단계 검증 파이프라인(parse → coerce → validate)을
 * HTTP 서버로 노출하여 LLM function call 인자의 유효성을 검증한다.
 *
 * Consumers:
 *   LLM tool-calling 통합 테스트
 *   MCP 서버 검증
 *   AI agent 개발/디버깅
 */

// ─── Types ──────────────────────────────────────────────────────────────────
export type {
  ILlmFunction,
  ILlmApplication,
  ILlmParseResult,
  ILlmValidation,
  ILlmValidationSuccess,
  ILlmValidationFailure,
  ValidationStage,
  TypiaErrorDetail,
  ValidationResult,
  FunctionInfo,
  TypiaMockServerOptions,
  TypiaMockServer,
  TypiaErrorCode,
  TypiaErrorResponse,
  TypiaSuccessResponse,
} from './types.js'

// ─── Core validation ────────────────────────────────────────────────────────
export { validateRawArgs, validateParsedArgs } from './core/validator.js'

// ─── Mock data generation ───────────────────────────────────────────────────
export { generateFromSchema, typiaGenerateAlgebra } from './core/generate.js'

// ─── Function registry ──────────────────────────────────────────────────────
export { listFunctions, getFunction } from './core/function-registry.js'

// ─── Server ─────────────────────────────────────────────────────────────────
export { createTypiaMockServer } from './server/node-http.js'
