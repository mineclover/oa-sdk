import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

namespace OaSdkApi;

model bearerAuth is BearerAuth;

@doc("표준 에러 응답 스키마")
@extension("example", #{ code: "NOT_FOUND", message: "요청한 리소스를 찾을 수 없습니다" })
@example(#{ code: "NOT_FOUND", message: "요청한 리소스를 찾을 수 없습니다" })
model Error {
  @doc("머신 리더블 에러 코드 (페르소나 시나리오의 expected assertion 단위)")
  @extension("example", "NOT_FOUND")
  code: "BAD_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "SCHEMA_VALIDATION_FAILED" | "RATE_LIMITED" | "INTERNAL_SERVER_ERROR" | "SERVICE_UNAVAILABLE";
  @doc("사람이 읽을 수 있는 에러 설명")
  @extension("example", "요청한 리소스를 찾을 수 없습니다")
  message: string;
  details?: ValidationError[];
  _meta?: {
    operationId?: string;
    @format("uuid")
    requestId?: string;
  };
}

@doc("문자열 수신값의 content-free 진단 요약")
model ValidationReceivedStringSummary {
  type: "string";
  @minValue(0)
  @maxValue(9007199254740991)
  length: safeint;
  ...Record<never>;
}

@doc("배열 수신값의 content-free 진단 요약")
model ValidationReceivedArraySummary {
  type: "array";
  @minValue(0)
  @maxValue(9007199254740991)
  count: safeint;
  ...Record<never>;
}

@doc("객체 수신값의 content-free 진단 요약")
model ValidationReceivedObjectSummary {
  type: "object";
  @minValue(0)
  @maxValue(9007199254740991)
  count: safeint;
  ...Record<never>;
}

@doc("내용을 포함하지 않는 scalar 수신값의 진단 요약")
model ValidationReceivedScalarSummary {
  type: "number" | "boolean" | "bigint" | "symbol" | "function" | "null" | "undefined";
  ...Record<never>;
}

alias ValidationReceivedValueSummary =
  ValidationReceivedStringSummary |
  ValidationReceivedArraySummary |
  ValidationReceivedObjectSummary |
  ValidationReceivedScalarSummary;

@doc("필드 수준 유효성 검사 에러")
model ValidationError {
  @extension("example", "/body/email")
  path: string;
  @extension("example", "must match format 'email'")
  message: string;
  @doc("수신값의 안전한 진단 요약. 원문 문자열·객체·배열·토큰·비밀번호는 반환하지 않습니다.")
  @extension("example", #{ type: "string", length: 12 })
  received?: ValidationReceivedValueSummary;
  @extension("example", "string with format 'email'")
  expected?: string;
}
