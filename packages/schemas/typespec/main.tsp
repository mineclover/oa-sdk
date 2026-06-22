import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

// Scaffolded by oa-gen tsp-export and promoted to the production TypeSpec source.
// Keep schema:typespec-check green before changing generated OpenAPI artifacts.
@extension("x-oa-sdk-security-schemes", #{
  bearerAuth: #{
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "JWT Bearer 토큰 인증"
  },
  oauth2: #{
    type: "oauth2",
    description: "OAuth 2.0 인증 (Authorization Code + Device Authorization 지원)",
    flows: #{
      authorizationCode: #{
        authorizationUrl: "https://auth.example.com/authorize",
        tokenUrl: "https://auth.example.com/token",
        refreshUrl: "https://auth.example.com/token",
        oauth2MetadataUrl: "https://auth.example.com/.well-known/oauth-authorization-server",
        scopes: #[
          #{
            name: "read",
            description: "읽기 권한"
          },
          #{
            name: "write",
            description: "쓰기 권한"
          },
          #{
            name: "admin",
            description: "관리자 권한"
          }
        ]
      },
      deviceAuthorization: #{
        deviceAuthorizationUrl: "https://auth.example.com/device/code",
        tokenUrl: "https://auth.example.com/token",
        oauth2MetadataUrl: "https://auth.example.com/.well-known/oauth-authorization-server",
        scopes: #[
          #{
            name: "read",
            description: "읽기 권한"
          },
          #{
            name: "write",
            description: "쓰기 권한"
          }
        ]
      }
    }
  }
})
@server("http://localhost:3000", "Local dev server")
@server("http://localhost:4010", "Mock server (@oa-sdk/mock-server)")
@service(#{ title: "OA SDK API" })
@info(#{ version: "0.1.0" })
@tagMetadata("health", #{ description: "서버 상태 확인" })
@tagMetadata("users", #{ description: "사용자 관리" })
@tagMetadata("auth", #{ description: "인증 — 토큰 발급/갱신/폐기" })
@tagMetadata("me", #{ description: "셀프 서비스 — 현재 인증된 사용자 자기 자원" })
namespace OaSdkApi;

model bearerAuth is BearerAuth;

@doc("사용자 + 토큰 페어 — 가입/로그인 응답 단위")
@example(#{ user: #{ id: "00000000-0000-0000-0000-000000000001", email: "alice@example.com", name: "Alice", role: "user", createdAt: utcDateTime.fromISO("2024-01-01T00:00:00.000Z") }, tokens: #{ accessToken: "eyJhbGciOi...example", refreshToken: "rt_example_0001", tokenType: "Bearer", expiresIn: 3600 } })
model AuthSession {
  user: User;
  tokens: TokenPair;
}

@doc("비밀번호 재설정 토큰 발송 요청")
model ForgotPasswordRequest {
  @format("email")
  email: string;
}

@doc("로그인 요청")
model LoginRequest {
  @format("email")
  email: string;
  @minLength(1)
  password: string;
}

@doc("토큰 갱신 요청")
model RefreshRequest {
  @minLength(1)
  refreshToken: string;
}

@doc("회원가입 요청")
model RegisterRequest {
  @format("email")
  email: string;
  @minLength(1)
  @maxLength(100)
  name: string;
  @doc("최소 8자 이상")
  @minLength(8)
  password: string;
}

@doc("비밀번호 재설정 요청")
model ResetPasswordRequest {
  @minLength(1)
  token: string;
  @doc("최소 8자 이상")
  @minLength(8)
  newPassword: string;
}

@doc("access/refresh 토큰 페어")
@example(#{ accessToken: "eyJhbGciOi...example", refreshToken: "rt_example_0001", tokenType: "Bearer", expiresIn: 3600 })
model TokenPair {
  @doc("bearerAuth 헤더에 사용할 JWT")
  accessToken: string;
  @doc("/auth/refresh 호출에 사용할 장기 토큰")
  refreshToken: string;
  tokenType: "Bearer";
  @doc("accessToken 만료까지 남은 초")
  @minValue(1)
  expiresIn: integer;
}

@doc("현재 실행 중인 빌드 정보")
@example(#{ version: "0.1.0", gitSha: "a0ca911", builtAt: utcDateTime.fromISO("2026-05-04T00:00:00.000Z") })
model BuildInfo {
  @doc("semver 또는 빌드 식별 라벨")
  version: string;
  @doc("커밋 해시")
  @minLength(7)
  gitSha: string;
  builtAt: utcDateTime;
}

model DependencyStatus {
  name: string;
  status: "ok" | "degraded" | "down";
  @minValue(0)
  latencyMs?: integer;
  message?: string;
}

@example(#{ status: "ok", timestamp: utcDateTime.fromISO("2026-04-04T00:00:00.000Z") })
model HealthStatus {
  status: "ok";
  timestamp: utcDateTime;
}

@doc("readiness probe 결과 — 의존 시스템 검증 포함")
@example(#{ status: "ready", timestamp: utcDateTime.fromISO("2026-05-04T00:00:00.000Z"), dependencies: #[#{ name: "postgres", status: "ok" }] })
model ReadinessReport {
  status: "ready" | "not-ready";
  timestamp: utcDateTime;
  dependencies: DependencyStatus[];
}

@doc("비밀번호 변경 요청")
model ChangePasswordRequest {
  @minLength(1)
  currentPassword: string;
  @doc("최소 8자 이상")
  @minLength(8)
  newPassword: string;
}

@doc("export job 상태")
@example(#{ jobId: "00000000-0000-0000-0000-000000000200", status: "queued", requestedAt: utcDateTime.fromISO("2026-05-04T00:00:00.000Z") })
model ExportJob {
  @format("uuid")
  jobId: string;
  status: "queued" | "running" | "ready" | "failed";
  requestedAt: utcDateTime;
  @doc("status가 ready일 때만 제공")
  @format("uri")
  downloadUrl?: string;
}

@doc("데이터 export 요청")
model ExportRequest {
  format?: "json" | "csv" = "json";
}

@doc("온보딩 가이드 체크리스트")
@example(#{ items: #[#{ id: "complete-profile", title: "프로필 작성", completed: false }] })
model OnboardingChecklist {
  items: OnboardingItem[];
}

model OnboardingItem {
  id: string;
  title: string;
  completed: boolean;
  hint?: string;
}

@doc("역할 변경 이력 단건")
model RoleChangeEvent {
  @format("uuid")
  id: string;
  changedAt: utcDateTime;
  previousRole: "admin" | "user" | "guest";
  newRole: "admin" | "user" | "guest";
  @doc("변경을 수행한 admin의 UUID")
  @format("uuid")
  changedBy: string;
  reason?: string;
}

@doc("셀프 프로필 수정 — role은 포함 불가 (admin 전용)")
model UpdateMeRequest {
  @minLength(1)
  @maxLength(100)
  name?: string;
}

@doc("사용자 PII bulk export 요청. data-eng ETL surface이며 non-admin\nperspective에서는 pseudonymization이 필수입니다.\n")
model AdminUsersExportRequest {
  format?: "json" | "csv" = "json";
  pseudonymize?: boolean = true;
  ...Record<never>;
}

@doc("사용자 생성 요청")
model CreateUserRequest {
  @format("email")
  email: string;
  @minLength(1)
  @maxLength(100)
  name: string;
  @doc("최소 8자 이상")
  @minLength(8)
  password: string;
}

@doc("공개 프로필 — PII 비포함 (email/createdAt 제외)")
@example(#{ id: "00000000-0000-0000-0000-000000000001", name: "Alice", role: "user" })
model PublicUserProfile {
  @format("uuid")
  id: string;
  @minLength(1)
  @maxLength(100)
  name: string;
  role: "admin" | "user" | "guest";
}

@doc("site-admin 사용자 hard purge 요청. deleteUser soft-delete와 구분됩니다.")
model PurgeUserRequest {
  @doc("영구 삭제 감사 사유")
  @minLength(1)
  @maxLength(1000)
  reason: string;
  @doc("legal hold 예외 승인 여부")
  legalHoldOverride?: boolean = false;
  ...Record<never>;
}

@doc("신고 단건")
@example(#{ id: "00000000-0000-0000-0000-000000000300", targetUserId: "00000000-0000-0000-0000-000000000001", reporterUserId: "00000000-0000-0000-0000-000000000002", reason: "harassment", status: "open", createdAt: utcDateTime.fromISO("2026-05-04T00:00:00.000Z") })
model Report {
  @format("uuid")
  id: string;
  @format("uuid")
  targetUserId: string;
  @format("uuid")
  reporterUserId: string;
  reason: "spam" | "harassment" | "hate-speech" | "fraud" | "impersonation" | "other";
  details?: string;
  status: "open" | "under-review" | "resolved" | "dismissed";
  createdAt: utcDateTime;
  resolvedAt?: utcDateTime;
}

@doc("신고 요청 본문")
model ReportRequest {
  reason: "spam" | "harassment" | "hate-speech" | "fraud" | "impersonation" | "other";
  @maxLength(1000)
  details?: string;
}

@doc("사용자 수정 요청 (부분 업데이트 — 모든 필드 optional)")
model UpdateUserRequest {
  @minLength(1)
  @maxLength(100)
  name?: string;
  role?: "admin" | "user" | "guest";
}

@doc("사용자 정보")
@example(#{ id: "00000000-0000-0000-0000-000000000001", email: "alice@example.com", name: "Alice", role: "user", createdAt: utcDateTime.fromISO("2024-01-01T00:00:00.000Z") })
model User {
  @format("uuid")
  id: string;
  @format("email")
  email: string;
  @minLength(1)
  @maxLength(100)
  name: string;
  role: "admin" | "user" | "guest";
  createdAt: utcDateTime;
}

@doc("표준 에러 응답 스키마")
@example(#{ code: "NOT_FOUND", message: "요청한 리소스를 찾을 수 없습니다" })
model Error {
  @doc("머신 리더블 에러 코드 (페르소나 시나리오의 expected assertion 단위)")
  @example("NOT_FOUND")
  code: "BAD_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "SCHEMA_VALIDATION_FAILED" | "RATE_LIMITED" | "INTERNAL_SERVER_ERROR" | "SERVICE_UNAVAILABLE";
  @doc("사람이 읽을 수 있는 에러 설명")
  @example("요청한 리소스를 찾을 수 없습니다")
  message: string;
  details?: ValidationError[];
  _meta?: ErrorMeta;
}

@doc("필드 수준 유효성 검사 에러")
model ValidationError {
  @example("/body/email")
  path: string;
  @example("must match format 'email'")
  message: string;
  @doc("실제 수신된 값")
  @example("not-an-email")
  received?: unknown;
  @example("string with format 'email'")
  expected?: string;
}

model ErrorMeta {
  operationId?: string;
  @format("uuid")
  requestId?: string;
}

@example(#{ items: #[#{ id: "00000000-0000-0000-0000-000000000100", changedAt: utcDateTime.fromISO("2026-04-01T00:00:00.000Z"), previousRole: "user", newRole: "admin", changedBy: "00000000-0000-0000-0000-000000000099", reason: "권한 위임" }], total: 1 })
model ListMyRoleChanges200Body {
  items: RoleChangeEvent[];
  @minValue(0)
  total: integer;
}

@example(#{ items: #[#{ id: "00000000-0000-0000-0000-000000000300", targetUserId: "00000000-0000-0000-0000-000000000001", reporterUserId: "00000000-0000-0000-0000-000000000002", reason: "harassment", status: "open", createdAt: utcDateTime.fromISO("2026-05-04T00:00:00.000Z") }], total: 1 })
model ListModerationReports200Body {
  items: Report[];
  @minValue(0)
  total: integer;
}

@example(#{ items: #[#{ id: "00000000-0000-0000-0000-000000000001", email: "alice@example.com", name: "Alice", role: "user", createdAt: utcDateTime.fromISO("2024-01-01T00:00:00.000Z") }], total: 1 })
model ListUsers200Body {
  items: User[];
  @minValue(0)
  total: integer;
}

@doc("토큰 발송 처리 완료 (본문 없음)")
model ForgotPassword204Response {
  @statusCode statusCode: 204;
}

@doc("잘못된 요청 — 요청 형식 또는 파라미터 오류")
model ForgotPassword400Response {
  @statusCode statusCode: 400;
  @body body: Error;
}

@doc("스키마 유효성 검사 실패")
model ForgotPassword422Response {
  @statusCode statusCode: 422;
  @body body: Error;
}

@doc("요청 제한 초과 — Retry-After 헤더로 재시도 가능 시점 안내")
model ForgotPassword429Response {
  @statusCode statusCode: 429;
  @body body: Error;
  @doc("재시도 가능 시점 (초 단위 정수 또는 HTTP-date)")
  @header("Retry-After")
  @example("30")
  retryAfter: string;
}

@doc("로그인 성공")
model Login200Response {
  @statusCode statusCode: 200;
  @body body: AuthSession;
}

@doc("잘못된 요청 — 요청 형식 또는 파라미터 오류")
model Login400Response {
  @statusCode statusCode: 400;
  @body body: Error;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model Login401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("스키마 유효성 검사 실패")
model Login422Response {
  @statusCode statusCode: 422;
  @body body: Error;
}

@doc("요청 제한 초과 — Retry-After 헤더로 재시도 가능 시점 안내")
model Login429Response {
  @statusCode statusCode: 429;
  @body body: Error;
  @doc("재시도 가능 시점 (초 단위 정수 또는 HTTP-date)")
  @header("Retry-After")
  @example("30")
  retryAfter: string;
}

@doc("로그아웃 완료 (본문 없음)")
model Logout204Response {
  @statusCode statusCode: 204;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model Logout401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("갱신된 토큰 페어")
model RefreshToken200Response {
  @statusCode statusCode: 200;
  @body body: TokenPair;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model RefreshToken401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("스키마 유효성 검사 실패")
model RefreshToken422Response {
  @statusCode statusCode: 422;
  @body body: Error;
}

@doc("회원가입 + 토큰 발급")
model Register201Response {
  @statusCode statusCode: 201;
  @body body: AuthSession;
}

@doc("잘못된 요청 — 요청 형식 또는 파라미터 오류")
model Register400Response {
  @statusCode statusCode: 400;
  @body body: Error;
}

@doc("리소스 충돌 — 중복 식별자 또는 동시성 충돌")
model Register409Response {
  @statusCode statusCode: 409;
  @body body: Error;
}

@doc("스키마 유효성 검사 실패")
model Register422Response {
  @statusCode statusCode: 422;
  @body body: Error;
}

@doc("요청 제한 초과 — Retry-After 헤더로 재시도 가능 시점 안내")
model Register429Response {
  @statusCode statusCode: 429;
  @body body: Error;
  @doc("재시도 가능 시점 (초 단위 정수 또는 HTTP-date)")
  @header("Retry-After")
  @example("30")
  retryAfter: string;
}

@doc("비밀번호 갱신 완료 (본문 없음)")
model ResetPassword204Response {
  @statusCode statusCode: 204;
}

@doc("잘못된 요청 — 요청 형식 또는 파라미터 오류")
model ResetPassword400Response {
  @statusCode statusCode: 400;
  @body body: Error;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model ResetPassword401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("스키마 유효성 검사 실패")
model ResetPassword422Response {
  @statusCode statusCode: 422;
  @body body: Error;
}

@doc("서버 정상")
model GetHealth200Response {
  @statusCode statusCode: 200;
  @body body: HealthStatus;
}

@doc("서비스 사용 불가")
model GetHealth503Response {
  @statusCode statusCode: 503;
  @body body: Error;
}

@doc("트래픽 수용 가능")
model GetReadiness200Response {
  @statusCode statusCode: 200;
  @body body: ReadinessReport;
}

@doc("서비스 사용 불가")
model GetReadiness503Response {
  @statusCode statusCode: 503;
  @body body: Error;
}

@doc("SSE 이벤트 스트림")
model StreamHealthEvents200Response {
  @statusCode statusCode: 200;
}

@doc("서비스 사용 불가")
model StreamHealthEvents503Response {
  @statusCode statusCode: 503;
  @body body: Error;
}

@doc("빌드 정보")
model GetVersion200Response {
  @statusCode statusCode: 200;
  @body body: BuildInfo;
}

@doc("비밀번호 변경 완료 (본문 없음)")
model ChangeMyPassword204Response {
  @statusCode statusCode: 204;
}

@doc("잘못된 요청 — 요청 형식 또는 파라미터 오류")
model ChangeMyPassword400Response {
  @statusCode statusCode: 400;
  @body body: Error;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model ChangeMyPassword401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("스키마 유효성 검사 실패")
model ChangeMyPassword422Response {
  @statusCode statusCode: 422;
  @body body: Error;
}

@doc("export job 등록 완료")
model RequestMyDataExport202Response {
  @statusCode statusCode: 202;
  @body body: ExportJob;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model RequestMyDataExport401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("요청 제한 초과 — Retry-After 헤더로 재시도 가능 시점 안내")
model RequestMyDataExport429Response {
  @statusCode statusCode: 429;
  @body body: Error;
  @doc("재시도 가능 시점 (초 단위 정수 또는 HTTP-date)")
  @header("Retry-After")
  @example("30")
  retryAfter: string;
}

@doc("체크리스트")
model GetOnboardingChecklist200Response {
  @statusCode statusCode: 200;
  @body body: OnboardingChecklist;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model GetOnboardingChecklist401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("내 사용자 정보")
model GetMe200Response {
  @statusCode statusCode: 200;
  @body body: User;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model GetMe401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("탈퇴 처리 완료 (본문 없음)")
model DeleteMyAccount204Response {
  @statusCode statusCode: 204;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model DeleteMyAccount401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("수정된 내 사용자 정보")
model UpdateMe200Response {
  @statusCode statusCode: 200;
  @body body: User;
}

@doc("잘못된 요청 — 요청 형식 또는 파라미터 오류")
model UpdateMe400Response {
  @statusCode statusCode: 400;
  @body body: Error;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model UpdateMe401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("스키마 유효성 검사 실패")
model UpdateMe422Response {
  @statusCode statusCode: 422;
  @body body: Error;
}

@doc("역할 변경 이력")
model ListMyRoleChanges200Response {
  @statusCode statusCode: 200;
  @example(#{ items: #[#{ id: "00000000-0000-0000-0000-000000000100", changedAt: utcDateTime.fromISO("2026-04-01T00:00:00.000Z"), previousRole: "user", newRole: "admin", changedBy: "00000000-0000-0000-0000-000000000099", reason: "권한 위임" }], total: 1 })
  @body body: ListMyRoleChanges200Body;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model ListMyRoleChanges401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("bulk export job 등록 완료")
model RequestUsersExport202Response {
  @statusCode statusCode: 202;
  @body body: ExportJob;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model RequestUsersExport401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("권한 없음 — 접근 거부")
model RequestUsersExport403Response {
  @statusCode statusCode: 403;
  @body body: Error;
}

@doc("요청 제한 초과 — Retry-After 헤더로 재시도 가능 시점 안내")
model RequestUsersExport429Response {
  @statusCode statusCode: 429;
  @body body: Error;
  @doc("재시도 가능 시점 (초 단위 정수 또는 HTTP-date)")
  @header("Retry-After")
  @example("30")
  retryAfter: string;
}

@doc("영구 삭제 완료 (본문 없음)")
model PurgeUser204Response {
  @statusCode statusCode: 204;
}

@doc("잘못된 요청 — 요청 형식 또는 파라미터 오류")
model PurgeUser400Response {
  @statusCode statusCode: 400;
  @body body: Error;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model PurgeUser401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("권한 없음 — 접근 거부")
model PurgeUser403Response {
  @statusCode statusCode: 403;
  @body body: Error;
}

@doc("리소스를 찾을 수 없음")
model PurgeUser404Response {
  @statusCode statusCode: 404;
  @body body: Error;
}

@doc("신고 큐")
model ListModerationReports200Response {
  @statusCode statusCode: 200;
  @example(#{ items: #[#{ id: "00000000-0000-0000-0000-000000000300", targetUserId: "00000000-0000-0000-0000-000000000001", reporterUserId: "00000000-0000-0000-0000-000000000002", reason: "harassment", status: "open", createdAt: utcDateTime.fromISO("2026-05-04T00:00:00.000Z") }], total: 1 })
  @body body: ListModerationReports200Body;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model ListModerationReports401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("권한 없음 — 접근 거부")
model ListModerationReports403Response {
  @statusCode statusCode: 403;
  @body body: Error;
}

@doc("사용자 정보")
model GetUserById200Response {
  @statusCode statusCode: 200;
  @body body: User;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model GetUserById401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("리소스를 찾을 수 없음")
model GetUserById404Response {
  @statusCode statusCode: 404;
  @body body: Error;
}

@doc("삭제 완료 (본문 없음)")
model DeleteUser204Response {
  @statusCode statusCode: 204;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model DeleteUser401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("리소스를 찾을 수 없음")
model DeleteUser404Response {
  @statusCode statusCode: 404;
  @body body: Error;
}

@doc("수정된 사용자 정보")
model UpdateUser200Response {
  @statusCode statusCode: 200;
  @body body: User;
}

@doc("잘못된 요청 — 요청 형식 또는 파라미터 오류")
model UpdateUser400Response {
  @statusCode statusCode: 400;
  @body body: Error;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model UpdateUser401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("권한 없음 — 접근 거부")
model UpdateUser403Response {
  @statusCode statusCode: 403;
  @body body: Error;
}

@doc("리소스를 찾을 수 없음")
model UpdateUser404Response {
  @statusCode statusCode: 404;
  @body body: Error;
}

@doc("스키마 유효성 검사 실패")
model UpdateUser422Response {
  @statusCode statusCode: 422;
  @body body: Error;
}

@doc("공개 프로필")
model GetPublicUserProfile200Response {
  @statusCode statusCode: 200;
  @body body: PublicUserProfile;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model GetPublicUserProfile401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("리소스를 찾을 수 없음")
model GetPublicUserProfile404Response {
  @statusCode statusCode: 404;
  @body body: Error;
}

@doc("신고 접수 완료")
model ReportUser201Response {
  @statusCode statusCode: 201;
  @body body: Report;
}

@doc("잘못된 요청 — 요청 형식 또는 파라미터 오류")
model ReportUser400Response {
  @statusCode statusCode: 400;
  @body body: Error;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model ReportUser401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("스키마 유효성 검사 실패")
model ReportUser422Response {
  @statusCode statusCode: 422;
  @body body: Error;
}

@doc("요청 제한 초과 — Retry-After 헤더로 재시도 가능 시점 안내")
model ReportUser429Response {
  @statusCode statusCode: 429;
  @body body: Error;
  @doc("재시도 가능 시점 (초 단위 정수 또는 HTTP-date)")
  @header("Retry-After")
  @example("30")
  retryAfter: string;
}

@doc("사용자 목록")
model ListUsers200Response {
  @statusCode statusCode: 200;
  @example(#{ items: #[#{ id: "00000000-0000-0000-0000-000000000001", email: "alice@example.com", name: "Alice", role: "user", createdAt: utcDateTime.fromISO("2024-01-01T00:00:00.000Z") }], total: 1 })
  @body body: ListUsers200Body;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model ListUsers401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("사용자 생성 완료")
model CreateUser201Response {
  @statusCode statusCode: 201;
  @body body: User;
}

@doc("잘못된 요청 — 요청 형식 또는 파라미터 오류")
model CreateUser400Response {
  @statusCode statusCode: 400;
  @body body: Error;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model CreateUser401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("스키마 유효성 검사 실패")
model CreateUser422Response {
  @statusCode statusCode: 422;
  @body body: Error;
}

@doc("서버 내부 오류")
model CreateUser500Response {
  @statusCode statusCode: 500;
  @body body: Error;
}

@summary("비밀번호 재설정 토큰 발송 (공개)")
@doc("이메일로 reset 토큰 링크를 발송합니다. 이메일이 시스템에 없어도 동일한 204를\n반환 (enumeration 방지). 인증 불필요.\n")
@tag("auth")
@operationId("forgotPassword")
@route("/auth/forgot-password")
@post
@extension("x-oa-sdk-operation-examples", #{
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            email: "alice@example.com"
          },
          serializedValue: "{\"email\":\"alice@example.com\"}"
        }
      }
    }
  },
  responses: #{
    status_400_application_json: #{
      statusCode: "400",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "BAD_REQUEST",
            message: "요청 형식이 올바르지 않습니다"
          },
          serializedValue: "{\"code\":\"BAD_REQUEST\",\"message\":\"요청 형식이 올바르지 않습니다\"}"
        }
      }
    },
    status_422_application_json: #{
      statusCode: "422",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "SCHEMA_VALIDATION_FAILED",
            message: "요청 본문이 스키마 유효성 검사를 통과하지 못했습니다"
          },
          serializedValue: "{\"code\":\"SCHEMA_VALIDATION_FAILED\",\"message\":\"요청 본문이 스키마 유효성 검사를 통과하지 못했습니다\"}"
        }
      }
    },
    status_429_application_json: #{
      statusCode: "429",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "RATE_LIMITED",
            message: "요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요"
          },
          serializedValue: "{\"code\":\"RATE_LIMITED\",\"message\":\"요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요\"}"
        }
      }
    }
  }
})
op forgotPassword(
  @body body: ForgotPasswordRequest,
): ForgotPassword204Response | ForgotPassword400Response | ForgotPassword422Response | ForgotPassword429Response;

@summary("로그인 (공개)")
@doc("이메일과 비밀번호를 검증하고 access/refresh 토큰 페어를 발급합니다. 인증 불필요.")
@tag("auth")
@operationId("login")
@route("/auth/login")
@post
@extension("x-oa-sdk-operation-examples", #{
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            email: "alice@example.com",
            password: "secure1234"
          },
          serializedValue: "{\"email\":\"alice@example.com\",\"password\":\"secure1234\"}"
        }
      }
    }
  },
  responses: #{
    status_200_application_json: #{
      statusCode: "200",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            user: #{
              id: "00000000-0000-0000-0000-000000000001",
              email: "alice@example.com",
              name: "Alice",
              role: "user",
              createdAt: "2024-01-01T00:00:00.000Z"
            },
            tokens: #{
              accessToken: "eyJhbGciOi...login",
              refreshToken: "rt_login_0001",
              tokenType: "Bearer",
              expiresIn: 3600
            }
          }
        }
      }
    },
    status_400_application_json: #{
      statusCode: "400",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "BAD_REQUEST",
            message: "요청 형식이 올바르지 않습니다"
          },
          serializedValue: "{\"code\":\"BAD_REQUEST\",\"message\":\"요청 형식이 올바르지 않습니다\"}"
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    },
    status_422_application_json: #{
      statusCode: "422",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "SCHEMA_VALIDATION_FAILED",
            message: "요청 본문이 스키마 유효성 검사를 통과하지 못했습니다"
          },
          serializedValue: "{\"code\":\"SCHEMA_VALIDATION_FAILED\",\"message\":\"요청 본문이 스키마 유효성 검사를 통과하지 못했습니다\"}"
        }
      }
    },
    status_429_application_json: #{
      statusCode: "429",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "RATE_LIMITED",
            message: "요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요"
          },
          serializedValue: "{\"code\":\"RATE_LIMITED\",\"message\":\"요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요\"}"
        }
      }
    }
  }
})
op login(
  @body body: LoginRequest,
): Login200Response | Login400Response | Login401Response | Login422Response | Login429Response;

@summary("로그아웃")
@doc("현재 access 토큰과 연결된 세션을 종료합니다. 응답 본문 없음.")
@tag("auth")
@useAuth(bearerAuth)
@operationId("logout")
@route("/auth/logout")
@post
@extension("x-oa-sdk-operation-examples", #{
  responses: #{
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    }
  }
})
op logout(): Logout204Response | Logout401Response;

@summary("토큰 갱신 (공개)")
@doc("유효한 refresh 토큰으로 새 access 토큰 페어를 발급합니다. access 토큰 인증 불필요.")
@tag("auth")
@operationId("refreshToken")
@route("/auth/refresh")
@post
@extension("x-oa-sdk-operation-examples", #{
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            refreshToken: "rt_login_0001"
          },
          serializedValue: "{\"refreshToken\":\"rt_login_0001\"}"
        }
      }
    }
  },
  responses: #{
    status_200_application_json: #{
      statusCode: "200",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            accessToken: "eyJhbGciOi...refreshed",
            refreshToken: "rt_login_0002",
            tokenType: "Bearer",
            expiresIn: 3600
          }
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    },
    status_422_application_json: #{
      statusCode: "422",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "SCHEMA_VALIDATION_FAILED",
            message: "요청 본문이 스키마 유효성 검사를 통과하지 못했습니다"
          },
          serializedValue: "{\"code\":\"SCHEMA_VALIDATION_FAILED\",\"message\":\"요청 본문이 스키마 유효성 검사를 통과하지 못했습니다\"}"
        }
      }
    }
  }
})
op refreshToken(
  @body body: RefreshRequest,
): RefreshToken200Response | RefreshToken401Response | RefreshToken422Response;

@summary("회원가입 (공개)")
@doc("이메일·이름·비밀번호로 신규 사용자 계정을 만들고 토큰 페어를 반환합니다. 인증 불필요.")
@tag("auth")
@operationId("register")
@route("/auth/register")
@post
@extension("x-oa-sdk-operation-examples", #{
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            email: "greg@example.com",
            name: "Greg",
            password: "secure1234"
          },
          serializedValue: "{\"email\":\"greg@example.com\",\"name\":\"Greg\",\"password\":\"secure1234\"}"
        }
      }
    }
  },
  responses: #{
    status_201_application_json: #{
      statusCode: "201",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            user: #{
              id: "00000000-0000-0000-0000-000000000010",
              email: "greg@example.com",
              name: "Greg",
              role: "user",
              createdAt: "2026-05-04T00:00:00.000Z"
            },
            tokens: #{
              accessToken: "eyJhbGciOi...register",
              refreshToken: "rt_register_0001",
              tokenType: "Bearer",
              expiresIn: 3600
            }
          }
        }
      }
    },
    status_400_application_json: #{
      statusCode: "400",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "BAD_REQUEST",
            message: "요청 형식이 올바르지 않습니다"
          },
          serializedValue: "{\"code\":\"BAD_REQUEST\",\"message\":\"요청 형식이 올바르지 않습니다\"}"
        }
      }
    },
    status_409_application_json: #{
      statusCode: "409",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "CONFLICT",
            message: "이미 존재하는 리소스입니다"
          },
          serializedValue: "{\"code\":\"CONFLICT\",\"message\":\"이미 존재하는 리소스입니다\"}"
        }
      }
    },
    status_422_application_json: #{
      statusCode: "422",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "SCHEMA_VALIDATION_FAILED",
            message: "요청 본문이 스키마 유효성 검사를 통과하지 못했습니다"
          },
          serializedValue: "{\"code\":\"SCHEMA_VALIDATION_FAILED\",\"message\":\"요청 본문이 스키마 유효성 검사를 통과하지 못했습니다\"}"
        }
      }
    },
    status_429_application_json: #{
      statusCode: "429",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "RATE_LIMITED",
            message: "요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요"
          },
          serializedValue: "{\"code\":\"RATE_LIMITED\",\"message\":\"요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요\"}"
        }
      }
    }
  }
})
op register(
  @body body: RegisterRequest,
): Register201Response | Register400Response | Register409Response | Register422Response | Register429Response;

@summary("비밀번호 재설정 (공개)")
@doc("forgot-password로 발급받은 reset 토큰과 새 비밀번호로 갱신.")
@tag("auth")
@operationId("resetPassword")
@route("/auth/reset-password")
@post
@extension("x-oa-sdk-operation-examples", #{
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            token: "rt_reset_0001",
            newPassword: "evenmoresecure5678"
          },
          serializedValue: "{\"token\":\"rt_reset_0001\",\"newPassword\":\"evenmoresecure5678\"}"
        }
      }
    }
  },
  responses: #{
    status_400_application_json: #{
      statusCode: "400",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "BAD_REQUEST",
            message: "요청 형식이 올바르지 않습니다"
          },
          serializedValue: "{\"code\":\"BAD_REQUEST\",\"message\":\"요청 형식이 올바르지 않습니다\"}"
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    },
    status_422_application_json: #{
      statusCode: "422",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "SCHEMA_VALIDATION_FAILED",
            message: "요청 본문이 스키마 유효성 검사를 통과하지 못했습니다"
          },
          serializedValue: "{\"code\":\"SCHEMA_VALIDATION_FAILED\",\"message\":\"요청 본문이 스키마 유효성 검사를 통과하지 못했습니다\"}"
        }
      }
    }
  }
})
op resetPassword(
  @body body: ResetPasswordRequest,
): ResetPassword204Response | ResetPassword400Response | ResetPassword401Response | ResetPassword422Response;

@summary("서버 상태 확인")
@doc("서버가 정상 동작 중인지 확인하는 헬스체크 엔드포인트")
@tag("health")
@operationId("getHealth")
@route("/health")
@get
@extension("x-oa-sdk-operation-examples", #{
  responses: #{
    status_200_application_json: #{
      statusCode: "200",
      mediaType: "application/json",
      examples: #{
        ok: #{
          summary: "정상 응답",
          dataValue: #{
            status: "ok",
            timestamp: "2026-04-04T00:00:00.000Z"
          },
          serializedValue: "{\"status\":\"ok\",\"timestamp\":\"2026-04-04T00:00:00.000Z\"}"
        }
      }
    },
    status_503_application_json: #{
      statusCode: "503",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "SERVICE_UNAVAILABLE",
            message: "서비스가 일시적으로 사용 불가합니다"
          },
          serializedValue: "{\"code\":\"SERVICE_UNAVAILABLE\",\"message\":\"서비스가 일시적으로 사용 불가합니다\"}"
        }
      }
    }
  }
})
op getHealth(): GetHealth200Response | GetHealth503Response;

@summary("서버 준비 상태 확인 (readiness)")
@doc("Kubernetes readiness probe / 배포 게이트용. 의존 시스템(DB, queue 등)\n검증 결과를 포함. `getHealth`(liveness)와 별개 — liveness는 프로세스\n살아있음만, readiness는 트래픽을 받을 준비가 됐는지 확인.\n")
@tag("health")
@operationId("getReadiness")
@route("/health/ready")
@get
@extension("x-oa-sdk-operation-examples", #{
  responses: #{
    status_200_application_json: #{
      statusCode: "200",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            status: "ready",
            timestamp: "2026-05-04T00:00:00.000Z",
            dependencies: #[
              #{
                name: "postgres",
                status: "ok",
                latencyMs: 3
              },
              #{
                name: "redis",
                status: "ok",
                latencyMs: 1
              }
            ]
          },
          serializedValue: "{\"status\":\"ready\",\"timestamp\":\"2026-05-04T00:00:00.000Z\",\"dependencies\":[{\"name\":\"postgres\",\"status\":\"ok\",\"latencyMs\":3},{\"name\":\"redis\",\"status\":\"ok\",\"latencyMs\":1}]}"
        }
      }
    },
    status_503_application_json: #{
      statusCode: "503",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "SERVICE_UNAVAILABLE",
            message: "서비스가 일시적으로 사용 불가합니다"
          },
          serializedValue: "{\"code\":\"SERVICE_UNAVAILABLE\",\"message\":\"서비스가 일시적으로 사용 불가합니다\"}"
        }
      }
    }
  }
})
op getReadiness(): GetReadiness200Response | GetReadiness503Response;

@summary("서버 상태 실시간 스트림")
@doc("SSE로 서버 상태 변화를 실시간으로 구독")
@tag("health")
@operationId("streamHealthEvents")
@route("/health/stream")
@get
@extension("x-oa-sdk-operation-examples", #{
  responses: #{
    status_503_application_json: #{
      statusCode: "503",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "SERVICE_UNAVAILABLE",
            message: "서비스가 일시적으로 사용 불가합니다"
          },
          serializedValue: "{\"code\":\"SERVICE_UNAVAILABLE\",\"message\":\"서비스가 일시적으로 사용 불가합니다\"}"
        }
      }
    }
  }
})
op streamHealthEvents(): StreamHealthEvents200Response | StreamHealthEvents503Response;

@summary("빌드/배포 정보 조회")
@doc("현재 실행 중인 빌드의 git sha, 빌드 시각, 배포 버전.")
@tag("health")
@operationId("getVersion")
@route("/version")
@get
@extension("x-oa-sdk-operation-examples", #{
  responses: #{
    status_200_application_json: #{
      statusCode: "200",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            version: "0.1.0",
            gitSha: "a0ca91100000000000000000000000000000000",
            builtAt: "2026-05-04T00:00:00.000Z"
          },
          serializedValue: "{\"version\":\"0.1.0\",\"gitSha\":\"a0ca91100000000000000000000000000000000\",\"builtAt\":\"2026-05-04T00:00:00.000Z\"}"
        }
      }
    }
  }
})
op getVersion(): GetVersion200Response;

@summary("내 비밀번호 변경")
@doc("현재 비밀번호 검증 후 새 비밀번호로 교체합니다. 성공 시 기존 refresh 토큰은\n무효화될 수 있으므로 클라이언트는 재로그인 또는 refresh 흐름을 다시 시작해야 합니다.\n")
@tag("me")
@useAuth(bearerAuth)
@operationId("changeMyPassword")
@route("/me/change-password")
@post
@extension("x-oa-sdk-operation-examples", #{
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            currentPassword: "secure1234",
            newPassword: "evenmoresecure5678"
          },
          serializedValue: "{\"currentPassword\":\"secure1234\",\"newPassword\":\"evenmoresecure5678\"}"
        }
      }
    }
  },
  responses: #{
    status_400_application_json: #{
      statusCode: "400",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "BAD_REQUEST",
            message: "요청 형식이 올바르지 않습니다"
          },
          serializedValue: "{\"code\":\"BAD_REQUEST\",\"message\":\"요청 형식이 올바르지 않습니다\"}"
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    },
    status_422_application_json: #{
      statusCode: "422",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "SCHEMA_VALIDATION_FAILED",
            message: "요청 본문이 스키마 유효성 검사를 통과하지 못했습니다"
          },
          serializedValue: "{\"code\":\"SCHEMA_VALIDATION_FAILED\",\"message\":\"요청 본문이 스키마 유효성 검사를 통과하지 못했습니다\"}"
        }
      }
    }
  }
})
op changeMyPassword(
  @body body: ChangePasswordRequest,
): ChangeMyPassword204Response | ChangeMyPassword400Response | ChangeMyPassword401Response | ChangeMyPassword422Response;

@summary("내 데이터 export 작업 요청")
@doc("GDPR 정보주체 이동권 대응. 비동기 job 생성 후 jobId 반환. 완료 시 별도\n알림 또는 polling으로 다운로드 URL 획득. 동시 진행 1건 제한.\n")
@tag("me")
@useAuth(bearerAuth)
@operationId("requestMyDataExport")
@route("/me/export")
@post
@extension("x-oa-sdk-operation-examples", #{
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            format: "json"
          },
          serializedValue: "{\"format\":\"json\"}"
        }
      }
    }
  },
  responses: #{
    status_202_application_json: #{
      statusCode: "202",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            jobId: "00000000-0000-0000-0000-000000000200",
            status: "queued",
            requestedAt: "2026-05-04T00:00:00.000Z"
          },
          serializedValue: "{\"jobId\":\"00000000-0000-0000-0000-000000000200\",\"status\":\"queued\",\"requestedAt\":\"2026-05-04T00:00:00.000Z\"}"
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    },
    status_429_application_json: #{
      statusCode: "429",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "RATE_LIMITED",
            message: "요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요"
          },
          serializedValue: "{\"code\":\"RATE_LIMITED\",\"message\":\"요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요\"}"
        }
      }
    }
  }
})
op requestMyDataExport(
  @body body?: ExportRequest,
): RequestMyDataExport202Response | RequestMyDataExport401Response | RequestMyDataExport429Response;

@summary("온보딩 체크리스트 조회")
@doc("첫 로그인 시 표시할 가이드 체크리스트. 진행률은 user state에 따름.")
@tag("me")
@useAuth(bearerAuth)
@operationId("getOnboardingChecklist")
@route("/me/onboarding")
@get
@extension("x-oa-sdk-operation-examples", #{
  responses: #{
    status_200_application_json: #{
      statusCode: "200",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            items: #[
              #{
                id: "complete-profile",
                title: "프로필 작성",
                completed: false
              },
              #{
                id: "invite-team",
                title: "팀원 초대",
                completed: false
              }
            ]
          },
          serializedValue: "{\"items\":[{\"id\":\"complete-profile\",\"title\":\"프로필 작성\",\"completed\":false},{\"id\":\"invite-team\",\"title\":\"팀원 초대\",\"completed\":false}]}"
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    }
  }
})
op getOnboardingChecklist(): GetOnboardingChecklist200Response | GetOnboardingChecklist401Response;

@summary("내 정보 조회")
@doc("현재 access 토큰으로 식별되는 사용자의 정보를 반환합니다.")
@tag("me")
@useAuth(bearerAuth)
@operationId("getMe")
@route("/me")
@get
@extension("x-oa-sdk-operation-examples", #{
  responses: #{
    status_200_application_json: #{
      statusCode: "200",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            id: "00000000-0000-0000-0000-000000000001",
            email: "alice@example.com",
            name: "Alice",
            role: "user",
            createdAt: "2024-01-01T00:00:00.000Z"
          }
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    }
  }
})
op getMe(): GetMe200Response | GetMe401Response;

@summary("셀프 계정 탈퇴 (soft-delete)")
@doc("본인 계정 비활성화. PIPA/GDPR right-to-erasure 대응. 30일 이내 복구 가능,\n이후 영구 파기. 응답 본문 없음.\n")
@tag("me")
@useAuth(bearerAuth)
@operationId("deleteMyAccount")
@route("/me")
@delete
@extension("x-oa-sdk-operation-examples", #{
  responses: #{
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    }
  }
})
op deleteMyAccount(): DeleteMyAccount204Response | DeleteMyAccount401Response;

@summary("내 정보 수정 (부분 업데이트)")
@doc("현재 사용자의 name 등 프로필을 수정합니다. role은 셀프 변경 불가 — admin이\n/users/{id} 를 통해서만 변경할 수 있습니다.\n")
@tag("me")
@useAuth(bearerAuth)
@operationId("updateMe")
@route("/me")
@patch
@extension("x-oa-sdk-operation-examples", #{
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            name: "Alice (self-edit)"
          },
          serializedValue: "{\"name\":\"Alice (self-edit)\"}"
        }
      }
    }
  },
  responses: #{
    status_400_application_json: #{
      statusCode: "400",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "BAD_REQUEST",
            message: "요청 형식이 올바르지 않습니다"
          },
          serializedValue: "{\"code\":\"BAD_REQUEST\",\"message\":\"요청 형식이 올바르지 않습니다\"}"
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    },
    status_422_application_json: #{
      statusCode: "422",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "SCHEMA_VALIDATION_FAILED",
            message: "요청 본문이 스키마 유효성 검사를 통과하지 못했습니다"
          },
          serializedValue: "{\"code\":\"SCHEMA_VALIDATION_FAILED\",\"message\":\"요청 본문이 스키마 유효성 검사를 통과하지 못했습니다\"}"
        }
      }
    }
  }
})
op updateMe(
  @body body: UpdateMeRequest,
): UpdateMe200Response | UpdateMe400Response | UpdateMe401Response | UpdateMe422Response;

@summary("내 역할 변경 이력 조회")
@doc("admin이 내 역할을 변경한 이력 일람. target-of-action 페르소나의 surface.\n변경 시점·이전/현재 역할·변경자·사유 포함.\n")
@tag("me")
@useAuth(bearerAuth)
@operationId("listMyRoleChanges")
@route("/me/role-changes")
@get
@extension("x-oa-sdk-operation-examples", #{
  parameters: #{
    query_page: #{
      in: "query",
      name: "page",
      examples: #{
        default: #{
          dataValue: 1,
          serializedValue: "page=1"
        }
      }
    },
    query_limit: #{
      in: "query",
      name: "limit",
      examples: #{
        default: #{
          dataValue: 20,
          serializedValue: "limit=20"
        }
      }
    }
  },
  responses: #{
    status_200_application_json: #{
      statusCode: "200",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            items: #[
              #{
                id: "00000000-0000-0000-0000-000000000100",
                changedAt: "2026-04-01T00:00:00.000Z",
                previousRole: "user",
                newRole: "admin",
                changedBy: "00000000-0000-0000-0000-000000000099",
                reason: "권한 위임"
              }
            ],
            total: 1
          }
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    }
  }
})
op listMyRoleChanges(
  @doc("페이지 번호 (1-based)") @query @minValue(1) page?: integer = 1,
  @doc("페이지당 항목 수") @query @minValue(1) @maxValue(100) limit?: integer = 20,
): ListMyRoleChanges200Response | ListMyRoleChanges401Response;

@summary("사용자 PII bulk export 작업 요청")
@doc("data-eng ETL surface. 사용자 PII bulk export를 비동기 job으로 등록하고\nExportJob을 반환합니다. non-admin perspective로 소비되는 export는\npseudonymization이 필수이며 기본값도 pseudonymize=true입니다. 호출은 audited.\n")
@tag("users")
@useAuth(bearerAuth)
@operationId("requestUsersExport")
@route("/admin/users/export")
@post
@extension("x-oa-sdk-operation-examples", #{
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            format: "json",
            pseudonymize: true
          },
          serializedValue: "{\"format\":\"json\",\"pseudonymize\":true}"
        }
      }
    }
  },
  responses: #{
    status_202_application_json: #{
      statusCode: "202",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            jobId: "00000000-0000-0000-0000-000000000201",
            status: "queued",
            requestedAt: "2026-05-04T00:00:00.000Z"
          },
          serializedValue: "{\"jobId\":\"00000000-0000-0000-0000-000000000201\",\"status\":\"queued\",\"requestedAt\":\"2026-05-04T00:00:00.000Z\"}"
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    },
    status_403_application_json: #{
      statusCode: "403",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "FORBIDDEN",
            message: "이 리소스에 접근할 권한이 없습니다"
          },
          serializedValue: "{\"code\":\"FORBIDDEN\",\"message\":\"이 리소스에 접근할 권한이 없습니다\"}"
        }
      }
    },
    status_429_application_json: #{
      statusCode: "429",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "RATE_LIMITED",
            message: "요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요"
          },
          serializedValue: "{\"code\":\"RATE_LIMITED\",\"message\":\"요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요\"}"
        }
      }
    }
  }
})
op requestUsersExport(
  @body body?: AdminUsersExportRequest,
): RequestUsersExport202Response | RequestUsersExport401Response | RequestUsersExport403Response | RequestUsersExport429Response;

@summary("사용자 영구 삭제")
@doc("site-admin authority only. deleteUser와 달리 30일 soft-delete window를\n우회하는 hard purge입니다. legal hold override 여부와 사유를 감사 로그에\n남기며 호출은 audited.\n")
@tag("users")
@useAuth(bearerAuth)
@operationId("purgeUser")
@route("/admin/users/{id}/purge")
@post
@extension("x-oa-sdk-operation-examples", #{
  parameters: #{
    path_id: #{
      in: "path",
      name: "id",
      examples: #{
        default: #{
          dataValue: "00000000-0000-0000-0000-000000000001",
          serializedValue: "00000000-0000-0000-0000-000000000001"
        }
      }
    }
  },
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            reason: "confirmed policy violation",
            legalHoldOverride: false
          },
          serializedValue: "{\"reason\":\"confirmed policy violation\",\"legalHoldOverride\":false}"
        }
      }
    }
  },
  responses: #{
    status_400_application_json: #{
      statusCode: "400",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "BAD_REQUEST",
            message: "요청 형식이 올바르지 않습니다"
          },
          serializedValue: "{\"code\":\"BAD_REQUEST\",\"message\":\"요청 형식이 올바르지 않습니다\"}"
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    },
    status_403_application_json: #{
      statusCode: "403",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "FORBIDDEN",
            message: "이 리소스에 접근할 권한이 없습니다"
          },
          serializedValue: "{\"code\":\"FORBIDDEN\",\"message\":\"이 리소스에 접근할 권한이 없습니다\"}"
        }
      }
    },
    status_404_application_json: #{
      statusCode: "404",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "NOT_FOUND",
            message: "요청한 리소스를 찾을 수 없습니다"
          },
          serializedValue: "{\"code\":\"NOT_FOUND\",\"message\":\"요청한 리소스를 찾을 수 없습니다\"}"
        }
      }
    }
  }
})
op purgeUser(
  @doc("영구 삭제 대상 사용자 UUID") @path @format("uuid") id: string,
  @body body: PurgeUserRequest,
): PurgeUser204Response | PurgeUser400Response | PurgeUser401Response | PurgeUser403Response | PurgeUser404Response;

@summary("신고 큐 조회 (운영자)")
@doc("운영자(moderator) 전용. 처리 대기/처리 중 신고 일람. status 필터로\nopen/under-review/resolved 등 분기.\n")
@tag("users")
@useAuth(bearerAuth)
@operationId("listModerationReports")
@route("/moderation/reports")
@get
@extension("x-oa-sdk-operation-examples", #{
  parameters: #{
    query_page: #{
      in: "query",
      name: "page",
      examples: #{
        default: #{
          dataValue: 1,
          serializedValue: "page=1"
        }
      }
    },
    query_limit: #{
      in: "query",
      name: "limit",
      examples: #{
        default: #{
          dataValue: 20,
          serializedValue: "limit=20"
        }
      }
    }
  },
  responses: #{
    status_200_application_json: #{
      statusCode: "200",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            items: #[
              #{
                id: "00000000-0000-0000-0000-000000000300",
                targetUserId: "00000000-0000-0000-0000-000000000001",
                reporterUserId: "00000000-0000-0000-0000-000000000002",
                reason: "harassment",
                status: "open",
                createdAt: "2026-05-04T00:00:00.000Z"
              }
            ],
            total: 1
          }
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    },
    status_403_application_json: #{
      statusCode: "403",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "FORBIDDEN",
            message: "이 리소스에 접근할 권한이 없습니다"
          },
          serializedValue: "{\"code\":\"FORBIDDEN\",\"message\":\"이 리소스에 접근할 권한이 없습니다\"}"
        }
      }
    }
  }
})
op listModerationReports(
  @doc("페이지 번호 (1-based)") @query @minValue(1) page?: integer = 1,
  @doc("페이지당 항목 수") @query @minValue(1) @maxValue(100) limit?: integer = 20,
  @doc("신고 상태 필터") @query status?: "open" | "under-review" | "resolved" | "dismissed",
): ListModerationReports200Response | ListModerationReports401Response | ListModerationReports403Response;

@summary("사용자 단건 조회")
@doc("UUID로 특정 사용자의 상세 정보를 조회합니다")
@tag("users")
@useAuth(bearerAuth)
@operationId("getUserById")
@route("/users/{id}")
@get
@extension("x-oa-sdk-operation-examples", #{
  parameters: #{
    path_id: #{
      in: "path",
      name: "id",
      examples: #{
        default: #{
          dataValue: "00000000-0000-0000-0000-000000000001",
          serializedValue: "00000000-0000-0000-0000-000000000001"
        }
      }
    }
  },
  responses: #{
    status_200_application_json: #{
      statusCode: "200",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            id: "00000000-0000-0000-0000-000000000001",
            email: "alice@example.com",
            name: "Alice",
            role: "user",
            createdAt: "2024-01-01T00:00:00.000Z"
          }
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    },
    status_404_application_json: #{
      statusCode: "404",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "NOT_FOUND",
            message: "요청한 리소스를 찾을 수 없습니다"
          },
          serializedValue: "{\"code\":\"NOT_FOUND\",\"message\":\"요청한 리소스를 찾을 수 없습니다\"}"
        }
      }
    }
  }
})
op getUserById(
  @doc("사용자 UUID") @path @format("uuid") id: string,
): GetUserById200Response | GetUserById401Response | GetUserById404Response;

@summary("사용자 삭제")
@doc("UUID로 특정 사용자를 삭제합니다. 복구 불가.")
@tag("users")
@useAuth(bearerAuth)
@operationId("deleteUser")
@route("/users/{id}")
@delete
@extension("x-oa-sdk-operation-examples", #{
  parameters: #{
    path_id: #{
      in: "path",
      name: "id",
      examples: #{
        default: #{
          dataValue: "00000000-0000-0000-0000-000000000001",
          serializedValue: "00000000-0000-0000-0000-000000000001"
        }
      }
    }
  },
  responses: #{
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    },
    status_404_application_json: #{
      statusCode: "404",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "NOT_FOUND",
            message: "요청한 리소스를 찾을 수 없습니다"
          },
          serializedValue: "{\"code\":\"NOT_FOUND\",\"message\":\"요청한 리소스를 찾을 수 없습니다\"}"
        }
      }
    }
  }
})
op deleteUser(
  @doc("사용자 UUID") @path @format("uuid") id: string,
): DeleteUser204Response | DeleteUser401Response | DeleteUser404Response;

@summary("사용자 수정 (부분 업데이트)")
@doc("이름, 역할 등 사용자 정보를 부분적으로 수정합니다")
@tag("users")
@useAuth(bearerAuth)
@operationId("updateUser")
@route("/users/{id}")
@patch
@extension("x-oa-sdk-operation-examples", #{
  parameters: #{
    path_id: #{
      in: "path",
      name: "id",
      examples: #{
        default: #{
          dataValue: "00000000-0000-0000-0000-000000000001",
          serializedValue: "00000000-0000-0000-0000-000000000001"
        }
      }
    }
  },
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            name: "Alice Updated"
          },
          serializedValue: "{\"name\":\"Alice Updated\"}"
        }
      }
    }
  },
  responses: #{
    status_200_application_json: #{
      statusCode: "200",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            id: "00000000-0000-0000-0000-000000000001",
            email: "alice@example.com",
            name: "Alice Updated",
            role: "user",
            createdAt: "2024-01-01T00:00:00.000Z"
          }
        }
      }
    },
    status_400_application_json: #{
      statusCode: "400",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "BAD_REQUEST",
            message: "요청 형식이 올바르지 않습니다"
          },
          serializedValue: "{\"code\":\"BAD_REQUEST\",\"message\":\"요청 형식이 올바르지 않습니다\"}"
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    },
    status_403_application_json: #{
      statusCode: "403",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "FORBIDDEN",
            message: "이 리소스에 접근할 권한이 없습니다"
          },
          serializedValue: "{\"code\":\"FORBIDDEN\",\"message\":\"이 리소스에 접근할 권한이 없습니다\"}"
        }
      }
    },
    status_404_application_json: #{
      statusCode: "404",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "NOT_FOUND",
            message: "요청한 리소스를 찾을 수 없습니다"
          },
          serializedValue: "{\"code\":\"NOT_FOUND\",\"message\":\"요청한 리소스를 찾을 수 없습니다\"}"
        }
      }
    },
    status_422_application_json: #{
      statusCode: "422",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "SCHEMA_VALIDATION_FAILED",
            message: "요청 본문이 스키마 유효성 검사를 통과하지 못했습니다"
          },
          serializedValue: "{\"code\":\"SCHEMA_VALIDATION_FAILED\",\"message\":\"요청 본문이 스키마 유효성 검사를 통과하지 못했습니다\"}"
        }
      }
    }
  }
})
op updateUser(
  @doc("사용자 UUID") @path @format("uuid") id: string,
  @body body: UpdateUserRequest,
): UpdateUser200Response | UpdateUser400Response | UpdateUser401Response | UpdateUser403Response | UpdateUser404Response | UpdateUser422Response;

@summary("공개 프로필 조회")
@doc("다른 user의 공개 가시 정보(이름, 역할). email/createdAt 등 PII 미포함.\n멘션·검색 결과 등에서 사용. user/scoped:read 이상 필요.\n")
@tag("users")
@useAuth(bearerAuth)
@operationId("getPublicUserProfile")
@route("/users/{id}/public")
@get
@extension("x-oa-sdk-operation-examples", #{
  parameters: #{
    path_id: #{
      in: "path",
      name: "id",
      examples: #{
        default: #{
          dataValue: "00000000-0000-0000-0000-000000000001",
          serializedValue: "00000000-0000-0000-0000-000000000001"
        }
      }
    }
  },
  responses: #{
    status_200_application_json: #{
      statusCode: "200",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            id: "00000000-0000-0000-0000-000000000001",
            name: "Alice",
            role: "user"
          },
          serializedValue: "{\"id\":\"00000000-0000-0000-0000-000000000001\",\"name\":\"Alice\",\"role\":\"user\"}"
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    },
    status_404_application_json: #{
      statusCode: "404",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "NOT_FOUND",
            message: "요청한 리소스를 찾을 수 없습니다"
          },
          serializedValue: "{\"code\":\"NOT_FOUND\",\"message\":\"요청한 리소스를 찾을 수 없습니다\"}"
        }
      }
    }
  }
})
op getPublicUserProfile(
  @doc("사용자 UUID") @path @format("uuid") id: string,
): GetPublicUserProfile200Response | GetPublicUserProfile401Response | GetPublicUserProfile404Response;

@summary("사용자 신고")
@doc("혐오·스팸·사기 등 정책 위반 사용자를 운영자에게 신고. 신고자는 인증된\nuser. 동일 신고자→대상 페어는 24시간 내 1회로 rate-limit.\n")
@tag("users")
@useAuth(bearerAuth)
@operationId("reportUser")
@route("/users/{id}/reports")
@post
@extension("x-oa-sdk-operation-examples", #{
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            reason: "harassment",
            details: "공격적 메시지 반복 발신"
          },
          serializedValue: "{\"reason\":\"harassment\",\"details\":\"공격적 메시지 반복 발신\"}"
        }
      }
    }
  },
  responses: #{
    status_201_application_json: #{
      statusCode: "201",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            id: "00000000-0000-0000-0000-000000000300",
            targetUserId: "00000000-0000-0000-0000-000000000001",
            reporterUserId: "00000000-0000-0000-0000-000000000002",
            reason: "harassment",
            status: "open",
            createdAt: "2026-05-04T00:00:00.000Z"
          },
          serializedValue: "{\"id\":\"00000000-0000-0000-0000-000000000300\",\"targetUserId\":\"00000000-0000-0000-0000-000000000001\",\"reporterUserId\":\"00000000-0000-0000-0000-000000000002\",\"reason\":\"harassment\",\"status\":\"open\",\"createdAt\":\"2026-05-04T00:00:00.000Z\"}"
        }
      }
    },
    status_400_application_json: #{
      statusCode: "400",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "BAD_REQUEST",
            message: "요청 형식이 올바르지 않습니다"
          },
          serializedValue: "{\"code\":\"BAD_REQUEST\",\"message\":\"요청 형식이 올바르지 않습니다\"}"
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    },
    status_422_application_json: #{
      statusCode: "422",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "SCHEMA_VALIDATION_FAILED",
            message: "요청 본문이 스키마 유효성 검사를 통과하지 못했습니다"
          },
          serializedValue: "{\"code\":\"SCHEMA_VALIDATION_FAILED\",\"message\":\"요청 본문이 스키마 유효성 검사를 통과하지 못했습니다\"}"
        }
      }
    },
    status_429_application_json: #{
      statusCode: "429",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "RATE_LIMITED",
            message: "요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요"
          },
          serializedValue: "{\"code\":\"RATE_LIMITED\",\"message\":\"요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요\"}"
        }
      }
    }
  }
})
op reportUser(
  @doc("신고 대상 사용자 UUID") @path @format("uuid") id: string,
  @body body: ReportRequest,
): ReportUser201Response | ReportUser400Response | ReportUser401Response | ReportUser422Response | ReportUser429Response;

@summary("사용자 목록 조회")
@doc("페이지네이션과 역할 필터를 지원하는 사용자 목록 API")
@tag("users")
@useAuth(bearerAuth)
@operationId("listUsers")
@route("/users")
@get
@extension("x-oa-sdk-operation-examples", #{
  parameters: #{
    query_page: #{
      in: "query",
      name: "page",
      examples: #{
        default: #{
          dataValue: 1,
          serializedValue: "page=1"
        }
      }
    },
    query_limit: #{
      in: "query",
      name: "limit",
      examples: #{
        default: #{
          dataValue: 20,
          serializedValue: "limit=20"
        }
      }
    }
  },
  responses: #{
    status_200_application_json: #{
      statusCode: "200",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            items: #[
              #{
                id: "00000000-0000-0000-0000-000000000001",
                email: "alice@example.com",
                name: "Alice",
                role: "user",
                createdAt: "2024-01-01T00:00:00.000Z"
              }
            ],
            total: 1
          },
          serializedValue: "{\"items\":[{\"id\":\"00000000-0000-0000-0000-000000000001\",\"email\":\"alice@example.com\",\"name\":\"Alice\",\"role\":\"user\",\"createdAt\":\"2024-01-01T00:00:00.000Z\"}],\"total\":1}"
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    }
  }
})
op listUsers(
  @doc("페이지 번호 (1-based)") @query @minValue(1) page?: integer = 1,
  @doc("페이지당 항목 수") @query @minValue(1) @maxValue(100) limit?: integer = 20,
  @doc("역할 필터") @query role?: "admin" | "user" | "guest",
): ListUsers200Response | ListUsers401Response;

@summary("사용자 생성")
@doc("이메일, 이름, 비밀번호를 받아 새 사용자를 생성합니다")
@tag("users")
@useAuth(bearerAuth)
@operationId("createUser")
@route("/users")
@post
@extension("x-oa-sdk-operation-examples", #{
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            email: "bob@example.com",
            name: "Bob",
            password: "secure1234"
          },
          serializedValue: "{\"email\":\"bob@example.com\",\"name\":\"Bob\",\"password\":\"secure1234\"}"
        }
      }
    }
  },
  responses: #{
    status_201_application_json: #{
      statusCode: "201",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            id: "00000000-0000-0000-0000-000000000002",
            email: "bob@example.com",
            name: "Bob",
            role: "user",
            createdAt: "2024-01-01T00:00:00.000Z"
          }
        }
      }
    },
    status_400_application_json: #{
      statusCode: "400",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "BAD_REQUEST",
            message: "요청 형식이 올바르지 않습니다"
          },
          serializedValue: "{\"code\":\"BAD_REQUEST\",\"message\":\"요청 형식이 올바르지 않습니다\"}"
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    },
    status_422_application_json: #{
      statusCode: "422",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "SCHEMA_VALIDATION_FAILED",
            message: "요청 본문이 스키마 유효성 검사를 통과하지 못했습니다"
          },
          serializedValue: "{\"code\":\"SCHEMA_VALIDATION_FAILED\",\"message\":\"요청 본문이 스키마 유효성 검사를 통과하지 못했습니다\"}"
        }
      }
    },
    status_500_application_json: #{
      statusCode: "500",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "INTERNAL_SERVER_ERROR",
            message: "서버 내부 오류가 발생했습니다"
          },
          serializedValue: "{\"code\":\"INTERNAL_SERVER_ERROR\",\"message\":\"서버 내부 오류가 발생했습니다\"}"
        }
      }
    }
  }
})
op createUser(
  @body body: CreateUserRequest,
): CreateUser201Response | CreateUser400Response | CreateUser401Response | CreateUser422Response | CreateUser500Response;
