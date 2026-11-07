from __future__ import annotations
from pydantic import AwareDatetime, BaseModel, ConfigDict, EmailStr, Field, field_validator
from typing import Any, Literal, TypeAlias
from uuid import UUID


ActiveEntityId: TypeAlias = UUID


class AdminUsersExportRequest(BaseModel):
    """사용자 PII bulk export 요청. data-eng ETL surface이며 non-admin
    perspective에서는 pseudonymization이 필수입니다.
    """
    model_config = ConfigDict(extra="forbid")
    format: Literal["json", "csv"] = "json"
    pseudonymize: bool = True

    @field_validator("format", "pseudonymize", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class AdvanceByLogicalDuration(BaseModel):
    """현재 logical time에서 duration만큼 전진하는 요청"""
    model_config = ConfigDict(extra="forbid")
    duration: str
    kind: Literal["by-duration"]


class AdvanceToLogicalTime(BaseModel):
    """현재 logical time에서 target instant까지 전진하는 요청"""
    model_config = ConfigDict(extra="forbid")
    kind: Literal["to-logical-time"]
    targetLogicalTime: str


class TokenPair(BaseModel):
    """access/refresh 토큰 페어"""
    model_config = ConfigDict(extra="allow")
    accessToken: str = Field(..., description="bearerAuth 헤더에 사용할 JWT")
    expiresIn: int = Field(..., description="accessToken 만료까지 남은 초", ge=1)
    refreshToken: str = Field(..., description="/auth/refresh 호출에 사용할 장기 토큰")
    tokenType: Literal["Bearer"]


class User(BaseModel):
    """사용자 정보"""
    model_config = ConfigDict(extra="allow")
    createdAt: AwareDatetime
    email: EmailStr
    id: UUID
    name: str = Field(..., min_length=1, max_length=100)
    role: Literal["admin", "user", "guest"]


class AuthSession(BaseModel):
    """사용자 + 토큰 페어 — 가입/로그인 응답 단위"""
    model_config = ConfigDict(extra="allow")
    tokens: TokenPair
    user: User


class BuildInfo(BaseModel):
    """현재 실행 중인 빌드 정보"""
    model_config = ConfigDict(extra="allow")
    builtAt: AwareDatetime
    gitSha: str = Field(..., description="커밋 해시", min_length=7)
    version: str = Field(..., description="semver 또는 빌드 식별 라벨")


class ChangePasswordRequest(BaseModel):
    """비밀번호 변경 요청"""
    model_config = ConfigDict(extra="allow")
    currentPassword: str = Field(..., min_length=1)
    newPassword: str = Field(..., description="최소 8자 이상", min_length=8)


class CreateUserRequest(BaseModel):
    """사용자 생성 요청"""
    model_config = ConfigDict(extra="allow")
    email: EmailStr
    name: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., description="최소 8자 이상", min_length=8)


class ExecutionProfileRef(BaseModel):
    """World에 고정할 실행 provider 조합의 정확한 식별자"""
    model_config = ConfigDict(extra="allow")
    profileId: str = Field(..., min_length=1)
    semanticFingerprint: str = Field(..., min_length=1)
    version: str = Field(..., min_length=1)


class ModelRef(BaseModel):
    """게시된 World Model artifact의 정확한 식별자"""
    model_config = ConfigDict(extra="allow")
    modelId: str = Field(..., min_length=1)
    semanticFingerprint: str = Field(..., min_length=1)
    version: str = Field(..., min_length=1)


class CreateWorldRequest(BaseModel):
    """새 World bootstrap 요청. 생성 뒤 ModelRef와 ExecutionProfileRef는 normal Stimulus로 바꿀 수 없습니다."""
    model_config = ConfigDict(extra="allow")
    bootstrapSpecRef: str = Field(..., description="모델이 해석하는 초기 scenario/configuration reference", min_length=1)
    executionProfile: ExecutionProfileRef
    modelRef: ModelRef
    runSeedMaterial: str | None = Field(None, description="선택적 replay seed material. 없으면 provider가 생성한 값을 WorldControlState에 고정합니다.")
    worldId: UUID

    @field_validator("runSeedMaterial", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class DependencyStatus(BaseModel):
    model_config = ConfigDict(extra="allow")
    latencyMs: int | None = Field(None, ge=0)
    message: str | None = None
    name: str
    status: Literal["ok", "degraded", "down"]

    @field_validator("latencyMs", "message", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class ValidationReceivedArraySummary(BaseModel):
    """배열 수신값의 content-free 진단 요약"""
    model_config = ConfigDict(extra="forbid")
    count: int = Field(..., ge=0, le=9007199254740991)
    type: Literal["array"]


class ValidationReceivedObjectSummary(BaseModel):
    """객체 수신값의 content-free 진단 요약"""
    model_config = ConfigDict(extra="forbid")
    count: int = Field(..., ge=0, le=9007199254740991)
    type: Literal["object"]


class ValidationReceivedScalarSummary(BaseModel):
    """내용을 포함하지 않는 scalar 수신값의 진단 요약"""
    model_config = ConfigDict(extra="forbid")
    type: Literal["number", "boolean", "bigint", "symbol", "function", "null", "undefined"]


class ValidationReceivedStringSummary(BaseModel):
    """문자열 수신값의 content-free 진단 요약"""
    model_config = ConfigDict(extra="forbid")
    length: int = Field(..., ge=0, le=9007199254740991)
    type: Literal["string"]


class ValidationError(BaseModel):
    """필드 수준 유효성 검사 에러"""
    model_config = ConfigDict(extra="allow")
    expected: str | None = Field(None, examples=["string with format 'email'"])
    message: str = Field(..., examples=["must match format 'email'"])
    path: str = Field(..., examples=["/body/email"])
    received: ValidationReceivedStringSummary | ValidationReceivedArraySummary | ValidationReceivedObjectSummary | ValidationReceivedScalarSummary | None = Field(None, description="수신값의 안전한 진단 요약. 원문 문자열·객체·배열·토큰·비밀번호는 반환하지 않습니다.", examples=[{"length": 12, "type": "string"}])

    @field_validator("expected", "received", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class ErrorMeta(BaseModel):
    model_config = ConfigDict(extra="allow")
    operationId: str | None = None
    requestId: UUID | None = None

    @field_validator("operationId", "requestId", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class Error(BaseModel):
    """표준 에러 응답 스키마"""
    model_config = ConfigDict(extra="allow", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    meta: ErrorMeta | None = Field(None, alias="_meta")
    code: Literal["BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "SCHEMA_VALIDATION_FAILED", "RATE_LIMITED", "INTERNAL_SERVER_ERROR", "SERVICE_UNAVAILABLE"] = Field(..., description="머신 리더블 에러 코드 (페르소나 시나리오의 expected assertion 단위)", examples=["NOT_FOUND"])
    details: list[ValidationError] | None = None
    message: str = Field(..., description="사람이 읽을 수 있는 에러 설명", examples=["요청한 리소스를 찾을 수 없습니다"])

    @field_validator("meta", "details", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class ExecutionProfileSummary(BaseModel):
    """선택 가능한 실행 profile의 공개 요약"""
    model_config = ConfigDict(extra="allow")
    commitIsolation: Literal["single-writer", "optimistic-revision-cas", "serializable-transaction"]
    conformanceProfiles: list[str]
    decisionRandom: Literal["counter-derived", "seeded-stream"]
    numericSemantics: Literal["fixed-decimal", "rational", "strict-binary-float"]
    persistenceRecovery: Literal["volatile", "snapshot-journal", "durable-outbox"]
    profile: ExecutionProfileRef


class ExportJob(BaseModel):
    """export job receipt. 이 계약의 POST 응답은 queued 상태만 반환하며, 이후 상태 전이와 downloadUrl 전달 방식은 runtime 계약이 별도로 정의합니다."""
    model_config = ConfigDict(extra="allow")
    downloadUrl: str | None = Field(None, description="status가 ready일 때만 제공")
    jobId: UUID
    requestedAt: AwareDatetime
    status: Literal["queued", "running", "ready", "failed"]

    @field_validator("downloadUrl", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class ExportRequest(BaseModel):
    """데이터 export 요청"""
    model_config = ConfigDict(extra="allow")
    format: Literal["json", "csv"] = "json"

    @field_validator("format", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class ForgotPasswordRequest(BaseModel):
    """비밀번호 재설정 토큰 발송 요청"""
    model_config = ConfigDict(extra="allow")
    email: EmailStr


class HealthEvent(BaseModel):
    """SSE 헬스 이벤트 payload"""
    model_config = ConfigDict(extra="allow")
    status: Literal["ok", "degraded", "down"] = Field(..., description="관측된 서버 상태")
    timestamp: AwareDatetime = Field(..., description="이벤트 발생 시각")


HealthEvents: TypeAlias = HealthEvent


class HealthStatus(BaseModel):
    model_config = ConfigDict(extra="allow")
    status: Literal["ok"]
    timestamp: AwareDatetime


class ListExecutionProfilesResponseBody(BaseModel):
    model_config = ConfigDict(extra="allow")
    items: list[ExecutionProfileSummary]


class LoginRequest(BaseModel):
    """로그인 요청"""
    model_config = ConfigDict(extra="allow")
    email: EmailStr
    password: str = Field(..., min_length=1)


class OnboardingItem(BaseModel):
    model_config = ConfigDict(extra="allow")
    completed: bool
    hint: str | None = None
    id: str
    title: str

    @field_validator("hint", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class OnboardingChecklist(BaseModel):
    """온보딩 가이드 체크리스트"""
    model_config = ConfigDict(extra="allow")
    items: list[OnboardingItem]


class ProjectionBundleItem(BaseModel):
    """Projection bundle의 outer world/model/revision context를 상속하는 item"""
    model_config = ConfigDict(extra="forbid")
    projectionId: str = Field(..., min_length=1)
    value: Any = Field(..., description="PublishedModel이 선언한 projection result의 typed JSON representation")


class ProjectionBundleEnvelope(BaseModel):
    """같은 revision에서 함께 읽어야 하는 semantic projection bundle"""
    model_config = ConfigDict(extra="allow")
    bundleId: str = Field(..., min_length=1)
    modelRef: ModelRef
    projections: list[ProjectionBundleItem]
    sourceRevision: int = Field(..., ge=0, le=9223372036854775807)
    status: Literal["complete", "incomplete", "stale"]
    worldId: UUID


class ProjectionEnvelope(BaseModel):
    """특정 source revision에서 materialize한 semantic projection"""
    model_config = ConfigDict(extra="allow")
    modelRef: ModelRef
    projectionId: str = Field(..., min_length=1)
    sourceRevision: int = Field(..., ge=0, le=9223372036854775807)
    value: Any = Field(..., description="PublishedModel이 선언한 projection result의 typed JSON representation")
    worldId: UUID


class PublicUserProfile(BaseModel):
    """공개 프로필 — PII 비포함 (email/createdAt 제외)"""
    model_config = ConfigDict(extra="allow")
    id: UUID
    name: str = Field(..., min_length=1, max_length=100)
    role: Literal["admin", "user", "guest"]


class PurgeUserRequest(BaseModel):
    """site-admin 사용자 hard purge 요청. deleteUser와 별도의 권한 및 감사 절차를 적용합니다."""
    model_config = ConfigDict(extra="forbid")
    legalHoldOverride: bool = Field(False, description="legal hold 예외 승인 여부")
    reason: str = Field(..., description="영구 삭제 감사 사유", min_length=1, max_length=1000)

    @field_validator("legalHoldOverride", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class ReadinessReport(BaseModel):
    """readiness probe 결과 — 의존 시스템 검증 포함"""
    model_config = ConfigDict(extra="allow")
    dependencies: list[DependencyStatus]
    status: Literal["ready", "not-ready"]
    timestamp: AwareDatetime


class RefreshRequest(BaseModel):
    """토큰 갱신 요청"""
    model_config = ConfigDict(extra="allow")
    refreshToken: str = Field(..., min_length=1)


class RegisterRequest(BaseModel):
    """회원가입 요청"""
    model_config = ConfigDict(extra="allow")
    email: EmailStr
    name: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., description="최소 8자 이상", min_length=8)


class Report(BaseModel):
    """신고 단건"""
    model_config = ConfigDict(extra="allow")
    createdAt: AwareDatetime
    details: str | None = None
    id: UUID
    reason: Literal["spam", "harassment", "hate-speech", "fraud", "impersonation", "other"]
    reporterUserId: UUID
    resolvedAt: AwareDatetime | None = None
    status: Literal["open", "under-review", "resolved", "dismissed"]
    targetUserId: UUID

    @field_validator("details", "resolvedAt", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class ReportRequest(BaseModel):
    """신고 요청 본문"""
    model_config = ConfigDict(extra="allow")
    details: str | None = Field(None, max_length=1000)
    reason: Literal["spam", "harassment", "hate-speech", "fraud", "impersonation", "other"]

    @field_validator("details", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class ResetPasswordRequest(BaseModel):
    """비밀번호 재설정 요청"""
    model_config = ConfigDict(extra="allow")
    newPassword: str = Field(..., description="최소 8자 이상", min_length=8)
    token: str = Field(..., min_length=1)


class RoleChangeEvent(BaseModel):
    """역할 변경 이력 단건"""
    model_config = ConfigDict(extra="allow")
    changedAt: AwareDatetime
    changedBy: UUID = Field(..., description="변경을 수행한 admin의 UUID")
    id: UUID
    newRole: Literal["admin", "user", "guest"]
    previousRole: Literal["admin", "user", "guest"]
    reason: str | None = None

    @field_validator("reason", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class StimulusAccepted(BaseModel):
    """Agenda가 받아들인 Stimulus. 이 응답은 Transaction commit 성공을 뜻하지 않습니다."""
    model_config = ConfigDict(extra="allow")
    acceptedAtRevision: int = Field(..., ge=0, le=9223372036854775807)
    acceptedLogicalTime: str
    status: Literal["accepted", "duplicate"]
    stimulusId: UUID
    worldId: UUID


class SubmitActionRequestParameters(BaseModel):
    """ActionParameterDefinition stable ID에서 typed JSON value로의 binding"""
    model_config = ConfigDict(extra="allow")
    __pydantic_extra__: dict[str, Any] = Field(init=False)


class SubmitActionRequestRoles(BaseModel):
    """ActionRoleDefinition stable ID에서 active Entity UUID로의 binding"""
    model_config = ConfigDict(extra="allow")
    __pydantic_extra__: dict[str, ActiveEntityId] = Field(init=False)


class SubmitActionRequest(BaseModel):
    """외부 Action 의도를 SimulationAgenda에 넣기 위한 typed envelope. role/parameter의 상세 contract는 World의 PublishedModel이 검증합니다."""
    model_config = ConfigDict(extra="allow")
    actionTypeId: str = Field(..., min_length=1)
    causationId: str | None = None
    correlationId: str | None = None
    parameters: SubmitActionRequestParameters | None = Field(None, description="ActionParameterDefinition stable ID에서 typed JSON value로의 binding")
    roles: SubmitActionRequestRoles = Field(..., description="ActionRoleDefinition stable ID에서 active Entity UUID로의 binding")
    stimulusId: UUID

    @field_validator("causationId", "correlationId", "parameters", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class SubmitTimeAdvanceRequest(BaseModel):
    """TimeAdvanceRequest envelope. 한 요청은 target instant 또는 duration 중 하나만 가집니다."""
    model_config = ConfigDict(extra="allow")
    causationId: str | None = None
    correlationId: str | None = None
    request: AdvanceToLogicalTime | AdvanceByLogicalDuration
    stimulusId: UUID

    @field_validator("causationId", "correlationId", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class UpdateMeRequest(BaseModel):
    """셀프 프로필 수정 — name만 허용하며 role과 알 수 없는 필드는 포함할 수 없음"""
    model_config = ConfigDict(extra="forbid")
    name: str = Field(..., min_length=1, max_length=100)


class UpdateUserRequest(BaseModel):
    """사용자 수정 요청 (부분 업데이트 — 모든 필드 optional)"""
    model_config = ConfigDict(extra="allow")
    name: str | None = Field(None, min_length=1, max_length=100)
    role: Literal["admin", "user", "guest"] | None = None

    @field_validator("name", "role", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class WorldHead(BaseModel):
    """World의 public control head. Domain Property와 raw StateObject graph는 포함하지 않습니다."""
    model_config = ConfigDict(extra="allow")
    executionProfile: ExecutionProfileRef
    lifecycle: Literal["created", "active", "inactive", "ended"]
    logicalTime: str = Field(..., description="모델이 선언한 형식으로 직렬화한 현재 logical time")
    modelRef: ModelRef
    revision: int = Field(..., ge=0, le=9223372036854775807)
    worldId: UUID
