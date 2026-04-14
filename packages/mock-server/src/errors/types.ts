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

export type MockErrorDetail = {
  /** JSONPath 형식 필드 경로 (e.g. "/body/email") */
  path: string
  code: MockErrorCode
  message: string
  /** 실제 수신된 값 (received와 동일, ApiErrorDetail 호환용) */
  value?: unknown
  /** 실제 수신된 값 */
  received?: unknown
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
