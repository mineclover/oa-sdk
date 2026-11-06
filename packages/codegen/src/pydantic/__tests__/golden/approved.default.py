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
    model_config = ConfigDict(extra="forbid", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    kind: Literal["to-logical-time"]
    target_logical_time: str = Field(..., alias="targetLogicalTime")


class TokenPair(BaseModel):
    """access/refresh 토큰 페어"""
    model_config = ConfigDict(extra="ignore", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    access_token: str = Field(..., alias="accessToken", description="bearerAuth 헤더에 사용할 JWT")
    expires_in: int = Field(..., alias="expiresIn", description="accessToken 만료까지 남은 초", ge=1)
    refresh_token: str = Field(..., alias="refreshToken", description="/auth/refresh 호출에 사용할 장기 토큰")
    token_type: Literal["Bearer"] = Field(..., alias="tokenType")


class User(BaseModel):
    """사용자 정보"""
    model_config = ConfigDict(extra="ignore", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    created_at: AwareDatetime = Field(..., alias="createdAt")
    email: EmailStr
    id: UUID
    name: str = Field(..., min_length=1, max_length=100)
    role: Literal["admin", "user", "guest"]


class AuthSession(BaseModel):
    """사용자 + 토큰 페어 — 가입/로그인 응답 단위"""
    model_config = ConfigDict(extra="ignore")
    tokens: TokenPair
    user: User


class BuildInfo(BaseModel):
    """현재 실행 중인 빌드 정보"""
    model_config = ConfigDict(extra="ignore", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    built_at: AwareDatetime = Field(..., alias="builtAt")
    git_sha: str = Field(..., alias="gitSha", description="커밋 해시", min_length=7)
    version: str = Field(..., description="semver 또는 빌드 식별 라벨")


class ChangePasswordRequest(BaseModel):
    """비밀번호 변경 요청"""
    model_config = ConfigDict(extra="ignore", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    current_password: str = Field(..., alias="currentPassword", min_length=1)
    new_password: str = Field(..., alias="newPassword", description="최소 8자 이상", min_length=8)


class CreateUserRequest(BaseModel):
    """사용자 생성 요청"""
    model_config = ConfigDict(extra="ignore")
    email: EmailStr
    name: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., description="최소 8자 이상", min_length=8)


class ExecutionProfileRef(BaseModel):
    """World에 고정할 실행 provider 조합의 정확한 식별자"""
    model_config = ConfigDict(extra="ignore", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    profile_id: str = Field(..., alias="profileId", min_length=1)
    semantic_fingerprint: str = Field(..., alias="semanticFingerprint", min_length=1)
    version: str = Field(..., min_length=1)


class ModelRef(BaseModel):
    """게시된 World Model artifact의 정확한 식별자"""
    model_config = ConfigDict(extra="ignore", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    model_id_: str = Field(..., alias="modelId", min_length=1)
    semantic_fingerprint: str = Field(..., alias="semanticFingerprint", min_length=1)
    version: str = Field(..., min_length=1)


class CreateWorldRequest(BaseModel):
    """새 World bootstrap 요청. 생성 뒤 ModelRef와 ExecutionProfileRef는 normal Stimulus로 바꿀 수 없습니다."""
    model_config = ConfigDict(extra="ignore", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    bootstrap_spec_ref: str = Field(..., alias="bootstrapSpecRef", description="모델이 해석하는 초기 scenario/configuration reference", min_length=1)
    execution_profile: ExecutionProfileRef = Field(..., alias="executionProfile")
    model_ref_: ModelRef = Field(..., alias="modelRef")
    run_seed_material: str | None = Field(None, alias="runSeedMaterial", description="선택적 replay seed material. 없으면 provider가 생성한 값을 WorldControlState에 고정합니다.")
    world_id: UUID = Field(..., alias="worldId")

    @field_validator("run_seed_material", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class DependencyStatus(BaseModel):
    model_config = ConfigDict(extra="ignore", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    latency_ms: int | None = Field(None, alias="latencyMs", ge=0)
    message: str | None = None
    name: str
    status: Literal["ok", "degraded", "down"]

    @field_validator("latency_ms", "message", mode="before")
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
    model_config = ConfigDict(extra="ignore")
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
    model_config = ConfigDict(extra="ignore", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    operation_id: str | None = Field(None, alias="operationId")
    request_id: UUID | None = Field(None, alias="requestId")

    @field_validator("operation_id", "request_id", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class Error(BaseModel):
    """표준 에러 응답 스키마"""
    model_config = ConfigDict(extra="ignore", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
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
    model_config = ConfigDict(extra="ignore", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    commit_isolation: Literal["single-writer", "optimistic-revision-cas", "serializable-transaction"] = Field(..., alias="commitIsolation")
    conformance_profiles: list[str] = Field(..., alias="conformanceProfiles")
    decision_random: Literal["counter-derived", "seeded-stream"] = Field(..., alias="decisionRandom")
    numeric_semantics: Literal["fixed-decimal", "rational", "strict-binary-float"] = Field(..., alias="numericSemantics")
    persistence_recovery: Literal["volatile", "snapshot-journal", "durable-outbox"] = Field(..., alias="persistenceRecovery")
    profile: ExecutionProfileRef


class ExportJob(BaseModel):
    """export job receipt. 이 계약의 POST 응답은 queued 상태만 반환하며, 이후 상태 전이와 downloadUrl 전달 방식은 runtime 계약이 별도로 정의합니다."""
    model_config = ConfigDict(extra="ignore", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    download_url: str | None = Field(None, alias="downloadUrl", description="status가 ready일 때만 제공")
    job_id: UUID = Field(..., alias="jobId")
    requested_at: AwareDatetime = Field(..., alias="requestedAt")
    status: Literal["queued", "running", "ready", "failed"]

    @field_validator("download_url", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class ExportRequest(BaseModel):
    """데이터 export 요청"""
    model_config = ConfigDict(extra="ignore")
    format: Literal["json", "csv"] = "json"

    @field_validator("format", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class ForgotPasswordRequest(BaseModel):
    """비밀번호 재설정 토큰 발송 요청"""
    model_config = ConfigDict(extra="ignore")
    email: EmailStr


class HealthEvent(BaseModel):
    """SSE 헬스 이벤트 payload"""
    model_config = ConfigDict(extra="ignore")
    status: Literal["ok", "degraded", "down"] = Field(..., description="관측된 서버 상태")
    timestamp: AwareDatetime = Field(..., description="이벤트 발생 시각")


HealthEvents: TypeAlias = HealthEvent


class HealthStatus(BaseModel):
    model_config = ConfigDict(extra="ignore")
    status: Literal["ok"]
    timestamp: AwareDatetime


class ListExecutionProfilesResponseBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    items: list[ExecutionProfileSummary]


class LoginRequest(BaseModel):
    """로그인 요청"""
    model_config = ConfigDict(extra="ignore")
    email: EmailStr
    password: str = Field(..., min_length=1)


class OnboardingItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
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
    model_config = ConfigDict(extra="ignore")
    items: list[OnboardingItem]


class ProjectionBundleItem(BaseModel):
    """Projection bundle의 outer world/model/revision context를 상속하는 item"""
    model_config = ConfigDict(extra="forbid", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    projection_id: str = Field(..., alias="projectionId", min_length=1)
    value: Any = Field(..., description="PublishedModel이 선언한 projection result의 typed JSON representation")


class ProjectionBundleEnvelope(BaseModel):
    """같은 revision에서 함께 읽어야 하는 semantic projection bundle"""
    model_config = ConfigDict(extra="ignore", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    bundle_id: str = Field(..., alias="bundleId", min_length=1)
    model_ref_: ModelRef = Field(..., alias="modelRef")
    projections: list[ProjectionBundleItem]
    source_revision: int = Field(..., alias="sourceRevision", ge=0, le=9223372036854775807)
    status: Literal["complete", "incomplete", "stale"]
    world_id: UUID = Field(..., alias="worldId")


class ProjectionEnvelope(BaseModel):
    """특정 source revision에서 materialize한 semantic projection"""
    model_config = ConfigDict(extra="ignore", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    model_ref_: ModelRef = Field(..., alias="modelRef")
    projection_id: str = Field(..., alias="projectionId", min_length=1)
    source_revision: int = Field(..., alias="sourceRevision", ge=0, le=9223372036854775807)
    value: Any = Field(..., description="PublishedModel이 선언한 projection result의 typed JSON representation")
    world_id: UUID = Field(..., alias="worldId")


class PublicUserProfile(BaseModel):
    """공개 프로필 — PII 비포함 (email/createdAt 제외)"""
    model_config = ConfigDict(extra="ignore")
    id: UUID
    name: str = Field(..., min_length=1, max_length=100)
    role: Literal["admin", "user", "guest"]


class PurgeUserRequest(BaseModel):
    """site-admin 사용자 hard purge 요청. deleteUser와 별도의 권한 및 감사 절차를 적용합니다."""
    model_config = ConfigDict(extra="forbid", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    legal_hold_override: bool = Field(False, alias="legalHoldOverride", description="legal hold 예외 승인 여부")
    reason: str = Field(..., description="영구 삭제 감사 사유", min_length=1, max_length=1000)

    @field_validator("legal_hold_override", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class ReadinessReport(BaseModel):
    """readiness probe 결과 — 의존 시스템 검증 포함"""
    model_config = ConfigDict(extra="ignore")
    dependencies: list[DependencyStatus]
    status: Literal["ready", "not-ready"]
    timestamp: AwareDatetime


class RefreshRequest(BaseModel):
    """토큰 갱신 요청"""
    model_config = ConfigDict(extra="ignore", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    refresh_token: str = Field(..., alias="refreshToken", min_length=1)


class RegisterRequest(BaseModel):
    """회원가입 요청"""
    model_config = ConfigDict(extra="ignore")
    email: EmailStr
    name: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., description="최소 8자 이상", min_length=8)


class Report(BaseModel):
    """신고 단건"""
    model_config = ConfigDict(extra="ignore", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    created_at: AwareDatetime = Field(..., alias="createdAt")
    details: str | None = None
    id: UUID
    reason: Literal["spam", "harassment", "hate-speech", "fraud", "impersonation", "other"]
    reporter_user_id: UUID = Field(..., alias="reporterUserId")
    resolved_at: AwareDatetime | None = Field(None, alias="resolvedAt")
    status: Literal["open", "under-review", "resolved", "dismissed"]
    target_user_id: UUID = Field(..., alias="targetUserId")

    @field_validator("details", "resolved_at", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class ReportRequest(BaseModel):
    """신고 요청 본문"""
    model_config = ConfigDict(extra="ignore")
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
    model_config = ConfigDict(extra="ignore", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    new_password: str = Field(..., alias="newPassword", description="최소 8자 이상", min_length=8)
    token: str = Field(..., min_length=1)


class RoleChangeEvent(BaseModel):
    """역할 변경 이력 단건"""
    model_config = ConfigDict(extra="ignore", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    changed_at: AwareDatetime = Field(..., alias="changedAt")
    changed_by: UUID = Field(..., alias="changedBy", description="변경을 수행한 admin의 UUID")
    id: UUID
    new_role: Literal["admin", "user", "guest"] = Field(..., alias="newRole")
    previous_role: Literal["admin", "user", "guest"] = Field(..., alias="previousRole")
    reason: str | None = None

    @field_validator("reason", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class StimulusAccepted(BaseModel):
    """Agenda가 받아들인 Stimulus. 이 응답은 Transaction commit 성공을 뜻하지 않습니다."""
    model_config = ConfigDict(extra="ignore", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    accepted_at_revision: int = Field(..., alias="acceptedAtRevision", ge=0, le=9223372036854775807)
    accepted_logical_time: str = Field(..., alias="acceptedLogicalTime")
    status: Literal["accepted", "duplicate"]
    stimulus_id: UUID = Field(..., alias="stimulusId")
    world_id: UUID = Field(..., alias="worldId")


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
    model_config = ConfigDict(extra="ignore", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    action_type_id: str = Field(..., alias="actionTypeId", min_length=1)
    causation_id: str | None = Field(None, alias="causationId")
    correlation_id: str | None = Field(None, alias="correlationId")
    parameters: SubmitActionRequestParameters | None = Field(None, description="ActionParameterDefinition stable ID에서 typed JSON value로의 binding")
    roles: SubmitActionRequestRoles = Field(..., description="ActionRoleDefinition stable ID에서 active Entity UUID로의 binding")
    stimulus_id: UUID = Field(..., alias="stimulusId")

    @field_validator("causation_id", "correlation_id", "parameters", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value


class SubmitTimeAdvanceRequest(BaseModel):
    """TimeAdvanceRequest envelope. 한 요청은 target instant 또는 duration 중 하나만 가집니다."""
    model_config = ConfigDict(extra="ignore", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    causation_id: str | None = Field(None, alias="causationId")
    correlation_id: str | None = Field(None, alias="correlationId")
    request: AdvanceToLogicalTime | AdvanceByLogicalDuration
    stimulus_id: UUID = Field(..., alias="stimulusId")

    @field_validator("causation_id", "correlation_id", mode="before")
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
    model_config = ConfigDict(extra="ignore")
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
    model_config = ConfigDict(extra="ignore", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)
    execution_profile: ExecutionProfileRef = Field(..., alias="executionProfile")
    lifecycle: Literal["created", "active", "inactive", "ended"]
    logical_time: str = Field(..., alias="logicalTime", description="모델이 선언한 형식으로 직렬화한 현재 logical time")
    model_ref_: ModelRef = Field(..., alias="modelRef")
    revision: int = Field(..., ge=0, le=9223372036854775807)
    world_id: UUID = Field(..., alias="worldId")
