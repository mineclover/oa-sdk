/** 머신 리더블 에러 코드 */
export type MockErrorCode =
  // 요청 바디 / 파라미터 타입 불일치
  | 'TYPE_ERROR'
  // minLength, minimum, maxItems 등 제약 조건 위반
  | 'CONSTRAINT_VIOLATION'
  // required 필드 누락
  | 'MISSING_REQUIRED_FIELD'
  // enum 외의 값
  | 'INVALID_ENUM_VALUE'
  // format (email, uuid, date-time 등) 불일치
  | 'FORMAT_MISMATCH'
  // pattern 불일치
  | 'PATTERN_MISMATCH'
  // Content-Type 헤더 불일치
  | 'PROTOCOL_MISMATCH'
  // Mock 서버가 요청 검증용 JSON Schema를 컴파일할 수 없음
  | 'SCHEMA_COMPILE_ERROR'
  // 정의되지 않은 경로/메서드
  | 'NOT_FOUND'
  // 스키마 검증 통과 (정상)
  | 'SCHEMA_VALID'

/** 검증 파이프라인 단계 */
export type MockValidationStage = 'parse' | 'coerce' | 'validate'

/**
 * Public, non-sensitive summary of a supplied validation value.
 *
 * Validation responses are often logged, forwarded to browser clients, or
 * serialized by an adapter.  They therefore describe a value's shape only;
 * they never contain the submitted string, object, or array contents.
 */
export type MockReceivedValueSummary =
  | { type: 'string'; length: number }
  | { type: 'array'; count: number }
  | { type: 'object'; count: number }
  | { type: 'number' | 'boolean' | 'bigint' | 'symbol' | 'function' | 'null' | 'undefined' }

export type MockErrorDetail = {
  /** JSONPath 형식 필드 경로 (e.g. "/body/email") */
  path: string
  code: MockErrorCode
  message: string
  /**
   * Legacy alias of `received`. It is always a non-sensitive shape summary,
   * never the submitted value.
   */
  value?: MockReceivedValueSummary
  /** Non-sensitive type/length/count summary of the submitted value. */
  received?: MockReceivedValueSummary
  /** 기대했던 값 또는 형식 */
  expected?: string
  /** 위반된 제약 조건 값 (e.g. minLength: 8) */
  constraint?: Record<string, unknown>
  /** 에러 발생 파이프라인 단계 (parse: body 파싱 실패, coerce: 타입 변환 실패, validate: 스키마 검증 실패) */
  stage?: MockValidationStage
}

export type MockValidationResult =
  | { valid: true }
  | { valid: false; errors: MockErrorDetail[] }

export type MockErrorResponse = {
  error: {
    code: MockErrorCode
    message: string
    details: MockErrorDetail[]
    _meta?: {
      operationId?: string
      method: string
      path: string
    }
  }
}
