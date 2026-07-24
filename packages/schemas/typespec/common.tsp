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

@doc("필드 수준 유효성 검사 에러")
model ValidationError {
  @extension("example", "/body/email")
  path: string;
  @extension("example", "must match format 'email'")
  message: string;
  @doc("실제 수신된 값")
  @extension("example", "not-an-email")
  received?: unknown;
  @extension("example", "string with format 'email'")
  expected?: string;
}
