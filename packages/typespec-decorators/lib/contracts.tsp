import "@typespec/http";

using Http;

namespace OaSdkTypeSpec;

/** 표준 200 OK 단건 성공 응답 래퍼 */
model Ok<T> {
  @statusCode statusCode: 200;
  @body body: T;
}

/** 표준 201 Created 생성 완료 성공 응답 래퍼 */
model Created<T> {
  @statusCode statusCode: 201;
  @body body: T;
}

/** 표준 204 No Content 성공 응답 */
model NoContent<T = void> {
  @statusCode statusCode: 204;
}

/** 표준 페이지네이션 결과 래퍼 */
model PageResult<T> {
  items: T[];
  @minValue(0)
  total: integer;
  @minValue(1)
  page?: integer = 1;
  @minValue(1)
  @maxValue(100)
  limit?: integer = 20;
}

/** 표준 상태코드별 에러 응답 래퍼 */
model ErrorResponse<Status extends integer> {
  @statusCode statusCode: Status;
  @body body: StandardError;
}

/** 표준 에러 응답 스키마 */
model StandardError {
  code: string;
  message: string;
  details?: StandardValidationError[];
  _meta?: {
    operationId?: string;
    requestId?: string;
  };
}

/** 표준 필드 수준 유효성 검사 에러 */
model StandardValidationError {
  path: string;
  message: string;
  received?: unknown;
  expected?: string;
}

/** 가장 흔히 사용되는 표준 HTTP 에러 유니온 */
alias StandardHttpErrors =
  ErrorResponse<400> |
  ErrorResponse<401> |
  ErrorResponse<403> |
  ErrorResponse<404> |
  ErrorResponse<500>;
